import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIKE_GEOM,
  solveTwoBoneIK,
  computeChainTangents,
  getPedalPosition,
  SpringDamper,
  VerletRibbon,
} from '../src/kinematics.js';

test('2-bone IK maintains exact bone lengths across a full 360° pedal stroke', () => {
  const hip = { x: 30, y: -105 };
  for (let deg = 0; deg < 360; deg += 5) {
    const theta = (deg * Math.PI) / 180;
    const pedal = getPedalPosition(theta, BIKE_GEOM);
    const ik = solveTwoBoneIK(hip, pedal, BIKE_GEOM.legUpper, BIKE_GEOM.legLower, -1);

    const upperLen = Math.hypot(ik.joint.x - hip.x, ik.joint.y - hip.y);
    const lowerLen = Math.hypot(ik.end.x - ik.joint.x, ik.end.y - ik.joint.y);
    const footErr = Math.hypot(ik.end.x - pedal.x, ik.end.y - pedal.y);

    assert.ok(Math.abs(upperLen - BIKE_GEOM.legUpper) < 1e-6, `upper bone length mismatch at ${deg}°`);
    assert.ok(Math.abs(lowerLen - BIKE_GEOM.legLower) < 1e-6, `lower bone length mismatch at ${deg}°`);
    assert.ok(footErr < 1e-6, `foot detached from pedal at ${deg}°`);
    assert.ok(ik.joint.x > hip.x, `knee should bend forward (+x) at ${deg}°`);
    assert.ok(ik.kneeAngle > 0.6 && ik.kneeAngle < 2.8, `knee angle out of ergonomic bounds at ${deg}°`);
  }
});

test('2-bone IK gracefully clamps unreachable targets without NaN', () => {
  const ik = solveTwoBoneIK({ x: 0, y: 0 }, { x: 500, y: 0 }, 40, 40, 1);
  assert.ok(Number.isFinite(ik.joint.x) && Number.isFinite(ik.joint.y));
  assert.ok(Number.isFinite(ik.end.x) && Number.isFinite(ik.end.y));
  const totalReach = Math.hypot(ik.end.x, ik.end.y);
  assert.ok(Math.abs(totalReach - 80) < 0.01);
});

test('chain tangents are strictly tangent (perpendicular to radii) on both gears', () => {
  const tangents = computeChainTangents(
    BIKE_GEOM.rearHub,
    BIKE_GEOM.rearCogRadius,
    BIKE_GEOM.bottomBracket,
    BIKE_GEOM.chainringRadius
  );
  assert.ok(tangents !== null);

  for (const seg of [tangents.upper, tangents.lower]) {
    const vx = seg.end.x - seg.start.x;
    const vy = seg.end.y - seg.start.y;
    const r1x = seg.start.x - BIKE_GEOM.rearHub.x;
    const r1y = seg.start.y - BIKE_GEOM.rearHub.y;
    const r2x = seg.end.x - BIKE_GEOM.bottomBracket.x;
    const r2y = seg.end.y - BIKE_GEOM.bottomBracket.y;

    // Radii match exact gear radii
    assert.ok(Math.abs(Math.hypot(r1x, r1y) - BIKE_GEOM.rearCogRadius) < 1e-6);
    assert.ok(Math.abs(Math.hypot(r2x, r2y) - BIKE_GEOM.chainringRadius) < 1e-6);

    // Dot product between tangent vector and radius vector must be ~0
    assert.ok(Math.abs(vx * r1x + vy * r1y) < 1e-5, 'chain not tangent to rear cog');
    assert.ok(Math.abs(vx * r2x + vy * r2y) < 1e-5, 'chain not tangent to front chainring');
  }
});

test('SpringDamper converges cleanly to target after impulse', () => {
  const spring = new SpringDamper(0, 120, 14);
  spring.target = 1.0;
  spring.impulse(5.0);
  for (let i = 0; i < 300; i++) {
    spring.step(1 / 60);
  }
  assert.ok(Math.abs(spring.value - 1.0) < 1e-3);
  assert.ok(Math.abs(spring.velocity) < 1e-3);
});

test('VerletRibbon preserves anchor lock and finite segment lengths', () => {
  const ribbon = new VerletRibbon(7, 8);
  ribbon.reset(40, -130);
  for (let i = 0; i < 120; i++) {
    ribbon.step(40, -130, -450, 30, i / 60, 1 / 60);
  }
  assert.equal(ribbon.nodes[0].x, 40);
  assert.equal(ribbon.nodes[0].y, -130);
  for (let i = 1; i < ribbon.nodes.length; i++) {
    const a = ribbon.nodes[i - 1];
    const b = ribbon.nodes[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(Number.isFinite(d) && Math.abs(d - 8) < 1.2, `segment ${i} stretched too far: ${d}`);
  }
});
