You are a senior real-time graphics and game audio engineer who ships browser games with three.js and the Web Audio API.

# Task

A photorealistic lunar landing game already runs in the browser with three.js r187. Its effects and audio modules are stubs. Replace them with full implementations: `game/src/effects.js` (post-processing, engine plume, reaction control system (RCS) puffs, the regolith dust sheet, touchdown and crash effects) and `game/src/audio.js` (synthesised engine and thruster sounds, alarms and Apollo-style voice callouts). Change no other file: both modules must work through the contract below, unchanged.

## Output format

Return the two files in exactly this format, with nothing after them:

### FILE: game/src/effects.js
```js
(complete file)
```

### FILE: game/src/audio.js
```js
(complete file)
```

Write each file completely. Never abbreviate with placeholders such as "rest unchanged" or "...". Keep your reasoning short: plan in a few lines, then write the code once, directly in the answer.

## Platform

- ES modules, no build step, imports through this import map: `"three"` and `"three/addons/"` (three.js r187, `WebGLRenderer`, WebGL 2). No other libraries and no asset files: everything is generated in code.
- Post-processing addons: `three/addons/postprocessing/EffectComposer.js`, `RenderPass.js`, `GTAOPass.js`, `UnrealBloomPass.js`, `OutputPass.js`, `SMAAPass.js`. `OutputPass` applies the renderer's tone mapping (AgX) and sRGB conversion, so bloom works on linear high dynamic range values before it.
- The scene uses cascaded shadow maps (CSM). Any new material that should receive shadows needs no special handling here: the effects in this stage are additive or unlit, so they neither cast nor receive shadows.
- Units are metres and seconds; lunar gravity 1.62 m/s^2; there is no atmosphere, so particles fly on ballistic paths with no drag and no buoyancy.

## Module contract (fixed: other stages depend on it, so follow it exactly)

### Lander model: `game/assets/models/lander.glb`

- glTF, Y up, metres. The lander faces +Z (front: ladder, hatch, windows); its left side is +X. Origin: on the vertical axis, at the footpad bottoms (footpad bottoms at y = 0 in model space).
- Object3D names after loading with GLTFLoader:
  - `Lander` (root), `DescentStage`, `AscentStage`, `EngineBell`, `Leg_Front`, `Leg_Back`, `Leg_Left`, `Leg_Right`.
  - `FootpadContact_Front`, `FootpadContact_Back`, `FootpadContact_Left`, `FootpadContact_Right`: bottom centre of each footpad.
  - `ProbeTip_Back`, `ProbeTip_Left`, `ProbeTip_Right`: tips of the contact probes, about 1.5 m below the footpads.
  - `NozzleExit`: centre of the engine exit plane, about 1.05 m above the footpads; exhaust flows along the lander's local -Y.
  - `CockpitEye`: the commander's eye point.
  - `RCS_Quad_1` to `RCS_Quad_4`: reaction control system (RCS) thruster clusters.
- The file may be missing. The game then builds a simple procedural stand-in with the same names and logs a warning.

### Frame state

`main.js` builds one state object per rendered frame and passes it to `effects.update(state)` and `audio.update(state)`. Vectors are reused between frames: a consumer that keeps one must copy it.

```js
{
  phase,              // 'READY' | 'FLYING' | 'LANDED' | 'CRASHED' | 'PAUSED'
  time,               // mission elapsed time, s
  dt,                 // frame time, s
  position,           // THREE.Vector3, lander origin in world space
  quaternion,         // THREE.Quaternion
  velocity,           // THREE.Vector3, m/s
  verticalSpeed,      // m/s, positive up
  horizontalSpeed,    // m/s
  altitude,           // m, lowest footpad to the terrain below it
  throttle,           // 0 when the engine is off, else 0.10 to 1.00
  thrustNewtons,      // current engine thrust, N
  fuelKg, fuelFraction, fuelSecondsAtHover,
  rcsCommand,         // { pitch, roll, yaw }, each -1, 0 or 1
  rcsFiring,          // boolean, true while any RCS axis is accelerating
  nozzleExit,         // THREE.Vector3, world
  exhaustDir,         // THREE.Vector3, world unit vector of the exhaust flow
  groundBelowNozzle,  // { point: Vector3, normal: Vector3, distance } along exhaustDir, or null beyond 120 m
  rcsQuads,           // array of 4 THREE.Vector3, world
  contactLight,       // boolean, true once a probe has touched the surface
  rangeToTarget,      // m, horizontal distance to the landing target
  cameraMode          // 'chase' | 'cockpit' | 'tower' | 'orbit'
}
```

### Effects module: `game/src/effects.js`

```js
export function createEffects(renderer, scene, camera, ctx)
// ctx = { getHeight(x, z), getNormal(x, z, target), config, landerRoot }
// returns:
{
  setCamera(camera),        // active camera changed
  resize(width, height),
  update(state),            // once per rendered frame, before render()
  render(),                 // draws the frame
  event(name, data),        // 'start' | 'contact' | 'landed' | 'crash' (data: { position, velocity }) | 'restart'
  dispose()
}
```

`main.js` hides the lander itself on a crash; the effects module only adds visuals.

### Audio module: `game/src/audio.js`

```js
export function createAudio(config)
// returns:
{
  unlock(),           // called on the first keydown or pointerdown (browser autoplay policy)
  update(state),      // once per rendered frame
  event(name, data),  // 'start' | 'contact' | 'landed' | 'crash' | 'restart' | 'fuelOut' | 'engineOn' | 'engineOff'
  toggleMute(), toggleVoice(), isMuted(),
  dispose()
}
```

### Configuration blocks that `config.js` must export (inside `CONFIG`) with these defaults

