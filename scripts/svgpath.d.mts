export interface PathBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of a path's control-point hull, in absolute coordinates. */
export declare function pathBBoxAbs(d: string): PathBox;
