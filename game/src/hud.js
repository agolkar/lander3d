import * as THREE from 'three';

export function createHUD(config, terrain) {
  const container = document.createElement('div');
  container.id = 'hud';
  document.body.appendChild(container);

  container.innerHTML = `
    <div id="hud-left" class="hud-panel">
      <div class="hud-row"><span class="hud-label">Altitude</span><span id="hud-altitude" class="hud-value">0.0 m</span></div>
      <div class="hud-row"><span class="hud-label">Vertical speed</span><span id="hud-vspeed" class="hud-value">0.0 m/s</span></div>
      <div class="hud-row"><span class="hud-label">Horizontal speed</span><span id="hud-hspeed" class="hud-value">0.0 m/s</span></div>
      <div class="hud-row"><span class="hud-label">Range to target</span><span id="hud-range" class="hud-value">0.0 m</span></div>
      <div class="hud-row"><span class="hud-label">Throttle</span><span id="hud-throttle" class="hud-value">0%</span></div>
      <div class="hud-bar"><div id="hud-throttle-bar" class="hud-bar-fill"></div></div>
      <div class="hud-row"><span class="hud-label">Fuel</span><span id="hud-fuel" class="hud-value">0.0 kg</span></div>
      <div class="hud-row"><span class="hud-label">Fuel at hover</span><span id="hud-fuel-s" class="hud-value">0 s</span></div>
      <div class="hud-row"><span class="hud-label">RCS fuel</span><span id="hud-rcs" class="hud-value">0%</span></div>
      <div class="hud-row"><span class="hud-label">Pitch</span><span id="hud-pitch" class="hud-value">0.0°</span></div>
      <div class="hud-row"><span class="hud-label">Roll</span><span id="hud-roll" class="hud-value">0.0°</span></div>
      <div class="hud-row"><span class="hud-label">Mission time</span><span id="hud-time" class="hud-value">0:00</span></div>
    </div>
    <div id="hud-contact" class="hud-contact"><span class="lamp"></span> Contact</div>
    <div id="hud-center" class="hud-center"></div>
    <div id="hud-help" class="hud-help hud-panel"></div>
    <div id="hud-fps" class="hud-fps"></div>
    <div id="hud-exposure" class="hud-exposure"></div>
    <div id="hud-toast" class="hud-toast"></div>
    <div id="hud-target-marker" class="hud-marker">◆</div>
    <div id="hud-drift-marker" class="hud-marker hud-drift">+</div>
    <div id="hud-result" class="hud-result hud-panel"></div>
  `;

  const helpEl = document.getElementById('hud-help');
  helpEl.innerHTML = `
    <div class="hud-help-title">Controls</div>
    <div class="hud-help-row"><span>Space</span><span>Start descent</span></div>
    <div class="hud-help-row"><span>Left button</span><span>Throttle (hold to raise, release to lower)</span></div>
    <div class="hud-help-row"><span>Up / Down</span><span>Throttle up / down</span></div>
    <div class="hud-help-row"><span>X</span><span>Engine cut-off</span></div>
    <div class="hud-help-row"><span>W / S</span><span>Pitch forward / back</span></div>
    <div class="hud-help-row"><span>A / D</span><span>Roll left / right</span></div>
    <div class="hud-help-row"><span>Q / E</span><span>Yaw left / right</span></div>
    <div class="hud-help-row"><span>P</span><span>Pause</span></div>
    <div class="hud-help-row"><span>R</span><span>Restart</span></div>
    <div class="hud-help-row"><span>Shift+R</span><span>Restart with new terrain</span></div>
    <div class="hud-help-row"><span>C</span><span>Next view: chase, landing camera, window</span></div>
    <div class="hud-help-row"><span>Wheel, pinch, - and =</span><span>Zoom</span></div>
    <div class="hud-help-row"><span>Right drag or Option + drag</span><span>Look around</span></div>
    <div class="hud-help-row"><span>Two-finger sideways swipe</span><span>Rotate around the lander</span></div>
    <div class="hud-help-row"><span>0</span><span>Reset view</span></div>
    <div class="hud-help-row"><span>H</span><span>Toggle help</span></div>
    <div class="hud-help-row"><span>T</span><span>Toggle stars</span></div>
    <div class="hud-help-row"><span>M</span><span>Mute audio</span></div>
    <div class="hud-help-row"><span>V</span><span>Toggle voice</span></div>
    <div class="hud-help-row"><span>F</span><span>Toggle FPS</span></div>
    <div class="hud-help-row"><span>[ / ]</span><span>Exposure -/+ 0.1</span></div>
  `;

  let helpVisible = false;
  let fpsVisible = false;
  let exposureTimer = 0;
  let toastTimer = 0;
  let result = null;

  function setResult(phase, data) {
    result = { phase, data };
    updateResult();
  }

  function clearResult() {
    result = null;
    updateResult();
  }

  function updateResult() {
    const el = document.getElementById('hud-result');
    if (!el) return;

    if (!result) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    const { phase, data } = result;
    el.style.display = 'block';

    if (phase === 'LANDED') {
      const rating = data.distance <= config.TARGET_RADIUS ? 'On target' : 'Safe landing, off target';
      el.innerHTML = `
        <div class="hud-result-title">Landed</div>
        <div class="hud-row"><span class="hud-label">Descent rate</span><span class="hud-value">${data.descentRate.toFixed(2)} m/s</span></div>
        <div class="hud-row"><span class="hud-label">Horizontal speed</span><span class="hud-value">${data.horizontalSpeed.toFixed(2)} m/s</span></div>
        <div class="hud-row"><span class="hud-label">Tilt</span><span class="hud-value">${data.tilt.toFixed(1)}°</span></div>
        <div class="hud-row"><span class="hud-label">Distance from target</span><span class="hud-value">${data.distance.toFixed(1)} m</span></div>
        <div class="hud-row"><span class="hud-label">Fuel at hover</span><span class="hud-value">${data.fuelSeconds.toFixed(0)} s</span></div>
        <div class="hud-result-rating">${rating}</div>
        <div class="hud-result-hint">R to try again</div>
      `;
    } else {
      el.innerHTML = `
        <div class="hud-result-title">Crashed</div>
        <div class="hud-result-reason">${data.reason}</div>
        <div class="hud-row"><span class="hud-label">Descent rate</span><span class="hud-value">${data.descentRate.toFixed(2)} m/s</span></div>
        <div class="hud-row"><span class="hud-label">Horizontal speed</span><span class="hud-value">${data.horizontalSpeed.toFixed(2)} m/s</span></div>
        <div class="hud-row"><span class="hud-label">Tilt</span><span class="hud-value">${data.tilt.toFixed(1)}°</span></div>
        <div class="hud-result-hint">R to try again</div>
      `;
    }
  }

  function projectPoint(point, camera) {
    const camSpace = point.clone().applyMatrix4(camera.matrixWorldInverse);
    const behind = camSpace.z > 0;
    const v = point.clone().project(camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const visible = !behind && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1 && v.z <= 1;
    return { x, y, visible, behind };
  }

  function updateTargetMarker(state, camera) {
    const marker = document.getElementById('hud-target-marker');
    const target = new THREE.Vector3(0, terrain.getHeight(0, 0), 0);
    const proj = projectPoint(target, camera);
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    if (proj.visible) {
      marker.textContent = '◆';
      marker.style.left = `${proj.x}px`;
      marker.style.top = `${proj.y}px`;
      marker.style.transform = 'translate(-50%, -50%)';
    } else {
      marker.textContent = '➤';
      let dx;
      let dy;
      if (proj.behind) {
        const camSpace = target.clone().applyMatrix4(camera.matrixWorldInverse);
        dx = camSpace.x;
        dy = -camSpace.y;
      } else {
        dx = proj.x - cx;
        dy = proj.y - cy;
      }
      const len = Math.hypot(dx, dy) || 1;
      const maxLen = Math.min(cx, cy) - 40;
      const x = cx + (dx / len) * maxLen;
      const y = cy + (dy / len) * maxLen;
      const angle = Math.atan2(dy, dx);
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
      marker.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    }
  }

  function updateDriftMarker(state, camera) {
    const marker = document.getElementById('hud-drift-marker');
    const predicted = state.position.clone().addScaledVector(state.velocity, 4);
    predicted.y = terrain.getHeight(predicted.x, predicted.z);
    const proj = projectPoint(predicted, camera);

    if (proj.visible) {
      marker.style.display = 'block';
      marker.style.left = `${proj.x}px`;
      marker.style.top = `${proj.y}px`;
      marker.style.transform = 'translate(-50%, -50%)';
    } else {
      marker.style.display = 'none';
    }
  }

  function update(state, camera, terrainRef, lander, fps) {
    const el = (id) => document.getElementById(id);

    el('hud-altitude').textContent = `${state.altitude.toFixed(1)} m`;
    el('hud-vspeed').textContent = `${state.verticalSpeed >= 0 ? '+' : ''}${state.verticalSpeed.toFixed(1)} m/s`;
    el('hud-hspeed').textContent = `${state.horizontalSpeed.toFixed(1)} m/s`;
    el('hud-range').textContent = `${state.rangeToTarget.toFixed(1)} m`;
    el('hud-throttle').textContent = `${Math.round(state.throttle * 100)}%`;
    el('hud-throttle-bar').style.width = `${state.throttle * 100}%`;
    el('hud-fuel').textContent = `${state.fuelKg.toFixed(1)} kg`;
    el('hud-fuel-s').textContent = `${state.fuelSecondsAtHover.toFixed(0)} s`;
    el('hud-rcs').textContent = `${Math.round((state.rcsFuelKg / config.RCS_FUEL_START) * 100)}%`;

    const q = state.quaternion;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180 / Math.PI;
    const roll = Math.atan2(up.x, up.y) * 180 / Math.PI;
    el('hud-pitch').textContent = `${pitch.toFixed(1)}°`;
    el('hud-roll').textContent = `${roll.toFixed(1)}°`;

    const t = Math.floor(state.time);
    const mm = Math.floor(t / 60);
    const ss = t % 60;
    el('hud-time').textContent = `${mm}:${ss.toString().padStart(2, '0')}`;

    const descentRate = -state.verticalSpeed;
    el('hud-vspeed').classList.toggle('hud-danger', descentRate > config.LIMIT_VERTICAL);
    el('hud-hspeed').classList.toggle('hud-danger', state.horizontalSpeed > config.LIMIT_HORIZONTAL);

    const tilt = Math.acos(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI;
    el('hud-pitch').classList.toggle('hud-danger', tilt > config.LIMIT_TILT_DEG);
    el('hud-roll').classList.toggle('hud-danger', tilt > config.LIMIT_TILT_DEG);

    const fuelSEl = el('hud-fuel-s');
    fuelSEl.classList.toggle('hud-warn', state.fuelSecondsAtHover < 60 && state.fuelSecondsAtHover >= 30);
    fuelSEl.classList.toggle('hud-danger-blink', state.fuelSecondsAtHover < 30);

    el('hud-contact').classList.toggle('on', state.contactLight);

    const center = el('hud-center');
    if (state.phase === 'READY') center.textContent = 'Space to begin powered descent';
    else if (state.phase === 'PAUSED') center.textContent = 'Paused';
    else center.textContent = '';

    updateTargetMarker(state, camera);
    updateDriftMarker(state, camera);

    const fpsEl = el('hud-fps');
    if (fpsVisible) {
      fpsEl.style.display = 'block';
      fpsEl.textContent = `${Math.round(fps)} fps`;
    } else {
      fpsEl.style.display = 'none';
    }

    if (toastTimer > 0) {
      toastTimer -= state.dt;
      if (toastTimer <= 0) el('hud-toast').style.display = 'none';
    }

    if (exposureTimer > 0) {
      exposureTimer -= state.dt;
      if (exposureTimer <= 0) el('hud-exposure').style.display = 'none';
    }
  }

  function toggleHelp() {
    helpVisible = !helpVisible;
    helpEl.style.display = helpVisible ? 'block' : 'none';
  }

  function toggleFps() {
    fpsVisible = !fpsVisible;
  }

  function showExposure(value) {
    const el = document.getElementById('hud-exposure');
    el.textContent = `Exposure ${value.toFixed(1)}`;
    el.style.display = 'block';
    exposureTimer = 2;
  }

  // short message at the top of the screen, for example the name of the camera view
  function showToast(text, seconds = 1.8) {
    const t = document.getElementById('hud-toast');
    t.textContent = text;
    t.style.display = 'block';
    toastTimer = seconds;
  }

  function dispose() {
    container.remove();
  }

  return {
    update,
    setResult,
    clearResult,
    toggleHelp,
    toggleFps,
    showExposure,
    showToast,
    dispose
  };
}
