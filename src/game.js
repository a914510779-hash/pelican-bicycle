import { BIKE_GEOM, SpringDamper, VerletRibbon, clamp } from './kinematics.js';
import { PelicanRenderer } from './renderer.js';
import { PelicanAudio } from './audio.js';

const TIME_ORDER = ['day', 'sunset', 'night'];

export class PelicanGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.renderer = new PelicanRenderer(canvas);
    this.audio = new PelicanAudio();
    this.callbacks = callbacks;

    this.state = {
      time: 0,
      distance: 0,
      targetSpeed: 170,
      speed: 170,
      wheelAngle: 0,
      crankAngle: 0,
      crankOmega: 0,
      jumpY: 0,
      jumpVy: 0,
      isAirborne: false,
      wheelieActive: false,
      timeOfDay: 'day',
      xrayMode: false,
      score: 0,
      basketFishCount: 1,
      pouchFish: null,
      pouchFishTimer: 0,
      bellTimer: 0,
      blinkTimer: 0,
      nextBlink: 2.8,
      happyTimer: 0,
      saddleSpring: new SpringDamper(0, 170, 13),
      pitchSpring: new SpringDamper(0, 110, 11),
      beakSpring: new SpringDamper(0, 160, 12),
      pouchSpring: new SpringDamper(0, 95, 7.5),
      headSpring: new SpringDamper(0, 130, 10),
      scarf: new VerletRibbon(7, 7.2),
      fishList: [],
      crabs: [],
      particles: [],
      seagulls: [
        { x: 140, y: 0.24, speed: 24, phase: 0.4, scale: 0.9, startled: 0 },
        { x: 380, y: 0.18, speed: 19, phase: 2.2, scale: 1.05, startled: 0 },
        { x: 560, y: 0.30, speed: 28, phase: 4.1, scale: 0.8, startled: 0 },
      ],
      nextFishSpawn: 1.2,
      nextCrabSpawn: 4.5,
      lastFrameInfo: null,
    };

    this.state.scarf.reset(44, -136);
    this.keys = new Set();
    this.rafId = null;
    this.lastTime = 0;

    this._bindEvents();
  }

  start() {
    if (this.rafId) return;
    this.lastTime = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      this.update(dt);
      this.state.lastFrameInfo = this.renderer.render(this.state);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  setTargetSpeed(speed) {
    this.state.targetSpeed = clamp(Number(speed) || 170, 50, 340);
  }

  jumpAndScoop() {
    const s = this.state;
    // Open beak to scoop even mid-air!
    s.beakSpring.target = 0.56;
    s.beakSpring.impulse(4.8);
    s.pouchSpring.impulse(3.5);
    setTimeout(() => {
      s.beakSpring.target = 0;
    }, 260);

    if (!s.isAirborne) {
      s.isAirborne = true;
      s.jumpVy = 360;
      s.pitchSpring.impulse(-3.2);
      s.saddleSpring.impulse(-38);
      this.audio.playJump();
      this._spawnDust(6);
    }
  }

  triggerWheelie(active) {
    this.state.wheelieActive = active;
    if (active) {
      this.state.pitchSpring.impulse(-2.8);
      this.state.pouchSpring.impulse(2.4);
    }
  }

  pulseWheelie() {
    this.triggerWheelie(true);
    clearTimeout(this._wheeliePulseTimer);
    this._wheeliePulseTimer = setTimeout(() => this.triggerWheelie(false), 1150);
  }

  ringBell() {
    const s = this.state;
    s.bellTimer = 0.45;
    this.audio.playBell();

    // Startle seagulls!
    for (const g of s.seagulls) {
      g.startled = 1.6;
    }

    // Visual sound ring near handlebar
    const info = s.lastFrameInfo;
    if (info) {
      const bellX = info.bikeScreenX + 94 * info.bikeScale;
      const bellY = info.groundY - s.jumpY - 122 * info.bikeScale;
      s.particles.push({ kind: 'ring', x: bellX, y: bellY, r: 5, life: 0.55, maxLife: 0.55, color: '#facc15' });
      s.particles.push({ kind: 'text', x: bellX + 6, y: bellY - 12, vx: 14, vy: -32, text: '叮铃♪', life: 0.75, maxLife: 0.75, color: '#fef08a' });
    }
  }

  cycleTimeOfDay() {
    const idx = TIME_ORDER.indexOf(this.state.timeOfDay);
    this.state.timeOfDay = TIME_ORDER[(idx + 1) % TIME_ORDER.length];
    this.callbacks.onStateChange?.(this.state);
    return this.state.timeOfDay;
  }

  setTimeOfDay(mode) {
    if (TIME_ORDER.includes(mode)) {
      this.state.timeOfDay = mode;
      this.callbacks.onStateChange?.(this.state);
    }
  }

  toggleXray() {
    this.state.xrayMode = !this.state.xrayMode;
    this.callbacks.onStateChange?.(this.state);
    return this.state.xrayMode;
  }

  toggleAudio() {
    const enabled = this.audio.toggle();
    this.callbacks.onStateChange?.(this.state);
    return enabled;
  }

  update(dt) {
    const s = this.state;
    s.time += dt;

    // Keyboard speed boost / brake
    let desiredSpeed = s.targetSpeed;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) desiredSpeed = Math.min(360, desiredSpeed + 120);
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) desiredSpeed = Math.max(45, desiredSpeed - 90);

    s.speed += (desiredSpeed - s.speed) * Math.min(1, dt * 4.5);
    s.distance += s.speed * dt;

    // Physically exact wheel angular velocity omega = v / R_wheel (zero tire slip!)
    const wheelOmega = s.speed / BIKE_GEOM.wheelRadius;
    s.wheelAngle += wheelOmega * dt;

    // Realistic gear ratio (chainring 15 / rear cog 7 => ~2.14:1)
    // Coasting gently during wheelie or mid-air triggers realistic freehub pawl ticks!
    const coasting = s.isAirborne || s.wheelieActive;
    const targetCrankOmega = coasting ? 0.25 : wheelOmega * (BIKE_GEOM.rearCogRadius / BIKE_GEOM.chainringRadius);
    s.crankOmega += (targetCrankOmega - s.crankOmega) * Math.min(1, dt * 8);
    s.crankAngle += s.crankOmega * dt;
    if (coasting && s.speed > 75) {
      this.audio.playFreehubTick(8 + s.speed * 0.04);
    }

    // Jump gravity & landing physics
    if (s.isAirborne) {
      s.jumpVy -= 980 * dt;
      s.jumpY += s.jumpVy * dt;
      if (s.jumpY <= 0) {
        s.jumpY = 0;
        s.jumpVy = 0;
        s.isAirborne = false;
        s.saddleSpring.impulse(75);
        s.pouchSpring.impulse(6.2);
        s.headSpring.impulse(55);
        s.pitchSpring.impulse(1.8);
        this.audio.playLand();
        this._spawnDust(8);
      }
    }

    // Pitch target (wheelie or mid-air attitude)
    if (s.wheelieActive && !s.isAirborne) {
      s.pitchSpring.target = -0.34;
    } else if (s.isAirborne) {
      s.pitchSpring.target = clamp(-s.jumpVy * 0.00065, -0.26, 0.16);
    } else {
      s.pitchSpring.target = 0;
    }

    // Step second-order springs
    s.saddleSpring.step(dt);
    s.pitchSpring.step(dt);
    s.beakSpring.step(dt);
    s.pouchSpring.step(dt);
    s.headSpring.step(dt);

    // Step Verlet scarf in bike local coordinates
    const scarfAnchorX = 42;
    const scarfAnchorY = -134 + s.saddleSpring.value * 0.85;
    s.scarf.step(scarfAnchorX, scarfAnchorY, -240 - s.speed * 2.1, 40 - s.jumpVy * 0.4, s.time, dt);

    // Timers
    if (s.bellTimer > 0) s.bellTimer = Math.max(0, s.bellTimer - dt);
    if (s.happyTimer > 0) s.happyTimer = Math.max(0, s.happyTimer - dt);

    // Periodic blinking
    s.nextBlink -= dt;
    if (s.nextBlink <= 0) {
      s.blinkTimer = 0.13;
      s.nextBlink = 2.4 + Math.random() * 3.2;
    }
    if (s.blinkTimer > 0) s.blinkTimer = Math.max(0, s.blinkTimer - dt);

    // Digest / toss fish from pouch into wicker basket
    if (s.pouchFish) {
      s.pouchFishTimer -= dt;
      if (s.pouchFishTimer <= 0) {
        s.pouchFish = null;
        s.basketFishCount += 1;
        s.pouchSpring.impulse(-3.2);
      }
    }

    // Wind streaks when sprinting fast
    const info = s.lastFrameInfo;
    if (info && s.speed > 235 && Math.random() < dt * 10) {
      s.particles.push({
        kind: 'streak',
        x: info.width + 20,
        y: 35 + Math.random() * (info.groundY - 55),
        vx: -s.speed * 1.9,
        vy: 0,
        len: 26 + Math.random() * 30,
        life: 0.45,
        maxLife: 0.45,
        color: 'rgba(255, 255, 255, 0.4)',
      });
    }

    // Seagulls
    for (const g of s.seagulls) {
      const mult = g.startled > 0 ? 2.4 : 1;
      g.x -= (g.speed * mult + s.speed * 0.12) * dt;
      if (g.startled > 0) {
        g.y = Math.max(0.08, g.y - dt * 0.08);
        g.startled = Math.max(0, g.startled - dt);
      }
    }

    // Spawn leaping fish & boardwalk crabs
    if (info) {
      this._updateEntities(dt, info);
    }

    // Update particles
    for (let i = s.particles.length - 1; i >= 0; i--) {
      const p = s.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        s.particles.splice(i, 1);
        continue;
      }
      if (p.vx) p.x += p.vx * dt;
      if (p.vy) p.y += p.vy * dt;
      if (p.gravity) p.vy += p.gravity * dt;
    }
  }

  _updateEntities(dt, info) {
    const s = this.state;

    // Spawn leaping fish from the ocean right alongside the boardwalk
    s.nextFishSpawn -= dt;
    if (s.nextFishSpawn <= 0) {
      s.nextFishSpawn = 1.6 + Math.random() * 1.9;
      const golden = Math.random() < 0.22;
      const spawnX = info.width + 26;
      const arcPeak = 135 + Math.random() * 75;
      s.fishList.push({
        x: spawnX,
        y: info.groundY - 26,
        vx: -40 - Math.random() * 35,
        vy: -Math.sqrt(2 * 440 * arcPeak),
        golden,
        caught: false,
      });
      // Little ocean splash on launch
      for (let i = 0; i < 4; i++) {
        s.particles.push({
          kind: 'dot',
          x: info.width - 10,
          y: info.groundY - 30,
          vx: -40 - Math.random() * 50,
          vy: -60 - Math.random() * 70,
          gravity: 340,
          r: 2.2,
          life: 0.45,
          maxLife: 0.45,
          color: 'rgba(220, 244, 255, 0.85)',
        });
      }
    }

    // Update fish arcs & check beak-scoop collision!
    const beak = info.beakWorld;
    for (let i = s.fishList.length - 1; i >= 0; i--) {
      const f = s.fishList[i];
      f.x += (f.vx - s.speed * 0.62) * dt;
      f.vy += 440 * dt;
      f.y += f.vy * dt;

      // Auto-open beak subtly when a fish arcs close!
      const dist = Math.hypot(f.x - beak.x, f.y - beak.y);
      if (dist < 85 && s.beakSpring.value < 0.25) {
        s.beakSpring.impulse(2.5);
      }

      // Catch hitbox (generous & rewarding!)
      if (!f.caught && dist < 44 * info.bikeScale) {
        f.caught = true;
        const pts = f.golden ? 3 : 1;
        s.score += pts;
        s.pouchFish = { golden: f.golden };
        s.pouchFishTimer = 1.8;
        s.happyTimer = 0.85;
        s.beakSpring.impulse(5.5);
        s.pouchSpring.impulse(7.5);
        this.audio.playCatch(f.golden);

        s.particles.push({
          kind: 'text',
          x: f.x - 10,
          y: f.y - 10,
          vx: 0,
          vy: -44,
          text: f.golden ? '+3 ✨金鱼!' : '+1 🐟',
          life: 0.9,
          maxLife: 0.9,
          color: f.golden ? '#fde047' : '#ffffff',
        });
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          s.particles.push({
            kind: 'dot',
            x: f.x,
            y: f.y,
            vx: Math.cos(a) * (50 + Math.random() * 55),
            vy: Math.sin(a) * (50 + Math.random() * 55),
            gravity: 160,
            r: 2.5,
            life: 0.45,
            maxLife: 0.45,
            color: f.golden ? '#fde047' : '#7dd3fc',
          });
        }
        this.callbacks.onStateChange?.(s);
        s.fishList.splice(i, 1);
        continue;
      }

      if (f.x < -50 || f.y > info.groundY + 20) {
        s.fishList.splice(i, 1);
      }
    }

    // Spawn cute boardwalk crabs occasionally
    s.nextCrabSpawn -= dt;
    if (s.nextCrabSpawn <= 0) {
      s.nextCrabSpawn = 5.5 + Math.random() * 5;
      s.crabs.push({ x: info.width + 24, phase: Math.random() * 6, hopped: false });
    }
    for (let i = s.crabs.length - 1; i >= 0; i--) {
      const c = s.crabs[i];
      c.x -= (s.speed + 24) * dt;
      // Style bonus if pelican gracefully hops over a crab!
      if (!c.hopped && s.isAirborne && s.jumpY > 18 && Math.abs(c.x - (info.bikeScreenX + 55 * info.bikeScale)) < 26) {
        c.hopped = true;
        s.score += 1;
        s.happyTimer = 0.6;
        s.particles.push({
          kind: 'text',
          x: c.x - 16,
          y: info.groundY - 40,
          vx: 0,
          vy: -38,
          text: '跃蟹 +1 🦀',
          life: 0.85,
          maxLife: 0.85,
          color: '#fca5a5',
        });
      }
      if (c.x < -40) s.crabs.splice(i, 1);
    }
  }

  _spawnDust(count) {
    const info = this.state.lastFrameInfo;
    if (!info) return;
    for (let i = 0; i < count; i++) {
      this.state.particles.push({
        kind: 'dot',
        x: info.bikeScreenX + Math.random() * 110 * info.bikeScale,
        y: info.groundY - 2,
        vx: -this.state.speed * 0.45 + (Math.random() - 0.5) * 40,
        vy: -25 - Math.random() * 45,
        gravity: 130,
        r: 2.2 + Math.random() * 2,
        life: 0.42,
        maxLife: 0.42,
        color: 'rgba(255, 245, 220, 0.65)',
      });
    }
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', () => {
      this.jumpAndScoop();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        this.jumpAndScoop();
      } else if (e.code === 'KeyW') {
        this.triggerWheelie(true);
      } else if (e.code === 'KeyB') {
        this.ringBell();
      } else if (e.code === 'KeyK') {
        this.toggleXray();
      } else if (e.code === 'KeyT') {
        this.cycleTimeOfDay();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW') {
        this.triggerWheelie(false);
      }
    });
  }
}
