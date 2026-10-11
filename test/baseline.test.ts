import { MASCOT_STATES } from "../src/components/mascot/types";

describe("baseline", () => {
  it("enumerates the state vocabulary", () => {
    expect(Array.isArray(MASCOT_STATES)).toBe(true);
    expect(MASCOT_STATES.length).toBeGreaterThan(0);
  });
});
