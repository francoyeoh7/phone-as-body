# Washbasin Interaction and Public Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable washbasin on/off interaction to Corridor 617 and provide a temporary HTTPS QR flow for real phones.

**Architecture:** Keep geometry in `create-scene.js`, isolate state transitions in a small pure `Washbasin` helper, and route the existing `interact` event through `HorrorDirector`. Run the existing Node server behind a Cloudflare Quick Tunnel and configure the QR controller origin from the public hostname.

**Tech Stack:** Three.js, Vitest, Node.js/Express, Socket.IO, Cloudflare `cloudflared` Quick Tunnel.

## Global Constraints

- The washbasin must remain interactable after every toggle.
- The public QR payload must never use `localhost`.
- The temporary public URL is HTTPS and expires when the tunnel process stops.
- No external 3D asset download is required; keep the existing package footprint.
- Existing phone camera and short-tap interaction fallbacks remain unchanged.

---

### Task 1: Add the washbasin state unit

**Files:**
- Create: `src/desktop/Washbasin.js`
- Create: `tests/washbasin.test.js`

**Interfaces:**
- Produces `createWashbasinState({ onChange })` with `{ running, setRunning(boolean), toggle() }`.
- `onChange` receives `{ running }` only when the state actually changes.

- [ ] **Step 1: Write the failing tests**

```js
it("starts off and emits every repeated toggle", () => {
  const changes = [];
  const basin = createWashbasinState({ onChange: (state) => changes.push(state) });
  expect(basin.running).toBe(false);
  expect(basin.toggle()).toBe(true);
  expect(basin.toggle()).toBe(false);
  expect(basin.toggle()).toBe(true);
  expect(changes).toEqual([{ running: true }, { running: false }, { running: true }]);
});

it("does not emit when setRunning keeps the current state", () => {
  const onChange = vi.fn();
  const basin = createWashbasinState({ onChange });
  basin.setRunning(false);
  basin.setRunning(true);
  basin.setRunning(true);
  expect(onChange).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/washbasin.test.js`
Expected: FAIL because `src/desktop/Washbasin.js` does not exist.

- [ ] **Step 3: Implement the minimal state helper**

```js
export function createWashbasinState({ onChange } = {}) {
  let running = false;
  const setRunning = (next) => {
    const value = Boolean(next);
    if (value === running) return running;
    running = value;
    onChange?.({ running });
    return running;
  };
  return { get running() { return running; }, setRunning, toggle: () => setRunning(!running) };
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/washbasin.test.js`
Expected: 2 tests pass.

### Task 2: Build and register the visible washbasin

**Files:**
- Modify: `src/desktop/create-scene.js`
- Create: `tests/create-scene-washbasin.test.js` only if the scene helper can be tested without WebGL; otherwise cover the returned object through the director harness in Task 3.

**Interfaces:**
- Produces `objects.washbasin` with `root`, `enabled`, `running`, `setRunning(boolean)`, and `toggle()`.
- Registers `{ id: "washbasin", label: "打开水龙头", root, mesh, halo, enabled: true }` in `interactables`.

- [ ] **Step 1: Add the geometry factory after `addInteractable`**

Create a group at approximately `[2.05, 0, -3.9]` with the bowl centered at `y=1.0`: a beveled ceramic bowl, a dark counter slab, drain ring, curved faucet neck/spout, hot/cold handles, wall supply pipes, a transparent stream, a shallow transparent basin surface, and 8 small droplets. Keep all water materials transparent with depth-write disabled.

- [ ] **Step 2: Add a running-state visual updater**

`setRunning(true)` shows the stream/droplets, raises a small point light reflection, and changes the interaction label to `关闭水龙头`; `setRunning(false)` hides them and restores `打开水龙头`. `toggle()` delegates to the pure state helper so both visual state and interaction state stay synchronized.

- [ ] **Step 3: Register the interactable and return it from `createScene`**

Add the washbasin to the `interactables` array and `objects` return value. Add a fixed collider for the counter footprint so the player cannot walk through it, while keeping the target center within the existing 2.6-unit assisted-target range.

- [ ] **Step 4: Run existing scene-adjacent tests/build**

Run: `npm test -- tests/player-controller.test.js tests/shadow-quest.test.js`
Expected: all existing tests pass.

### Task 3: Route repeated interaction and audio

**Files:**
- Modify: `src/desktop/HorrorDirector.js`
- Modify: `src/desktop/audio.js` only if an existing cue cannot represent running water.
- Modify: `tests/horror-director.test.js`

**Interfaces:**
- `HorrorDirector.handleInteraction("washbasin")` returns `true` and toggles `experience.objects.washbasin` without dispatching the story objective.

- [ ] **Step 1: Write the failing director test**

Add a harness object with a `washbasin` fake whose `toggle()` alternates true/false, then assert two calls to `handleInteraction("washbasin")` return true and produce two toggles.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/horror-director.test.js`
Expected: the washbasin route returns false because the director does not handle its id.

- [ ] **Step 3: Implement the route**

Handle the id before story dispatch:

```js
if (id === "washbasin") {
  const running = this.experience.objects.washbasin.toggle();
  this.audio.cue(running ? "water-on" : "water-off");
  this.showSubtitle(running ? "水流起来了。" : "水龙头关上了。", 1.5);
  return true;
}
```

- [ ] **Step 4: Run the focused and full tests**

Run: `npm test -- tests/horror-director.test.js` then `npm test`.
Expected: all tests pass.

### Task 4: Make the QR origin public and smoke-test HTTPS

**Files:**
- Modify: `server/index.js` only if its public-origin handling needs validation or clearer startup logging.
- Create: `scripts/start-public-preview.ps1` if a repeatable Windows launcher is needed; the script must not embed a fixed URL and must print the generated tunnel URL.

**Interfaces:**
- Local origin remains `http://localhost:4174` for the server.
- Public origin is the generated `https://*.trycloudflare.com` URL and is exposed through `/api/config` as `controllerOrigin`.

- [ ] **Step 1: Ensure `cloudflared` is available**

Use the official Cloudflare Quick Tunnel command `cloudflared tunnel --url http://localhost:4174`. If it is not installed, download the official Windows binary to a temporary directory outside the repository or use the official Wrangler quick-start command; do not add the binary to git.

- [ ] **Step 2: Start the server with the public origin**

Start the local server with `PUBLIC_CONTROLLER_ORIGIN=<generated URL>` and `NODE_ENV=development`, then verify `Invoke-RestMethod http://localhost:4174/api/config` returns that HTTPS origin.

- [ ] **Step 3: Verify both public routes**

Request `<public URL>/` and `<public URL>/controller?preview=1`, expecting HTTP 200 and `text/html`. Verify the public page's QR controller URL does not contain `localhost`.

- [ ] **Step 4: Report the temporary-link lifecycle**

Provide the generated URL and state that it remains valid only while the local server and tunnel processes are running.

### Task 5: Final verification

**Files:**
- Verify: all changed files and untracked feature files.

- [ ] **Step 1: Run `npm test` and record the full count**
- [ ] **Step 2: Run `npm run build` and record exit code 0**
- [ ] **Step 3: Run `git diff --check`**
- [ ] **Step 4: Confirm the public URL, local server, and tunnel processes are still reachable**
