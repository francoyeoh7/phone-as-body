额 # 桌面安装包 + 云中继 + 多手柄 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 phone-as-body 做成 Windows 可下载安装包（Electron），手机扫码后经云中继（play.tokenxapp.com:8443）接管控制，会话层支持最多 8 个手柄并发。

**Architecture:** 游戏权威状态 100% 保留在本地 Express/Socket.IO 服务（Electron 子进程原样运行 `server/index.js`）。云中继是哑管道：托管手机页面 + 按房间码/密钥配对 + 双向转发。本地新增 relay-bridge，把云端远端手柄以"本地代理 socket"形式注入本地服务，使现有 socket 层零感知。多手柄改造集中在 `session-registry` + 新 `socket-router`，桌面端 `PhoneSession` 保持旧 API（主手柄 = 最小已连接槽位）。

**Tech Stack:** 现有栈不动（Express 5 / Socket.IO 4 / Vite 6 / vitest，ESM）。新增：Electron + electron-builder（NSIS）。云中继仅用 express + socket.io（复用根 package.json 依赖）。

## Global Constraints

- Node.js 20+；项目 `"type": "module"`；测试 `npx vitest run`；构建 `npm run build`（vite build → dist）
- 不新增游戏服务端运行时依赖（relay-bridge 只用已有 `socket.io-client`）
- 现有 856 项测试保持绿：允许随语义变化**改写**测试，禁止删除测试绕过
- UI 文案中文；代码注释仅在非显而易见处添加（遵循现有风格）
- 每个任务独立 commit；commit message 用 `feat:` / `test:` / `docs:` / `chore:` 前缀（对齐仓库现有 `docs:` 风格）
- 房间密钥：`crypto.randomBytes(12).toString("base64url")`（16 字符）；手柄上限 8；桌面断线 TTL 60s
- 云中继事件契约：`relayRegister` / `relayUnregister` / `relay:c2d` / `relay:d2c`（见 Task 7 接口定义）
- 仓库已克隆在 `d:\gamejam\phone-as-body`；所有路径相对该根目录
- git 提交者身份未配置：执行第一个任务前先运行 `git config user.name "francoyeoh7"` 和 `git config user.email "francoyeoh7@users.noreply.github.com"`（本仓库本地配置，勿 --global；若用户另有邮箱以用户为准）
- **用户纪律（最高优先）**：全部工作在 `desktop-relay-multi` 分支，禁止 push `main`、禁止 force push；每完成一个任务立即 commit，每完成 2-3 个任务 push 一次分支到 origin 作备份
- **延迟要求（用户明确）**：陀螺仪视角与手势识别必须灵敏。同 WiFi 时高频数据必须走 WebRTC 局域网直连（不经云）；跨网络时允许走云中继兜底

## 文件地图（谁负责什么）

| 文件 | 职责 |
|---|---|
| `src/shared/protocol.js`（改） | 新增 `MAX_CONTROLLERS` / `isSlot` / `isDeviceToken` |
| `server/session-registry.js`（重写） | 多手柄房间模型：controllers Map、槽位分配、deviceToken 重连回收、secret 生成 |
| `server/socket-router.js`（新） | Socket.IO 事件路由（从 `server/index.js` 抽取）：槽位信封、rtcSignal 槽位路由、relay 桥挂钩 |
| `server/index.js`（改） | 瘦身为装配：env、express 路由、socket-router、relay-bridge 启动 |
| `server/relay-bridge.js`（新） | 云端隧道客户端：registerRoom、远端手柄→本地代理 socket、双向转发含 ack |
| `src/desktop/PhoneSession.js`（重写） | 多槽位会话管理 + 每槽 WebRTC；对外保留旧 API（主手柄语义） |
| `src/controller/ControllerSocket.js`（改） | join 附带 deviceToken、ack 记录 slot、STUN iceServers |
| `src/controller/ControllerApp.js`（改） | deviceToken 持久化、槽位徽标 UI |
| `relay/rooms.js`（新） | 云端房间注册表纯逻辑（密钥校验、TTL、手柄上限） |
| `relay/server.mjs`（新） | 云中继服务：静态托管 dist + 双向转发 |
| `relay/index.mjs`（新） | 云中继启动入口（读 env） |
| `electron/main.cjs`（新） | Electron 主进程：fork 服务、等就绪、开窗、崩溃重启、单实例 |
| `electron-builder.yml`（新） | NSIS 打包配置 |
| `scripts/electron-dev.mjs` / `scripts/build-installer.mjs` / `scripts/make-icon.mjs`（新） | 跨平台启动/打包/图标脚本 |
| `relay/README.md`（新）、根 `README.md`（改）、`.env.example`（改） | 部署与使用文档 |

---

### Task 1: 协议扩展 —— deviceToken / 槽位 / 手柄上限

**Files:**
- Modify: `src/shared/protocol.js`
- Test: `tests/protocol.test.js`

**Interfaces:**
- Produces: `MAX_CONTROLLERS = 8`（number 常量）、`isSlot(value) → boolean`（整数且 0 ≤ v < 8）、`isDeviceToken(value) → boolean`（字符串，`/^[A-Za-z0-9_-]{8,64}$/`）。后续所有任务依赖这三个名字。

- [ ] **Step 1: 写失败测试**

在 `tests/protocol.test.js` 末尾追加（与现有 describe 同级）：

```js
describe("multi-controller protocol", () => {
  it("exposes the controller cap", () => {
    expect(protocol.MAX_CONTROLLERS).toBe(8);
  });

  it("accepts url-safe device tokens between 8 and 64 chars", () => {
    expect(protocol.isDeviceToken("d-1a2B3c4E5f6")).toBe(true);
    expect(protocol.isDeviceToken("a".repeat(64))).toBe(true);
    expect(protocol.isDeviceToken("short")).toBe(false);
    expect(protocol.isDeviceToken("has space!")).toBe(false);
    expect(protocol.isDeviceToken("a".repeat(65))).toBe(false);
    expect(protocol.isDeviceToken(123)).toBe(false);
    expect(protocol.isDeviceToken(null)).toBe(false);
  });

  it("bounds slots to the controller cap", () => {
    expect(protocol.isSlot(0)).toBe(true);
    expect(protocol.isSlot(7)).toBe(true);
    expect(protocol.isSlot(8)).toBe(false);
    expect(protocol.isSlot(-1)).toBe(false);
    expect(protocol.isSlot(1.5)).toBe(false);
    expect(protocol.isSlot("0")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/protocol.test.js`
Expected: 3 个新用例 FAIL（`MAX_CONTROLLERS` undefined / 函数不存在），其余 PASS。

- [ ] **Step 3: 最小实现**

在 `src/shared/protocol.js` 的 `EVENTS` 定义之后、`CONTROLLER_ACTIONS` 之前插入：

```js
export const MAX_CONTROLLERS = 8;
```

在 `isRoomCode` 函数之后插入：

```js
export function isSlot(value) {
  return Number.isInteger(value) && value >= 0 && value < MAX_CONTROLLERS;
}

export function isDeviceToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/protocol.test.js`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git config user.name "francoyeoh7"
git config user.email "francoyeoh7@users.noreply.github.com"
git checkout -b desktop-relay-multi
git add src/shared/protocol.js tests/protocol.test.js
git commit -m "feat: 协议层新增 deviceToken、槽位与手柄上限校验"
```

---

### Task 2: session-registry 多手柄重写

**Files:**
- Rewrite: `server/session-registry.js`
- Rewrite: `tests/session-registry.test.js`

**Interfaces:**
- Consumes: `isControllerInput` / `isControllerAction` / `isHandFrame` / `isRoomCode` / `isVoiceClip` / `isDeviceToken`（`src/shared/protocol.js`）
- Produces（Task 3 的 socket-router 依赖，签名必须一致）:
  - `createSessionRegistry({ randomCode?, secretFactory?, now?, maxControllers? })`
  - `createDesktop(desktopId) → { code, secret }`
  - `attachController(code, controllerId, deviceToken = null) → { ok, slot, replacedId } | { ok: false, reason: "room-not-found" | "room-full" | "invalid-device-token" }`
  - `acceptInput(code, controllerId, input) → { ok, room, slot, input } | { ok: false, reason: "room-not-found" | "not-controller" | "invalid-input" | "stale-input" }`
  - `acceptAction(code, controllerId, action) → { ok, room, slot } | { ok: false, reason: ... }`
  - `acceptVoiceClip(code, controllerId, clip) → { ok, room, slot, clip } | { ok: false, reason: ... }`
  - `acceptHand(code, controllerId, frame) → { ok, room, slot } | { ok: false, reason: ... }`
  - `controllerIdAt(code, slot) → socketId | null`
  - `disconnect(socketId) → { role: "desktop", roomCode, controllerIds: string[] } | { role: "controller", roomCode, slot } | null`
  - `get(code) → room | null`，room 形状：`{ code, secret, desktopId, controllers: Map<socketId, { slot, deviceToken, input, handSeq, handEpoch, voiceSeq, lastVoiceAcceptedAt, joinedAt }> }`

- [ ] **Step 1: 重写测试（先写完整新测试文件）**

`tests/session-registry.test.js` 全文替换为：

```js
import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../server/session-registry.js";

function sampleInput(overrides = {}) {
  return {
    seq: 1,
    sentAt: 100,
    move: { x: 0, y: 1 },
    viewDelta: { yaw: 42, pitch: -18 },
    clutch: true,
    ...overrides,
  };
}

function sampleHand(overrides = {}) {
  return {
    version: 1, seq: 1, capturedAt: 1, modeEpoch: 0, state: "lost", reason: "test", ...overrides,
  };
}

function sampleVoiceClip(overrides = {}) {
  return {
    version: 1,
    seq: 0,
    durationMs: 800,
    mimeType: "audio/webm",
    data: new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

function freshRegistry() {
  return createSessionRegistry({ randomCode: () => "617042" });
}

describe("session registry rooms", () => {
  it("creates a room with a url-safe secret", () => {
    const registry = freshRegistry();
    const room = registry.createDesktop("desktop");
    expect(room.code).toBe("617042");
    expect(room.secret).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(registry.get("617042").secret).toBe(room.secret);
  });

  it("keeps single-controller behaviour as slot 0", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    const joined = registry.attachController("617042", "phone");
    expect(joined).toMatchObject({ ok: true, slot: 0, replacedId: null });
    expect(registry.get("617042").controllers.get("phone").slot).toBe(0);
  });

  it("assigns ascending slots and reports each to the desktop", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    expect(registry.attachController("617042", "a").slot).toBe(0);
    expect(registry.attachController("617042", "b").slot).toBe(1);
    expect(registry.attachController("617042", "c").slot).toBe(2);
    expect(registry.controllerIdAt("617042", 1)).toBe("b");
    expect(registry.controllerIdAt("617042", 9)).toBe(null);
  });

  it("rejects joins when the room is full", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042", maxControllers: 2 });
    registry.createDesktop("desktop");
    expect(registry.attachController("617042", "a").ok).toBe(true);
    expect(registry.attachController("617042", "b").ok).toBe(true);
    expect(registry.attachController("617042", "c")).toMatchObject({ ok: false, reason: "room-full" });
  });

  it("rejects malformed device tokens", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    expect(registry.attachController("617042", "a", "bad token!"))
      .toMatchObject({ ok: false, reason: "invalid-device-token" });
  });

  it("reclaims the slot when a known device token rejoins", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a", "token-aaaa");
    registry.attachController("617042", "b");
    expect(registry.controllerIdAt("617042", 0)).toBe("a");

    const rejoined = registry.attachController("617042", "a2", "token-aaaa");
    expect(rejoined).toMatchObject({ ok: true, slot: 0, replacedId: "a" });
    expect(registry.controllerIdAt("617042", 0)).toBe("a2");
    expect(registry.get("617042").controllers.has("a")).toBe(false);
    expect(registry.get("617042").controllers.get("b").slot).toBe(1);
  });

  it("frees the slot for reuse after a controller disconnects", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.disconnect("a")).toMatchObject({ role: "controller", roomCode: "617042", slot: 0 });
    expect(registry.attachController("617042", "c").slot).toBe(0);
  });

  it("removes the room and reports controllers when the desktop leaves", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.disconnect("desktop"))
      .toMatchObject({ role: "desktop", roomCode: "617042", controllerIds: ["a", "b"] });
    expect(registry.get("617042")).toBe(null);
  });
});

