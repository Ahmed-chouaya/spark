import { test } from "@e2e-dev/web";
import { expect } from "e2e";

/**
 * End-to-end checks for the shell.
 *
 * ## What this drives, and what it does not
 *
 * The shell is a native window. A browser engine cannot open one, cannot move
 * one, and cannot be told by one, so **the window itself is not what this run
 * drives.** What it drives is the shell's rendered surface and the calls its
 * runtime made on the way — which is the half that lives in this repository, and
 * the half every requirement about *when* something is on screen is written
 * about. The other half is the platform's, and it is recorded per machine in
 * `shell/README.md` rather than asserted from a browser that knows nothing
 * about it.
 *
 * So `/shell/harness.html` mounts the shell's own runtime — the same hook
 * `shell/src/main.tsx` mounts, against a host that records rather than acts — and
 * the run pushes real hook payloads through the real adapter and the real fold.
 * The mascot that appears is drawn by the same component the window draws.
 *
 * ## Why the payloads are the host's own
 *
 * The buttons send `SessionStart`, `UserPromptSubmit` and a `Notification`
 * carrying a permission prompt, as JSON, exactly as the relay carries them. A
 * harness that handed the runtime a canonical event would be testing the wire
 * between the fold and the surface — which the unit suite already covers — and
 * skipping the half where a payload is translated. That half is the one a real
 * hook goes through.
 */

const PAGE = "/shell/harness.html";

test("app opens", async ({ app, screen }) => {
  await app.open(PAGE);
  await expect(screen.getByRole("heading", "Spark shell")).toBeVisible();
});

test("nothing is on screen before anything has been blocked", async ({ app, screen }) => {
  await app.open(PAGE);

  // The branch this machine gets, and the one the whole capability rule is
  // written around: a platform that cannot hold a persistent surface has nothing
  // on it until there is something to say.
  await expect(screen.getByTestId("escalation-surface")).toBeHidden();
  await expect(screen.getByTestId("window-visible")).toHaveText("false");
  await expect(screen.getByTestId("window-focus-count")).toHaveText("0");
});

test("a session started by the host is folded with nothing supplying it", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("start").click();

  // The state moved, so the payload went through the adapter and the fold. The
  // window stayed shut, because a session that is not blocked is not a reason to
  // interrupt anyone.
  await expect(screen.getByTestId("state")).toHaveText("idle");
  await expect(screen.getByTestId("window-visible")).toHaveText("false");
});

test("a block brings the window up, carrying the blocked mascot", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("start").click();
  await screen.getByTestId("block").click();

  await expect(screen.getByTestId("escalation-surface")).toBeVisible();
  await expect(screen.getByTestId("state")).toHaveText("needsYou");
  await expect(screen.getByTestId("escalating")).toHaveText("true");

  // The window was told, which is the part a browser can see. Whether the
  // compositor then honoured it is the platform's answer, recorded per machine.
  await expect(screen.getByTestId("window-visible")).toHaveText("true");
});

test("the escalating surface differs from the ambient one without colour", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("block").click();

  // Scale and motion, not hue: the requirement is that the distinction survives
  // someone who cannot separate the colours, and this mascot's own vocabulary is
  // already colour-coded.
  await expect(screen.getByTestId("escalation-stage")).toHaveAttribute("style", /scale/);
  await expect(screen.getByTestId("escalation-surface")).toHaveAttribute("data-escalating", "");
});

test("resolving the block takes the window back down", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("start").click();
  await screen.getByTestId("block").click();
  await expect(screen.getByTestId("window-visible")).toHaveText("true");

  await screen.getByTestId("answer").click();

  await expect(screen.getByTestId("escalating")).toHaveText("false");
  await expect(screen.getByTestId("escalation-surface")).toBeHidden();
  await expect(screen.getByTestId("window-visible")).toHaveText("false");
});

test("a block the companion cannot answer opens nothing", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("start").click();
  await screen.getByTestId("question").click();

  // An elicitation dialog: the mascot is in the blocked state and the window stays
  // shut. A surface with nothing on it to do teaches the user that answering is
  // sometimes pointless, and there is no answer this companion can give.
  await expect(screen.getByTestId("state")).toHaveText("needsYou");
  await expect(screen.getByTestId("escalating")).toHaveText("false");
  await expect(screen.getByTestId("window-visible")).toHaveText("false");
});

test("a window that would not say where it went is reported, not assumed", async ({ app, screen }) => {
  await app.open(PAGE);

  // A recording host cannot move a window, so it answers "unknown" rather than
  // repeating the request back. That is the honest answer, and the one the shell
  // has to survive rather than mistake for success.
  await expect(screen.getByTestId("placed-at")).toHaveText("unknown");
});

test("no decision card is offered, because nothing has asked for one", async ({ app, screen }) => {
  await app.open(PAGE);
  await screen.getByTestId("start").click();
  await screen.getByTestId("block").click();

  // A block the companion could answer is not the same as a request it has been
  // given. A hook payload says a session is blocked, never what the agent wants to
  // do, so the card stays away until `decision-transport` gives it something to
  // offer — and until then a card here would be a card bound to nothing.
  await expect(screen.getByTestId("decision-surface")).toBeHidden();
});

test("the whole round trip, through the surface the user would see", async ({ app, screen }) => {
  await app.open(PAGE);

  await screen.getByTestId("start").click();
  await expect(screen.getByTestId("state")).toHaveText("idle");

  await screen.getByTestId("prompt").click();
  await expect(screen.getByTestId("state")).toHaveText("thinking");

  await screen.getByTestId("block").click();
  await expect(screen.getByTestId("escalation-surface")).toBeVisible();
  await expect(screen.getByTestId("state")).toHaveText("needsYou");
  await expect(screen.getByTestId("window-visible")).toHaveText("true");

  await screen.getByTestId("answer").click();
  await expect(screen.getByTestId("escalation-surface")).toBeHidden();
  await expect(screen.getByTestId("window-visible")).toHaveText("false");
});
