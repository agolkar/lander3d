import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createLoadingManager } from './assets.js';
import { createTerrain, setupCSMForMaterial } from './terrain.js';
import { createRocks } from './rocks.js';
import { createSky } from './sky.js';
import { createLander } from './lander.js';
import { createInput } from './input.js';
import { createCameras } from './cameras.js';
import { createHUD } from './hud.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';

async function init() {
  const params = new URLSearchParams(location.search);
  const quality = params.get('quality') === 'medium' ? 'medium' : CONFIG.QUALITY;
  const maxPixelRatio = quality === 'high' ? 2 : 1.5;
  const shadowMapSize = quality === 'high' ? 4096 : 2048;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = CONFIG.EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in r187
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const loadingEl = document.getElementById('loading');
  const loadingBar = document.getElementById('loading-bar');
  const loadingText = document.getElementById('loading-text');
  const manager = createLoadingManager((loaded, total) => {
    if (loadingBar) loadingBar.style.width = `${(loaded / total) * 100}%`;
    if (loadingText) loadingText.textContent = `Loading ${loaded}/${total}`;
  }, (url) => {
    console.warn('Missing asset:', url);
  });

  const errorPanel = document.getElementById('error-overlay');
  let frameErrorReported = false;
  function showError(msg, stack) {
    if (!errorPanel) return;
    errorPanel.style.display = 'block';
    errorPanel.textContent = `${msg}\n${stack || ''}`;
  }
  window.addEventListener('error', (e) => showError(e.message, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => showError(e.reason?.message || String(e.reason), e.reason?.stack));

  try {
    const terrain = await createTerrain(scene, CONFIG, CONFIG.SEED, quality, manager);
    const lander = await createLander(scene, CONFIG, null, manager);
    const cameras = createCameras(scene, CONFIG, terrain, lander, renderer);
    const sky = await createSky(scene, cameras.getActiveCamera(), CONFIG, quality, manager, renderer);

    setupCSMForMaterial(terrain.material, sky.csm);
    setupCSMForMaterial(terrain.farMaterial, sky.csm);

    lander.root.traverse((child) => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) sky.csm.setupMaterial(m);
      }
    });

    const rocks = await createRocks(scene, CONFIG, terrain, sky.csm, manager, CONFIG.SEED);
    cameras.setObstacleTest((p) => rocks.rockCollision(p) !== null); // landing camera avoids standing behind rocks

    const effects = createEffects(renderer, scene, cameras.getActiveCamera(), {
      getHeight: terrain.getHeight,
      getNormal: terrain.getNormal,
      config: CONFIG,
      landerRoot: lander.root
    });

    const audio = createAudio(CONFIG.AUDIO);
    const hud = createHUD(CONFIG, terrain);
    const input = createInput(renderer.domElement);
    // ?debug exposes the game objects in the browser console for testing
    if (params.has('debug')) window.__game = { THREE, renderer, scene, terrain, lander, cameras, sky, rocks, effects, audio, hud, input, CONFIG };

    cameras.setOnChange((cam, label) => {
      effects.setCamera(cam);
      if (label) hud.showToast(label);
      sky.csm.camera = cam;
      sky.csm.updateFrustums();
    });

    effects.setCamera(cameras.getActiveCamera());
    sky.csm.camera = cameras.getActiveCamera();
    sky.csm.updateFrustums();

    const unlock = () => { audio.unlock(); };
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });

    const events = {
      contact: (data) => {
        effects.event('contact', data);
        audio.event('contact', data);
      },
      landed: (data) => {
        effects.event('landed', data);
        audio.event('landed', data);
        hud.setResult('LANDED', data);
      },
      crash: (data) => {
        effects.event('crash', data);
        audio.event('crash', data);
        hud.setResult('CRASHED', data);
      },
      fuelOut: () => {
        audio.event('fuelOut');
      },
      engineOn: () => {
        audio.event('engineOn');
      },
      engineOff: () => {
        audio.event('engineOff');
      }
    };

    const frameState = {
      phase: 'READY',
      time: 0,
      dt: 0,
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      verticalSpeed: 0,
      horizontalSpeed: 0,
      altitude: 0,
      throttle: 0,
      thrustNewtons: 0,
      fuelKg: 0,
      fuelFraction: 0,
      fuelSecondsAtHover: 0,
      rcsCommand: { pitch: 0, roll: 0, yaw: 0 },
      rcsFiring: false,
      rcsFuelKg: 0,
      nozzleExit: new THREE.Vector3(),
      exhaustDir: new THREE.Vector3(),
      groundBelowNozzle: null,
      rcsQuads: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
      contactLight: false,
      rangeToTarget: 0,
      cameraMode: 'chase'
    };

    const groundBelowNozzleObj = {
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      distance: 0
    };

    const timer = new THREE.Timer();
    timer.connect(document);

    let accumulator = 0;
    const FIXED_DT = 1 / 120;
    let fpsSmooth = 60;

    function restart(newSeed) {
      if (newSeed) {
        const seed = Math.floor(Math.random() * 1000000000);
        terrain.regenerate(seed);
        rocks.regenerate(seed);
      }
      lander.reset();
      cameras.reset();
      effects.event('restart');
      audio.event('restart');
      hud.clearResult();
      accumulator = 0;
    }

    function processActions() {
      const actions = input.actions;
      for (const action of actions) {
        switch (action.name) {
          case 'start':
            if (lander.state.phase === 'READY' && lander.start()) {
              effects.event('start');
              audio.event('start');
            }
            break;
          case 'pause':
            if (lander.state.phase === 'FLYING') lander.state.phase = 'PAUSED';
            else if (lander.state.phase === 'PAUSED') lander.state.phase = 'FLYING';
            break;
          case 'restart':
            restart(action.shift);
            break;
          case 'camera':
            cameras.cycle();
            break;
          case 'help':
            hud.toggleHelp();
            break;
          case 'stars':
            sky.toggleStars();
            break;
          case 'mute':
            audio.toggleMute();
            break;
          case 'voice':
            audio.toggleVoice();
            break;
          case 'fps':
            hud.toggleFps();
            break;
          case 'exposure':
            renderer.toneMappingExposure = Math.max(0.1, Math.min(3, renderer.toneMappingExposure + action.delta));
            hud.showExposure(renderer.toneMappingExposure);
            break;
          case 'zoom':
            cameras.zoom(action.delta);
            break;
          case 'resetView':
            cameras.resetView();
            break;
        }
      }
      input.actions.length = 0;
    }

    function computeGroundBelowNozzle(nozzleExit, exhaustDir, terrainRef) {
      const maxDist = 120;
      let prevD = 0;
      for (let d = 0.5; d <= maxDist; d += 0.5) {
        const px = nozzleExit.x + exhaustDir.x * d;
        const py = nozzleExit.y + exhaustDir.y * d;
        const pz = nozzleExit.z + exhaustDir.z * d;
        const h = terrainRef.getHeight(px, pz);
        const y = py - h;
        if (y <= 0) {
          let lo = prevD;
          let hi = d;
          for (let i = 0; i < 8; i++) {
            const mid = (lo + hi) / 2;
            const mx = nozzleExit.x + exhaustDir.x * mid;
            const my = nozzleExit.y + exhaustDir.y * mid;
            const mz = nozzleExit.z + exhaustDir.z * mid;
            if (my - terrainRef.getHeight(mx, mz) > 0) lo = mid;
            else hi = mid;
          }
          const dist = (lo + hi) / 2;
          groundBelowNozzleObj.point.set(
            nozzleExit.x + exhaustDir.x * dist,
            0,
            nozzleExit.z + exhaustDir.z * dist
          );
          groundBelowNozzleObj.point.y = terrainRef.getHeight(groundBelowNozzleObj.point.x, groundBelowNozzleObj.point.z);
          terrainRef.getNormal(groundBelowNozzleObj.point.x, groundBelowNozzleObj.point.z, groundBelowNozzleObj.normal);
          groundBelowNozzleObj.distance = dist;
          return groundBelowNozzleObj;
        }
        prevD = d;
      }
      return null;
    }

    function updateFrameState(dt) {
      const q = lander.state.quaternion;
      const pos = lander.state.position;

      frameState.phase = lander.state.phase;
      frameState.time = lander.state.time;
      frameState.dt = dt;
      frameState.position.copy(pos);
      frameState.quaternion.copy(q);
      frameState.velocity.copy(lander.state.velocity);
      frameState.verticalSpeed = lander.state.velocity.y;
      frameState.horizontalSpeed = Math.hypot(lander.state.velocity.x, lander.state.velocity.z);
      frameState.altitude = lander.getAltitude(terrain);
      frameState.throttle = lander.state.throttle;
      frameState.thrustNewtons = lander.state.thrustNewtons;
      frameState.fuelKg = lander.state.fuelKg;
      frameState.fuelFraction = lander.state.fuelKg / CONFIG.FUEL_START;
      frameState.fuelSecondsAtHover = lander.fuelSecondsAtHover();
      frameState.rcsCommand = {
        pitch: lander.state.rcsCommand.pitch,
        roll: lander.state.rcsCommand.roll,
        yaw: lander.state.rcsCommand.yaw
      };
      frameState.rcsFiring = lander.state.rcsFiring;
      frameState.rcsFuelKg = lander.state.rcsFuelKg;

      frameState.nozzleExit.copy(lander.localPositions.nozzleExit).applyQuaternion(q).add(pos);
      frameState.exhaustDir.set(0, -1, 0).applyQuaternion(q).normalize();
      frameState.groundBelowNozzle = computeGroundBelowNozzle(frameState.nozzleExit, frameState.exhaustDir, terrain);

      for (let i = 0; i < 4; i++) {
        frameState.rcsQuads[i].copy(lander.localPositions.rcsQuads[i]).applyQuaternion(q).add(pos);
      }

      frameState.contactLight = lander.state.contactLight;
      frameState.rangeToTarget = Math.hypot(pos.x, pos.z);
      frameState.cameraMode = cameras.mode;
    }

    function animate(timestamp) {
      requestAnimationFrame(animate);
      try {
        timer.update(timestamp);
        let dt = timer.getDelta();
        if (dt > 0.1) dt = 0.1;
        fpsSmooth = fpsSmooth * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;

        processActions();

        if (lander.state.phase === 'FLYING') {
          accumulator += dt;
          while (accumulator >= FIXED_DT) {
            lander.step(FIXED_DT, input, terrain, rocks, events);
            accumulator -= FIXED_DT;
          }
        } else {
          accumulator = 0;
        }

        cameras.update(dt);
        sky.csm.update();
        updateFrameState(dt);
        hud.update(frameState, cameras.getActiveCamera(), terrain, lander, fpsSmooth);
        effects.update(frameState);
        audio.update(frameState);
        effects.render();
      } catch (err) {
        if (!frameErrorReported) {
          frameErrorReported = true;
          showError(err.message, err.stack);
        }
      }
    }

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
      renderer.setSize(w, h);
      cameras.resize(w, h);
      sky.csm.updateFrustums();
      effects.resize(w, h);
    });

    if (loadingEl) loadingEl.style.display = 'none';

    lander.reset();
    cameras.reset();
    hud.clearResult();

    requestAnimationFrame(animate);
  } catch (err) {
    showError(err.message, err.stack);
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

init();
