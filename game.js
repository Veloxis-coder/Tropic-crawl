import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const R = 30;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 20, 120);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 300);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));
scene.add(new THREE.HemisphereLight(0xffffff, 0x446644, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(10, 20, 5);
scene.add(sun);

const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x1e6fa8 }));
sea.rotation.x = -Math.PI / 2; sea.position.y = -2;
scene.add(sea);
const island = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 2, 2, 40), new THREE.MeshLambertMaterial({ color: 0xd9c27a }));
island.position.y = -1;
scene.add(island);

const solids = [];
function addBox(x, y, z, w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y + h / 2, z);
  scene.add(m);
  solids.push(new THREE.Box3().setFromObject(m));
}
for (let i = 0; i < 14; i++) {
  const a = Math.random() * 6.28, r = 6 + Math.random() * 20;
  addBox(Math.cos(a) * r, 0, Math.sin(a) * r, 1.5 + Math.random() * 2, 1 + Math.random() * 3, 1.5 + Math.random() * 2, 0x777777);
}
for (let i = 0; i < 16; i++) {
  const a = Math.random() * 6.28, r = 5 + Math.random() * 23;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  addBox(x, 0, z, 0.5, 5, 0.5, 0x6b4423);
  addBox(x, 5, z, 3, 0.4, 3, 0x2e8b3d);
}
addBox(0, 0, -R + 2, 6, 0.3, 3, 0x8b5a2b);

const items = [];
function addItem(type, color, x, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(type === 'part' ? 0.22 : 0.15, 16, 16), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, 1.2, z);
  scene.add(m);
  items.push({ type, m });
}
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * 6.28 + 0.5;
  addItem('part', 0xffd400, Math.cos(a) * 18, Math.sin(a) * 18);
}
for (let i = 0; i < 12; i++) {
  const a = Math.random() * 6.28, r = 4 + Math.random() * 22;
  addItem('food', 0xe0302c, Math.cos(a) * r, Math.sin(a) * r);
}

const hud = document.createElement('canvas'); hud.width = 512; hud.height = 128;
const hctx = hud.getContext('2d');
const htex = new THREE.CanvasTexture(hud);
const hmesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1), new THREE.MeshBasicMaterial({ map: htex, transparent: true, depthTest: false }));
hmesh.position.set(0, -0.25, -0.8); hmesh.renderOrder = 10;
camera.add(hmesh);
function drawHud(msg) {
  hctx.clearRect(0, 0, 512, 128);
  hctx.fillStyle = 'rgba(0,0,0,0.6)'; hctx.fillRect(0, 0, 512, 128);
  hctx.fillStyle = '#fff'; hctx.font = '32px sans-serif';
  hctx.fillText(msg || `Energy ${Math.max(0, energy | 0)}  Parts ${parts}/3`, 16, 50);
  hctx.font = '24px sans-serif';
  hctx.fillText(parts < 3 ? 'Find 3 yellow raft parts' : 'Go to the dock at the north edge!', 16, 95);
  htex.needsUpdate = true;
}

let energy = 100, parts = 0, over = false, msgTimer = 0;
const hands = [0, 1].map(i => {
  const g = renderer.xr.getControllerGrip(i);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshLambertMaterial({ color: i ? 0xff8844 : 0x44aaff })));
  rig.add(g);
  return { g, prev: new THREE.Vector3(), has: false, touching: false };
});
const vel = new THREE.Vector3();
const tmp = new THREE.Vector3();

function touching(p) {
  if (p.y < 0.04 && Math.hypot(p.x, p.z) < R) return true;
  const b = new THREE.Box3(new THREE.Vector3(p.x - 0.07, p.y - 0.07, p.z - 0.07), new THREE.Vector3(p.x + 0.07, p.y + 0.07, p.z + 0.07));
  return solids.some(s => s.intersectsBox(b));
}
function reset(msg) {
  rig.position.set(0, 0, 0); vel.set(0, 0, 0); energy = 100; parts = 0; over = false;
  items.forEach(i => (i.m.visible = true));
  msgTimer = 3; drawHud(msg);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  let pushed = false;
  hands.forEach(h => {
    const local = h.g.position.clone();
    const world = local.clone().add(rig.position);
    const t = touching(world);
    if (t && h.has && h.touching) {
      tmp.copy(h.prev).sub(local);
      rig.position.add(tmp);
      vel.copy(tmp).divideScalar(Math.max(dt, 0.001));
      pushed = true;
    }
    h.touching = t; h.prev.copy(local); h.has = true;
  });
  if (!pushed) {
    vel.y -= 9.8 * dt;
    vel.clampLength(0, 12);
    rig.position.addScaledVector(vel, dt);
    const onIsland = Math.hypot(rig.position.x, rig.position.z) < R;
    if (onIsland && rig.position.y < 0) { rig.position.y = 0; vel.y = 0; vel.multiplyScalar(0.9); }
  }
  if (rig.position.y < -4 && !over) reset('You fell in the sea! Restarting...');
  energy -= dt * 0.4;
  if (energy <= 0 && !over) reset('Out of energy! Restarting...');
  hands.forEach(h => {
    const w = h.g.position.clone().add(rig.position);
    items.forEach(it => {
      if (it.m.visible && it.m.position.distanceTo(w) < 0.3) {
        it.m.visible = false;
        if (it.type === 'part') parts++; else energy = Math.min(100, energy + 25);
      }
    });
  });
  if (parts === 3 && rig.position.distanceTo(new THREE.Vector3(0, 0.3, -R + 2)) < 3 && !over) {
    over = true; msgTimer = 999; drawHud('YOU ESCAPED! Raft built!');
  }
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) drawHud(); } else if (!over) drawHud();
  items.forEach(i => (i.m.rotation.y += dt));
  renderer.render(scene, camera);
});
drawHud();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
