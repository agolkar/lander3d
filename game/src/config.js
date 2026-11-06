export const CONFIG = {
  QUALITY: 'high',
  MAX_PIXEL_RATIO: 2,
  EXPOSURE: 1.0,
  SEED: 1337,

  TERRAIN_SIZE: 2048,
  TERRAIN_SEGMENTS: 1024,
  TERRAIN_SEGMENTS_MEDIUM: 512,
  CRATER_COUNT: 1400,
  CRATER_MIN_D: 3,
  CRATER_MAX_D: 260,
  SITE_FLAT_RADIUS: 25,
  SITE_BLEND_RADIUS: 70,
  FAR_RADIUS: 20000,
  REGOLITH_TINT: 0x454540,

  GRAVITY: 1.62,
  DRY_MASS: 6800,
  FUEL_START: 520,
  MAX_THRUST: 45040,
  MIN_THROTTLE: 0.10,
  THROTTLE_RATE: 0.5,
  ISP: 305,
  G0: 9.80665,
  RCS_MAX_RATE_DEG: 10,
  RCS_ACCEL_DEG: 15,
  RCS_FUEL_START: 60,
  RCS_FLOW: 0.15,

  LIMIT_VERTICAL: 2.5,
  LIMIT_HORIZONTAL: 1.2,
  LIMIT_TILT_DEG: 10,
  TARGET_RADIUS: 30,

  SUN_ELEVATION_DEG: 12,
  SUN_AZIMUTH_DEG: 20,
  SUN_INTENSITY: 6,
  STAR_INTENSITY: 0,

  EFFECTS: {
    bloomStrength: 0.35,
    bloomRadius: 0.4,
    bloomThreshold: 4.0,     // only really hot pixels glow: sun glints on the foil stay crisp
    gtao: true,
    smaa: true,
    dustMaxParticles: 20000,
    dustStartAltitude: 35,
    plumeOpacity: 0.12
  },

  AUDIO: {
    masterVolume: 0.6,
    voice: true,
    voiceRate: 1.05
  },

  CAMERA: {
    dragDegPerPixel: 0.25,   // right-drag or Option + drag: degrees per pixel
    swipeDegPerUnit: 0.12,   // horizontal two-finger swipe: degrees per wheel unit
    zoomPerWheelUnit: 0.0015,// wheel or vertical swipe: zoom per wheel unit (exponential)
    pinchZoomPerUnit: 0.01,  // trackpad pinch: zoom per unit
    zoomStep: 1.15,          // - and = keys
    minDistance: 6,
    maxDistance: 400,
    minPitchDeg: -5,
    maxPitchDeg: 85,
    lowAltitude: 40,         // below this altitude the chase view lowers itself to show the ground gap
    groundSideOffset: 45,    // landing camera: closest distance from the predicted touchdown point (m)
    groundEyeHeight: 3       // landing camera: height above the ground (m)
  }
};
