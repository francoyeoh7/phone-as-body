# Inventory Edge Root-Cause Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a physical right-edge-to-left phone swipe visibly enter and complete the desktop inventory without changing stable movement, camera, voice, hand, or public URL paths.

**Architecture:** Keep the existing root-capture `InventoryEdgeController` and Socket.IO protocol. Add a subtle, non-interactive inner-edge affordance so users can start inside the operating system's reserved back-swipe zone, and enforce a short minimum open lifetime so open/commit packets cannot collapse into one unpainted desktop frame under tunnel latency.

**Tech Stack:** Vanilla browser pointer events, CSS, Socket.IO, Vitest, Vite production build.

## Global Constraints

- Do not restart or modify the running Node or Cloudflare processes until final verification/deploy.
- Preserve the existing public URL and `.env.local` public origin.
- Keep every inventory movement packet within `INVENTORY_DELTA_LIMIT` and preserve full-phone-travel cursor mapping.
- Keep cinematic, pause, connection, and found-phone state guards unchanged.
- Create a Git backup before edits and a focused verification commit after the fix.

### Task 1: Capture the two observed failures in tests

**Files:** `tests/inventory-edge-controller.test.js`, `tests/controller-app.test.js`, `tests/inventory-edge-style.test.js`

- [x] Add failing assertions for a visible `.inventory-edge-handle`, an inner-edge style, and delayed commit after a quick release.
- [x] Run `npx vitest run tests/inventory-edge-controller.test.js tests/controller-app.test.js tests/inventory-edge-style.test.js`; the new assertions failed before implementation as expected.

### Task 2: Add visible inner-edge affordance and bounded commit timing

**Files:** `src/controller/ControllerApp.js`, `src/controller/InventoryEdgeController.js`, `src/controller/styles.css`

- [x] Add the non-interactive `chevron-left` handle inside `#inventory-edge`.
- [x] Set `data-state="armed|tracking|idle"` locally and delay only `onCommit` until at least 160ms after activation; cancel pending commits during lifecycle cleanup and reject a second pointer while one is pending.
- [x] Keep the existing 72-128px capture lane, `touch-action: none`, voice region, utility controls, protocol fields, and cursor mapping unchanged.
- [x] Run `npx vitest run tests/inventory-edge-controller.test.js tests/controller-app.test.js tests/inventory-edge-style.test.js tests/desktop-app.test.js` and commit the focused fix.

### Task 3: Verify real two-page behavior without touching public services

**Files:** temporary `D:\backups\debug-inventory-e2e-20260820.mjs` only

- [x] Connect local desktop and controller pages, simulate a right-edge touch sequence, and assert the desktop inventory is visible during drag and 40ms after quick release, then closes after the minimum window.
- [x] Run focused controller/desktop/protocol suites and `npm run build`; full suite also passed with 857 tests and 1 skip.

### Task 4: Publish only after verification

**Files:** generated `dist/`

- [x] Create `backup/inventory-edge-root-cause-fixed-20260820`.
- [x] Publish the verified build without restarting Node/Cloudflare, changing the URL, or changing `PUBLIC_CONTROLLER_ORIGIN`.
- [x] Verify `/`, `/controller`, `/api/config`, and the controller bundle from `https://medieval-acknowledged-attitude-dating.trycloudflare.com`; the handle and minimum-visibility code are present.
- [x] Report the unchanged URL, backup tag, test/build results, and deployment timing.
