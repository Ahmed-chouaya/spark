export { Mascot, MASCOT_VECTORS, default } from "./Mascot";
export { MASCOT_STATES } from "./types";
export type { MascotProps, MascotState, MascotVectorProps, MascotVectorInternalProps } from "./types";

export {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  CANVAS_VIEWBOX,
  ANCHOR_X,
  ANCHOR_Y,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  stateTransform,
} from "./canvas";
export { ANCHORS } from "./anchors";
export type { StateAnchor } from "./anchors";

export { Idle } from "./states/Idle";
export { Thinking } from "./states/Thinking";
export { Working } from "./states/Working";
export { Success } from "./states/Success";
export { Focused } from "./states/Focused";
export { Alert } from "./states/Alert";
export { Listening } from "./states/Listening";
export { Tired } from "./states/Tired";
export { NeedsYou } from "./states/NeedsYou";
