import * as THREE from 'three';
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

    this.buildRoom();
  }

  // Gorilla Tag style: floating head, chest/torso, arms and hands. No legs.
  buildPlayerModel() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.9 });
    const chestMat = new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.9 });
    this.model = new THREE.Group();
    this.scene.add(this.model);

    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), skin);
    this.torso = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), chestMat);
    this.torso.scale.set(0.26, 0.34, 0.17);
    this.model.add(this.headMesh, this.torso);

    this.handMeshes = [0, 1].map((i) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(CONFIG.move.handRadius, 20, 14),
        new THREE.MeshStandardMaterial({ color: i === 0 ? 0x4c80ff : 0xff6650 })
      );
      this.model.add(m);
      return m;
    });

    const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 10);
    this.arms = [0, 1].map(() => {
      const a = new THREE.Mesh(armGeo, skin);
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
      const shoulder = new THREE.Vector3(side * 0.25, 0.1, 0).applyQuaternion(yawQ).add(chest);
      const hand = visHands[i];
      this.handMeshes[i].position.copy(hand);
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
    this.addBox('wallN', 0, H / 2, h + 0.1, S + 0.4, H, 0.2, 0xb3bfd9);
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
    for (let i = 0; i < 2; i++) {
      if (this.handBlocked(this.last[i], this.tmp[i], M.handRadius)) {
        move.sub(new THREE.Vector3().subVectors(this.tmp[i], this.last[i]));
        touching = true;
      }
    }

    if (touching) {
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

    this.resolveBody();
    const total = this.velocity.length() * dt;
    const steps = Math.max(1, Math.ceil(total / 0.05));
    for (let s = 0; s < steps; s++) {
      this.rig.position.addScaledVector(this.velocity, dt / steps);
      this.resolveBody();
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
