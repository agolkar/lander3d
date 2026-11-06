You are a senior real-time graphics engineer who ships browser games with three.js. You write clean, modular, well-commented ES module JavaScript.

# Task

Build the playable core of a photorealistic 3D lunar landing game in the browser: terrain, lighting, the lunar module (LM), flight physics, cameras, controls and heads-up display (HUD). Post-processing, particle effects and sound come in a later stage through two modules whose interface is fixed below; in this stage you write simple stubs for them.

## Output format

Return every file in exactly this format, one after the other, with nothing between or after them except the next file:

### FILE: game/index.html
```html
(complete file)
```

### FILE: game/src/main.js
```js
(complete file)
```

Write each file completely. Never abbreviate with placeholders such as "rest unchanged" or "...". Keep your reasoning short: plan the modules in a few lines, then write the code once, directly in the answer.

Files to write: `game/index.html`, `game/src/config.js`, `game/src/main.js`, `game/src/assets.js`, `game/src/terrain.js`, `game/src/rocks.js`, `game/src/sky.js`, `game/src/lander.js`, `game/src/input.js`, `game/src/cameras.js`, `game/src/hud.js`, `game/src/effects.js` (stub), `game/src/audio.js` (stub).

## Platform and constraints

- No build step. Plain ES modules served by `python3 -m http.server` from the `game/` folder; the player opens `http://<host>:8765/` in a current Chrome or Safari on a Mac.
- three.js r187 is vendored and pinned. `index.html` declares this import map, and every module imports through it:

```html
<script type="importmap">
{ "imports": {
    "three": "./vendor/three/build/three.module.js",
    "three/addons/": "./vendor/three/examples/jsm/"
} }
</script>
```

- Relative imports use `./name.js` with the extension. No other libraries, no CDN, no fonts from the network.
- Use `THREE.WebGLRenderer` (WebGL 2). Rules for r187:
  - Timing: `const timer = new THREE.Timer(); timer.connect(document);` then in the loop `timer.update(timestamp); const dt = timer.getDelta();`. `THREE.Clock` is deprecated.
  - Colour: `renderer.outputColorSpace = THREE.SRGBColorSpace`; albedo textures get `texture.colorSpace = THREE.SRGBColorSpace`; normal and roughness maps stay linear. Never use `encoding`, `outputEncoding` or `physicallyCorrectLights`.
  - Tone mapping: `renderer.toneMapping = THREE.AgXToneMapping`, `renderer.toneMappingExposure = CONFIG.EXPOSURE`.
  - Addon paths: `three/addons/loaders/GLTFLoader.js`, `three/addons/loaders/EXRLoader.js`, `three/addons/controls/OrbitControls.js`, `three/addons/csm/CSM.js`.
  - Cascaded shadow maps (CSM): `new CSM({ maxFar, cascades, mode: 'practical', parent: scene, shadowMapSize, lightDirection, lightIntensity, camera })`; call `csm.setupMaterial(material)` for every material that receives shadows; call `csm.update()` every frame; on camera change set `csm.camera = camera` and call `csm.updateFrustums()`; call `csm.updateFrustums()` on resize.
- Use `THREE.LoadingManager` with a progress bar on a loading screen.
- A global error overlay: listen to `error` and `unhandledrejection` and show the message and stack in a fixed panel, so errors are easy to copy. Wrap the per-frame update in try/catch that reports to the same panel once and keeps the loop alive.
- Performance target: 60 frames per second at 1440p on Apple Silicon. Pixel ratio `Math.min(devicePixelRatio, CONFIG.MAX_PIXEL_RATIO)`.

## Assets on disk (paths relative to `game/`)

- `assets/models/lander.glb`: the lander (see contract). May be missing.
- `assets/textures/regolith_a_diff.jpg`, `_nor_gl.jpg`, `_rough.jpg`, `_disp.jpg`: CC0 scanned regolith (Poly Haven "moon_dusted_01"); one texture tile covers about 3.2 m.
- `assets/textures/regolith_b_diff.jpg`, `_nor_gl.jpg`, `_rough.jpg`, `_disp.jpg`: CC0 regolith with small craters (Poly Haven "moon_meteor_01"), same scale.
- `assets/rocks/manifest.json`: `{ "rocks": ["rocks/moon_rock_01/moon_rock_01_1k.gltf", ...] }`, paths relative to `assets/`. Scanned CC0 boulders, real-world size of the scan about 0.1 to 0.5 m.
- `assets/sky/earth_bluemarble.jpg`: NASA Blue Marble, equirectangular, 5400 x 2700.
- `assets/sky/starmap_4k.exr`: NASA star map, equirectangular, linear.

