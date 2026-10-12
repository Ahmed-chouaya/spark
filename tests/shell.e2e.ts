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
 * That includes the capability *measurement*: whether Windows kept the window on
 * top is a question about a real window. What this run does drive is the other
 * half of the change — that a report saying the platform held the surface
 * produces the persistent behaviour, and that every non-affirmative report,
 * including "no platform could be asked", produces escalate-only. That path runs
 * through the real global the native host writes, so it is the real read and the
 * real decision rather than a harness-only branch of either.
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

/**
 * A capability report the harness published, in the URL.
 *
 * `mechanism:held` — and it goes into the *same global the native host writes*,
 * before React mounts, so what a run below exercises is the real publish →
 * read → decide path and not a harness-only branch of it.
 *
 * The one thing these runs cannot reach is the *measurement*: whether Windows
 * actually kept the window on top is a question about a real window, and no
 * browser engine has one. That is recorded per machine in `shell/README.md`, and
 * the claim here is narrower on purpose — that a report saying the platform held
 * the surface produces the persistent behaviour, which is what the code can be
 * held to.
 */
const reported = (mechanism: string, held: boolean) => `${PAGE}?report=${mechanism}:${held}`;

test("app opens", async ({ app, screen }) => {
  await app.open(PAGE);
  await expect(screen.getByRole("heading", "Spark shell")).toBeVisible();
});

test("nothing is on screen before anything has been blocked", async ({ app, screen }) => {
  await app.open(PAGE);

  // The branch this machine gets, and the one the whole capability rule is
  // written around: a platform that cannot hold a persistent surface has nothing
  // on it until there is something to say.
  await expect(screen.getByTestId("report")).toHaveText("none");
  await expect(screen.getByTestId("escalation-surface")).toBeHidden();
  await expect(screen.getByTestId("window-visible")).toHaveText("false");
  await expect(screen.getByTestId("window-focus-count")).toHaveText("0");
});

test("a report saying the platform held the surface makes it persistent", async ({ app, screen }) => {
  // The headline behaviour this change restores: a platform that says it can
  // hold a persistent surface gets a companion that is present while idle. The
  // old probe reported the opposite here, and was wrong.
  await app.open(reported("windows-topmost", true));

  await expect(screen.getByTestId("report")).toHaveText("windows-topmost / true");
  await expect(screen.getByTestId("escalation-surface")).toBeVisible();
  await expect(screen.getByTestId("escalating")).toHaveText("false");
  await expect(screen.getByTestId("window-visible")).toHaveText("true");

  // And an ambient surface does not take the keyboard, which is the other half
  // of what "persistent" means here.
  await expect(screen.getByTestId("window-focus-count")).toHaveText("0");
});

test("a report saying the platform did not make it escalate-only", async ({ app, screen }) => {
  await app.open(reported("windows-topmost", false));

  // Same mechanism, opposite answer, opposite behaviour. That is the whole claim
  // of a runtime-detected capability: the answer decides, not the platform.
  await expect(screen.getByTestId("report")).toHaveText("windows-topmost / false");
  await expect(screen.getByTestId("escalation-surface")).toBeHidden();
  await expect(screen.getByTestId("window-visible")).toHaveText("false");
});

test("every mechanism with the same answer produces the same behaviour", async ({ app, screen }) => {
  // The report names the *question*, not the platform, so the same answer has to
  // behave the same however it was arrived at. A build that switched behaviour
  // on an OS name would fail here.
  for (const mechanism of ["wayland-layer", "windows-topmost", "macos-level"]) {
    await app.open(reported(mechanism, true));
    await expect(screen.getByTestId("escalation-surface"), mechanism).toBeVisible();

    await app.open(reported(mechanism, false));
    await expect(screen.getByTestId("escalation-surface"), mechanism).toBeHidden();
  }
});

test("a report naming no platform is escalate-only, and is not an error", async ({ app, screen }) => {
  // There is no window behind this page, so there is nothing to ask. That is an
  // answer with a consequence, not a missing value — and it must not become
  // persistent because it happens to claim to hold the surface.
  await app.open(reported("unknown", false));
  await expect(screen.getByTestId("report")).toHaveText("unknown / false");
  await expect(screen.getByTestId("escalation-surface")).toBeHidden();

  await app.open(reported("unknown", true));
  await expect(screen.getByTestId("report")).toHaveText("unknown / true");
  await expect(screen.getByTestId("escalation-surface")).toBeHidden();
});

test("a report naming a mechanism this build has never heard of is refused", async ({ app, screen }) => {
  // A newer shell publishing a mechanism this document cannot audit is a value
  // it will not act on. Refused means escalate-only, not a thrown page.
  await app.open(reported("beos-layer", true));

  await expect(screen.getByTestId("report")).toHaveText("none");
  await expect(screen.getByTestId("escalation-surface")).toBeHidden();
});

test("a block still escalates on the persistent branch, without interrupting", async ({ app, screen }) => {
  // The capability decides the idle behaviour and nothing else. A platform that
  // can float does not stop surfacing blocks — it stops needing to interrupt to
  // do it, which is the whole difference between the two branches.
  await app.open(reported("windows-topmost", true));
  await screen.getByTestId("block").click();

  await expect(screen.getByTestId("escalation-surface")).toBeVisible();
  await expect(screen.getByTestId("escalating")).toHaveText("true");
  await expect(screen.getByTestId("window-focus-count")).toHaveText("0");
});

test("a block on the escalate-only branch interrupts, because appearing is the escalation", async ({
  app,
  screen,
}) => {
  await app.open(reported("wayland-layer", false));
  await screen.getByTestId("block").click();

  await expect(screen.getByTestId("escalation-surface")).toBeVisible();
  await expect(screen.getByTestId("window-focus-count")).toHaveText("1");
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
