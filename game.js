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
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 12),
        new THREE.MeshStandardMaterial({ color: i === 0 ? 0x4c80ff : 0xff6650 })
      );
      c.add(m);
      this.rig.add(c);
      return c;
    });

    this.velocity = new THREE.Vector3();
    this.history = [];
    this.last = [new THREE.Vector3(), new THREE.Vector3()];
    this.tmp = [new THREE.Vector3(), new THREE.Vector3()];
    this.started = false;

    this.buildRoom();
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
    const S = CONFIG.room.size, H = CONFIG.room.height, h = S / 2;
    this.scene.background = new THREE.Color(0x151820);
    this.addBox('floor', 0, -0.1, 0, S, 0.2, S, 0x595961);
    this.addBox('ceiling', 0, H + 0.1, 0, S, 0.2, S, 0xdddddd);
    this.addBox('wallN', 0, H / 2, h + 0.1, S + 0.4, H, 0.2, 0xb3bfd9);
    this.addBox('wallS', 0, H / 2, -h - 0.1, S + 0.4, H, 0.2, 0xb3bfd9);
    this.addBox('wallE', h + 0.1, H / 2, 0, 0.2, H, S, 0xbfb3d9);
    this.addBox('wallW', -h - 0.1, H / 2, 0, 0.2, H, S, 0xbfb3d9);

    this.addBox('block1', -3, 0.5, 3, 2, 1, 2, 0xcc664d);
    this.addBox('block2', 3, 1, -3, 2, 2, 2, 0x4db366);
    this.addBox('block3', 0, 0.25, 4, 3, 0.5, 1, 0xe6cc4d);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, CONFIG.lights.ambient));

    for (const x of [-3, 3]) {
      for (const z of [-3, 3]) {
        const panel = this.addBox('lightPanel', x, H - 0.03, z, 1.2, 0.06, 1.2, 0xffffff, false);
        panel.material = new THREE.MeshStandardMaterial({
          color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2
        });
        const l = new THREE.PointLight(0xfff7e6, CONFIG.lights.intensity, CONFIG.lights.range, 2);
        l.position.set(x, H - 0.4, z);
        this.scene.add(l);
      }
    }
  }

  sphereHitsBox(c, r, box) {
    const p = c.clone().clamp(box.min, box.max);
    return p.distanceToSquared(c) < r * r;
  }

  hitsAnything(c, r) {
    for (const b of this.colliders) if (this.sphereHitsBox(c, r, b)) return true;
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

  pushOutBody(center) {
    const r = CONFIG.move.bodyRadius;
    for (let it = 0; it < 3; it++) {
      let any = false;
      for (const b of this.colliders) {
        const p = center.clone().clamp(b.min, b.max);
        const d = center.distanceTo(p);
        if (d >= r) continue;
        let n = new THREE.Vector3();
        let depth;
        if (d > 1e-6) {
          n.subVectors(center, p).divideScalar(d);
          depth = r - d;
        } else {
          const dists = [
            [center.x - b.min.x, new THREE.Vector3(-1, 0, 0)],
            [b.max.x - center.x, new THREE.Vector3(1, 0, 0)],
            [center.y - b.min.y, new THREE.Vector3(0, -1, 0)],
            [b.max.y - center.y, new THREE.Vector3(0, 1, 0)],
            [center.z - b.min.z, new THREE.Vector3(0, 0, -1)],
            [b.max.z - center.z, new THREE.Vector3(0, 0, 1)]
          ].sort((a, c) => a[0] - c[0])[0];
          n = dists[1].clone();
          depth = dists[0] + r;
        }
        const push = n.clone().multiplyScalar(depth);
        this.rig.position.add(push);
        center.add(push);
        const vn = this.velocity.dot(n);
        if (vn < 0) this.velocity.addScaledVector(n, -vn);
        any = true;
      }
      if (!any) break;
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const M = CONFIG.move;
    const presenting = this.renderer.xr.isPresenting;
    if (!presenting) this.camera.position.set(0, 1.6, 0);

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
    this.rig.position.addScaledVector(this.velocity, dt);

    this.rig.updateMatrixWorld(true);
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    this.pushOutBody(head);

    if (this.rig.position.y < -20) {
      this.rig.position.set(CONFIG.spawn.x, CONFIG.spawn.y, CONFIG.spawn.z);
      this.velocity.set(0, 0, 0);
    }

    this.rig.updateMatrixWorld(true);
    this.hands.forEach((c, i) => c.getWorldPosition(this.last[i]));
  }
}