Any asset may be missing: catch the failure, log a warning and use a procedural fallback (flat grey regolith material, icosahedron rocks displaced with noise, a plain blue sphere for Earth, no stars, a stand-in lander).

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

### Stubs for this stage

- `effects.js`: implements the full interface; `render()` calls `renderer.render(scene, camera)`, everything else does nothing.
- `audio.js`: implements the full interface with no-ops; `isMuted()` returns false.

## World

Units are metres and seconds. World axes: +Y up. The landing target is at the origin of the terrain, on the flattened landing site. The lander approaches from -Z, flying toward +Z.

### Terrain (`terrain.js`)

- Near terrain: square heightfield, `CONFIG.TERRAIN_SIZE` = 2048 m, `CONFIG.TERRAIN_SEGMENTS` = 1024 (512 on the medium quality preset), centred on the target. Store the heights in a `Float32Array` and export `getHeight(x, z)` (bilinear) and `getNormal(x, z, target)` for physics, rocks and effects.
- Height composition, with a seeded random generator (mulberry32, `CONFIG.SEED`):
  1. Rolling base: fractional Brownian motion (fBm) noise, amplitude 6 m, base wavelength 300 m.
  2. Craters: `CONFIG.CRATER_COUNT` = 1400, diameters from `CRATER_MIN_D` = 3 m to `CRATER_MAX_D` = 260 m with a power-law distribution (many small, few large). Profile with normalised radius r = distance / radius: inside, `h = -depth + (depth + rim) * r^2`; outside, `h = rim * r^-3`, cut off at r = 3. Depth = D x (0.08 to 0.2, random: lower for older craters), rim = 0.25 x depth. Rasterise each crater only over its bounding square, so generation stays fast.
  3. Fine fBm, amplitude 0.25 m, wavelength 8 m.
  4. Landing site: flatten to the local mean height inside `SITE_FLAT_RADIUS` = 25 m, blending with smoothstep out to `SITE_BLEND_RADIUS` = 70 m. Skip craters whose rim would reach inside 30 m of the target.
  5. In the outer 150 m of the square, blend the height toward the far-terrain function so the seam disappears.
- Far terrain: a polar ring mesh from 950 m to `CONFIG.FAR_RADIUS` = 20,000 m (64 radial x 256 angular segments, radial spacing growing geometrically), heights from the low-frequency part of the same functions plus the Moon's curvature drop `y -= d^2 / (2 x 1,737,400)`. Same material at a larger texture scale. No collision.
- Material: `MeshStandardMaterial` with regolith A maps repeating every 3.2 m. Break the tiling in `onBeforeCompile`: sample regolith B at a different scale (7.3 m, rotated 37 degrees) and blend it in with a low-frequency noise mask; multiply albedo by a vertex colour attribute that adds macro variation (slightly brighter ejecta around the youngest craters, darker patches). Tint albedo by `CONFIG.REGOLITH_TINT` so sunlit regolith reads as a dark grey with albedo near 0.12. If the shader patch fails, fall back to the plain textured material. Terrain receives shadows; it also casts them, which gives crater self-shadowing under the low sun.

### Rocks (`rocks.js`)

- Load the glTF rocks listed in the manifest. For each rock type, one `THREE.InstancedMesh` with its geometry and material.
- Scatter with the seeded generator: about 2,500 instances within 500 m of the target, density falling with distance; sizes 0.15 m to 3 m on a power law (most small), random rotation, buried 20 to 35 % of their height. A few larger boulders (up to 5 m) around fresh crater rims. Keep rocks larger than 0.3 m out of the 30 m circle around the target.
- Keep a list of collision spheres (centre, radius) for rocks larger than 0.4 m, with a spatial grid for fast lookup. Export `rockCollision(point)` that returns the rock hit or null.
- Rocks cast and receive shadows.