describe("session registry per-controller state", () => {
  it("tracks input staleness per slot", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.acceptInput("617042", "a", sampleInput()).slot).toBe(0);
    expect(registry.acceptInput("617042", "a", sampleInput()).reason).toBe("stale-input");
    expect(registry.acceptInput("617042", "b", sampleInput()).slot).toBe(1);
    expect(registry.acceptInput("617042", "intruder", sampleInput()).reason).toBe("not-controller");
  });

  it("returns the accepted input snapshot with the slot", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "b");
    const accepted = registry.acceptInput("617042", "b", sampleInput({ crouch: true }));
    expect(accepted).toMatchObject({ ok: true, slot: 0 });
    expect(accepted.input).toMatchObject({ crouch: true, move: { x: 0, y: 1 } });
  });

  it("clears one-shot view deltas and stops input on controller disconnect", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");
    const input = sampleInput();

    expect(registry.acceptInput("617042", "phone", input).ok).toBe(true);
    input.viewDelta.yaw = 1;
    expect(registry.get("617042").controllers.get("phone").input.viewDelta).toEqual({ yaw: 42, pitch: -18 });

    registry.disconnect("phone");
    expect(registry.get("617042").controllers.size).toBe(0);
  });

  it("accepts only newer room-owned hand frames per slot", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.acceptHand("617042", "a", sampleHand({ seq: 2, modeEpoch: 3 })).ok).toBe(true);
    expect(registry.acceptHand("617042", "a", sampleHand({ seq: 2, modeEpoch: 3 })).reason).toBe("stale-hand");
    expect(registry.acceptHand("617042", "b", sampleHand({ seq: 0, modeEpoch: 0 })).ok).toBe(true);
    expect(registry.get("617042").controllers.get("a")).toMatchObject({ handSeq: 2, handEpoch: 3 });
  });

  it("accepts a sequence reset when a newer mode epoch starts", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");

    expect(registry.acceptHand("617042", "phone", sampleHand({ seq: 4, modeEpoch: 7 })).ok).toBe(true);
    expect(registry.acceptHand("617042", "phone", sampleHand({ seq: 0, modeEpoch: 8 })).ok).toBe(true);
    expect(registry.get("617042").controllers.get("phone")).toMatchObject({ handSeq: 0, handEpoch: 8 });
  });

  it("rate-limits voice clips per controller without storing bytes", () => {
    let now = 10_000;
    const registry = createSessionRegistry({ randomCode: () => "617042", now: () => now });
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.acceptVoiceClip("617042", "a", sampleVoiceClip()))
      .toMatchObject({ ok: true, slot: 0, clip: { seq: 0, mimeType: "audio/webm" } });
    expect(registry.acceptVoiceClip("617042", "a", sampleVoiceClip()).reason).toBe("stale-voice");
    now += 500;
    expect(registry.acceptVoiceClip("617042", "a", sampleVoiceClip({ seq: 1 })).reason).toBe("voice-rate-limited");
    expect(registry.acceptVoiceClip("617042", "b", sampleVoiceClip()).slot).toBe(1);
    expect(registry.get("617042").controllers.get("a").voiceClip).toBeUndefined();
  });

  it("validates actions per controller", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    expect(registry.acceptAction("617042", "a", { action: "interact", sentAt: 1 }))
      .toMatchObject({ ok: true, slot: 0 });
    expect(registry.acceptAction("617042", "a", { action: "nope" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/session-registry.test.js`
Expected: 大量 FAIL（旧实现无 secret/controllers Map/slot 语义）。

- [ ] **Step 3: 重写 `server/session-registry.js`（全文替换）**

```js
import { randomBytes } from "node:crypto";
import {
  isControllerAction, isControllerInput, isDeviceToken, isHandFrame, isRoomCode, isVoiceClip,
} from "../src/shared/protocol.js";

const stoppedInput = () => ({
  seq: -1,
  sentAt: 0,
  move: { x: 0, y: 0 },
  viewDelta: { yaw: 0, pitch: 0 },
  clutch: false,
  crouch: false,
});

function defaultRandomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function defaultSecretFactory() {
  return randomBytes(12).toString("base64url");
}

function createControllerState(slot, deviceToken, now) {
  return {
    slot,
    deviceToken,
    joinedAt: now(),
    input: stoppedInput(),
    handSeq: -1,
    handEpoch: 0,
    voiceSeq: -1,
    lastVoiceAcceptedAt: null,
  };
}

function resetControllerState(state) {
  state.input = stoppedInput();
  state.handSeq = -1;
  state.handEpoch = 0;
  state.voiceSeq = -1;
  state.lastVoiceAcceptedAt = null;
}

export function createSessionRegistry({
  randomCode = defaultRandomCode,
  secretFactory = defaultSecretFactory,
  now = () => Date.now(),
  maxControllers = 8,
} = {}) {
  const rooms = new Map();

  function createDesktop(desktopId) {
    let code;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidate = String(randomCode());
      if (isRoomCode(candidate) && !rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Unable to allocate a unique room code");

    const room = {
      code,
      secret: secretFactory(),
      desktopId,
      controllers: new Map(),
      createdAt: now(),
    };
    rooms.set(code, room);
    return { code: room.code, secret: room.secret };
  }

  function attachController(code, controllerId, deviceToken = null) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (deviceToken !== null && !isDeviceToken(deviceToken)) {
      return { ok: false, reason: "invalid-device-token" };
    }

    let state = null;
    let replacedId = null;
    if (deviceToken !== null) {
      for (const [id, existing] of room.controllers) {
        if (existing.deviceToken === deviceToken) {
          state = existing;
          if (id !== controllerId) {
            replacedId = id;
            room.controllers.delete(id);
          }
          break;
        }
      }
    }

    if (!state) {
      const used = new Set([...room.controllers.values()].map((entry) => entry.slot));
      if (used.size >= maxControllers) return { ok: false, reason: "room-full" };
      let slot = 0;
      while (used.has(slot)) slot += 1;
      state = createControllerState(slot, deviceToken, now);
    } else if (deviceToken !== null) {
      state.deviceToken = deviceToken;
    }

    resetControllerState(state);
    state.joinedAt = now();
    room.controllers.set(controllerId, state);
    return { ok: true, slot: state.slot, replacedId };
  }

  function controllerStateAt(code, controllerId) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    const state = room.controllers.get(controllerId);
    if (!state) return { ok: false, reason: "not-controller" };
    return { ok: true, room, state };
  }

  function acceptInput(code, controllerId, input) {
    const found = controllerStateAt(code, controllerId);
    if (!found.ok) return found;
    const { room, state } = found;
    if (!isControllerInput(input)) return { ok: false, reason: "invalid-input" };
    if (input.seq <= state.input.seq) return { ok: false, reason: "stale-input" };

    state.input = {
      seq: input.seq,
      sentAt: input.sentAt,
      move: { x: input.move.x, y: input.move.y },
      viewDelta: { yaw: input.viewDelta.yaw, pitch: input.viewDelta.pitch },
      clutch: input.clutch,
      crouch: input.crouch === true,
    };
    return {
      ok: true,
      room,
      slot: state.slot,
      input: { ...state.input, move: { ...state.input.move }, viewDelta: { ...state.input.viewDelta } },
    };
  }

  function acceptAction(code, controllerId, action) {
    const found = controllerStateAt(code, controllerId);
    if (!found.ok) return found;
    if (!isControllerAction(action)) return { ok: false, reason: "invalid-action" };
    return { ok: true, room: found.room, slot: found.state.slot };
  }

  function acceptVoiceClip(code, controllerId, clip) {
    const found = controllerStateAt(code, controllerId);
    if (!found.ok) return found;
    const { room, state } = found;
    if (!isVoiceClip(clip)) return { ok: false, reason: "invalid-voice" };
    if (clip.seq <= state.voiceSeq) return { ok: false, reason: "stale-voice" };
    const acceptedAt = now();
    if (state.lastVoiceAcceptedAt !== null && acceptedAt - state.lastVoiceAcceptedAt < 1_000) {
      return { ok: false, reason: "voice-rate-limited" };
    }

    state.voiceSeq = clip.seq;
    state.lastVoiceAcceptedAt = acceptedAt;
    return {
      ok: true,
      room,
      slot: state.slot,
      clip: {
        version: clip.version,
        seq: clip.seq,
        durationMs: clip.durationMs,
        mimeType: String(clip.mimeType).split(";")[0].toLowerCase(),
        data: clip.data,
      },
    };
  }

  function acceptHand(code, controllerId, frame) {
    const found = controllerStateAt(code, controllerId);
    if (!found.ok) return found;
    const { room, state } = found;
    if (!isHandFrame(frame)) return { ok: false, reason: "invalid-hand" };
    if (frame.modeEpoch < state.handEpoch
      || (frame.modeEpoch === state.handEpoch && frame.seq <= state.handSeq)) {
      return { ok: false, reason: "stale-hand" };
    }
    state.handEpoch = frame.modeEpoch;
    state.handSeq = frame.seq;
    return { ok: true, room, slot: state.slot };
  }

  function controllerIdAt(code, slot) {
    const room = rooms.get(code);
    if (!room) return null;
    for (const [id, state] of room.controllers) {
      if (state.slot === slot) return id;
    }
    return null;
  }

  function disconnect(socketId) {
    for (const [code, room] of rooms) {
      if (room.desktopId === socketId) {
        rooms.delete(code);
        return { role: "desktop", roomCode: code, controllerIds: [...room.controllers.keys()] };
      }
      if (room.controllers.has(socketId)) {
        const state = room.controllers.get(socketId);
        room.controllers.delete(socketId);
        return { role: "controller", roomCode: code, slot: state.slot };
      }
    }
    return null;
  }

  return {
    createDesktop,
    attachController,
    acceptInput,
    acceptAction,
    acceptVoiceClip,
    acceptHand,
    controllerIdAt,
    disconnect,
    get: (code) => rooms.get(code) ?? null,
  };
}
```

- [ ] **Step 4: 跑本文件测试 + 全量回归**

Run: `npx vitest run tests/session-registry.test.js`
Expected: 全部 PASS。
Run: `npx vitest run`
Expected: 可能有依赖旧 room 形状的测试失败（如 spa-fallback/ue-bridge 不涉及；若 `tests/protocol.test.js` 或其他出现失败，记录失败清单server/index.js` 仍引用 `room.controllerId`，本任务不改 index.js，全量回归允许暂红，Task 3 修复后转绿；但 `tests/session-registry.test.js` 必须全绿）。

- [ ] **Step 5: Commit**

```bash
git add server/session-registry.js tests/session-registry.test.js
git commit -m "feat: 会话注册表支持多手柄槽位与设备令牌重连"
```

---

### Task 3: socket-router 抽取 + 多手柄路由 + 房间密钥

**Files:**
- Create: `server/socket-router.js`
- Modify: `server/index.js`（删除内联 io.on("connection") 块，改用 router）
- Test: `tests/server-sockets.test.js`（新建，真实 Socket.IO 集成测试）

**Interfaces:**
- Consumes: Task 2 的 registry 全部签名；`EVENTS` / `isDesktopEvent` / `isRoomCode` / `isSlot`（protocol.js）
- Produces（Task 8 的 relay-bridge 依赖）:
  - `createSocketRouter(io, sessions, relayBridge = null)` —— relayBridge 只需实现 `registerRoom(code, secret)` 与 `unregisterRoom(code)`（均可选）
  - 桌面→手机事件信封（Task 4 PhoneSession 必须按此解析）:
    - `controller:input` → `{ slot, input }`
    - `controller:hand` → `{ slot, frame }`
    - `controller:voice-clip` → `{ slot, clip }`
    - `controller:action` → `{ slot, action }`
    - `peer:status` → `{ connected, slot }`
    - `rtc:signal`（发给桌面）→ `{ slot, ...signal }`；`rtc:signal`（发给手机）→ 原 signal（无 slot 字段）
    - `controller:join` ack → `{ ok, slot }` 或 `{ ok: false, reason }`
    - `desktop:create` ack → `{ ok, code, secret }`

- [ ] **Step 1: 写失败的集成测试**

新建 `tests/server-sockets.test.js`：

```js
import { createServer as createHttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { io } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionRegistry } from "../server/session-registry.js";
import { createSocketRouter } from "../server/socket-router.js";
import { EVENTS } from "../src/shared/protocol.js";

function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe("socket router", () => {
  let hub;
  let desktop;
  let phoneA;
  let phoneB;

  beforeAll(async () => {
    const httpServer = createHttpServer();
    const io = new SocketIOServer(httpServer, { serveClient: false });
    createSocketRouter(io, createSessionRegistry());
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${httpServer.address().port}`;
    hub = {
      url,
      close: () => new Promise((done) => io.close(() => httpServer.close(() => done()))),
    };
    desktop = io(hub.url, { transports: ["websocket"] });
    phoneA = io(hub.url, { transports: ["websocket"] });
    phoneB = io(hub.url, { transports: ["websocket"] });
  });

  afterAll(async () => {
    desktop.close();
    phoneA.close();
    phoneB.close();
    await hub.close();
  });

  it("creates a room with a secret and assigns ascending slots", async () => {
    const created = await emitAck(desktop, EVENTS.desktopCreate, undefined);
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.secret).toMatch(/^[A-Za-z0-9_-]{16}$/);

    const statusA = nextEvent(desktop, EVENTS.peerStatus);
    const joinedA = await emitAck(phoneA, EVENTS.controllerJoin, { room: created.code, deviceToken: "token-aaaa" });
    expect(joinedA).toMatchObject({ ok: true, slot: 0 });
    expect(await statusA).toEqual({ connected: true, slot: 0 });

    const statusB = nextEvent(desktop, EVENTS.peerStatus);
    const joinedB = await emitAck(phoneB, EVENTS.controllerJoin, { room: created.code, deviceToken: "token-bbbb" });
    expect(joinedB).toMatchObject({ ok: true, slot: 1 });
    expect(await statusB).toEqual({ connected: true, slot: 1 });
  });

  it("forwards slot-tagged input envelopes to the desktop", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const envelopeB = nextEvent(desktop, EVENTS.controllerInput);
    phoneB.emit(EVENTS.controllerInput, {
      seq: 5, sentAt: 10, move: { x: 0, y: 1 }, viewDelta: { yaw: 3, pitch: 0 }, clutch: false,
    });
    expect(await envelopeB).toMatchObject({ slot: 1, input: { seq: 5 } });

    const envelopeA = nextEvent(desktop, EVENTS.controllerInput);
    phoneA.emit(EVENTS.controllerInput, {
      seq: 1, sentAt: 10, move: { x: 1, y: 0 }, viewDelta: { yaw: 0, pitch: 0 }, clutch: true,
    });
    expect(await envelopeA).toMatchObject({ slot: 0, input: { seq: 1 } });
  });

  it("routes rtc signals per slot and strips the tag for phones", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const atB = nextEvent(phoneB, EVENTS.rtcSignal);
    desktop.emit(EVENTS.rtcSignal, { slot: 1, candidate: { candidate: "x" } });
    expect(await atB).toEqual({ candidate: { candidate: "x" } });

    const atDesktop = nextEvent(desktop, EVENTS.rtcSignal);
    phoneA.emit(EVENTS.rtcSignal, { description: { type: "offer", sdp: "s" } });
    expect(await atDesktop).toEqual({ slot: 0, description: { type: "offer", sdp: "s" } });
  });

  it("broadcasts desktop events to every controller", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const atA = nextEvent(phoneA, EVENTS.desktopEvent);
    const atB = nextEvent(phoneB, EVENTS.desktopEvent);
    desktop.emit(EVENTS.desktopEvent, { type: "control-feedback", kind: "step" });
    expect(await atA).toEqual({ type: "control-feedback", kind: "step" });
    expect(await atB).toEqual({ type: "control-feedback", kind: "step" });
  });

  it("reclaims the slot for a returning device token and notifies the desktop", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const status = nextEvent(desktop, EVENTS.peerStatus);
    const reclaimer = io(hub.url, { transports: ["websocket"] });
    const rejoined = await emitAck(reclaimer, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    expect(rejoined).toMatchObject({ ok: true, slot: 0 });
    expect(await status).toEqual({ connected: true, slot: 0 });
    reclaimer.close();
  });

  it("reports per-slot disconnects and ends sessions with the desktop", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const status = nextEvent(desktop, EVENTS.peerStatus);
    phoneA.close();
    expect(await status).toEqual({ connected: false, slot: 0 });

    const endedA = nextEvent(phoneA, EVENTS.sessionEnded).catch(() => null);
    const endedB = nextEvent(phoneB, EVENTS.sessionEnded);
    desktop.close();
    expect((await endedB)?.type).toBeUndefined();
    desktop = io(hub.url, { transports: ["websocket"] });
    void endedA;
  });
});
```

注意：最后一个用例里 `phoneA.close()` 后再监听其事件不可靠，`endedA` 仅作清理占位；`sessionEnded` 的断言放在 `phoneB` 上（桌面断线 → 所有手柄收到 sessionEnded）。若时序抖动，允许把该用例拆成两个 it。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server-sockets.test.js`
Expected: FAIL（`server/socket-router.js` 不存在，导入报错）。

