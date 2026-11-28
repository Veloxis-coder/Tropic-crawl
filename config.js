export const CONFIG = {
  title: 'TropicCrawl',
  room: { size: 40, height: 6, props: 28, seed: 7 },
  lights: { intensity: 80, range: 40, ambient: 1.1 },
  move: {
    handRadius: 0.1,
    headRadius: 0.2,
    chestRadius: 0.24,
    chestDrop: 0.4,
    pushMultiplier: 1.4,
    maxSpeed: 12,
    gravity: 9.8,
    airDrag: 0.1,
    smoothFrames: 4,
    groundFriction: 10
  },
  hall: { width: 6, doorHeight: 4.5, length: 30, height: 5 },
  giant: { width: 120, length: 120, height: 30, pillars: 16 },
  spawn: { x: 0, y: 0.02, z: 0 }
};
