import { Mascot } from "../components/mascot/Mascot";
import type { MascotState } from "../components/mascot/types";

/**
 * What the surface is doing right now, as a value rather than as a window.
 *
 * Modelled as data because the two visible properties — is it on screen, and is
 * it escalating — are decided by rules that are worth stating and testing on
 * their own, and a component that both decided them and rendered them would put
 * those rules behind a DOM query. It is also the seam the decision surface and
 * the e2e run read: they need to know what the surface is doing, and neither
 * should have to ask a window manager.
 */
export interface SurfaceVisibility {
  /** Whether the surface is on screen at all. */
  readonly visible: boolean;
  /** Whether it is escalating, which is not the same as being visible. */
  readonly escalating: boolean;
  /**
   * Whether appearing should take the keyboard.
   *
   * Never true while ambient: a window that grabs focus to say nothing is
   * happening is the thing this product exists to avoid. True only where the
   * surface cannot float, because there appearing *is* the escalation and the
   * user asked to be interrupted when an agent blocked.
   */
  readonly takesFocus: boolean;
}

/**
 * What the surface should do, given what is blocked and what the platform can do.
 *
 * ```
 *  something actionable is blocked  -> visible, escalating
 *  nothing is blocked
 *    platform can hold a surface    -> visible, ambient, no focus
 *    platform cannot               -> not visible
 * ```
 *
 * Two rules and one condition between them, and the condition is the whole
 * design rather than a setting.
 *
 * The idle behaviour differs by platform because the platforms genuinely differ,
 * and the difference is the one property that decides it. Where a compositor
 * will keep a surface above unfocused windows, a companion that is always there
 * costs nothing and is worth having. Where it will not, a surface that sits
 * behind the user's own work is a window to be tidied away, and the honest
 * thing is for it not to exist until it has something to say.
 *
 * That second behaviour is not a degraded version of the first. It is the
 * attention-routing rule with nothing left to strip: on a platform that cannot
 * float, a surface which is invisible unless it is actionable is the purest
 * expression of what this product is for, and the only variant that does not
 * fight the window the user is trying to work in.
 *
 * The alternative — detect the platform and switch the feature off — was
 * rejected because it ships a product that does nothing on a large and entirely
 * reasonable desktop.
 */
export function surfaceVisibility(
  escalating: boolean,
  canHoldPersistentSurface: boolean
): SurfaceVisibility {
  return {
    // Escalation is what puts the surface on screen. Ambient only keeps it
    // there where the platform can hold it there.
    visible: escalating || canHoldPersistentSurface,
    escalating,
    // Follows from the two above rather than being stated separately: only a
    // surface that cannot float has any reason to interrupt, and only an
    // interruption is a reason to take the keyboard.
    takesFocus: escalating && !canHoldPersistentSurface,
  };
}

/**
 * The styling that tells an escalating surface from an ambient one.
 *
 * Escalation changes **scale and motion as well as colour**, and the reason it
 * has to is that hue alone is not a signal anyone can rely on: it fails for
 * anyone who does not separate the colours, and this mascot's own vocabulary is
 * already colour-coded, so an amber alone risks colliding with a state that
 * already means something else.
 *
 * The properties are returned as a value rather than applied as a stylesheet so
 * that "is it distinguishable without colour" is answerable by comparing them,
 * which is the question the requirement is actually asking. A test that reads a
 * CSS file can only confirm the file mentions `scale`; this can confirm the
 * rendered surface differs in it.
 */
export interface EscalationStyle {
  /** The transform applied to the mascot. Scale is the non-colour signal. */
  readonly transform: string;
  /** The name of the running animation, or `none` when ambient. */
  readonly animation: string;
  /** The glow the floor casts. Reinforcement, never the signal itself. */
  readonly glow: string;
}

/** How far the character lifts while escalating, in the mascot's own units. */
export const ESCALATION_LIFT = 0.55;