- [ ] **Step 3: 实现 `server/socket-router.js`（新文件全文）**

```js
import { EVENTS, isDesktopEvent, isRoomCode } from "../src/shared/protocol.js";

const MAX_RTC_SIGNAL_JSON = 32_768;

function rtcSignalSizeOk(payload) {
  try {
    return JSON.stringify(payload).length <= MAX_RTC_SIGNAL_JSON;
  } catch {
    return false;
  }
}

export function createSocketRouter(io, sessions, relayBridge = null) {
  io.on("connection", (socket) => {
    socket.on(EVENTS.desktopCreate, (acknowledge) => {
      try {
        const room = sessions.createDesktop(socket.id);
        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.role = "desktop";
        relayBridge?.registerRoom?.(room.code, room.secret);
        if (typeof acknowledge === "function") acknowledge({ ok: true, code: room.code, secret: room.secret });
      } catch {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "room-allocation-failed" });
      }
    });

    socket.on(EVENTS.controllerJoin, (payload, acknowledge) => {
      const code = payload?.room;
      const deviceToken = payload?.deviceToken ?? null;
      if (!isRoomCode(code)) {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "invalid-room" });
        return;
      }

      const joined = sessions.attachController(code, socket.id, deviceToken);
      if (!joined.ok) {
        if (typeof acknowledge === "function") acknowledge(joined);
        return;
      }

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.role = "controller";
      socket.data.slot = joined.slot;
      const room = sessions.get(code);
      if (joined.replacedId) io.to(joined.replacedId).emit(EVENTS.controllerReplaced);
      io.to(room.desktopId).emit(EVENTS.peerStatus, { connected: true, slot: joined.slot });
      if (typeof acknowledge === "function") acknowledge({ ok: true, slot: joined.slot });
    });

    socket.on(EVENTS.controllerInput, (payload, acknowledge) => {
      const accepted = sessions.acceptInput(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) {
        io.to(accepted.room.desktopId).emit(EVENTS.controllerInput, { slot: accepted.slot, input: accepted.input });
      }
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerAction, (payload, acknowledge) => {
      const accepted = sessions.acceptAction(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) {
        io.to(accepted.room.desktopId).emit(EVENTS.controllerAction, { slot: accepted.slot, action: payload });
      }
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerVoiceClip, (payload, acknowledge) => {
      const accepted = sessions.acceptVoiceClip(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) {
        io.to(accepted.room.desktopId).emit(EVENTS.controllerVoiceClip, { slot: accepted.slot, clip: accepted.clip });
      }
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerHand, (payload, acknowledge) => {
      const accepted = sessions.acceptHand(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) {
        io.to(accepted.room.desktopId).emit(EVENTS.controllerHand, { slot: accepted.slot, frame: payload });
      }
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.rtcSignal, (payload) => {
      const code = socket.data.roomCode;
      const room = sessions.get(code);
      if (!room || payload === null || typeof payload !== "object") return;
      if (!rtcSignalSizeOk(payload)) return;

      if (socket.data.role === "desktop" && room.desktopId === socket.id) {
        const slot = payload.slot;
        const targetId = Number.isInteger(slot) ? sessions.controllerIdAt(code, slot) : null;
        if (targetId) {
          const { slot: _slot, ...signal } = payload;
          io.to(targetId).emit(EVENTS.rtcSignal, signal);
        }
        return;
      }

      if (socket.data.role === "controller") {
        io.to(room.desktopId).emit(EVENTS.rtcSignal, { slot: socket.data.slot, ...payload });
      }
    });

    socket.on(EVENTS.desktopEvent, (payload) => {
      const room = sessions.get(socket.data.roomCode);
      if (room?.desktopId === socket.id && isDesktopEvent(payload)) {
        for (const controllerId of room.controllers.keys()) {
          io.to(controllerId).emit(EVENTS.desktopEvent, payload);
        }
      }
    });

    socket.on("disconnect", () => {
      const result = sessions.disconnect(socket.id);
      if (!result) return;
      if (result.role === "desktop") {
        relayBridge?.unregisterRoom?.(result.roomCode);
        for (const controllerId of result.controllerIds) {
          io.to(controllerId).emit(EVENTS.sessionEnded);
        }
      } else {
        const room = sessions.get(result.roomCode);
        if (room) io.to(room.desktopId).emit(EVENTS.peerStatus, { connected: false, slot: result.slot });
      }
    });
  });
}
```

- [ ] **Step 4: 改 `server/index.js` 使用 router**

把 `server/index.js` 中整个 `io.on("connection", (socket) => { ... });` 块（约第 70-162 行）删除，替换为：

```js
createSocketRouter(io, sessions, relayBridge);
```

并在文件头部 import 区加入：

```js
import { createSocketRouter } from "./socket-router.js";
import { createRelayBridge } from "./relay-bridge.js";
```

在 `const npcAi = createNpcAi();` 之后、`let latestRuntimeDiagnostic = null;` 附近加入：

```js
const relayUrl = process.env.RELAY_URL || null;
const relayBridge = relayUrl
  ? createRelayBridge({ relayUrl, localServerUrl: `http://127.0.0.1:${port}` })
  : null;
```

注意：此时 `server/relay-bridge.js` 尚未创建（Task 8），为了本任务可独立运行测试，先创建一个最小桩文件 `server/relay-bridge.js`：

```js
export function createRelayBridge() {
  return { registerRoom() {}, unregisterRoom() {}, close() {} };
}
```

（Task 8 会替换为真实实现；`import { EVENTS ... } from "../src/shared/protocol.js"` 里 `MAX_VOICE_CLIP_BYTES`、`isDesktopEvent`、`isRoomCode` 若因此不再被 index.js 使用，同步清理 import 列表。）

- [ ] **Step 5: 跑测试**

Run: `npx vitest run tests/server-sockets.test.js`
Expected: 全部 PASS。
Run: `npx vitest run`
Expected: 全绿（Task 2 遗留的 index.js 相关失败应已消除；若 `tests/protocol.test.js` 中 PhoneSession 信封用例失败属预期，留给 Task 4 —— 此时不得有其他红项）。

- [ ] **Step 6: Commit**

```bash
git add server/socket-router.js server/index.js server/relay-bridge.js tests/server-sockets.test.js
git commit -m "feat: socket 路由支持多手柄信封与槽位级 RTC 路由"
```

---

### Task 4: PhoneSession 多槽位会话（桌面客户端）

**Files:**
- Rewrite: `src/desktop/PhoneSession.js`
- Test: `tests/protocol.test.js`（追加多槽位用例；现有用例依赖 `acceptInput(input)` / `setPeerConnected(bool)` 等默认 slot 0 语义，应保持通过）

**Interfaces:**
- Consumes: Task 3 的桌面侧事件信封（`{slot, input}` 等）
- Produces（DesktopApp / UeBridgeApp 依赖，保持不变）: 事件 `room` / `peer` / `input` / `hand` / `voice-clip` / `voice-stream` / `action`；方法 `start()` / `currentInput(maxAgeMs)` / `send(event)` / `destroy()`；`this.room`
- 新增（供未来多人玩法）: `slots() → number[]`（当前已连接槽位升序）；`peer` 事件 detail 增补 `{ connected, slot }`
- `desktopCreate` ack 现在含 `secret`，二维码 URL 追加 `k=<secret>`

- [ ] **Step 1: 写失败测试**

在 `tests/protocol.test.js` 末尾追加：

```js
describe("phone session multi-slot", () => {
  function inputEnvelope(seq, overrides = {}) {
    return {
      seq,
      sentAt: 100,
      move: { x: 0, y: 1 },
      viewDelta: { yaw: 1, pitch: 0 },
      clutch: false,
      ...overrides,
    };
  }

  it("drives the primary session from the lowest connected slot", () => {
    const session = new PhoneSession();
    const received = [];
    session.addEventListener("input", (event) => received.push(event.detail));

    session.setPeerConnected(true, 1);
    session.acceptInput(inputEnvelope(1), 1);
    expect(received).toHaveLength(1);
    expect(session.currentInput(10_000)).toMatchObject({ seq: 1 });

    session.setPeerConnected(true, 0);
    session.acceptInput(inputEnvelope(2), 0);
    expect(session.currentInput(10_000)).toMatchObject({ seq: 2 });

    session.setPeerConnected(false, 0);
    session.acceptInput(inputEnvelope(3), 1);
    expect(session.currentInput(10_000)).toMatchObject({ seq: 3 });
  });

  it("keeps slot state independent and reuses the primary api", () => {
    const session = new PhoneSession();
    session.setPeerConnected(true, 0);
    session.setPeerConnected(true, 1);

    session.acceptInput(inputEnvelope(7), 1);
    expect(session.currentInput(10_000).seq).toBe(-1);

    session.setPeerConnected(false, 0);
    session.acceptInput(inputEnvelope(8), 1);
    expect(session.currentInput(10_000).seq).toBe(8);
  });

  it("reports occupied slots", () => {
    const session = new PhoneSession();
    session.setPeerConnected(true, 2);
    session.setPeerConnected(true, 0);
    expect(session.slots()).toEqual([0, 2]);
    session.setPeerConnected(false, 2);
    expect(session.slots()).toEqual([0]);
  });

  it("emits peer events with slot detail on primary changes", () => {
    const session = new PhoneSession();
    const peers = [];
    session.addEventListener("peer", (event) => peers.push(event.detail));

    session.setPeerConnected(true, 0);
    session.setPeerConnected(true, 1);
    session.setPeerConnected(false, 0);

    expect(peers).toEqual([
      { connected: true, slot: 0 },
      { connected: false, slot: 0 },
    ]);
  });

  it("parses slot envelopes from the socket layer", () => {
    const listeners = new Map();
    socketIoMock.mockReturnValue({
      on: vi.fn((name, listener) => listeners.set(name, listener)),
      emit: vi.fn(),
      disconnect: vi.fn(),
    });
    vi.stubGlobal("window", { setInterval: vi.fn() });
    const session = new PhoneSession();
    session.start();

    const inputs = [];
    session.addEventListener("input", (event) => inputs.push(event.detail));

    listeners.get(protocol.EVENTS.peerStatus)({ connected: true, slot: 1 });
    listeners.get(protocol.EVENTS.controllerInput)({ slot: 1, input: inputEnvelope(4) });
    listeners.get(protocol.EVENTS.controllerHand)({ slot: 1, frame: { version: 1, seq: 1, capturedAt: 1, modeEpoch: 0, state: "lost", reason: "t" } });

    expect(inputs).toHaveLength(1);
    expect(session.currentInput(10_000)).toMatchObject({ seq: 4 });
    vi.unstubAllGlobals();
  });

  it("appends the room key to the controller url", async () => {
    const listeners = new Map();
    socketIoMock.mockReturnValue({
      on: vi.fn((name, listener) => listeners.set(name, listener)),
      emit: vi.fn((event, payload, acknowledge) => {
        if (event === protocol.EVENTS.desktopCreate && typeof acknowledge === "function") {
          acknowledge({ ok: true, code: "123456", secret: "abcdEFGH12345678" });
        }
      }),
      disconnect: vi.fn(),
    });
    vi.stubGlobal("window", { setInterval: vi.fn() });
    vi.stubGlobal("location", { origin: "http://localhost:4174" });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}) })));

    const session = new PhoneSession();
    const rooms = [];
    session.addEventListener("room", (event) => rooms.push(event.detail));
    session.start();
    await vi.waitFor(() => expect(rooms).toHaveLength(1));
    expect(rooms[0].url).toBe("http://localhost:4174/controller?room=123456&k=abcdEFGH12345678");
    vi.unstubAllGlobals();
  });
});
```

（`socketIoMock` 已存在于 `tests/protocol.test.js` 顶部 mock 区；若该 mock 变量名不同，以文件内现名为准。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/protocol.test.js`
Expected: 新 describe 全 FAIL；旧用例仍 PASS（`acceptInput(input)` 单参调用在新实现中 slot 默认 0）。

