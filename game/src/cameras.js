import * as THREE from 'three';

// Three views, cycled with C:
//   chase   behind and above the lander along its heading, with free orbit and zoom;
//           below CAMERA.lowAltitude it lowers itself so the gap between footpads and ground stays in view
//   ground  a camera standing on the surface beside the predicted touchdown point, tracking the lander
//           with a long lens that keeps it framed (the landing view)
//   window  the commander's window, looking forward and down
//
// Mouse and trackpad (all on the game canvas):
//   wheel, vertical two-finger swipe, pinch   zoom
//   right-drag, two-finger click-drag,
//   or Option + left-drag                      look around (orbit in chase view, head turn in window view)
//   horizontal two-finger swipe                rotate around the lander
//   0 resets the current view; - and = zoom; the left button stays the throttle (see input.js)

const DEG = Math.PI / 180;
const MODES = ['chase', 'ground', 'window'];
const LABELS = { chase: 'Chase view', ground: 'Landing camera', window: 'Window view' };

const CHASE_BASE_OFFSET = new THREE.Vector3(0, 6, -22); // the stage 2 framing: 6 m up, 22 m back
const CHASE_BASE_DIST = CHASE_BASE_OFFSET.length();
const CHASE_BASE_PITCH = Math.atan2(CHASE_BASE_OFFSET.y, -CHASE_BASE_OFFSET.z) / DEG;
const CHASE_LOW_PITCH = 4; // degrees above the lander when it is about to touch down
const LOOK_HEIGHT = 2.5; // aim point above the lander origin (m)
const GROUND_FRAME_HEIGHT = 18; // metres of scene the landing camera keeps in frame high up, at zoom 1
const GROUND_FRAME_LOW = 30; // below this altitude (m) the landing camera also keeps the ground in frame
const GROUND_FRAME_HIGH = 60; // above this altitude (m) it frames the lander alone
const GROUND_DIST_PER_ALT = 0.9; // the camera stands this many metres away per metre of altitude...
const GROUND_MAX_DIST = 400; // ...up to this far, so it sees the lander from the side, not from below
const GROUND_RELOCATE_DIST = 60; // move the landing camera when the predicted point drifts this far (m)
const GROUND_RELOCATE_COOLDOWN = 4; // and at most this often (s)
const GROUND_SIGHT_HEIGHT = 1.5; // the camera must see this far above the touchdown point (m)
const WINDOW_DEFAULT_PITCH = -25;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

