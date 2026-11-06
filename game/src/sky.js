import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { loadTexture, loadEXR } from './assets.js';

export async function createSky(scene, camera, config, quality, manager, renderer) {
  const shadowMapSize = quality === 'high' ? 4096 : 2048;

  const el = config.SUN_ELEVATION_DEG * Math.PI / 180;
  const az = config.SUN_AZIMUTH_DEG * Math.PI / 180;
  const sunDir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el)
  );
  const lightDirection = sunDir.clone().negate();

  const csm = new CSM({
    maxFar: 1500,
    cascades: 4,
    mode: 'practical',
    parent: scene,
    shadowMapSize,
    lightDirection,
    lightIntensity: config.SUN_INTENSITY,
    camera,
    lightMargin: 300
  });
  csm.lights.forEach((l) => l.color.set(0xffffff));

  const hemi = new THREE.HemisphereLight(0x223344, 0x000000, 0.02);
  scene.add(hemi);

  const starTex = await loadEXR(manager, 'assets/sky/starmap_4k.exr');
  if (starTex) {
    starTex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = starTex;
    scene.backgroundIntensity = config.STAR_INTENSITY;
  } else {
    scene.background = new THREE.Color(0x000000);
    scene.backgroundIntensity = 0;
  }

  let starsOn = false;
  function setStars(on) {
    starsOn = on;
    if (starTex) scene.backgroundIntensity = on ? 0.6 : 0;
  }
  function toggleStars() {
    setStars(!starsOn);
  }

  const earthTex = await loadTexture(manager, 'assets/sky/earth_bluemarble.jpg', THREE.SRGBColorSpace);
  const earthRadius = 249;
  const earthDist = 15000;
  const earthEl = 35 * Math.PI / 180;
  const earthAz = 25 * Math.PI / 180;
  const earthDir = new THREE.Vector3(
    Math.sin(earthAz) * Math.cos(earthEl),
    Math.sin(earthEl),
    Math.cos(earthAz) * Math.cos(earthEl)
  );

  const earthMat = new THREE.MeshStandardMaterial({
    map: earthTex || null,
    color: earthTex ? 0xffffff : 0x3366aa,
    roughness: 0.8,
    metalness: 0
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(earthRadius, 64, 32), earthMat);
  earth.position.copy(earthDir.multiplyScalar(earthDist));
  earth.castShadow = false;
  earth.receiveShadow = false;
  scene.add(earth);

  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float f = pow(1.0 - abs(dot(vNormal, vViewDir)), 3.0);
        gl_FragColor = vec4(0.4, 0.7, 1.0, f * 0.2);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(earthRadius * 1.02, 64, 32), atmoMat);
  atmo.position.copy(earth.position);
  scene.add(atmo);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const envSphereMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vWorldNormal;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldNormal;
      void main() {
        float t = smoothstep(-0.05, 0.05, vWorldNormal.y);
        vec3 col = mix(vec3(0.1), vec3(0.0), t);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide
  });
  const envSphere = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envSphereMat);
  envScene.add(envSphere);

  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(4, 16, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 8, 8) })
  );
  sunDisc.position.copy(sunDir).multiplyScalar(60);
  envScene.add(sunDisc);

  const envMap = pmrem.fromScene(envScene, 0.1).texture;
  scene.environment = envMap;
  pmrem.dispose();

  envScene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      if (o.material.dispose) o.material.dispose();
    }
  });

  return { csm, earth, toggleStars, setStars, sunDir, lightDirection };
}
