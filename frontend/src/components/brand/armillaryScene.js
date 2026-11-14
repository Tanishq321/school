import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { annulusGeometry, bumpOf, celestialGlobe, eclipticBand, horizonDial, meridianDial, plinthTop, redrawAll } from './armillaryTextures.js';

/**
 * The house instrument: a brass armillary sphere on a lacquered stand, the emblem of scholarship
 * since antiquity. Built entirely from geometry and code-drawn engraving (no model or image files):
 *  - a lacquered celestial globe mapped with a graticule and gilt constellation figures, set with
 *    raised gilt stars;
 *  - equator, colures, tropics and polar circles;
 *  - the ecliptic band engraved with the twelve signs and a degree scale, carrying a rayed sun and
 *    a moon that shows its phase;
 *  - a graduated meridian (latitude 0–90 in each quadrant) carrying the axis, with turned finials;
 *  - the horizon: a dial with azimuth graduations, the cardinal points and the house inscription;
 *  - four cabriole legs, a turned baluster and a lacquered plinth inlaid with a guilloché rosette
 *    and compass rose.
 * Physically based metal lit by a studio environment, so the brass genuinely reflects.
 *
 * Driven from outside: `getProgress()` (0..1, the scroll story) or idle spin. Every value is
 * damped toward its target, so scrolling feels weighted and smooth without hijacking the scroll.
 */

const DEG = Math.PI / 180;
const OBLIQUITY = 23.44 * DEG;
const R = 1.6;

/** Camera poses for the scroll story. shift moves the instrument left/right on screen. */
const KEYS = [
  { p: 0.0, theta: 0.42, phi: 0.12, dist: 14.2, ty: -0.4, shift: 0.5, spin: 0 }, // hero: whole instrument, right
  { p: 0.13, theta: 0.15, phi: 0.18, dist: 12.6, ty: -0.35, shift: 0.0, spin: 0.4 },
  { p: 0.23, theta: -0.62, phi: 0.3, dist: 10.2, ty: 0.05, shift: -0.5, spin: 1.3 }, // I: close on the rings, left
  { p: 0.45, theta: 1.25, phi: 0.06, dist: 11, ty: -0.2, shift: 0.5, spin: 2.6 }, // II: profile, right
  { p: 0.67, theta: 2.35, phi: 0.66, dist: 9.4, ty: 0.2, shift: -0.5, spin: 3.9 }, // III: looking down on the globe, left
  { p: 0.89, theta: 3.3, phi: 0.16, dist: 13.4, ty: -0.4, shift: 0.5, spin: 5.2 }, // IV: whole again, right
  { p: 1.0, theta: 3.45, phi: 0.16, dist: 14, ty: -0.4, shift: 0.5, spin: 5.6 },
];
const IDLE_POSE = { theta: 0.5, phi: 0.16, dist: 11.6, ty: -0.42, shift: 0, spin: 0, lift: 0 };
const smooth = (t) => t * t * (3 - 2 * t);
function pose(p, mobile) {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i += 1;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth(Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p))));
  const out = {};
  for (const k of ['theta', 'phi', 'dist', 'ty', 'shift', 'spin']) out[k] = a[k] + (b[k] - a[k]) * t;
  out.lift = 0;
  if (mobile) {
    // Phones: the instrument floats in the upper part of the screen, the words sit below it.
    out.shift = 0;
    out.dist *= 1.7;
    out.lift = 0.25;
  }
  return out;
}

function softShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createArmillary(canvas, { getProgress, idle = false, isDay = () => false, onFirstFrame } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 unavailable');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const software = /swiftshader|llvmpipe|software|basic render/i.test(dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seg = software ? 0.4 : 1; // geometry detail

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  renderer.setPixelRatio(software ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);

  // ------------------------------------------------------------------------------------ materials
  const brass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#c9a062'), metalness: 1, roughness: 0.28, anisotropy: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.2 });
  const brassDark = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#8d6c3b'), metalness: 1, roughness: 0.42 });
  const gilt = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#f0d9a4'), metalness: 1, roughness: 0.18, emissive: new THREE.Color('#5a4320'), emissiveIntensity: 0.25 });
  const lacquer = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#121a30'), metalness: 0.15, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.55 });
  const silver = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#d9dde4'), metalness: 1, roughness: 0.22 });
  const shade = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#1a2033'), metalness: 0.6, roughness: 0.5 });
  const materials = [brass, brassDark, gilt, lacquer, silver, shade];
  const geometries = [];

  // Engraving. Strip proportions follow each ring's real circumference / width.
  const maxTex = Math.min(renderer.capabilities.maxTextureSize, software ? 4096 : 8192);
  const textures = [];
  const T = (t) => (textures.push(t), t);
  const strip = (radius, width, fn) => {
    const aspect = (2 * Math.PI * radius) / width;
    const h = Math.round(Math.min(maxTex / aspect, software ? 96 : 192));
    return T(fn({ w: Math.round(h * aspect), h, aspect }));
  };
  const engraved = (map, extra = {}) => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map, bumpMap: T(bumpOf(map)), bumpScale: 1.6, metalness: 1, roughness: 0.3, clearcoat: 0.2, clearcoatRoughness: 0.25, ...extra });
    materials.push(m);
    return m;
  };
  const G = (g) => (geometries.push(g), g);
  const torus = (r, tube, radial = 220) => G(new THREE.TorusGeometry(r, tube, Math.round(20 * seg) + 6, Math.round(radial * seg) + 24));

  // ------------------------------------------------------------------------------------ model
  const root = new THREE.Group(); // stand + everything
  scene.add(root);
  const frame = new THREE.Group(); // tilted to the observer's latitude
  frame.rotation.z = -34 * DEG;
  root.add(frame);
  const sphere = new THREE.Group(); // turns about the celestial axis
  frame.add(sphere);

  // Celestial globe: lacquer set with gilt stars and fine meridians.
  const skyMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T(celestialGlobe({ w: software ? 1024 : 2048 })), metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.6 });
  materials.push(skyMat);
  const globe = new THREE.Mesh(G(new THREE.SphereGeometry(0.44, Math.round(64 * seg) + 16, Math.round(48 * seg) + 12)), skyMat);
  sphere.add(globe);
  const starGeo = G(new THREE.SphereGeometry(0.0085, 6, 4));
  const stars = new THREE.InstancedMesh(starGeo, gilt, 140);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 140; i += 1) {
    // deterministic scatter (golden-angle spiral with jitter): the same sky every time
    const y = 1 - (2 * (i + 0.5)) / 140;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963 + Math.sin(i * 12.9898) * 0.35;
    const v = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).multiplyScalar(0.447);
    const s = 0.6 + ((i * 37) % 11) / 11;
    m4.compose(v, new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    stars.setMatrixAt(i, m4);
  }
  sphere.add(stars);
  for (const ry of [0, Math.PI / 2]) {
    const mer = new THREE.Mesh(torus(0.446, 0.0035, 120), gilt);
    mer.rotation.y = ry;
    sphere.add(mer);
  }
  const gEq = new THREE.Mesh(torus(0.446, 0.0035, 120), gilt);
  gEq.rotation.x = Math.PI / 2;
  sphere.add(gEq);

  // Equator, colures, tropics and polar circles.
  const equator = new THREE.Mesh(torus(R, 0.036), brass);
  equator.rotation.x = Math.PI / 2;
  sphere.add(equator);
  const colures = [0, Math.PI / 2].map((ry) => {
    const c = new THREE.Mesh(torus(R, 0.028), brass);
    c.rotation.y = ry;
    sphere.add(c);
    return c;
  });
  const circles = [OBLIQUITY, -OBLIQUITY, Math.PI / 2 - OBLIQUITY, -(Math.PI / 2 - OBLIQUITY)].map((lat) => {
    const c = new THREE.Mesh(torus(R * Math.cos(lat), 0.016, 160), brassDark);
    c.rotation.x = Math.PI / 2;
    c.position.y = R * Math.sin(lat);
    sphere.add(c);
    return c;
  });

  // Ecliptic: a broad band with engraved graduations, tilted by the obliquity.
  const ecliptic = new THREE.Group();
  ecliptic.rotation.x = OBLIQUITY;
  sphere.add(ecliptic);
  const eclMat = engraved(strip(R * 1.005, 0.2, eclipticBand), { side: THREE.DoubleSide });
  ecliptic.add(new THREE.Mesh(G(new THREE.CylinderGeometry(R * 1.005, R * 1.005, 0.2, Math.round(220 * seg) + 24, 1, true)), eclMat));
  for (const y of [-0.1, 0.1]) {
    const lip = new THREE.Mesh(torus(R * 1.008, 0.012), brass);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = y;
    ecliptic.add(lip);
  }
  // A rayed gilt sun riding the ecliptic, its face turned outward.
  const sun = new THREE.Group();
  sun.add(new THREE.Mesh(G(new THREE.SphereGeometry(0.06, 24, 16)), gilt));
  const rays = new THREE.Shape();
  for (let i = 0; i <= 32; i += 1) {
    const a = (i / 32) * Math.PI * 2;
    const r = i % 2 ? 0.08 : i % 4 ? 0.13 : 0.155;
    if (i) rays.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else rays.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const rayMesh = new THREE.Mesh(G(new THREE.ExtrudeGeometry(rays, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 })), gilt);
  rayMesh.position.z = -0.006;
  sun.add(rayMesh);
  ecliptic.add(sun);
  // A silver moon on the same band, lit on the side that faces the sun: it waxes and wanes as it turns.
  const moon = new THREE.Group();
  moon.add(new THREE.Mesh(G(new THREE.SphereGeometry(0.048, 24, 16, 0, Math.PI)), silver));
  moon.add(new THREE.Mesh(G(new THREE.SphereGeometry(0.048, 24, 16, Math.PI, Math.PI)), shade));
  ecliptic.add(moon);
  const sunWorld = new THREE.Vector3();

  // Axis and finials (fixed in the frame).
  const RM = R + 0.24;
  const axis = new THREE.Mesh(G(new THREE.CylinderGeometry(0.02, 0.02, RM * 2 + 0.14, 16)), brass);
  frame.add(axis);
  // Turned finials: collar, bead, urn and spire, cut on the lathe.
  const finialGeo = G(
    new THREE.LatheGeometry(
      [
        [0.0, 0.0],
        [0.05, 0.0],
        [0.056, 0.016],
        [0.034, 0.03],
        [0.03, 0.05],
        [0.048, 0.064],
        [0.048, 0.076],
        [0.028, 0.088],
        [0.06, 0.12],
        [0.07, 0.15],
        [0.058, 0.185],
        [0.026, 0.205],
        [0.02, 0.222],
        [0.032, 0.236],
        [0.02, 0.25],
        [0.008, 0.3],
        [0.0, 0.33],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      Math.round(32 * seg) + 12,
    ),
  );
  for (const s of [1, -1]) {
    const f = new THREE.Mesh(finialGeo, gilt);
    f.position.y = s * (RM + 0.06);
    if (s < 0) f.rotation.x = Math.PI;
    frame.add(f);
  }
  // Outer meridian: a flat graduated ring with rolled edges, carrying the axis.
  const meridian = new THREE.Group();
  const MW = 0.15;
  const merMat = engraved(strip(RM, MW, meridianDial));
  const merFace = G(annulusGeometry(RM - MW / 2, RM + MW / 2, Math.round(240 * seg) + 32));
  for (const side of [1, -1]) {
    const face = new THREE.Mesh(merFace, merMat);
    face.position.z = side * 0.016;
    if (side < 0) face.rotation.y = Math.PI; // the back reads correctly from behind
    meridian.add(face);
  }
  for (const r of [RM - MW / 2, RM + MW / 2]) {
    const edge = new THREE.Mesh(G(new THREE.CylinderGeometry(r, r, 0.034, Math.round(200 * seg) + 24, 1, true)), brass);
    edge.rotation.x = Math.PI / 2;
    meridian.add(edge);
  }
  frame.add(meridian);

  // Horizon ring on four legs, baluster and plinth.
  const RH = RM + 0.08;
  const HW = 0.3;
  const horizon = new THREE.Mesh(G(annulusGeometry(RH, RH + HW, Math.round(260 * seg) + 32)), engraved(strip(RH + HW / 2, HW, horizonDial)));
  horizon.rotation.x = -Math.PI / 2;
  root.add(horizon);
  const horizonUnder = new THREE.Mesh(G(new THREE.RingGeometry(RH, RH + HW, Math.round(200 * seg) + 24, 1)), brassDark);
  horizonUnder.rotation.x = Math.PI / 2;
  horizonUnder.position.y = -0.004;
  root.add(horizonUnder);
  for (const r of [RH, RH + HW]) {
    const edge = new THREE.Mesh(torus(r, 0.014), brass);
    edge.rotation.x = Math.PI / 2;
    root.add(edge);
  }
  const baseY = -2.62;
  for (let i = 0; i < 4; i += 1) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const top = new THREE.Vector3(Math.cos(a) * (RH + HW / 2), -0.01, Math.sin(a) * (RH + HW / 2));
    const foot = new THREE.Vector3(Math.cos(a) * 0.82, baseY + 0.12, Math.sin(a) * 0.82);
    const curve = new THREE.CubicBezierCurve3(top, top.clone().add(new THREE.Vector3(0, -0.9, 0)), foot.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0.6, Math.sin(a) * 0.5)), foot);
    root.add(new THREE.Mesh(G(new THREE.TubeGeometry(curve, Math.round(40 * seg) + 8, 0.034, 10, false)), brass));
  }
  const prof = [
    [0.0, baseY + 0.14],
    [0.26, baseY + 0.14],
    [0.3, baseY + 0.22],
    [0.17, baseY + 0.36],
    [0.12, baseY + 0.7],
    [0.2, baseY + 0.86],
    [0.11, baseY + 1.02],
    [0.07, -RM - 0.05],
    [0.0, -RM - 0.05],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  root.add(new THREE.Mesh(G(new THREE.LatheGeometry(prof, Math.round(64 * seg) + 16)), brass));
  const inlay = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T(plinthTop({ size: software ? 1024 : 2048 })), metalness: 0, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 0.22 });
  materials.push(inlay);
  const plinth = new THREE.Mesh(G(new THREE.CylinderGeometry(1.02, 1.12, 0.16, Math.round(96 * seg) + 24)), [lacquer, inlay, lacquer]);
  plinth.position.y = baseY + 0.06;
  root.add(plinth);
  const rim = new THREE.Mesh(torus(1.06, 0.016, 160), brass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = baseY + 0.14;
  root.add(rim);

  const shadowTex = softShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 });
  const shadow = new THREE.Mesh(G(new THREE.PlaneGeometry(4.2, 4.2)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = baseY - 0.02;
  root.add(shadow);
  materials.push(shadowMat);

  // ------------------------------------------------------------------------------------ light
  const key = new THREE.DirectionalLight(0xffe7c2, 2.4);
  key.position.set(-4, 6, 5);
  const rimLight = new THREE.DirectionalLight(0x9fb4ff, 0.9);
  rimLight.position.set(5, 2, -6);
  scene.add(key, rimLight);

  function applyTheme() {
    const day = isDay();
    renderer.toneMappingExposure = day ? 1.02 : 0.92;
    scene.environmentIntensity = day ? 1.15 : 0.9;
    rimLight.intensity = day ? 0.45 : 0.9;
    shadowMat.opacity = day ? 0.42 : 0.65;
  }
  applyTheme();

  // ------------------------------------------------------------------------------------ assembly
  // On first appearance the rings swing open from a folded position, one after another.
  const parts = [equator, ...colures, ecliptic, ...circles, meridian];
  const rest = parts.map((o) => o.rotation.clone());
  const folded = parts.map((o, i) => new THREE.Euler(o.rotation.x + (i % 2 ? 1.2 : -1.1), o.rotation.y + 0.9, o.rotation.z + (i % 3) * 0.5));
  let assembly = reduced || software ? 1 : 0; // no GPU: draw the finished instrument, once

  // ------------------------------------------------------------------------------------ loop
  let width = 1;
  let height = 1;
  const mobile = () => width < 760;
  const targetPose = () => (getProgress ? pose(getProgress(), mobile()) : IDLE_POSE);
  const cur = { ...targetPose() };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let spinIdle = 0;
  let raf = 0;
  let visible = true;
  let last = performance.now();
  let first = true;
  let slowFrames = 0;
  let frozen = software; // without a GPU: render only when something asks (scroll, resize), never continuously

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === width && h === height) return;
    width = Math.max(1, w);
    height = Math.max(1, h);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frame_(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    resize();
    const target = targetPose();
    // Damping: weighted, never laggy. Without a GPU frames are rare, so they jump straight to the pose.
    const k = frozen || reduced ? 1 : 1 - Math.exp(-dt * 5.5);
    let moving = false;
    for (const key_ of Object.keys(target)) {
      const d = target[key_] - cur[key_];
      if (Math.abs(d) > 1e-4) moving = true;
      cur[key_] += d * k;
    }
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    if (Math.abs(pointer.tx - pointer.x) > 1e-3 || Math.abs(pointer.ty - pointer.y) > 1e-3) moving = true;

    if (assembly < 1) {
      assembly = Math.min(1, assembly + dt / 2.4);
      parts.forEach((o, i) => {
        const t = smooth(Math.min(1, Math.max(0, assembly * 1.6 - i * 0.07)));
        o.rotation.set(folded[i].x + (rest[i].x - folded[i].x) * t, folded[i].y + (rest[i].y - folded[i].y) * t, folded[i].z + (rest[i].z - folded[i].z) * t);
      });
      moving = true;
    }
    if (!reduced && (idle || !getProgress)) {
      spinIdle += dt * 0.12;
      moving = true;
    } else if (!reduced) {
      spinIdle += dt * 0.03; // the sky never quite stops
      moving = true;
    }
    sphere.rotation.y = cur.spin + spinIdle;
    const sa = cur.spin * 0.6 + 0.4;
    sun.position.set(Math.cos(sa) * R * 1.03, 0, Math.sin(sa) * R * 1.03);
    sun.rotation.y = Math.PI / 2 - sa; // face outward from the axis
    const ma = sa * 2.4 + 2.2 + spinIdle * 0.5;
    moon.position.set(Math.cos(ma) * R * 1.03, 0.03, Math.sin(ma) * R * 1.03);
    moon.updateMatrixWorld();
    sun.getWorldPosition(sunWorld);
    moon.lookAt(sunWorld);

    const theta = cur.theta + pointer.x * 0.12;
    const phi = cur.phi + pointer.y * 0.06;
    camera.position.set(Math.sin(theta) * Math.cos(phi) * cur.dist, cur.ty + Math.sin(phi) * cur.dist, Math.cos(theta) * Math.cos(phi) * cur.dist);
    camera.lookAt(0, cur.ty, 0);
    // Slide the instrument across the frame without moving the camera's point of view.
    camera.setViewOffset(width, height, -cur.shift * width * 0.5, cur.lift * height, width, height);

    const t0 = performance.now();
    renderer.render(scene, camera);
    if (first) {
      first = false;
      onFirstFrame?.();
    }
    // A machine without a GPU renders slowly: keep it to occasional still frames.
    if (software || performance.now() - t0 > 40) slowFrames += 1;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 8) frozen = true;
    if (visible && !document.hidden && moving && !(frozen && assembly >= 1)) raf = requestAnimationFrame(frame_);
  }

  const kick = () => {
    if (!raf && visible) {
      last = performance.now();
      raf = requestAnimationFrame(frame_);
    }
  };
  const onPointer = (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    kick();
  };
  const onTheme = () => {
    applyTheme();
    kick();
  };
  const io = new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    if (visible) kick();
  });
  io.observe(canvas);
  const onVis = () => !document.hidden && kick();
  // The engraving is drawn in the house face; redraw it once that has loaded.
  document.fonts
    ?.load('italic 40px "Bodoni Moda Variable"')
    .then(() => {
      redrawAll(textures);
      kick();
    })
    .catch(() => {});
  window.addEventListener('scroll', kick, { passive: true });
  window.addEventListener('resize', kick);
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('themechange', onTheme);
  document.addEventListener('visibilitychange', onVis);
  kick();

  return {
    kick,
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('scroll', kick);
      window.removeEventListener('resize', kick);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('themechange', onTheme);
      document.removeEventListener('visibilitychange', onVis);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      shadowTex.dispose();
      textures.forEach((t) => t.dispose());
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
