/**
 * Core mathematical kinematics & physics engine for the Pelican Bicycle project.
 * Pure, deterministic functions so they can be shared by the runtime and unit tests.
 */

export const BIKE_GEOM = Object.freeze({
  wheelRadius: 40,
  rearHub: { x: 0, y: -40 },
  frontHub: { x: 132, y: -40 },
  bottomBracket: { x: 50, y: -35 },
  seatTubeTop: { x: 32, y: -89 },
  saddle: { x: 25, y: -105 },
  headTubeBottom: { x: 110, y: -80 },
  headTubeTop: { x: 103, y: -102 },
  stemTop: { x: 98, y: -118 },
  handleGrip: { x: 80, y: -115 },
  chainringRadius: 15,
  rearCogRadius: 7,
  crankLength: 16,
  legUpper: 48,
  legLower: 48,
  wingUpper: 28,
  wingLower: 26,
});

/**
 * Clamp a number between min and max.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation.
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Exact 2-bone analytical Inverse Kinematics solver in 2D screen space (y down).
 *
 * @param {{x: number, y: number}} root - Hip or shoulder joint position
 * @param {{x: number, y: number}} target - Pedal or handlebar grip position
 * @param {number} len1 - Upper segment length
 * @param {number} len2 - Lower segment length
 * @param {1 | -1} bendDir - Controls which side the middle joint bends toward
 * @returns {{
 *   joint: {x: number, y: number},
 *   end: {x: number, y: number},
 *   hipAngle: number,
 *   kneeAngle: number,
 *   reachRatio: number
 * }}
 */
export function solveTwoBoneIK(root, target, len1, len2, bendDir = 1) {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const rawDist = Math.hypot(dx, dy);

  const minDist = Math.abs(len1 - len2) + 1e-4;
  const maxDist = len1 + len2 - 1e-4;
  const dist = clamp(rawDist, minDist, maxDist);

  const baseAngle = Math.atan2(dy, dx);
  // Law of cosines for angle at root
  const cosAlpha = clamp(
    (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist),
    -1,
    1
  );
  const alpha = Math.acos(cosAlpha);

  // Law of cosines for interior joint angle
  const cosBeta = clamp(
    (len1 * len1 + len2 * len2 - dist * dist) / (2 * len1 * len2),
    -1,
    1
  );
  const kneeAngle = Math.acos(cosBeta);

  const hipAngle = baseAngle + bendDir * alpha;
  const joint = {
    x: root.x + Math.cos(hipAngle) * len1,
    y: root.y + Math.sin(hipAngle) * len1,
  };

  // End point snaps to reachable circle if target exceeded maxDist
  const end =
    rawDist <= maxDist && rawDist >= minDist
      ? { x: target.x, y: target.y }
      : {
          x: root.x + Math.cos(baseAngle) * dist,
          y: root.y + Math.sin(baseAngle) * dist,
        };

  return {
    joint,
    end,
    hipAngle,
    kneeAngle,
    reachRatio: rawDist / (len1 + len2),
  };
}

/**
 * Compute exact external tangent segments between two circles (rear cog and front chainring)
 * so the bicycle chain connects seamlessly without clipping or floating.
 */
export function computeChainTangents(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= Math.abs(r1 - r2) + 1e-4) {
    return null;
  }

  const baseAngle = Math.atan2(dy, dx);
  const offset = Math.acos(clamp((r1 - r2) / dist, -1, 1));

  // Upper & lower external tangent normals
  const angleA = baseAngle - offset;
  const angleB = baseAngle + offset;

  const upper = {
    start: { x: c1.x + Math.cos(angleA) * r1, y: c1.y + Math.sin(angleA) * r1 },
    end: { x: c2.x + Math.cos(angleA) * r2, y: c2.y + Math.sin(angleA) * r2 },
  };
  const lower = {
    start: { x: c1.x + Math.cos(angleB) * r1, y: c1.y + Math.sin(angleB) * r1 },
    end: { x: c2.x + Math.cos(angleB) * r2, y: c2.y + Math.sin(angleB) * r2 },
  };

  return { upper, lower, spanLength: Math.hypot(upper.end.x - upper.start.x, upper.end.y - upper.start.y) };
}

/**
 * Compute pedal pin world position in bike local coordinates for crank angle theta.
 */
export function getPedalPosition(crankAngle, geom = BIKE_GEOM) {
  return {
    x: geom.bottomBracket.x + Math.cos(crankAngle) * geom.crankLength,
    y: geom.bottomBracket.y + Math.sin(crankAngle) * geom.crankLength,
  };
}

/**
 * Second-order damped harmonic oscillator (spring-damper) for organic pouch jiggle,
 * saddle suspension, wheelie pitch, and neck bobbing.
 */
export class SpringDamper {
  constructor(initial = 0, stiffness = 120, damping = 12) {
    this.value = initial;
    this.target = initial;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  impulse(deltaVelocity) {
    this.velocity += deltaVelocity;
  }

  step(dt) {
    const safeDt = Math.min(dt, 0.04);
    const force = (this.target - this.value) * this.stiffness;
    const damp = -this.velocity * this.damping;
    this.velocity += (force + damp) * safeDt;
    this.value += this.velocity * safeDt;
    return this.value;
  }
}

/**
 * Lightweight Verlet chain for the pelican's fluttering coastal scarf.
 */
export class VerletRibbon {
  constructor(nodeCount = 7, segmentLength = 7.5) {
    this.segmentLength = segmentLength;
    this.nodes = Array.from({ length: nodeCount }, (_, i) => ({
      x: -i * segmentLength,
      y: 0,
      oldX: -i * segmentLength,
      oldY: 0,
    }));
  }

  reset(anchorX, anchorY) {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].x = anchorX - i * this.segmentLength;
      this.nodes[i].y = anchorY;
      this.nodes[i].oldX = this.nodes[i].x;
      this.nodes[i].oldY = this.nodes[i].y;
    }
  }

  step(anchorX, anchorY, windX, windY, time, dt) {
    const safeDt = Math.min(dt, 0.033);
    const dtSq = safeDt * safeDt;

    this.nodes[0].x = anchorX;
    this.nodes[0].y = anchorY;

    for (let i = 1; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const vx = (n.x - n.oldX) * 0.9;
      const vy = (n.y - n.oldY) * 0.9;
      n.oldX = n.x;
      n.oldY = n.y;

      const flutter = Math.sin(time * 14 - i * 0.95) * (45 + Math.abs(windX) * 0.12);
      n.x += vx + windX * dtSq;
      n.y += vy + (windY + flutter) * dtSq;
    }

    // Distance constraint relaxation
    for (let iter = 0; iter < 5; iter++) {
      this.nodes[0].x = anchorX;
      this.nodes[0].y = anchorY;
      for (let i = 1; i < this.nodes.length; i++) {
        const a = this.nodes[i - 1];
        const b = this.nodes[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-4;
        const diff = (d - this.segmentLength) / d;
        if (i === 1) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.35;
          a.y += dy * diff * 0.35;
          b.x -= dx * diff * 0.65;
          b.y -= dy * diff * 0.65;
        }
      }
    }
  }
}
