import { createIcons, Keyboard, ScanLine, Smartphone, Volume2, Wifi, WifiOff } from "lucide";

const icons = { Keyboard, ScanLine, Smartphone, Volume2, Wifi, WifiOff };

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

      <div class="objective" id="objective"><span>当前目标</span><strong>寻找备用保险丝</strong></div>
      <div class="reticle" id="reticle"><span></span></div>
      <div class="interaction-prompt" id="interaction-prompt" hidden><kbd>E</kbd><span></span></div>
      <div class="subtitle" id="subtitle" hidden></div>

      <section class="pairing-overlay" id="pairing-overlay">
        <div class="pairing-copy">
          <p class="desktop-eyebrow">手机即手电筒</p>
          <h1>Corridor 617</h1>
          <p>扫描二维码连接手机。体感控制视线，左侧摇杆移动。</p>
          <div class="pairing-status" id="pairing-status"><span></span>正在创建安全会话</div>
          <button class="start-button" id="start-button" hidden><i data-lucide="volume-2"></i>进入走廊</button>
          <button class="fallback-button" id="fallback-button"><i data-lucide="keyboard"></i>使用键鼠测试</button>
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
      <section class="completion-overlay" id="completion-overlay" hidden>
        <p class="desktop-eyebrow">电梯门已关闭</p><h2>你离开了 617</h2><button id="restart-button">重新开始</button>
      </section>
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
    connection: root.querySelector(".desktop-connection"),
    objective: root.querySelector("#objective strong"),
    reticle: root.querySelector("#reticle"),
    prompt: root.querySelector("#interaction-prompt"),
    promptLabel: root.querySelector("#interaction-prompt span"),
    subtitle: root.querySelector("#subtitle"),
    loading: root.querySelector("#loading-overlay"),
    pause: root.querySelector("#pause-overlay"),
    completion: root.querySelector("#completion-overlay"),
    restartButton: root.querySelector("#restart-button"),
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
    setObjective(text) {
      elements.objective.textContent = text;
    },
    setPrompt(text) {
      elements.prompt.hidden = !text;
      elements.promptLabel.textContent = text ?? "";
    },
    setSubtitle(text, visible = true) {
      elements.subtitle.textContent = text;
      elements.subtitle.hidden = !visible || !text;
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
    showCompletion(show) {
      elements.completion.hidden = !show;
    },
  };
}
