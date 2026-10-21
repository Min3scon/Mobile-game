'use strict';
/* Neon Swarm — synthesized sound effects and music (Web Audio, no files) */

const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let sfxOn = true, musicOn = true, voices = 0;
  const last = Object.create(null);
  const SFX_VOL = 0.5, MUSIC_VOL = 0.22, MAX_VOICES = 14;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // Mix with the player's own music and respect the silent switch.
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* not supported */ }
    try { ctx = new AC(); } catch (e) { return false; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(comp);
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxOn ? SFX_VOL : 0;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? MUSIC_VOL : 0;
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // iOS only counts touchend/pointerup as a gesture that may start audio.
  function unlock() {
    if (!ensure()) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) { /* ignore */ }
  }

  function suspend() {
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
  }

  function live() {
    return ctx && ctx.state === 'running';
  }

  function gate(name, ms) {
    if (!live() || !sfxOn || voices >= MAX_VOICES) return false;
    const now = performance.now();
    if (last[name] && now - last[name] < ms) return false;
    last[name] = now;
    return true;
  }

  function tone(o) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + (o.slide || o.dur));
    const v = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(o.bus || sfxBus);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.03);
    if (!o.bus) {
      voices++;
      osc.onended = () => { voices--; };
    }
  }

  function noise(o) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1000, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
    f.Q.value = o.q == null ? 1 : o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.1, t0 + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.bus || sfxBus);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + o.dur + 0.03);
    if (!o.bus) {
      voices++;
      src.onended = () => { voices--; };
    }
  }

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const play = {
    click() { if (gate('click', 40)) tone({ type: 'square', f: 720, f2: 520, dur: 0.05, vol: 0.06 }); },
    shoot() { if (gate('shoot', 75)) tone({ type: 'square', f: 940, f2: 420, dur: 0.06, vol: 0.035 }); },
    hit() { if (gate('hit', 50)) noise({ f: 2600, q: 1.5, dur: 0.035, vol: 0.07 }); },
    kill() {
      if (!gate('kill', 45)) return;
      tone({ type: 'triangle', f: rand(520, 680), f2: 110, dur: 0.11, vol: 0.09 });
      noise({ f: 900, q: 0.8, dur: 0.07, vol: 0.05 });
    },
    gem(step) {
      if (!gate('gem', 38)) return;
      tone({ type: 'sine', f: NOTE(76 + (step % 16)), dur: 0.08, vol: 0.07 });
    },
    coin() {
      if (!gate('coin', 60)) return;
      tone({ type: 'square', f: 988, dur: 0.06, vol: 0.05 });
      tone({ type: 'square', f: 1319, dur: 0.12, vol: 0.05, delay: 0.06 });
    },
    levelup() {
      if (!gate('levelup', 200)) return;
      [72, 76, 79, 84].forEach((n, i) => {
        tone({ type: 'triangle', f: NOTE(n), dur: 0.16, vol: 0.12, delay: i * 0.065 });
        tone({ type: 'square', f: NOTE(n + 12), dur: 0.1, vol: 0.03, delay: i * 0.065 });
      });
    },
    pick() {
      if (!gate('pick', 80)) return;
      tone({ type: 'sine', f: 300, f2: 900, dur: 0.18, vol: 0.12 });
      noise({ f: 600, f2: 4000, dur: 0.2, vol: 0.05 });
    },
    hurt() {
      if (!gate('hurt', 120)) return;
      tone({ type: 'sawtooth', f: 230, f2: 55, dur: 0.24, vol: 0.16 });
      noise({ filter: 'lowpass', f: 700, dur: 0.18, vol: 0.12 });
    },
    zap() {
      if (!gate('zap', 70)) return;
      noise({ filter: 'highpass', f: 2800, dur: 0.12, vol: 0.09 });
      tone({ type: 'sawtooth', f: 1400, f2: 260, dur: 0.1, vol: 0.04 });
    },
    boom() {
      if (!gate('boom', 70)) return;
      noise({ filter: 'lowpass', f: 1400, f2: 90, dur: 0.32, vol: 0.18 });
      tone({ type: 'sine', f: 130, f2: 40, dur: 0.28, vol: 0.18 });
    },
    nova() {
      if (!gate('nova', 120)) return;
      tone({ type: 'sine', f: 320, f2: 70, dur: 0.34, vol: 0.14 });
      noise({ f: 500, f2: 3200, dur: 0.28, vol: 0.05 });
    },
    laser() {
      if (!gate('laser', 90)) return;
      tone({ type: 'sawtooth', f: 1700, f2: 220, dur: 0.2, vol: 0.05 });
      tone({ type: 'square', f: 850, f2: 110, dur: 0.2, vol: 0.03 });
    },
    launch() { if (gate('launch', 90)) noise({ f: 1600, f2: 500, q: 2, dur: 0.12, vol: 0.05 }); },
    enemyShot() { if (gate('eshot', 90)) tone({ type: 'square', f: 300, f2: 620, dur: 0.08, vol: 0.035 }); },
    chest() {
      if (!gate('chest', 300)) return;
      [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => tone({ type: 'triangle', f: NOTE(n), dur: 0.2, vol: 0.1, delay: i * 0.055 }));
    },
    evolve() {
      if (!gate('evolve', 400)) return;
      [48, 55, 60, 64, 67].forEach((n) => tone({ type: 'sawtooth', f: NOTE(n), dur: 1.1, vol: 0.05, attack: 0.05 }));
      noise({ f: 300, f2: 6000, dur: 0.9, vol: 0.06, attack: 0.2 });
      [84, 88, 91, 96].forEach((n, i) => tone({ type: 'triangle', f: NOTE(n), dur: 0.25, vol: 0.06, delay: 0.3 + i * 0.08 }));
    },
    warning() {
      if (!gate('warning', 800)) return;
      for (let i = 0; i < 3; i++) {
        tone({ type: 'sawtooth', f: 440, f2: 330, slide: 0.25, dur: 0.28, vol: 0.08, delay: i * 0.36 });
      }
    },
    pickup() {
      if (!gate('pickup', 150)) return;
      tone({ type: 'sine', f: 200, f2: 1600, dur: 0.35, vol: 0.12 });
      tone({ type: 'triangle', f: 400, f2: 2400, dur: 0.3, vol: 0.05, delay: 0.05 });
    },
    buy() {
      if (!gate('buy', 80)) return;
      tone({ type: 'square', f: 660, dur: 0.06, vol: 0.06 });
      tone({ type: 'square', f: 990, dur: 0.1, vol: 0.06, delay: 0.07 });
    },
    deny() { if (gate('deny', 120)) tone({ type: 'square', f: 180, f2: 140, dur: 0.14, vol: 0.06 }); },
    death() {
      if (!gate('death', 500)) return;
      tone({ type: 'sawtooth', f: 440, f2: 40, dur: 1.2, vol: 0.14 });
      noise({ filter: 'lowpass', f: 2000, f2: 60, dur: 1.0, vol: 0.18 });
    },
    victory() {
      if (!gate('victory', 1000)) return;
      [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36], [67, 0.6], [72, 0.72], [76, 0.84], [79, 1.0]].forEach(([n, d]) => {
        tone({ type: 'triangle', f: NOTE(n), dur: 0.3, vol: 0.12, delay: d });
        tone({ type: 'square', f: NOTE(n - 12), dur: 0.25, vol: 0.03, delay: d });
      });
    },
  };

  // --- Music: a small step sequencer, scheduled ahead on the audio clock ---
  const BPM = 118, STEP = 60 / BPM / 4;
  const ROOTS = [45, 41, 48, 43]; // A F C G
  let timer = null, step = 0, nextT = 0, intensity = 0;

  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.18);
  }
  function hat(t, v) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random() * 0.5); s.stop(t + 0.05);
  }
  function synth(t, f, dur, type, v, cutoff) {
    const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    fl.type = 'lowpass'; fl.frequency.setValueAtTime(cutoff, t); fl.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.02);
  }
  function playStep(s, t) {
    const bar = Math.floor(s / 16) % 4, b = s % 16, root = ROOTS[bar];
    if (b % 4 === 0) kick(t);
    if (b % 4 === 2) hat(t, 0.06);
    if (intensity > 0 && b % 2 === 1) hat(t, 0.025);
    if (b % 2 === 0) synth(t, NOTE(root + (b % 8 === 6 ? 12 : 0)), STEP * 1.8, 'sawtooth', 0.16, 500 + intensity * 300);
    if (b === 0) [0, 3, 7].forEach((iv) => synth(t, NOTE(root + 24 + iv), STEP * 15, 'triangle', 0.035, 1800));
    if (intensity > 1) {
      const arp = [0, 7, 12, 15, 12, 7, 3, 7];
      synth(t, NOTE(root + 36 + arp[b % 8]), STEP * 0.9, 'square', 0.03, 2600);
    }
  }
  function schedule() {
    if (!live()) return;
    if (nextT < ctx.currentTime - 0.2) nextT = ctx.currentTime + 0.05;
    while (nextT < ctx.currentTime + 0.15) {
      playStep(step, nextT);
      nextT += STEP;
      step = (step + 1) % 64;
    }
  }
  function startMusic() {
    if (timer || !ensure()) return;
    step = 0;
    nextT = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 30);
  }
  function stopMusic() {
    clearInterval(timer);
    timer = null;
  }

  function setSfx(on) {
    sfxOn = on;
    if (sfxBus) sfxBus.gain.value = on ? SFX_VOL : 0;
  }
  function setMusic(on) {
    musicOn = on;
    if (musicBus) musicBus.gain.value = on ? MUSIC_VOL : 0;
  }

  return { unlock, suspend, live, play, startMusic, stopMusic, setSfx, setMusic, setIntensity: (n) => { intensity = n; } };
})();

// iOS 18 web "haptics": toggling a hidden switch control plays the system tick.
// Only works inside a real tap handler, so UI code calls it, never the game loop.
const Haptics = (() => {
  let label = null, enabled = true;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function mount() {
    if (!isIOS || label) return;
    label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.tabIndex = -1;
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.body.appendChild(label);
  }
  function tap() {
    if (!enabled) return;
    if (navigator.vibrate) {
      try { navigator.vibrate(10); } catch (e) { /* ignore */ }
      return;
    }
    if (label) label.click();
  }
  return { mount, tap, set: (on) => { enabled = on; } };
})();
