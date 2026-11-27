import { BIKE_GEOM, computeChainTangents, getPedalPosition, solveTwoBoneIK, clamp, lerp } from './kinematics.js';

const THEMES = {
  day: {
    label: '晴空海岸',
    skyTop: '#3b9be8',
    skyMid: '#84cdfa',
    skyBottom: '#f7e9c8',
    sunColor: '#fff6c7',
    sunGlow: 'rgba(255, 236, 160, 0.42)',
    cloudColor: 'rgba(255, 255, 255, 0.88)',
    cliffFar: '#709eb5',
    cliffNear: '#4d8299',
    seaDeep: '#1d75a8',
    seaMid: '#2a92c4',
    seaFoam: 'rgba(255, 255, 255, 0.52)',
    woodDeck: '#c99766',
    woodDark: '#9e6f44',
    railColor: '#e8d4b7',
    lampGlow: 0.0,
    headlightAlpha: 0.0,
    starAlpha: 0.0,
    lighthouseBeam: 0.08,
    textShadow: 'rgba(15, 35, 55, 0.4)',
  },
  sunset: {
    label: '落日栈道',
    skyTop: '#2c2f5c',
    skyMid: '#c45b68',
    skyBottom: '#f9b76a',
    sunColor: '#ffd485',
    sunGlow: 'rgba(255, 145, 77, 0.5)',
    cloudColor: 'rgba(255, 198, 158, 0.78)',
    cliffFar: '#6b4764',
    cliffNear: '#49314d',
    seaDeep: '#2e3866',
    seaMid: '#7d4b6e',
    seaFoam: 'rgba(255, 214, 165, 0.45)',
    woodDeck: '#a66e4e',
    woodDark: '#734532',
    railColor: '#d9a98b',
    lampGlow: 0.65,
    headlightAlpha: 0.38,
    starAlpha: 0.25,
    lighthouseBeam: 0.32,
    textShadow: 'rgba(25, 10, 20, 0.5)',
  },
  night: {
    label: '月夜灯塔',
    skyTop: '#081226',
    skyMid: '#132847',
    skyBottom: '#214263',
    sunColor: '#eef5ff',
    sunGlow: 'rgba(180, 215, 255, 0.28)',
    cloudColor: 'rgba(105, 140, 175, 0.28)',
    cliffFar: '#162b42',
    cliffNear: '#0e1e30',
    seaDeep: '#0a1c33',
    seaMid: '#133152',
    seaFoam: 'rgba(170, 215, 255, 0.28)',
    woodDeck: '#544640',
    woodDark: '#362c29',
    railColor: '#7a726d',
    lampGlow: 1.0,
    headlightAlpha: 0.72,
    starAlpha: 0.95,
    lighthouseBeam: 0.55,
    textShadow: 'rgba(0, 0, 0, 0.65)',
  },
};

const STARS = Array.from({ length: 46 }, (_, i) => ({
  x: ((i * 73.13) % 100) / 100,
  y: ((i * 31.7 + 7) % 44) / 100,
  r: 0.9 + (i % 3) * 0.55,
  phase: i * 1.37,
}));

const CLOUDS = [
  { x: 0.14, y: 0.16, scale: 1.0, speed: 6 },
  { x: 0.48, y: 0.11, scale: 1.25, speed: 4.5 },
  { x: 0.82, y: 0.21, scale: 0.85, speed: 7.5 },
];

