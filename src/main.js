const root = document.querySelector("#app");

if (import.meta.env.DEV && location.pathname === "/visual-test") {
  root.innerHTML = `
    <main style="min-height:100vh;margin:0;padding:18px;display:flex;align-items:flex-start;justify-content:center;gap:28px;background:#161918;color:#e8e8df;font:12px system-ui;overflow:hidden">
      <section><p style="margin:0 0 8px">390 x 844</p><div style="width:292.5px;height:633px;overflow:hidden"><iframe title="portrait" src="/controller?preview=1" style="width:390px;height:844px;border:0;transform:scale(.75);transform-origin:top left"></iframe></div></section>
      <section><p style="margin:0 0 8px">844 x 390</p><div style="width:633px;height:292.5px;overflow:hidden"><iframe title="landscape" src="/controller?preview=1" style="width:844px;height:390px;border:0;transform:scale(.75);transform-origin:top left"></iframe></div></section>
    </main>`;
} else if (location.pathname === "/controller") {
  import("./controller/ControllerApp.js").then(({ ControllerApp }) => {
    const app = new ControllerApp(root);
    if (import.meta.env.DEV) window.__corridorController = app;
    app.mount();
  });
} else if (location.pathname === "/ue-bridge") {
  import("./ue-bridge/UeBridgeApp.js").then(({ UeBridgeApp }) => {
    const app = new UeBridgeApp(root);
    if (import.meta.env.DEV) window.__corridorUeBridge = app;
    app.mount();
  });
} else {
  import("./desktop/DesktopApp.js").then(({ DesktopApp }) => {
    const app = new DesktopApp(root);
    if (import.meta.env.DEV) window.__corridor617 = app;
    app.mount();
  });
}
