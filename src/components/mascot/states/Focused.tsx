/**
 * Focused — Squinting eyes with strain marks.
 *
 * Extracted from the 12-cell sheet, cell (1,1)
 * labelled "BUSY".
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function Focused(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint5`}
          x1="22.2148"
          y1="44.3516"
          x2="40.4805"
          y2="44.3516"
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
        <linearGradient id={`${uid}Paint22`}
          x1="30.8594"
          y1="36.1562"
          x2="30.8594"
          y2="44.3633"
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
        <linearGradient id={`${uid}Paint23`}
          x1="31.2656"
          y1="38.4805"
          x2="31.2656"
          y2="44.3438"
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
      <g transform={stateTransform("focused")}>
      <g data-part="glow">
        <ellipse
          cx="31.3477"
          cy="44.3516"
          rx="9.13281"
          ry="0.71875"
          fill={`url(#${uid}Paint5)`}
        />
      </g>
      <g data-part="body">
        <ellipse
          cx="30.1719"
          cy="35.9297"
          rx="0.421875"
          ry="0.289062"
          fill="#00E7FF"
          transform="rotate(-22.3911 30.1719 35.9297)"
        />
        <path
          d="M 35.81,40.02 C 35.79,38.48 34.68,37.64 32.82,37.64 C 31.23,37.64 29.75,37.5 29.79,36.16 C28,36.47 27.04,37.69 26.78,39.11 C 26.53,40.55 24.83,41.12 24.83,42.57 C 24.83,43.79 26.1,44.37 27.76,44.37 H 34.41 C36.21,44.37 37.21,43.57 37.21,42.43 C 37.21,41.2 35.83,40.76 35.81,40.02 Z"
          fill="#F94DFF"
          stroke="#8200FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 29.79,36.16 C 28,36.47 27.04,37.69 26.78,39.11 C 26.53,40.55 24.83,41.12 24.83,42.57 C 24.83,43.79 26.1,44.37 27.76,44.37 C 29.02,44.37 29.37,44.28 29.37,44.28 C 27.19,44.31 26.27,43.79 26.27,42.74 C 26.27,40.64 28.5,38.47 31.27,38.47 C33.25,38.47 34.74,39.49 35.54,40.74 C36.35,38.69 34.88,37.64 32.82,37.64 C 31.23,37.64 29.75,37.5 29.79,36.16 Z"
          fill={`url(#${uid}Paint22)`}
        />
        <path
          d="M 31.49,38.49 C 28.54,38.49 26.27,40.77 26.27,42.67 C 26.27,43.97 27.55,44.35 29.58,44.35 H 33.61 C35.43,44.36 36.2,43.8 36.2,42.69 C 36.2,40.65 33.94,38.49 31.49,38.49 Z"
          fill={`url(#${uid}Paint23)`}
          stroke="#0033FF"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="eyes">
        <path
          d="M 34.2,41.47 C 34.7,42.45 34.31,43.62 33.59,43.62 C 32.88,43.62 32.74,42.65 32.85,42.11 L 34.2,41.47 Z"
          fill="#88F7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
        <path
          d="M 28.99,41.55 C 28.5,42.53 28.89,43.68 29.62,43.68 C30.25,43.68 30.49,42.96 30.39,42.26 L 28.99,41.55 Z"
          fill="#88F7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
      </g>
      <g data-part="fx">
        <path
          d="M 37.55,38.21 L36.94,39.19"
          stroke="#50D5FF"
          strokeWidth="0.390625"
          strokeLinecap="round"
        />
        <path
          d="M 24.68,38.25 L25.29,39.22"
          stroke="#50D5FF"
          strokeWidth="0.390625"
          strokeLinecap="round"
        />
        <path
          d="M 38.74,39.7 L 37.69,40.13"
          stroke="#50D5FF"
          strokeWidth="0.390625"
          strokeLinecap="round"
        />
        <path
          d="M 23.58,39.72 L24.59,40.15"
          stroke="#50D5FF"
          strokeWidth="0.390625"
          strokeLinecap="round"
        />
      </g>
      </g>
    </svg>
  );
}
