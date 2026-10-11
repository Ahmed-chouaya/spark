/**
 * NeedsYou — Plain magenta body with a notification-bell badge and dot trail.
 *
 * The one state denoting an agent that has stopped and is waiting on the user.
 *
 * Extracted from the 12-cell sheet, cell (2,2)
 * labelled "NOTIFICATION".
 *
 * The original brief specified the `PAUSED` cell for this state. `PAUSED` is a
 * plain body with no accessories — effectively indistinguishable from `idle`,
 * which defeats the only job this state has. `NOTIFICATION` carries a bell
 * badge and a three-dot trail, so it reads as "something wants you" at a
 * glance with no new artwork required. `PAUSED` remains unused.
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function NeedsYou(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint10`}
          x1="40.9531"
          y1="63.1406"
          x2="59.2188"
          y2="63.1406"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stopColor="#1F19B5"
            stopOpacity="0"
          />
          <stop
            offset="0.494792"
            stopColor="#2800FF"
            stopOpacity="0.505208"
          />
          <stop
            offset="1"
            stopColor="#1F19B5"
            stopOpacity="0"
          />
        </linearGradient>
        <linearGradient id={`${uid}Paint32`}
          x1="48.8125"
          y1="52.9688"
          x2="48.8125"
          y2="63.0781"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0.28125"
            stopColor="#00EFFF"
          />
          <stop
            offset="0.53125"
            stopColor="#7F80FF"
          />
          <stop
            offset="0.78125"
            stopColor="#FF4DFF"
          />
          <stop
            offset="1"
            stopColor="#0099FF"
          />
        </linearGradient>
        <linearGradient id={`${uid}Paint33`}
          x1="49.25"
          y1="55.3516"
          x2="49.25"
          y2="63.0625"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stopColor="#2444A7"
          />
          <stop
            offset="0.447917"
            stopColor="#00134A"
          />
          <stop
            offset="1"
            stopColor="#000937"
          />
        </linearGradient>
      </defs>
      <g transform={stateTransform("needsYou")}>
      <g data-part="glow">
        <ellipse
          cx="50.0859"
          cy="63.1406"
          rx="9.13281"
          ry="0.71875"
          fill={`url(#${uid}Paint10)`}
        />
      </g>
      <g data-part="body">
        <path
          d="M 53.54,57.62 C53.79,55.62 52.57,54.51 50.38,54.51 C48.56,54.51 47.13,54.39 47.15,52.97 C45.5,53.48 44.71,54.84 44.54,56.28 C44.36,57.9 42.95,58.79 42.95,60.41 C42.95,62.1 44.42,63.09 46.58,63.09 H 51.12 C53.26,63.09 54.24,62.04 54.24,60.64 C54.24,59.29 53.43,58.65 53.54,57.62 Z"
          fill="#F94DFF"
          stroke="#8200FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 47.15,52.97 C 45.5,53.48 44.71,54.84 44.54,56.28 C44.36,57.9 42.95,58.79 42.95,60.41 C42.95,62.1 44.42,63.09 46.58,63.09 C48.09,63.09 48.52,63 48.52,63 C45.61,63.1 44.51,62.34 44.51,60.67 C44.51,57.67 46.69,55.32 49.58,55.32 C51.5,55.32 52.89,56.21 53.6,57.37 C54.1,55.19 52.48,54.43 50.38,54.51 C48.56,54.51 47.13,54.39 47.15,52.97 Z"
          fill={`url(#${uid}Paint32)`}
        />
        <path
          d="M 49.51,55.36 C 46.51,55.36 44.48,58.04 44.48,60.66 C44.48,62.51 45.74,63.04 48.13,63.05 H 49.61 C52.55,63.05 53.54,62.17 53.54,60.45 C53.54,57.46 51.9,55.36 49.51,55.36 Z"
          fill={`url(#${uid}Paint33)`}
          stroke="#0033FF"
          strokeWidth="0.15625"
        />
        <ellipse
          cx="47.4531"
          cy="52.7422"
          rx="0.390625"
          ry="0.28125"
          fill="#00E7FF"
          transform="rotate(-29.9804 47.4531 52.7422)"
        />
      </g>
      <g data-part="eyes">
        <ellipse
          cx="50.0547"
          cy="59.5156"
          rx="0.78125"
          ry="1.39062"
          fill="#66F7FF"
          stroke="#0077FF"
          strokeWidth="0.15625"
        />
        <ellipse
          cx="52.6055"
          cy="58.9453"
          rx="0.445312"
          ry="1.23438"
          fill="#88F7FF"
          stroke="#0077FF"
          transform="rotate(-10.1885 52.6055 58.9453)"
          strokeWidth="0.113281"
        />
      </g>
      <g data-part="fx">
        <path
          d="M 58.98,50.39 L 55.73,51.12 C55.43,51.19 55.24,51.42 55.24,51.74 V 54.94 C 55.24,55.41 55.56,55.65 55.98,55.59 L 59.05,55.19 C59.48,55.13 59.72,54.86 59.72,54.47 V 50.99 C 59.72,50.54 59.41,50.31 58.98,50.39 Z"
          fill="#0066D8"
          stroke="#0085FF"
          strokeWidth="0.109375"
        />
        <path
          d="M 57.39,51.87 C56.8,51.86 56.5,52.31 56.5,52.78 V 53.47 L 56.23,53.83 C 56.17,53.93 56.25,54.04 56.36,54.04 L 58.41,53.89 C 58.54,53.88 58.58,53.75 58.52,53.65 L58.26,53.3 V 52.74 C 58.26,52.29 57.9,51.87 57.39,51.87 Z"
          fill="#66F7FF"
          stroke="#00B3FF"
          strokeWidth="0.109375"
        />
        <circle
          cx="57.3555"
          cy="51.7617"
          r="0.183594"
          fill="#66F7FF"
          stroke="#00B3FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 57.03,54.15 C 56.91,54.36 57.09,54.7 57.37,54.7 C 57.66,54.7 57.83,54.36 57.75,54.15 H 57.03 Z"
          fill="#66F7FF"
          stroke="#00B3FF"
          strokeWidth="0.09375"
        />
        <circle
          cx="54.7539"
          cy="54.3633"
          r="0.214844"
          fill="#50D5FF"
          stroke="#0044C4"
          strokeWidth="0.109375"
        />
        <circle
          cx="54.2305"
          cy="54.8945"
          r="0.195312"
          fill="#50D5FF"
          stroke="#0044C4"
          strokeWidth="0.109375"
        />
        <circle
          cx="53.6758"
          cy="55.2656"
          r="0.164062"
          fill="#50D5FF"
          stroke="#0044C4"
          strokeWidth="0.078125"
        />
      </g>
      </g>
    </svg>
  );
}
