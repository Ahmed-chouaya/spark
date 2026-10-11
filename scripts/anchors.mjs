/**
 * Build-time anchor derivation.
 *
 * Reads each state component's artwork and derives the two anchors the
 * canonical canvas is positioned by:
 *
 * - `visorCx` — horizontal centre of the visor, the path in the `-body` group
 *   whose fill is a gradient and which carries a stroke.
 * - `groundCy` — vertical position of the floor line, the `cy` of the ellipse
 *   in the `-glow` group.
 *
 * Consumed by `extract-anchors.mjs`, which commits the result, and by the
 * drift test, which re-derives from source and asserts equality.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathBBoxAbs } from "./svgpath.mjs";

const STATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/components/mascot/states"
);

/**
 * Parse a JSX attribute list, keeping template-literal values intact.
 */
function parseAttrs(raw) {
  const attrs = {};
  const re = /([\w:-]+)=/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1];
    let i = re.lastIndex;
    const value = { plain: true, text: "" };
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (raw[i] === "{") {
      let depth = 0;
      const start = i;
      for (; i < raw.length; i++) {
        if (raw[i] === "{") depth++;
        else if (raw[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      value.plain = false;
      value.text = raw.slice(start + 1, i);
      i++;
    } else if (raw[i] === '"') {
      const end = raw.indexOf('"', i + 1);
      value.text = raw.slice(i + 1, end);
      i = end + 1;
    } else {
      const end = raw.search(/\s/);
      value.plain = false;
      value.text = raw.slice(i, end === -1 ? raw.length : end);
      i = end === -1 ? raw.length : end;
    }
    re.lastIndex = i;
    attrs[key] = value;
  }
  return attrs;
}

/** The literal text of an attribute value, for comparisons. */
const attrText = (v) => (v === undefined ? undefined : v.text);

/** A numeric attribute value. */
const num = (v) => Number(attrText(v));

/**
 * Parse the element tree of a state component's JSX, groups included.
 *
 * A plain `<tag ...>` regex is not enough: the anchor wrapper carries a
 * `transform={`<g transform={`translate(${tx} ${ty})`}`}` whose braces contain a
 * `>` inside a nested template literal. Attribute scanning is therefore
 * brace-aware, and a `<g>` whose body contains a nested `<g>` is matched by
 * depth rather than by the next `</g>`.
 */
function elements(src) {
  const out = [];
  const tagRe = /<([A-Za-z][\w]*)\b/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const tag = m[1];
    if (!["ellipse", "path", "circle", "rect", "g"].includes(tag)) continue;

    // scan attributes, tracking brace depth so `>` inside {...} is not a close
    let i = tagRe.lastIndex;
    let depth = 0;
    let selfClosing = false;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
      else if (ch === "/" && depth === 0 && src[i + 1] === ">") {
        selfClosing = true;
        break;
      }
    }
    const rawAttrs = src.slice(tagRe.lastIndex, i);
    tagRe.lastIndex = i + 1;

    const attrs = parseAttrs(rawAttrs);

    let inner = "";
    if (!selfClosing) {
      const closeTag = `</${tag}>`;
      if (tag === "g") {
        // match the matching close by depth, then rewind so nested elements
        // are visited by the outer loop rather than skipped
        const gRe = /<g\b|<\/g>/g;
        gRe.lastIndex = tagRe.lastIndex;
        let d = 1;
        let g;
        while (d > 0 && (g = gRe.exec(src))) d += g[0] === "</g>" ? -1 : 1;
        const end = d === 0 ? g.index : src.indexOf(closeTag, tagRe.lastIndex);
        inner = src.slice(tagRe.lastIndex, end);
        tagRe.lastIndex = tagRe.lastIndex;
      } else {
        const end = src.indexOf(closeTag, tagRe.lastIndex);
        inner = src.slice(tagRe.lastIndex, end);
        tagRe.lastIndex = end + closeTag.length;
      }
    }
    out.push({ tag, attrs, inner });
  }
  return out;
}

/** Bounding box of one element, accounting for its stroke width. */
function elementBBox(el) {
  let box;
  if (el.tag === "path") box = pathBBoxAbs(attrText(el.attrs.d));
  else if (el.tag === "ellipse")
    box = {
      minX: +num(el.attrs.cx) - +num(el.attrs.rx),
      maxX: +num(el.attrs.cx) + +num(el.attrs.rx),
      minY: +num(el.attrs.cy) - +num(el.attrs.ry),
      maxY: +num(el.attrs.cy) + +num(el.attrs.ry),
    };
  else if (el.tag === "circle")
    box = {
      minX: +num(el.attrs.cx) - +num(el.attrs.r),
      maxX: +num(el.attrs.cx) + +num(el.attrs.r),
      minY: +num(el.attrs.cy) - +num(el.attrs.r),
      maxY: +num(el.attrs.cy) + +num(el.attrs.r),
    };
  else return null;
  const pad = +(attrText(el.attrs["stroke-width"]) || attrText(el.attrs.strokeWidth) || 0) / 2;
  return {
    minX: box.minX - pad,
    maxX: box.maxX + pad,
    minY: box.minY - pad,
    maxY: box.maxY + pad,
  };
}

/**
 * Derive one state's anchors from its component source.
 *
 * @param {string} src JSX source of a state component
 * @returns {{ visorCx: number, groundCy: number, content: { minX: number, minY: number, maxX: number, maxY: number } }}
 */
export function deriveAnchors(src) {
  const groups = elements(src).filter((e) => e.tag === "g");
  // Skip the unlabelled wrapper group that carries the anchor translation.
  const named = groups.filter(
    (g) => attrText(g.attrs.id) !== undefined || g.attrs["data-part"] !== undefined
  );
  const group = (part) =>
    named.find((g) => attrText(g.attrs["data-part"]) === part || attrText(g.attrs.id)?.endsWith(`-${part}`));

  const glow = group("glow");
  const body = group("body");
  if (!glow || !body) throw new Error("state is missing its glow or body group");

  const ground = elements(glow.inner).find((e) => e.tag === "ellipse");
  if (!ground) throw new Error("glow group has no ground ellipse");

  // The visor is the body path whose fill resolves to a paint definition (a
  // gradient reference) and which also carries a stroke. Both the pre-migration
  // literal form and the current template-literal form are accepted.
  const isPaintRef = (fill) => fill !== undefined && /url\(/.test(attrText(fill));
  const visor = elements(body.inner).find(
    (e) => e.tag === "path" && isPaintRef(e.attrs.fill) && e.attrs.stroke !== undefined
  );
  if (!visor) throw new Error("body group has no visor path");

  const visorBox = pathBBoxAbs(attrText(visor.attrs.d));

  const content = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const groupEl of named) {
    for (const child of elements(groupEl.inner)) {
      const box = elementBBox(child);
      if (!box) continue;
      content.minX = Math.min(content.minX, box.minX);
      content.minY = Math.min(content.minY, box.minY);
      content.maxX = Math.max(content.maxX, box.maxX);
      content.maxY = Math.max(content.maxY, box.maxY);
    }
  }

  return {
    visorCx: (visorBox.minX + visorBox.maxX) / 2,
    groundCy: num(ground.attrs.cy),
    content,
  };
}

/** Derive anchors for every state component in the states directory. */
export function deriveAllAnchors(dir = STATES_DIR) {
  const result = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx")).sort()) {
    const state = file.replace(/\.tsx$/, "");
    const key = state[0].toLowerCase() + state.slice(1);
    result[key] = deriveAnchors(readFileSync(join(dir, file), "utf8"));
  }
  return result;
}
