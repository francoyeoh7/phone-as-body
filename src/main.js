const root = document.querySelector("#app");

root.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;background:#080a0a;color:#e7e7df;font:16px system-ui">
  <p>${location.pathname === "/controller" ? "Controller loading..." : "Corridor 617 loading..."}</p>
</main>`;
