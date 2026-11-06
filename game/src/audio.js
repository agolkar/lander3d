// Synthesised audio for the lunar landing game. No audio files: everything is
// generated with the Web Audio API. All methods are safe no-ops until unlock().

const ENGINE_LOWPASS_HZ = 180;
const ENGINE_RUMBLE_HZ = 55;
const RATTLE_BAND_HZ = 900;
const RCS_BURST_MS = 25;
const RCS_BURSTS_PER_SEC = 8;
const FUEL_WARN_60 = 60;
const FUEL_WARN_30 = 30;
const ALT_CALLOUT_MAX = 150;
const ALT_CALLOUT_MIN_INTERVAL = 4;
const ALT_CALLOUT_MAX_INTERVAL = 5;

function numToWords(n) {
  n = Math.round(n);
  if (n < 0) return 'minus ' + numToWords(-n);
  if (n === 0) return 'zero';
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return tens[t] + (o ? ' ' + ones[o] : '');
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return ones[h] + ' hundred' + (r ? ' ' + numToWords(r) : '');
  }
  return String(n);
}

function roundAltitude(m) {
  if (m > 50) return Math.round(m / 5) * 5;
  return Math.round(m);
}

function roundRate(v) {
  return Math.round(v);
}

export function createAudio(config) {
  const cfg = config || {};
  const masterVolume = typeof cfg.masterVolume === 'number' ? cfg.masterVolume : 0.6;
  const voiceEnabledDefault = cfg.voice !== false;
  const voiceRate = typeof cfg.voiceRate === 'number' ? cfg.voiceRate : 1.05;

  let ctx = null;
  let master = null;
  let engineGain = null;
  let engineLowpass = null;
  let rumbleGain = null;
  let rattleGain = null;
  let noiseBuffer = null;
  let engineSource = null;
  let rumbleOsc = null;
  let rattleSource = null;
  let engineRunning = false;

  let muted = false;
  let voiceOn = voiceEnabledDefault;

  // RCS burst scheduling
  let rcsNextBurst = 0;
  let rcsActive = false;

  // Fuel chime state
  let warned60 = false;
  let warned30 = false;
  let chime30Timer = 0;

  // Altitude callout state
  let altCalloutTimer = 0;

  // Landing / contact state
  let landedConfirmed = false;
  let contactTonePlayed = false;
  let engineStopCalloutPending = false;
  let engineStopCalloutTimer = 0;

  // Speech queue guard
  let speaking = false;

  function makeNoiseBuffer(seconds) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    // Brown noise via integrated white noise, normalised.
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }

  function makeWhiteNoiseBuffer(seconds) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function buildEngine() {
    engineSource = ctx.createBufferSource();
    engineSource.buffer = noiseBuffer;
    engineSource.loop = true;

    engineLowpass = ctx.createBiquadFilter();
    engineLowpass.type = 'lowpass';
    engineLowpass.frequency.value = ENGINE_LOWPASS_HZ;
    engineLowpass.Q.value = 0.7;

    engineGain = ctx.createGain();
    engineGain.gain.value = 0;

    engineSource.connect(engineLowpass);
    engineLowpass.connect(engineGain);
    engineGain.connect(master);

    rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = 'sine';
    rumbleOsc.frequency.value = ENGINE_RUMBLE_HZ;
    rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleOsc.connect(rumbleGain);
    rumbleGain.connect(master);

    const rattleBuf = makeWhiteNoiseBuffer(1.0);
    rattleSource = ctx.createBufferSource();
    rattleSource.buffer = rattleBuf;
    rattleSource.loop = true;
    const rattleBand = ctx.createBiquadFilter();
    rattleBand.type = 'bandpass';
    rattleBand.frequency.value = RATTLE_BAND_HZ;
    rattleBand.Q.value = 1.2;
    rattleGain = ctx.createGain();
    rattleGain.gain.value = 0;
    rattleSource.connect(rattleBand);
    rattleBand.connect(rattleGain);
    rattleGain.connect(master);
  }

  function startEngineNodes() {
    if (engineRunning) return;
    engineRunning = true;
    try { engineSource.start(); } catch (e) {}
    try { rumbleOsc.start(); } catch (e) {}
    try { rattleSource.start(); } catch (e) {}
  }

  function stopEngineNodes() {
    if (!engineRunning) return;
    engineRunning = false;
    try { engineSource.stop(); } catch (e) {}
    try { rumbleOsc.stop(); } catch (e) {}
    try { rattleSource.stop(); } catch (e) {}
    engineSource = null;
    rumbleOsc = null;
    rattleSource = null;
  }

  function setEngineLevel(throttle) {
    if (!ctx || !engineGain) return;
    const t = ctx.currentTime;
    const g = Math.max(0, Math.min(1, throttle));
    // Low, muffled, mechanical: keep levels modest.
    engineGain.gain.setTargetAtTime(g * 0.22, t, 0.08);
    if (rumbleGain) rumbleGain.gain.setTargetAtTime(g * 0.05, t, 0.08);
    if (rattleGain) rattleGain.gain.setTargetAtTime(g * 0.012, t, 0.08);
  }

  function engineThump() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + 0.2);
  }

  function engineStopDecay() {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (engineGain) engineGain.gain.setTargetAtTime(0, t, 0.12);
    if (rumbleGain) rumbleGain.gain.setTargetAtTime(0, t, 0.12);
    if (rattleGain) rattleGain.gain.setTargetAtTime(0, t, 0.12);
  }

  function rcsBurst() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + RCS_BURST_MS / 1000);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + RCS_BURST_MS / 1000 + 0.02);
  }

  function tone(freq, start, dur, gain, type) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g); g.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  function cautionChime() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(880, t, 0.25, 0.18);
    tone(660, t + 0.28, 0.3, 0.18);
  }

  function contactTone() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(1200, t, 0.15, 0.12);
  }

  function landedConfirm() {
    if (!ctx) return;
    const t = ctx.currentTime + 1.0;
    tone(523.25, t, 0.3, 0.14);
    tone(783.99, t + 0.32, 0.4, 0.14);
  }

  function crashSound() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Noise burst through falling low-pass.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2000, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + 1.05);
    // 40 Hz thud.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 40;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(og); og.connect(master);
    osc.start(t);
    osc.stop(t + 0.65);
  }

  function speak(text, safety) {
    if (!voiceOn || muted) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      if (safety) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = voiceRate;
      u.lang = 'en-US';
      u.volume = 0.85;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function resetCalloutState() {
    warned60 = false;
    warned30 = false;
    chime30Timer = 0;
    altCalloutTimer = 0;
    landedConfirmed = false;
    contactTonePlayed = false;
    engineStopCalloutPending = false;
    engineStopCalloutTimer = 0;
    rcsNextBurst = 0;
    rcsActive = false;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  }

  function altitudeCallout(state) {
    const alt = state.altitude;
    const vs = state.verticalSpeed;
    const hs = state.horizontalSpeed;
    const altWords = numToWords(roundAltitude(alt));
    const vertWords = numToWords(Math.abs(roundRate(vs)));
    let text = altWords + ' metres';
    if (Math.abs(vs) >= 0.5) {
      text += ', ' + (vs < 0 ? 'down ' : 'up ') + vertWords;
    }
    if (hs >= 0.5) {
      // Forward/back along heading: approximate with horizontal speed sign
      // relative to lander facing; use velocity projected on heading.
      let fwd = 0;
      if (state.quaternion && state.velocity) {
        // heading = local +Z rotated by quaternion
        const q = state.quaternion;
        // forward vector (0,0,1) rotated
        const fx = 2 * (q.x * q.z + q.w * q.y);
        const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
        fwd = state.velocity.x * fx + state.velocity.z * fz;
      }
      if (Math.abs(fwd) >= 0.5) {
        text += ', ' + (fwd > 0 ? 'forward ' : 'back ') + numToWords(Math.abs(roundRate(fwd)));
      }
    }
    speak(text, false);
  }

  function ensureContext() {
    if (!ctx) return false;
    return true;
  }

  return {
    unlock() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : masterVolume;
        master.connect(ctx.destination);
        noiseBuffer = makeNoiseBuffer(2.0);
        buildEngine();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch (e) {
        ctx = null;
      }
    },

    update(state) {
      if (!ctx || !state) return;
      const t = ctx.currentTime;

      // Engine gain follows throttle.
      if (state.throttle > 0) {
        if (!engineRunning) startEngineNodes();
        setEngineLevel(state.throttle);
      } else {
        if (engineRunning) setEngineLevel(0);
      }

      // RCS bursts while firing.
      if (state.rcsFiring) {
        rcsActive = true;
        if (rcsNextBurst <= t) {
          rcsBurst();
          rcsNextBurst = t + 1 / RCS_BURSTS_PER_SEC;
        }
      } else {
        rcsActive = false;
        rcsNextBurst = 0;
      }

      // Fuel warnings.
      const fs = state.fuelSecondsAtHover;
      if (state.phase === 'FLYING' && fs > 0) {
        if (!warned60 && fs <= FUEL_WARN_60) {
          warned60 = true;
          cautionChime();
          speak('Sixty seconds.', true);
        }
        if (!warned30 && fs <= FUEL_WARN_30) {
          warned30 = true;
          cautionChime();
          speak('Thirty seconds.', true);
          chime30Timer = t + 2;
        }
        if (warned30 && fs > 0 && chime30Timer > 0 && t >= chime30Timer) {
          cautionChime();
          chime30Timer = t + 2;
        }
      }

      // Altitude and rate callouts.
      if (state.phase === 'FLYING' && state.altitude < ALT_CALLOUT_MAX) {
        if (altCalloutTimer === 0) altCalloutTimer = t + 0.5;
        if (t >= altCalloutTimer) {
          altitudeCallout(state);
          altCalloutTimer = t + ALT_CALLOUT_MIN_INTERVAL +
            Math.random() * (ALT_CALLOUT_MAX_INTERVAL - ALT_CALLOUT_MIN_INTERVAL);
        }
      } else {
        altCalloutTimer = 0;
      }

      // Contact light tone.
      if (state.contactLight && !contactTonePlayed) {
        contactTonePlayed = true;
        contactTone();
      }

      // Engine stop callout after landing.
      if (engineStopCalloutPending && t >= engineStopCalloutTimer) {
        engineStopCalloutPending = false;
        speak('Engine stop.', true);
      }
    },

    event(name, data) {
      if (!ctx) return;
      switch (name) {
        case 'start':
          resetCalloutState();
          engineThump();
          break;
        case 'contact':
          if (!contactTonePlayed) {
            contactTonePlayed = true;
            contactTone();
          }
          speak('Contact light.', true);
          break;
        case 'landed':
          if (!landedConfirmed) {
            landedConfirmed = true;
            landedConfirm();
            engineStopCalloutPending = true;
            engineStopCalloutTimer = ctx.currentTime + 1.2;
          }
          break;
        case 'crash':
          crashSound();
          break;
        case 'restart':
          resetCalloutState();
          if (engineGain) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          if (rumbleGain) rumbleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          if (rattleGain) rattleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          break;
        case 'fuelOut':
          // Fuel out: stop repeating chime.
          warned30 = false;
          chime30Timer = 0;
          break;
        case 'engineOn':
          engineThump();
          break;
        case 'engineOff':
          engineStopDecay();
          break;
      }
    },

    toggleMute() {
      muted = !muted;
      if (master && ctx) {
        master.gain.setTargetAtTime(muted ? 0 : masterVolume, ctx.currentTime, 0.05);
      }
      return muted;
    },

    toggleVoice() {
      voiceOn = !voiceOn;
      if (!voiceOn && typeof window !== 'undefined' && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
      return voiceOn;
    },

    isMuted() {
      return muted;
    },

    dispose() {
      resetCalloutState();
      if (engineRunning) stopEngineNodes();
      if (ctx) {
        try { ctx.close(); } catch (e) {}
      }
      ctx = null;
      master = null;
      engineGain = null;
      rumbleGain = null;
      rattleGain = null;
      noiseBuffer = null;
    }
  };
}
