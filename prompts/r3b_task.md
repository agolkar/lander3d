You are a senior real-time graphics engineer who ships browser games with three.js.

# Task

A photorealistic lunar landing game runs in the browser with three.js r187 (`WebGLRenderer`, WebGL 2, ES modules through an import map: `three` and `three/addons/`, no build step). Its effects module `game/src/effects.js` is a stub. Replace it with the full implementation: post-processing, engine plume, reaction control system (RCS) puffs, the regolith dust sheet, touchdown and crash effects. Change no other file.

The current `main.js` and `config.js` follow below. They are the truth: use the frame state fields exactly as `main.js` builds them and the settings exactly as `config.js` names them. Where they differ from the contract, follow the code. If a setting you need is missing from `config.js`, use a constant at the top of `effects.js` instead of changing `config.js`.

# Verified r187 APIs (use these exactly; do not rely on memory)

- `import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'`: `new EffectComposer(renderer)` creates half-float render targets by itself. Methods: `addPass(pass)`, `render(deltaTime)`, `setSize(width, height)`, `setPixelRatio(ratio)`, `dispose()`.
- `RenderPass` (`.../postprocessing/RenderPass.js`): `new RenderPass(scene, camera)`; public property `camera`.
- `GTAOPass` (`.../postprocessing/GTAOPass.js`): `new GTAOPass(scene, camera, width, height)`; properties `camera`, `blendIntensity` (default 1), `output`; methods `updateGtaoMaterial({ radius: ... })` (default radius 0.25), `setSize(w, h)`.
- `UnrealBloomPass` (`.../postprocessing/UnrealBloomPass.js`): `new UnrealBloomPass(new THREE.Vector2(w, h), strength, radius, threshold)`; properties `strength`, `radius`, `threshold`.
- `OutputPass` (`.../postprocessing/OutputPass.js`): `new OutputPass()`; applies the renderer's tone mapping (AgX here) and the sRGB conversion. Bloom runs before it on linear values.
- `SMAAPass` (`.../postprocessing/SMAAPass.js`): `new SMAAPass()` with no arguments in r187; size comes from `setSize`.
- The cascaded shadow map object keeps its lights in the array `csm.lights`; there is no `csm.light`.

# Effects

Post-processing
- Pass order: `RenderPass`, `GTAOPass` (when enabled; `blendIntensity` 0.6, `updateGtaoMaterial({ radius: 0.6 })`), `UnrealBloomPass`, `OutputPass`, `SMAAPass` (when enabled). Bloom strength, radius and threshold from config when present, else 0.35, 0.4, 1.0.
- `setCamera(camera)` sets `camera` on the render pass and the GTAO pass. `resize(w, h)` calls `composer.setSize(w, h)`.
- `render()` calls `composer.render(dt)`. If building the composer throws, log a warning and fall back to `renderer.render(scene, camera)`, so the game never stops on an effects error.

Engine plume
- The descent engine burns hypergolic propellants, so its plume in vacuum is almost invisible. A faint additive cone from the nozzle exit along the exhaust direction: length 2 to 6 m with throttle; `ShaderMaterial` with soft radial falloff and a slight flicker; opacity about 0.12 x throttle; warm white at the exit fading to transparent; `depthWrite: false`, `transparent: true`, `blending: THREE.AdditiveBlending`.
- A warm `PointLight` 2 m below the nozzle, intensity proportional to throttle, distance 40 m, no shadows.

RCS puffs
- While the RCS fires, short white puffs (sprites, 80 ms life, expanding and fading) at the RCS quad positions.

Dust sheet
- Active while the engine is on and the ground below the nozzle is within 35 m. Emission rate proportional to throttle x (1 - distance / 35)^2.
- Particles start at the ground point under the nozzle within a few metres, fly outward along the ground plane at 20 to 60 m/s with 0 to 3 m/s upward, under lunar gravity 1.62 m/s^2 and no air drag. A particle dies below `ctx.getHeight(x, z)` or beyond 300 m.
- A ring buffer of 20,000 particles in typed arrays; `THREE.Points` with a `ShaderMaterial`: round soft sprites with size attenuation, regolith grey, normal alpha blending, `depthWrite: false`. Thin, fast, flat and see-through, as in the Apollo landing films.
- A flat ring mesh just above the ground under the nozzle with a radially scrolling noise texture drawn on a canvas, fading in with the emission.

Touchdown and crash
- `event('landed')`: one radial dust puff from under the lander, then no new emission.
- `event('crash', { position, velocity })`: about 60 debris fragments (small boxes and plates in gold, silver and charcoal `MeshStandardMaterial`), launched with the impact velocity plus random spread, ballistic, one damped bounce on the terrain, then at rest; a `PointLight` flash decaying in 0.4 s; a dust burst.
- `event('start')` and `event('restart')`: remove every particle, fragment and light added by this module.

# Rules

- Export exactly what `main.js` imports from `effects.js`, with the same names and arguments.
- No new vectors per particle per frame: reuse buffers.
- Keep your reasoning short and concrete. Read how `main.js` calls the effects module, plan the module in a few lines, then write the complete file once.

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