- [ ] **Step 3: 重写 `src/desktop/PhoneSession.js`（全文替换）**

```js
import QRCode from "qrcode";
import { io } from "socket.io-client";
import { EVENTS, isControllerInput, isHandFrame, isVoiceClip, isVoiceStreamFrame } from "../shared/protocol.js";

const stoppedInput = () => ({
  seq: -1,
  sentAt: 0,
  move: { x: 0, y: 0 },
  viewDelta: { yaw: 0, pitch: 0 },
  clutch: false,
  crouch: false,
  receivedAt: 0,
});

function createSlotState() {
  return {
    connected: false,
    input: stoppedInput(),
    handSeq: -1,
    handEpoch: 0,
    peerConnection: null,
    dataChannel: null,
    handChannel: null,
    voiceChannel: null,
    pendingCandidates: [],
  };
}

export class PhoneSession extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.room = null;
    this.secret = null;
    this.slots = new Map();
    this.primarySlotId = null;
    this.input = stoppedInput();
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    this.connected = false;
    this.handSeq = -1;
    this.handEpoch = 0;
  }

  slotState(slot) {
    let state = this.slots.get(slot);
    if (!state) {
      state = createSlotState();
      this.slots.set(slot, state);
    }
    return state;
  }

  primarySlot() {
    let best = null;
    for (const [slot, state] of this.slots) {
      if (state.connected && (best === null || slot < best)) best = slot;
    }
    return best;
  }

  slots() {
    return [...this.slots.entries()]
      .filter(([, state]) => state.connected)
      .map(([slot]) => slot)
      .sort((a, b) => a - b);
  }

  start() {
    this.socket = io({ transports: ["websocket", "polling"] });
    this.socket.on("connect", () => this.createRoom());
    this.socket.on("disconnect", () => this.setAllPeersDisconnected());
    this.socket.on(EVENTS.peerStatus, ({ connected, slot }) => {
      this.setPeerConnected(Boolean(connected), Number.isInteger(slot) ? slot : 0);
    });
    this.socket.on(EVENTS.controllerInput, ({ slot, input }) => {
      this.acceptInput(input, Number.isInteger(slot) ? slot : 0);
    });
    this.socket.on(EVENTS.controllerHand, ({ slot, frame }) => {
      this.acceptHandFrame(frame, Number.isInteger(slot) ? slot : 0);
    });
    this.socket.on(EVENTS.controllerVoiceClip, ({ slot, clip }) => {
      this.acceptVoiceClip(clip, Number.isInteger(slot) ? slot : 0);
    });
    this.socket.on(EVENTS.controllerAction, ({ slot, action }) => {
      const primary = this.primarySlot();
      if (primary === null || slot === primary) {
        this.dispatchEvent(new CustomEvent("action", { detail: action }));
      }
    });
    this.socket.on(EVENTS.rtcSignal, (signal) => this.handleRtcSignal(signal));
  }

  acceptInput(input, slot = 0) {
    if (!isControllerInput(input)) return;
    const state = this.slotState(slot);
    if (input.seq <= state.input.seq) return;

    state.input = {
      ...input,
      move: { ...input.move },
      viewDelta: { ...input.viewDelta },
      crouch: input.crouch === true,
      receivedAt: performance.now(),
    };
    if (slot === this.primarySlotId) {
      this.pendingViewDelta = {
        yaw: this.pendingViewDelta.yaw + input.viewDelta.yaw,
        pitch: this.pendingViewDelta.pitch + input.viewDelta.pitch,
      };
      this.input = { ...state.input };
      this.dispatchEvent(new CustomEvent("input", { detail: this.input }));
    }
  }

  acceptHandFrame(frame, slot = 0) {
    if (!isHandFrame(frame)) return false;
    const state = this.slotState(slot);
    if (frame.modeEpoch < state.handEpoch
      || (frame.modeEpoch === state.handEpoch && frame.seq <= state.handSeq)) return false;
    state.handEpoch = frame.modeEpoch;
    state.handSeq = frame.seq;
    if (slot === this.primarySlotId) {
      this.handEpoch = state.handEpoch;
      this.handSeq = state.handSeq;
      this.dispatchEvent(new CustomEvent("hand", {
        detail: { ...frame, receivedAt: performance.now() },
      }));
    }
    return true;
  }

  acceptVoiceClip(clip, _slot = 0) {
    if (!isVoiceClip(clip)) return false;
    this.dispatchEvent(new CustomEvent("voice-clip", { detail: { ...clip } }));
    return true;
  }

  resetHandOrdering() {
    this.handSeq = -1;
    this.handEpoch = 0;
  }

  createRoom() {
    this.socket.emit(EVENTS.desktopCreate, async (result) => {
      if (!result?.ok) {
        this.dispatchEvent(new CustomEvent("error", { detail: result?.reason ?? "room-failed" }));
        return;
      }
      this.room = result.code;
      this.secret = result.secret ?? null;
      const url = await this.buildControllerUrl(result.code, this.secret);
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 360,
        margin: 2,
        color: { dark: "#121413", light: "#f1f0e8" },
        errorCorrectionLevel: "M",
      });
      this.dispatchEvent(new CustomEvent("room", { detail: { code: result.code, url, qrDataUrl } }));
    });
  }

  async buildControllerUrl(code, secret = null) {
    let origin = location.origin;
    try {
      const response = await fetch("/api/config");
      const config = await response.json();
      if (config.controllerOrigin) origin = config.controllerOrigin;
    } catch {
      origin = location.origin;
    }
    const url = new URL("/controller", origin);
    url.searchParams.set("room", code);
    if (secret) url.searchParams.set("k", secret);
    return url.toString();
  }

  maybeSwapPrimary() {
    const primary = this.primarySlot();
    if (primary === this.primarySlotId) return;
    this.primarySlotId = primary;
    this.input = stoppedInput();
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    this.connected = primary !== null;
  }

  setPeerConnected(connected, slot = 0) {
    const state = this.slotState(slot);
    state.connected = Boolean(connected);

    if (connected) {
      state.input = stoppedInput();
      state.handSeq = -1;
      state.handEpoch = 0;
      const wasConnected = this.connected;
      this.maybeSwapPrimary();
      if (slot === this.primarySlotId) {
        if (!wasConnected) {
          this.input = stoppedInput();
          this.pendingViewDelta = { yaw: 0, pitch: 0 };
          this.resetHandOrdering();
        }
        this.startRtcOffer(slot);
        this.dispatchEvent(new CustomEvent("peer", { detail: { connected: true, slot } }));
      }
      return;
    }

    const wasPrimary = this.primarySlotId === slot;
    state.connected = false;
    state.input = {
      ...state.input,
      move: { x: 0, y: 0 },
      viewDelta: { yaw: 0, pitch: 0 },
      clutch: false,
      crouch: false,
    };
    state.handSeq = -1;
    state.handEpoch = 0;
    this.closePeerConnection(slot);
    this.maybeSwapPrimary();
    if (wasPrimary || this.primarySlotId === null) {
      this.input = {
        ...this.input,
        move: { x: 0, y: 0 },
        viewDelta: { yaw: 0, pitch: 0 },
        clutch: false,
        crouch: false,
      };
      this.pendingViewDelta = { yaw: 0, pitch: 0 };
      this.resetHandOrdering();
      this.dispatchEvent(new CustomEvent("peer", { detail: { connected: false, slot } }));
    }
  }

  setAllPeersDisconnected() {
    for (const slot of [...this.slots.keys()]) {
      this.closePeerConnection(slot);
      this.slotState(slot).connected = false;
    }
    this.primarySlotId = null;
    this.connected = false;
    this.input = {
      ...this.input,
      move: { x: 0, y: 0 },
      viewDelta: { yaw: 0, pitch: 0 },
      clutch: false,
      crouch: false,
    };
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    this.resetHandOrdering();
    this.dispatchEvent(new CustomEvent("peer", { detail: { connected: false } }));
  }

  createPeerConnection(slot) {
    if (typeof RTCPeerConnection === "undefined") return null;
    this.closePeerConnection(slot);
    const peer = new RTCPeerConnection();
    const state = this.slotState(slot);
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket?.emit(EVENTS.rtcSignal, { slot, candidate });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") this.closePeerConnection(slot);
    };
    state.peerConnection = peer;
    return peer;
  }

  attachDataChannel(slot, channel) {
    const isControls = !channel?.label || channel.label === "controls";
    const isHand = channel?.label === "hand";
    const isVoice = channel?.label === "voice";
    if (!isControls && !isHand && !isVoice) return;
    const state = this.slotState(slot);
    if (isHand) state.handChannel = channel;
    else if (isVoice) state.voiceChannel = channel;
    else state.dataChannel = channel;
    channel.onclose = () => {
      if (isHand) {
        if (state.handChannel === channel) state.handChannel = null;
      } else if (isVoice) {
        if (state.voiceChannel === channel) state.voiceChannel = null;
      } else if (state.dataChannel === channel) state.dataChannel = null;
    };
    channel.onmessage = ({ data }) => {
      if (isVoice) {
        let frame = data;
        if (typeof data === "string") {
          try {
            frame = JSON.parse(data);
          } catch {
            return;
          }
        }
        if (isVoiceStreamFrame(frame)) this.dispatchEvent(new CustomEvent("voice-stream", { detail: frame }));
        return;
      }
      try {
        const message = JSON.parse(data);
        if (isControls) {
          if (message?.type === "input" && slot === this.primarySlotId) this.acceptInput(message.payload, slot);
        } else if (message?.type === "hand") {
          this.acceptHandFrame(message.payload, slot);
        }
      } catch {
        // Ignore malformed peer messages; Socket.IO remains the fallback.
      }
    };
  }

  async startRtcOffer(slot) {
    const peer = this.createPeerConnection(slot);
    if (!peer) return;
    try {
      // Movement and view packets are disposable state snapshots. Dropping a
      // late packet is preferable to retransmitting it and making controls
      // feel delayed after a brief network hiccup.
      this.attachDataChannel(slot, peer.createDataChannel("controls", { ordered: false, maxRetransmits: 0 }));
      this.attachDataChannel(slot, peer.createDataChannel("hand", { ordered: false, maxRetransmits: 0 }));
      this.attachDataChannel(slot, peer.createDataChannel("voice", { ordered: true }));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      this.socket?.emit(EVENTS.rtcSignal, { slot, description: peer.localDescription });
    } catch {
      this.closePeerConnection(slot);
    }
  }

  async handleRtcSignal(signal) {
    const slot = Number.isInteger(signal?.slot) ? signal.slot : 0;
    const state = this.slotState(slot);
    const peer = state.peerConnection;
    if (!peer) return;
    try {
      if (signal?.description) {
        await peer.setRemoteDescription(signal.description);
        for (const candidate of state.pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
      } else if (signal?.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else state.pendingCandidates.push(signal.candidate);
      }
    } catch {
      this.closePeerConnection(slot);
    }
  }

  closePeerConnection(slot) {
    const state = this.slots.get(slot);
    if (!state) return;
    state.dataChannel?.close?.();
    if (state.handChannel && state.handChannel !== state.dataChannel) state.handChannel.close?.();
    if (state.voiceChannel && state.voiceChannel !== state.dataChannel && state.voiceChannel !== state.handChannel) {
      state.voiceChannel.close?.();
    }
    state.peerConnection?.close?.();
    state.dataChannel = null;
    state.handChannel = null;
    state.voiceChannel = null;
    state.peerConnection = null;
    state.pendingCandidates = [];
  }

  currentInput(maxAgeMs = 500) {
    const fresh = this.connected && performance.now() - this.input.receivedAt <= maxAgeMs;
    const viewDelta = fresh ? this.pendingViewDelta : { yaw: 0, pitch: 0 };
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    if (!fresh) {
      return {
        ...this.input,
        move: { x: 0, y: 0 },
        viewDelta,
        clutch: false,
        crouch: false,
      };
    }
    return { ...this.input, viewDelta };
  }

  send(event) {
    if (event?.type === "control-feedback") {
      const state = this.primarySlotId === null ? null : this.slots.get(this.primarySlotId);
      if (state?.dataChannel?.readyState === "open") {
        state.dataChannel.send(JSON.stringify({ type: "feedback", payload: event }));
        return;
      }
    }
    if (this.room && this.socket?.connected) this.socket.emit(EVENTS.desktopEvent, event);
  }

  destroy() {
    for (const slot of [...this.slots.keys()]) this.closePeerConnection(slot);
    this.socket?.disconnect();
  }
}
```

