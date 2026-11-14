import * as THREE from 'three';

/**
 * Engravings for the armillary, drawn in code onto canvases (no image files).
 *
 * Rings are textured as long strips: u runs once around the ring, v across its width. Each strip
 * knows the ring's real proportions (`aspect` = circumference / width) and draws its lettering with
 * a compensating horizontal scale, so the type is never stretched on the metal.
 *
 * Colours are pre-tinted brass: bright lands, dark patina in the cuts. The same canvas also serves
 * as a bump map, so the cuts catch the light as real engraving does.
 *
 * Canvas text depends on the display face having loaded; every texture can redraw itself once it
 * has (`redrawAll`), so the first frame is never blocked on a font.
 */
const SERIF = '"Bodoni Moda Variable", "Bodoni 72", Didot, Georgia, serif';
const LAND = '#d3ad6c';
const CUT = '#4f3a1c';

const SIGNS = ['ARIES', 'TAURUS', 'GEMINI', 'CANCER', 'LEO', 'VIRGO', 'LIBRA', 'SCORPIO', 'SAGITTARIUS', 'CAPRICORNUS', 'AQUARIUS', 'PISCES'];
const GLYPHS = ['♈︎', '♉︎', '♊︎', '♋︎', '♌︎', '♍︎', '♎︎', '♏︎', '♐︎', '♑︎', '♒︎', '♓︎'];

/** Deterministic noise: the same grain and the same sky on every visit. */
function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function make(w, h, draw, { wrap = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (wrap) t.wrapS = THREE.RepeatWrapping;
  const render = () => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    t.needsUpdate = true;
  };
  render();
  t.userData.redraw = render;
  return t;
}

/** A second, linear texture over the same canvas, for bump mapping (no colour conversion). */
export function bumpOf(t) {
  const b = new THREE.CanvasTexture(t.image);
  b.anisotropy = t.anisotropy;
  b.wrapS = t.wrapS;
  const redraw = t.userData.redraw;
  t.userData.redraw = () => {
    redraw();
    b.needsUpdate = true;
  };
  return b;
}

export function redrawAll(textures) {
  for (const t of textures) t.userData.redraw?.();
}

/** Brushed metal ground, grain running along the strip. */
function metalStrip(g, w, h, seed) {
  const r = rng(seed);
  g.fillStyle = LAND;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < h * 3; i += 1) {
    g.fillStyle = r() > 0.5 ? `rgba(255,244,214,${0.04 + r() * 0.06})` : `rgba(80,58,26,${0.03 + r() * 0.05})`;
    g.fillRect(0, r() * h, w, 0.6 + r());
  }
  // a faint warm sheen across the width, as on a hand-burnished band
  const sheen = g.createLinearGradient(0, 0, 0, h);
  sheen.addColorStop(0, 'rgba(80,58,26,0.18)');
  sheen.addColorStop(0.5, 'rgba(255,240,200,0.08)');
  sheen.addColorStop(1, 'rgba(80,58,26,0.18)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);
}

function engraver(g, w, h, aspect) {
  // horizontal squeeze that keeps lettering in true proportion on the ring
  const k = w / h / aspect;
  const px = h / 100; // drawing unit: one hundredth of the strip's width
  g.strokeStyle = CUT;
  g.fillStyle = CUT;
  g.lineCap = 'butt';
  return {
    px,
    line(x0, y0, x1, y1, lw) {
      g.lineWidth = lw * px;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    },
    rule(y, lw) {
      this.line(0, y * px, w, y * px, lw);
    },
    text(str, x, y, size, { italic = false, spacing = 0, align = 'center' } = {}) {
      g.save();
      g.translate(x, y * px);
      g.scale(k, 1);
      g.font = `${italic ? 'italic ' : ''}${Math.round(size * px)}px ${SERIF}`;
      g.textAlign = align;
      g.textBaseline = 'middle';
      if ('letterSpacing' in g) g.letterSpacing = `${(spacing * px).toFixed(1)}px`;
      g.fillText(str, 0, 0);
      g.restore();
    },
    /** graduations along one edge: y0 is the edge, dir +1 grows down, -1 grows up */
    scale(y0, dir, lengths, divisions = 360) {
      for (let d = 0; d < divisions; d += 1) {
        const x = (d / divisions) * w;
        const len = d % 10 === 0 ? lengths[0] : d % 5 === 0 ? lengths[1] : lengths[2];
        this.line(x, y0 * px, x, (y0 + dir * len) * px, d % 10 === 0 ? 0.9 : d % 5 === 0 ? 0.7 : 0.45);
      }
    },
  };
}

/**
 * The ecliptic band (a cylinder; v=0 its lower edge). Degree scale along the top, the twelve
 * signs with their names and symbols beneath, divided by double rules.
 */
