export function createInput(canvas) {
  const keys = new Set();
  const actions = [];
  let mouseThrottleActive = false;
  let leftDown = false;

  function onKeyDown(e) {
    if (!e.repeat) {
      switch (e.code) {
        case 'Space':
          actions.push({ name: 'start' });
          e.preventDefault();
          break;
        case 'KeyP':
          actions.push({ name: 'pause' });
          break;
        case 'KeyR':
          actions.push({ name: 'restart', shift: e.shiftKey });
          break;
        case 'KeyC':
          actions.push({ name: 'camera' });
          break;
        case 'KeyH':
          actions.push({ name: 'help' });
          break;
        case 'KeyT':
          actions.push({ name: 'stars' });
          break;
        case 'KeyM':
          actions.push({ name: 'mute' });
          break;
        case 'KeyV':
          actions.push({ name: 'voice' });
          break;
        case 'KeyF':
          actions.push({ name: 'fps' });
          break;
        case 'BracketLeft':
          actions.push({ name: 'exposure', delta: -0.1 });
          break;
        case 'BracketRight':
          actions.push({ name: 'exposure', delta: 0.1 });
          break;
        case 'Minus':
        case 'NumpadSubtract':
          actions.push({ name: 'zoom', delta: -1 });
          e.preventDefault();
          break;
        case 'Equal':
        case 'NumpadAdd':
          actions.push({ name: 'zoom', delta: 1 });
          e.preventDefault();
          break;
        case 'Digit0':
        case 'Numpad0':
          actions.push({ name: 'resetView' });
          e.preventDefault();
          break;
      }
    }

    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      mouseThrottleActive = false;
    }

    keys.add(e.code);

    if (['ArrowUp', 'ArrowDown', 'Space', 'BracketLeft', 'BracketRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onPointerDown(e) {
    if (e.button !== 0 || e.altKey) return; // Option + drag looks around (cameras.js)
    mouseThrottleActive = true;
    leftDown = true;
    actions.push({ name: 'start' });
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (e.button !== 0) return;
    leftDown = false;
  }

  function onPointerCancel() {
    leftDown = false;
  }

  function onBlur() {
    leftDown = false;
  }

  const pointerTarget = canvas || window;
  pointerTarget.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('blur', onBlur);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function rcsCommand() {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;

    if (keys.has('KeyW')) pitch += 1;
    if (keys.has('KeyS')) pitch -= 1;
    if (keys.has('KeyA')) roll -= 1;
    if (keys.has('KeyD')) roll += 1;
    if (keys.has('KeyQ')) yaw += 1;
    if (keys.has('KeyE')) yaw -= 1;

    return { pitch, roll, yaw };
  }

  return {
    actions,
    get rcsCommand() {
      return rcsCommand();
    },
    get throttleUp() {
      if (mouseThrottleActive) return leftDown;
      return keys.has('ArrowUp');
    },
    get throttleDown() {
      if (mouseThrottleActive) return !leftDown;
      return keys.has('ArrowDown');
    },
    get cutoff() {
      return keys.has('KeyX');
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      pointerTarget.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onBlur);
    }
  };
}
