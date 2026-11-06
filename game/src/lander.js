import * as THREE from 'three';
import { loadGLTF } from './assets.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function buildProceduralLander() {
  const root = new THREE.Group();
  root.name = 'Lander';

  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.2 });
  const foilMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.8 });

  const descent = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 4), mat);
  descent.name = 'DescentStage';
  descent.position.set(0, 2.0, 0);
  root.add(descent);

  const ascent = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 3.2), foilMat);
  ascent.name = 'AscentStage';
  ascent.position.set(0, 4.5, 0);
  root.add(ascent);

  const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 1.0, 16), mat);
  engine.name = 'EngineBell';
  engine.position.set(0, 1.5, 0);
  root.add(engine);

  const nozzle = new THREE.Object3D();
  nozzle.name = 'NozzleExit';
  nozzle.position.set(0, 1.05, 0);
  root.add(nozzle);

  const cockpit = new THREE.Object3D();
  cockpit.name = 'CockpitEye';
  cockpit.position.set(0, 4.8, 1.6);
  root.add(cockpit);

  const footpadPositions = {
    Front: new THREE.Vector3(0, 0, 2.8),
    Back: new THREE.Vector3(0, 0, -2.8),
    Left: new THREE.Vector3(2.8, 0, 0),
    Right: new THREE.Vector3(-2.8, 0, 0)
  };

  for (const [name, pos] of Object.entries(footpadPositions)) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.0, 8), mat);
    leg.name = `Leg_${name}`;

    const start = new THREE.Vector3(pos.x * 0.7, 3.0, pos.z * 0.7);
    const end = pos.clone();
    const mid = start.clone().add(end).multiplyScalar(0.5);
    leg.position.copy(mid);

    const dir = end.clone().sub(start).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    leg.quaternion.copy(q);
    leg.scale.y = start.distanceTo(end) / 3.0;
    root.add(leg);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16), mat);
    pad.name = `Footpad_${name}`;
    pad.position.copy(pos);
    pad.position.y = 0.05;
    root.add(pad);

    const contact = new THREE.Object3D();
    contact.name = `FootpadContact_${name}`;
    contact.position.copy(pos);
    root.add(contact);
  }

  const probePositions = {
    Back: new THREE.Vector3(0, -1.5, -2.8),
    Left: new THREE.Vector3(2.8, -1.5, 0),
    Right: new THREE.Vector3(-2.8, -1.5, 0)
  };

  for (const [name, pos] of Object.entries(probePositions)) {
    const probeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), mat);
    probeMesh.position.copy(pos);
    probeMesh.position.y = -0.75;
    root.add(probeMesh);

    const tip = new THREE.Object3D();
    tip.name = `ProbeTip_${name}`;
    tip.position.copy(pos);
    root.add(tip);
  }

  const rcsPositions = [
    new THREE.Vector3(1.8, 4.5, 1.8),
    new THREE.Vector3(-1.8, 4.5, 1.8),
    new THREE.Vector3(1.8, 4.5, -1.8),
    new THREE.Vector3(-1.8, 4.5, -1.8)
  ];

  rcsPositions.forEach((pos, i) => {
    const quad = new THREE.Object3D();
    quad.name = `RCS_Quad_${i + 1}`;
    quad.position.copy(pos);
    root.add(quad);
  });

  root.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return root;
}

function computeLocalBox(node, root) {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  node.traverse((child) => {
    if (child.isMesh) {
      child.updateMatrixWorld(true);
      const geom = child.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      const b = geom.boundingBox.clone();
      const m = new THREE.Matrix4().multiplyMatrices(rootInv, child.matrixWorld);
      b.applyMatrix4(m);
      box.union(b);
    }
  });

  return box;
}

const fallbackPositions = {
  DescentStage: new THREE.Vector3(0, 2.0, 0),
  AscentStage: new THREE.Vector3(0, 4.5, 0),
  EngineBell: new THREE.Vector3(0, 1.5, 0),
  Leg_Front: new THREE.Vector3(0, 1.5, 2.8),
  Leg_Back: new THREE.Vector3(0, 1.5, -2.8),
  Leg_Left: new THREE.Vector3(2.8, 1.5, 0),
  Leg_Right: new THREE.Vector3(-2.8, 1.5, 0),
  FootpadContact_Front: new THREE.Vector3(0, 0, 2.8),
  FootpadContact_Back: new THREE.Vector3(0, 0, -2.8),
  FootpadContact_Left: new THREE.Vector3(2.8, 0, 0),
  FootpadContact_Right: new THREE.Vector3(-2.8, 0, 0),
  ProbeTip_Back: new THREE.Vector3(0, -1.5, -2.8),
  ProbeTip_Left: new THREE.Vector3(2.8, -1.5, 0),
  ProbeTip_Right: new THREE.Vector3(-2.8, -1.5, 0),
  NozzleExit: new THREE.Vector3(0, 1.05, 0),
  CockpitEye: new THREE.Vector3(0, 4.8, 1.6),
  RCS_Quad_1: new THREE.Vector3(1.8, 4.5, 1.8),
  RCS_Quad_2: new THREE.Vector3(-1.8, 4.5, 1.8),
  RCS_Quad_3: new THREE.Vector3(1.8, 4.5, -1.8),
  RCS_Quad_4: new THREE.Vector3(-1.8, 4.5, -1.8)
};

