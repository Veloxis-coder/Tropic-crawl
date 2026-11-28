import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CONFIG } from './config.js';

export class Game {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.colliders = [];
    this.rig = new THREE.Group();
    this.rig.position.set(CONFIG.spawn.x, CONFIG.spawn.y, CONFIG.spawn.z);
    scene.add(this.rig);
    this.rig.add(camera);
    camera.position.set(0, 1.6, 0);

    this.hands = [0, 1].map((i) => {
      const c = renderer.xr.getController(i);
      this.rig.add(c);
      return c;
    });

    this.buildPlayerModel();

    this.velocity = new THREE.Vector3();
    this.history = [];
    this.last = [new THREE.Vector3(), new THREE.Vector3()];
    this.tmp = [new THREE.Vector3(), new THREE.Vector3()];
    this.started = false;
    this.grounded = false;

    this.buildRoom();
  }

  // Gorilla Tag style: floating head, chest/torso, arms and hands. No legs.
  buildPlayerModel() {
    const fur = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.95 });
    const chestMat = new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.95 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.9 });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.model = new THREE.Group();
    this.scene.add(this.model);

    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), fur);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), faceMat);
    muzzle.position.set(0, -0.04, -0.1);
    muzzle.scale.set(1.2, 0.85, 0.8);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.05), fur);
    brow.position.set(0, 0.045, -0.12);
    this.headMesh.add(muzzle, brow);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), white);
      eye.position.set(sx * 0.05, 0.015, -0.125);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), black);
      pupil.position.set(sx * 0.05, 0.015, -0.14);
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), black);
      nostril.position.set(sx * 0.02, -0.03, -0.17);
      this.headMesh.add(eye, pupil, nostril);
    }

    this.torso = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), chestMat);
    this.torso.scale.set(0.3, 0.36, 0.2);
    this.shoulders = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), fur);
      this.model.add(m);
      return m;
    });
    this.model.add(this.headMesh, this.torso);

    this.handMeshes = [0, 1].map((i) => {
      const mat = new THREE.MeshStandardMaterial({ color: i === 0 ? 0x4c80ff : 0xff6650, roughness: 0.8 });
      const grp = new THREE.Group();
      const side = i === 0 ? -1 : 1;
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.09), mat));
      [0.05, 0.06, 0.055, 0.04].forEach((L, k) => {
        const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, L, 4, 8), mat);
        f.rotation.x = Math.PI / 2;
        f.position.set((k - 1.5) * 0.024, 0, -0.045 - L / 2);
        grp.add(f);
      });
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.04, 4, 8), mat);
      thumb.rotation.set(Math.PI / 2, 0, side * 0.9);
      thumb.position.set(-side * 0.055, 0, -0.02);
      grp.add(thumb);
      this.model.add(grp);
      return grp;
    });

    this.headMesh.visible = false;

    const armGeo = new THREE.CylinderGeometry(0.06, 0.05, 1, 12);
    this.arms = [0, 1].map(() => {
      const a = new THREE.Mesh(armGeo, fur);
      this.model.add(a);
      return a;
    });
  }

  updatePlayerModel(headPos, visHands) {
    const yawQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, new THREE.Euler().setFromQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y, 0, 'YXZ'));
    this.headMesh.position.copy(headPos);
    this.headMesh.quaternion.copy(yawQ);
    const chest = headPos.clone().add(new THREE.Vector3(0, -0.36, 0));
    this.torso.position.copy(chest);
    this.torso.quaternion.copy(yawQ);

    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const shoulder = new THREE.Vector3(side * 0.3, 0.1, 0).applyQuaternion(yawQ).add(chest);
      this.shoulders[i].position.copy(shoulder);
      const hand = visHands[i];
      this.handMeshes[i].position.copy(hand);
      this.handMeshes[i].quaternion.copy(this.hands[i].getWorldQuaternion(new THREE.Quaternion()));
      const dir = new THREE.Vector3().subVectors(hand, shoulder);
      const len = Math.max(dir.length(), 0.001);
      const arm = this.arms[i];
      arm.position.copy(shoulder).addScaledVector(dir, 0.5);
      arm.scale.set(1, len, 1);
      arm.quaternion.setFromUnitVectors(up, dir.divideScalar(len));
    }
  }

  addBox(name, x, y, z, sx, sy, sz, color, collide = true) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
    );
    mesh.name = name;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    if (collide) {
      this.colliders.push(new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(x, y, z), new THREE.Vector3(sx, sy, sz)));
    }
    return mesh;
  }

  buildRoom() {
    const { size: S, height: H, props, seed } = CONFIG.room;
    const h = S / 2;
    this.scene.background = new THREE.Color(0x151820);
    this.addBox('floor', 0, -0.1, 0, S, 0.2, S, 0x4f7a55);
    this.addBox('ceiling', 0, H + 0.1, 0, S, 0.2, S, 0xdddddd);
    this.addBox('wallS', 0, H / 2, -h - 0.1, S + 0.4, H, 0.2, 0xb3bfd9);
    this.addBox('wallE', h + 0.1, H / 2, 0, 0.2, H, S, 0xbfb3d9);
    this.addBox('wallW', -h - 0.1, H / 2, 0, 0.2, H, S, 0xbfb3d9);

    // seeded pseudo-random props (platforms, pillars, steps)
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const colors = [0xcc664d, 0x4db366, 0xe6cc4d, 0x5d8fd6, 0xb06bd1, 0xd18a4d];
    let placed = 0, tries = 0;
    while (placed < props && tries < 500) {
      tries++;
      const x = (rnd() - 0.5) * (S - 6);
      const z = (rnd() - 0.5) * (S - 6);
      if (Math.hypot(x, z) < 4) continue;
      const pillar = rnd() < 0.3;
      const sx = pillar ? 0.8 + rnd() * 0.6 : 1.5 + rnd() * 3;
      const sz = pillar ? 0.8 + rnd() * 0.6 : 1.5 + rnd() * 3;
      const sy = pillar ? H - 0.2 : 0.5 + rnd() * 2.5;
      this.addBox(pillar ? 'pillar' : 'platform', x, sy / 2, z, sx, sy, sz,
        colors[Math.floor(rnd() * colors.length)]);
      placed++;
    }

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, CONFIG.lights.ambient));

    const step = S / 3;
    for (const x of [-step, 0, step]) {
      for (const z of [-step, 0, step]) {
        const panel = this.addBox('lightPanel', x, H - 0.03, z, 1.6, 0.06, 1.6, 0xffffff, false);
        panel.material = new THREE.MeshStandardMaterial({
          color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2
        });
      }
    }
    for (const [x, z] of [[-S / 4, -S / 4], [S / 4, -S / 4], [-S / 4, S / 4], [S / 4, S / 4], [0, 0]]) {
      const l = new THREE.PointLight(0xfff7e6, CONFIG.lights.intensity, CONFIG.lights.range, 2);
      l.position.set(x, H - 0.5, z);
      this.scene.add(l);
    }
    this.buildHallway();
    this.buildGiantRoom();
    this.buildMirror();
  }

  buildMirror() {
    const w = 2, h = 2.4, x = 0, y = 1.4, z = -3.5;
    this.addBox('mirrorFrame', x, y, z - 0.06, w + 0.2, h + 0.2, 0.08, 0x2b2b30);
    this.mirror = new Reflector(new THREE.PlaneGeometry(w, h), {
      textureWidth: 1024, textureHeight: 1024, color: 0xcccccc,
    });
    this.mirror.position.set(x, y, z);
    this.scene.add(this.mirror);
    const orig = this.mirror.onBeforeRender;
    this.mirror.onBeforeRender = (...args) => {
      this.headMesh.visible = true;
      orig.apply(this.mirror, args);
      this.headMesh.visible = false;
    };
  }

  buildHallway() {
    const S = CONFIG.room.size, H = CONFIG.room.height, h = S / 2;
    const { width: W, doorHeight: DH, length: L, height: HH } = CONFIG.hall;
    const wallC = 0xb3bfd9;
    const sideW = (S + 0.4 - W) / 2;
    this.addBox('wallN_L', -(W / 2 + sideW / 2), H / 2, h + 0.1, sideW, H, 0.2, wallC);
    this.addBox('wallN_R', (W / 2 + sideW / 2), H / 2, h + 0.1, sideW, H, 0.2, wallC);
    this.addBox('wallN_top', 0, DH + (H - DH) / 2, h + 0.1, W, H - DH, 0.2, wallC);

    const z0 = h + 0.2, zc = z0 + L / 2;
    this.addBox('hallFloor', 0, -0.1, zc, W, 0.2, L, 0x6a6a74);
    this.addBox('hallCeil', 0, HH + 0.1, zc, W, 0.2, L, 0xdddddd);
    this.addBox('hallWallL', -W / 2 - 0.1, HH / 2, zc, 0.2, HH, L, 0x9aa6c4);
    this.addBox('hallWallR', W / 2 + 0.1, HH / 2, zc, 0.2, HH, L, 0x9aa6c4);

    for (let z = z0 + 3; z < z0 + L; z += 7) {
      const p = this.addBox('hallPanel', 0, HH - 0.03, z, 1.4, 0.06, 1.4, 0xffffff, false);
      p.material = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 });
      const l = new THREE.PointLight(0xfff7e6, CONFIG.lights.intensity * 0.5, 20, 2);
      l.position.set(0, HH - 0.5, z);
      this.scene.add(l);
    }
  }

  buildGiantRoom() {
    const S = CONFIG.room.size, h = S / 2;
    const { width: W, length: L, height: GH, pillars } = CONFIG.giant;
    const hall = CONFIG.hall;
    const zStart = h + 0.2 + hall.length;
    const zc = zStart + L / 2, zEnd = zStart + L;

    this.addBox('gFloor', 0, -0.1, zc, W, 0.2, L, 0x4a6a8a);
    this.addBox('gCeil', 0, GH + 0.1, zc, W, 0.2, L, 0xcccccc);
    this.addBox('gWallE', W / 2 + 0.1, GH / 2, zc, 0.2, GH, L, 0xbfb3d9);
    this.addBox('gWallW', -W / 2 - 0.1, GH / 2, zc, 0.2, GH, L, 0xbfb3d9);
    this.addBox('gWallFar', 0, GH / 2, zEnd + 0.1, W + 0.4, GH, 0.2, 0xb3bfd9);

    const sideW = (W + 0.4 - hall.width) / 2;
    this.addBox('gWallNear_L', -(hall.width / 2 + sideW / 2), GH / 2, zStart + 0.1, sideW, GH, 0.2, 0xb3bfd9);
    this.addBox('gWallNear_R', (hall.width / 2 + sideW / 2), GH / 2, zStart + 0.1, sideW, GH, 0.2, 0xb3bfd9);
    this.addBox('gWallNear_top', 0, hall.height + (GH - hall.height) / 2, zStart + 0.1, hall.width, GH - hall.height, 0.2, 0xb3bfd9);

    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const colors = [0xcc664d, 0x4db366, 0xe6cc4d, 0x5d8fd6, 0xb06bd1, 0xd18a4d];
    for (let i = 0; i < pillars * 2; i++) {
      const x = (rnd() - 0.5) * (W - 12);
      const z = zStart + 10 + rnd() * (L - 20);
      const pillar = i < pillars;
      const sx = pillar ? 1.5 + rnd() : 4 + rnd() * 6;
      const sz = pillar ? 1.5 + rnd() : 4 + rnd() * 6;
      const sy = pillar ? GH - 0.2 : 1 + rnd() * 8;
      this.addBox(pillar ? 'gPillar' : 'gPlatform', x, sy / 2, z, sx, sy, sz,
        colors[Math.floor(rnd() * colors.length)]);
    }

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 0.8));
    for (let x = -W / 3; x <= W / 3; x += W / 3) {
      for (let z = zStart + L / 6; z < zEnd; z += L / 3) {
        const p = this.addBox('gPanel', x, GH - 0.03, z, 4, 0.06, 4, 0xffffff, false);
        p.material = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 });
        const l = new THREE.PointLight(0xfff7e6, 400, 70, 2);
        l.position.set(x, GH - 1, z);
        this.scene.add(l);
      }
    }
  }

  hitsAnything(c, r) {
    const p = new THREE.Vector3();
    for (const b of this.colliders) {
      p.copy(c).clamp(b.min, b.max);
      if (p.distanceToSquared(c) < r * r) return true;
    }
    return false;
  }

  handBlocked(from, to, r) {
    const dist = from.distanceTo(to);
    const steps = Math.max(1, Math.ceil(dist / 0.03));
    const p = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      p.lerpVectors(from, to, i / steps);
      if (this.hitsAnything(p, r)) return true;
    }
    return false;
  }

  resolveSphere(center, r, onPush) {
    for (let it = 0; it < 4; it++) {
      let any = false;
      for (const b of this.colliders) {
        const p = center.clone().clamp(b.min, b.max);
        const d = center.distanceTo(p);
        if (d >= r) continue;
        let n, depth;
        if (d > 1e-6) {
          n = new THREE.Vector3().subVectors(center, p).divideScalar(d);
          depth = r - d;
        } else {
          const faces = [
            [center.x - b.min.x, new THREE.Vector3(-1, 0, 0)],
            [b.max.x - center.x, new THREE.Vector3(1, 0, 0)],
            [center.y - b.min.y, new THREE.Vector3(0, -1, 0)],
            [b.max.y - center.y, new THREE.Vector3(0, 1, 0)],
            [center.z - b.min.z, new THREE.Vector3(0, 0, -1)],
            [b.max.z - center.z, new THREE.Vector3(0, 0, 1)]
          ].sort((a, c) => a[0] - c[0])[0];
          n = faces[1].clone();
          depth = faces[0] + r;
        }
        const push = n.clone().multiplyScalar(depth);
        center.add(push);
        if (onPush) onPush(n, push);
        any = true;
      }
      if (!any) break;
    }
  }

  // Pushes the whole rig so head and chest spheres are never inside a surface.
  resolveBody() {
    const M = CONFIG.move;
    const onPush = (n, push) => {
      this.rig.position.add(push);
      const vn = this.velocity.dot(n);
      if (vn < 0) this.velocity.addScaledVector(n, -vn);
      if (n.y > 0.6) this.grounded = true;
    };
    for (let k = 0; k < 3; k++) {
      this.rig.updateMatrixWorld(true);
      const head = new THREE.Vector3();
      this.camera.getWorldPosition(head);
      const chest = head.clone().add(new THREE.Vector3(0, -M.chestDrop, 0));
      const before = this.rig.position.clone();
      this.resolveSphere(head, M.headRadius, onPush);
      this.rig.updateMatrixWorld(true);
      this.camera.getWorldPosition(head);
      chest.copy(head).add(new THREE.Vector3(0, -M.chestDrop, 0));
      this.resolveSphere(chest, M.chestRadius, onPush);
      if (before.distanceToSquared(this.rig.position) < 1e-10) break;
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const M = CONFIG.move;
    if (!this.renderer.xr.isPresenting) this.camera.position.set(0, 1.6, 0);

    this.rig.updateMatrixWorld(true);
    this.hands.forEach((c, i) => c.getWorldPosition(this.tmp[i]));
    if (!this.started) {
      this.hands.forEach((c, i) => this.last[i].copy(this.tmp[i]));
      this.started = true;
    }

    const move = new THREE.Vector3();
    let touching = false;
    let n = 0;
    for (let i = 0; i < 2; i++) {
      if (this.handBlocked(this.last[i], this.tmp[i], M.handRadius)) {
        move.sub(new THREE.Vector3().subVectors(this.tmp[i], this.last[i]));
        touching = true;
        n++;
      }
    }

    if (touching) {
      move.divideScalar(n);
      this.rig.position.add(move);
      this.history.push(move.clone().divideScalar(Math.max(dt, 1e-4)).multiplyScalar(M.pushMultiplier));
      if (this.history.length > M.smoothFrames) this.history.shift();
      this.velocity.set(0, 0, 0);
      for (const v of this.history) this.velocity.add(v);
      this.velocity.divideScalar(this.history.length);
    } else {
      this.history.length = 0;
      this.velocity.y -= M.gravity * dt;
      this.velocity.multiplyScalar(1 - M.airDrag * dt);
    }
    if (this.velocity.length() > M.maxSpeed) this.velocity.setLength(M.maxSpeed);

    this.grounded = false;
    this.resolveBody();
    const total = this.velocity.length() * dt;
    const steps = Math.max(1, Math.ceil(total / 0.05));
    for (let s = 0; s < steps; s++) {
      this.rig.position.addScaledVector(this.velocity, dt / steps);
      this.resolveBody();
    }

    if (this.grounded && !touching) {
      const f = Math.exp(-M.groundFriction * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
      if (Math.hypot(this.velocity.x, this.velocity.z) < 0.15) { this.velocity.x = 0; this.velocity.z = 0; }
    }

    if (this.rig.position.y < -20) {
      this.rig.position.set(CONFIG.spawn.x, CONFIG.spawn.y, CONFIG.spawn.z);
      this.velocity.set(0, 0, 0);
    }

    this.rig.updateMatrixWorld(true);
    const visHands = [];
    this.hands.forEach((c, i) => {
      c.getWorldPosition(this.last[i]);
      const vis = this.last[i].clone();
      this.resolveSphere(vis, M.handRadius, null);
      visHands.push(vis);
    });
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    this.updatePlayerModel(head, visHands);
  }
}
