import { expectTypeOf } from "vitest";
import type { MascotProps, MascotVectorProps } from "../src/components/mascot/types";

describe("accepted props", () => {
  it("does not accept a caller-supplied canvas declaration", () => {
    // A caller passing viewBox is a compile error, by design.
    expectTypeOf<MascotProps>().not.toHaveProperty("viewBox");
    expectTypeOf<MascotVectorProps>().not.toHaveProperty("viewBox");
  });

  it("accepts an explicit accessible name", () => {
    expectTypeOf<{ "aria-label": string }>().toExtend<MascotProps>();
  });

  it("accepts every state name and rejects a retired one", () => {
    expectTypeOf<{ state: "focused" }>().toExtend<MascotProps>();
    expectTypeOf<{ state: "needsYou" }>().toExtend<MascotProps>();
    expectTypeOf<{ state: "shy" }>().not.toExtend<MascotProps>();
  });
});