```js
EFFECTS: { bloomStrength: 0.35, bloomRadius: 0.4, bloomThreshold: 1.0, gtao: true, smaa: true,
           dustMaxParticles: 20000, dustStartAltitude: 35, plumeOpacity: 0.12 },
AUDIO:   { masterVolume: 0.6, voice: true, voiceRate: 1.05 },
```

## Effects (`effects.js`)

Post-processing
- `EffectComposer` with a half-float render target: `RenderPass`, then `GTAOPass` (if `config.EFFECTS.gtao`; subtle, blend intensity 0.6, radius suited to metre-scale detail), then `UnrealBloomPass` (strength, radius and threshold from `config.EFFECTS`), then `OutputPass`, then `SMAAPass` (if `config.EFFECTS.smaa`).
- `setCamera(camera)` updates every pass that holds a camera (render pass, GTAO). `resize` updates the composer and every pass.

Engine plume
- The descent engine burns hypergolic propellants, so its plume in vacuum is almost invisible. Draw a faint additive cone from `state.nozzleExit` along `state.exhaustDir`: length 2 to 6 m with throttle, a custom `ShaderMaterial` with soft radial falloff, slight flicker and opacity `config.EFFECTS.plumeOpacity x throttle`, warm white at the exit fading to transparent. `depthWrite: false`.
- A warm `PointLight` 2 m below the nozzle, intensity proportional to throttle, distance 40 m, so the ground brightens slightly under the engine at low altitude. No shadows on this light.

RCS puffs
- While `state.rcsFiring`, emit brief white puffs (sprites, 80 ms life, expanding and fading) at the `state.rcsQuads` positions, a few per quad per firing pulse.

Dust sheet (the signature effect of a lunar landing)
- Active when the engine is on and `state.groundBelowNozzle` is within `config.EFFECTS.dustStartAltitude`. Emission rate proportional to throttle x (1 - distance / dustStartAltitude)^2.
- Particles start at the ground point under the nozzle within a radius of a few metres and fly outward along the ground tangent plane at 20 to 60 m/s, with 0 to 3 m/s upward. Ballistic motion under lunar gravity; a particle dies when it falls below `ctx.getHeight(x, z)` or travels beyond 300 m. Ring buffer of `config.EFFECTS.dustMaxParticles`.
- Render as `THREE.Points` with a `ShaderMaterial`: round soft sprites with size attenuation, regolith grey, lit by the sun intensity (a constant brightness is fine), normal alpha blending, `depthWrite: false`. The overall look is a thin, fast, flat sheet streaming radially outward, transparent enough to see the ground through it, as in the Apollo landing films.
- Add a flat ring mesh just above the ground under the nozzle with a radially scrolling noise texture made in a canvas, which reads as the dense sheet near the ground; it fades in with the dust emission.

Touchdown and crash
- `event('landed')`: one radial dust puff from the footpads, then the dust settles within a few seconds (no new emission).
- `event('crash', { position, velocity })`: about 60 debris fragments (small boxes and plates in gold, silver and charcoal `MeshStandardMaterial`), launched from the position with the impact velocity plus random spread, ballistic, bouncing once on the terrain with damping, then resting; a bright flash (`PointLight`, decaying in 0.4 s); a dust burst.
- `event('restart')` and `event('start')` clear every particle, fragment and light.

## Audio (`audio.js`)

General
- One `AudioContext`, created in `unlock()` and resumed if suspended. Master gain from `config.AUDIO.masterVolume`; `toggleMute()` sets it to 0 and back. All sound is synthesised; change gains with `setTargetAtTime` to avoid clicks.
- In vacuum the crew hears the vehicle only through its structure: keep sounds low, muffled and mechanical.

Sounds
- Engine: brown noise through a low-pass filter around 180 Hz, plus a quiet 55 Hz sine rumble and faint band-passed noise around 900 Hz for structural rattle. Gain follows throttle. `engineOn` gives a short ignition thump; `engineOff` a short decay.
- RCS: while `state.rcsFiring`, short sharp thumps (filtered noise bursts, 25 ms) at about 8 per second, the sound the Apollo crews reported from the thrusters.
- Low fuel: at 60 s of fuel at hover, a two-tone caution chime once; at 30 s a repeating chime every 2 s until landing or fuel out.
- Contact: a short soft high tone.
- Landed: a gentle two-note confirmation after one second. Crash: a noise burst through a falling low-pass filter plus a 40 Hz thud.

Voice callouts (`speechSynthesis`, English voice, rate `config.AUDIO.voiceRate`, only when `config.AUDIO.voice` is on and not muted; `toggleVoice()` flips it)
- Fuel: "Sixty seconds." and "Thirty seconds." at those thresholds.
- Altitude and rate: below 150 m altitude, every 4 to 5 s, a callout in metres and metres per second, such as "Ninety metres, down three." or "Forty metres, down two, forward one." (forward or back from the horizontal velocity in the lander's heading frame, omitted under 0.5 m/s). Round altitude to 5 m above 50 m and to 1 m below.
- "Contact light." on `contact`; "Engine stop." just after `landed`.
- Speak at most one utterance at a time: cancel the queue before a new safety callout; never let callouts pile up.
- Use spoken numbers through `toLocaleString` or a small number-to-words helper, so the voice says "ninety" correctly.

`dispose()` stops every node and closes the context. `update(state)` must be cheap: no node creation per frame except for short scheduled one-shots.

## Self-check before you answer

- Both modules export exactly `createEffects` and `createAudio` with the interfaces in the contract, and use only the frame state fields listed there.
- Every import resolves through the import map with the r187 addon paths above.
- No allocation of new vectors per particle per frame: reuse buffers and typed arrays.
- The game still works with effects disabled in config and with audio muted or locked.
- Restart leaves no particles, fragments, lights or sounds behind.
