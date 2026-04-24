import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../utils/api";

// ─── Math helpers (all client-side, no backend needed for live animation) ───

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const gaussRand = () => {
  let u = 0, v2 = 0;
  while (u === 0) u = Math.random();
  while (v2 === 0) v2 = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v2);
};

function getWeights(N, type) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const n = i / Math.max(N - 1, 1);
    switch (type) {
      case "hanning":  w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * n)); break;
      case "hamming":  w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * n); break;
      case "blackman": w[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n); break;
      case "kaiser":   { const b = 6, x = 2 * n - 1; w[i] = Math.exp(-0.5 * b * b * (1 - x * x)); break; }
      case "gaussian": { const s = 0.35; w[i] = Math.exp(-0.5 * ((n - 0.5) / s) ** 2); break; }
      default:         w[i] = 1;
    }
  }
  const mx = Math.max(...w, 1e-12);
  for (let i = 0; i < N; i++) w[i] /= mx;
  return w;
}

function getElemPos(N, d, layout, curvature) {
  const pos = [];
  if (layout === "linear") {
    for (let n = 0; n < N; n++) pos.push({ x: (n - (N - 1) / 2) * d, y: 0 });
  } else if (layout === "curved") {
    const arc = clamp(curvature, 5, 180) * DEG;
    const R = N > 1 ? d * (N - 1) / arc : d;
    for (let n = 0; n < N; n++) {
      const a = -arc / 2 + n * arc / Math.max(N - 1, 1);
      pos.push({ x: R * Math.sin(a), y: R * (1 - Math.cos(a)) });
    }
  } else { // circular
    const R = d * N / (2 * Math.PI);
    for (let n = 0; n < N; n++) {
      const a = 2 * Math.PI * n / N;
      pos.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
    }
  }
  return pos;
}

function computeAF(thetaDeg, p, noisy = false) {
  const lambda = p.speed / p.frequency;
  const d = p.spacing_ratio * lambda;
  const snrLin = p.snr_db >= 60 ? Infinity : Math.pow(10, p.snr_db / 10);
  const amp = 1.0;
  const k = 2 * Math.PI / lambda;
  const weights = getWeights(p.num_elements, p.window);
  const pos = getElemPos(p.num_elements, d, p.layout, p.curvature_radius);
  const steer = p.beam_direction * DEG;
  const t = thetaDeg * DEG;
  const noiseAmp = (noisy && isFinite(snrLin)) ? amp / (snrLin * 3) : 0;
  let re = 0, im = 0;
  for (let n = 0; n < p.num_elements; n++) {
    const px = pos[n].x, py = pos[n].y || 0;
    const scanP  = k * (px * Math.sin(t)     + py * Math.cos(t));
    const steerP = k * (px * Math.sin(steer) + py * Math.cos(steer));
    const beta = scanP - steerP;
    const wn = weights[n] * amp + (noiseAmp ? gaussRand() * noiseAmp : 0);
    re += wn * Math.cos(beta);
    im += wn * Math.sin(beta);
  }
  return Math.sqrt(re * re + im * im);
}

// Peak AF (at steering angle) = sum of weights * amp → used for gain normalization
function getPeakAF(p) {
  const weights = getWeights(p.num_elements, p.window);
  return weights.reduce((a, b) => a + b, 0); // amp=1, cos(0)=1
}

function computeAFdB(thetaDeg, p, noisy = false) {
  const peak = getPeakAF(p);
  const af = computeAF(thetaDeg, p, noisy);
  return af / peak <= 0 ? -80 : 20 * Math.log10(af / peak);
}

