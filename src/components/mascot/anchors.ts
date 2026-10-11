/**
 * Per-state anchors, derived from the artwork by `scripts/extract-anchors.mjs`.
 *
 * Generated file: do not edit by hand. Re-run the extraction step instead —
 * `test/anchors.test.ts` re-derives from source and fails if this drifts.
 */
import type { MascotState } from "./types";

export interface StateAnchor {
  /** Horizontal centre of the visor, in source coordinates. */
  visorCx: number;
  /** Vertical position of the floor line, in source coordinates. */
  groundCy: number;
  /** Bounding box of all rendered content, in source coordinates. */
  content: { minX: number; minY: number; maxX: number; maxY: number };
}

export const ANCHORS: Record<MascotState, StateAnchor> = {
  alert: {
    visorCx: 70.16,
    groundCy: 44.3516,
    content: { minX: 61.59379, minY: 33.593738, maxX: 79.85941, maxY: 45.07035 },
  },
  focused: {
    visorCx: 31.235,
    groundCy: 44.3516,
    content: { minX: 22.21489, minY: 35.640638, maxX: 40.48051, maxY: 45.07035 },
  },
  idle: {
    visorCx: 11.21,
    groundCy: 44.3516,
    content: { minX: 1.93749, minY: 33.148431, maxX: 20.20311, maxY: 45.07035 },
  },
  listening: {
    visorCx: 50.685,
    groundCy: 26.8311,
    content: { minX: 42.394688, minY: 15.90625, maxX: 60.75781, maxY: 27.54985 },
  },
  needsYou: {
    visorCx: 49.01,
    groundCy: 63.1406,
    content: { minX: 40.95309, minY: 50.255313, maxX: 59.774688, maxY: 63.85935 },
  },
  success: {
    visorCx: 70.015,
    groundCy: 26.8311,
    content: { minX: 63.520938, minY: 15.502188, maxX: 78.68257, maxY: 27.54985 },
  },
  thinking: {
    visorCx: 11.24,
    groundCy: 26.8311,
    content: { minX: 1.93749, minY: 13.902362, maxX: 20.20311, maxY: 27.54985 },
  },
  tired: {
    visorCx: 70.27,
    groundCy: 63.1406,
    content: { minX: 61.59379, minY: 52.170938, maxX: 79.85941, maxY: 63.85935 },
  },
  working: {
    visorCx: 31.14,
    groundCy: 26.8311,
    content: { minX: 22.21489, minY: 15.61325, maxX: 40.48051, maxY: 27.54985 },
  },
};
