const root = document.querySelector("#app");

if (location.pathname === "/controller") {
  import("./controller/ControllerApp.js").then(({ ControllerApp }) => {
    new ControllerApp(root).mount();
  });
} else {
  import("./desktop/DesktopApp.js").then(({ DesktopApp }) => {
    new DesktopApp(root).mount();
  });
}
