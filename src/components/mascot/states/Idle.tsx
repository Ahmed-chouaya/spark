/**
 * Idle — Calm resting face, no accessory.
 *
 * Extracted from the 12-cell sheet, cell (1,0)
 * labelled "READY".
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function Idle(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint4`}
          x1="1.9375"
          y1="44.3516"
          x2="20.2031"
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
        <linearGradient id={`${uid}Paint20`}
          x1="10.7734"
          y1="33.6875"
          x2="10.7734"
          y2="44.2461"
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
        <linearGradient id={`${uid}Paint21`}
          x1="11.4453"
          y1="36.0547"
          x2="11.4453"
          y2="44.2305"
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
      <g transform={stateTransform("idle")}>
      <g data-part="glow">
        <ellipse
          cx="11.0703"
          cy="44.3516"
          rx="9.13281"
          ry="0.71875"
          fill={`url(#${uid}Paint4)`}
        />
      </g>
      <g data-part="body">
        <ellipse
          cx="9.69531"
          cy="33.4414"
          rx="0.421875"
          ry="0.292969"
          fill="#00E7FF"
          transform="rotate(-30.6486 9.69531 33.4414)"
        />
        <path
          d="M 16.52,38.41 C 16.77,36.45 15.63,35.27 13.31,35.27 C 11.35,35.27 9.38,35.19 9.35,33.69 C 7.53,34.22 6.62,35.56 6.38,37.09 C 6.12,38.8 4.62,39.69 4.62,41.32 C 4.62,43.14 6.35,44.26 8.77,44.26 H 13.29 C 15.72,44.26 16.99,43.12 16.99,41.53 C 16.99,40.22 16.37,39.65 16.52,38.41 Z"
          fill="#F94DFF"
          stroke="#8200FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 9.35,33.69 C 7.53,34.22 6.62,35.56 6.38,37.09 C 6.12,38.8 4.62,39.69 4.62,41.32 C 4.62,43.14 6.35,44.26 8.77,44.26 C 10.31,44.26 10.7,44.15 10.7,44.15 C 7.69,44.19 6.3,43.26 6.3,41.49 C 6.3,38.51 8.47,36.09 11.45,36.09 C 13.56,36.09 15.09,37.17 15.82,38.62 C17.03,36.34 15.44,35.27 13.31,35.27 C 11.35,35.27 9.38,35.19 9.35,33.69 Z"
          fill={`url(#${uid}Paint20)`}
        />
        <path
          d="M 11.56,36.07 C 8.47,36.07 6.29,38.66 6.29,41.39 C 6.29,43.58 8.1,44.23 10.93,44.23 C 14.66,44.23 16.13,43.58 16.13,41.39 C 16.13,38.32 14.21,36.07 11.56,36.07 Z"
          fill={`url(#${uid}Paint21)`}
          stroke="#0033FF"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="eyes">
        <ellipse
          cx="13.8281"
          cy="40.7148"
          rx="0.804688"
          ry="1.375"
          fill="#88F7FF"
          stroke="#0077FF"
          transform="rotate(-4.49192 13.8281 40.7148)"
          strokeWidth="0.15625"
        />
        <ellipse
          cx="9.91406"
          cy="40.7266"
          rx="0.820312"
          ry="1.38281"
          fill="#66F7FF"
          stroke="#0077FF"
          strokeWidth="0.15625"
        />
      </g>
      </g>
    </svg>
  );
}
