/**
 * The harness page: the mascot's full state vocabulary, on screen, on one
 * baseline.
 *
 * This page observes the mascot. It does not decide anything about it. In
 * particular it never selects a state — it is told which state to show, and
 * when it is told nothing it shows all of them. `src/state-selection/` owns the
 * question of which state a set of sessions implies, and that question has
 * exactly one answer in this codebase, in the module that is tested for it.
 *
 * Development-only. Nothing in the product sources imports this file; the
 * product never builds it.
 */
import { useState } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MASCOT_STATES,
  Mascot,
  type MascotState,
} from "../components/mascot";

/**
 * The aggregate view: every state, side by side.
 *
 * It is a selection value rather than a separate mode, so one control and one
 * readout describe the whole page and a request for "everything" is expressible
 * in the address the same way a request for one state is.
 */
export const ALL = "all";

/** What the page shows, given what it was asked for. */
export type Selection = typeof ALL | MascotState;

/**
 * What an unrecognised request falls back to: the first state in presentation
 * order.
 *
 * A bad `?state=` is a typo in a URL a developer typed, not a broken build, so
 * it degrades to a renderable page rather than a blank one. The fallback is
 * reported through the current-state readout, which is why the typo is visible
 * rather than merely absent.
 *
 * Read from the vocabulary rather than named, so this page owns no copy of the
 * list of states. `MASCOT_STATES` is documented as presentation order and
 * `idle` is its first entry, which is the state a person would want to see
 * when the request could not be honoured.
 */
export const FALLBACK_STATE: MascotState = MASCOT_STATES[0];

/** Whether a string names a state the mascot actually defines. */
export function isMascotState(value: string): value is MascotState {
  return (MASCOT_STATES as readonly string[]).includes(value);
}

/**
 * Resolve what was requested into what will be shown.
 *
 * Missing or empty asks for the whole vocabulary; a known name is honoured; an
 * unknown name falls back rather than failing.
 */
export function resolveSelection(requested: string | null | undefined): Selection {
  if (requested == null || requested === "" || requested === ALL) return ALL;
  return isMascotState(requested) ? requested : FALLBACK_STATE;
}

/** One rendering size, offered by the size control. */
export interface SizePreset {
  readonly name: string;
  readonly width: number;
}

/**
 * Small is deliberately below the ~48px the artwork's sub-pixel stroke widths
 * need. Showing it next to large is what turns "don't use this size" from a
 * comment in the source into something you can see and disagree with.
 */
export const SMALL: SizePreset = { name: "small", width: 32 };

/** Large is the default: this page exists to be looked at. */
export const LARGE: SizePreset = { name: "large", width: 160 };

export const SIZE_PRESETS: readonly SizePreset[] = [SMALL, LARGE];

export const DEFAULT_SIZE = LARGE;

/** The preset a size name selects, defaulting rather than going undefined. */
export function presetNamed(name: string): SizePreset {
  return SIZE_PRESETS.find((preset) => preset.name === name) ?? DEFAULT_SIZE;
}

/**
 * The height a width implies, from the mascot's own canvas ratio.
 *
 * Kept as a page-local helper rather than imported from the mascot, because the
 * mascot no longer needs a height passed to it: it states `aspect-ratio` and
 * the height follows the width. The page only needs the number to *assert*
 * against in its own tests — which is exactly the consumer-side workaround this
 * replaced, so it is worth being able to compute the expected value here.
 */
export function heightFor(width: number): number {
  return (width * CANVAS_HEIGHT) / CANVAS_WIDTH;
}

export interface DevPageProps {
  /** The `state` query parameter, when the page was opened requesting one. */
  requested?: string | null;
}

export function DevPage({ requested = null }: DevPageProps) {
  const [selection, setSelection] = useState<Selection>(() => resolveSelection(requested));
  const [size, setSize] = useState<SizePreset>(DEFAULT_SIZE);

  const select = (value: string): void => {
    const next = resolveSelection(value);
    setSelection(next);

    // Keep the address describing what is on screen. The page is meant to be
    // driven by an automated run as well as by a person, and a control that
    // changed the view without changing the address would leave no way to tell
    // afterwards which of the two a screenshot was of.
    const url = new URL(window.location.href);
    if (next === ALL) url.searchParams.delete("state");
    else url.searchParams.set("state", next);
    window.history.replaceState(null, "", url);
  };

  return (
    <main>
      <header>
        <h1>Mascot state harness</h1>

        <div className="controls">
          <label>
            <span>State</span>
            <select
              aria-label="State"
              data-testid="state-select"
              value={selection}
              onChange={(event) => select(event.target.value)}
            >
              <option value={ALL}>All states</option>
              {MASCOT_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Size</span>
            <select
              aria-label="Size"
              data-testid="size-select"
              value={size.name}
              onChange={(event) => setSize(presetNamed(event.target.value))}
            >
              {SIZE_PRESETS.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name} — {preset.width}px
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="readout">
          Showing{" "}
          <output data-testid="current-state">{selection}</output>{" "}
          at <output data-testid="current-size">{`${size.name} (${size.width}px)`}</output>
        </p>
      </header>

      {selection === ALL ? (
        <Vocabulary size={size} />
      ) : (
        <SingleState state={selection} size={size} />
      )}
    </main>
  );
}

/**
 * Every state, rendered at every offered size.
 *
 * The states are enumerated from the mascot's own exported list rather than
 * written out here, so a state added to the vocabulary appears on this page
 * without this page being edited — a tenth state is a change to the mascot, not
 * a change to the harness.
 *
 * Every card gets the same box and the same floor line (see `dev.css`). If a
 * state looks smaller than its neighbours here, that is a defect in the
 * artwork, which is the only thing this view is able to tell you.
 */
function Vocabulary({ size }: { size: SizePreset }) {
  return (
    <section className="grid" data-testid="vocabulary">
      {MASCOT_STATES.map((state) => (
        <article className="card" data-state-card={state} key={state}>
          <h2>{state}</h2>
          <div className="card-canvas">
            {SIZE_PRESETS.map((preset) => (
              <div
                className="render"
                data-size={preset.name}
                data-active={preset.name === size.name ? "" : undefined}
                key={preset.name}
              >
                <Mascot state={state} width={preset.width} />
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

/** One state on its own, at the size currently selected. */
function SingleState({ state, size }: { state: MascotState; size: SizePreset }) {
  return (
    <section className="single">
      <article className="card" data-state-card={state}>
        <h2>{state}</h2>
        <div className="card-canvas" data-size={size.name}>
          <Mascot state={state} width={size.width} />
        </div>
      </article>
    </section>
  );
}