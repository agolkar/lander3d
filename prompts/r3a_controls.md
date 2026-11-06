You are a senior three.js engineer maintaining a browser lunar landing game: three.js r187, ES modules through an import map (`three`, `three/addons/`), no build step. The game runs; this round changes only how the player controls the camera and the throttle with a mouse or a Mac trackpad.

# Changes

## 1. Throttle on the left mouse button (also a trackpad click)

- Left button pressed on the game canvas: throttle rises exactly as while the Up arrow is held (from 0 it ignites at MIN_THROTTLE, then rises at THROTTLE_RATE).
- Left button released: throttle falls exactly as while the Down arrow is held, until the engine shuts down (below MIN_THROTTLE), unless the left button is pressed again.
- This "pedal" behaviour applies only while the mouse is the throttle input. As soon as the player uses the Up or Down arrow, the keyboard behaviour applies unchanged (release holds the throttle) until the next left-button press.
- In the READY state, a left-button press starts the descent like Space. It also counts as the user gesture for the audio unlock, like a keypress.
- Implement this where the keyboard throttle is handled today (the files below show where). Reuse the existing throttle code path: the mouse sets the same "raise" or "lower" request the arrows set, so the physics code stays as it is.

## 2. Free 3D camera with mouse and trackpad

Inputs (all on the canvas; call `preventDefault` so the page never scrolls or zooms):
- Right-button drag (two-finger click and drag on a trackpad): rotate the view.
- Wheel without the ctrl key (two-finger swipe on a trackpad, or a mouse wheel): rotate the view, `deltaX` for yaw and `deltaY` for pitch.
- Wheel with the ctrl key (pinch on a trackpad, which the browser reports as a wheel event with `ctrlKey` true): zoom. Register the wheel listener with `{ passive: false }`.
- Keys `-` and `=`: zoom out and in. Key `0`: reset the view of the current camera mode.
- Suppress the context menu on the canvas (`contextmenu` event).

Behaviour per camera mode:
- Chase: an orbit around the lander that keeps following it. Keep the current default view as the zero position; the player adds yaw (any angle, around the world vertical), pitch (clamped between `CAMERA.minPitchDeg` and `CAMERA.maxPitchDeg`) and distance (between `CAMERA.minDistance` and `CAMERA.maxDistance`). The offset stays relative to the lander's heading, so the camera still follows turns. Smooth the result with the existing damping. Never below the terrain plus 2 m.
- Cockpit: the same inputs turn the head: yaw within plus or minus 100 degrees, pitch within plus or minus 60 degrees, relative to the default cockpit view; zoom changes the field of view between 25 and 75 degrees.
- Tower: zoom changes the field of view between 8 and 40 degrees; rotation does nothing, since the camera tracks the lander.
- Orbit: keep OrbitControls, with the left button freed for the throttle: `controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }`. In r187, a `null` entry makes OrbitControls ignore that button. Its own wheel handling stays.
- Each mode remembers its own view while the player cycles with C; key 0 resets only the current one.

Configuration: add to `CONFIG` a block `CAMERA: { dragDegPerPixel: 0.3, wheelDegPerUnit: 0.12, zoomStep: 1.1, minDistance: 6, maxDistance: 300, minPitchDeg: -10, maxPitchDeg: 85 }` and use it.

## 3. Help overlay

Add the mouse controls to the help overlay (H): "Left button: throttle (hold to raise, release to lower)", "Right drag or two-finger swipe: look around", "Pinch, or - and =: zoom", "0: reset view".

# Rules

- Change only the files listed below, and only what these changes need. Keep every module interface, export name and frame state field.
- Use r187 APIs only (`THREE.Timer`, `colorSpace`, addons from `three/addons/...`).
- Keep your reasoning short and concrete: find where input and cameras are handled, then write the changed files once. Do not recall library source from memory; everything you need is in this prompt and the files below.
