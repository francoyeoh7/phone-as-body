
  window.addEventListener("error", (event) => {
    document.getElementById("error").textContent += `\n[错误] ${event.message} @ ${event.filename}:${event.lineno}`;
  });
  window.addEventListener("unhandledrejection", (event) => {
    document.getElementById("error").textContent += `\n[Promise] ${event.reason?.message ?? event.reason}`;
  });


import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const statusEl = document.getElementById("status");
const say = (text) => { statusEl.textContent = text; };

try {
  say("初始化渲染器…");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3442);
  scene.add(new THREE.HemisphereLight(0xbfd0e8, 0x3a342c, 1.6));
  const key = new THREE.DirectionalLight(0xfff2d8, 2.6);
  key.position.set(3, 6, 4);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fb0ff, 0.9);
  fill.position.set(-4, 3, -3);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x3a4038, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(10, 10, 0x555555, 0x333a33);
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(0, 1.8, 4.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.95, 0);

  const loader = new GLTFLoader();
  const characters = [];
  const ids = ["bandit", "bubba", "survival"];
  const report = [];
  for (let i = 0; i < ids.length; i += 1) {
    say(`加载 ${ids[i]}…`);
    const gltf = await loader.loadAsync(`/assets/characters/${ids[i]}.glb`);
    const root = gltf.scene;
    root.position.set((i - 1) * 1.7, 0, 0);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    characters.push({ id: ids[i], mixer, clips: gltf.animations, action: null });
    let triangles = 0;
    root.traverse((o) => {
      if (o.isMesh) {
        const geometry = o.geometry;
        triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
      }
    });
    report.push(`${ids[i]}: ${Math.round(triangles / 1000)}k 三角形, ${gltf.animations.length} 个动画`);
  }

  let current = "idle";
  function play(name) {
    current = name;
    for (const character of characters) {
      const clip = character.clips.find((c) => c.name === name) ?? character.clips[0];
      if (!clip) continue;
      character.mixer.stopAllAction();
      character.action = character.mixer.clipAction(clip);
      character.action.play();
    }
    for (const button of document.querySelectorAll("#hud button")) {
      button.classList.toggle("active", button.dataset.anim === name);
    }
  }
  play("idle");
  document.querySelectorAll("#hud button").forEach((button) => {
    button.addEventListener("click", () => play(button.dataset.anim));
  });

  say(`就绪。\n${report.join("\n")}`);

  const clock = new THREE.Clock();
  let frames = 0;
  let fpsTime = 0;
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    for (const character of characters) character.mixer.update(delta);
    controls.update();
    renderer.render(scene, camera);
    frames += 1;
    fpsTime += delta;
    if (fpsTime > 0.5) {
      document.getElementById("fps").textContent = `${Math.round(frames / fpsTime)} fps`;
      frames = 0;
      fpsTime = 0;
    }
  });
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
} catch (error) {
  document.getElementById("error").textContent = `[启动失败] ${error.message}\n${error.stack ?? ""}`;
  say("失败");
}
