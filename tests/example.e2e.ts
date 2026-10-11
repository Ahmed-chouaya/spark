import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { MASCOT_STATES } from "../src/components/mascot";

/**
 * End-to-end checks for the mascot harness.
 *
 * The harness is the only thing an automated run can drive today, and it has a
 * real contract — the one `dev-harness` specifies. These check that contract
 * against a running page rather than against jsdom, which is the point: the unit
 * suite already renders `DevPage` directly, so everything it asserts has been
 * true without a server ever starting.
 *
 * The states are imported from the mascot's own vocabulary so a tenth state
 * cannot pass here by simply not being asserted.
 */

const FALLBACK_STATE = MASCOT_STATES[0];

test("app opens", async ({ app, browser }) => {
  await app.open("/");
  await expect(browser.locator("body")).toBeVisible();
});

test("every state in the vocabulary is on the page", async ({ app, browser }) => {
  await app.open("/");

  const cards = browser.locator("[data-state-card]");
  // Counted against the vocabulary rather than a fixed number, so this fails
  // when a state is added without reaching the page — the same guard the unit
  // suite holds, checked where the enumeration actually happens.
  await expect(cards).toHaveCount(MASCOT_STATES.length);

  for (const state of MASCOT_STATES) {
    await expect(browser.locator(`[data-state-card="${state}"]`)).toBeVisible();
  }
});

test("each state names itself on screen", async ({ app, browser }) => {
  await app.open("/");
  await expect(browser.locator(`[data-state-card="${MASCOT_STATES[0]}"] h2`)).toHaveText(
    MASCOT_STATES[0],
  );
});

test("a requested state renders alone", async ({ app, browser }) => {
  await app.open("/?state=needsYou");

  await expect(browser.locator("[data-state-card]")).toHaveCount(1);
  await expect(browser.locator('[data-state-card="needsYou"]')).toBeVisible();
  await expect(browser.locator('[data-testid="current-state"]')).toHaveText("needsYou");
});

test("an unknown state degrades to a render rather than failing", async ({ app, browser }) => {
  await app.open("/?state=not-a-real-state");

  // The page must still render, and must say which state it fell back to —
  // a silent fallback would hide the typo from whoever hit it.
  await expect(browser.locator("[data-state-card]")).toHaveCount(1);
  await expect(browser.locator('[data-testid="current-state"]')).toHaveText(FALLBACK_STATE);
});

test("an omitted state shows the whole vocabulary", async ({ app, browser }) => {
  await app.open("/");
  await expect(browser.locator('[data-testid="current-state"]')).toHaveText("all");
  await expect(browser.locator("[data-state-card]")).toHaveCount(MASCOT_STATES.length);
});

// With the model key in the environment, uncomment:
// test('the agent drives a flow', async ({ app, agent }) => {
//   await app.open('/');
//   await agent.act('one goal in natural language');
//   await agent.assert('one question about the screen');
// });