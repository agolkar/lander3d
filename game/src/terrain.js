import * as THREE from 'three';
import { loadTexture } from './assets.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise2D(rand) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function hash(x, y) {
    return perm[(perm[x & 255] + (y & 255)) & 511] / 255;
  }

  return function (x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  };
}

function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

function cloneTexture(tex, repeat) {
  if (!tex) return null;
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

function applyRegolithPatch(material, texB) {
  const patch = (shader) => {
    shader.uniforms.uMapB = { value: texB };
    shader.uniforms.uBScale = { value: 0.44 };
    shader.uniforms.uMaskScale = { value: 0.06 };
    shader.uniforms.uBBlend = { value: 0.6 };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform sampler2D uMapB;
       uniform float uBScale;
       uniform float uMaskScale;
       uniform float uBBlend;
       float hash12(vec2 p) {
         vec3 p3 = fract(vec3(p.xyx) * 0.1031);
         p3 += dot(p3, p3.yzx + 33.33);
         return fract((p3.x + p3.y) * p3.z);
       }
       float noise12(vec2 p) {
         vec2 i = floor(p);
         vec2 f = fract(p);
         f = f * f * (3.0 - 2.0 * f);
         float a = hash12(i);
         float b = hash12(i + vec2(1.0, 0.0));
         float c = hash12(i + vec2(0.0, 1.0));
         float d = hash12(i + vec2(1.0, 1.0));
         return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
       }`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        vec2 uvB = vec2(
          vMapUv.x * 0.7986355 - vMapUv.y * 0.6018150,
          vMapUv.x * 0.6018150 + vMapUv.y * 0.7986355
        ) * uBScale;
        vec3 colB = texture2D(uMapB, uvB).rgb;
        float mask = noise12(vMapUv * uMaskScale);
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, colB, mask * uBBlend);
        diffuseColor *= sampledDiffuseColor;
      #endif`
    );
  };

  material.onBeforeCompile = patch;
  material.userData.regolithPatch = patch;
  material.customProgramCacheKey = () => 'regolith';
}

export function setupCSMForMaterial(material, csm) {
  if (!csm) return;
  csm.setupMaterial(material);
  const csmPatch = material.onBeforeCompile;
  const regolithPatch = material.userData.regolithPatch;
  if (regolithPatch) {
    material.onBeforeCompile = (shader, renderer) => {
      if (csmPatch) csmPatch(shader, renderer);
      regolithPatch(shader);
    };
    material.customProgramCacheKey = () => 'csm-regolith';
  }
}

// Near terrain fades into the far terrain between these radii (m); the far ring starts at FAR_RING_START,
// slightly lowered where it overlaps the near square so the near surface always wins (no flicker).
const NEAR_BLEND_START = 840;
const NEAR_BLEND_END = 980;
const FAR_RING_START = 1000;
const FAR_RING_OVERLAP_END = 1460;
const FAR_RING_DROP = 0.6;

function farRingHeight(farHeight, x, z) {
  const r = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (r - FAR_RING_START) / (FAR_RING_OVERLAP_END - FAR_RING_START)));
  return farHeight(x, z) - FAR_RING_DROP * (1 - t);
}