- [ ] **Step 4: 跑全量测试**

Run: `npx vitest run tests/protocol.test.js`
Expected: 全 PASS。
Run: `npx vitest run`
Expected: 全绿。特别关注 `tests/hand-tracking-director.test.js`（直接调用 `PhoneSession` 方法，默认 slot 0 语义应保持兼容）与 `tests/desktop-app.test.js`、`tests/ue-bridge.test.js`。

- [ ] **Step 5: Commit**

```bash
git add src/desktop/PhoneSession.js tests/protocol.test.js
git commit -m "feat: PhoneSession 支持多槽位会话与主手柄语义"
```

---

### Task 5: 手机端 deviceToken + 槽位徽标 + STUN

**Files:**
- Modify: `src/controller/ControllerSocket.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/styles.css`（追加徽标样式）
- Test: `tests/controller-app.test.js`、`tests/protocol.test.js`

**Interfaces:**
- Consumes: `isDeviceToken`（protocol.js）；Task 3 的 `controller:join` ack `{ ok, slot }`
- Produces: `ensureDeviceToken(storage) → string`（导出，供测试）；`ControllerSocket` 构造参数新增 `deviceToken`；`onStatus(status, detail)` 第二参数 `{ slot }`；`ControllerSocket.slot` 记录 ack 返回的槽位

- [ ] **Step 1: 写失败测试**

`tests/controller-app.test.js`：文件顶部 import 区追加：

```js
import { ensureDeviceToken } from "../src/controller/ControllerApp.js";
import { isDeviceToken } from "../src/shared/protocol.js";
```

文件末尾（describe 外或新 describe 内）追加：

```js
describe("controller device identity and slot badge", () => {
  it("renders a slot badge surface for multiplayer joins", () => {
    const markup = controllerShellMarkup("617042");
    expect(markup).toContain('id="slot-badge"');
  });

  it("persists the device token across sessions", () => {
    const storage = new Map();
    const stub = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    };
    const first = ensureDeviceToken(stub);
    const second = ensureDeviceToken(stub);
    expect(isDeviceToken(first)).toBe(true);
    expect(second).toBe(first);
  });

  it("replaces garbage tokens found in storage", () => {
    const storage = new Map([["phone-as-body-device", "bad token!"]]);
    const stub = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    };
    const token = ensureDeviceToken(stub);
    expect(token).not.toBe("bad token!");
    expect(isDeviceToken(token)).toBe(true);
  });

  it("survives storage-less environments", () => {
    expect(isDeviceToken(ensureDeviceToken(undefined))).toBe(true);
  });

  it("shows the assigned slot as a player badge", () => {
    const { app } = createApp();
    app.slotBadge = { textContent: "", hidden: true };
    app.updateConnection("joined", { slot: 1 });
    expect(app.slotBadge.textContent).toBe("P2");
    expect(app.slotBadge.hidden).toBe(false);
    app.updateConnection("disconnected");
    expect(app.slotBadge.hidden).toBe(true);
  });
});
```

`tests/protocol.test.js` 的 ControllerSocket describe 区追加：

```js
  it("joins with the device token and records the acked slot", () => {
    const listeners = new Map();
    const emits = [];
    socketIoMock.mockReturnValue({
      on: vi.fn((name, listener) => listeners.set(name, listener)),
      emit: vi.fn((event, payload, acknowledge) => {
        emits.push({ event, payload });
        if (event === protocol.EVENTS.controllerJoin && typeof acknowledge === "function") {
          acknowledge({ ok: true, slot: 2 });
        }
      }),
      disconnect: vi.fn(),
    });
    vi.stubGlobal("window", { setInterval: vi.fn() });
    const socket = new ControllerSocket({ room: "617042", deviceToken: "token-aaaa" });
    const statuses = [];
    socket.onStatus = (status, detail) => statuses.push({ status, detail });
    socket.connect();
    listeners.get("connect")();

    expect(emits[0]).toMatchObject({ event: protocol.EVENTS.controllerJoin });
    expect(emits[0].payload).toEqual({ room: "617042", deviceToken: "token-aaaa" });
    expect(socket.slot).toBe(2);
    expect(statuses[0]).toEqual({ status: "joined", detail: { slot: 2 } });
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/controller-app.test.js tests/protocol.test.js`
Expected: 新用例 FAIL（`ensureDeviceToken` 不存在 / markup 无 badge / join 无 token）。

- [ ] **Step 3: 实现**

**`src/controller/ControllerApp.js`**：

(a) `import { MAX_VOICE_CLIP_BYTES, isRoomCode } from "../shared/protocol.js";` 改为：

```js
import { MAX_VOICE_CLIP_BYTES, isDeviceToken, isRoomCode } from "../shared/protocol.js";
```

(b) 在 `loadSettings` 函数之后新增：

```js
export function ensureDeviceToken(storage) {
  try {
    let token = storage?.getItem?.("phone-as-body-device");
    if (!token || !isDeviceToken(token)) {
      token = crypto.randomUUID();
      storage?.setItem?.("phone-as-body-device", token);
    }
    return token;
  } catch {
    return crypto.randomUUID();
  }
}
```

(c) `controllerShellMarkup` 中 `<div class="inventory-edge" ...>` 一行之前插入：

```html
        <div class="slot-badge" id="slot-badge" hidden aria-live="polite"></div>
```

(d) `ControllerApp` constructor 中 `this.room = ...` 之后加：

```js
    this.deviceToken = ensureDeviceToken(globalThis.localStorage);
    this.slot = null;
```

(e) `connect()` 中 `new ControllerSocket({` 的参数改为：

```js
    this.socket = new ControllerSocket({
      room: this.room,
      deviceToken: this.deviceToken,
      onStatus: (status, detail) => this.updateConnection(status, detail),
      onEvent: (event) => this.handleDesktopEvent(event),
      onTelemetry: (telemetry) => this.diagnostics.updateNetwork(telemetry),
    });
```

(f) `updateConnection(state)` 签名改为 `updateConnection(state, detail = null)`，并在函数体第一行前插入：

```js
    if (state === "joined" && Number.isInteger(detail?.slot)) {
      this.slot = detail.slot;
      this.showSlotBadge(detail.slot);
    } else if (state !== "joined") {
      this.hideSlotBadge();
    }
```

(g) `cacheElements()` 末尾追加：

```js
    this.slotBadge = this.root.querySelector("#slot-badge");
```

(h) `updateConnection` 方法之后新增两个方法：

```js
  showSlotBadge(slot) {
    if (!this.slotBadge) return;
    this.slotBadge.textContent = `P${slot + 1}`;
    this.slotBadge.hidden = false;
  }

  hideSlotBadge() {
    if (!this.slotBadge) return;
    this.slotBadge.hidden = true;
  }
```

**`src/controller/ControllerSocket.js`**：

(a) constructor 中 `this.room = room;` 之后加：

```js
    this.deviceToken = options?.deviceToken ?? null;
    this.slot = null;
```

(b) `connect()` 内 `this.socket.emit(EVENTS.controllerJoin, ...)` 回调改为：

```js
    this.socket.on("connect", () => {
      this.socket.emit(EVENTS.controllerJoin, { room: this.room, deviceToken: this.deviceToken }, (result) => {
        this.joined = Boolean(result?.ok);
        this.slot = Number.isInteger(result?.slot) ? result.slot : null;
        this.onStatus?.(this.joined ? "joined" : result?.reason ?? "join-failed", { slot: this.slot });
      });
    });
```

(c) `ensurePeerConnection()` 中 `new RTCPeerConnection()` 改为：

```js
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.qq.com:3478", "stun.l.google.com:19302"] }],
    });
```

(d) `sendHandFrame(frame)` 中 `this.socket.emit(EVENTS.controllerHand, frame);` 改为（手势帧优先走 P2P 通道，降低经云延迟；帧自带 `seq`/`modeEpoch`，桌面端 `acceptHandFrame` 已有防乱序/防陈旧保护）：

```js
    // Prefer the peer-to-peer hand channel: through the cloud relay the
    // socket path adds a full round trip. Frames carry seq/modeEpoch, and the
    // desktop drops stale or reordered frames, so the unreliable channel is
    // safe for this state stream.
    if (this.handChannel?.readyState === "open") {
      this.handChannel.send(JSON.stringify({ type: "hand", payload: frame }));
      return true;
    }
    this.socket.emit(EVENTS.controllerHand, frame);
    return true;
```

**`src/controller/styles.css`** 末尾追加：

```css
.play-surface {
  position: relative;
}

.slot-badge {
  position: absolute;
  top: 14px;
  left: 14px;
  padding: 5px 11px;
  border-radius: 999px;
  background: rgba(241, 240, 232, 0.14);
  color: #f1f0e8;
  font: 600 12px/1 system-ui;
  letter-spacing: 0.08em;
  pointer-events: none;
  z-index: 3;
}

.slot-badge[hidden] {
  display: none;
}
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/controller-app.test.js tests/protocol.test.js`
Expected: 全 PASS。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/controller/ControllerSocket.js src/controller/ControllerApp.js src/controller/styles.css tests/controller-app.test.js tests/protocol.test.js
git commit -m "feat: 手机端设备令牌、槽位徽标与 STUN 候选"
```

---

### Task 6: 云端房间注册表（纯逻辑）

**Files:**
- Create: `relay/rooms.js`
- Test: `tests/relay-rooms.test.js`

**Interfaces:**
- Consumes: `isRoomCode`（`src/shared/protocol.js`，部署时随 `src/shared` 一起上传）
- Produces（Task 7 relay 服务依赖）:
  - `createRoomRegistry({ maxControllers?, orphanTtlMs?, now? })`
  - `register(code, secret, desktopSocketId) → boolean`（code 合法 6 位数字、secret ≥12 字符；同 code 不同 secret 拒绝=防劫持）
  - `validate(code, key) → room | null`
  - `get(code) → room | null`，room：`{ code, secret, desktopSocketId, controllers: Map<cid, phoneSocketId>, orphanedAt }`
  - `attach(code, phoneSocketId) → { ok, cid } | { ok: false, reason: "room-not-found" | "room-full" }`（cid = 手机 socket id）
  - `detach(phoneSocketId) → { ok, code }`
  - `markOrphan(code) → void`
  - `sweep() → string[]`（被清理的 code 列表）

- [ ] **Step 1: 写失败测试**

新建 `tests/relay-rooms.test.js`：

```js
import { describe, expect, it } from "vitest";
import { createRoomRegistry } from "../relay/rooms.js";