export function eclipticBand({ w, h, aspect }) {
  return make(
    w,
    h,
    (g) => {
      metalStrip(g, w, h, 11);
      const e = engraver(g, w, h, aspect);
      e.rule(4, 1.4);
      e.rule(96, 1.4);
      e.rule(30, 0.8);
      e.scale(4, 1, [20, 14, 8]);
      for (let d = 10; d < 360; d += 10) if (d % 30) e.text(String(d % 30), (d / 360) * w + 5 * e.px, 26, 7);
      SIGNS.forEach((name, i) => {
        const x0 = (i / 12) * w;
        e.line(x0, 4 * e.px, x0, 96 * e.px, 1.8);
        e.line(x0 + 2.2 * e.px, 30 * e.px, x0 + 2.2 * e.px, 96 * e.px, 0.6);
        e.text(GLYPHS[i], x0 + (w / 12) * 0.16, 63, 26);
        e.text(name, x0 + (w / 12) * 0.56, 63, 30, { italic: true, spacing: 6 });
      });
    },
    { wrap: true },
  );
}

/**
 * The horizon (a flat ring seen from above; the canvas bottom is its outer edge). Degree scale at the rim, numerals
 * every thirty, the four cardinal points and the house inscription between them.
 */
export function horizonDial({ w, h, aspect }) {
  return make(
    w,
    h,
    (g) => {
      metalStrip(g, w, h, 23);
      const e = engraver(g, w, h, aspect);
      e.rule(5, 1.4);
      e.rule(95, 1.4);
      e.rule(73, 0.8);
      e.rule(27, 0.6);
      e.scale(95, -1, [21, 14, 8]);
      // u runs counter-clockwise (seen from above) from the east point; north is a quarter turn on
      const at = (deg) => (((deg + 360) % 360) / 360) * w;
      // azimuth numerals, counted clockwise from north
      for (let d = 0; d < 360; d += 10) if (d % 90) e.text(String((450 - d) % 360), at(d), 64, 9);
      const cardinal = [
        ['ORIENS', 0],
        ['SEPTENTRIO', 90],
        ['OCCIDENS', 180],
        ['MERIDIES', 270],
      ];
      for (const [name, d] of cardinal) {
        e.text(name, at(d), 52, 26, { spacing: 5 });
        // a small lozenge either side
        for (const s of [-1, 1]) {
          const x = at(d) + s * w * 0.034;
          g.beginPath();
          g.moveTo(x, 42 * e.px);
          g.lineTo(x + 3 * e.px, 52 * e.px);
          g.lineTo(x, 62 * e.px);
          g.lineTo(x - 3 * e.px, 52 * e.px);
          g.closePath();
          g.fill();
        }
      }
      const words = ['SCHOLÉ', 'LEISURE DEVOTED TO LEARNING', 'ANNO MMXXVI', 'PRIVATE ROOMS FOR SERIOUS STUDY'];
      words.forEach((wd, i) => e.text(wd, at(45 + i * 90), 52, 20, { italic: true, spacing: 4 }));
      e.scale(5, 1, [0, 0, 6], 720);
    },
    { wrap: true },
  );
}

/** The meridian's face: latitude 0 at the equator to 90 at each pole, every degree. */
export function meridianDial({ w, h, aspect }) {
  return make(
    w,
    h,
    (g) => {
      metalStrip(g, w, h, 37);
      const e = engraver(g, w, h, aspect);
      e.rule(5, 1.6);
      e.rule(95, 1.6);
      e.rule(40, 0.8);
      e.scale(95, -1, [32, 22, 13]);
      for (let d = 0; d < 360; d += 10) {
        const lat = 90 - Math.abs((d % 180) - 90);
        e.text(String(lat), (d / 360) * w, 22, 26);
      }
    },
    { wrap: true },
  );
}

