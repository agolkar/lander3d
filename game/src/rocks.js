import * as THREE from 'three';
import { loadJSON, loadGLTF } from './assets.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createRocks(scene, config, terrain, csm, manager, seed) {
  const manifest = await loadJSON('assets/rocks/manifest.json');
  let rockPaths = [];
  if (manifest && manifest.rocks) rockPaths = manifest.rocks;

  const templates = [];

  for (const path of rockPaths) {
    const gltf = await loadGLTF(manager, `assets/${path}`);
    if (!gltf) continue;

    let mesh = null;
    gltf.scene.traverse((child) => {
      if (child.isMesh && !mesh) mesh = child;
    });
    if (!mesh) continue;

    const geom = mesh.geometry.clone();
    geom.computeBoundingBox();
    const bbox = geom.boundingBox;
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const height = size.y;
    if (height <= 0) continue;

    const centre = new THREE.Vector3();
    bbox.getCenter(centre);
    geom.translate(-centre.x, -centre.y, -centre.z);
    geom.computeBoundingBox();

    let mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    mat = mat.clone ? mat.clone() : mat;

    templates.push({ geometry: geom, material: mat, height, bboxSize: size });
  }

  if (templates.length === 0) {
    const geom = new THREE.IcosahedronGeometry(0.5, 2);
    const pos = geom.attributes.position;
    const rand = mulberry32(seed);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = 0.7 + 0.3 * rand();
      pos.setXYZ(i, x * n, y * n, z * n);
    }
    geom.computeVertexNormals();
    geom.computeBoundingBox();
    const bbox = geom.boundingBox;
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const centre = new THREE.Vector3();
    bbox.getCenter(centre);
    geom.translate(-centre.x, -centre.y, -centre.z);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.95,
      metalness: 0
    });

    templates.push({ geometry: geom, material: mat, height: size.y, bboxSize: size });
  }

  for (const t of templates) {
    if (csm) csm.setupMaterial(t.material);
    t.material.roughness = 0.95;
    t.material.metalness = 0;
  }

  let instancedMeshes = [];
  let collisionSpheres = [];
  let grid = new Map();
  const CELL = 8;

  function clear() {
    for (const im of instancedMeshes) {
      scene.remove(im);
      im.dispose();
    }
    instancedMeshes = [];
    collisionSpheres = [];
    grid = new Map();
  }

  function scatter(seedValue) {
    clear();

    const rand = mulberry32(seedValue);
    const placements = [];
    const total = 2500;

    for (let i = 0; i < total; i++) {
      let x = 0;
      let z = 0;
      let d = 0;
      let ok = false;
      for (let tries = 0; tries < 20; tries++) {
        x = (rand() * 2 - 1) * 500;
        z = (rand() * 2 - 1) * 500;
        d = Math.hypot(x, z);
        if (d > 500) continue;
        const accept = 1 - d / 500;
        if (rand() < accept) {
          ok = true;
          break;
        }
      }
      if (!ok) continue;

      const size = 0.15 * Math.pow(20, rand());
      if (size > 0.3 && d < 30) continue;

      const type = Math.floor(rand() * templates.length);
      placements.push({
        x,
        z,
        size,
        type,
        rotation: rand() * Math.PI * 2,
        burial: 0.2 + 0.15 * rand()
      });
    }

    const craters = terrain.getCraters();
    const fresh = craters.filter((c) => c.age < 0.3 && c.radius > 5);

    for (let i = 0; i < 40 && fresh.length > 0; i++) {
      const c = fresh[Math.floor(rand() * fresh.length)];
      const a = rand() * Math.PI * 2;
      const r = c.radius * (1.0 + rand() * 0.5);
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const d = Math.hypot(x, z);
      if (d < 30) continue;
      if (Math.abs(x) > 1000 || Math.abs(z) > 1000) continue;

      const size = 3 + 2 * rand();
      const type = Math.floor(rand() * templates.length);
      placements.push({
        x,
        z,
        size,
        type,
        rotation: rand() * Math.PI * 2,
        burial: 0.2 + 0.15 * rand()
      });
    }

    const counts = templates.map(() => 0);
    for (const p of placements) counts[p.type]++;

    const dummy = new THREE.Object3D();
    const meshes = templates.map((t, ti) => {
      if (counts[ti] === 0) return null;
      const im = new THREE.InstancedMesh(t.geometry, t.material, counts[ti]);
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      instancedMeshes.push(im);
      return im;
    });

    const indices = templates.map(() => 0);

    for (const p of placements) {
      const t = templates[p.type];
      const im = meshes[p.type];
      if (!im) continue;

      const idx = indices[p.type]++;
      const ground = terrain.getHeight(p.x, p.z);
      const scale = p.size / t.height;
      const y = ground + p.size * (0.5 - p.burial);

      dummy.position.set(p.x, y, p.z);
      dummy.rotation.set(0, p.rotation, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      im.setMatrixAt(idx, dummy.matrix);

      if (p.size > 0.4) {
        const sphere = {
          centre: new THREE.Vector3(p.x, y, p.z),
          radius: p.size * 0.5,
          size: p.size
        };
        collisionSpheres.push(sphere);
        const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(sphere);
      }
    }

    for (const im of meshes) {
      if (im) im.instanceMatrix.needsUpdate = true;
    }
  }

  function rockCollision(point) {
    const cx = Math.floor(point.x / CELL);
    const cz = Math.floor(point.z / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const arr = grid.get(`${ix},${iz}`);
        if (!arr) continue;
        for (const s of arr) {
          const dx = point.x - s.centre.x;
          const dy = point.y - s.centre.y;
          const dz = point.z - s.centre.z;
          if (dx * dx + dy * dy + dz * dz < s.radius * s.radius) return s;
        }
      }
    }
    return null;
  }

  scatter(seed);

  return {
    regenerate(newSeed) {
      scatter(newSeed);
    },
    rockCollision,
    dispose() {
      clear();
    }
  };
}
