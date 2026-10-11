import { test } from "@e2e-dev/web";
import { expect } from "e2e";

/**
 * End-to-end checks for the escalation surface.
 *
 * These run against the real page in a real browser, which is the only place
 * two of this change's claims can actually be checked:
 *
 * - **Focus.** Whether the surface takes the keyboard is a question about the
 *   browser and the compositor, not about jsdom, which has neither.
 * - **Capability.** Which idle behaviour this machine gets is a question about
 *   its compositor. The page reports the answer it received, so a run can assert
 *   against the real probe rather than a stubbed one.
 *
 * The rest is the round trip — arrival, decision, resolution — driven through
 * controls on the page, which is the way a person drives it.
 */

const PAGE = "/surface.html";

test("app opens", async ({ app, screen }) => {
  await app.open(PAGE);
  await expect(screen.getByRole("heading", "Escalation surface")).toBeVisible();
});

test("nothing is on screen when nothing is blocked", async ({ app, screen }) => {
  await app.open(PAGE);
  await expect(screen.getByTestId("escalating")).toHaveText("false");
});

test("a block brings the surface up with a decision", async ({ app, screen }) => {
  await app.open(PAGE);

  await expect(screen.getByTestId("escalation-surface")).toBeHidden();
  await screen.getByTestId("block").click();

  await expect(screen.getByTestId("escalation-surface")).toBeVisible();
  await expect(screen.getByTestId("escalating")).toHaveText("true");
  await expect(screen.getByTestId("decision-surface")).toBeVisible();
});

test("the decision names the operation and its session", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("block").click();

  await expect(screen.getByTestId("decision-operation")).toHaveText("run `npm publish`");
  await expect(screen.getByTestId("decision-session-id")).toHaveText("spark");
});

test("exactly two answers are offered", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("block").click();

  await expect(screen.getByTestId("decision-allow")).toBeVisible();
  await expect(screen.getByTestId("decision-deny")).toBeVisible();

  // Nothing that persists. "Always allow" is a permissions-policy decision and
  // is deliberately absent from this card, so a run that finds one has found a
  // regression rather than a feature.
  await expect(screen.getByRole("button", { name: "Allow" })).toHaveCount(1);
  await expect(screen.getByText(/always/i)).toHaveCount(0);
  await expect(screen.getByText(/remember/i)).toHaveCount(0);
});

test("the whole round trip: arrival, decision, resolution", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("block").click();
  await expect(screen.getByTestId("decision-surface")).toBeVisible();

  await screen.getByTestId("decision-deny").click();

  await expect(screen.getByTestId("escalating")).toHaveText("false");
  await expect(screen.getByTestId("decision-surface")).toBeHidden();
  await expect(screen.getByTestId("pending")).toHaveText("0");
});

test("a block the companion cannot resolve stays quiet", async ({ app, screen }) => {
  await app.open(PAGE);

  await screen.getByTestId("question").click();

  // An agent question has no answer the companion can give, so nothing is
  // brought to the user: not a card, and no escalation either.
  await expect(screen.getByTestId("escalating")).toHaveText("false");
  await expect(screen.getByTestId("decision-surface")).toBeHidden();
});

test("the ambient surface does not take focus", async ({ app, screen }) => {
  // The platform that can hold a persistent surface is the one where an ambient
  // surface exists at all, so that is the branch this has to be checked on. On
  // the other branch there is nothing ambient to take focus, which is the point.
  await app.open(`${PAGE}?platform=persistent`);
  await expect(screen.getByTestId("escalation-surface")).toBeVisible();

  // Ambient on arrival, and the surface is not what holds the keyboard.
  await expect(screen.getByTestId("escalating")).toHaveText("false");
  await expect(screen.getByTestId("escalation-surface")).not.toBeFocused();

  // Escalate, answer, and the surface goes back to ambient on this platform.
  await screen.getByTestId("block").click();
  await expect(screen.getByTestId("decision-surface")).toBeVisible();
  await screen.getByTestId("decision-deny").click();

  // Ambient again, still on screen — and still not the focused thing. A window
  // that grabs the keyboard to report that nothing is happening is exactly what
  // this product exists not to be.
  await expect(screen.getByTestId("escalating")).toHaveText("false");
  await expect(screen.getByTestId("escalation-surface")).toBeVisible();
  await expect(screen.getByTestId("escalation-surface")).not.toBeFocused();
});

test("this machine's own capability is reported by the page", async ({ app, screen }) => {
  // Run without an override, so the page is asking this machine's compositor.
  // The probe has to answer, and the answer has to be stable across a reload —
  // a capability that changed between loads would be a probe reading something
  // it should not.
  await app.open(PAGE);
  await screen.getByTestId("block").click();
  await expect(screen.getByTestId("decision-surface")).toBeVisible();

  await app.open(PAGE);
  await screen.getByTestId("block").click();
  await expect(screen.getByTestId("decision-surface")).toBeVisible();
});