function computeMetrics(p) {
  let peakDb = -Infinity;
  const vals = [];
  for (let a = -180; a <= 180; a += 0.3) {
    const db = computeAFdB(a, p);
    vals.push({ a, db });
    if (db > peakDb) peakDb = db;
  }
  // HPBW
  let lo = p.beam_direction, hi = p.beam_direction;
  for (const v of vals) {
    if (Math.abs(v.a - p.beam_direction) < 60 && v.db < peakDb - 3) {
      if (v.a < p.beam_direction) lo = v.a; else { hi = v.a; break; }
    }
  }
  const hpbw = Math.max(0.1, hi - lo);
  // SLL
  let sll = -80;
  for (let i = 1; i < vals.length - 1; i++) {
    if (vals[i].db > vals[i-1].db && vals[i].db > vals[i+1].db &&
        Math.abs(vals[i].a - p.beam_direction) > hpbw * 0.8 && vals[i].db > sll)
      sll = vals[i].db;
  }
  // nulls
  let nulls = 0;
  for (let i = 1; i < vals.length - 1; i++)
    if (vals[i].db < vals[i-1].db - 1.5 && vals[i].db < vals[i+1].db - 1.5) nulls++;
  // Gain = 10*log10(N) + window correction
  const weights = getWeights(p.num_elements, p.window);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const gain = 10 * Math.log10(p.num_elements * sumW / p.num_elements);
  return {
    sll: sll.toFixed(1),
    hpbw: hpbw.toFixed(1),
    gain: gain.toFixed(1),
    nulls,
    peak: peakDb.toFixed(1)
  };
}

// ─── Canvas draw functions ───────────────────────────────────────────────────

