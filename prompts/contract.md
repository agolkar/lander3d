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
