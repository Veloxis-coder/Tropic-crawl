import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// ---- Gorilla Tag style locomotion settings (tune these) ----
const VELOCITY_HISTORY_SIZE = 6;
const VELOCITY_LIMIT = 0.0;
const MAX_JUMP_SPEED = 6.5;
const JUMP_MULTIPLIER = 1.1;
const MAX_ARM_LENGTH = 1.5;
const HAND_RADIUS = 0.05;
const HEAD_RADIUS = 0.15;
const GRAVITY = 9.8;

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
let energy = 100, parts = 0, over = false, msgTimer = 0;
function drawHud(msg) {
  hctx.clearRect(0, 0, 512, 128);
  hctx.fillStyle = 'rgba(0,0,0,0.6)'; hctx.fillRect(0, 0, 512, 128);
  hctx.fillStyle = '#fff'; hctx.font = '32px sans-serif';
  hctx.fillText(msg || `Energy ${Math.max(0, energy | 0)}  Parts ${parts}/3`, 16, 50);
  hctx.font = '24px sans-serif';
  hctx.fillText(parts < 3 ? 'Find 3 yellow raft parts' : 'Go to the dock at the north edge!', 16, 95);
  htex.needsUpdate = true;
}

// Hands: tracked controller (rig-local) + a visible "follower" sphere that stops at surfaces.
const hands = [0, 1].map(i => {
  const g = renderer.xr.getControllerGrip(i);
  rig.add(g);
  const follower = new THREE.Mesh(new THREE.SphereGeometry(HAND_RADIUS * 1.2), new THREE.MeshLambertMaterial({ color: i ? 0xff8844 : 0x44aaff }));
  scene.add(follower);
  return { g, follower, lastFollower: new THREE.Vector3(), has: false, colliding: false };
});

// Returns push-out vector (to move a sphere of radius r out of geometry) or null.
const _c = new THREE.Vector3();
function pushOut(p, r) {
  let best = null;
  if (Math.hypot(p.x, p.z) < R && p.y < r && p.y > -2) best = new THREE.Vector3(0, r - p.y, 0);
  for (const b of solids) {
    b.clampPoint(p, _c);
    const d = _c.distanceTo(p);
    let push = null;
    if (d < r && d > 1e-5) push = p.clone().sub(_c).normalize().multiplyScalar(r - d);
    else if (d <= 1e-5 && b.containsPoint(p)) push = new THREE.Vector3(0, b.max.y - p.y + r, 0);
    if (push && (!best || push.length() > best.length())) best = push;
  }
  return best;
}

const vel = new THREE.Vector3();
const history = Array.from({ length: VELOCITY_HISTORY_SIZE }, () => new THREE.Vector3());
let hIndex = 0;
const lastRig = new THREE.Vector3();
const head = new THREE.Vector3();
const movement = new THREE.Vector3();
const tmp = new THREE.Vector3();

function reset(msg) {
  rig.position.set(0, 0, 0); vel.set(0, 0, 0); energy = 100; parts = 0; over = false;
  history.forEach(v => v.set(0, 0, 0));
  hands.forEach(h => (h.has = false));
  items.forEach(i => (i.m.visible = true));
  msgTimer = 3; drawHud(msg);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.max(Math.min(clock.getDelta(), 0.05), 0.001);
  camera.getWorldPosition(head);
  movement.set(0, 0, 0);
  let anyColliding = false;

  hands.forEach(h => {
    tmp.copy(h.g.position).add(rig.position);
    const tracked = tmp.clone();
    if (!h.has) { h.lastFollower.copy(tracked); h.follower.position.copy(tracked); h.has = true; }
    const tooFar = tracked.distanceTo(head) > MAX_ARM_LENGTH;
    const push = tooFar ? null : pushOut(tracked, HAND_RADIUS);
    if (push) {
      const contact = tracked.clone().add(push);
      movement.add(h.lastFollower.clone().sub(tracked));
      h.lastFollower.copy(contact);
      h.follower.position.copy(contact);
      h.colliding = true; anyColliding = true;
    } else {
      h.lastFollower.copy(tracked);
      h.follower.position.copy(tracked);
      h.colliding = false;
    }
  });

  if (anyColliding) {
    rig.position.add(movement);
    vel.set(0, 0, 0);
  } else {
    vel.y -= GRAVITY * dt;
    rig.position.addScaledVector(vel, dt);
  }

  // Head collider (the body is the head sphere, like the real game)
  camera.getWorldPosition(head);
  const hp = pushOut(head, HEAD_RADIUS);
  if (hp) {
    rig.position.add(hp);
    const n = hp.clone().normalize();
    const into = vel.dot(n);
    if (into < 0) vel.addScaledVector(n, -into);
  }

  // Velocity history -> launch velocity while hands are on a surface
  tmp.copy(rig.position).sub(lastRig).divideScalar(dt);
  history[hIndex] = tmp.clone();
  hIndex = (hIndex + 1) % VELOCITY_HISTORY_SIZE;
  lastRig.copy(rig.position);
  const avg = new THREE.Vector3();
  history.forEach(v => avg.add(v));
  avg.divideScalar(VELOCITY_HISTORY_SIZE);
  if (anyColliding && avg.length() > VELOCITY_LIMIT) {
    if (avg.length() * JUMP_MULTIPLIER > MAX_JUMP_SPEED) vel.copy(avg).normalize().multiplyScalar(MAX_JUMP_SPEED);
    else vel.copy(avg).multiplyScalar(JUMP_MULTIPLIER);
  }

  if (rig.position.y < -4 && !over) reset('You fell in the sea! Restarting...');
  energy -= dt * 0.4;
  if (energy <= 0 && !over) reset('Out of energy! Restarting...');
  hands.forEach(h => {
    items.forEach(it => {
      if (it.m.visible && it.m.position.distanceTo(h.follower.position) < 0.3) {
        it.m.visible = false;
        if (it.type === 'part') parts++; else energy = Math.min(100, energy + 25);
      }
    });
  });
  if (parts === 3 && !over && Math.hypot(rig.position.x, rig.position.z + R - 2) < 3) {
    over = true; msgTimer = 999; drawHud('YOU ESCAPED! Raft built!');
  }
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) drawHud(); } else if (!over) drawHud();
  items.forEach(i => (i.m.rotation.y += dt));
  renderer.render(scene, camera);
});
drawHud();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
