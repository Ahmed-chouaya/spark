/**
 * Listening — Converging signal brackets and dot trails.
 *
 * Extracted from the 12-cell sheet, cell (0,2)
 * labelled "SEARCHING".
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function Listening(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint3`}
          x1="42.4922"
          y1="26.8311"
          x2="60.7578"
          y2="26.8311"
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
        <linearGradient id={`${uid}Paint16`}
          x1="49.957"
          y1="16.4336"
          x2="49.957"
          y2="26.7988"
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
        <linearGradient id={`${uid}Paint17`}
          x1="50.8633"
          y1="18.7461"
          x2="50.8633"
          y2="26.7461"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stopColor="#2950C4"
          />
          <stop
            offset="0.510417"
            stopColor="#001146"
          />
          <stop
            offset="1"
            stopColor="#000A33"
          />
        </linearGradient>
      </defs>
      <g transform={stateTransform("listening")}>
      <g data-part="glow">
        <ellipse
          cx="51.625"
          cy="26.8311"
          rx="9.13281"
          ry="0.71875"
          fill={`url(#${uid}Paint3)`}
        />
      </g>
      <g data-part="body">
        <ellipse
          cx="48.7813"
          cy="16.1875"
          rx="0.40625"
          ry="0.28125"
          fill="#00E7FF"
          transform="rotate(-34.4322 48.7813 16.1875)"
        />
        <path
          d="M 55.56,21.25 C 55.79,19.25 54.65,17.87 52.36,17.87 C 50.49,17.87 48.54,17.85 48.51,16.43 C46.84,16.94 45.96,18.3 45.79,19.84 C 45.61,21.65 44.32,22.58 44.32,24.08 C 44.32,25.7 45.82,26.78 48.2,26.78 H 52.69 C55.07,26.78 56.26,25.61 56.26,24.19 C 56.26,22.89 55.44,22.41 55.56,21.25 Z"
          fill="#F94DFF"
          stroke="#8200FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 48.51,16.43 C 46.84,16.94 45.96,18.3 45.79,19.84 C 45.61,21.65 44.32,22.58 44.32,24.08 C 44.32,25.7 45.82,26.78 48.2,26.78 C 49.8,26.78 50.13,26.69 50.13,26.69 C 47.28,26.74 45.91,25.94 45.91,24.19 C 45.91,21.2 47.93,18.71 50.88,18.71 C52.93,18.71 54.4,19.74 55.21,21.18 C56.11,19.14 54.6,17.87 52.36,17.87 C 50.49,17.87 48.54,17.85 48.51,16.43 Z"
          fill={`url(#${uid}Paint16)`}
        />
        <path
          d="M 50.86,18.75 C 47.85,18.75 45.86,21.34 45.86,24.05 C 45.86,26.14 47.47,26.74 50.19,26.74 C 54.08,26.74 55.51,26.15 55.51,24.05 C 55.51,21.09 53.57,18.75 50.86,18.75 Z"
          fill={`url(#${uid}Paint17)`}
          stroke="#0033FF"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="eyes">
        <ellipse
          cx="53.457"
          cy="22.9531"
          rx="0.742188"
          ry="1.3125"
          fill="#88F7FF"
          stroke="#0077FF"
          transform="rotate(-13.4936 53.457 22.9531)"
          strokeWidth="0.117188"
        />
        <ellipse
          cx="49.4648"
          cy="23.1055"
          rx="0.84375"
          ry="1.35547"
          fill="#66F7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
      </g>
      <g data-part="fx">
        <path
          d="M 43.28,21.09 L 42.59,21.78 L 43.28,22.52"
          stroke="#31D7FF"
          strokeWidth="0.390625"
          strokeLinecap="round"
        />
        <path
          d="M 58.03,21.09 L 58.74,21.81 L 58.03,22.53"
          stroke="#20D5FF"
          strokeWidth="0.390625"
          strokeLinecap="round"
        />
        <circle
          cx="57.0156"
          cy="21.8281"
          r="0.164062"
          fill="#50D5FF"
        />
        <circle
          cx="43.6836"
          cy="21.8281"
          r="0.15625"
          fill="#50D5FF"
        />
        <circle
          cx="56.3438"
          cy="21.8281"
          r="0.15625"
          fill="#50D5FF"
        />
        <circle
          cx="57.7344"
          cy="21.8281"
          r="0.15625"
          fill="#50D5FF"
        />
        <circle
          cx="44.1719"
          cy="21.8281"
          r="0.148438"
          fill="#50D5FF"
        />
        <circle
          cx="44.7188"
          cy="21.8164"
          r="0.121094"
          fill="#50D5FF"
        />
      </g>
      </g>
    </svg>
  );
}
