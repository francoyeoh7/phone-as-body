const root = document.querySelector("#app");

if (location.pathname === "/controller") {
  import("./controller/ControllerApp.js").then(({ ControllerApp }) => {
    new ControllerApp(root).mount();
  });
} else {
  root.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;background:#080a0a;color:#e7e7df;font:16px system-ui">
    <p>Corridor 617 loading...</p>
  </main>`;
}
