/**
 * Alert — Hot red shell with amber alert rays.
 *
 * Extracted from the 12-cell sheet, cell (1,3)
 * labelled "ERROR".
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function Alert(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint7`}
          x1="61.5938"
          y1="44.3516"
          x2="79.8594"
          y2="44.3516"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stopColor="#FF0033"
            stopOpacity="0"
          />
          <stop
            offset="0.494792"
            stopColor="#FF0077"
            stopOpacity="0.505208"
          />
          <stop
            offset="1"
            stopColor="#FF0033"
            stopOpacity="0"
          />
        </linearGradient>
        <linearGradient id={`${uid}Paint26`}
          x1="69.9844"
          y1="34.125"
          x2="69.9844"
          y2="44.375"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0.28125"
            stopColor="#00F9FF"
          />
          <stop
            offset="0.53125"
            stopColor="#FFD970"
          />
          <stop
            offset="0.78125"
            stopColor="#FF804D"
          />
          <stop
            offset="1"
            stopColor="#FFFF66"
          />
        </linearGradient>
        <linearGradient id={`${uid}Paint27`}
          x1="70.2656"
          y1="36.4805"
          x2="70.2656"
          y2="44.3438"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stopColor="#5077FF"
          />
          <stop
            offset="0.4375"
            stopColor="#001347"
          />
          <stop
            offset="1"
            stopColor="#00072A"
          />
        </linearGradient>
      </defs>
      <g transform={stateTransform("alert")}>
      <g data-part="glow">
        <ellipse
          cx="70.7266"
          cy="44.3516"
          rx="9.13281"
          ry="0.71875"
          fill={`url(#${uid}Paint7)`}
        />
      </g>
      <g data-part="body">
        <ellipse
          cx="68.3828"
          cy="33.8828"
          rx="0.40625"
          ry="0.289062"
          fill="#00F9FF"
          transform="rotate(-29.2047 68.3828 33.8828)"
        />
        <path
          d="M 75.31,38.89 C 75.64,36.77 74.39,35.6 72.11,35.6 C 70.09,35.6 68.13,35.59 68.04,34.13 C66.17,34.67 65.25,36.09 65.09,37.66 C 64.96,39.12 63.51,39.94 63.51,41.65 C 63.51,43.38 65.15,44.37 67.24,44.37 H 72.42 C74.77,44.37 75.98,43.34 75.98,41.93 C 75.98,40.6 75.15,39.92 75.31,38.89 Z"
          fill="#FF7370"
          stroke="#FF3366"
          strokeWidth="0.078125"
        />
        <path
          d="M 68.04,34.13 C 66.17,34.67 65.25,36.09 65.09,37.66 C 64.96,39.12 63.51,39.94 63.51,41.65 C 63.51,43.38 65.15,44.37 67.24,44.37 C68.72,44.37 69.12,44.28 69.12,44.28 C 66.25,44.34 65.08,43.47 65.08,41.78 C 65.08,38.78 67.23,36.43 70.21,36.43 C72.25,36.43 73.83,37.37 74.69,38.76 C75.68,36.54 74.14,35.6 72.11,35.6 C 70.09,35.6 68.13,35.59 68.04,34.13 Z"
          fill={`url(#${uid}Paint26)`}
        />
        <path
          d="M 70.38,36.48 C 67.25,36.48 65.15,38.87 65.15,41.63 C 65.15,43.76 66.7,44.34 69.39,44.34 H 70.81 C74.13,44.34 75.17,43.51 75.17,41.63 C 75.17,38.73 73.06,36.48 70.38,36.48 Z"
          fill={`url(#${uid}Paint27)`}
          stroke="#FF4D91"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="eyes">
        <ellipse
          cx="72.9102"
          cy="40.6758"
          rx="0.742188"
          ry="1.35156"
          fill="#88F7FF"
          stroke="#0077FF"
          transform="rotate(-9.38813 72.9102 40.6758)"
          strokeWidth="0.15625"
        />
        <ellipse
          cx="69.1133"
          cy="40.9141"
          rx="0.859375"
          ry="1.38281"
          fill="#66F7FF"
          stroke="#0077FF"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="fx">
        <path
          d="M 76.48,34.11 L 75.55,35.81"
          stroke="#FFB54D"
          strokeWidth="0.515625"
          strokeLinecap="round"
        />
        <path
          d="M 77.87,36.17 L76.45,37.15"
          stroke="#FFC84D"
          strokeWidth="0.515625"
          strokeLinecap="round"
        />
        <path
          d="M 78.04,38.51 L76.72,38.57"
          stroke="#FFD350"
          strokeWidth="0.46875"
          strokeLinecap="round"
        />
      </g>
      </g>
    </svg>
  );
}