export function createCameras(scene, config, terrain, lander, renderer) {
  const C = Object.assign({
    dragDegPerPixel: 0.25,
    swipeDegPerUnit: 0.12,
    zoomPerWheelUnit: 0.0015,
    pinchZoomPerUnit: 0.01,
    zoomStep: 1.15,
    minDistance: 6,
    maxDistance: 400,
    minPitchDeg: -5,
    maxPitchDeg: 85,
    lowAltitude: 40,
    groundSideOffset: 45,
    groundEyeHeight: 3
  }, config.CAMERA || {});

  // horizontal direction towards the sun: the landing camera prefers to stand with the sun behind it
  const sunAz = (config.SUN_AZIMUTH_DEG || 0) * DEG;
  const sunH = new THREE.Vector3(Math.sin(sunAz), 0, -Math.cos(sunAz));

  // optional obstacle test (rocks), set from main.js once the rocks exist: (point) => true if inside a rock
  let obstacleTest = null;

  const aspect = window.innerWidth / window.innerHeight;
  const cams = {
    chase: new THREE.PerspectiveCamera(55, aspect, 0.3, 40000),
    ground: new THREE.PerspectiveCamera(20, aspect, 0.5, 40000),
    window: new THREE.PerspectiveCamera(55, aspect, 0.1, 40000)
  };

  let mode = 'chase';
  let onChange = null;

  // per-view state
  const chaseView = { yaw: 0, pitch: CHASE_BASE_PITCH, dist: CHASE_BASE_DIST, init: false, heading: 0 };
  const groundView = { zoom: 1, anchor: new THREE.Vector3(), hasAnchor: false, cooldown: 0, fov: 20, dist: 45, snap: true };
  const windowView = { yaw: 0, pitch: 0, fov: 55 };

  // temporaries
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const predicted = new THREE.Vector3();
  const sightTarget = new THREE.Vector3();
  const candidate = new THREE.Vector3();
  const bestCandidate = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0);
  const AY = new THREE.Vector3(0, 1, 0);
  const Q_YAW180 = new THREE.Quaternion().setFromAxisAngle(AY, Math.PI);

  // ----- window eye: the cockpit eye point sits inside the cabin. Push it forward until it is just
  // outside the hull, so the view shows the outside world instead of the inside of the cabin walls.
  const windowEyeLocal = new THREE.Vector3().copy(lander.localPositions.cockpitEye);
  (function placeWindowEye() {
    const ascent = lander.root.getObjectByName('AscentStage');
    if (!ascent) return;
    const root = lander.root;
    root.updateMatrixWorld(true);
    const origin = windowEyeLocal.clone().applyMatrix4(root.matrixWorld);
    const dir = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld);
    const meshes = [];
    ascent.traverse((o) => { if (o.isMesh) meshes.push(o); });
    // raycast against both faces, whatever the materials say (from inside, the walls show their back faces)
    const twoSided = (mat) => { const c = mat.clone(); c.side = THREE.DoubleSide; return c; };
    const saved = meshes.map((m) => m.material);
    meshes.forEach((m) => { m.material = Array.isArray(m.material) ? m.material.map(twoSided) : twoSided(m.material); });
    const hits = new THREE.Raycaster(origin, dir, 0, 6).intersectObjects(meshes, false);
    meshes.forEach((m, i) => { m.material = saved[i]; });
    // the first wall ahead, plus anything stacked right behind it (window glass, frame, panel)
    let exitDist = hits.length ? hits[0].distance : 1.0;
    for (const h of hits) if (h.distance < exitDist + 0.6) exitDist = h.distance;
    const eyeWorld = origin.clone().addScaledVector(dir, exitDist + 0.2);
    windowEyeLocal.copy(root.worldToLocal(eyeWorld));
  })();

  // height of the top of the lander above its origin (the footpad plane), for framing
  const landerTop = (function measureLander() {
    const root = lander.root;
    const p = root.position.clone();
    const q = root.quaternion.clone();
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.position.copy(p);
    root.quaternion.copy(q);
    root.updateMatrixWorld(true);
    return Number.isFinite(box.max.y) && box.max.y > 1 ? box.max.y : 7;
  })();

  function active() { return cams[mode]; }

  function setMode(newMode) {
    if (!MODES.includes(newMode)) return;
    mode = newMode;
    dragging = false;
    if (mode === 'chase') chaseView.init = false; // start from the right place, no long swoop
    if (mode === 'ground') groundView.hasAnchor = false; // place it fresh for the current situation
    if (onChange) onChange(active(), LABELS[mode]);
  }

  function cycle() { setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); }

  function resetView() {
    if (mode === 'chase') {
      chaseView.yaw = 0; chaseView.pitch = CHASE_BASE_PITCH; chaseView.dist = CHASE_BASE_DIST;
    } else if (mode === 'ground') {
      groundView.zoom = 1; groundView.hasAnchor = false;
    } else if (mode === 'window') {
      windowView.yaw = 0; windowView.pitch = 0; windowView.fov = 55;
    }
  }

  function reset() {
    chaseView.yaw = 0; chaseView.pitch = CHASE_BASE_PITCH; chaseView.dist = CHASE_BASE_DIST; chaseView.init = false;
    groundView.zoom = 1; groundView.hasAnchor = false; groundView.cooldown = 0;
    windowView.yaw = 0; windowView.pitch = 0; windowView.fov = 55;
    if (onChange) onChange(active(), LABELS[mode]);
  }

  // factor > 1 zooms out, < 1 zooms in
  function zoomBy(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (mode === 'chase') chaseView.dist = clamp(chaseView.dist * factor, C.minDistance, C.maxDistance);
    else if (mode === 'ground') groundView.zoom = clamp(groundView.zoom / factor, 0.15, 12);
    else if (mode === 'window') windowView.fov = clamp(windowView.fov * factor, 20, 80);
  }

  // keyboard zoom: direction +1 zooms in, -1 zooms out
  function zoom(direction) {
    if (!direction) return;
    zoomBy(direction > 0 ? 1 / C.zoomStep : C.zoomStep);
  }

  // dx, dy in degrees of turn requested by the user
  function look(dxDeg, dyDeg) {
    if (mode === 'chase') {
      chaseView.yaw -= dxDeg;
      chaseView.pitch = clamp(chaseView.pitch + dyDeg, C.minPitchDeg, C.maxPitchDeg);
    } else if (mode === 'window') {
      windowView.yaw = clamp(windowView.yaw - dxDeg, -110, 110);
      windowView.pitch = clamp(windowView.pitch - dyDeg, -65, 45);
    }
  }

  // ----- landing camera helpers
  function predictTouchdown(out) {
    const p = lander.state.position;
    const v = lander.state.velocity;
    const alt = Math.max(0, lander.getAltitude(terrain));
    const descent = Math.max(0.5, -v.y);
    const t = Math.min(alt / descent, 60);
    let dx = v.x * t;
    let dz = v.z * t;
    const d = Math.hypot(dx, dz);
    if (d > 600) { dx *= 600 / d; dz *= 600 / d; }
    out.set(p.x + dx, 0, p.z + dz);
    out.y = terrain.getHeight(out.x, out.z);
    return out;
  }

  function idealGroundDist(alt) {
    return clamp(alt * GROUND_DIST_PER_ALT, C.groundSideOffset, GROUND_MAX_DIST);
  }

  // How badly is the view from `from` to `to` blocked? Returns how many metres the terrain rises above
  // the line of sight at its worst (0 or less means clear), or Infinity when a rock is in the way.
  function obstruction(from, to) {
    let worst = -Infinity;
    const n = 40;
    for (let i = 2; i < n; i++) {
      const t = i / n;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const y = from.y + (to.y - from.y) * t;
      worst = Math.max(worst, terrain.getHeight(x, z) + 0.2 - y);
    }
    if (obstacleTest) {
      v3.subVectors(to, from);
      const len = v3.length();
      v3.divideScalar(Math.max(len, 1e-6));
      const reach = Math.min(25, len);
      for (let d = 0; d < reach; d += 0.75) {
        candidate.copy(from).addScaledVector(v3, d);
        if (obstacleTest(candidate)) return Infinity;
        candidate.y -= 1.2; // lower edge of the picture
        if (obstacleTest(candidate)) return Infinity;
      }
    }
    return worst;
  }

  function placeGroundCamera(anchor, alt) {
    const v = lander.state.velocity;
    // approach direction: horizontal velocity, or the lander heading when nearly hovering
    v1.set(v.x, 0, v.z);
    if (v1.lengthSq() < 0.25) v1.set(0, 0, 1).applyQuaternion(lander.state.quaternion).setY(0);
    if (v1.lengthSq() < 1e-6) v1.set(0, 0, 1);
    v1.normalize();
    const dist = idealGroundDist(alt);
    // Candidate spots around the touchdown point, by bearing from the approach direction. Side-on views
    // show height and drift best; among those, prefer the sun behind the camera so the lander is lit.
    const candidates = [];
    for (const deg of [90, -90, 60, -60, 120, -120, 30, -30, 150, -150]) {
      const a = deg * DEG;
      const dx = v1.x * Math.cos(a) + v1.z * Math.sin(a);
      const dz = -v1.x * Math.sin(a) + v1.z * Math.cos(a);
      candidates.push({ dx, dz, score: Math.abs(Math.sin(a)) + 0.5 * (dx * sunH.x + dz * sunH.z) });
    }
    candidates.sort((a, b) => b.score - a.score);
    sightTarget.copy(anchor);
    sightTarget.y += GROUND_SIGHT_HEIGHT;
    // first spot with a clear view of the touchdown point wins; otherwise the least blocked one
    let bestObs = Infinity;
    let found = false;
    search: for (const f of [1, 0.75, 1.35]) {
      for (const c of candidates) {
        v2.set(anchor.x + c.dx * dist * f, 0, anchor.z + c.dz * dist * f);
        v2.y = terrain.getHeight(v2.x, v2.z) + C.groundEyeHeight;
        const obs = obstruction(v2, sightTarget); // (uses `candidate` and v3 internally, not v2)
        if (!found || obs < bestObs) { bestObs = obs; bestCandidate.copy(v2); found = true; }
        if (obs <= 0) break search;
      }
    }
    cams.ground.position.copy(bestCandidate);
    groundView.anchor.copy(anchor);
    groundView.dist = dist;
    groundView.hasAnchor = true;
    groundView.cooldown = GROUND_RELOCATE_COOLDOWN;
    groundView.snap = true; // a cut: no zoom animation across it
  }

  function update(dt) {
    const pos = lander.state.position;
    const q = lander.state.quaternion;

    if (mode === 'chase') {
      const cam = cams.chase;
      v1.set(0, 0, 1).applyQuaternion(q).setY(0);
      if (v1.lengthSq() > 1e-4) chaseView.heading = Math.atan2(v1.x, v1.z);

      const alt = Math.max(0, lander.getAltitude(terrain));
      const low = smooth01((C.lowAltitude - alt) / C.lowAltitude); // 0 high up, 1 at touchdown
      let pitch = chaseView.pitch;
      if (pitch > CHASE_LOW_PITCH) pitch += (CHASE_LOW_PITCH - pitch) * low;
      const yaw = chaseView.heading + chaseView.yaw * DEG;
      const pr = pitch * DEG;
      const hd = Math.cos(pr) * chaseView.dist;

      // aim between the lander and the ground below it when low, so both stay in frame
      const groundY = terrain.getHeight(pos.x, pos.z);
      lookTarget.copy(pos);
      lookTarget.y = pos.y + LOOK_HEIGHT;
      lookTarget.y += ((pos.y + LOOK_HEIGHT + groundY) * 0.5 - lookTarget.y) * low * 0.7;

      desired.set(-Math.sin(yaw) * hd, Math.sin(pr) * chaseView.dist, -Math.cos(yaw) * hd).add(lookTarget);
      const far = Math.max(60, chaseView.dist * 3);
      if (!chaseView.init || cam.position.distanceToSquared(desired) > far * far) {
        cam.position.copy(desired); // first frame, or after a jump (restart, teleport): no long swoop
        chaseView.init = true;
      } else {
        cam.position.lerp(desired, 1 - Math.exp(-6 * dt));
      }
      const minY = terrain.getHeight(cam.position.x, cam.position.z) + 1.5;
      if (cam.position.y < minY) cam.position.y = minY;
      cam.lookAt(lookTarget);
    } else if (mode === 'ground') {
      const cam = cams.ground;
      groundView.cooldown -= dt;
      const alt = Math.max(0, lander.getAltitude(terrain));
      predictTouchdown(predicted);
      const settled = lander.state.phase === 'LANDED' || lander.state.phase === 'CRASHED';
      if (!groundView.hasAnchor) {
        placeGroundCamera(predicted, alt);
      } else if (!settled && groundView.cooldown <= 0) {
        // move (cut) when the touchdown point has drifted, or when the lander has descended or climbed
        // enough that a closer or farther spot gives a better side view
        const drift = Math.hypot(predicted.x - groundView.anchor.x, predicted.z - groundView.anchor.z);
        const ratio = groundView.dist / idealGroundDist(alt);
        if (drift > Math.max(GROUND_RELOCATE_DIST, 0.35 * groundView.dist) || ratio > 2 || ratio < 0.5) {
          placeGroundCamera(predicted, alt);
        }
      }
      // Framing. Low down the picture spans from the ground under the lander to just above its top, so the
      // last metres of the descent are visible; higher up it is a long lens on the lander alone.
      const groundY = terrain.getHeight(pos.x, pos.z);
      const top = pos.y + landerTop + 1;
      const bottom = Math.min(groundY, pos.y) - 1;
      const centreY = pos.y + landerTop * 0.45;
      const s = smooth01((alt - GROUND_FRAME_LOW) / (GROUND_FRAME_HIGH - GROUND_FRAME_LOW));
      let span = (top - bottom) + (GROUND_FRAME_HEIGHT - (top - bottom)) * s;
      let aimY = (top + bottom) * 0.5 + (centreY - (top + bottom) * 0.5) * s;
      span /= groundView.zoom; // user zoom; zooming in drifts the aim onto the lander so it stays in view
      if (groundView.zoom > 1) aimY += (centreY - aimY) * (1 - 1 / groundView.zoom);
      lookTarget.set(pos.x, aimY, pos.z);
      cam.lookAt(lookTarget);
      const dist = cam.position.distanceTo(lookTarget);
      const target = clamp(2 * Math.atan(span / 2 / Math.max(dist, 1)) / DEG, 1.2, 70);
      if (groundView.snap) { groundView.fov = target; groundView.snap = false; }
      else groundView.fov += (target - groundView.fov) * (1 - Math.exp(-4 * dt));
      if (Math.abs(cam.fov - groundView.fov) > 1e-3) { cam.fov = groundView.fov; cam.updateProjectionMatrix(); }
    } else if (mode === 'window') {
      const cam = cams.window;
      cam.position.copy(windowEyeLocal).applyQuaternion(q).add(pos);
      qa.setFromAxisAngle(AX, (WINDOW_DEFAULT_PITCH + windowView.pitch) * DEG);
      qb.setFromAxisAngle(AY, windowView.yaw * DEG);
      // lander orientation, turned to look along the lander's +Z, then head yaw, then head pitch
      cam.quaternion.copy(q).multiply(Q_YAW180).multiply(qb).multiply(qa);
      if (Math.abs(cam.fov - windowView.fov) > 1e-3) { cam.fov = windowView.fov; cam.updateProjectionMatrix(); }
    }
  }

  function resize(width, height) {
    for (const cam of Object.values(cams)) {
      cam.aspect = width / height;
      cam.updateProjectionMatrix();
    }
  }

  // ----- pointer and wheel input
  const el = renderer.domElement;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e) {
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      e.preventDefault();
    }
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    look(dx * C.dragDegPerPixel, dy * C.dragDegPerPixel);
  }

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try { el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  }

  function onWheel(e) {
    e.preventDefault();
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= 400; dy *= 400; }
    if (e.ctrlKey) { // trackpad pinch arrives as a wheel event with ctrlKey
      zoomBy(Math.exp(dy * C.pinchZoomPerUnit));
      return;
    }
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; } // Shift + mouse wheel rotates
    if (Math.abs(dx) > Math.abs(dy)) look(dx * C.swipeDegPerUnit, 0);
    else zoomBy(Math.exp(dy * C.zoomPerWheelUnit));
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    getActiveCamera: active,
    get mode() { return mode; },
    get label() { return LABELS[mode]; },
    setMode,
    cycle,
    reset,
    resetView,
    zoom,
    zoomBy,
    look,
    update,
    resize,
    setOnChange(cb) { onChange = cb; },
    setObstacleTest(fn) { obstacleTest = typeof fn === 'function' ? fn : null; }
  };
}
