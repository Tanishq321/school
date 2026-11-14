import { useEffect, useRef } from 'react';

/**
 * "Lacquer silk": a slow, procedurally generated surface whose folds catch a warm brass light.
 * By night it is midnight lacquer under a desk lamp; by day, ivory silk in morning light
 * (uDay blends between the two, so a theme change dissolves rather than snaps). Pure WebGL1, no libraries, no images. Pauses off-screen and in
 * background tabs; renders a single still frame for prefers-reduced-motion.
 */
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uIntensity;
uniform float uDay;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
// Long, soft folds: a sine field bent by domain-warped noise, like draped silk.
float height(vec2 p, float t){
  vec2 q = vec2(fbm(p * 0.8 + vec2(0.0, t * 0.035)), fbm(p * 0.8 + vec2(5.2, 1.3) - t * 0.03));
  float f = sin((p.x * 1.1 + p.y * 0.55) * 2.3 + 3.2 * q.x + 2.2 * q.y + t * 0.11);
  return f * 0.5 + 0.5;
}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float e = 0.0025;
  vec2 sp = p * 1.35;
  float h  = height(sp, t);
  float hx = height(sp + vec2(e, 0.0), t) - h;
  float hy = height(sp + vec2(0.0, e), t) - h;
  vec3 n = normalize(vec3(-hx / e * 0.07, -hy / e * 0.07, 1.0));

  // A lamp high on the left, drifting a little toward the pointer.
  vec2 m = (uMouse - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec2 lp = mix(vec2(-0.75, 0.65), m, 0.3);
  vec3 L = normalize(vec3(lp - p, 0.85));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), 70.0);
  float sheen = pow(max(dot(n, H), 0.0), 9.0);

  vec3 brass = vec3(0.86, 0.71, 0.46);

  // Night: midnight lacquer.
  vec3 deep = vec3(0.027, 0.043, 0.090);
  vec3 lacquer = vec3(0.075, 0.105, 0.185);
  vec3 night = mix(deep, lacquer, smoothstep(0.1, 0.95, h)) * (0.45 + 0.7 * diff);
  night += brass * spec * 0.85 * uIntensity;
  night += brass * sheen * 0.05 * uIntensity;
  night += brass * 0.09 * uIntensity * smoothstep(1.3, 0.0, length(p - lp)); // warm pool of light
  night *= smoothstep(1.45, 0.2, length(p * vec2(0.75, 1.0)));             // vignette

  // Day: ivory silk. Folds read as soft shade, highlights as a white satin sheen, the warmth as brass.
  vec3 shade = vec3(0.85, 0.80, 0.71);
  vec3 ivory = vec3(0.965, 0.948, 0.91);
  vec3 day = mix(shade, ivory, smoothstep(0.05, 0.9, h) * 0.65 + diff * 0.45);
  day += vec3(1.0, 0.99, 0.96) * spec * 0.35 * uIntensity;
  day = mix(day, day * brass * 1.08, 0.35 * smoothstep(1.4, 0.0, length(p - lp)) * uIntensity);
  day *= mix(0.9, 1.0, smoothstep(1.6, 0.3, length(p * vec2(0.75, 1.0))));

  vec3 col = mix(night, day, uDay);
  col += (hash(gl_FragCoord.xy + fract(t * 7.0) * 113.0) - 0.5) * mix(0.03, 0.018, uDay); // film grain
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export default function LacquerCanvas({ className = '', intensity = 1, speed = 1 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return undefined; // CSS fallback (lamplight) stays visible behind the canvas
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (err) {
      console.warn('[lacquer] shader unavailable', err);
      return undefined;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uMouse = gl.getUniformLocation(prog, 'uMouse');
    const uIntensity = gl.getUniformLocation(prog, 'uIntensity');
    const uDay = gl.getUniformLocation(prog, 'uDay');
    const isDay = () => !canvas.closest('.dark') && !document.documentElement.classList.contains('dark');
    const day = { v: isDay() ? 1 : 0, t: isDay() ? 1 : 0 };

    // Software rasterisers (no GPU) can't afford a live shader: draw one still frame instead.
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
    let still = software || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mouse = { x: 0.3, y: 0.7, tx: 0.3, ty: 0.7 };
    let raf = 0;
    let visible = true;
    let start = performance.now() - 40_000; // begin mid-flow, not at a symmetric t=0
    // Render below device resolution: the surface is soft by design and this keeps GPUs cool.
    let scale = software ? 0.35 : Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;
    const slow = [];

    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * scale));
      const h = Math.max(1, Math.floor(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const frame = (now) => {
      raf = 0;
      const t0 = performance.now();
      resize();
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, ((now - start) / 1000) * speed);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uIntensity, intensity);
      day.v += (day.t - day.v) * 0.08;
      if (Math.abs(day.t - day.v) < 0.002) day.v = day.t;
      gl.uniform1f(uDay, day.v);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Adaptive quality: if frames are expensive, render smaller; if still slow, hold a still frame.
      if (!still) {
        gl.finish();
        slow.push(performance.now() - t0 > 28);
        if (slow.length >= 12) {
          if (slow.filter(Boolean).length > 6) {
            if (scale > 0.4) scale = 0.4;
            else still = true;
          }
          slow.length = 0;
        }
      }
      const fading = day.v !== day.t;
      if ((!still || fading) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - r.left) / r.width;
      mouse.ty = 1 - (e.clientY - r.top) / r.height;
    };
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (visible) kick();
    });
    io.observe(canvas);
    const onVis = () => !document.hidden && kick();
    const onTheme = () => {
      day.t = isDay() ? 1 : 0;
      kick();
    };
    window.addEventListener('themechange', onTheme);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', kick);
    canvas.style.opacity = '1';
    kick();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', kick);
      window.removeEventListener('themechange', onTheme);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [intensity, speed]);

  return (
    <div className={`lamplight absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <canvas ref={ref} className="h-full w-full opacity-0 transition-opacity duration-[1400ms]" />
    </div>
  );
}
