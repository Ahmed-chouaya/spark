export interface StateAnchor {
  /** Horizontal centre of the visor, in source coordinates. */
  visorCx: number;
  /** Vertical position of the floor line, in source coordinates. */
  groundCy: number;
  /** Bounding box of all rendered content, in source coordinates. */
  content: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Derive one state's anchors from a state component's JSX source. */
export declare function deriveAnchors(src: string): StateAnchor;

/** Derive anchors for every state component in the given directory. */
export declare function deriveAllAnchors(dir?: string): Record<string, StateAnchor>;
