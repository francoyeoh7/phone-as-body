import { createIcons, Keyboard, Mic, Package, RotateCcw, ScanLine, Smartphone, Volume2, Wifi, WifiOff } from "lucide";

const icons = { Keyboard, Mic, Package, RotateCcw, ScanLine, Smartphone, Volume2, Wifi, WifiOff };
const INVENTORY_WIDTH = 360;
const INVENTORY_HEIGHT = 72;
const INVENTORY_SLOT_SIZE = 52;
const INVENTORY_SLOT_GAP = 12;
const INVENTORY_CURSOR_RADIUS = 5;
const DOOR_DEFENSE_STATUS = Object.freeze({
  dormant: "抵住门",
  intro: "门锁正在松动",
  calibrating: "正在校准",
  awaiting: "抬起手机，抵住门",
  bracing: "坚持抵住门",
  unstable: "追踪不稳定，保持抵住门",
  failed: "没抵住，再来",
  secured: "门已锁住",
});

export function createDesktopUI(root) {
  root.innerHTML = `
    <main class="desktop-shell">
      <div class="scene-host" id="scene-host" aria-label="Corridor 617 游戏画面">
        <div class="scene-placeholder"></div>
      </div>

      <header class="game-header">
        <div class="location-mark"><strong>617</strong><span>东侧维护走廊</span></div>
        <div class="desktop-connection" data-connected="false"><i data-lucide="wifi-off"></i><span>等待手机</span></div>
      </header>

      <div class="inventory-bar" id="inventory-bar" role="listbox" aria-label="物品栏" hidden>
        <div class="inventory-items" id="inventory-items"></div>
        <span class="inventory-cursor" id="inventory-cursor" aria-hidden="true"></span>
      </div>

      <div class="objective" id="objective"><span>当前目标</span><strong>寻找备用保险丝</strong></div>
      <div class="reticle" id="reticle"><span></span></div>
      <div class="interaction-prompt" id="interaction-prompt" hidden><kbd>E</kbd><span></span></div>
      <div class="subtitle" id="subtitle" hidden></div>
      <div class="voice-recording" id="voice-recording" role="status" aria-label="正在录音" hidden>
        <i data-lucide="mic"></i>
      </div>
      <div class="door-defense" id="door-defense" hidden>
        <span id="door-defense-status">抵住门</span>
        <div class="door-defense-track" role="progressbar" aria-labelledby="door-defense-status" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span></span>
        </div>
      </div>

      <section class="pairing-overlay" id="pairing-overlay">
        <div class="pairing-copy">
          <p class="desktop-eyebrow">手机即手电筒</p>
          <h1>Corridor 617</h1>
          <p>扫描二维码连接手机。整块屏幕按住拖动行走与转向，轻点进行交互。</p>
          <div class="pairing-status" id="pairing-status"><span></span>正在创建安全会话</div>
          <button class="start-button" id="start-button" hidden><i data-lucide="volume-2"></i>进入走廊</button>
          <button class="fallback-button" id="fallback-button"><i data-lucide="keyboard"></i>使用键鼠测试</button>
          <button class="scene-retry-button" id="scene-retry-button" hidden><i data-lucide="rotate-ccw"></i>重试</button>
        </div>
        <div class="qr-panel">
          <div class="qr-frame">
            <div class="qr-loading"><i data-lucide="scan-line"></i></div>
            <img id="pairing-qr" alt="手机控制器二维码" hidden>
          </div>
          <div class="room-row"><span>房间码</span><strong id="room-code">------</strong></div>
          <div class="phone-hint"><i data-lucide="smartphone"></i><span>同一网络或 HTTPS 地址</span></div>
        </div>
      </section>

      <section class="loading-overlay" id="loading-overlay" hidden>
        <span class="loading-line"></span><p>走廊正在苏醒</p>
      </section>

      <section class="pause-overlay" id="pause-overlay" hidden><p>暂停</p></section>
    </main>`;

  createIcons({ icons, attrs: { "stroke-width": 1.8 } });

  const elements = {
    sceneHost: root.querySelector("#scene-host"),
    pairing: root.querySelector("#pairing-overlay"),
    qr: root.querySelector("#pairing-qr"),
    qrLoading: root.querySelector(".qr-loading"),
    roomCode: root.querySelector("#room-code"),
    pairingStatus: root.querySelector("#pairing-status"),
    startButton: root.querySelector("#start-button"),
    fallbackButton: root.querySelector("#fallback-button"),
    sceneRetryButton: root.querySelector("#scene-retry-button"),
    connection: root.querySelector(".desktop-connection"),
    objective: root.querySelector("#objective strong"),
    reticle: root.querySelector("#reticle"),
    prompt: root.querySelector("#interaction-prompt"),
    promptLabel: root.querySelector("#interaction-prompt span"),
    subtitle: root.querySelector("#subtitle"),
    voiceRecording: root.querySelector("#voice-recording"),
    inventoryBar: root.querySelector("#inventory-bar"),
    inventoryItems: root.querySelector("#inventory-items"),
    inventoryCursor: root.querySelector("#inventory-cursor"),
    doorDefense: root.querySelector("#door-defense"),
    doorDefenseStatus: root.querySelector("#door-defense-status"),
    doorDefenseTrack: root.querySelector(".door-defense-track"),
    doorDefenseFill: root.querySelector(".door-defense-track > span"),
    loading: root.querySelector("#loading-overlay"),
    pause: root.querySelector("#pause-overlay"),
  };
  let inventoryItems = [];
  let inventoryRects = [];
  const inventoryBounds = { width: INVENTORY_WIDTH, height: INVENTORY_HEIGHT };
  const inventoryCursor = { x: INVENTORY_WIDTH / 2, y: INVENTORY_HEIGHT / 2 };

  const renderInventoryItems = (equippedId = null, hoveredId = null) => {
    elements.inventoryItems.innerHTML = inventoryItems.map((item) => `
      <span class="inventory-slot" role="option" aria-label="${item.id}" data-inventory-id="${item.id}"
        data-enabled="${item.enabled !== false}" data-equipped="${item.id === equippedId}"
        data-hovered="${item.id === hoveredId}" aria-selected="${item.id === equippedId}">
        <i data-lucide="package"></i>
      </span>`).join("");
    createIcons({ icons, attrs: { "stroke-width": 1.8 } });
  };

  const positionInventoryCursor = () => {
    elements.inventoryCursor.style.transform = `translate3d(${inventoryCursor.x}px, ${inventoryCursor.y}px, 0)`;
  };

  const itemAtInventoryCursor = () => inventoryRects.find((rect) => (
    inventoryCursor.x >= rect.left
      && inventoryCursor.x <= rect.right
      && inventoryCursor.y >= rect.top
      && inventoryCursor.y <= rect.bottom
  ))?.id ?? null;

  const updateInventoryHover = () => {
    const hoveredId = itemAtInventoryCursor();
    for (const slot of elements.inventoryItems.querySelectorAll?.("[data-inventory-id]") ?? []) {
      slot.dataset.hovered = String(slot.dataset.inventoryId === hoveredId);
    }
    return hoveredId;
  };

  return {
    elements,
    setRoom({ code, url, qrDataUrl }) {
      elements.roomCode.textContent = code;
      elements.qr.src = qrDataUrl;
      elements.qr.dataset.controllerUrl = url;
      elements.qr.hidden = false;
      elements.qrLoading.hidden = true;
      elements.pairingStatus.innerHTML = "<span></span>打开手机相机扫描";
    },
    setConnected(connected) {
      elements.connection.dataset.connected = String(connected);
      elements.connection.innerHTML = connected
        ? '<i data-lucide="wifi"></i><span>手机已连接</span>'
        : '<i data-lucide="wifi-off"></i><span>手机已断开</span>';
      elements.pairingStatus.innerHTML = connected ? "<span></span>控制器已就绪" : "<span></span>等待手机重新连接";
      elements.startButton.hidden = !connected;
      createIcons({ icons, attrs: { "stroke-width": 1.8 } });
    },
    showSceneError(error = null) {
      elements.pairingStatus.dataset.state = error ? "error" : "idle";
      if (error?.message) elements.pairingStatus.textContent = error.message;
      elements.sceneRetryButton.hidden = error?.retryable !== true;
    },
    setObjective(text) {
      elements.objective.textContent = text;
    },
    setPrompt(text) {
      elements.prompt.hidden = !text;
      elements.promptLabel.textContent = text ?? "";
    },
    setTargetFocused(focused) {
      elements.reticle.dataset.focused = String(Boolean(focused));
    },
    setSubtitle(text, visible = true) {
      elements.subtitle.textContent = text;
      elements.subtitle.hidden = !visible || !text;
    },
    setVoiceRecording(active) {
      elements.voiceRecording.hidden = !active;
    },
    setInventory(snapshot = {}) {
      elements.inventoryBar.hidden = false;
      const bounds = elements.inventoryBar.getBoundingClientRect?.();
      inventoryBounds.width = Number.isFinite(bounds?.width) && bounds.width > INVENTORY_CURSOR_RADIUS * 2
        ? bounds.width
        : INVENTORY_WIDTH;
      inventoryBounds.height = Number.isFinite(bounds?.height) && bounds.height > INVENTORY_CURSOR_RADIUS * 2
        ? bounds.height
        : INVENTORY_HEIGHT;
      inventoryItems = Array.isArray(snapshot.items) ? snapshot.items.map((item) => ({ ...item })) : [];
      const totalWidth = inventoryItems.length > 0
        ? inventoryItems.length * INVENTORY_SLOT_SIZE + (inventoryItems.length - 1) * INVENTORY_SLOT_GAP
        : 0;
      const firstLeft = (inventoryBounds.width - totalWidth) / 2;
      const top = (inventoryBounds.height - INVENTORY_SLOT_SIZE) / 2;
      inventoryRects = inventoryItems.map((item, index) => {
        const left = firstLeft + index * (INVENTORY_SLOT_SIZE + INVENTORY_SLOT_GAP);
        return { id: item.id, left, right: left + INVENTORY_SLOT_SIZE, top, bottom: top + INVENTORY_SLOT_SIZE };
      });
      const initialId = inventoryItems.some((item) => item.id === snapshot.equippedId)
        ? snapshot.equippedId
        : inventoryItems[0]?.id ?? null;
      const initialRect = inventoryRects.find((rect) => rect.id === initialId);
      inventoryCursor.x = initialRect ? (initialRect.left + initialRect.right) / 2 : inventoryBounds.width / 2;
      inventoryCursor.y = initialRect ? (initialRect.top + initialRect.bottom) / 2 : inventoryBounds.height / 2;
      renderInventoryItems(snapshot.equippedId, initialId);
      positionInventoryCursor();
      return initialId;
    },
    moveInventoryCursor(dx, dy) {
      inventoryCursor.x = Math.min(
        inventoryBounds.width - INVENTORY_CURSOR_RADIUS,
        Math.max(INVENTORY_CURSOR_RADIUS, inventoryCursor.x + (Number.isFinite(dx) ? dx : 0))
      );
      inventoryCursor.y = Math.min(
        inventoryBounds.height - INVENTORY_CURSOR_RADIUS,
        Math.max(INVENTORY_CURSOR_RADIUS, inventoryCursor.y + (Number.isFinite(dy) ? dy : 0))
      );
      positionInventoryCursor();
      return updateInventoryHover();
    },
    inventoryItemAtCursor() {
      return itemAtInventoryCursor();
    },
    closeInventory() {
      elements.inventoryBar.hidden = true;
    },
    setDoorDefense({ visible = false, progress = 0, status = "dormant" } = {}) {
      const normalizedProgress = Number.isFinite(progress)
        ? Math.min(1, Math.max(0, progress))
        : 0;
      elements.doorDefense.hidden = !visible;
      elements.doorDefense.dataset.state = status;
      elements.doorDefenseTrack.dataset.state = status;
      elements.doorDefenseTrack.setAttribute("aria-valuenow", String(Math.round(normalizedProgress * 100)));
      elements.doorDefenseFill.style.transform = `scaleX(${normalizedProgress})`;
      elements.doorDefenseStatus.textContent = DOOR_DEFENSE_STATUS[status] ?? DOOR_DEFENSE_STATUS.dormant;
    },
    showPairing(show) {
      elements.pairing.hidden = !show;
    },
    showLoading(show) {
      elements.loading.hidden = !show;
    },
    showPause(show) {
      elements.pause.hidden = !show;
    },
  };
}