describe("relay room registry", () => {
  it("registers and validates rooms by secret", () => {
    const registry = createRoomRegistry();
    expect(registry.register("123456", "abcdEFGH12345678", "desktop-1")).toBe(true);
    expect(registry.validate("123456", "abcdEFGH12345678")?.desktopSocketId).toBe("desktop-1");
    expect(registry.validate("123456", "wrong-secret-xx")).toBe(null);
    expect(registry.validate("654321", "abcdEFGH12345678")).toBe(null);
  });

  it("rejects malformed codes and weak secrets", () => {
    const registry = createRoomRegistry();
    expect(registry.register("12345", "abcdEFGH12345678", "d")).toBe(false);
    expect(registry.register("123456", "short", "d")).toBe(false);
    expect(registry.register("123456", 123456789012, "d")).toBe(false);
  });

  it("blocks a second desktop from stealing a live room code", () => {
    const registry = createRoomRegistry();
    registry.register("123456", "abcdEFGH12345678", "desktop-1");
    expect(registry.register("123456", "zzzzYYYY9999zzzz", "desktop-2")).toBe(false);
    expect(registry.register("123456", "abcdEFGH12345678", "desktop-2")).toBe(true);
  });

  it("attaches controllers up to the cap and detaches by socket", () => {
    const registry = createRoomRegistry({ maxControllers: 2 });
    registry.register("123456", "abcdEFGH12345678", "desktop-1");
    expect(registry.attach("123456", "phone-a")).toEqual({ ok: true, cid: "phone-a" });
    expect(registry.attach("123456", "phone-b")).toEqual({ ok: true, cid: "phone-b" });
    expect(registry.attach("123456", "phone-c")).toMatchObject({ ok: false, reason: "room-full" });
    expect(registry.detach("phone-a")).toEqual({ ok: true, code: "123456" });
    expect(registry.attach("123456", "phone-c")).toEqual({ ok: true, cid: "phone-c" });
    expect(registry.detach("phone-a")).toEqual({ ok: false });
  });

  it("sweeps rooms after the ttl", () => {
    let now = 1_000;
    const registry = createRoomRegistry({ now: () => now });
    registry.register("123456", "abcdEFGH12345678", "desktop-1");
    registry.markOrphan("123456");
    now += 59_999;
    expect(registry.sweep()).toEqual([]);
    now += 2;
    expect(registry.sweep()).toEqual(["123456"]);
    expect(registry.get("123456")).toBe(null);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/relay-rooms.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `relay/rooms.js`（新文件全文）**

```js
import { timingSafeEqual } from "node:crypto";
import { isRoomCode } from "../src/shared/protocol.js";

function keysMatch(expected, provided) {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export function createRoomRegistry({ maxControllers = 8, orphanTtlMs = 60_000, now = () => Date.now() } = {}) {
  const rooms = new Map();

  function register(code, secret, desktopSocketId) {
    if (!isRoomCode(code) || typeof secret !== "string" || secret.length < 12) return false;
    const existing = rooms.get(code);
    if (existing && !keysMatch(existing.secret, secret)) return false;
    rooms.set(code, {
      code,
      secret,
      desktopSocketId,
      controllers: new Map(),
      orphanedAt: null,
    });
    return true;
  }

  function validate(code, key) {
    const room = rooms.get(code);
    if (!room || !keysMatch(room.secret, key)) return null;
    return room;
  }

  function attach(code, phoneSocketId) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (room.controllers.size >= maxControllers) return { ok: false, reason: "room-full" };
    room.controllers.set(phoneSocketId, phoneSocketId);
    return { ok: true, cid: phoneSocketId };
  }

  function detach(phoneSocketId) {
    for (const room of rooms.values()) {
      if (room.controllers.delete(phoneSocketId)) return { ok: true, code: room.code };
    }
    return { ok: false };
  }

  function markOrphan(code) {
    const room = rooms.get(code);
    if (room) room.orphanedAt = now();
  }

  function sweep() {
    const dead = [];
    for (const room of rooms.values()) {
      if (room.orphanedAt !== null && now() - room.orphanedAt >= orphanTtlMs) {
        rooms.delete(room.code);
        dead.push(room.code);
      }
    }
    return dead;
  }

  return { register, validate, get: (code) => rooms.get(code) ?? null, attach, detach, markOrphan, sweep };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/relay-rooms.test.js`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add relay/rooms.js tests/relay-rooms.test.js
git commit -m "feat: 云中继房间注册表（密钥校验、TTL、手柄上限）"
```

---

### Task 7: 云中继服务

**Files:**
- Create: `relay/server.mjs`
- Create: `relay/index.mjs`
- Test: `tests/relay-server.test.js`

**Interfaces:**
- Consumes: Task 6 的 registry；`EVENTS`、`isRoomCode`（protocol.js）；`shouldServeSpaShell`（`server/spa-fallback.js`）
- Produces（Task 8 bridge 依赖 + 部署依赖）:
  - `createRelayServer({ registry?, distDir, tls? }) → { httpServer, io, close() }`；`tls = { cert, key }` 或 null（null = HTTP，测试用）
  - **桥（桌面应用侧）socket 事件**：
    - `relayRegister { code, secret }`，ack `{ ok }`
    - `relayUnregister { code }`
    - 接收 `relay:d2c { code, cid, event, payload }`（event 限定白名单）
  - **手机侧 socket 事件**：与本地服务同名事件（`controller:join` 带 `{ room, k, deviceToken }`，ack `{ ok, slot }`；`controller:input/hand/voice-clip/action`、`rtc:signal` 原样转发；接收 `desktop:event`、`peer:status`、`controller:replaced`、`session:ended`、`rtc:signal`）
  - **桥接收**：`relay:c2d { code, cid, event, payload }`，其中 `event === "controller:join"` 时 payload 为 `{ room, deviceToken }`，桥 ack `{ ok, slot }`（云把它作为手机 join 的 ack 结果）；其余事件为手机原始 payload，input 类可带 ack
  - `relay/index.mjs` 读 env：`PORT`（默认 8443）、`TLS_CERT` / `TLS_KEY`（都存在才启用 HTTPS）、`DIST_DIR`（默认 `../dist` 相对 relay 目录）

- [ ] **Step 1: 写失败测试**

新建 `tests/relay-server.test.js`：

```js
import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { io } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRelayServer } from "../relay/server.mjs";
import { createRoomRegistry } from "../relay/rooms.js";
import { EVENTS } from "../src/shared/protocol.js";

function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function nextC2d(socket) {
  return new Promise((resolve) => socket.once("relay:c2d", (message, acknowledge) => resolve({ message, acknowledge })));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe("relay server", () => {
  let relay;
  let url;
  let bridge;
  const secret = "abcdEFGH12345678";

  beforeAll(async () => {
    const distDir = mkdtempSync(path.join(tmpdir(), "relay-dist-"));
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>controller</title>");
    const httpServer = createHttpServer();
    const relayServer = createRelayServer({ registry: createRoomRegistry(), distDir, tls: null });
    httpServer.on("request", relayServer.app);
    relayServer.attachIo(httpServer);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;
    relay = {
      close: () => new Promise((done) => relayServer.io.close(() => httpServer.close(() => done()))),
    };
    bridge = io(url, { transports: ["websocket"] });
    await nextEvent(bridge, "connect");
    const registered = await emitAck(bridge, "relayRegister", { code: "123456", secret });
    expect(registered.ok).toBe(true);
  });

  afterAll(async () => {
    bridge.close();
    await relay.close();
  });

  it("serves the controller shell from the dist dir", async () => {
    const response = await fetch(`${url}/controller?room=123456`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("controller");
  });

  it("rejects phone joins with a bad room key", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");
    const result = await emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: "wrong-secret-xx" });
    expect(result).toMatchObject({ ok: false, reason: "room-not-found" });
    phone.close();
  });

  it("pairs a phone with the desktop bridge and returns the acked slot", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");

    const joinResult = emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: secret, deviceToken: "token-aaaa" });
    const { message, acknowledge } = await nextC2d(bridge);
    expect(message).toMatchObject({ code: "123456", event: EVENTS.controllerJoin });
    expect(message.payload).toEqual({ room: "123456", deviceToken: "token-aaaa" });

    acknowledge({ ok: true, slot: 0 });
    expect(await joinResult).toEqual({ ok: true, slot: 0 });
    phone.close();
  });

  it("forwards controller traffic to the bridge with acks", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");

    const joinResult = emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: secret, deviceToken: "token-aaaa" });
    const joinC2d = await nextC2d(bridge);
    joinC2d.acknowledge({ ok: true, slot: 0 });
    expect(await joinResult).toEqual({ ok: true, slot: 0 });

    const inputResult = emitAck(phone, EVENTS.controllerInput, {
      seq: 1, sentAt: 5, move: { x: 0, y: 1 }, viewDelta: { yaw: 0, pitch: 0 }, clutch: false,
    });
    const inputC2d = await nextC2d(bridge);
    expect(inputC2d.message.event).toBe(EVENTS.controllerInput);
    expect(inputC2d.message.payload).toMatchObject({ seq: 1 });
    inputC2d.acknowledge({ ok: true, reason: undefined });
    expect(await inputResult).toEqual({ ok: true, reason: undefined });
    phone.close();
  });

  it("routes desktop traffic back to the right phone", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");
    const joinPromise = emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: secret, deviceToken: "token-aaaa" });
    const joinC2d = await nextC2d(bridge);
    joinC2d.acknowledge({ ok: true, slot: 0 });
    expect(await joinPromise).toEqual({ ok: true, slot: 0 });
    const cid = joinC2d.message.cid;

    const atPhone = nextEvent(phone, EVENTS.desktopEvent);
    bridge.emit("relay:d2c", { code: "123456", cid, event: EVENTS.desktopEvent, payload: { type: "ping" } });
    expect(await atPhone).toEqual({ type: "ping" });

    const rtcAtPhone = nextEvent(phone, EVENTS.rtcSignal);
    bridge.emit("relay:d2c", { code: "123456", cid, event: EVENTS.rtcSignal, payload: { candidate: { c: 1 } } });
    expect(await rtcAtPhone).toEqual({ candidate: { c: 1 } });
    phone.close();
  });

  it("notifies phones and keeps the room warm when the bridge drops", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");
    const joinPromise = emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: secret, deviceToken: "token-aaaa" });
    const joinC2d = await nextC2d(bridge);
    joinC2d.acknowledge({ ok: true, slot: 0 });
    expect(await joinPromise).toEqual({ ok: true, slot: 0 });

    const ended = nextEvent(phone, EVENTS.sessionEnded);
    bridge.close();
    await ended;

    const bridge2 = io(url, { transports: ["websocket"] });
    await nextEvent(bridge2, "connect");
    const registered = await emitAck(bridge2, "relayRegister", { code: "123456", secret });
    expect(registered.ok).toBe(true);
    bridge2.close();
    phone.close();
    bridge = io(url, { transports: ["websocket"] });
    await nextEvent(bridge, "connect");
    await emitAck(bridge, "relayRegister", { code: "123456", secret });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/relay-server.test.js`
Expected: FAIL（`relay/server.mjs` 不存在）。

- [ ] **Step 3: 实现 `relay/server.mjs`（新文件全文）**

```js
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { EVENTS } from "../src/shared/protocol.js";
import { shouldServeSpaShell } from "../server/spa-fallback.js";
import { createRoomRegistry } from "./rooms.js";

const MAX_VOICE_CLIP_BYTES = 1024 * 1024;
const JOIN_ACK_TIMEOUT_MS = 5_000;
const MAX_RTC_SIGNAL_JSON = 32_768;

const PHONE_TO_DESKTOP_EVENTS = [
  EVENTS.controllerInput,
  EVENTS.controllerHand,
  EVENTS.controllerVoiceClip,
  EVENTS.controllerAction,
  EVENTS.rtcSignal,
];

const DESKTOP_TO_PHONE_EVENTS = [
  EVENTS.desktopEvent,
  EVENTS.peerStatus,
  EVENTS.controllerReplaced,
  EVENTS.sessionEnded,
  EVENTS.rtcSignal,
];

function rtcSignalSizeOk(payload) {
  try {
    return JSON.stringify(payload).length <= MAX_RTC_SIGNAL_JSON;
  } catch {
    return false;
  }
}

export function createRelayServer({
  registry = createRoomRegistry(),
  distDir,
  tls = null,
  maxHttpBufferSize = MAX_VOICE_CLIP_BYTES + 64 * 1024,
  sweepIntervalMs = 15_000,
} = {}) {
  const app = express();
  app.use(express.static(distDir));
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  app.use((request, response, next) => {
    if (!shouldServeSpaShell(request)) return next();
    response.sendFile(path.join(distDir, "index.html"));
  });

  const io = new SocketIOServer({ serveClient: false, maxHttpBufferSize });

  io.on("connection", (socket) => {
    socket.on("relayRegister", (payload, acknowledge) => {
      const code = payload?.code;
      const secret = payload?.secret;
      const ok = registry.register(code, secret, socket.id);
      if (ok) {
        socket.data.roomCode = code;
        socket.data.role = "desktop";
      }
      if (typeof acknowledge === "function") acknowledge({ ok });
    });

    socket.on("relayUnregister", (payload) => {
      if (socket.data.role !== "desktop" || payload?.code !== socket.data.roomCode) return;
      registry.markOrphan(socket.data.roomCode);
    });

    socket.on("relay:d2c", (message) => {
      if (socket.data.role !== "desktop") return;
      const room = registry.get(socket.data.roomCode);
      if (!room || room.desktopSocketId !== socket.id) return;
      if (!DESKTOP_TO_PHONE_EVENTS.includes(message?.event)) return;
      const phoneSocketId = room.controllers.get(message?.cid);
      if (phoneSocketId) io.to(phoneSocketId).emit(message.event, message.payload);
    });

    socket.on(EVENTS.controllerJoin, async (payload, acknowledge) => {
      const code = payload?.room;
      const key = payload?.k;
      const room = registry.validate(code, key);
      if (!room) {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "room-not-found" });
        return;
      }
      const attached = registry.attach(code, socket.id);
      if (!attached.ok) {
        if (typeof acknowledge === "function") acknowledge(attached);
        return;
      }
      socket.data.roomCode = code;
      socket.data.role = "controller";
      socket.data.cid = attached.cid;

      const desktopAck = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, reason: "desktop-timeout" }), JOIN_ACK_TIMEOUT_MS);
        io.to(room.desktopSocketId).timeout(JOIN_ACK_TIMEOUT_MS).emit(
          "relay:c2d",
          { code, cid: attached.cid, event: EVENTS.controllerJoin, payload: { room: code, deviceToken: payload?.deviceToken ?? null } },
          (error, responses) => {
            clearTimeout(timer);
            if (error) resolve({ ok: false, reason: "desktop-timeout" });
            else resolve(responses?.[0] ?? { ok: false, reason: "desktop-no-ack" });
          },
        );
      });
      if (!desktopAck.ok) registry.detach(socket.id);
      if (typeof acknowledge === "function") acknowledge(desktopAck);
    });

    for (const event of PHONE_TO_DESKTOP_EVENTS) {
      socket.on(event, (payload, acknowledge) => {
        if (socket.data.role !== "controller") return;
        const room = registry.get(socket.data.roomCode);
        if (!room) return;
        if (event === EVENTS.rtcSignal && !rtcSignalSizeOk(payload)) return;
        const message = { code: socket.data.roomCode, cid: socket.data.cid, event, payload };
        if (typeof acknowledge === "function") {
          io.to(room.desktopSocketId).emit("relay:c2d", message, acknowledge);
        } else {
          io.to(room.desktopSocketId).emit("relay:c2d", message);
        }
      });
    }

    socket.on("disconnect", () => {
      if (socket.data.role === "desktop") {
        const code = socket.data.roomCode;
        registry.markOrphan(code);
        const room = registry.get(code);
        if (room) {
          for (const phoneSocketId of room.controllers.keys()) {
            io.to(phoneSocketId).emit(EVENTS.sessionEnded);
          }
        }
      } else if (socket.data.role === "controller") {
        registry.detach(socket.id);
      }
    });
  });

  const sweepTimer = setInterval(() => registry.sweep(), sweepIntervalMs);

  return {
    app,
    io,
    attachIo(httpServer) {
      io.attach(httpServer);
    },
    close() {
      clearInterval(sweepTimer);
      io.close();
    },
    listen(port, host) {
      if (!tls) return null;
      const server = createHttpsServer({ cert: tls.cert, key: tls.key }, app);
      io.attach(server);
      server.listen(port, host);
      return server;
    },
  };
}
```

（测试用 `httpServer.on("request", app)` + `attachIo(httpServer)` 装配 HTTP 模式；`listen()` 仅给 `relay/index.mjs` 的 HTTPS 模式用，`tls.cert` / `tls.key` 传证书内容字符串。）

- [ ] **Step 4: 实现 `relay/index.mjs`（启动入口，新文件全文）**

```js
#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRelayServer } from "./server.mjs";

const relayDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8443;
const distDir = process.env.DIST_DIR
  ? path.resolve(process.env.DIST_DIR)
  : path.resolve(relayDir, "..", "dist");
const certPath = process.env.TLS_CERT || null;
const keyPath = process.env.TLS_KEY || null;
const tls = certPath && keyPath && existsSync(certPath) && existsSync(keyPath)
  ? { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") }
  : null;

const relay = createRelayServer({ distDir, tls });
const server = relay.listen(port, "0.0.0.0");
if (!server) {
  console.error("relay: missing TLS_CERT/TLS_KEY, refusing to serve plaintext on a public port");
  process.exit(1);
}
server.on("listening", () => {
  console.log(`relay listening on ${tls ? "https" : "http"}://0.0.0.0:${port} serving ${distDir}`);
});
```

`relay/server.mjs` 的 `listen()` 里 `createHttpsServer({ cert, key })` 直接传字符串内容即可（Node 接受），`relay/index.mjs` 读成字符串传入。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/relay-server.test.js`
Expected: 全 PASS。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add relay/server.mjs relay/index.mjs tests/relay-server.test.js
git commit -m "feat: 云中继服务（配对、密钥校验、双向转发）"
```

---

### Task 8: relay-bridge 本地桥 + 全链路集成

**Files:**
- Rewrite: `server/relay-bridge.js`（替换 Task 3 的桩）
- Test: `tests/relay-bridge.test.js`（新建，本地服务 + 云中继 + 桥 + 手机四级真实链路）

**Interfaces:**
- Consumes: Task 3 `createSocketRouter(io, sessions, relayBridge)`（router 在 `desktop:create` 时调用 `relayBridge.registerRoom(code, secret)`、桌面断线时调用 `unregisterRoom(code)`）；Task 7 云中继事件契约
- Produces: `createRelayBridge({ relayUrl, localServerUrl, log? }) → { registerRoom(code, secret), unregisterRoom(code), close() }`（`server/index.js` 已在 Task 3 接好线，替换实现即可）
- 行为契约：每个远端手机（cid）在本地开一个代理 socket，以 `controller:join { room, deviceToken }` 加入本地服务；本地 → 云方向转发 `desktop:event` / `controller:replaced` / `session:ended` / `rtc:signal`；收到 `controller:replaced` 或 `session:ended` 后代理 socket 自行断开防泄漏

- [ ] **Step 1: 写失败的集成测试**

新建 `tests/relay-bridge.test.js`：

```js
import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Server as SocketIOServer } from "socket.io";
import { io } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionRegistry } from "../server/session-registry.js";
import { createSocketRouter } from "../server/socket-router.js";
import { createRelayBridge } from "../server/relay-bridge.js";
import { createRelayServer } from "../relay/server.mjs";
import { EVENTS } from "../src/shared/protocol.js";

