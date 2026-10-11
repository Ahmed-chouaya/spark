/**
 * Thinking — Thought-bubble trail rising off the head.
 *
 * Extracted from the 12-cell sheet, cell (0,0)
 * labelled "THINKING".
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function Thinking(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint1`}
          x1="1.9375"
          y1="26.8311"
          x2="20.2031"
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
        <linearGradient id={`${uid}Paint12`}
          x1="10.4805"
          y1="16.4336"
          x2="10.4805"
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
        <linearGradient id={`${uid}Paint13`}
          x1="11.6406"
          y1="18.7656"
          x2="11.6406"
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
      <g transform={stateTransform("thinking")}>
      <g data-part="glow">
        <ellipse
          cx="11.0703"
          cy="26.8311"
          rx="9.13281"
          ry="0.71875"
          fill={`url(#${uid}Paint1)`}
        />
      </g>
      <g data-part="body">
        <path
          d="M 16.05,20.96 C 16.15,19.2 15.04,17.86 12.78,17.86 C 11.21,17.86 9.49,17.86 9.38,16.43 C 7.7,16.97 6.79,18.35 6.58,19.91 C 6.35,21.72 5.02,22.51 5.02,24.09 C 5.02,25.67 6.44,26.8 8.77,26.8 H 13.17 C 15.55,26.8 16.76,25.64 16.76,24.24 C 16.76,22.81 15.98,22.25 16.05,20.96 Z"
          fill="#F94DFF"
          stroke="#8200FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 9.38,16.43 C 7.7,16.97 6.79,18.35 6.58,19.91 C 6.35,21.72 5.02,22.51 5.02,24.09 C 5.02,25.67 6.44,26.8 8.77,26.8 C 10.94,26.8 11.03,26.69 11.03,26.69 C 8.18,26.75 6.57,25.98 6.57,24.19 C 6.57,21.34 8.57,18.8 11.52,18.8 C 13.63,18.8 14.9,19.94 15.59,21.29 C 16.3,19.31 14.98,17.86 12.78,17.86 C 11.21,17.86 9.49,17.86 9.38,16.43 Z"
          fill={`url(#${uid}Paint12)`}
        />
        <path
          d="M 11.65,18.77 C 8.61,18.77 6.58,21.4 6.58,24.16 C 6.58,26.13 8.19,26.75 10.98,26.75 C 14.33,26.75 15.9,26.2 15.9,23.95 C 15.9,21.13 14.29,18.77 11.65,18.77 Z"
          fill={`url(#${uid}Paint13)`}
          stroke="#0033FF"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="eyes">
        <ellipse
          cx="13.8906"
          cy="21.8848"
          rx="0.71875"
          ry="1.32812"
          fill="#88F7FF"
          stroke="#0077FF"
          transform="rotate(-17.5928 13.8906 21.8848)"
          strokeWidth="0.117188"
        />
        <ellipse
          cx="10.3398"
          cy="22.4453"
          rx="0.867188"
          ry="1.42188"
          fill="#66F7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
      </g>
      <g data-part="fx">
        <circle
          cx="17.6953"
          cy="14.8633"
          r="0.902344"
          fill="#876BFF"
          stroke="#5519FF"
          strokeWidth="0.117188"
        />
        <circle
          cx="17.7578"
          cy="14.4414"
          r="0.355469"
          fill="#71E2FF"
        />
        <circle
          cx="16.3555"
          cy="16.5781"
          r="0.542969"
          fill="#D67DFF"
          stroke="#6824FF"
          strokeWidth="0.117188"
        />
        <circle
          cx="16.375"
          cy="16.2461"
          r="0.238281"
          fill="#A7F2FF"
        />
        <circle
          cx="15.4102"
          cy="17.6602"
          r="0.253906"
          fill="#F980FF"
          stroke="#7400FF"
          strokeWidth="0.078125"
        />
      </g>
      </g>
    </svg>
  );
}