export async function createTerrain(scene, config, seed, quality, manager) {
  const segments = quality === 'medium' ? config.TERRAIN_SEGMENTS_MEDIUM : config.TERRAIN_SEGMENTS;
  const size = config.TERRAIN_SIZE;
  const half = size / 2;
  const cell = size / segments;
  const heights = new Float32Array((segments + 1) * (segments + 1));

  const macroSize = 256;
  const macroCell = size / macroSize;
  const macroGrid = new Float32Array(macroSize * macroSize);

  let craters = [];
  let rand;
  let noise2D;

  function initNoise(seedValue) {
    rand = mulberry32(seedValue);
    noise2D = makeNoise2D(rand);
  }

  function fbm(x, z, amp, wavelength, octaves) {
    let sum = 0;
    let a = amp;
    let f = 1 / wavelength;
    for (let i = 0; i < octaves; i++) {
      sum += a * noise2D(x * f, z * f);
      a *= 0.5;
      f *= 2;
    }
    return sum;
  }

  function baseFbm(x, z) {
    return fbm(x, z, 6, 300, 4);
  }

  function fineFbm(x, z) {
    return fbm(x, z, 0.25, 8, 3);
  }

  function farHeight(x, z) {
    const d2 = x * x + z * z;
    return baseFbm(x, z) - d2 / (2 * 1737400);
  }

  function buildHeights(seedValue) {
    initNoise(seedValue);
    craters = [];
    macroGrid.fill(1.0);

    for (let iz = 0; iz <= segments; iz++) {
      const z = -half + iz * cell;
      for (let ix = 0; ix <= segments; ix++) {
        const x = -half + ix * cell;
        heights[iz * (segments + 1) + ix] = baseFbm(x, z) + fineFbm(x, z);
      }
    }

    for (let i = 0; i < config.CRATER_COUNT; i++) {
      const D = config.CRATER_MIN_D + (config.CRATER_MAX_D - config.CRATER_MIN_D) * Math.pow(rand(), 2.5);
      const radius = D / 2;
      const age = rand();
      const depth = D * (0.08 + 0.12 * (1 - age));
      const rim = 0.25 * depth;
      const cx = (rand() * 2 - 1) * half;
      const cz = (rand() * 2 - 1) * half;
      const distToTarget = Math.hypot(cx, cz);

      if (distToTarget < 3 * radius + 30) continue;

      craters.push({ x: cx, z: cz, radius, depth, rim, age });

      const extent = 3 * radius;
      const ix0 = Math.max(0, Math.floor((cx - extent + half) / cell));
      const ix1 = Math.min(segments, Math.ceil((cx + extent + half) / cell));
      const iz0 = Math.max(0, Math.floor((cz - extent + half) / cell));
      const iz1 = Math.min(segments, Math.ceil((cz + extent + half) / cell));

      for (let iz = iz0; iz <= iz1; iz++) {
        const z = -half + iz * cell;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = -half + ix * cell;
          const dx = x - cx;
          const dz = z - cz;
          const r = Math.hypot(dx, dz) / radius;
          if (r >= 3) continue;
          let h;
          if (r < 1) h = -depth + (depth + rim) * r * r;
          else h = rim * Math.pow(r, -3);
          heights[iz * (segments + 1) + ix] += h;
        }
      }

      if (age < 0.3) {
        const mExtent = 2.5 * radius;
        const mx0 = Math.max(0, Math.floor((cx - mExtent + half) / macroCell));
        const mx1 = Math.min(macroSize - 1, Math.ceil((cx + mExtent + half) / macroCell));
        const mz0 = Math.max(0, Math.floor((cz - mExtent + half) / macroCell));
        const mz1 = Math.min(macroSize - 1, Math.ceil((cz + mExtent + half) / macroCell));
        for (let mz = mz0; mz <= mz1; mz++) {
          const z = -half + (mz + 0.5) * macroCell;
          for (let mx = mx0; mx <= mx1; mx++) {
            const x = -half + (mx + 0.5) * macroCell;
            const r = Math.hypot(x - cx, z - cz) / radius;
            if (r < 1 || r > 2.5) continue;
            const bright = 0.15 * (1 - (r - 1) / 1.5);
            macroGrid[mz * macroSize + mx] += bright;
          }
        }
      }
    }

    for (let mz = 0; mz < macroSize; mz++) {
      const z = -half + (mz + 0.5) * macroCell;
      for (let mx = 0; mx < macroSize; mx++) {
        const x = -half + (mx + 0.5) * macroCell;
        const n = noise2D(x / 200, z / 200);
        macroGrid[mz * macroSize + mx] *= 0.85 + 0.15 * (n * 0.5 + 0.5);
      }
    }

    let sum = 0;
    let count = 0;
    const flatR = config.SITE_FLAT_RADIUS;
    const blendR = config.SITE_BLEND_RADIUS;

    for (let iz = 0; iz <= segments; iz++) {
      const z = -half + iz * cell;
      for (let ix = 0; ix <= segments; ix++) {
        const x = -half + ix * cell;
        if (Math.hypot(x, z) <= flatR) {
          sum += heights[iz * (segments + 1) + ix];
          count++;
        }
      }
    }

    const mean = count > 0 ? sum / count : 0;

    for (let iz = 0; iz <= segments; iz++) {
      const z = -half + iz * cell;
      for (let ix = 0; ix <= segments; ix++) {
        const x = -half + ix * cell;
        const d = Math.hypot(x, z);
        if (d < blendR) {
          const t = d <= flatR ? 0 : smoothstep((d - flatR) / (blendR - flatR));
          heights[iz * (segments + 1) + ix] = mean * (1 - t) + heights[iz * (segments + 1) + ix] * t;
        }
      }
    }

    // Radial blend into the far terrain: from NEAR_BLEND_START outward the near grid fades to farHeight,
    // and beyond NEAR_BLEND_END it equals it, so the far ring (which starts inside the square) meets it cleanly.
    for (let iz = 0; iz <= segments; iz++) {
      const z = -half + iz * cell;
      for (let ix = 0; ix <= segments; ix++) {
        const x = -half + ix * cell;
        const d = Math.hypot(x, z);
        if (d > NEAR_BLEND_START) {
          const t = smoothstep((d - NEAR_BLEND_START) / (NEAR_BLEND_END - NEAR_BLEND_START));
          const fh = farHeight(x, z);
          heights[iz * (segments + 1) + ix] = heights[iz * (segments + 1) + ix] * (1 - t) + fh * t;
        }
      }
    }
  }

  function getHeight(x, z) {
    if (x < -half || x > half || z < -half || z > half) {
      return farHeight(x, z);
    }
    const gx = (x + half) / cell;
    const gz = (z + half) / cell;
    const ix = Math.min(segments - 1, Math.max(0, Math.floor(gx)));
    const iz = Math.min(segments - 1, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - ix));
    const fz = Math.min(1, Math.max(0, gz - iz));
    const i00 = iz * (segments + 1) + ix;
    const i10 = i00 + 1;
    const i01 = i00 + (segments + 1);
    const i11 = i01 + 1;
    const h00 = heights[i00];
    const h10 = heights[i10];
    const h01 = heights[i01];
    const h11 = heights[i11];
    return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
  }

  function getNormal(x, z, target) {
    const eps = 1.0;
    const hL = getHeight(x - eps, z);
    const hR = getHeight(x + eps, z);
    const hD = getHeight(x, z - eps);
    const hU = getHeight(x, z + eps);
    const nx = -(hR - hL) / (2 * eps);
    const nz = -(hU - hD) / (2 * eps);
    target.set(nx, 1, nz).normalize();
    return target;
  }

  function sampleMacro(x, z) {
    const gx = (x + half) / macroCell;
    const gz = (z + half) / macroCell;
    // clamp to size - 2 so the +1 neighbours stay inside the grid (reading past the end gave NaN colours)
    const ix = Math.min(macroSize - 2, Math.max(0, Math.floor(gx)));
    const iz = Math.min(macroSize - 2, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - ix));
    const fz = Math.min(1, Math.max(0, gz - iz));
    const i00 = iz * macroSize + ix;
    const i10 = i00 + 1;
    const i01 = i00 + macroSize;
    const i11 = i01 + 1;
    return macroGrid[i00] * (1 - fx) * (1 - fz)
      + macroGrid[i10] * fx * (1 - fz)
      + macroGrid[i01] * (1 - fx) * fz
      + macroGrid[i11] * fx * fz;
  }

  const diffA = await loadTexture(manager, 'assets/textures/regolith_a_diff.jpg', THREE.SRGBColorSpace, 1);
  const norA = await loadTexture(manager, 'assets/textures/regolith_a_nor_gl.jpg', THREE.NoColorSpace, 1);
  const roughA = await loadTexture(manager, 'assets/textures/regolith_a_rough.jpg', THREE.NoColorSpace, 1);
  const dispA = await loadTexture(manager, 'assets/textures/regolith_a_disp.jpg', THREE.NoColorSpace, 1);
  const diffB = await loadTexture(manager, 'assets/textures/regolith_b_diff.jpg', THREE.SRGBColorSpace, 1);
  const norB = await loadTexture(manager, 'assets/textures/regolith_b_nor_gl.jpg', THREE.NoColorSpace, 1);
  const roughB = await loadTexture(manager, 'assets/textures/regolith_b_rough.jpg', THREE.NoColorSpace, 1);
  const dispB = await loadTexture(manager, 'assets/textures/regolith_b_disp.jpg', THREE.NoColorSpace, 1);

  buildHeights(seed);

  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const posAttr = geometry.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, getHeight(x, z));
    const m = sampleMacro(x, z);
    colors[i * 3] = m;
    colors[i * 3 + 1] = m;
    colors[i * 3 + 2] = m;
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const tint = new THREE.Color(config.REGOLITH_TINT);
  let material;

  if (diffA) {
    diffA.wrapS = diffA.wrapT = THREE.RepeatWrapping;
    diffA.repeat.set(size / 3.2, size / 3.2);
    if (norA) {
      norA.wrapS = norA.wrapT = THREE.RepeatWrapping;
      norA.repeat.copy(diffA.repeat);
    }
    if (roughA) {
      roughA.wrapS = roughA.wrapT = THREE.RepeatWrapping;
      roughA.repeat.copy(diffA.repeat);
    }
    if (dispA) {
      dispA.wrapS = dispA.wrapT = THREE.RepeatWrapping;
      dispA.repeat.copy(diffA.repeat);
    }

    material = new THREE.MeshStandardMaterial({
      map: diffA,
      normalMap: norA || null,
      roughnessMap: roughA || null,
      displacementMap: dispA || null,
      displacementScale: 0.02,
      color: tint,
      vertexColors: true,
      metalness: 0,
      roughness: 1
    });

    if (diffB) applyRegolithPatch(material, diffB);
  } else {
    material = new THREE.MeshStandardMaterial({
      color: tint,
      vertexColors: true,
      metalness: 0,
      roughness: 1
    });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);

  let farMaterial;
  if (diffA) {
    farMaterial = new THREE.MeshStandardMaterial({
      map: cloneTexture(diffA, 0.25),
      normalMap: cloneTexture(norA, 0.25),
      roughnessMap: cloneTexture(roughA, 0.25),
      displacementMap: null,
      color: tint,
      vertexColors: false,
      metalness: 0,
      roughness: 1
    });
    if (diffB) applyRegolithPatch(farMaterial, diffB);
  } else {
    farMaterial = new THREE.MeshStandardMaterial({
      color: tint,
      metalness: 0,
      roughness: 1
    });
  }

  const radialSegments = 64;
  const angularSegments = 256;
  const rMin = FAR_RING_START;
  const rMax = config.FAR_RADIUS;
  const farPositions = [];
  const farUvs = [];
  const farIndices = [];

  for (let i = 0; i < radialSegments; i++) {
    const t = i / (radialSegments - 1);
    const r = rMin * Math.pow(rMax / rMin, t);
    for (let j = 0; j < angularSegments; j++) {
      const a = (j / angularSegments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = farRingHeight(farHeight, x, z);
      farPositions.push(x, y, z);
      farUvs.push(x / 3.2, z / 3.2);
    }
  }

  for (let i = 0; i < radialSegments - 1; i++) {
    for (let j = 0; j < angularSegments; j++) {
      const j1 = (j + 1) % angularSegments;
      const a = i * angularSegments + j;
      const b = i * angularSegments + j1;
      const c = (i + 1) * angularSegments + j;
      const d = (i + 1) * angularSegments + j1;
      farIndices.push(a, b, c, b, d, c); // counter-clockwise seen from above, so the faces point up
    }
  }

  const farGeometry = new THREE.BufferGeometry();
  farGeometry.setAttribute('position', new THREE.Float32BufferAttribute(farPositions, 3));
  farGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(farUvs, 2));
  farGeometry.setIndex(farIndices);
  farGeometry.computeVertexNormals();

  const farMesh = new THREE.Mesh(farGeometry, farMaterial);
  farMesh.receiveShadow = true;
  farMesh.castShadow = false;
  scene.add(farMesh);

  function regenerate(newSeed) {
    buildHeights(newSeed);

    const pos = geometry.attributes.position;
    const col = geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getHeight(x, z));
      const m = sampleMacro(x, z);
      col.setXYZ(i, m, m, m);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.computeVertexNormals();

    const farPos = farGeometry.attributes.position;
    for (let i = 0; i < farPos.count; i++) {
      const x = farPos.getX(i);
      const z = farPos.getZ(i);
      farPos.setY(i, farRingHeight(farHeight, x, z));
    }
    farPos.needsUpdate = true;
    farGeometry.computeVertexNormals();
  }

  return {
    getHeight,
    getNormal,
    getCraters: () => craters,
    regenerate,
    material,
    farMaterial,
    mesh,
    farMesh,
    heights
  };
}
