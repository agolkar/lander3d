import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

export function createLoadingManager(onProgress, onError) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => {
    if (onProgress) onProgress(loaded, total);
  };
  manager.onError = (url) => {
    console.warn('Asset failed:', url);
    if (onError) onError(url);
  };
  return manager;
}

export function loadTexture(manager, url, colorSpace = THREE.NoColorSpace, repeat = null) {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader(manager);
    loader.load(url, (tex) => {
      tex.colorSpace = colorSpace;
      if (repeat) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
      }
      tex.anisotropy = 4;
      resolve(tex);
    }, undefined, (err) => {
      console.warn('Texture missing:', url, err);
      resolve(null);
    });
  });
}

export function loadGLTF(manager, url) {
  return new Promise((resolve) => {
    const loader = new GLTFLoader(manager);
    loader.load(url, (gltf) => resolve(gltf), undefined, (err) => {
      console.warn('GLTF missing:', url, err);
      resolve(null);
    });
  });
}

export function loadEXR(manager, url) {
  return new Promise((resolve) => {
    const loader = new EXRLoader(manager);
    loader.load(url, (tex) => resolve(tex), undefined, (err) => {
      console.warn('EXR missing:', url, err);
      resolve(null);
    });
  });
}

export function loadJSON(url) {
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .catch((err) => {
      console.warn('JSON missing:', url, err);
      return null;
    });
}