function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe("relay bridge end to end", () => {
  let local;
  let relay;
  let bridge;
  let desktop;
  let phone;
  let room;
  let secret;

  beforeAll(async () => {
    // 本地游戏服务（桌面端 + 桥注入的代理手柄都连这里）
    const localHttp = createHttpServer();
    const localIo = new SocketIOServer(localHttp, { serveClient: false });
    await new Promise((resolve) => localHttp.listen(0, "127.0.0.1", resolve));
    const localUrl = `http://127.0.0.1:${localHttp.address().port}`;

    // 云中继（HTTP 模式 + 临时 dist）
    const distDir = mkdtempSync(path.join(tmpdir(), "relay-dist-"));
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>controller</title>");
    const relayHttp = createHttpServer();
    const relayServer = createRelayServer({ distDir, tls: null });
    relayHttp.on("request", relayServer.app);
    relayServer.attachIo(relayHttp);
    await new Promise((resolve) => relayHttp.listen(0, "127.0.0.1", resolve));
    const relayUrl = `http://127.0.0.1:${relayHttp.address().port}`;

    bridge = createRelayBridge({ relayUrl, localServerUrl: localUrl });
    createSocketRouter(localIo, createSessionRegistry(), bridge);

    desktop = io(localUrl, { transports: ["websocket"] });
    await nextEvent(desktop, "connect");
    const created = await emitAck(desktop, EVENTS.desktopCreate, undefined);
    room = created.code;
    secret = created.secret;
    await new Promise((resolve) => setTimeout(resolve, 100));

    phone = io(relayUrl, { transports: ["websocket"] });
    await nextEvent(phone, "connect");

    local = { url: localUrl, close: () => new Promise((done) => localIo.close(() => localHttp.close(() => done()))) };
    relay = { url: relayUrl, close: () => new Promise((done) => relayServer.close(() => relayHttp.close(() => done()))) };
  });

  afterAll(async () => {
    desktop.close();
    phone.close();
    bridge.close();
    await relay.close();
    await local.close();
  });

  it("joins through the bridge and reports the slot", async () => {
    const status = nextEvent(desktop, EVENTS.peerStatus);
    const joined = await emitAck(phone, EVENTS.controllerJoin, { room, k: secret, deviceToken: "token-aaaa" });
    expect(joined).toEqual({ ok: true, slot: 0 });
    expect(await status).toEqual({ connected: true, slot: 0 });
  });

  it("forwards input envelopes to the desktop with the slot", async () => {
    const envelope = nextEvent(desktop, EVENTS.controllerInput);
    phone.emit(EVENTS.controllerInput, {
      seq: 1, sentAt: 5, move: { x: 0, y: 1 }, viewDelta: { yaw: 2, pitch: 0 }, clutch: false,
    });
    expect(await envelope).toMatchObject({ slot: 0, input: { seq: 1 } });
  });

  it("routes desktop events back to the phone", async () => {
    const atPhone = nextEvent(phone, EVENTS.desktopEvent);
    desktop.emit(EVENTS.desktopEvent, { type: "control-feedback", kind: "step" });
    expect(await atPhone).toEqual({ type: "control-feedback", kind: "step" });
  });

  it("routes rtc signalling both ways", async () => {
    const atPhone = nextEvent(phone, EVENTS.rtcSignal);
    desktop.emit(EVENTS.rtcSignal, { slot: 0, description: { type: "offer", sdp: "s" } });
    expect(await atPhone).toEqual({ description: { type: "offer", sdp: "s" } });

    const atDesktop = nextEvent(desktop, EVENTS.rtcSignal);
    phone.emit(EVENTS.rtcSignal, { candidate: { candidate: "c" } });
    expect(await atDesktop).toEqual({ slot: 0, candidate: { candidate: "c" } });
  });

  it("reclaims the slot when the same device rejoins via a new cloud socket", async () => {
    const phone2 = io(relay.url, { transports: ["websocket"] });
    await nextEvent(phone2, "connect");
    const status = nextEvent(desktop, EVENTS.peerStatus);
    const joined = await emitAck(phone2, EVENTS.controllerJoin, { room, k: secret, deviceToken: "token-aaaa" });
    expect(joined).toEqual({ ok: true, slot: 0 });
    expect(await status).toEqual({ connected: true, slot: 0 });
    phone2.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/relay-bridge.test.js`
Expected: FAIL（桩实现不转发，join ack 超时/unknown-controller）。

- [ ] **Step 3: 实现 `server/relay-bridge.js`（全文替换桩）**

```js
import { io } from "socket.io-client";
import { EVENTS } from "../src/shared/protocol.js";

const CONTROLLER_RECEIVES = [
  EVENTS.desktopEvent,
  EVENTS.controllerReplaced,
  EVENTS.sessionEnded,
  EVENTS.rtcSignal,
];

export function createRelayBridge({ relayUrl, localServerUrl, log = () => {} }) {
  const relay = io(relayUrl, { transports: ["websocket"], reconnectionDelayMax: 10_000 });
  const rooms = new Map();
  const remotes = new Map();

  function registerRoom(code, secret) {
    if (!code || typeof secret !== "string") return;
    rooms.set(code, secret);
    if (relay.connected) {
      relay.emit("relayRegister", { code, secret }, (result) => log(`relay register ${code}: ${result?.ok}`));
    }
  }

  function unregisterRoom(code) {
    if (!rooms.has(code)) return;
    rooms.delete(code);
    for (const [cid, remote] of remotes) {
      if (remote.code === code) {
        remote.socket.disconnect();
        remotes.delete(cid);
      }
    }
    if (relay.connected) relay.emit("relayUnregister", { code });
  }

  relay.on("connect", () => {
    for (const [code, secret] of rooms) {
      relay.emit("relayRegister", { code, secret }, (result) => log(`relay register ${code}: ${result?.ok}`));
    }
  });

  relay.on("relay:c2d", (message, acknowledge) => {
    const { code, cid, event, payload } = message ?? {};
    if (event === EVENTS.controllerJoin) {
      if (remotes.has(cid)) {
        acknowledge?.({ ok: false, reason: "duplicate-controller" });
        return;
      }
      const socket = io(localServerUrl, { transports: ["websocket"] });
      remotes.set(cid, { code, socket });
      for (const forwarded of CONTROLLER_RECEIVES) {
        socket.on(forwarded, (data) => {
          if (relay.connected) relay.emit("relay:d2c", { code, cid, event: forwarded, payload: data });
          if (forwarded === EVENTS.controllerReplaced || forwarded === EVENTS.sessionEnded) {
            socket.disconnect();
          }
        });
      }
      socket.on("connect", () => {
        socket.emit(EVENTS.controllerJoin, { room: code, deviceToken: payload?.deviceToken ?? null }, (result) => {
          acknowledge?.(result);
        });
      });
      socket.on("disconnect", () => {
        if (remotes.get(cid)?.socket === socket) remotes.delete(cid);
      });
      return;
    }

    const remote = remotes.get(cid);
    if (!remote) {
      acknowledge?.({ ok: false, reason: "unknown-controller" });
      return;
    }
    if (typeof acknowledge === "function") {
      remote.socket.emit(event, payload, (result) => acknowledge(result));
    } else {
      remote.socket.emit(event, payload);
    }
  });

  return {
    registerRoom,
    unregisterRoom,
    close() {
      for (const remote of remotes.values()) remote.socket.disconnect();
      remotes.clear();
      rooms.clear();
      relay.disconnect();
    },
  };
}
```

已知取舍（写进代码注释不必，写进 README）：桥与云之间网络抖动断连时，云会立即给所有手机发 `sessionEnded`；桥重连后房间可重新注册，但手机端停留在"电脑端已关闭"页需手动刷新。Jam 版接受此取舍。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/relay-bridge.test.js`
Expected: 全 PASS。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add server/relay-bridge.js tests/relay-bridge.test.js
git commit -m "feat: 本地 relay-bridge 把云端手柄桥接进本地服务"
```

---

### Task 9: 依赖整理 + Electron 壳 + NSIS 安装包

**Files:**
- Modify: `package.json`（依赖分类 + scripts + main）
- Create: `electron/main.cjs`、`electron-builder.yml`、`.npmrc`
- Create: `scripts/electron-dev.mjs`、`scripts/build-installer.mjs`、`scripts/make-icon.mjs`、`electron/icons/icon.png`（生成物）

**Interfaces:**
- Consumes: 前面全部任务（`server/index.js` 读 `RELAY_URL` / `PUBLIC_CONTROLLER_ORIGIN` / `NODE_ENV` / `PORT`）
- Produces:
  - `npm run electron:dev` —— 本地起 Electron 窗口（等价于打包后体验）
  - `npm run dist:win` —— 产出 `release/phone-as-body-Setup-<version>.exe`
  - `npm run icon` —— 生成应用图标
  - 打包默认值：`PUBLIC_CONTROLLER_ORIGIN=https://play.tokenxapp.com:8443`、`RELAY_URL=https://play.tokenxapp.com:8443`（env 可覆盖）

- [ ] **Step 1: 依赖分类调整（先确认现状）**

Run: `npm test`
Expected: 全绿（改造前基线）。

修改 `package.json`：
- `dependencies` 只留 `"express"`, `"socket.io"`, `"socket.io-client"`
- 其余（`@dimforge/rapier3d-compat`、`@mediapipe/tasks-vision`、`lucide`、`qrcode`、`three`、`vite`）移入 `devDependencies`
- 根级新增 `"main": "electron/main.cjs"`
- `scripts` 追加：

```json
    "electron:dev": "node scripts/electron-dev.mjs",
    "dist:win": "node scripts/build-installer.mjs",
    "icon": "node scripts/make-icon.mjs"
```

Run: `npm install`
Expected: 重新生成 lock，无 peer 冲突。
Run: `npm test && npm run build`
Expected: 全绿 + 构建成功（证明前端依赖打包进 dist、不依赖 dependencies 分类）。

- [ ] **Step 2: 安装 Electron 工具链（国内镜像）**

新建 `.npmrc`：

```
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

Run: `npm install -D electron electron-builder`
Expected: 安装成功（首次较大）。

- [ ] **Step 3: 生成图标**

新建 `scripts/make-icon.mjs`：

```js
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0e100f"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#f1f0e8" stroke-width="28"/>
  <circle cx="256" cy="256" r="64" fill="#f1f0e8"/>
  <rect x="230" y="56" width="52" height="22" rx="11" fill="#f1f0e8"/>
</svg>`;

const outDir = path.resolve("electron", "icons");
mkdirSync(outDir, { recursive: true });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(path.join(outDir, "icon.png"), png);
console.log("wrote electron/icons/icon.png");
```

Run: `npm run icon`
Expected: `electron/icons/icon.png` 生成（512×512）。

- [ ] **Step 4: Electron 主进程**

新建 `electron/main.cjs`：

```js
const { app, BrowserWindow } = require("electron");
const { fork } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const SERVER_PORT = Number(process.env.PORT) || 4174;
const PUBLIC_CONTROLLER_ORIGIN = process.env.PUBLIC_CONTROLLER_ORIGIN || "https://play.tokenxapp.com:8443";
const RELAY_URL = process.env.RELAY_URL || "https://play.tokenxapp.com:8443";
const SERVER_READY_TIMEOUT_MS = 30_000;
const MAX_RESTARTS = 5;

let mainWindow = null;
let serverChild = null;
let restartAttempts = 0;
let quitting = false;

const rootDir = path.join(__dirname, "..");

function startServer() {
  serverChild = fork(path.join(rootDir, "server", "index.js"), [], {
    cwd: rootDir,
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: process.env.NODE_ENV || "production",
      PORT: String(SERVER_PORT),
      PUBLIC_CONTROLLER_ORIGIN,
      RELAY_URL,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  serverChild.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverChild.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  serverChild.on("exit", () => {
    serverChild = null;
    if (quitting || restartAttempts >= MAX_RESTARTS) return;
    restartAttempts += 1;
    const delay = Math.min(1000 * 2 ** restartAttempts, 15_000);
    setTimeout(startServer, delay);
  });
}

function waitForServer(timeoutMs = SERVER_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`http://127.0.0.1:${SERVER_PORT}/api/config`, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else retry();
      });
      request.on("error", retry);
      request.setTimeout(2_000, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("server did not become ready in time"));
        return;
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0e100f",
    title: "手机即身体",
    autoHideMenuBar: true,
    show: false,
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    startServer();
    try {
      await waitForServer();
      await createWindow();
    } catch (error) {
      console.error(error);
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", () => {
    quitting = true;
    if (serverChild) serverChild.kill();
  });
}
```

- [ ] **Step 5: 启动与打包脚本**

新建 `scripts/electron-dev.mjs`：

```js
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn("npx", ["electron", "."], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" },
});
child.on("exit", (code) => process.exit(code ?? 0));
```

新建 `scripts/build-installer.mjs`：

```js
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const build = spawnSync("npx", ["vite", "build"], { cwd: root, stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const dist = spawnSync("npx", ["electron-builder", "--win", "nsis"], { cwd: root, stdio: "inherit", shell: true });
process.exit(dist.status ?? 1);
```

新建 `electron-builder.yml`：

```yaml
appId: com.tokenxapp.phoneasbody
productName: 手机即身体
directories:
  output: release
  buildResources: electron
files:
  - electron/**
  - server/**
  - src/shared/**
  - dist/**
  - package.json
  - "!**/*.md"
  - "!**/*.map"
win:
  icon: electron/icons/icon.png
  target:
    - nsis
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  shortcutName: 手机即身体
  artifactName: phone-as-body-Setup-${version}.${ext}
```

- [ ] **Step 6: 开发态冒烟**

Run: `npm run build && npm run electron:dev`
Expected: 窗口打开、游戏加载、二维码显示（此时云未部署，扫码不可用属正常；本地键鼠后备可玩）。关闭窗口进程退出干净（任务管理器无残留 electron/node 子进程）。

- [ ] **Step 7: 打安装包**

Run: `npm run dist:win`
Expected: `release/phone-as-body-Setup-0.1.0.exe` 产出。双击安装 → 开始菜单出现"手机即身体" → 启动 → 窗口正常 → 卸载干净。

Run: `npm test`
Expected: 全绿。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .npmrc electron/ electron-builder.yml scripts/electron-dev.mjs scripts/build-installer.mjs scripts/make-icon.mjs
git commit -m "feat: Electron 桌面应用与 NSIS 安装包"
```

---

### Task 10: 云部署文档 + 收尾验收

**Files:**
- Create: `relay/README.md`
- Modify: `.env.example`、根 `README.md`

**Interfaces:**
- Consumes: Task 7/8/9 的 env 契约与打包产物
- Produces: 可交给任何人在腾讯云复现部署的 runbook；最终验收记录

- [ ] **Step 1: 写 `relay/README.md`（全文）**

````markdown
# 云中继部署手册（腾讯云 · play.tokenxapp.com:8443）

云中继是哑管道：托管手机端页面 + 按房间码配对 + 双向转发。游戏逻辑全部在玩家自己的电脑上。

## 一次性准备

1. **DNS**：在阿里云 DNS 控制台为 `tokenxapp.com` 添加 A 记录：`play` → 服务器公网 IP。
2. **防火墙**：腾讯云轻量服务器控制台 → 防火墙 → 放行 TCP `8443`。
3. **证书（DNS-01，不需要 80 端口）**：

   ```bash
   curl https://get.acme.sh | sh -s email=<你的邮箱>
   # 阿里云 RAM 建 AccessKey（只需 DNS 解析权限），写入：
   export Ali_Key=<AccessKeyId>
   export Ali_Secret=<AccessKeySecret>
   ~/.acme.sh/acme.sh --issue --dns dns_ali -d play.tokenxapp.comp /opt/phone-relay/certs
   ~/.acme.sh/acme.sh --install-cert -d play.tokenxapp.com \
     --key-file /opt/phone-relay/certs/key.pem \
     --fullchain-file /opt/phone-relay/certs/cert.pem \
     --reloadcmd "pm2 restart phone-relay || true"
   ```

4. **Node**：服务器安装 Node.js 20+（`nodesource` 或官方包）。

## 每次发版

在开发机（仓库根目录）：

```bash
npm ci
npm run build   # 产出 dist/（含手机端页面与 wasm）
rsync -avz --delete dist/ server/ relay/ src/shared/ package.json package-lock.json <user>@<server>:/opt/phone-relay/
```

在服务器：

```bash
cd /opt/phone-relay
npm ci --omit=dev
pm2 start relay/index.mjs --name phone-relay \
  --env production -- \
  # 以下为环境变量，pm2 用法见下方 ecosystem 写法
```

推荐用 ecosystem 文件 `/opt/phone-relay/ecosystem.config.cjs`：

```js
module.exports = {
  apps: [{
    name: "phone-relay",
    script: "relay/index.mjs",
    cwd: "/opt/phone-relay",
    env: {
      PORT: "8443",
      DIST_DIR: "/opt/phone-relay/dist",
      TLS_CERT: "/opt/phone-relay/certs/cert.pem",
      TLS_KEY: "/opt/phone-relay/certs/key.pem",
    },
  }],
};
```

```bash
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

## 验证

```bash
curl https://play.tokenxapp.com:8443/api/health
# {"ok":true}
```

电脑端启动安装包 → 二维码应为 `https://play.tokenxapp.com:8443/controller?room=XXXXXX&k=YYYY` → 手机扫码进入控制页。

## 运维备注

- 证书续期：acme.sh 装了 cron，自动续期并 `pm2 restart phone-relay`
- 日志：`pm2 logs phone-relay`
- 已知取舍：桌面端网络抖动导致桥断连时，手机会看到"电脑端已关闭"，刷新页面重扫即可；房间在 60 秒内可被同一密钥重新注册
- 上限：每房间 8 手柄；同房间码 + 不同密钥会被拒绝（防劫持）
````

- [ ] **Step 2: 更新 `.env.example`（全文替换）**

```
# Copy these names to .env.local. Never commit the real key.
OPENAI_API_KEY=
OPENAI_NPC_TEXT_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_REALTIME_MODEL=gpt-realtime

# 云中继：设置后服务端会把房间注册到云端，手机扫码经云接管
# 本地开发默认留空（手机与电脑同源直连）
RELAY_URL=
# 二维码指向的地址（默认 https://play.tokenxapp.com:8443，Electron 打包内置同值）
PUBLIC_CONTROLLER_ORIGIN=
```

- [ ] **Step 3: 根 `README.md` 追加章节**

在「项目状态」章节之前插入：

````markdown
## 桌面安装包与云中继

- `npm run dist:win` 产出 Windows NSIS 安装包（`release/phone-as-body-Setup-<version>.exe`），游戏与资源全部本地化，启动即玩。
- 安装包默认把二维码指向云中继 `https://play.tokenxapp.com:8443`；手机扫码后经云端隧道接管，电脑与手机同 WiFi 时高频输入仍走 WebRTC 局域网直连。
- 云中继部署见 `relay/README.md`（腾讯云 + acme.sh DNS-01 + pm2，非标端口 8443 规避备案墙）。
- 会话层支持最多 8 个手柄（P1-P8 槽位徽标显示），断线凭设备令牌找回原槽位；当前单人游戏绑定主手柄（最小已连接槽位）。
- 开发调试：`npm run electron:dev`；覆盖默认云端地址用环境变量 `RELAY_URL` / `PUBLIC_CONTROLLER_ORIGIN`。
````

- [ ] **Step 4: 最终验收（对照设计文档 §5）**

Run: `npm test`
Expected: 全绿。

Run: `npm run build && npm run dist:win`
Expected: 安装包产出成功。

人工验收清单（需要真机，逐项打勾记录 message 或 PR 描述里）：

- [ ] 干净 Windows 机器安装/启动/卸载正常
- [ ] 云端 `curl https://play.tokenxapp.com:8443/api/health` 返回 `{"ok":true}`
- [ ] 手机扫码（蜂窝网络）→ 进入控制页 → 权限弹窗 → 控制正常
- [ ] 同 WiFi 第二台手机扫码 → 显示 P2 → 两台同时输入互不串扰
- [ ] 一台手机断网重连 → 回到原槽位
- [ ] 电脑端关闭 → 手机显示"电脑端已关闭"

- [ ] **Step 5: Commit**

```bash
git add relay/README.md .env.example README.md
git commit -m "docs: 云中继部署手册与桌面安装包说明"
```

- [ ] **Step 6: 询问用户是否 push**

```bash
git log --oneline main..desktop-relay-multi
```

向用户展示提交列表，确认后 `git push -u origin desktop-relay-multi`（是否合并回 main 由用户决定）。

---

## Self-Review 结论

- **Spec 覆盖**：spec §3.1（Electron）→ Task 9；§3.2（云中继）→ Task 6/7/10；§3.3（registry/路由/桥）→ Task 2/3/8；§3.4（PhoneSession）→ Task 4；§3.5（手机端）→ Task 5；§5 验收 → Task 9/10。无缺口。
- **占位符扫描**：无 TBD/TODO；所有代码步骤给出全文或精确 diff。
- **类型一致性**：registry 返回值（`{ok, slot, replacedId}` 等）与 socket-router 调用点、relay 契约（`relay:c2d`/`relay:d2c`/ack 透传）与 bridge/测试三方一致；`PhoneSession` 对外 API 与 DesktopApp/UeBridgeApp 现有调用一致。
- **风险点**：`tests/protocol.test.js` 顶部 mock 变量名（`socketIoMock`）以文件实际内容为准；`tests/hand-tracking-director.test.js` 依赖 PhoneSession 默认 slot 0 语义，若个别断言需要微调允许在 Task 4 内同步改写（不许删除）。



