You are a senior game audio engineer who ships browser games with the Web Audio API.

# Task

A photorealistic lunar landing game runs in the browser (three.js r187, ES modules, no build step). Its audio module `game/src/audio.js` is a stub. Replace it with the full implementation: synthesised engine and thruster sounds, cautions and Apollo-style voice callouts. Change no other file. No audio files: everything is generated in code.

The current `main.js` and `config.js` follow below. They are the truth: use the frame state fields exactly as `main.js` builds them, the events exactly as `main.js` sends them, and the settings exactly as `config.js` names them. If a setting you need is missing, use a constant at the top of `audio.js`.

# Audio

General
- One `AudioContext`, created in `unlock()` (called on the first keypress or click) and resumed if suspended. Until then every method is a safe no-op.
- A master gain (0.6 unless config says otherwise); `toggleMute()` sets it to 0 and back. Change gains with `setTargetAtTime` to avoid clicks.
- In vacuum the crew hears the vehicle only through its structure: keep sounds low, muffled and mechanical.

Sounds
- Engine: brown noise (a looped noise buffer through a low-pass filter around 180 Hz) plus a quiet 55 Hz sine rumble and faint band-passed noise around 900 Hz for structural rattle. Gain follows throttle. Engine start: a short thump; engine stop: a short decay.
- RCS thrusters: while they fire, short sharp thumps (25 ms filtered noise bursts) about 8 per second, the sound the Apollo crews reported.
- Low fuel: at 60 s of fuel at hover, a two-tone caution chime once; at 30 s a repeating chime every 2 s until landing or fuel out.
- Contact: a short soft high tone. Landed: a gentle two-note confirmation after one second. Crash: a noise burst through a falling low-pass filter plus a 40 Hz thud.

Voice callouts (`speechSynthesis`, an English voice, rate 1.05; only when voice is on and audio is not muted; `toggleVoice()` flips voice)
- Fuel: "Sixty seconds." and "Thirty seconds." at those thresholds.
- Altitude and rate: below 150 m altitude, every 4 to 5 s, for example "Ninety metres, down three." or "Forty metres, down two, forward one." Forward or back comes from the horizontal velocity along the lander's heading and is omitted under 0.5 m/s. Round altitude to 5 m above 50 m and to 1 m below; round rates to whole numbers.
- "Contact light." on contact; "Engine stop." just after landing.
- One utterance at a time: cancel the queue before a new safety callout, so callouts never pile up.
- Write numbers as words with a small helper (up to a few hundred), so the voice says "ninety".

Housekeeping
- `update(state)` must be cheap: no node creation per frame except short scheduled one-shots.
- Restart stops every sound and resets the callout and chime state. `dispose()` closes the context.

# Rules

- Export exactly what `main.js` imports from `audio.js`, with the same names and arguments.
- Keep your reasoning short and concrete. Read how `main.js` calls the audio module, plan the module in a few lines, then write the complete file once.