function drawAnimatedField(canvas, p, waveT) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#03080f";
  ctx.fillRect(0, 0, W, H);

  const lambda = p.speed / p.frequency;
  const d = p.spacing_ratio * lambda;
  const cx = W / 2, cy = H * 0.80;
  const scale = 18 * lambda;
  const pos = getElemPos(p.num_elements, d, p.layout, p.curvature_radius);
  const weights = getWeights(p.num_elements, p.window);
  const steer = p.beam_direction * DEG;
  const k = 2 * Math.PI / lambda;

  // Draw beam overlay (pattern shape)
  const peak = getPeakAF(p);
  const R = Math.min(W, H) * 0.45;
  ctx.beginPath();
  for (let ti = -90; ti <= 90; ti += 0.5) {
    const af = computeAF(ti, p) / peak;
    const r = R * clamp(af, 0, 1);
    const x = cx + r * Math.sin(ti * DEG);
    const y = cy - r * Math.cos(ti * DEG);
    ti === -90 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(0,212,255,0.65)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "rgba(0,212,255,0.05)";
  ctx.fill();

  // Animated wave rings from each element
  pos.forEach((ep, n) => {
    const ex = cx + ep.x / scale * W;
    const ey = cy + (ep.y || 0) / scale * H * 0.3;
    const steerPh = k * ep.x * Math.sin(steer);

    for (let ring = 0; ring < 3; ring++) {
      const ringR = ((waveT - steerPh / (2 * Math.PI) + ring) * 40 + 5) % 120;
      if (ringR <= 0 || ringR > H * 0.75) continue;
      const alpha = weights[n] * (1 - ringR / (H * 0.75)) * 0.55;
      ctx.beginPath();
      if (p.layout === "circular") {
        ctx.arc(ex, ey, ringR, 0, 2 * Math.PI);
      } else {
        ctx.arc(ex, ey, ringR, Math.PI, 2 * Math.PI);
      }
      ctx.strokeStyle = `rgba(0,212,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Element dot
    const brightness = 0.35 + 0.65 * weights[n];
    ctx.fillStyle = `rgba(0,212,255,${brightness})`;
    ctx.beginPath();
    ctx.arc(ex, ey, 3.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "rgba(90,133,170,0.7)";
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText(n + 1, ex, ey + 13);
  });

  // Beam direction arrow
  ctx.strokeStyle = "rgba(255,107,53,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(steer) * Math.min(W, H) * 0.38, cy - Math.cos(steer) * Math.min(W, H) * 0.38);
  ctx.stroke();

  ctx.fillStyle = "rgba(90,133,170,0.6)";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("LIVE FIELD + WAVES", 8, 14);
}

function drawPolarPattern(canvas, p) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#03080f";
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.4;

  // Grid
  ctx.strokeStyle = "rgba(26,58,106,0.5)";
  ctx.lineWidth = 0.5;
  for (let r = 1; r <= 4; r++) { ctx.beginPath(); ctx.arc(cx, cy, R * r / 4, 0, 2 * Math.PI); ctx.stroke(); }
  for (let a = 0; a < 360; a += 30) {
    const rad = (a - 90) * DEG;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad));
    ctx.strokeStyle = "rgba(26,58,106,0.4)"; ctx.stroke();
    ctx.fillStyle = "rgba(90,133,170,0.6)"; ctx.font = "7px monospace"; ctx.textAlign = "center";
    ctx.fillText(a + "°", cx + (R + 9) * Math.cos(rad), cy + (R + 9) * Math.sin(rad) + 3);
  }

  // Pattern (full 360°)
  const peak = getPeakAF(p);
  ctx.beginPath();
  for (let ti = -180; ti <= 180; ti += 0.5) {
    const af = computeAF(ti, p) / peak;
    const r = R * clamp(af, 0, 1.05);
    const rad = (ti - 90) * DEG;
    ti === -180 ? ctx.moveTo(cx + r * Math.cos(rad), cy + r * Math.sin(rad))
                : ctx.lineTo(cx + r * Math.cos(rad), cy + r * Math.sin(rad));
  }
  ctx.strokeStyle = "#00d4ff"; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = "rgba(0,212,255,0.05)"; ctx.fill();

  ctx.fillStyle = "rgba(90,133,170,0.6)"; ctx.font = "9px monospace"; ctx.textAlign = "left";
  ctx.fillText("POLAR (360°)", 6, 13);
}

function drawAFPlot(canvas, p) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#03080f";
  ctx.fillRect(0, 0, W, H);

  const pad = 28, pw = W - pad - 6, ph = H - pad - 6;

  // Grid
  ctx.strokeStyle = "rgba(26,58,106,0.4)"; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad + ph * i / 4;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + pw, y); ctx.stroke();
  }
  ctx.fillStyle = "rgba(90,133,170,0.6)"; ctx.font = "7px monospace"; ctx.textAlign = "right";
  ["0dB", "-20", "-40", "-60", "-80"].forEach((l, i) => ctx.fillText(l, pad - 2, pad + ph * i / 4 + 4));

  // Angle axis
  ctx.fillStyle = "rgba(90,133,170,0.4)"; ctx.textAlign = "center";
  [-90, -60, -30, 0, 30, 60, 90].forEach(a => {
    const x = pad + (a + 90) / 180 * pw;
    ctx.fillText(a + "°", x, pad + ph + 10);
  });

  // Clean pattern
  ctx.beginPath();
  for (let i = 0; i <= pw; i++) {
    const ti = -90 + 180 * i / pw;
    const db = clamp(computeAFdB(ti, p), -80, 0);
    const y = pad + ph * (1 - (db + 80) / 80);
    i === 0 ? ctx.moveTo(pad + i, y) : ctx.lineTo(pad + i, y);
  }
  ctx.strokeStyle = "#00ff9d"; ctx.lineWidth = 1.4; ctx.stroke();

  // Noisy overlay if SNR < 60
  if (p.snr_db < 60) {
    ctx.beginPath();
    for (let i = 0; i <= pw; i++) {
      const ti = -90 + 180 * i / pw;
      const db = clamp(computeAFdB(ti, p, true), -80, 0);
      const y = pad + ph * (1 - (db + 80) / 80);
      i === 0 ? ctx.moveTo(pad + i, y) : ctx.lineTo(pad + i, y);
    }
    ctx.strokeStyle = "rgba(255,107,53,0.45)"; ctx.lineWidth = 0.8; ctx.stroke();
  }

  // Steering marker
  const sx = pad + (p.beam_direction + 90) / 180 * pw;
  ctx.strokeStyle = "rgba(255,107,53,0.6)"; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(sx, pad); ctx.lineTo(sx, pad + ph); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(90,133,170,0.6)"; ctx.font = "9px monospace"; ctx.textAlign = "left";
  ctx.fillText("ARRAY FACTOR (dB)", 6, 11);
}

function drawInterferenceMap(canvas, ifData, positions) {
  if (!canvas || !canvas.width || !ifData) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#03080f";
  ctx.fillRect(0, 0, W, H);

  const { intensity, x_range, y_range } = ifData;
  if (!intensity) return;

  const rows = intensity.length, cols = intensity[0].length;
  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = intensity[row][col]; // -1 to 1
      let r, g, b;
      if (v < 0) {
        const t = -v;
        r = Math.round(t * 30); g = Math.round(t * 50); b = Math.round(30 + t * 200);
      } else {
        const t = v;
        r = Math.round(t * 220); g = Math.round(t * 50); b = Math.round(t * 30);
      }
      // map row/col → pixel
      const px = Math.round(col / cols * W);
      const py = Math.round((rows - 1 - row) / rows * H);
      const cellW2 = Math.ceil(W / cols), cellH2 = Math.ceil(H / rows);
      for (let dy = 0; dy < cellH2; dy++) for (let dx = 0; dx < cellW2; dx++) {
        const idx = ((py + dy) * W + (px + dx)) * 4;
        if (idx + 3 < data.length) {
          data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 200;
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Antenna positions
  if (positions && x_range && y_range) {
    const xS = W / (x_range[1] - x_range[0]);
    const yS = H / (y_range[1] - y_range[0]);
    positions.forEach(([px, py]) => {
      const cx = (px - x_range[0]) * xS;
      const cy = H - (py - y_range[0]) * yS;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
      ctx.fillStyle = "#00ff88"; ctx.shadowColor = "#00ff88"; ctx.shadowBlur = 8;
      ctx.fill(); ctx.shadowBlur = 0;
    });
  }

  ctx.fillStyle = "rgba(136,153,187,0.7)"; ctx.font = "9px monospace"; ctx.textAlign = "left";
  ctx.fillText("INTERFERENCE MAP", 8, 14);

  // Legend
  const lgW = 80, lgH = 10, lgX = W - lgW - 10, lgY = H - 18;
  const grad = ctx.createLinearGradient(lgX, 0, lgX + lgW, 0);
  grad.addColorStop(0, "rgb(30,50,230)");
  grad.addColorStop(0.5, "rgb(5,5,5)");
  grad.addColorStop(1, "rgb(220,50,30)");
  ctx.fillStyle = grad; ctx.fillRect(lgX, lgY, lgW, lgH);
  ctx.fillStyle = "rgba(136,153,187,0.7)"; ctx.font = "8px monospace";
  ctx.fillText("−", lgX - 8, lgY + 9); ctx.fillText("+", lgX + lgW + 2, lgY + 9);
}

function drawWeightsPanel(canvas, p) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#03080f"; ctx.fillRect(0, 0, W, H);

  const weights = getWeights(p.num_elements, p.window);
  const lambda = p.speed / p.frequency;
  const d = p.spacing_ratio * lambda;
  const k = 2 * Math.PI / lambda;
  const steer = p.beam_direction * DEG;
  const bw = Math.max(1, Math.floor((W - 16) / p.num_elements) - 1);
  const pad = 8;

  weights.forEach((w, n) => {
    const x = pad + n * (bw + 1);
    const barH = Math.round((H - 20) * w);
    const ph = ((n * k * d * Math.sin(steer)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    ctx.fillStyle = `hsl(${Math.round(ph / (2 * Math.PI) * 360)},75%,${40 + 30 * w}%)`;
    ctx.fillRect(x, H - 14 - barH, bw, barH);
  });

  ctx.fillStyle = "rgba(90,133,170,0.6)"; ctx.font = "9px monospace"; ctx.textAlign = "left";
  ctx.fillText("ELEMENT WEIGHTS / PHASE", pad, 11);
}

// ─── Presets & constants ─────────────────────────────────────────────────────

const WINDOWS = ["rectangular", "hanning", "hamming", "blackman", "kaiser", "gaussian"];
const LAYOUTS = ["linear", "curved", "circular"];

const DEFAULT_PARAMS = {
  num_elements: 8,
  frequency: 10e9,
  beam_direction: 0,
  spacing_ratio: 0.5,
  layout: "linear",
  curvature_radius: 60,
  window: "rectangular",
  snr_db: 60,
  speed: 3e8,
};

const PRESETS = {
  MEDICAL:      { num_elements: 32, frequency: 5e6,  beam_direction: 5,  spacing_ratio: 0.5, layout: "curved",   window: "hamming",   snr_db: 45, speed: 1540 },
  "URBAN 5G":   { num_elements: 16, frequency: 28e9, beam_direction: 20, spacing_ratio: 0.5, layout: "linear",   window: "hanning",   snr_db: 50, speed: 3e8  },
  "RADAR TRACK":{ num_elements: 24, frequency: 10e9, beam_direction: 0,  spacing_ratio: 0.5, layout: "circular", window: "blackman",  snr_db: 40, speed: 3e8  },
};

// ─── Slider component ────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step = 1, fmt, onChange }) {
  return (
    <div className="control-row">
      <div className="control-label">
        <span>{label}</span>
        <span className="control-value">{fmt ? fmt(value) : value}</span>
      </div>
      <input type="range" className="slider" min={min} max={max} step={step}
        value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BeamformingLab() {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [ifData, setIfData]   = useState(null);
  const [ifPos, setIfPos]     = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ifComputed, setIfComputed] = useState(false); // whether interference map has been computed

  // 4 canvases — always mounted, never unmount
  const fieldRef  = useRef(null); // top-left:  animated live field + waves
  const polarRef  = useRef(null); // top-right: polar beam pattern (360°)
  const afRef     = useRef(null); // bottom-left: AF dB vs angle
  const ifRef     = useRef(null); // bottom-right: interference map
  const wgtRef    = useRef(null); // tiny weights bar inside polar panel header

  const waveTRef    = useRef(0);
  const rafRef      = useRef(null);
  const paramsRef   = useRef(params);
  const ifDataRef   = useRef(null);
  const ifPosRef    = useRef(null);
  const ifComputedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { ifDataRef.current = ifData; ifPosRef.current = ifPos; }, [ifData, ifPos]);
  useEffect(() => { ifComputedRef.current = ifComputed; }, [ifComputed]);

  // Resize all 4 canvases
  const resizeAll = useCallback(() => {
    const grid = document.getElementById("bf-grid");
    if (!grid) return;
    [fieldRef, polarRef, afRef, ifRef].forEach(ref => {
      if (!ref.current) return;
      const parent = ref.current.parentElement;
      if (!parent) return;
      const { width, height } = parent.getBoundingClientRect();
      const W = Math.floor(width), H = Math.floor(height);
      if (ref.current.width !== W || ref.current.height !== H) {
        ref.current.width  = W;
        ref.current.height = H;
      }
    });
    if (wgtRef.current) {
      const p = wgtRef.current.parentElement;
      if (p) { wgtRef.current.width = p.clientWidth; wgtRef.current.height = 28; }
    }
  }, []);

  useEffect(() => {
    resizeAll();
    const obs = new ResizeObserver(resizeAll);
    const grid = document.getElementById("bf-grid");
    if (grid) obs.observe(grid);
    window.addEventListener("resize", resizeAll);
    return () => { obs.disconnect(); window.removeEventListener("resize", resizeAll); };
  }, [resizeAll]);

  // RAF animation loop — draws all 4 panels every frame
  useEffect(() => {
    let lastMetricsT = 0;

    function loop(ts) {
      waveTRef.current = (waveTRef.current + 0.07) % (2 * Math.PI);
      const p = paramsRef.current;

      // Panel 1: animated field (every frame — this is the "live" panel)
      drawAnimatedField(fieldRef.current, p, waveTRef.current);

      // Panel 2: polar pattern (every frame — reacts to param changes instantly)
      drawPolarPattern(polarRef.current, p);

      // Panel 3: AF plot (every frame)
      drawAFPlot(afRef.current, p);

      // Panel 4: interference map (only when computed, static image)
      if (ifComputedRef.current) {
        drawInterferenceMap(ifRef.current, ifDataRef.current, ifPosRef.current);
      } else {
        // Show placeholder
        const c = ifRef.current;
        if (c && c.width) {
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#03080f"; ctx.fillRect(0, 0, c.width, c.height);
          ctx.fillStyle = "rgba(90,133,170,0.4)"; ctx.font = "11px monospace"; ctx.textAlign = "center";
          ctx.fillText("Click  ▶ Compute Interference  to generate", c.width/2, c.height/2 - 8);
          ctx.fillText("(CPU-intensive — computed on demand)", c.width/2, c.height/2 + 12);
          ctx.textAlign = "left";
        }
      }

      // Weights taper bar
      drawWeightsPanel(wgtRef.current, p);

      // Metrics refresh every 1.2s
      if (ts - lastMetricsT > 1200) {
        setMetrics(computeMetrics(p));
        lastMetricsT = ts;
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []); // intentionally empty — loop reads refs

  // Compute interference map (backend call — on-demand only)
  const computeInterference = useCallback(async () => {
    setLoading(true);
    try {
      const [imap, pos] = await Promise.all([
        api.interferenceMap({ ...params, resolution: 160 }),
        api.antennaPositions(params),
      ]);
      setIfData(imap);
      setIfPos(pos.positions);
      setIfComputed(true);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [params]);

  const set = key => val => setParams(prev => ({ ...prev, [key]: val }));

  const freqLabel = v => {
    if (v >= 1e9) return (v/1e9).toFixed(2) + " GHz";
    if (v >= 1e6) return (v/1e6).toFixed(2) + " MHz";
    return v + " Hz";
  };
  const snrLabel = v => v >= 60 ? "∞ dB" : v + " dB";

  return (
    <div className="page" style={{ flexDirection: "column" }}>

      {/* ── Top toolbar ── */}
      <div style={{
        padding: "6px 14px", borderBottom: "1px solid var(--border)",
        display: "flex", gap: 10, alignItems: "center", flexShrink: 0,
        background: "var(--panel)"
      }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", letterSpacing: 2 }}>
          BEAMFORMING LAB
        </span>
        <div style={{ width: 1, height: 16, background: "var(--border2)" }} />
        {Object.keys(PRESETS).map(name => (
          <button key={name} className="btn"
            onClick={() => setParams(p => ({ ...p, ...PRESETS[name], curvature_radius: 60 }))}>
            {name}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className={`btn primary ${loading ? "" : ""}`}
            onClick={computeInterference}
            disabled={loading}
            title="Compute the 2D interference map (bottom-right panel)">
            {loading ? "⏳ Computing…" : "▶ Compute Interference"}
          </button>
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text3)" }}>
            panels 1–3 update live · panel 4 on demand
          </span>
        </div>
      </div>

      {/* ── Main area: sidebar + 4-panel grid ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

        {/* Left sidebar */}
        <div className="sidebar" style={{ width: 240 }}>

          <div className="panel-section">
            <div className="panel-title">Array Config</div>
            <Slider label="Elements N" value={params.num_elements} min={2} max={32} step={1}
              fmt={v => v} onChange={set("num_elements")} />
            <Slider label="Frequency" value={params.frequency} min={1e6} max={100e9} step={5e7}
              fmt={freqLabel} onChange={set("frequency")} />
            <Slider label="Spacing d/λ" value={params.spacing_ratio} min={0.1} max={2} step={0.05}
              fmt={v => v.toFixed(2) + "λ"} onChange={set("spacing_ratio")} />
            <Slider label="Steer θ°" value={params.beam_direction} min={-90} max={90} step={1}
              fmt={v => v + "°"} onChange={set("beam_direction")} />
            <Slider label="SNR" value={params.snr_db} min={0} max={60} step={1}
              fmt={snrLabel} onChange={set("snr_db")} />
          </div>

          <div className="panel-section">
            <div className="panel-title">Geometry</div>
            <div className="toggle-group">
              {LAYOUTS.map(l => (
                <button key={l} className={`toggle-btn ${params.layout === l ? "active" : ""}`}
                  onClick={() => setParams(p => ({ ...p, layout: l }))}>
                  {l}
                </button>
              ))}
            </div>
            {params.layout === "curved" && (
              <Slider label="Curvature°" value={params.curvature_radius} min={10} max={180} step={1}
                fmt={v => v + "°"} onChange={set("curvature_radius")} />
            )}
          </div>

          <div className="panel-section">
            <div className="panel-title">Apodization / Window</div>
            <select className="select" value={params.window}
              onChange={e => setParams(p => ({ ...p, window: e.target.value }))}>
              {WINDOWS.map(w => (
                <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>
              ))}
            </select>
            <canvas ref={wgtRef} style={{ display: "block", width: "100%", height: 28, marginTop: 5 }} />
          </div>

          <div className="panel-section">
            <div className="panel-title">Metrics</div>
            {metrics ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {[
                  ["SLL", metrics.sll + " dB"],
                  ["HPBW", metrics.hpbw + "°"],
                  ["GAIN", metrics.gain + " dB"],
                  ["NULLS", metrics.nulls],
                ].map(([lbl, val]) => (
                  <div key={lbl} style={{
                    background: "var(--bg3)", border: "1px solid var(--border)",
                    borderRadius: 3, padding: "5px 4px", textAlign: "center"
                  }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent3)" }}>{val}</div>
                    <div style={{ fontSize: 8, color: "var(--text2)", marginTop: 2, letterSpacing: 1 }}>{lbl}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>Computing…</div>
            )}
          </div>

          <div className="panel-section">
            <div className="panel-title">Wave Speed</div>
            <div className="toggle-group">
              {[["EM (3×10⁸)", 3e8], ["Sound (1540)", 1540]].map(([lbl, v]) => (
                <button key={lbl} className={`toggle-btn ${params.speed === v ? "active" : ""}`}
                  onClick={() => setParams(p => ({ ...p, speed: v }))}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4-panel grid */}
        <div id="bf-grid" style={{
          flex: 1, display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 4, padding: 4,
          overflow: "hidden"
        }}>

          {/* Panel 1 — Animated live field */}
          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">◎ LIVE FIELD + WAVES</span>
              <span style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                animated · auto-updates
              </span>
            </div>
            <div className="viz-body" style={{ overflow: "hidden", position: "relative" }}>
              <canvas ref={fieldRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />
            </div>
          </div>

          {/* Panel 2 — Polar beam pattern */}
          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">◉ POLAR PATTERN (360°)</span>
              <span style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                live · normalized
              </span>
            </div>
            <div className="viz-body" style={{ overflow: "hidden", position: "relative" }}>
              <canvas ref={polarRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />
            </div>
          </div>

          {/* Panel 3 — Array Factor (dB) */}
          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">▸ ARRAY FACTOR (dB)</span>
              <span style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                live · {params.snr_db < 60 ? "noisy overlay shown" : "ideal"}
              </span>
            </div>
            <div className="viz-body" style={{ overflow: "hidden", position: "relative" }}>
              <canvas ref={afRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />
            </div>
          </div>

          {/* Panel 4 — Interference map (on demand) */}
          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">⊞ INTERFERENCE MAP</span>
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)",
                color: ifComputed ? "var(--accent4)" : "var(--text3)" }}>
                {ifComputed ? "computed · static" : "click ▶ Compute to generate"}
              </span>
            </div>
            <div className="viz-body" style={{ overflow: "hidden", position: "relative" }}>
              <canvas ref={ifRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />
            </div>
          </div>

        </div>
      </div>

      {/* Status bar */}
      <div className="status-bar">
        <div className="status-item">N <span>{params.num_elements}</span></div>
        <div className="status-item">freq <span>{freqLabel(params.frequency)}</span></div>
        <div className="status-item">d/λ <span>{params.spacing_ratio.toFixed(2)}</span></div>
        <div className="status-item">θ <span>{params.beam_direction}°</span></div>
        <div className="status-item">window <span>{params.window}</span></div>
        <div className="status-item">SNR <span>{snrLabel(params.snr_db)}</span></div>
        <div className="status-item">λ <span>
          {params.speed >= 1e6
            ? ((params.speed / params.frequency) * 1000).toFixed(2) + " mm"
            : ((params.speed / params.frequency) * 100).toFixed(3) + " cm"}
        </span></div>
        {metrics && <div className="status-item">HPBW <span>{metrics.hpbw}°</span></div>}
        {metrics && <div className="status-item">Gain <span>{metrics.gain} dB</span></div>}
      </div>
    </div>
  );
}