export class PelicanRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.chainTangents = computeChainTangents(
      BIKE_GEOM.rearHub,
      BIKE_GEOM.rearCogRadius,
      BIKE_GEOM.bottomBracket,
      BIKE_GEOM.chainringRadius
    );
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: w, height: h };
  }

  render(state) {
    const { width: W, height: H } = this.resize();
    const ctx = this.ctx;
    const theme = THEMES[state.timeOfDay] || THEMES.day;

    // Layout anchors
    const groundY = H - 46;
    const bikeScale = clamp(Math.min(W / 490, H / 310), 0.72, 1.08);
    const bikeScreenX = clamp(W * 0.25, 64, 225);

    // 1. Sky & atmosphere
    this._drawSky(ctx, W, H, groundY, theme, state.time);

    // 2. Distant cliffs, lighthouse & rotating beam
    this._drawCoastlineAndLighthouse(ctx, W, groundY, theme, state);

    // 3. Ocean waves & sailboats
    this._drawOcean(ctx, W, groundY, theme, state);

    // 4. Seagulls
    this._drawSeagulls(ctx, W, groundY, state);

    // 5. Wooden boardwalk, railings & lamps
    this._drawBoardwalk(ctx, W, H, groundY, theme, state);

    // 6. Leaping fish & boardwalk crabs
    this._drawEntities(ctx, bikeScreenX, groundY, bikeScale, state);

    // 7. Pelican + Bicycle rig (with real 2-bone IK and optional X-ray blueprint!)
    const telemetry = this._drawPelicanAndBike(ctx, bikeScreenX, groundY, bikeScale, theme, state);

    // 8. Particles, wind lines, floating score popups
    this._drawParticles(ctx, state);

    // 9. Compact in-canvas HUD (score + mode badge + IK telemetry if enabled)
    this._drawHUD(ctx, W, H, theme, state, telemetry);

    return {
      width: W,
      height: H,
      groundY,
      bikeScreenX,
      bikeScale,
      beakWorld: telemetry.beakWorld,
    };
  }

  _drawSky(ctx, W, H, groundY, theme, time) {
    const grad = ctx.createLinearGradient(0, 0, 0, groundY - 40);
    grad.addColorStop(0, theme.skyTop);
    grad.addColorStop(0.58, theme.skyMid);
    grad.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Twinkling stars at sunset / night
    if (theme.starAlpha > 0.01) {
      ctx.save();
      for (const s of STARS) {
        const twinkle = 0.55 + 0.45 * Math.sin(time * 2.4 + s.phase);
        ctx.fillStyle = `rgba(240, 248, 255, ${(theme.starAlpha * twinkle).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * groundY, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Sun or Moon
    const sunX = W * 0.77;
    const sunY = theme === THEMES.sunset ? groundY - 92 : groundY * 0.25;
    const sunR = theme === THEMES.night ? 20 : 28;

    const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.4, sunX, sunY, sunR * 3.4);
    halo.addColorStop(0, theme.sunGlow);
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.sunColor;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    if (theme === THEMES.night) {
      // Crescent cutout
      ctx.fillStyle = theme.skyMid;
      ctx.beginPath();
      ctx.arc(sunX + 8, sunY - 5, sunR * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }

    // Drifting clouds
    ctx.fillStyle = theme.cloudColor;
    for (const c of CLOUDS) {
      const cx = (((c.x * W - time * c.speed) % (W + 180)) + W + 180) % (W + 180) - 90;
      const cy = c.y * groundY;
      this._drawCloud(ctx, cx, cy, c.scale);
    }
  }

  _drawCloud(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.arc(18, -5, 22, 0, Math.PI * 2);
    ctx.arc(40, -1, 17, 0, Math.PI * 2);
    ctx.arc(20, 6, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawCoastlineAndLighthouse(ctx, W, groundY, theme, state) {
    const horizonY = groundY - 78;
    const parallaxFar = (state.distance * 0.03) % (W + 260);

    // Distant headland
    ctx.fillStyle = theme.cliffFar;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= W + 40; x += 40) {
      const wx = x + parallaxFar * 0.4;
      const ridge = Math.sin(wx * 0.008) * 18 + Math.cos(wx * 0.019) * 10;
      ctx.lineTo(x, horizonY - 22 - ridge);
    }
    ctx.lineTo(W, horizonY);
    ctx.closePath();
    ctx.fill();

    // Lighthouse island on the right
    const lhX = ((W * 0.84 - state.distance * 0.045) % (W + 280) + (W + 280)) % (W + 280) - 100;
    const lhBaseY = horizonY - 2;

    // Island rock
    ctx.fillStyle = theme.cliffNear;
    ctx.beginPath();
    ctx.moveTo(lhX - 42, lhBaseY + 4);
    ctx.quadraticCurveTo(lhX - 18, lhBaseY - 20, lhX + 8, lhBaseY - 16);
    ctx.quadraticCurveTo(lhX + 34, lhBaseY - 14, lhX + 46, lhBaseY + 4);
    ctx.closePath();
    ctx.fill();

    // Lighthouse tower
    const towerY = lhBaseY - 14;
    ctx.fillStyle = '#f5f2eb';
    ctx.beginPath();
    ctx.moveTo(lhX - 7, towerY);
    ctx.lineTo(lhX - 4.5, towerY - 34);
    ctx.lineTo(lhX + 4.5, towerY - 34);
    ctx.lineTo(lhX + 7, towerY);
    ctx.closePath();
    ctx.fill();

    // Red coastal stripes
    ctx.fillStyle = '#d9483b';
    ctx.fillRect(lhX - 6, towerY - 12, 12, 6);
    ctx.fillRect(lhX - 5.2, towerY - 25, 10.4, 6);

    // Lantern dome
    ctx.fillStyle = '#24303c';
    ctx.fillRect(lhX - 5.5, towerY - 37, 11, 3);
    ctx.fillStyle = '#ffe58f';
    ctx.fillRect(lhX - 3.5, towerY - 43, 7, 6);
    ctx.fillStyle = '#d9483b';
    ctx.beginPath();
    ctx.arc(lhX, towerY - 43, 4.5, Math.PI, 0);
    ctx.fill();

    // Rotating volumetric lighthouse beam
    const beamAngle = Math.sin(state.time * 0.9) * 0.42;
    const beamDir = Math.cos(state.time * 0.9) >= 0 ? -1 : 1;
    const beamLen = 180;
    const lanternY = towerY - 40;
    ctx.save();
    ctx.translate(lhX, lanternY);
    const beamGrad = ctx.createLinearGradient(0, 0, beamDir * beamLen, beamAngle * 40);
    beamGrad.addColorStop(0, `rgba(255, 240, 175, ${theme.lighthouseBeam})`);
    beamGrad.addColorStop(1, 'rgba(255, 240, 175, 0)');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(beamDir * beamLen, -28 + beamAngle * 35);
    ctx.lineTo(beamDir * beamLen, 16 + beamAngle * 35);
    ctx.lineTo(0, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawOcean(ctx, W, groundY, theme, state) {
    const horizonY = groundY - 78;
    const seaGrad = ctx.createLinearGradient(0, horizonY, 0, groundY - 12);
    seaGrad.addColorStop(0, theme.seaDeep);
    seaGrad.addColorStop(1, theme.seaMid);
    ctx.fillStyle = seaGrad;
    ctx.fillRect(0, horizonY, W, groundY - horizonY);

    // Shimmering sun/moon reflection column
    const reflectX = W * 0.77;
    ctx.save();
    ctx.fillStyle = theme.sunGlow;
    for (let i = 0; i < 6; i++) {
      const y = horizonY + 8 + i * 10;
      const w = 16 + i * 7 + Math.sin(state.time * 3 + i * 1.4) * 6;
      const shift = Math.sin(state.time * 2.2 + i * 2.1) * 5;
      ctx.fillRect(reflectX - w / 2 + shift, y, w, 2.4);
    }
    ctx.restore();

    // Distant bobbing sailboats
    for (let i = 0; i < 2; i++) {
      const bx = (((W * (0.28 + i * 0.44) - state.distance * (0.07 + i * 0.03)) % (W + 160)) + W + 160) % (W + 160) - 60;
      const by = horizonY + 13 + i * 11 + Math.sin(state.time * 2.1 + i * 2) * 1.8;
      const s = 0.75 + i * 0.25;
      ctx.save();
      ctx.translate(bx, by);
      ctx.scale(s, s);
      ctx.fillStyle = '#fff9f0';
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(10, -2);
      ctx.lineTo(0, -2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e7edf2';
      ctx.beginPath();
      ctx.moveTo(-2, -14);
      ctx.lineTo(-9, -2);
      ctx.lineTo(-2, -2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#9c4338';
      ctx.beginPath();
      ctx.moveTo(-11, -1);
      ctx.lineTo(12, -1);
      ctx.lineTo(8, 4);
      ctx.lineTo(-8, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Parallax animated wave ribbons
    ctx.strokeStyle = theme.seaFoam;
    ctx.lineWidth = 1.6;
    for (let row = 0; row < 3; row++) {
      const wy = horizonY + 18 + row * 18;
      const speedFactor = 0.14 + row * 0.1;
      const phase = state.distance * speedFactor + state.time * (18 + row * 8);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 18) {
        const y = wy + Math.sin((x + phase) * 0.055) * (2.2 + row * 0.6);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  _drawSeagulls(ctx, W, groundY, state) {
    ctx.save();
    ctx.strokeStyle = state.timeOfDay === 'night' ? 'rgba(215, 232, 250, 0.65)' : 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const gull of state.seagulls) {
      const x = ((gull.x % (W + 120)) + (W + 120)) % (W + 120) - 60;
      const y = gull.y * (groundY - 90);
      const flap = Math.sin(state.time * (gull.startled > 0 ? 18 : 6.5) + gull.phase) * 5.5;
      ctx.beginPath();
      ctx.moveTo(x - 10 * gull.scale, y - flap * gull.scale);
      ctx.quadraticCurveTo(x - 4 * gull.scale, y - (5 + flap * 0.3) * gull.scale, x, y);
      ctx.quadraticCurveTo(x + 4 * gull.scale, y - (5 + flap * 0.3) * gull.scale, x + 10 * gull.scale, y - flap * gull.scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBoardwalk(ctx, W, H, groundY, theme, state) {
    const railTopY = groundY - 30;
    const postSpacing = 68;
    const postOffset = state.distance % postSpacing;

    // Back railing posts & vintage coastal street lamps
    const lampSpacing = 272;
    const lampOffset = state.distance % lampSpacing;

    for (let x = -lampOffset; x < W + lampSpacing; x += lampSpacing) {
      // Lamp post
      ctx.fillStyle = '#2c3c47';
      ctx.fillRect(x - 2.5, groundY - 122, 5, 122);
      ctx.beginPath();
      ctx.arc(x + 6, groundY - 122, 8, Math.PI, 0);
      ctx.strokeStyle = '#2c3c47';
      ctx.lineWidth = 3.2;
      ctx.stroke();

      // Lantern housing
      const lx = x + 14;
      const ly = groundY - 118;
      ctx.fillStyle = theme.lampGlow > 0.1 ? '#ffdfa0' : '#d8e3e8';
      ctx.beginPath();
      ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
      ctx.fill();

      if (theme.lampGlow > 0.05) {
        const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, 58);
        glow.addColorStop(0, `rgba(255, 220, 130, ${(0.55 * theme.lampGlow).toFixed(3)})`);
        glow.addColorStop(1, 'rgba(255, 200, 100, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lx, ly, 58, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Wooden safety railing
    ctx.fillStyle = theme.railColor;
    ctx.fillRect(0, railTopY, W, 4.5);
    ctx.fillRect(0, railTopY + 14, W, 2.5);
    for (let x = -postOffset; x < W + postSpacing; x += postSpacing) {
      ctx.fillStyle = theme.railColor;
      ctx.fillRect(x - 3, railTopY - 2, 6, 32);
      ctx.fillStyle = theme.woodDark;
      ctx.fillRect(x + 1, railTopY - 2, 2, 32);
    }

    // Boardwalk deck surface
    ctx.fillStyle = theme.woodDeck;
    ctx.fillRect(0, groundY - 2, W, H - groundY + 2);

    // Top curb trim
    ctx.fillStyle = theme.woodDark;
    ctx.fillRect(0, groundY - 3, W, 4);

    // Scrolling deck planks (locked 1:1 to bike ground distance -> zero wheel slip!)
    const plankW = 28;
    const plankOffset = state.distance % plankW;
    ctx.strokeStyle = theme.woodDark;
    ctx.lineWidth = 1.5;
    for (let x = -plankOffset; x < W + plankW; x += plankW) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 1);
      ctx.lineTo(x - 10, H);
      ctx.stroke();
    }

    // Subtle sunlit/moonlit highlight band along the rolling path
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(0, groundY + 4, W, 10);
  }

  _drawEntities(ctx, bikeScreenX, groundY, bikeScale, state) {
    // Leaping fish
    for (const fish of state.fishList) {
      if (fish.caught) continue;
      ctx.save();
      ctx.translate(fish.x, fish.y);
      const angle = Math.atan2(fish.vy, -state.speed * 0.55 + fish.vx);
      ctx.rotate(angle);
      this._drawFishSprite(ctx, fish.golden, 1.05);
      ctx.restore();
    }

    // Cute scuttling beach crabs on the boardwalk
    for (const crab of state.crabs) {
      ctx.save();
      ctx.translate(crab.x, groundY - 3);
      const scuttle = Math.sin(state.time * 18 + crab.phase) * 2.5;
      // Legs
      ctx.strokeStyle = '#c43a2b';
      ctx.lineWidth = 1.6;
      for (let side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(side * (4 + i * 2), -3);
          ctx.lineTo(side * (9 + i * 2.5), 1 + (i % 2 ? scuttle : -scuttle) * 0.4);
          ctx.stroke();
        }
      }
      // Shell
      ctx.fillStyle = '#e04f3e';
      ctx.beginPath();
      ctx.ellipse(0, -5, 9, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Claws raised!
      ctx.fillStyle = '#f26b55';
      ctx.beginPath();
      ctx.arc(-8, -11 + scuttle * 0.3, 3.2, 0.3, Math.PI * 1.8);
      ctx.arc(8, -11 - scuttle * 0.3, 3.2, -0.3, Math.PI * 1.5);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.arc(-3, -10, 1.3, 0, Math.PI * 2);
      ctx.arc(3, -10, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawFishSprite(ctx, isGolden, scale = 1) {
    ctx.save();
    ctx.scale(scale, scale);
    // Tail fin
    ctx.fillStyle = isGolden ? '#f59e0b' : '#4a8db7';
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(19, -6);
    ctx.lineTo(17, 0);
    ctx.lineTo(19, 6);
    ctx.closePath();
    ctx.fill();

    // Body
    const bodyGrad = ctx.createLinearGradient(0, -6, 0, 6);
    if (isGolden) {
      bodyGrad.addColorStop(0, '#fef08a');
      bodyGrad.addColorStop(0.5, '#f59e0b');
      bodyGrad.addColorStop(1, '#d97706');
    } else {
      bodyGrad.addColorStop(0, '#5ea9d6');
      bodyGrad.addColorStop(0.55, '#d9f0ff');
      bodyGrad.addColorStop(1, '#ffffff');
    }
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 5.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye & gill
    ctx.fillStyle = '#0f2436';
    ctx.beginPath();
    ctx.arc(-7.5, -1, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isGolden ? '#b45309' : '#6ea8c9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(-3.5, 0, 3.4, -0.7, 0.7);
    ctx.stroke();
    ctx.restore();
  }

  _drawPelicanAndBike(ctx, bikeScreenX, groundY, bikeScale, theme, state) {
    const G = BIKE_GEOM;
    const bounce = state.saddleSpring.value;
    const pitch = state.pitchSpring.value; // radians, negative = wheelie up!
    const wheelAngle = state.wheelAngle;
    const crankAngle = state.crankAngle;

    // Ground shadow
    const airFactor = clamp(1 - state.jumpY / 130, 0.3, 1);
    ctx.save();
    ctx.fillStyle = `rgba(12, 24, 38, ${(0.28 * airFactor).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(
      bikeScreenX + 66 * bikeScale,
      groundY + 3,
      92 * bikeScale * airFactor,
      7.5 * bikeScale * airFactor,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    // Transform to bicycle local space, pivoting cleanly around rear wheel hub for realistic wheelies!
    ctx.save();
    ctx.translate(bikeScreenX, groundY - state.jumpY);
    ctx.scale(bikeScale, bikeScale);
    ctx.translate(G.rearHub.x, G.rearHub.y);
    ctx.rotate(pitch);
    ctx.translate(-G.rearHub.x, -G.rearHub.y);

    // Compute dynamic pelican anchor joints
    const speedRatio = clamp(state.speed / 340, 0, 1.4);
    const pedalingBob = Math.sin(crankAngle * 2) * 1.4;
    const hip = { x: 30, y: -105 + bounce + pedalingBob };
    const shoulder = { x: 39, y: -127 + bounce * 0.9 + pedalingBob * 0.8 };

    // Exact 2-bone IK for both legs (locked to crank pedals!)
    const nearPedal = getPedalPosition(crankAngle, G);
    const farPedal = getPedalPosition(crankAngle + Math.PI, G);
    const nearLegIK = solveTwoBoneIK(hip, nearPedal, G.legUpper, G.legLower, -1); // -1 bends knee forward (+x) in y-down space!
    const farLegIK = solveTwoBoneIK({ x: hip.x + 2, y: hip.y }, farPedal, G.legUpper, G.legLower, -1);

    // Wing target: grips handlebar while riding, lifts & flaps joyfully while airborne!
    const airBlend = clamp(state.jumpY / 36, 0, 1);
    const flapWave = Math.sin(state.time * 20) * 18;
    const wingTarget = {
      x: lerp(G.handleGrip.x, shoulder.x - 16, airBlend),
      y: lerp(G.handleGrip.y, shoulder.y - 36 + flapWave, airBlend),
    };
    const nearWingIK = solveTwoBoneIK(shoulder, wingTarget, G.wingUpper, G.wingLower, 1);

    // Head & neck motion
    const headBob = state.headSpring.value;
    const leanX = speedRatio * 5 + (state.beakSpring.value * 4);
    const head = {
      x: 58 + leanX,
      y: -171 + bounce * 0.7 + headBob,
    };

    // Convert beak scoop point to screen coordinates for fish-catching collision!
    const beakLocal = { x: head.x + 42, y: head.y + 8 };
    const beakWorld = this._bikeLocalToScreen(beakLocal, bikeScreenX, groundY - state.jumpY, bikeScale, pitch);

    // ── LAYER 1: Far crank, far leg, far wing hint ──
    this._drawCrankAndPedal(ctx, G.bottomBracket, farPedal, true);
    this._drawPelicanLeg(ctx, { x: hip.x + 2, y: hip.y }, farLegIK, true);

    // Far wing reaching faintly to handlebar
    ctx.save();
    ctx.strokeStyle = '#dde5e8';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulder.x + 6, shoulder.y - 2);
    ctx.quadraticCurveTo(shoulder.x + 24, shoulder.y + 10, G.handleGrip.x + 4, G.handleGrip.y - 2);
    ctx.stroke();
    ctx.restore();

    // ── LAYER 2: Wheels, Fenders & Drivetrain ──
    this._drawWheel(ctx, G.rearHub.x, G.rearHub.y, G.wheelRadius, wheelAngle, false);
    this._drawWheel(ctx, G.frontHub.x, G.frontHub.y, G.wheelRadius, wheelAngle, true);
    this._drawDrivetrain(ctx, G, crankAngle, wheelAngle);

    // ── LAYER 3: Bicycle Frame, Saddle, Handlebars, Basket & Headlight ──
    this._drawBikeFrame(ctx, G, theme, state, bounce);

    // ── LAYER 4: Pelican Body, Scarf, S-Neck, Head, Beak & Translucent Pouch ──
    this._drawPelicanBodyAndHead(ctx, head, shoulder, bounce, pedalingBob, state);

    // ── LAYER 5: Near Crank, Near Leg (IK) & Near Wing (IK) ──
    this._drawCrankAndPedal(ctx, G.bottomBracket, nearPedal, false);
    this._drawPelicanLeg(ctx, hip, nearLegIK, false);
    this._drawPelicanWing(ctx, shoulder, nearWingIK, airBlend, state.time);

    // ── OPTIONAL LAYER 6: Live Mechanical Engineering X-Ray / IK Blueprint Overlay ──
    if (state.xrayMode) {
      this._drawEngineeringOverlay(ctx, G, hip, nearLegIK, farLegIK, shoulder, nearWingIK, head, state);
    }

    ctx.restore();

    return {
      beakWorld,
      hipAngleDeg: Math.round((nearLegIK.hipAngle * 180) / Math.PI),
      kneeAngleDeg: Math.round((nearLegIK.kneeAngle * 180) / Math.PI),
      cadenceRpm: Math.round((state.crankOmega * 60) / (Math.PI * 2)),
      speedKmh: (state.speed * 0.145).toFixed(1),
      pitchDeg: (-pitch * 180 / Math.PI).toFixed(1),
    };
  }

  _bikeLocalToScreen(pt, bikeScreenX, bikeScreenY, scale, pitch) {
    const G = BIKE_GEOM;
    const rx = pt.x - G.rearHub.x;
    const ry = pt.y - G.rearHub.y;
    const cos = Math.cos(pitch);
    const sin = Math.sin(pitch);
    const rotatedX = rx * cos - ry * sin + G.rearHub.x;
    const rotatedY = rx * sin + ry * cos + G.rearHub.y;
    return {
      x: bikeScreenX + rotatedX * scale,
      y: bikeScreenY + rotatedY * scale,
    };
  }

  _drawWheel(ctx, cx, cy, r, angle, isFront) {
    ctx.save();
    ctx.translate(cx, cy);

    // Curved coastal fender (seafoam teal)
    ctx.save();
    ctx.strokeStyle = '#247f86';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (isFront) {
      ctx.arc(0, 0, r + 5.5, -Math.PI * 0.85, -Math.PI * 0.12);
    } else {
      ctx.arc(0, 0, r + 5.5, -Math.PI * 0.92, -Math.PI * 0.08);
    }
    ctx.stroke();
    ctx.restore();

    // Rotating spokes
    ctx.save();
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(210, 224, 232, 0.78)';
    ctx.lineWidth = 1.1;
    const spokeCount = 12;
    for (let i = 0; i < spokeCount; i++) {
      const a = (i / spokeCount) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
      ctx.lineTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4));
      ctx.stroke();
    }
    // Brass valve stem (makes rotation unmistakably crisp!)
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(r - 4, 0);
    ctx.lineTo(r - 9.5, 0);
    ctx.stroke();
    ctx.restore();

    // Rubber tire
    ctx.strokeStyle = '#262b30';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
    ctx.stroke();

    // Vintage cream sidewall
    ctx.strokeStyle = '#ece2cc';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, r - 3.6, 0, Math.PI * 2);
    ctx.stroke();

    // Metallic rim
    ctx.strokeStyle = '#c4cfd6';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, r - 5.2, 0, Math.PI * 2);
    ctx.stroke();

    // Hub
    ctx.fillStyle = '#33414c';
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(0, 0, 2.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawDrivetrain(ctx, G, crankAngle, wheelAngle) {
    const tangents = this.chainTangents;
    if (tangents) {
      // Exact tangent chain lines with animated chain-link dash!
      const chainPhase = (crankAngle * G.chainringRadius) % 7;
      ctx.save();
      ctx.strokeStyle = '#2d3740';
      ctx.lineWidth = 2.6;
      ctx.setLineDash([4.2, 2.8]);
      ctx.lineDashOffset = -chainPhase;
      ctx.beginPath();
      ctx.moveTo(tangents.upper.start.x, tangents.upper.start.y);
      ctx.lineTo(tangents.upper.end.x, tangents.upper.end.y);
      ctx.stroke();

      ctx.lineDashOffset = chainPhase;
      ctx.beginPath();
      ctx.moveTo(tangents.lower.start.x, tangents.lower.start.y);
      ctx.lineTo(tangents.lower.end.x, tangents.lower.end.y);
      ctx.stroke();
      ctx.restore();
    }

    // Rear cog
    this._drawGear(ctx, G.rearHub.x, G.rearHub.y, G.rearCogRadius, 8, wheelAngle, '#52606d');

    // Front chainring
    this._drawGear(ctx, G.bottomBracket.x, G.bottomBracket.y, G.chainringRadius, 18, crankAngle, '#9aa8b3');
  }

  _drawGear(ctx, cx, cy, r, teeth, angle, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rad = i % 2 === 0 ? r + 1.5 : r - 1;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // Inner cutout ring for front chainring
    if (r > 10) {
      ctx.strokeStyle = '#3d4a54';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.56, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBikeFrame(ctx, G, theme, state, bounce) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const frameMain = '#2c9aa0';
    const frameHighlight = '#52c4c9';

    // Helper for tubular bicycle frame steel
    const drawTube = (a, b, width = 5.2) => {
      ctx.strokeStyle = frameMain;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = frameHighlight;
      ctx.lineWidth = width * 0.3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 0.8);
      ctx.lineTo(b.x, b.y - 0.8);
      ctx.stroke();
    };

    // Rear triangle
    drawTube(G.rearHub, G.bottomBracket, 4.2); // Chainstay
    drawTube(G.rearHub, G.seatTubeTop, 3.8);   // Seatstay

    // Main triangle
    drawTube(G.bottomBracket, G.seatTubeTop, 5.4); // Seat tube
    drawTube(G.bottomBracket, G.headTubeBottom, 5.6); // Down tube
    drawTube(G.seatTubeTop, G.headTubeTop, 5.0); // Top tube
    drawTube(G.headTubeBottom, G.headTubeTop, 6.2); // Head tube

    // Curved classic fork from head tube bottom to front hub
    ctx.strokeStyle = frameMain;
    ctx.lineWidth = 4.6;
    ctx.beginPath();
    ctx.moveTo(G.headTubeBottom.x, G.headTubeBottom.y);
    ctx.quadraticCurveTo(116, -54, G.frontHub.x, G.frontHub.y);
    ctx.stroke();

    // Brass head-tube badge
    ctx.fillStyle = '#e5b94c';
    ctx.fillRect(105.5, -94, 3.2, 8);

    // Seatpost & sprung vintage leather saddle
    const saddleY = G.saddle.y + bounce * 0.5;
    ctx.strokeStyle = '#cfd8df';
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.moveTo(G.seatTubeTop.x, G.seatTubeTop.y);
    ctx.lineTo(G.saddle.x, saddleY);
    ctx.stroke();

    // Saddle springs
    ctx.strokeStyle = '#7b8794';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(G.saddle.x - 8, saddleY + 2);
    ctx.lineTo(G.saddle.x - 10, saddleY + 7);
    ctx.moveTo(G.saddle.x - 3, saddleY + 2);
    ctx.lineTo(G.saddle.x - 5, saddleY + 7);
    ctx.stroke();

    // Leather saddle top
    ctx.fillStyle = '#7c4529';
    ctx.beginPath();
    ctx.moveTo(G.saddle.x - 16, saddleY + 1);
    ctx.quadraticCurveTo(G.saddle.x - 2, saddleY - 6, G.saddle.x + 14, saddleY - 1);
    ctx.quadraticCurveTo(G.saddle.x + 4, saddleY + 5, G.saddle.x - 16, saddleY + 1);
    ctx.fill();

    // Stem & swept-back cruiser handlebars
    ctx.strokeStyle = '#d4dde3';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(G.headTubeTop.x, G.headTubeTop.y);
    ctx.lineTo(G.stemTop.x, G.stemTop.y);
    ctx.quadraticCurveTo(96, -122, G.handleGrip.x, G.handleGrip.y);
    ctx.stroke();

    // Stitched leather handlebar grip
    ctx.strokeStyle = '#7c4529';
    ctx.lineWidth = 6.2;
    ctx.beginPath();
    ctx.moveTo(G.handleGrip.x + 7, G.handleGrip.y - 1);
    ctx.lineTo(G.handleGrip.x - 3, G.handleGrip.y + 1);
    ctx.stroke();

    // Brass bicycle bell on handlebar (jiggles when rung!)
    const bellShake = state.bellTimer > 0 ? Math.sin(state.time * 55) * 1.8 : 0;
    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.arc(93 + bellShake, -121.5, 4.4, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#92400e';
    ctx.fillRect(89, -121.5, 8, 2);

    // Vintage dynamo headlamp on fork crown + volumetric beam at sunset/night
    const lampX = 117;
    const lampY = -75;
    if (theme.headlightAlpha > 0.05) {
      const beam = ctx.createLinearGradient(lampX + 4, lampY, lampX + 185, lampY + 38);
      beam.addColorStop(0, `rgba(255, 244, 185, ${theme.headlightAlpha})`);
      beam.addColorStop(1, 'rgba(255, 244, 185, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(lampX + 4, lampY - 4);
      ctx.lineTo(lampX + 190, lampY - 26);
      ctx.lineTo(lampX + 190, lampY + 56);
      ctx.lineTo(lampX + 4, lampY + 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#d4dde3';
    ctx.beginPath();
    ctx.ellipse(lampX, lampY, 6.5, 4.8, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.headlightAlpha > 0.1 ? '#fff7c2' : '#eef6fa';
    ctx.beginPath();
    ctx.ellipse(lampX + 5.5, lampY, 2, 4, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Wicker front basket (with caught fish peeking out!)
    this._drawWickerBasket(ctx, state.basketFishCount);

    ctx.restore();
  }

  _drawWickerBasket(ctx, basketFishCount) {
    ctx.save();
    // Strut connecting basket to fork
    ctx.strokeStyle = '#9aa8b3';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(116, -83);
    ctx.lineTo(111, -78);
    ctx.stroke();

    // Visible fish peeking out of basket!
    const visibleFish = Math.min(5, basketFishCount);
    for (let i = 0; i < visibleFish; i++) {
      ctx.save();
      ctx.translate(116 + i * 4.5, -104 - (i % 2) * 3);
      ctx.rotate(-0.85 + i * 0.22);
      this._drawFishSprite(ctx, i % 3 === 2, 0.56);
      ctx.restore();
    }

    // Basket trapezoid body
    ctx.fillStyle = '#d9a45b';
    ctx.strokeStyle = '#9c682b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(108, -105);
    ctx.lineTo(136, -105);
    ctx.lineTo(131, -83);
    ctx.lineTo(111, -83);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Woven wicker pattern
    ctx.strokeStyle = 'rgba(130, 82, 30, 0.45)';
    ctx.lineWidth = 1.1;
    for (let y = -100; y <= -88; y += 5) {
      ctx.beginPath();
      ctx.moveTo(109, y);
      ctx.lineTo(134, y);
      ctx.stroke();
    }
    for (let x = 115; x <= 129; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, -104);
      ctx.lineTo(x - 1, -84);
      ctx.stroke();
    }

    // Rim
    ctx.fillStyle = '#b57b36';
    ctx.fillRect(106.5, -107, 31, 3.6);
    ctx.restore();
  }

  _drawCrankAndPedal(ctx, bb, pedal, isFar) {
    ctx.save();
    ctx.strokeStyle = isFar ? '#667582' : '#cfd8df';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bb.x, bb.y);
    ctx.lineTo(pedal.x, pedal.y);
    ctx.stroke();

    // Horizontal pedal platform
    ctx.fillStyle = isFar ? '#1e2429' : '#2f3942';
    ctx.fillRect(pedal.x - 7.5, pedal.y - 2.3, 15, 4.6);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(pedal.x - 4, pedal.y - 0.8, 8, 1.6); // pedal reflector!
    ctx.restore();
  }

  _drawPelicanLeg(ctx, hip, ik, isFar) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Feathered upper drumstick near hip
    ctx.strokeStyle = isFar ? '#dce3e6' : '#f7f5ee';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(lerp(hip.x, ik.joint.x, 0.42), lerp(hip.y, ik.joint.y, 0.42));
    ctx.stroke();

    // Warm orange pelican leg (upper + lower bone)
    ctx.strokeStyle = isFar ? '#c97626' : '#f29938';
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(lerp(hip.x, ik.joint.x, 0.35), lerp(hip.y, ik.joint.y, 0.35));
    ctx.lineTo(ik.joint.x, ik.joint.y);
    ctx.lineTo(ik.end.x, ik.end.y - 2);
    ctx.stroke();

    // Knee joint highlight
    ctx.fillStyle = isFar ? '#b5651d' : '#e08224';
    ctx.beginPath();
    ctx.arc(ik.joint.x, ik.joint.y, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Cute webbed pelican foot gripping the horizontal pedal!
    ctx.fillStyle = isFar ? '#c97626' : '#f59e36';
    ctx.beginPath();
    ctx.moveTo(ik.end.x - 6, ik.end.y - 1);
    ctx.quadraticCurveTo(ik.end.x + 2, ik.end.y - 6.5, ik.end.x + 11, ik.end.y - 1.5);
    ctx.lineTo(ik.end.x + 9, ik.end.y + 1.5);
    ctx.lineTo(ik.end.x - 6, ik.end.y + 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawPelicanBodyAndHead(ctx, head, shoulder, bounce, pedalingBob, state) {
    ctx.save();
    const bodyY = -121 + bounce + pedalingBob * 0.6;

    // 1. Tail feathers fluttering in wind
    const tailWag = Math.sin(state.time * 12) * 2.5;
    ctx.fillStyle = '#e7e4dc';
    ctx.beginPath();
    ctx.moveTo(4, bodyY + 4);
    ctx.quadraticCurveTo(-18, bodyY - 8 + tailWag, -24, bodyY - 2 + tailWag);
    ctx.quadraticCurveTo(-15, bodyY + 10, 6, bodyY + 14);
    ctx.closePath();
    ctx.fill();

    // Dark coastal feather tips on tail
    ctx.fillStyle = '#5f6c78';
    ctx.beginPath();
    ctx.moveTo(-14, bodyY - 4 + tailWag * 0.7);
    ctx.lineTo(-24, bodyY - 2 + tailWag);
    ctx.lineTo(-16, bodyY + 5 + tailWag * 0.5);
    ctx.closePath();
    ctx.fill();

    // 2. Plump cream-white pelican torso
    const bodyGrad = ctx.createLinearGradient(0, bodyY - 22, 0, bodyY + 24);
    bodyGrad.addColorStop(0, '#fffdf7');
    bodyGrad.addColorStop(0.75, '#f2eee4');
    bodyGrad.addColorStop(1, '#ddd7c9');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(27, bodyY, 27, 20.5, -0.22, 0, Math.PI * 2);
    ctx.fill();

    // 3. Fluttering Verlet coastal scarf (behind neck + trailing tail)
    const scarfNodes = state.scarf.nodes;
    if (scarfNodes.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Main coral scarf
      ctx.strokeStyle = '#e04f3e';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.moveTo(scarfNodes[0].x, scarfNodes[0].y);
      for (let i = 1; i < scarfNodes.length; i++) {
        ctx.lineTo(scarfNodes[i].x, scarfNodes[i].y);
      }
      ctx.stroke();

      // Cream coastal stripes along scarf
      ctx.strokeStyle = '#fff5e1';
      ctx.lineWidth = 4.8;
      ctx.setLineDash([3.5, 6.5]);
      ctx.beginPath();
      ctx.moveTo(scarfNodes[0].x, scarfNodes[0].y);
      for (let i = 1; i < scarfNodes.length; i++) {
        ctx.lineTo(scarfNodes[i].x, scarfNodes[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 4. Elegant S-curved pelican neck
    const neckBase = { x: 45, y: bodyY - 12 };
    ctx.strokeStyle = '#faf7f0';
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(neckBase.x, neckBase.y);
    ctx.bezierCurveTo(neckBase.x + 12, neckBase.y - 16, head.x - 16, head.y + 18, head.x - 4, head.y + 4);
    ctx.stroke();

    // Soft shading along back of neck
    ctx.strokeStyle = '#e5dfd3';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(neckBase.x - 5, neckBase.y - 2);
    ctx.bezierCurveTo(neckBase.x + 5, neckBase.y - 18, head.x - 20, head.y + 15, head.x - 10, head.y + 2);
    ctx.stroke();

    // Scarf collar wrap around base of neck
    ctx.strokeStyle = '#e04f3e';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(neckBase.x - 7, neckBase.y - 3);
    ctx.quadraticCurveTo(neckBase.x + 3, neckBase.y + 3, neckBase.x + 9, neckBase.y - 5);
    ctx.stroke();

    // 5. Iconic Pelican Beak & Elastic Gular Pouch!
    const beakOpen = clamp(state.beakSpring.value, 0, 0.72);
    const pouchBulge = 16 + state.pouchSpring.value * 9 + (state.pouchFish ? 10 : 0);

    ctx.save();
    ctx.translate(head.x + 6, head.y + 1);

    // Lower mandible + stretchy translucent gular pouch
    ctx.save();
    ctx.rotate(beakOpen);

    // Translucent pouch fill
    const pouchGrad = ctx.createLinearGradient(0, 0, 0, pouchBulge + 12);
    pouchGrad.addColorStop(0, '#f59e42');
    pouchGrad.addColorStop(0.55, '#f2784b');
    pouchGrad.addColorStop(1, '#d9534f');
    ctx.fillStyle = pouchGrad;
    ctx.beginPath();
    ctx.moveTo(-2, 4);
    ctx.lineTo(52, 4);
    ctx.bezierCurveTo(44, pouchBulge + 11, 14, pouchBulge + 15, -6, 13);
    ctx.closePath();
    ctx.fill();

    // If a fish was just scooped, show its wiggling silhouette inside the translucent pouch!
    if (state.pouchFish) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      const wiggle = Math.sin(state.time * 24) * 2.2;
      ctx.translate(22, pouchBulge * 0.56 + 4 + wiggle * 0.3);
      ctx.rotate(wiggle * 0.08);
      this._drawFishSprite(ctx, state.pouchFish.golden, 0.72);
      ctx.restore();
    }

    // Pouch highlight crease
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.42)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(6, 9);
    ctx.quadraticCurveTo(24, pouchBulge + 4, 42, 8);
    ctx.stroke();

    // Lower mandible rim
    ctx.strokeStyle = '#d97724';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-2, 4);
    ctx.lineTo(52, 4);
    ctx.stroke();
    ctx.restore();

    // Upper mandible (sleek ridge + signature pelican hooked tip!)
    const upperGrad = ctx.createLinearGradient(0, -6, 58, 4);
    upperGrad.addColorStop(0, '#f7c552');
    upperGrad.addColorStop(0.75, '#f39c38');
    upperGrad.addColorStop(1, '#e0533c');
    ctx.fillStyle = upperGrad;
    ctx.beginPath();
    ctx.moveTo(-3, -6);
    ctx.quadraticCurveTo(26, -8, 56, -1.5);
    ctx.quadraticCurveTo(60, 1.5, 56.5, 6.2); // Hooked unguis tip!
    ctx.quadraticCurveTo(53, 3.2, 49, 2.8);
    ctx.lineTo(-2, 3.2);
    ctx.closePath();
    ctx.fill();

    // Crisp specular ridge on upper beak
    ctx.strokeStyle = 'rgba(255, 250, 225, 0.7)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(4, -4.6);
    ctx.quadraticCurveTo(28, -5.8, 51, -1.6);
    ctx.stroke();

    ctx.restore(); // end beak local

    // 6. Pelican Head & Windswept Crown Tuft
    ctx.fillStyle = '#fffdf7';
    ctx.beginPath();
    ctx.ellipse(head.x, head.y, 13.5, 11.5, -0.1, 0, Math.PI * 2);
    ctx.fill();

    // Cute windswept crown feathers
    ctx.fillStyle = '#f2eee4';
    ctx.beginPath();
    ctx.moveTo(head.x - 6, head.y - 9);
    ctx.quadraticCurveTo(head.x - 18, head.y - 17, head.x - 21, head.y - 10);
    ctx.quadraticCurveTo(head.x - 14, head.y - 8, head.x - 9, head.y - 5);
    ctx.closePath();
    ctx.fill();

    // Rosy golden eye patch
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.ellipse(head.x + 4, head.y - 2, 5.4, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Expressive eye (blinks periodically, joyful arc when catching fish!)
    const isBlinking = state.blinkTimer > 0;
    const isHappy = state.happyTimer > 0;
    if (isHappy) {
      ctx.strokeStyle = '#1d2935';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(head.x + 4.5, head.y - 1.5, 3, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else if (isBlinking) {
      ctx.strokeStyle = '#1d2935';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(head.x + 1.5, head.y - 2);
      ctx.lineTo(head.x + 7.5, head.y - 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#17212b';
      ctx.beginPath();
      ctx.arc(head.x + 4.6, head.y - 2.2, 2.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x + 5.4, head.y - 3.1, 0.95, 0, Math.PI * 2);
      ctx.fill();
    }

    // Soft cheek blush
    ctx.fillStyle = 'rgba(242, 120, 95, 0.25)';
    ctx.beginPath();
    ctx.ellipse(head.x + 1, head.y + 3.5, 3.6, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawPelicanWing(ctx, shoulder, ik, airBlend, time) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Upper wing covert shape
    ctx.fillStyle = '#f8f5ed';
    ctx.strokeStyle = '#d4cec2';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(shoulder.x - 14, shoulder.y + 2);
    ctx.quadraticCurveTo(ik.joint.x - 8, ik.joint.y + 12, ik.end.x, ik.end.y + 2);
    ctx.quadraticCurveTo(ik.joint.x + 4, ik.joint.y - 7, shoulder.x + 4, shoulder.y - 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Primary flight feathers (fan out dramatically when airborne!)
    const spread = 4 + airBlend * 14;
    ctx.strokeStyle = '#53606c';
    ctx.lineWidth = 2.6;
    for (let i = 0; i < 3; i++) {
      const t = 0.55 + i * 0.16;
      const bx = lerp(ik.joint.x, ik.end.x, t);
      const by = lerp(ik.joint.y, ik.end.y, t);
      const angle = Math.atan2(ik.end.y - ik.joint.y, ik.end.x - ik.joint.x) + (0.25 + i * 0.16) * (airBlend > 0.2 ? -1 : 1);
      const len = 7 + spread * 0.45;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle) * len, by + Math.sin(angle) * len);
      ctx.stroke();
    }

    // Little wingtip "hand" gripping the handlebar when riding
    if (airBlend < 0.45) {
      ctx.fillStyle = '#fffdf7';
      ctx.beginPath();
      ctx.arc(ik.end.x, ik.end.y, 4.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _drawEngineeringOverlay(ctx, G, hip, nearIK, farIK, shoulder, wingIK, head, state) {
    ctx.save();

    // Blueprint frame bounding reticle
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(-48, -200, 228, 204);
    ctx.setLineDash([]);

    // Exact Chain Tangent Verification Lines
    if (this.chainTangents) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(this.chainTangents.upper.start.x, this.chainTangents.upper.start.y);
      ctx.lineTo(this.chainTangents.upper.end.x, this.chainTangents.upper.end.y);
      ctx.moveTo(this.chainTangents.lower.start.x, this.chainTangents.lower.start.y);
      ctx.lineTo(this.chainTangents.lower.end.x, this.chainTangents.lower.end.y);
      ctx.stroke();
    }

    // Far Leg IK skeleton (dim cyan)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(hip.x + 2, hip.y);
    ctx.lineTo(farIK.joint.x, farIK.joint.y);
    ctx.lineTo(farIK.end.x, farIK.end.y);
    ctx.stroke();

    // Near Leg 2-Bone IK skeleton (bright cyan)
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(nearIK.joint.x, nearIK.joint.y);
    ctx.lineTo(nearIK.end.x, nearIK.end.y);
    ctx.stroke();

    // Wing IK skeleton (emerald)
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(wingIK.joint.x, wingIK.joint.y);
    ctx.lineTo(wingIK.end.x, wingIK.end.y);
    ctx.stroke();

    // Crank orbit circle
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(G.bottomBracket.x, G.bottomBracket.y, G.crankLength, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Joint nodes
    const drawNode = (pt, color, label) => {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (label) {
        ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = color;
        ctx.fillText(label, pt.x + 7, pt.y - 4);
      }
    };

    drawNode(hip, '#22d3ee', 'HIP');
    drawNode(nearIK.joint, '#22d3ee', `β=${Math.round((nearIK.kneeAngle * 180) / Math.PI)}°`);
    drawNode(nearIK.end, '#facc15', 'PEDAL');
    drawNode(G.bottomBracket, '#facc15', 'BB');
    drawNode(shoulder, '#34d399', 'SHLD');

    // Pouch spring vector
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(head.x + 28, head.y + 6);
    ctx.lineTo(head.x + 28, head.y + 24 + state.pouchSpring.value * 9);
    ctx.stroke();

    ctx.restore();
  }

  _drawParticles(ctx, state) {
    ctx.save();
    for (const p of state.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      if (p.kind === 'text') {
        ctx.font = '700 14px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.kind === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + (1 - alpha) * 26, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'streak') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.len, p.y);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawHUD(ctx, W, H, theme, state, telemetry) {
    ctx.save();
    // Top-left compact score & status pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.52)';
    this._roundRect(ctx, 12, 10, 178, 30, 15);
    ctx.fill();

    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`🐟 渔获 ${state.score}`, 24, 29);

    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`·  ${telemetry.speedKmh} km/h`, 94, 29);

    // Top-right subtle hint or live IK engineering readout
    if (state.xrayMode) {
      const boxW = Math.min(256, W - 210);
      const bx = W - boxW - 12;
      ctx.fillStyle = 'rgba(8, 20, 38, 0.78)';
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
      ctx.lineWidth = 1;
      this._roundRect(ctx, bx, 10, boxW, 54, 10);
      ctx.fill();
      ctx.stroke();

      ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#22d3ee';
      ctx.fillText(`IK 2-BONE  β:${telemetry.kneeAngleDeg}°  RPM:${telemetry.cadenceRpm}`, bx + 10, 30);
      ctx.fillStyle = '#facc15';
      ctx.fillText(`PITCH:${telemetry.pitchDeg}°  POUCH:${state.pouchSpring.value.toFixed(2)}`, bx + 10, 50);
    } else if (W >= 420) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
      this._roundRect(ctx, W - 188, 10, 176, 30, 15);
      ctx.fill();
      ctx.font = '500 12px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText('点击画面 / Space 跳跃吞鱼', W - 176, 29);
    }

    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
