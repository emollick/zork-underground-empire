import type { RoomDef } from './types.ts';
import { isHouseGrounds } from './scene-layout.ts';

export class Soundscape {
  private context?: AudioContext;
  private master?: GainNode;
  private ambience?: GainNode;
  private wind?: BiquadFilterNode;
  private room?: RoomDef;
  private volume = 0.65;
  private nextDetail = 0;
  private nextNote = 0;
  private noiseBuffer?: AudioBuffer;
  private paused = false;
  async start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume * 0.5;
      this.master.connect(this.context.destination);
      const length = this.context.sampleRate * 3;
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const d = this.noiseBuffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < length; i++) { brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.02; d[i] = brown * 3.5; }
      const noise = this.context.createBufferSource(); noise.buffer = this.noiseBuffer; noise.loop = true;
      this.wind = this.context.createBiquadFilter(); this.wind.type = 'lowpass'; this.wind.frequency.value = 500;
      this.ambience = this.context.createGain(); this.ambience.gain.value = 0.24;
      noise.connect(this.wind); this.wind.connect(this.ambience); this.ambience.connect(this.master); noise.start();
      this.enter(this.room);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  setVolume(value: number) { this.volume = value; if (this.master && this.context) this.master.gain.setTargetAtTime(value * 0.5, this.context.currentTime, 0.15); }
  setPaused(value: boolean) { this.paused = value; }
  enter(room?: RoomDef) {
    this.room = room;
    if (!this.context || !this.wind || !this.ambience || !room) return;
    const outdoor = isHouseGrounds(room.id) || ['forest', 'falls', 'rainbow', 'river', 'sand', 'barrow'].includes(room.kind);
    const water = ['dam', 'reservoir', 'falls', 'river', 'rainbow'].includes(room.kind);
    this.wind.frequency.setTargetAtTime(water ? 1900 : outdoor ? 700 : 180, this.context.currentTime, 1.5);
    this.ambience.gain.setTargetAtTime(water ? 0.65 : outdoor ? 0.34 : 0.18, this.context.currentTime, 1.5);
    this.nextDetail = 0; this.nextNote = 0;
  }
  private tone(frequency: number, duration: number, volume = 0.2, type: OscillatorType = 'sine', delay = 0, pan = 0, endFrequency?: number) {
    const c = this.context; if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const oscillator = c.createOscillator(), gain = c.createGain(), stereo = c.createStereoPanner();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, t);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + Math.min(0.02, duration * 0.1)); gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    stereo.pan.value = pan; oscillator.connect(gain); gain.connect(stereo); stereo.connect(this.master);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); stereo.disconnect(); };
    oscillator.start(t); oscillator.stop(t + duration + 0.05);
  }
  private noise(duration: number, volume: number, cutoff: number, delay = 0) {
    const c = this.context; if (!c || !this.master || !this.noiseBuffer) return;
    const t = c.currentTime + delay, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.noiseBuffer; filter.type = 'highpass'; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(t, Math.random()); source.stop(t + duration);
  }
  effect(name: string) {
    const aliases: Record<string, string> = { pickup: 'take', mechanism: 'solve', reveal: 'solve', victory: 'treasure', travel: 'door', rest: 'solve', win: 'ending' };
    name = aliases[name] ?? name;
    switch (name) {
      case 'step': {
        const outdoors = isHouseGrounds(this.room?.id ?? '') || this.room?.kind === 'forest';
        this.noise(outdoors ? 0.18 : 0.09, outdoors ? 0.2 : 0.24, outdoors ? 550 : 190);
        this.tone(70 + Math.random() * 15, 0.07, 0.11, 'sine'); break;
      }
      case 'swing': this.noise(0.23, 0.8, 600); break;
      case 'hit': this.noise(0.18, 1.1, 180); this.tone(90, 0.18, 0.45, 'triangle', 0, 0, 38); break;
      case 'hurt': this.tone(63, 0.34, 0.5, 'sawtooth', 0, 0, 32); this.noise(0.2, 0.5, 350); break;
      case 'parry': [870, 1250, 1870, 2380].forEach((f, i) => this.tone(f, 0.8, 0.15 / (i + 1), 'sine')); break;
      case 'block': this.tone(260, 0.3, 0.3, 'triangle'); this.noise(0.2, 0.6, 700); break;
      case 'dodge': this.noise(0.3, 0.5, 350); break;
      case 'lantern': this.noise(0.12, 0.4, 1300); this.tone(700, 0.05, 0.07); break;
      case 'paper': this.noise(0.38, 0.32, 1100); break;
      case 'treasure': [293.665, 440, 587.33, 880].forEach((f, i) => this.tone(f, 2.1, 0.22, 'sine', i * 0.14, (i - 1.5) * 0.2)); break;
      case 'take': this.tone(590, 0.25, 0.14, 'triangle'); this.tone(885, 0.5, 0.12, 'sine', 0.05); break;
      case 'door': this.noise(0.7, 0.65, 120); this.tone(55, 0.5, 0.16, 'triangle', 0, 0, 36); break;
      case 'solve': [196, 293.665, 392, 493.88].forEach((f, i) => this.tone(f, 2.6, 0.18, 'sine', i * 0.16)); break;
      case 'bell': [293.665, 589, 831, 1456].forEach((f, i) => this.tone(f, 4.2 - i * 0.3, 0.36 / (i + 1), 'sine')); break;
      case 'roar': this.tone(46, 0.9, 0.5, 'sawtooth', 0, 0, 78); this.noise(0.9, 0.7, 120); break;
      case 'death': [146.832, 138.59, 73.416].forEach((f, i) => this.tone(f, 3, 0.2, 'sine', i * 0.18)); break;
      case 'ending': [146.832, 220, 293.665, 369.994, 440, 587.33].forEach((f, i) => this.tone(f, 5.5, 0.2, 'sine', i * 0.28)); break;
      default: this.tone(330, 0.2, 0.05, 'sine');
    }
  }
  update(time: number) {
    if (!this.context || !this.room || this.paused) return;
    if (time > this.nextDetail) {
      this.nextDetail = time + 5 + Math.random() * 7;
      const outside = this.room.kind === 'forest' || this.room.kind === 'barrow';
      if (outside) {
        const f = 1700 + Math.random() * 1200, pan = Math.random() * 1.7 - 0.85;
        for (let i = 0; i < 3; i++) this.tone(f + i * 220, 0.09, 0.045, 'sine', i * 0.17, pan, f * 1.15);
      } else {
        const f = 820 + Math.random() * 350;
        this.tone(f, 0.16, 0.08, 'sine', 0, Math.random() * 1.8 - 0.9, f * 0.65);
        this.tone(f, 0.6, 0.022, 'sine', 0.17, Math.random() * 1.8 - 0.9);
      }
    }
    if (time > this.nextNote) {
      this.nextNote = time + 7 + Math.random() * 5;
      const notes = this.room.kind === 'forest' ? [146.83, 196, 220, 293.66, 329.63] : [73.416, 110, 146.832, 164.81, 196];
      const frequency = notes[Math.floor(Math.random() * notes.length)];
      this.tone(frequency, 6.5, 0.045, 'sine', 0, -0.3);
      this.tone(frequency * 2.003, 5.8, 0.025, 'sine', 0.3, 0.4);
    }
  }
}
