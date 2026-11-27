/**
 * Procedural Web Audio synthesizer for the Pelican Bicycle coastal soundscape.
 * Zero external audio files required — every sound is synthesized in real time.
 */
export class PelicanAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.oceanGain = null;
    this.lastClickTime = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this._startOceanAmbience();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return true;
  }

  toggle() {
    if (!this.enabled) {
      if (!this.unlock()) return false;
      this.enabled = true;
      if (this.oceanGain) {
        this.oceanGain.gain.setTargetAtTime(0.035, this.ctx.currentTime, 0.2);
      }
    } else {
      this.enabled = false;
      if (this.oceanGain) {
        this.oceanGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.15);
      }
    }
    return this.enabled;
  }

  _startOceanAmbience() {
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 2.5;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;

    // Gentle wave LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.16;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    this.oceanGain = ctx.createGain();
    this.oceanGain.gain.value = 0.0;

    noise.connect(filter);
    filter.connect(this.oceanGain);
    this.oceanGain.connect(ctx.destination);
    noise.start();
  }

  /**
   * Classic brass bicycle bell: dual-hit metallic bell with inharmonic partials.
   */
  playBell() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const hit = (startOffset) => {
      const freqs = [1568, 3136, 4215];
      const amps = [0.16, 0.07, 0.035];
      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + startOffset);
        gain.gain.setValueAtTime(0.0001, now + startOffset);
        gain.gain.exponentialRampToValueAtTime(amps[idx], now + startOffset + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + 0.55 - idx * 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + 0.6);
      });
    };
    hit(0);
    hit(0.11);
  }

  /**
   * Playful springy hop + beak snap sound.
   */
  playJump() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.14);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  /**
   * Cheerful marimba arpeggio when the pelican scoops a leaping fish!
   */
  playCatch(isGolden = false) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = isGolden ? [587.3, 739.9, 880, 1174.6] : [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  /**
   * Soft wooden thump when landing back on the boardwalk.
   */
  playLand() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  /**
   * Subtle bicycle freehub pawl click during wheelie / coasting.
   */
  playFreehubTick(rateHz = 12) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastClickTime < 1 / Math.max(4, rateHz)) return;
    this.lastClickTime = now;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2200, now);
    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.012);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.015);
  }
}
