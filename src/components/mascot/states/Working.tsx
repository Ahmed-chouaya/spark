/**
 * Working — Orbital ring with a particle stream.
 *
 * Extracted from the 12-cell sheet, cell (0,1)
 * labelled "PROCESSING".
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function Working(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint2`}
          x1="22.2148"
          y1="26.8311"
          x2="40.4805"
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
        <linearGradient id={`${uid}Paint14`}
          x1="30.5859"
          y1="16.1875"
          x2="30.5859"
          y2="26.7461"
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
        <linearGradient id={`${uid}Paint15`}
          x1="31.2539"
          y1="18.6953"
          x2="31.2539"
          y2="26.7188"
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
      <g transform={stateTransform("working")}>
      <g data-part="glow">
        <ellipse
          cx="31.3477"
          cy="26.8311"
          rx="9.13281"
          ry="0.71875"
          fill={`url(#${uid}Paint2)`}
        />
      </g>
      <g data-part="body">
        <ellipse
          cx="29.9258"
          cy="15.8945"
          rx="0.421875"
          ry="0.28125"
          fill="#00E7FF"
          transform="rotate(-30.1332 29.9258 15.8945)"
        />
        <path
          d="M 36.19,20.96 C 36.48,19.12 35.28,17.74 32.96,17.74 C 31.32,17.74 29.6,17.59 29.58,16.19 C 27.88,16.62 27.01,17.91 26.74,19.41 C 26.45,21.14 24.99,21.96 24.99,23.48 C 24.99,25.42 26.68,26.77 29.6,26.77 H 32.66 C35.32,26.77 36.67,25.66 36.67,24.17 C 36.67,22.79 36.01,22.13 36.19,20.96 Z"
          fill="#F94DFF"
          stroke="#8200FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 29.58,16.19 C 27.88,16.62 27.01,17.91 26.74,19.41 C 26.45,21.14 24.99,21.96 24.99,23.48 C 24.99,25.42 26.68,26.77 29.6,26.77 C 31.04,26.72 31.15,26.62 31.15,26.62 C 27.86,26.72 26.41,25.79 26.41,23.97 C 26.41,21.13 28.49,18.65 31.42,18.65 C 33.5,18.65 34.87,19.68 35.65,21.16 C36.66,19.11 35.14,17.74 32.96,17.74 C 31.32,17.74 29.6,17.59 29.58,16.19 Z"
          fill={`url(#${uid}Paint14)`}
        />
        <path
          d="M 31.52,18.69 C 28.42,18.69 26.38,21.24 26.38,23.82 C 26.38,26.02 28.21,26.72 30.92,26.72 C 34.41,26.72 35.9,26.06 35.9,23.82 C 35.9,20.88 34.11,18.69 31.52,18.69 Z"
          fill={`url(#${uid}Paint15)`}
          stroke="#0033FF"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="eyes">
        <ellipse
          cx="33.6055"
          cy="22.8555"
          rx="0.734375"
          ry="1.30859"
          fill="#88F7FF"
          stroke="#0077FF"
          transform="rotate(-6.53061 33.6055 22.8555)"
          strokeWidth="0.117188"
        />
        <ellipse
          cx="30.0859"
          cy="22.9766"
          rx="0.789062"
          ry="1.38281"
          fill="#66F7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
      </g>
      <g data-part="fx">
        <circle
          cx="37.3125"
          cy="20.4023"
          r="0.28125"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
        <circle
          cx="24.9102"
          cy="20.7539"
          r="0.261719"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
        <circle
          cx="25.6719"
          cy="20.6523"
          r="0.140625"
          fill="#66E7FF"
        />
        <circle
          cx="38.5586"
          cy="21.0586"
          r="0.261719"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
        <circle
          cx="23.7148"
          cy="21.3281"
          r="0.230469"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
        <path
          d="M 25.82,21.6 C 23.78,21.83 22.52,22.38 22.52,23.01 C 22.52,24.05 26.22,24.76 30.63,24.76 C 35.5,24.76 39.31,23.85 39.31,22.81 C 39.31,22.13 37.96,21.65 36.26,21.49"
          stroke="#28B5FF"
          strokeWidth="0.3125"
        />
        <path
          d="M 25.77,21.72 C 23.79,22.03 22.78,22.49 22.78,22.98 C 22.78,23.91 26.35,24.62 30.51,24.62 C 35.35,24.62 39.08,23.69 39.08,22.77 C 39.08,22.23 37.9,21.79 36.43,21.62"
          stroke="#98E9FF"
          strokeWidth="0.15625"
        />
        <circle
          cx="23.1406"
          cy="21.9336"
          r="0.183594"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.078125"
        />
        <circle
          cx="39.0547"
          cy="24.0703"
          r="0.183594"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.078125"
        />
        <circle
          cx="39.1367"
          cy="24.1445"
          r="0.121094"
          fill="#66E7FF"
        />
        <circle
          cx="38.5352"
          cy="24.3828"
          r="0.203125"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.078125"
        />
        <circle
          cx="22.9414"
          cy="24.3398"
          r="0.144531"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.0546875"
        />
        <circle
          cx="23.3203"
          cy="24.5938"
          r="0.195312"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.078125"
        />
        <circle
          cx="37.4414"
          cy="25.0117"
          r="0.253906"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
        <circle
          cx="24.4102"
          cy="25.1836"
          r="0.273438"
          fill="#66E7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
        <circle
          cx="25.1758"
          cy="25.3398"
          r="0.136719"
          fill="#66E7FF"
        />
      </g>
      </g>
    </svg>
  );
}