### Sky and lighting (`sky.js`)

- Black sky. Stars: the star map as `scene.background` with `scene.backgroundIntensity = CONFIG.STAR_INTENSITY`, default 0, because a camera exposed for the sunlit surface records a black sky, as in Apollo photography. Key T toggles stars at intensity 0.6.
- Sun: CSM directional light, elevation `CONFIG.SUN_ELEVATION_DEG` = 12 degrees, from behind the approaching lander (from the -Z side, `CONFIG.SUN_AZIMUTH_DEG` = 20 degrees off the -Z axis), intensity `CONFIG.SUN_INTENSITY` = 6. CSM: 4 cascades, `maxFar` 1500 m, shadow map 2048 (4096 on high quality), `lightMargin` 300.
- Earthshine: `THREE.HemisphereLight` with intensity 0.02, faint blue from above, nothing else ambient.
- Environment map for the metallic foils: render a small procedural environment with `PMREMGenerator.fromScene`: a large sphere, black above the horizon, regolith grey 0.1 below it, and a small very bright disc in the sun direction. Assign it to `scene.environment`. Without this, the gold foil reads as flat plastic.
- Earth: a sphere with the Blue Marble map, angular diameter 1.9 degrees (radius 249 m at a distance of 15,000 m), placed at elevation 35 degrees ahead of the approaching lander and to the left, so it appears in the chase and cockpit views. Lit by the sun light, which gives the correct phase. Add a thin additive Fresnel shell, faint blue, for the atmosphere. No shadows on the Earth.
- Camera near plane 0.5 m (0.15 m in cockpit view), far plane 40,000 m.

## Lander and flight (`lander.js`, `input.js`)

- Load the GLB; enable shadows on its meshes; call `csm.setupMaterial` on its materials. Read the contract nodes once after loading and store their positions relative to the root, since they never move.
- Rigid-body state: position, velocity, quaternion, body angular velocity, mass = `DRY_MASS` + fuel.
- Constants in `CONFIG`: `GRAVITY` 1.62, `DRY_MASS` 6800 kg, `FUEL_START` 520 kg, `MAX_THRUST` 45040 N, `MIN_THROTTLE` 0.10, `THROTTLE_RATE` 0.5 per second, `ISP` 305 s, `G0` 9.80665, `RCS_MAX_RATE_DEG` 10, `RCS_ACCEL_DEG` 15, `RCS_FUEL_START` 60 kg, `RCS_FLOW` 0.15 kg/s per accelerating axis.
- Main engine: thrust along the lander's local +Y through the centre of mass (no torque). Mass flow = thrust / (ISP x G0). Out of fuel: the engine stops and cannot restart.
- Controls:
  - Up arrow: raise throttle (from 0 it ignites at `MIN_THROTTLE`). Down arrow: lower throttle (below `MIN_THROTTLE` the engine shuts down). X: immediate engine cut-off.
  - W and S: pitch, so that W tilts the top of the lander toward its front and S tilts it back. A and D: roll toward the lander's left and right. Q and E: yaw left and right.
  - Attitude control is rate command with attitude hold, like the real LM digital autopilot: each held key commands `RCS_MAX_RATE_DEG` about its body axis; the body rate moves toward the commanded rate at `RCS_ACCEL_DEG` per second squared; with no key held the commanded rate is zero, so the lander holds its attitude. RCS fuel is consumed while an axis accelerates; with no RCS fuel there is no attitude control.
  - Space: start the descent from READY. P: pause. R: restart with the same terrain; Shift+R: new terrain seed. C: cycle camera. H: help overlay. T: stars. M: mute. V: voice callouts. F: frames-per-second counter. [ and ]: exposure minus or plus 0.1, shown briefly on the HUD.
