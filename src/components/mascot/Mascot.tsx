import { Idle } from "./states/Idle";
import { Thinking } from "./states/Thinking";
import { Working } from "./states/Working";
import { Success } from "./states/Success";
import { Focused } from "./states/Focused";
import { Alert } from "./states/Alert";
import { Listening } from "./states/Listening";
import { Tired } from "./states/Tired";
import { NeedsYou } from "./states/NeedsYou";
import type { ComponentType } from "react";
import { CANVAS_VIEWBOX, DEFAULT_HEIGHT, DEFAULT_WIDTH } from "./canvas";
import type { MascotProps, MascotState, MascotVectorInternalProps } from "./types";

/**
 * Every state vector, keyed by state name.
 *
 * All nine are mounted lazily-by-reference (not code-split), so switching states
 * costs a single React reconciliation and never a network fetch.
 *
 * The record is total over `MascotState`, so the lookup below needs no fallback:
 * the type guarantees a component exists for every state, and a fallback would
 * imply a failure mode that cannot occur.
 *
 * Components are typed with the internal props type because the wrapper — not a
 * caller — is what supplies the canonical canvas.
 */
export const MASCOT_VECTORS: Record<
  MascotState,
  ComponentType<MascotVectorInternalProps>
> = {
  idle: Idle,
  thinking: Thinking,
  working: Working,
  success: Success,
  focused: Focused,
  alert: Alert,
  listening: Listening,
  tired: Tired,
  needsYou: NeedsYou,
};

const LABELS: Record<MascotState, string> = {
  idle: "Mascot idle",
  thinking: "Mascot thinking",
  working: "Mascot working",
  success: "Mascot celebrating success",
  focused: "Mascot focused",
  alert: "Mascot alert",
  listening: "Mascot listening",
  tired: "Mascot tired",
  needsYou: "Mascot needs you",
};

/**
 * Renders one of the nine mascot states.
 *
 * ```tsx
 * <Mascot state="thinking" width={96} height={96} />
 * ```
 *
 * The returned element is the state's own `<svg>` — there is no wrapper, so
 * `className`, `style`, sizing and event handlers apply directly to it.
 * `role` and the state-derived accessible name are emitted once, here, rather
 * than duplicated across all nine state components.
 *
 * Sized to the canonical canvas by default; `width`/`height` or CSS override it.
 * A caller cannot supply a `viewBox` — the rendering contract is not alterable
 * through props.
 */
export function Mascot({ state = "idle", ...rest }: MascotProps) {
  const Vector = MASCOT_VECTORS[state];
  return (
    // The canvas declaration is applied here, not accepted from the caller: it
    // is the component's own rendering contract. `MascotProps` omits `viewBox`,
    // so a caller-supplied one is a compile error.
    <Vector
      {...rest}
      viewBox={CANVAS_VIEWBOX}
      width={rest.width ?? DEFAULT_WIDTH}
      height={rest.height ?? DEFAULT_HEIGHT}
      role={rest.role ?? "img"}
      aria-label={rest["aria-label"] ?? LABELS[state]}
      data-state={state}
    />
  );
}

export default Mascot;
