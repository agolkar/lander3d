import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Replaces NaN or infinite pixels with black and caps extreme values before bloom.
// Without it, a single bad pixel anywhere in the scene is blurred by the bloom over the whole frame.
const SanitizeShader = {
  name: 'SanitizeShader',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = any(isnan(c)) || any(isinf(c)) || any(notEqual(c, c));
      gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(min(c.rgb, vec3(64.0)), c.a);
    }`
};

// Constants used when a setting is missing from config.js.
const DEFAULT_BLOOM_STRENGTH = 0.35;
const DEFAULT_BLOOM_RADIUS = 0.4;
const DEFAULT_BLOOM_THRESHOLD = 1.0;
const DEFAULT_DUST_MAX = 20000;
const DEFAULT_DUST_START_ALTITUDE = 35;
const DEFAULT_PLUME_OPACITY = 0.12;

const LUNAR_GRAVITY = 1.62;
const DUST_MAX_RANGE = 300;
const DUST_MIN_SPEED = 20;
const DUST_MAX_SPEED = 60;
const DUST_MAX_UP = 3;
const DUST_START_RADIUS = 3.0;
const DUST_EMISSION_BASE = 9000; // particles/s at full throttle, full emission factor
const RCS_PUFF_LIFE = 0.08;
const RCS_PUFF_SIZE = 0.35;
const PLUME_LENGTH_MIN = 2.0;
const PLUME_LENGTH_MAX = 6.0;
const PLUME_RADIUS = 0.55;
const PLUME_LIGHT_DISTANCE = 40;
const PLUME_LIGHT_INTENSITY = 55;
const PLUME_LIGHT_OFFSET = 2.0;
const CRASH_DEBRIS_COUNT = 60;
const CRASH_FLASH_LIFE = 0.4;
const CRASH_FLASH_INTENSITY = 320;
const CRASH_FLASH_DISTANCE = 60;
const DEBRIS_GRAVITY = LUNAR_GRAVITY;
const DEBRIS_BOUNCE = 0.35;
const DEBRIS_FRICTION = 0.55;
const DEBRIS_LIFE = 30.0;
const RING_SIZE = 22.0;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function makeRandom(seed) {
  let s = seed >>> 0;
  return function rand() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function readConfigNumber(config, key, fallback) {
  if (config && config.EFFECTS && typeof config.EFFECTS[key] === 'number') {
    return config.EFFECTS[key];
  }
  return fallback;
}

function readConfigBool(config, key, fallback) {
  if (config && config.EFFECTS && typeof config.EFFECTS[key] === 'boolean') {
    return config.EFFECTS[key];
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

function buildComposer(renderer, scene, camera, ctx) {
  const config = ctx.config;
  const size = renderer.getSize(new THREE.Vector2());
  let width = size.x || 1;
  let height = size.y || 1;
  const pixelRatio = renderer.getPixelRatio();

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  let gtaoPass = null;
  const gtaoEnabled = readConfigBool(config, 'gtao', true);
  if (gtaoEnabled) {
    try {
      gtaoPass = new GTAOPass(scene, camera, width, height);
      gtaoPass.blendIntensity = 0.6;
      gtaoPass.updateGtaoMaterial({ radius: 0.6 });
      gtaoPass.setSize(width, height);
      composer.addPass(gtaoPass);
    } catch (err) {
      console.warn('GTAO pass unavailable:', err);
      gtaoPass = null;
    }
  }

  const sanitizePass = new ShaderPass(SanitizeShader);
  composer.addPass(sanitizePass);

  const bloomStrength = readConfigNumber(config, 'bloomStrength', DEFAULT_BLOOM_STRENGTH);
  const bloomRadius = readConfigNumber(config, 'bloomRadius', DEFAULT_BLOOM_RADIUS);
  const bloomThreshold = readConfigNumber(config, 'bloomThreshold', DEFAULT_BLOOM_THRESHOLD);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), bloomStrength, bloomRadius, bloomThreshold);
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let smaaPass = null;
  const smaaEnabled = readConfigBool(config, 'smaa', true);
  if (smaaEnabled) {
    try {
      smaaPass = new SMAAPass();
      smaaPass.setSize(width, height);
      composer.addPass(smaaPass);
    } catch (err) {
      console.warn('SMAA pass unavailable:', err);
      smaaPass = null;
    }
  }

  return { composer, renderPass, gtaoPass, bloomPass, outputPass, smaaPass };
}

// ---------------------------------------------------------------------------
// Engine plume
// ---------------------------------------------------------------------------

function createPlume(scene) {
  const group = new THREE.Group();
  group.name = 'EffectsPlume';
  group.visible = false;
  scene.add(group);

  const geometry = new THREE.ConeGeometry(PLUME_RADIUS, 1.0, 20, 1, true);
  // Cone points +Y by default; we want it to extend along -Y from the nozzle.
  geometry.translate(0, -0.5, 0);
  geometry.rotateX(Math.PI);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.0 },
      uFlicker: { value: 1.0 },
      uLength: { value: PLUME_LENGTH_MIN },
      uColor: { value: new THREE.Color(0xfff2dd) }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uFlicker;
      uniform float uLength;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vViewPos;
      void main() {
        // vUv.y: 0 at nozzle exit, 1 at plume tip (after geometry flip)
        float axial = clamp(vUv.y, 0.0, 1.0);
        // Radial falloff: brightest at the axis, fading to the cone edge.
        float radial = 1.0 - clamp(abs(vUv.x - 0.5) * 2.0, 0.0, 1.0);
        radial = pow(radial, 1.6);
        // Warm white at the exit, fading to transparent along the plume.
        float axialFade = pow(1.0 - axial, 1.4);
        float flicker = 0.85 + 0.15 * sin(uFlicker * 37.0 + axial * 9.0);
        float alpha = uOpacity * radial * axialFade * flicker;
        vec3 color = uColor * (0.75 + 0.25 * axialFade);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  group.add(mesh);

  const light = new THREE.PointLight(0xffd9a8, 0, PLUME_LIGHT_DISTANCE, 2);
  light.castShadow = false;
  group.add(light);

  return { group, mesh, material, light };
}

// ---------------------------------------------------------------------------
// RCS puffs
// ---------------------------------------------------------------------------

function createRcsPuffs(scene) {
  const maxPuffs = 64;
  const positions = new Float32Array(maxPuffs * 3);
  const sizes = new Float32Array(maxPuffs);
  const alphas = new Float32Array(maxPuffs);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: 1.0 }
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio * (300.0 / max(-mv.z, 0.001));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        float falloff = smoothstep(1.0, 0.0, r);
        float alpha = vAlpha * falloff;
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(vec3(0.95, 0.96, 1.0), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  const life = new Float32Array(maxPuffs);
  const maxLife = new Float32Array(maxPuffs);
  const baseSize = new Float32Array(maxPuffs);
  const active = new Uint8Array(maxPuffs);
  let count = 0;
  let cursor = 0;

  return {
    points,
    material,
    spawn(x, y, z, size) {
      const i = cursor;
      cursor = (cursor + 1) % maxPuffs;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      life[i] = RCS_PUFF_LIFE;
      maxLife[i] = RCS_PUFF_LIFE;
      baseSize[i] = size;
      active[i] = 1;
      if (count < maxPuffs) count++;
    },
    update(dt) {
      let visibleCount = 0;
      for (let i = 0; i < maxPuffs; i++) {
        if (!active[i]) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          active[i] = 0;
          alphas[i] = 0;
          continue;
        }
        const t = 1.0 - life[i] / maxLife[i];
        sizes[i] = baseSize[i] * (1.0 + t * 2.5);
        alphas[i] = (1.0 - t) * 0.85;
        visibleCount++;
      }
      if (visibleCount > 0) {
        points.visible = true;
        geometry.setDrawRange(0, maxPuffs);
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.aSize.needsUpdate = true;
        geometry.attributes.aAlpha.needsUpdate = true;
      } else {
        points.visible = false;
      }
    },
    clear() {
      for (let i = 0; i < maxPuffs; i++) {
        active[i] = 0;
        alphas[i] = 0;
      }
      count = 0;
      cursor = 0;
      points.visible = false;
      geometry.setDrawRange(0, 0);
    },
    setPixelRatio(ratio) {
      material.uniforms.uPixelRatio.value = ratio;
    }
  };
}

// ---------------------------------------------------------------------------
// Dust sheet
// ---------------------------------------------------------------------------

function createDustSheet(scene, ctx, maxParticles) {
  const positions = new Float32Array(maxParticles * 3);
  const velocities = new Float32Array(maxParticles * 3);
  const life = new Float32Array(maxParticles);
  const active = new Uint8Array(maxParticles);
  const sizes = new Float32Array(maxParticles);
  const alphas = new Float32Array(maxParticles);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: 1.0 },
      uColor: { value: new THREE.Color(0x9a958c) }
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio * (300.0 / max(-mv.z, 0.001));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        float falloff = smoothstep(1.0, 0.2, r);
        float alpha = vAlpha * falloff;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  const rand = makeRandom(0x9e3779b9);
  let cursor = 0;
  let aliveCount = 0;
  let emissionAccumulator = 0;
  let emissionRate = 0;

  // Flat ring mesh just above the ground under the nozzle.
  const ringCanvas = document.createElement('canvas');
  ringCanvas.width = 256;
  ringCanvas.height = 256;
  const ringCtx = ringCanvas.getContext('2d');
  const ringTexture = new THREE.CanvasTexture(ringCanvas);
  ringTexture.wrapS = THREE.RepeatWrapping;
  ringTexture.wrapT = THREE.RepeatWrapping;
  ringTexture.needsUpdate = true;

  function drawRingNoise(offset) {
    if (!ringCtx) return;
    const w = ringCanvas.width;
    const h = ringCanvas.height;
    ringCtx.clearRect(0, 0, w, h);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxR = w * 0.5;
    const rand2 = makeRandom(0x51ed270b);
    for (let i = 0; i < 900; i++) {
      const a = rand2() * Math.PI * 2;
      const rr = Math.sqrt(rand2()) * maxR;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      const radial = rr / maxR;
      const alpha = Math.max(0, 1.0 - radial) * (0.15 + rand2() * 0.35);
      const size = 1 + rand2() * 3;
      ringCtx.fillStyle = `rgba(180,176,168,${alpha.toFixed(3)})`;
      ringCtx.fillRect(px + offset * 4, py, size, size);
    }
    ringTexture.needsUpdate = true;
  }
  drawRingNoise(0);

  const ringMaterial = new THREE.MeshBasicMaterial({
    map: ringTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending
  });
  const ringGeometry = new THREE.RingGeometry(0.5, RING_SIZE * 0.5, 48, 1);
  const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
  ringMesh.rotation.x = -Math.PI * 0.5;
  ringMesh.visible = false;
  ringMesh.frustumCulled = false;
  scene.add(ringMesh);

  let ringScroll = 0;
  let ringOpacity = 0;

  function spawnParticle(groundPoint, groundNormal, throttle) {
    const i = cursor;
    cursor = (cursor + 1) % maxParticles;

    const angle = rand() * Math.PI * 2;
    const radius = rand() * DUST_START_RADIUS;
    const ox = Math.cos(angle) * radius;
    const oz = Math.sin(angle) * radius;

    // Place on the ground plane near the impact point.
    const px = groundPoint.x + ox;
    const pz = groundPoint.z + oz;
    const py = ctx.getHeight(px, pz) + 0.05;

    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    // Outward along the ground plane, with a small upward component.
    const speed = DUST_MIN_SPEED + rand() * (DUST_MAX_SPEED - DUST_MIN_SPEED);
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const up = rand() * DUST_MAX_UP;

    velocities[i * 3] = dirX * speed;
    velocities[i * 3 + 1] = up;
    velocities[i * 3 + 2] = dirZ * speed;

    life[i] = 1.0;
    active[i] = 1;
    sizes[i] = 0.35 + rand() * 0.9;
    alphas[i] = 0.0;
    aliveCount++;
  }

  return {
    points,
    material,
    ringMesh,
    ringMaterial,
    ringTexture,
    setPixelRatio(ratio) {
      material.uniforms.uPixelRatio.value = ratio;
    },
    setEmissionRate(rate) {
      emissionRate = rate;
    },
    setRing(groundPoint, groundNormal, throttle, dt) {
      if (groundPoint && throttle > 0) {
        ringMesh.visible = true;
        ringMesh.position.set(groundPoint.x, groundPoint.y + 0.08, groundPoint.z);
        ringOpacity = Math.min(1.0, ringOpacity + dt * 3.0);
        ringScroll += dt * (2.0 + throttle * 6.0);
        ringTexture.offset.set(ringScroll * 0.15, 0);
        ringMaterial.opacity = ringOpacity * 0.55 * throttle;
      } else {
        ringOpacity = Math.max(0.0, ringOpacity - dt * 2.0);
        ringMaterial.opacity = ringOpacity * 0.55;
        if (ringOpacity <= 0.001) ringMesh.visible = false;
      }
    },
    update(dt, groundPoint, groundNormal) {
      // Emit new particles.
      if (emissionRate > 0 && groundPoint) {
        emissionAccumulator += emissionRate * dt;
        const toEmit = Math.floor(emissionAccumulator);
        emissionAccumulator -= toEmit;
        for (let n = 0; n < toEmit; n++) {
          spawnParticle(groundPoint, groundNormal, 1.0);
        }
      }

      // Integrate.
      const g = LUNAR_GRAVITY;
      let anyAlive = false;
      for (let i = 0; i < maxParticles; i++) {
        if (!active[i]) continue;

        const ix = i * 3;
        let vx = velocities[ix];
        let vy = velocities[ix + 1];
        let vz = velocities[ix + 2];

        vy -= g * dt;

        let px = positions[ix] + vx * dt;
        let py = positions[ix + 1] + vy * dt;
        let pz = positions[ix + 2] + vz * dt;

        const h = ctx.getHeight(px, pz);
        if (py < h) {
          // Particle dies below the terrain.
          active[i] = 0;
          alphas[i] = 0;
          aliveCount--;
          continue;
        }

        const distSq = px * px + pz * pz;
        if (distSq > DUST_MAX_RANGE * DUST_MAX_RANGE) {
          active[i] = 0;
          alphas[i] = 0;
          aliveCount--;
          continue;
        }

        positions[ix] = px;
        positions[ix + 1] = py;
        positions[ix + 2] = pz;
        velocities[ix] = vx;
        velocities[ix + 1] = vy;
        velocities[ix + 2] = vz;

        // Fade in quickly, then fade out slowly.
        const age = 1.0 - life[i];
        life[i] = Math.max(0.0, life[i] - dt * 0.12);
        const fadeIn = Math.min(1.0, age * 6.0);
        const fadeOut = Math.min(1.0, life[i] * 1.4);
        alphas[i] = 0.55 * fadeIn * fadeOut;

        anyAlive = true;
      }

      if (anyAlive) {
        points.visible = true;
        geometry.setDrawRange(0, maxParticles);
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.aSize.needsUpdate = true;
        geometry.attributes.aAlpha.needsUpdate = true;
      } else {
        points.visible = false;
      }
    },
    clear() {
      for (let i = 0; i < maxParticles; i++) {
        active[i] = 0;
        alphas[i] = 0;
      }
      cursor = 0;
      aliveCount = 0;
      emissionAccumulator = 0;
      emissionRate = 0;
      points.visible = false;
      geometry.setDrawRange(0, 0);
      ringOpacity = 0;
      ringMaterial.opacity = 0;
      ringMesh.visible = false;
    }
  };
}

// ---------------------------------------------------------------------------
// Crash debris
// ---------------------------------------------------------------------------

function createDebris(scene, ctx) {
  const group = new THREE.Group();
  group.name = 'EffectsDebris';
  scene.add(group);

  const materials = [
    new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.85, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 0.9, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.4, roughness: 0.8 })
  ];

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const plateGeometry = new THREE.BoxGeometry(1, 1, 0.08);

  const fragments = [];
  const rand = makeRandom(0xdeadbeef);

  const flashLight = new THREE.PointLight(0xffb070, 0, CRASH_FLASH_DISTANCE, 2);
  flashLight.castShadow = false;
  flashLight.visible = false;
  scene.add(flashLight);
  let flashLife = 0;

  function spawn(position, velocity) {
    for (let i = 0; i < CRASH_DEBRIS_COUNT; i++) {
      const isPlate = rand() < 0.35;
      const mesh = new THREE.Mesh(isPlate ? plateGeometry : boxGeometry, materials[Math.floor(rand() * materials.length)]);
      const scale = 0.08 + rand() * 0.28;
      mesh.scale.set(scale * (0.6 + rand() * 0.8), scale * (0.6 + rand() * 0.8), scale * (0.6 + rand() * 0.8));
      mesh.position.copy(position);
      mesh.position.x += (rand() - 0.5) * 1.5;
      mesh.position.y += rand() * 1.0;
      mesh.position.z += (rand() - 0.5) * 1.5;
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      const spread = 6.0;
      const vx = velocity.x * 0.6 + (rand() - 0.5) * spread;
      const vy = velocity.y * 0.6 + rand() * spread * 0.8 + 1.0;
      const vz = velocity.z * 0.6 + (rand() - 0.5) * spread;

      fragments.push({
        mesh,
        vx,
        vy,
        vz,
        ax: (rand() - 0.5) * 12,
        ay: (rand() - 0.5) * 12,
        az: (rand() - 0.5) * 12,
        life: DEBRIS_LIFE,
        bounced: false,
        atRest: false
      });
    }

    flashLight.position.copy(position);
    flashLight.position.y += 1.5;
    flashLight.intensity = CRASH_FLASH_INTENSITY;
    flashLight.visible = true;
    flashLife = CRASH_FLASH_LIFE;
  }

  return {
    group,
    spawn,
    update(dt) {
      if (flashLife > 0) {
        flashLife -= dt;
        const t = Math.max(0, flashLife / CRASH_FLASH_LIFE);
        flashLight.intensity = CRASH_FLASH_INTENSITY * t * t;
        if (flashLife <= 0) {
          flashLight.visible = false;
          flashLight.intensity = 0;
        }
      }

      for (let i = fragments.length - 1; i >= 0; i--) {
        const f = fragments[i];
        f.life -= dt;
        if (f.life <= 0) {
          group.remove(f.mesh);
          fragments.splice(i, 1);
          continue;
        }

        if (f.atRest) continue;

        f.vy -= DEBRIS_GRAVITY * dt;

        const p = f.mesh.position;
        p.x += f.vx * dt;
        p.y += f.vy * dt;
        p.z += f.vz * dt;

        f.mesh.rotation.x += f.ax * dt;
        f.mesh.rotation.y += f.ay * dt;
        f.mesh.rotation.z += f.az * dt;

        const h = ctx.getHeight(p.x, p.z);
        if (p.y < h) {
          p.y = h;
          if (!f.bounced) {
            f.bounced = true;
            f.vy = -f.vy * DEBRIS_BOUNCE;
            f.vx *= DEBRIS_FRICTION;
            f.vz *= DEBRIS_FRICTION;
            f.ax *= 0.5;
            f.ay *= 0.5;
            f.az *= 0.5;
          } else {
            f.vx *= 0.85;
            f.vz *= 0.85;
            f.vy = 0;
            if (Math.abs(f.vx) < 0.15 && Math.abs(f.vz) < 0.15) {
              f.atRest = true;
              f.vx = 0;
              f.vz = 0;
            }
          }
        }
      }
    },
    clear() {
      for (const f of fragments) {
        group.remove(f.mesh);
      }
      fragments.length = 0;
      flashLife = 0;
      flashLight.visible = false;
      flashLight.intensity = 0;
    }
  };
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

export function createEffects(renderer, scene, camera, ctx) {
  let activeCamera = camera;
  let composerState = null;
  let composerFailed = false;

  const config = ctx.config;
  const dustMax = Math.max(1, Math.floor(readConfigNumber(config, 'dustMaxParticles', DEFAULT_DUST_MAX)));
  const dustStartAltitude = readConfigNumber(config, 'dustStartAltitude', DEFAULT_DUST_START_ALTITUDE);
  const plumeOpacityBase = readConfigNumber(config, 'plumeOpacity', DEFAULT_PLUME_OPACITY);

  // Build the composer lazily so a failure never stops the game.
  try {
    composerState = buildComposer(renderer, scene, activeCamera, ctx);
  } catch (err) {
    console.warn('Post-processing unavailable, falling back to direct rendering:', err);
    composerState = null;
    composerFailed = true;
  }

  const plume = createPlume(scene);
  const rcs = createRcsPuffs(scene);
  const dust = createDustSheet(scene, ctx, dustMax);
  const debris = createDebris(scene, ctx);

  const pixelRatio = renderer.getPixelRatio();
  rcs.setPixelRatio(pixelRatio);
  dust.setPixelRatio(pixelRatio);

  // Reusable temporaries (never allocate per particle per frame).
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);

  let timeAccumulator = 0;
  let landedPuffPending = false;
  let landedPuffTimer = 0;
  let landedPuffPoint = new THREE.Vector3();
  let landedPuffNormal = new THREE.Vector3();
  let lastThrottle = 0;
  let lastRcsFiring = false;
  let rcsPuffCooldown = 0;

  function updatePlume(state) {
    const throttle = state.throttle || 0;
    if (throttle <= 0.001) {
      plume.group.visible = false;
      plume.light.intensity = 0;
      return;
    }

    plume.group.visible = true;
    plume.group.position.copy(state.nozzleExit);

    // Orient the plume so its local -Y aligns with the exhaust direction.
    tmpVec.copy(state.exhaustDir);
    if (tmpVec.lengthSq() < 1e-8) tmpVec.set(0, -1, 0);
    tmpQuat.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tmpVec);
    plume.group.quaternion.copy(tmpQuat);

    const length = PLUME_LENGTH_MIN + (PLUME_LENGTH_MAX - PLUME_LENGTH_MIN) * throttle;
    plume.mesh.scale.set(1.0, length, 1.0);

    const flicker = 0.85 + 0.15 * Math.sin(timeAccumulator * 31.0 + throttle * 7.0);
    plume.material.uniforms.uOpacity.value = plumeOpacityBase * throttle * flicker;
    plume.material.uniforms.uFlicker.value = timeAccumulator;
    plume.material.uniforms.uLength.value = length;

    // Warm point light 2 m below the nozzle along the exhaust direction.
    tmpVec2.copy(state.exhaustDir).multiplyScalar(PLUME_LIGHT_OFFSET);
    plume.light.position.copy(tmpVec2);
    plume.light.intensity = PLUME_LIGHT_INTENSITY * throttle;
  }

  function updateRcs(state, dt) {
    rcs.update(dt);

    if (!state.rcsFiring) return;

    // Emit puffs at a limited rate while the RCS fires.
    rcsPuffCooldown -= dt;
    if (rcsPuffCooldown <= 0) {
      rcsPuffCooldown = 0.02;
      const quads = state.rcsQuads;
      if (quads && quads.length === 4) {
        for (let i = 0; i < 4; i++) {
          const q = quads[i];
          rcs.spawn(q.x, q.y, q.z, RCS_PUFF_SIZE);
        }
      }
    }
  }

  function updateDust(state, dt) {
    const throttle = state.throttle || 0;
    const ground = state.groundBelowNozzle;

    let emissionRate = 0;
    let groundPoint = null;
    let groundNormal = null;

    if (throttle > 0.001 && ground) {
      const distance = ground.distance;
      if (distance < dustStartAltitude) {
        const factor = 1.0 - distance / dustStartAltitude;
        emissionRate = DUST_EMISSION_BASE * throttle * factor * factor;
        groundPoint = ground.point;
        groundNormal = ground.normal;
      }
    }

    dust.setEmissionRate(emissionRate);
    dust.setRing(groundPoint, groundNormal, throttle, dt);
    dust.update(dt, groundPoint, groundNormal);

    // Touchdown puff: one radial burst from under the lander.
    if (landedPuffPending) {
      landedPuffTimer -= dt;
      if (landedPuffTimer <= 0) {
        landedPuffPending = false;
        dust.setEmissionRate(DUST_EMISSION_BASE * 0.6);
        // Emit a burst over a short window by feeding a large rate for one frame.
        dust.update(0.05, landedPuffPoint, landedPuffNormal);
        dust.setEmissionRate(0);
      }
    }
  }

  function updateDebris(dt) {
    debris.update(dt);
  }

  function renderFallback() {
    renderer.render(scene, activeCamera);
  }

  return {
    setCamera(cam) {
      activeCamera = cam;
      if (composerState) {
        if (composerState.renderPass) composerState.renderPass.camera = cam;
        if (composerState.gtaoPass) composerState.gtaoPass.camera = cam;
      }
    },

    resize(width, height) {
      if (composerState && composerState.composer) {
        composerState.composer.setSize(width, height);
        if (composerState.gtaoPass) composerState.gtaoPass.setSize(width, height);
      }
      const ratio = renderer.getPixelRatio();
      rcs.setPixelRatio(ratio);
      dust.setPixelRatio(ratio);
    },

    update(state) {
      const dt = Math.min(Math.max(state.dt || 0, 0), 0.1);
      timeAccumulator += dt;

      updatePlume(state);
      updateRcs(state, dt);
      updateDust(state, dt);
      updateDebris(dt);

      lastThrottle = state.throttle || 0;
      lastRcsFiring = !!state.rcsFiring;
    },

    render() {
      if (composerState && composerState.composer) {
        try {
          composerState.composer.render();
          return;
        } catch (err) {
          console.warn('Composer render failed, falling back to direct rendering:', err);
          composerState = null;
          composerFailed = true;
        }
      }
      renderFallback();
    },

    event(name, data) {
      switch (name) {
        case 'start':
        case 'restart': {
          dust.clear();
          rcs.clear();
          debris.clear();
          plume.group.visible = false;
          plume.light.intensity = 0;
          landedPuffPending = false;
          landedPuffTimer = 0;
          rcsPuffCooldown = 0;
          break;
        }
        case 'contact': {
          // Contact probes touching down: no extra visuals needed here.
          break;
        }
        case 'landed': {
          // One radial dust puff from under the lander, then no new emission.
          const pos = data && data.position ? data.position : null;
          if (pos) {
            landedPuffPoint.copy(pos);
            landedPuffPoint.y = ctx.getHeight(pos.x, pos.z);
            ctx.getNormal(landedPuffPoint.x, landedPuffPoint.z, landedPuffNormal);
          } else {
            landedPuffPoint.set(0, ctx.getHeight(0, 0), 0);
            ctx.getNormal(0, 0, landedPuffNormal);
          }
          landedPuffPending = true;
          landedPuffTimer = 0.05;
          break;
        }
        case 'crash': {
          const pos = data && data.position ? data.position : new THREE.Vector3();
          const vel = data && data.velocity ? data.velocity : new THREE.Vector3();
          debris.spawn(pos, vel);

          // Dust burst at the impact point.
          tmpVec.copy(pos);
          tmpVec.y = ctx.getHeight(pos.x, pos.z);
          ctx.getNormal(tmpVec.x, tmpVec.z, tmpVec2);
          dust.setEmissionRate(DUST_EMISSION_BASE * 1.5);
          dust.update(0.08, tmpVec, tmpVec2);
          dust.setEmissionRate(0);
          break;
        }
        default:
          break;
      }
    },

    dispose() {
      if (composerState && composerState.composer) {
        composerState.composer.dispose();
        composerState = null;
      }

      plume.group.parent && plume.group.parent.remove(plume.group);
      plume.mesh.geometry.dispose();
      plume.material.dispose();

      rcs.points.parent && rcs.points.parent.remove(rcs.points);
      rcs.points.geometry.dispose();
      rcs.material.dispose();

      dust.points.parent && dust.points.parent.remove(dust.points);
      dust.points.geometry.dispose();
      dust.material.dispose();
      dust.ringMesh.parent && dust.ringMesh.parent.remove(dust.ringMesh);
      dust.ringGeometry && dust.ringGeometry.dispose();
      dust.ringMaterial.dispose();
      dust.ringTexture.dispose();

      debris.group.parent && debris.group.parent.remove(debris.group);
      debris.clear();
    }
  };
}
