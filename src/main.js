import { PelicanGame } from './game.js';

const TIME_LABELS = {
  day: '晴空海岸',
  sunset: '落日栈道',
  night: '月夜灯塔',
};

const canvas = document.getElementById('pelican-canvas');
const speedInput = document.getElementById('speed-range');
const btnJump = document.getElementById('btn-jump');
const btnWheelie = document.getElementById('btn-wheelie');
const btnBell = document.getElementById('btn-bell');
const btnXray = document.getElementById('btn-xray');
const btnTime = document.getElementById('btn-time');
const btnAudio = document.getElementById('btn-audio');

const game = new PelicanGame(canvas, {
  onStateChange(state) {
    btnTime.textContent = TIME_LABELS[state.timeOfDay] || '晴空海岸';
    btnXray.classList.toggle('active', state.xrayMode);
    btnAudio.textContent = game.audio.enabled ? '音效：开' : '开启音效';
    btnAudio.classList.toggle('active', game.audio.enabled);
  },
});

speedInput.addEventListener('input', (e) => game.setTargetSpeed(e.target.value));
btnJump.addEventListener('click', () => game.jumpAndScoop());
let wheelieDownAt = 0;
btnWheelie.addEventListener('pointerdown', () => {
  wheelieDownAt = performance.now();
  game.triggerWheelie(true);
});
btnWheelie.addEventListener('pointerup', () => {
  if (performance.now() - wheelieDownAt < 240) {
    game.pulseWheelie();
  } else {
    game.triggerWheelie(false);
  }
});
btnWheelie.addEventListener('pointerleave', () => game.triggerWheelie(false));
btnWheelie.addEventListener('pointercancel', () => game.triggerWheelie(false));
btnBell.addEventListener('click', () => game.ringBell());
btnXray.addEventListener('click', () => game.toggleXray());
btnTime.addEventListener('click', () => game.cycleTimeOfDay());
btnAudio.addEventListener('click', () => game.toggleAudio());

game.start();