export async function createLander(scene, config, csm, manager) {
  const gltf = await loadGLTF(manager, 'assets/models/lander.glb');
  let root;

  if (gltf) {
    root = gltf.scene;
    root.name = 'Lander';
  } else {
    console.warn('lander.glb missing, using procedural stand-in');
    root = buildProceduralLander();
  }

  root.position.set(0, 0, 0);
  root.quaternion.identity();
  scene.add(root);

  root.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (csm) csm.setupMaterial(m);
      }
    }
  });

  const nodeNames = [
    'Lander',
    'DescentStage',
    'AscentStage',
    'EngineBell',
    'Leg_Front',
    'Leg_Back',
    'Leg_Left',
    'Leg_Right',
    'FootpadContact_Front',
    'FootpadContact_Back',
    'FootpadContact_Left',
    'FootpadContact_Right',
    'ProbeTip_Back',
    'ProbeTip_Left',
    'ProbeTip_Right',
    'NozzleExit',
    'CockpitEye',
    'RCS_Quad_1',
    'RCS_Quad_2',
    'RCS_Quad_3',
    'RCS_Quad_4'
  ];

  const nodes = {};

  for (const name of nodeNames) {
    let node = root.getObjectByName(name);
    if (!node) {
      console.warn('Missing lander node:', name);
      node = new THREE.Object3D();
      node.name = name;
      const fallback = fallbackPositions[name] || new THREE.Vector3();
      node.position.copy(fallback);
      root.add(node);
    }
    nodes[name] = node;
  }

  root.updateMatrixWorld(true);
  const localPositions = {};

  for (const name of nodeNames) {
    const p = new THREE.Vector3();
    nodes[name].getWorldPosition(p);
    root.worldToLocal(p);
    localPositions[name] = p;
  }

  const descent = nodes.DescentStage;
  const box = computeLocalBox(descent, root);

  const hullPoints = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    localPositions.NozzleExit.clone()
  ];

  const footpadNames = [
    'FootpadContact_Front',
    'FootpadContact_Back',
    'FootpadContact_Left',
    'FootpadContact_Right'
  ];
  const footpads = footpadNames.map((n) => localPositions[n]);

  const probeNames = ['ProbeTip_Back', 'ProbeTip_Left', 'ProbeTip_Right'];
  const probes = probeNames.map((n) => localPositions[n]);

  const rcsQuads = ['RCS_Quad_1', 'RCS_Quad_2', 'RCS_Quad_3', 'RCS_Quad_4'].map((n) => localPositions[n]);

  const cockpitEye = localPositions.CockpitEye;
  const nozzleExit = localPositions.NozzleExit;

  const state = {
    phase: 'READY',
    time: 0,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    angularVelocity: new THREE.Vector3(),
    fuelKg: config.FUEL_START,
    rcsFuelKg: config.RCS_FUEL_START,
    throttle: 0,
    contactLight: false,
    rcsCommand: { pitch: 0, roll: 0, yaw: 0 },
    rcsFiring: false,
    thrustNewtons: 0,
    lastThrottle: 0,
    crashReason: null
  };

  const RCS_MAX_RATE = config.RCS_MAX_RATE_DEG * DEG2RAD;
  const RCS_ACCEL = config.RCS_ACCEL_DEG * DEG2RAD;

  function reset() {
    state.phase = 'READY';
    state.time = 0;
    state.position.set(0, 450, -700);
    state.velocity.set(0, -10, 18);
    state.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -35 * DEG2RAD);
    state.angularVelocity.set(0, 0, 0);
    state.fuelKg = config.FUEL_START;
    state.rcsFuelKg = config.RCS_FUEL_START;
    state.throttle = 0;
    state.contactLight = false;
    state.rcsCommand = { pitch: 0, roll: 0, yaw: 0 };
    state.rcsFiring = false;
    state.thrustNewtons = 0;
    state.lastThrottle = 0;
    state.crashReason = null;
    root.visible = true;
    root.position.copy(state.position);
    root.quaternion.copy(state.quaternion);
  }

  function start() {
    if (state.phase !== 'READY') return false;
    state.phase = 'FLYING';
    state.time = 0;
    return true;
  }

  function moveTowards(current, target, maxDelta) {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  }

  function fuelSecondsAtHover() {
    const mass = config.DRY_MASS + state.fuelKg;
    const hoverThrust = mass * config.GRAVITY;
    const massFlow = hoverThrust / (config.ISP * config.G0);
    return state.fuelKg / massFlow;
  }

  function step(dt, input, terrain, rocks, events) {
    if (state.phase !== 'FLYING') return;
    state.time += dt;

    if (state.fuelKg > 0) {
      if (input.throttleUp) {
        if (state.throttle <= 0) state.throttle = config.MIN_THROTTLE;
        else state.throttle = Math.min(1, state.throttle + config.THROTTLE_RATE * dt);
      }
      if (input.throttleDown) {
        state.throttle -= config.THROTTLE_RATE * dt;
        if (state.throttle < config.MIN_THROTTLE) state.throttle = 0;
      }
      if (input.cutoff) state.throttle = 0;
    } else {
      state.throttle = 0;
    }

    const cmd = input.rcsCommand;
    state.rcsCommand = { pitch: cmd.pitch, roll: cmd.roll, yaw: cmd.yaw };

    const targetAngular = new THREE.Vector3(
      cmd.pitch * RCS_MAX_RATE,
      cmd.yaw * RCS_MAX_RATE,
      cmd.roll * RCS_MAX_RATE
    );

    let acceleratingAxes = 0;
    if (state.rcsFuelKg > 0) {
      const av = state.angularVelocity;
      const eps = 1e-4;
      for (let i = 0; i < 3; i++) {
        const diff = targetAngular.getComponent(i) - av.getComponent(i);
        if (Math.abs(diff) > eps) acceleratingAxes++;
        const newVal = moveTowards(av.getComponent(i), targetAngular.getComponent(i), RCS_ACCEL * dt);
        av.setComponent(i, newVal);
      }
      if (acceleratingAxes > 0) {
        state.rcsFuelKg -= config.RCS_FLOW * dt * acceleratingAxes;
        if (state.rcsFuelKg <= 0) state.rcsFuelKg = 0;
      }
    }
    state.rcsFiring = acceleratingAxes > 0 && state.rcsFuelKg > 0;

    let thrust = 0;
    if (state.throttle > 0 && state.fuelKg > 0) {
      thrust = state.throttle * config.MAX_THRUST;
      const massFlow = thrust / (config.ISP * config.G0);
      state.fuelKg -= massFlow * dt;
      if (state.fuelKg <= 0) {
        state.fuelKg = 0;
        state.throttle = 0;
        if (events && events.fuelOut) events.fuelOut();
      }
    }
    state.thrustNewtons = thrust;

    if (state.lastThrottle <= 0 && state.throttle > 0 && events && events.engineOn) events.engineOn();
    if (state.lastThrottle > 0 && state.throttle <= 0 && events && events.engineOff) events.engineOff();
    state.lastThrottle = state.throttle;

    const mass = config.DRY_MASS + state.fuelKg;
    const thrustDir = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);
    const accel = new THREE.Vector3(0, -config.GRAVITY, 0);
    accel.addScaledVector(thrustDir, thrust / mass);

    state.velocity.addScaledVector(accel, dt);
    state.position.addScaledVector(state.velocity, dt);

    const wq = new THREE.Quaternion(
      state.angularVelocity.x * dt,
      state.angularVelocity.y * dt,
      state.angularVelocity.z * dt,
      0
    );
    // body-frame rates: q' = q + 0.5 * q * w  (world-frame would be w * q, which made pitch and roll
    // act about the wrong axes once the lander had yawed)
    const dq = new THREE.Quaternion().multiplyQuaternions(state.quaternion, wq);
    state.quaternion.x += 0.5 * dq.x;
    state.quaternion.y += 0.5 * dq.y;
    state.quaternion.z += 0.5 * dq.z;
    state.quaternion.w += 0.5 * dq.w;
    state.quaternion.normalize();

    root.position.copy(state.position);
    root.quaternion.copy(state.quaternion);

    checkContacts(terrain, rocks, events);
  }

  function checkContacts(terrain, rocks, events) {
    const q = state.quaternion;
    const pos = state.position;
    const world = new THREE.Vector3();

    let probeContact = false;
    for (const p of probes) {
      world.copy(p).applyQuaternion(q).add(pos);
      const h = terrain.getHeight(world.x, world.z);
      if (world.y < h) {
        probeContact = true;
        break;
      }
    }
    if (probeContact && !state.contactLight) {
      state.contactLight = true;
      if (events && events.contact) events.contact({ position: pos.clone(), velocity: state.velocity.clone() });
    }

    let footpadContactPoint = null;
    for (const p of footpads) {
      world.copy(p).applyQuaternion(q).add(pos);
      const h = terrain.getHeight(world.x, world.z);
      const rock = rocks.rockCollision(world);
      if (world.y < h || rock) {
        footpadContactPoint = world.clone();
        break;
      }
    }

    if (footpadContactPoint) {
      evaluateTouchdown(footpadContactPoint, terrain, rocks, events);
      return;
    }

    for (const hp of hullPoints) {
      world.copy(hp).applyQuaternion(q).add(pos);
      const h = terrain.getHeight(world.x, world.z);
      const rock = rocks.rockCollision(world);
      if (world.y < h || rock) {
        crash('Hull struck the surface', events);
        return;
      }
    }
  }

  function evaluateTouchdown(contactPoint, terrain, rocks, events) {
    const descentRate = -state.velocity.y;
    const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion);
    const tilt = Math.acos(Math.min(1, Math.max(-1, up.y))) * RAD2DEG;

    let reason = null;
    if (descentRate > config.LIMIT_VERTICAL) reason = 'Descent rate too high';
    else if (horizontalSpeed > config.LIMIT_HORIZONTAL) reason = 'Horizontal speed too high';
    else if (tilt > config.LIMIT_TILT_DEG) reason = 'Tilt too high';
    else {
      const q = state.quaternion;
      const pos = state.position;
      const world = new THREE.Vector3();
      for (const p of footpads) {
        world.copy(p).applyQuaternion(q).add(pos);
        const rock = rocks.rockCollision(world);
        if (rock && rock.size > 0.5) {
          reason = 'Landed on a boulder';
          break;
        }
      }
    }

    const touchdown = {
      descentRate,
      horizontalSpeed,
      tilt,
      distance: Math.hypot(state.position.x, state.position.z),
      fuelSeconds: fuelSecondsAtHover()
    };

    if (reason) crash(reason, events, touchdown);
    else land(contactPoint, terrain, events, touchdown);
  }

  function land(contactPoint, terrain, events, touchdown) {
    state.phase = 'LANDED';
    state.throttle = 0;
    state.thrustNewtons = 0;

    const q = state.quaternion;
    const pos = state.position;
    const world = new THREE.Vector3();
    let lowest = null;

    for (const p of footpads) {
      world.copy(p).applyQuaternion(q).add(pos);
      if (!lowest || world.y < lowest.y) lowest = world.clone();
    }

    if (lowest) {
      const h = terrain.getHeight(lowest.x, lowest.z);
      state.position.y += h - lowest.y;
    }

    state.velocity.set(0, 0, 0);
    state.angularVelocity.set(0, 0, 0);
    root.position.copy(state.position);
    root.quaternion.copy(state.quaternion);

    if (events && events.landed) {
      events.landed({
        position: state.position.clone(),
        velocity: state.velocity.clone(),
        ...touchdown
      });
    }
  }

  function crash(reason, events, touchdown) {
    state.phase = 'CRASHED';
    state.throttle = 0;
    state.thrustNewtons = 0;
    state.crashReason = reason;
    root.visible = false;

    if (events && events.crash) {
      events.crash({
        position: state.position.clone(),
        velocity: state.velocity.clone(),
        reason,
        ...(touchdown || {
          descentRate: -state.velocity.y,
          horizontalSpeed: Math.hypot(state.velocity.x, state.velocity.z),
          tilt: Math.acos(Math.min(1, Math.max(-1, new THREE.Vector3(0, 1, 0).applyQuaternion(state.quaternion).y))) * RAD2DEG,
          distance: Math.hypot(state.position.x, state.position.z),
          fuelSeconds: fuelSecondsAtHover()
        })
      });
    }
  }

  function getAltitude(terrain) {
    const q = state.quaternion;
    const pos = state.position;
    const world = new THREE.Vector3();
    let minAlt = Infinity;

    for (const p of footpads) {
      world.copy(p).applyQuaternion(q).add(pos);
      const h = terrain.getHeight(world.x, world.z);
      minAlt = Math.min(minAlt, world.y - h);
    }

    return minAlt;
  }

  reset();

  return {
    root,
    state,
    localPositions: {
      cockpitEye,
      nozzleExit,
      rcsQuads,
      footpads,
      probes,
      hullPoints
    },
    start,
    reset,
    step,
    getAltitude,
    fuelSecondsAtHover,
    crashReason: () => state.crashReason,
    dispose() {
      scene.remove(root);
    }
  };
}