/** Equirectangular sky for the celestial globe: graticule, gilt constellation figures, stars. */
export function celestialGlobe({ w }) {
  const h = w / 2;
  return make(w, h, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a1022');
    grad.addColorStop(0.5, '#16203d');
    grad.addColorStop(1, '#0a1022');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const u = w / 2048;
    g.strokeStyle = 'rgba(214,180,120,0.22)';
    g.lineWidth = 1.2 * u;
    for (let i = 1; i < 24; i += 1) {
      g.beginPath();
      g.moveTo((i / 24) * w, h * 0.04);
      g.lineTo((i / 24) * w, h * 0.96);
      g.stroke();
    }
    for (let j = 1; j < 12; j += 1) {
      g.beginPath();
      g.moveTo(0, (j / 12) * h);
      g.lineTo(w, (j / 12) * h);
      g.stroke();
    }
    // the ecliptic as a dashed gilt line, a sinusoid on the map
    g.strokeStyle = 'rgba(232,200,140,0.55)';
    g.setLineDash([10 * u, 8 * u]);
    g.lineWidth = 2 * u;
    g.beginPath();
    for (let x = 0; x <= w; x += 4) g.lineTo(x, h / 2 - Math.sin((x / w) * Math.PI * 2) * h * 0.13);
    g.stroke();
    g.setLineDash([]);
    const r = rng(7);
    for (let i = 0; i < 1100; i += 1) {
      const big = r() > 0.94;
      g.fillStyle = `rgba(244,226,180,${0.25 + r() * 0.6})`;
      g.beginPath();
      g.arc(r() * w, h * 0.05 + r() * h * 0.9, (big ? 2.2 : 0.6 + r() * 1.1) * u, 0, Math.PI * 2);
      g.fill();
    }
    // twenty-eight figures: chains and loops of bright stars joined by fine gilt lines
    for (let k = 0; k < 28; k += 1) {
      const x0 = 40 * u + r() * (w - 160 * u);
      const y0 = h * 0.14 + r() * h * 0.72;
      const pts = [[x0, y0]];
      const n = 4 + Math.floor(r() * 5);
      for (let j = 0; j < n; j += 1) {
        const [px, py] = pts[pts.length - 1];
        pts.push([px + (r() * 0.9 - 0.25) * 70 * u, py + (r() - 0.5) * 60 * u]);
      }
      g.strokeStyle = 'rgba(232,200,140,0.7)';
      g.lineWidth = 1.4 * u;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      if (r() > 0.6) g.lineTo(...pts[1]);
      g.stroke();
      for (const [x, y] of pts) {
        g.fillStyle = '#f7e2ad';
        g.beginPath();
        g.arc(x, y, 3 * u, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(247,226,173,0.25)';
        g.beginPath();
        g.arc(x, y, 7 * u, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

/** The plinth's top (planar UVs): a guilloché rosette and a compass rose in gold on lacquer. */
export function plinthTop({ size }) {
  return make(size, size, (g) => {
    const S = size;
    const c = S / 2;
    const u = S / 1024;
    g.fillStyle = '#10172b';
    g.fillRect(0, 0, S, S);
    // guilloché: many phase-shifted strands of a lobed circle
    g.strokeStyle = 'rgba(214,180,120,0.5)';
    g.lineWidth = 0.9 * u;
    const strands = (r, amp, lobes, count) => {
      for (let s = 0; s < count; s += 1) {
        const ph = (2 * Math.PI * s) / count;
        g.beginPath();
        for (let i = 0; i <= 900; i += 1) {
          const t = (i / 900) * Math.PI * 2;
          const rad = r + amp * Math.sin(lobes * t + ph);
          if (i) g.lineTo(c + rad * Math.cos(t), c + rad * Math.sin(t));
          else g.moveTo(c + rad * Math.cos(t), c + rad * Math.sin(t));
        }
        g.stroke();
      }
    };
    strands(S * 0.395, S * 0.035, 36, 20);
    // compass rose: eight points, the cardinals long
    for (let i = 0; i < 16; i += 1) {
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      const long = i % 4 === 0 ? 0.33 : i % 2 === 0 ? 0.27 : 0.21;
      const half = Math.PI / (i % 4 === 0 ? 22 : 18);
      for (const side of [0, 1]) {
        g.fillStyle = side ? 'rgba(232,200,140,0.9)' : 'rgba(150,116,62,0.9)';
        g.beginPath();
        g.moveTo(c, c);
        g.lineTo(c + Math.cos(a + (side ? half : -half)) * S * 0.08, c + Math.sin(a + (side ? half : -half)) * S * 0.08);
        g.lineTo(c + Math.cos(a) * S * long, c + Math.sin(a) * S * long);
        g.closePath();
        g.fill();
      }
    }
    g.strokeStyle = 'rgba(214,180,120,0.85)';
    for (const [r, lw] of [
      [0.485, 3],
      [0.47, 1],
      [0.345, 1.4],
      [0.335, 0.8],
    ]) {
      g.lineWidth = lw * u;
      g.beginPath();
      g.arc(c, c, S * r, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

/**
 * A flat annulus with strip UVs: u runs counter-clockwise (seen from +z) from the +x axis, v=1 at
 * the inner edge and v=0 at the outer. Lettering on it has its tops toward the centre, so it reads
 * upright to someone standing outside the ring, as an instrument maker engraves it.
 */
export function annulusGeometry(r0, r1, segments) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const a = t * Math.PI * 2;
    for (const [r, v] of [
      [r0, 1],
      [r1, 0],
    ]) {
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      uv.push(t, v);
    }
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); // counter-clockwise seen from +z: the face looks along +z
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