- Integration: fixed step of 1/120 s with an accumulator; semi-implicit Euler; quaternion integration with normalisation each step.
- Start state (READY, frozen until Space): position (0, 450, -700) relative to the target, velocity (0, -10, 18) m/s, attitude tilted 35 degrees back (top toward -Z), so thrust brakes the forward velocity; throttle 0.
- Contact and landing, evaluated every physics step:
  - Probe tips below the terrain: set `contactLight`, fire the `contact` event once. Probes have no other physical effect.
  - Hull check points (nozzle exit, the four lower corners of the descent stage): below the terrain before the footpads, or inside a rock sphere: crash, reason "Hull struck the surface".
  - First footpad below the terrain or inside a rock sphere: evaluate the touchdown. Success needs descent rate at most `LIMIT_VERTICAL` 2.5 m/s, horizontal speed at most `LIMIT_HORIZONTAL` 1.2 m/s, tilt (angle between the lander up axis and world up) at most `LIMIT_TILT_DEG` 10, and no footpad on a rock larger than 0.5 m. Otherwise crash with the first failing reason: "Descent rate too high", "Horizontal speed too high", "Tilt too high", "Landed on a boulder".
  - Success: phase LANDED, engine off, snap the lander so its lowest footpad rests on the terrain, zero the velocities. Fire `landed`.
  - Crash: phase CRASHED, engine off, hide the lander root, fire `crash` with position and velocity.
- Result card: on LANDED show touchdown descent rate, horizontal speed, tilt, distance from the target, fuel left in seconds at hover, and a rating ("On target" within `TARGET_RADIUS` 30 m, otherwise "Safe landing, off target"). On CRASHED show the reason and the touchdown values. Both say "R to try again".

## Cameras (`cameras.js`)

- Chase (default): behind and above the lander along its heading (yaw only), offset (0, 6, -22) m in the heading frame, smoothed with exponential damping, looking at a point 2 m above the lander origin. Never below the terrain plus 2 m.
- Cockpit: at the `CockpitEye` node, oriented with the lander and pitched 25 degrees down, field of view 55 degrees.
- Tower: a fixed ground camera 45 m from the target, 3 m above the ground, field of view 25 degrees, tracking the lander like a broadcast camera.
- Orbit: `OrbitControls` around the lander, target following it.
- C cycles chase, cockpit, tower, orbit. Tell the effects module about every camera change through `setCamera`.

## Heads-up display (`hud.js`)

DOM overlay, styled in `index.html`. Typography: system monospace (`ui-monospace, "SF Mono", Menlo, monospace`), weights 300 to 400, tabular numerals, values larger than their labels. Labels in plain short words in normal case. Pale grey text on a translucent dark panel with thin borders, amber for warnings, red for limits exceeded. No decorative headings.

- Left panel: altitude, vertical speed (signed), horizontal speed, range to target, throttle (bar and %), fuel (kg and seconds at hover), RCS fuel (%), pitch and roll (degrees), mission time.
- Each speed and tilt value turns red when above its landing limit; fuel seconds turn amber at 60 s and blink red at 30 s.
- Contact light: a small blue lamp labelled "Contact" that lights with `contactLight`.
- Target marker: project the target to the screen and draw a diamond; when it is off screen or behind the camera, an arrow at the screen edge. Drift marker: a small cross at the predicted ground point in 4 s from the current velocity.
- Centre messages for READY ("Space to begin powered descent"), PAUSED and the result card.
- Help overlay (H) with all controls. Optional frames-per-second counter (F).

## Main loop (`main.js`)

- Load assets, build the world, create effects and audio through the contract, start the loop.
- Each frame: input, fixed-step physics while FLYING, cameras, `csm.update()`, HUD, build the frame state, `effects.update(state)`, `audio.update(state)`, `effects.render()`.
- Call `audio.unlock()` on the first keydown or pointerdown. Fire `start`, `restart`, `engineOn`, `engineOff`, `fuelOut` events to both modules where they apply.
- `CONFIG.QUALITY`: "high" (default) or "medium"; it sets terrain segments, shadow map size and maximum pixel ratio (2 or 1.5).
- Handle resize: renderer, cameras, CSM, effects.

## Self-check before you answer

- Every import resolves through the import map or a `./*.js` path, and every imported name is exported by its module.
- No deprecated APIs (`Clock`, `encoding`, `outputEncoding`, `physicallyCorrectLights`, `Geometry`).
- The game starts and is playable when `lander.glb`, the rocks, the textures or the sky files are missing.
- The contract names, the frame state fields and both module interfaces match the contract exactly.
- Physics signs: W tips the top forward, so thrust gains a +Z component when facing +Z; the start attitude brakes the +Z velocity.
- Restart fully resets lander, fuel, contact light, cameras and modules.
