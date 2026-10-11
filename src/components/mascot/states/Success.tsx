/**
 * Success — Green celebration sparks.
 *
 * Extracted from the 12-cell sheet, cell (0,3)
 * labelled "SUCCESS".
 *
 * Renders into the shared canonical canvas, positioned by its derived anchor.
 */
import type { MascotVectorInternalProps } from "../types";
import { usePaintId } from "../paint";
import { CANVAS_VIEWBOX, stateTransform } from "../canvas";

export function Success(props: MascotVectorInternalProps) {
  const uid = usePaintId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CANVAS_VIEWBOX}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}Paint0`}
          x1="64.9375"
          y1="26.8311"
          x2="78.6826"
          y2="26.8311"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stopColor="#00B4F9"
            stopOpacity="0"
          />
          <stop
            offset="0.494792"
            stopColor="#00F9C4"
            stopOpacity="0.505208"
          />
          <stop
            offset="1"
            stopColor="#00B4F9"
            stopOpacity="0"
          />
        </linearGradient>
        <linearGradient id={`${uid}Paint18`}
          x1="69.8164"
          y1="16.4336"
          x2="69.8164"
          y2="26.7988"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0.28125"
            stopColor="#00F9F9"
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
        <linearGradient id={`${uid}Paint19`}
          x1="70.2812"
          y1="18.7617"
          x2="70.2812"
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
      <g transform={stateTransform("success")}>
      <g data-part="glow">
        <ellipse
          cx="71.8105"
          cy="26.8311"
          rx="6.87207"
          ry="0.71875"
          fill={`url(#${uid}Paint0)`}
        />
      </g>
      <g data-part="body">
        <ellipse
          cx="67.9258"
          cy="16.1758"
          rx="0.414062"
          ry="0.285156"
          fill="#00F9F9"
          transform="rotate(-31.8317 67.9258 16.1758)"
        />
        <path
          d="M 74.87,21.21 C 75.09,19.21 73.82,17.97 71.58,17.97 C 69.68,17.97 67.8,17.93 67.69,16.43 C65.91,16.95 65.08,18.32 64.91,19.87 C 64.75,21.58 63.56,22.41 63.56,23.93 C 63.56,25.68 65.21,26.79 67.62,26.79 H 71.94 C74.34,26.79 75.54,25.61 75.54,24.19 C 75.54,22.92 74.76,22.38 74.87,21.21 Z"
          fill="#F94DFF"
          stroke="#8200FF"
          strokeWidth="0.078125"
        />
        <path
          d="M 67.69,16.43 C 65.91,16.95 65.08,18.32 64.91,19.87 C 64.75,21.58 63.56,22.41 63.56,23.93 C 63.56,25.68 65.21,26.79 67.62,26.79 C69.39,26.79 69.74,26.7 69.74,26.7 C 66.67,26.75 65.26,25.93 65.26,24.12 C 65.26,21.08 67.28,18.77 70.23,18.77 C72.26,18.77 73.69,19.76 74.52,21.19 C75.29,19.09 73.78,17.97 71.58,17.97 C 69.68,17.97 67.8,17.93 67.69,16.43 Z"
          fill={`url(#${uid}Paint18)`}
        />
        <path
          d="M 70.35,18.77 C 67.3,18.77 65.33,21.21 65.33,23.94 C 65.33,26.15 66.91,26.74 69.71,26.74 C 73.41,26.74 74.7,26.1 74.7,23.94 C 74.7,20.95 72.89,18.77 70.35,18.77 Z"
          fill={`url(#${uid}Paint19)`}
          stroke="#0033FF"
          strokeWidth="0.15625"
        />
      </g>
      <g data-part="eyes">
        <ellipse
          cx="72.1875"
          cy="23.0352"
          rx="0.773438"
          ry="1.40625"
          fill="#88F7FF"
          stroke="#0077FF"
          transform="rotate(-3.42794 72.1875 23.0352)"
          strokeWidth="0.117188"
        />
        <ellipse
          cx="68.6641"
          cy="23.0586"
          rx="0.820312"
          ry="1.41406"
          fill="#66F7FF"
          stroke="#0077FF"
          strokeWidth="0.117188"
        />
      </g>
      <g data-part="fx">
        <path
          d="M 75.25,15.76 L 74.63,17.46"
          stroke="#4DFFB6"
          strokeWidth="0.515625"
          strokeLinecap="round"
        />
        <path
          d="M 77.12,17.39 L 75.67,18.58"
          stroke="#62FFBF"
          strokeWidth="0.515625"
          strokeLinecap="round"
        />
        <path
          d="M 77.59,19.73 L 76.19,19.96"
          stroke="#80FFB8"
          strokeWidth="0.515625"
          strokeLinecap="round"
        />
      </g>
      </g>
    </svg>
  );
}
