import { createIcons, RadioTower, Smartphone, Wifi } from "lucide";
import { PhoneSession } from "../desktop/PhoneSession.js";
import { createStoppedControllerInput } from "./stop-input.js";
import "./styles.css";

const icons = { RadioTower, Smartphone, Wifi };

export class UeBridgeApp {
  constructor(root) {
    this.root = root;
    this.phone = null;
    this.target = null;
    this.inputInFlight = false;
    this.latestInput = null;
    this.lastInputSeq = -1;
    this.destroy = this.destroy.bind(this);
  }

  async mount() {
    this.root.innerHTML = `
      <main class="ue-bridge-shell">
        <section class="bridge-panel">
          <div class="bridge-heading">
            <i data-lucide="radio-tower"></i>
            <div>
              <p>手机即身体</p>
              <h1>UE 手机控制桥</h1>
            </div>
          </div>
          <div class="bridge-status" data-state="waiting">
            <span></span>
            <strong id="bridge-status-label">正在创建房间</strong>
          </div>
          <div class="bridge-layout">
            <div class="bridge-qr">
              <div class="qr-loading"><i data-lucide="wifi"></i></div>
              <img id="bridge-qr-image" alt="手机控制器二维码" hidden>
            </div>
            <div class="bridge-copy">
              <div>
                <span>房间码</span>
                <strong id="bridge-room">------</strong>
              </div>
              <div>
                <span>UE 输入端口</span>
                <strong id="bridge-target">127.0.0.1:61717</strong>
              </div>
              <p id="bridge-url">等待二维码生成</p>
            </div>
          </div>
          <div class="bridge-phone">
            <i data-lucide="smartphone"></i>
            <span>手机端仍然是整屏控制：长按拖动移动，短按交互，陀螺仪转向。</span>
          </div>
        </section>
      </main>`;

    createIcons({ icons, attrs: { "stroke-width": 1.8 } });
    this.cacheElements();
    await this.loadTarget();
    this.phone = new PhoneSession();
    this.phone.addEventListener("room", ({ detail }) => this.setRoom(detail));
    this.phone.addEventListener("peer", ({ detail }) => this.setConnected(detail.connected));
    this.phone.addEventListener("input", ({ detail }) => this.queueInput(detail));
    this.phone.addEventListener("action", ({ detail }) => this.sendAction(detail));
    this.phone.addEventListener("error", ({ detail }) => this.setStatus("error", detail));
    this.phone.start();
    window.addEventListener("pagehide", this.destroy, { once: true });
  }

  cacheElements() {
    this.status = this.root.querySelector(".bridge-status");
    this.statusLabel = this.root.querySelector("#bridge-status-label");
    this.qr = this.root.querySelector("#bridge-qr-image");
    this.qrLoading = this.root.querySelector(".qr-loading");
    this.room = this.root.querySelector("#bridge-room");
    this.url = this.root.querySelector("#bridge-url");
    this.targetLabel = this.root.querySelector("#bridge-target");
  }

  async loadTarget() {
    try {
      const response = await fetch("/api/ue-bridge/config");
      const config = await response.json();
      this.target = config.target;
      if (this.target?.host && this.target?.port) this.targetLabel.textContent = `${this.target.host}:${this.target.port}`;
    } catch {
      this.targetLabel.textContent = "127.0.0.1:61717";
    }
  }

  setRoom({ code, url, qrDataUrl }) {
    this.room.textContent = code;
    this.url.textContent = url;
    this.qr.src = qrDataUrl;
    this.qr.hidden = false;
    this.qrLoading.hidden = true;
    this.setStatus("ready", "等待手机扫码");
  }

  setConnected(connected) {
    this.setStatus(connected ? "connected" : "ready", connected ? "手机已连接" : "等待手机扫码");
    if (!connected) this.queueInput(createStoppedControllerInput(this.lastInputSeq));
  }

  setStatus(state, label) {
    this.status.dataset.state = state;
    this.statusLabel.textContent = label;
  }

  queueInput(input) {
    if (Number.isInteger(input?.seq)) this.lastInputSeq = Math.max(this.lastInputSeq, input.seq);
    this.latestInput = input;
    if (!this.inputInFlight) void this.flushInput();
  }

  async flushInput() {
    const input = this.latestInput;
    this.latestInput = null;
    if (!input) return;
    this.inputInFlight = true;
    await this.postJson("/api/ue-bridge/input", input);
    this.inputInFlight = false;
    if (this.latestInput) void this.flushInput();
  }

  sendAction(action) {
    void this.postJson("/api/ue-bridge/action", action);
  }

  async postJson(url, body) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok === false) this.setStatus("error", "桥接发送失败");
    } catch {
      this.setStatus("error", "桥接服务不可用");
    }
  }

  destroy() {
    this.phone?.destroy();
  }
}