/** The pulse period. Long enough to read as a rhythm, short enough to notice. */
export const ESCALATION_PULSE_MS = 1_400;

/**
 * How the surface looks while escalating, and how it looks while ambient.
 *
 * Two axes move and the colour follows: the character lifts and scales up, and
 * the floor glow pulses. Strip the colour and the difference is still there,
 * which is the requirement, and it is also why the transform carries the signal
 * rather than accompanying it.
 */
export function escalationStyle(escalating: boolean): EscalationStyle {
  return escalating
    ? {
        transform: `translateY(-${ESCALATION_LIFT}em) scale(1.08)`,
        animation: `spark-escalation-pulse ${ESCALATION_PULSE_MS}ms ease-in-out infinite`,
        glow: "var(--spark-escalation-glow, #f0b429)",
      }
    : {
        transform: "none",
        animation: "none",
        glow: "var(--spark-ambient-glow, #6f7bd4)",
      };
}

export interface EscalationSurfaceProps {
  /** Which state to present, as `selectState` produced it. */
  readonly state: MascotState;
  /** Whether anything actionable is waiting on the user. */
  readonly escalating: boolean;
  /** Whether this platform can keep the surface above unfocused windows. */
  readonly canHoldPersistentSurface: boolean;
  /** Rendered width for the mascot. Never a window size. */
  readonly width?: number;
}

/**
 * The escalation surface: the mascot, and nothing else.
 *
 * It draws the state it is given and decides nothing about which state that is.
 * `selectState` owns that question and has one answer in this codebase; a
 * second opinion here would be a second, untested copy of it.
 *
 * Visibility is the one thing it does decide, and it decides it from
 * `surfaceVisibility` rather than from a condition of its own.
 *
 * **Sizing.** No window size is ever requested of the platform, because a
 * requested size is a suggestion the platform may decline — and does. The spike
 * this design rests on asked for 140x150 and was answered with 200x239 on one
 * path and 200x200 on the other. So the surface sizes itself from its content
 * and the stylesheet around it, and treats whatever dimensions it is handed as
 * a viewport rather than as a specification. `Mascot` states the canvas ratio
 * rather than a pixel height, so an unexpected viewport letterboxes nothing and
 * clips nothing: the artwork keeps its proportion inside whatever box it gets.
 *
 * `width` here is the mascot's rendered width, not a window size, and it is a
 * default rather than a contract — the surface is sized by what it contains.
 */
export function EscalationSurface({
  state,
  escalating,
  canHoldPersistentSurface,
  width,
}: EscalationSurfaceProps) {
  const visibility = surfaceVisibility(escalating, canHoldPersistentSurface);
  const style = escalationStyle(escalating);

  // Nothing on screen means nothing rendered, rather than something rendered
  // and hidden: on a platform that cannot float, an idle surface should not
  // exist to be discovered, and `display: none` still leaves it in the
  // accessibility tree on some platforms.
  if (!visibility.visible) return null;

  return (
    <div
      data-testid="escalation-surface"
      data-escalating={visibility.escalating ? "" : undefined}
      data-takes-focus={visibility.takesFocus ? "" : undefined}
      role="status"
      aria-live="polite"
      aria-label={escalating ? "An agent needs your decision" : "Spark is here"}
    >
      <div
        data-testid="escalation-stage"
        // A transform cannot be animated smoothly through a layout change, and
        // the mascot is otherwise sized by its own canvas ratio, so the lift and
        // the scale live on the stage rather than on the artwork.
        style={{
          transform: style.transform,
          transition: "transform 220ms ease-out",
        }}
      >
        <Mascot state={state} width={width} />
      </div>

      {/* The glow is rendered as a stylesheet concern keyed off this attribute,
          so the distinction is inspectable rather than buried in inline style. */}
      <span data-testid="escalation-glow" data-glow={style.glow} hidden />
    </div>
  );
}