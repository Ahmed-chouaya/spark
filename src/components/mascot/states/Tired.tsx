/**
 * Tired — Closed eyes with a crescent moon.
 *
 * Extracted from the 12-cell sheet, cell (2,3)
 * labelled "DO NOT DISTURB".
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function Tired(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint11`}
          x1="61.5938"
          y1="63.1406"
          x2="79.8594"
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
        <linearGradient id={`${uid}Paint34`}
          x1="70.2031"
          y1="53.5859"
          x2="70.2031"
          y2="63.0781"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0.28125"
            stopColor="#00E5FF"
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
        <linearGradient id={`${uid}Paint35`}
          x1="70.4375"
          y1="55.8203"
          x2="70.4375"
          y2="63.0625"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stopColor="#2647AC"
          />
          <stop
            offset="0.484375"
            stopColor="#01124A"
          />
          <stop
            offset="1"
            stopColor="#000938"
          />
        </linearGradient>
      </defs>
      <g transform={stateTransform("tired")}>
      <g data-part="glow">
        <ellipse
          cx="70.7266"
          cy="63.1406"
          rx="9.13281"
          ry="0.71875"
          fill={`url(#${uid}Paint11)`}
        />
      </g>
      <g data-part="body">
        <circle
          cx="68.5938"
          cy="53.3164"
          r="0.335938"
          fill="#00E7FF"
          transform="rotate(-32.3817 68.5938 53.3164)"
        />
        <path
          d="M 75.47,57.93 C 75.61,56.01 74.23,55.02 72.16,55.02 C70.14,55.02 68.31,54.99 68.25,53.59 C66.51,54.03 65.61,55.39 65.38,56.81 C 65.15,58.25 63.69,59.11 63.69,60.54 C 63.69,62.23 65.15,63.09 67.38,63.09 H 72.51 C74.98,63.09 76.22,62.14 76.22,60.67 C 76.22,59.45 75.4,58.81 75.47,57.93 Z"
          fill="#F94DFF"
          stroke="#8200FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 68.25,53.59 C 66.51,54.03 65.61,55.39 65.38,56.81 C 65.15,58.25 63.69,59.11 63.69,60.54 C 63.69,62.23 65.15,63.09 67.38,63.09 C68.91,63.09 69.38,63.01 69.38,63.01 C 66.32,63.11 65.21,62.41 65.21,60.78 C 65.21,57.84 67.38,55.61 70.45,55.61 C72.45,55.61 74.07,56.58 74.91,57.88 C75.76,55.87 74.09,54.96 72.08,55.02 C70.03,55.07 68.29,54.94 68.25,53.59 Z"
          fill={`url(#${uid}Paint34)`}
        />
        <path
          d="M 70.61,55.83 C 67.46,55.83 65.21,58.39 65.21,60.85 C 65.21,62.58 66.5,63.05 68.92,63.06 H 70.93 C74.23,63.08 75.33,62.47 75.33,60.74 C 75.33,58.02 73.21,55.83 70.61,55.83 Z"
          fill={`url(#${uid}Paint35)`}
          stroke="#0033FF"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="eyes">
        <path
          d="M 71.65,60.26 C71.38,60.71 71.91,61.41 72.72,61.41 C 73.6,61.41 74.12,60.61 73.91,60.19 C73.2,60.74 72.42,60.69 71.65,60.26 Z"
          fill="#88F7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
        <path
          d="M 67.34,60.22 C 67.09,60.69 67.68,61.41 68.45,61.41 C69.23,61.41 69.76,60.65 69.58,60.25 C68.86,60.75 68.08,60.66 67.34,60.22 Z"
          fill="#66F7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
      </g>
      <g data-part="fx">
        <path
          d="M 77.32,52.21 C76.46,52.21 75.81,52.86 75.81,53.7 C 75.81,54.54 76.47,55.22 77.31,55.22 C77.94,55.22 78.51,54.81 78.69,54.34 C78.52,54.45 78.32,54.51 78.09,54.51 C77.38,54.51 76.83,54.02 76.83,53.34 C 76.83,52.84 77.03,52.46 77.32,52.21 Z"
          fill="#D68BFF"
          stroke="#8224FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 77.25,52.23 C76.48,52.26 75.95,52.78 75.95,53.52 C 75.95,54.36 76.63,54.96 77.38,54.96 C77.91,54.96 78.46,54.68 78.65,54.34 C78.5,54.42 78.32,54.46 78.11,54.46 C77.31,54.46 76.74,53.96 76.74,53.25 C 76.74,52.77 76.96,52.39 77.25,52.23 Z"
          fill="#B882FF"
          stroke="#6824FF"
          strokeWidth="0.0546875"
        />
      </g>
      </g>
    </svg>
  );
}
