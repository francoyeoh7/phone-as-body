const root = document.querySelector("#app");

if (location.pathname === "/controller") {
  import("./controller/ControllerApp.js").then(({ ControllerApp }) => {
    const app = new ControllerApp(root);
    if (import.meta.env.DEV) window.__corridorController = app;
    app.mount();
  });
} else {
  import("./desktop/DesktopApp.js").then(({ DesktopApp }) => {
    const app = new DesktopApp(root);
    if (import.meta.env.DEV) window.__corridor617 = app;
    app.mount();
  });
}
