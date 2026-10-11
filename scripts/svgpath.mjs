// Proper SVG path data parser + bbox, for anchor derivation experiments.
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export function parsePath(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const segs = [];
  let i = 0;
  let cmd = null;
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      cmd = tokens[i];
      i++;
      if (ARITY[cmd.toUpperCase()] === 0) continue;
    }
    const n = ARITY[cmd.toUpperCase()];
    if (n === undefined) throw new Error(`unknown command ${cmd}`);
    const args = tokens.slice(i, i + n).map(Number);
    if (args.length < n) break;
    segs.push({ cmd, args });
    i += n;
  }
  return segs;
}

/** Conservative bbox using control points (control-point hull). */
export function pathBBox(d) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const put = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const { cmd, args } of parsePath(d)) {
    const c = cmd.toUpperCase();
    const rel = cmd !== c;
    // For relative commands we need the current point; approximated below.
    for (let k = 0; k + 1 < args.length; k += 2) put(args[k], args[k + 1]);
    if (c === "H") put(args[0], 0);
    if (c === "V") put(0, args[0]);
  }
  return { minX, minY, maxX, maxY };
}

/** Absolute bbox tracking the current point so relative commands work. */
export function pathBBoxAbs(d) {
  let cx = 0, cy = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const put = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const { cmd, args } of parsePath(d)) {
    const c = cmd.toUpperCase();
    const rel = cmd !== c;
    const ax = (x) => (rel ? cx + x : x);
    const ay = (y) => (rel ? cy + y : y);
    switch (c) {
      case "M": { const x = ax(args[0]), y = ay(args[1]); put(x, y); cx = x; cy = y; break; }
      case "L": { const x = ax(args[0]), y = ay(args[1]); put(x, y); cx = x; cy = y; break; }
      case "H": { const x = ax(args[0]); put(x, cy); cx = x; break; }
      case "V": { const y = ay(args[0]); put(cx, y); cy = y; break; }
      case "C": {
        const p1 = [ax(args[0]), ay(args[1])], p2 = [ax(args[2]), ay(args[3])], p3 = [ax(args[4]), ay(args[5])];
        put(p1[0], p1[1]); put(p2[0], p2[1]); put(p3[0], p3[1]);
        cx = p3[0]; cy = p3[1];
        break;
      }
      case "Q": case "S": case "T": {
        const last = args.length === 4 ? [ax(args[2]), ay(args[3])] : [ax(args[0]), ay(args[1])];
        for (let k = 0; k + 1 < args.length; k += 2) put(ax(args[k]), ay(args[k + 1]));
        cx = last[0]; cy = last[1];
        break;
      }
      case "A": put(ax(args[5]), ay(args[6])); cx = ax(args[5]); cy = ay(args[6]); break;
      case "Z": break;
    }
  }
  return { minX, minY, maxX, maxY };
}
