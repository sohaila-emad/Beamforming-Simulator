import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api";

// ─── Phantom draw ─────────────────────────────────────────────────────────────
function drawPhantom(canvas, structures, probe, hoveredId, selectedId, vessel, mousePos) {
  if (!canvas || !structures) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#030810"; ctx.fillRect(0, 0, W, H);

  const scaleX = W / 20, scaleY = H / 22;
  const toCx = (cx) => W / 2 + cx * scaleX;
  const toCy = (cy) => H / 2 + cy * scaleY;
  const toRx = (rx) => rx * scaleX;
  const toRy = (ry) => ry * scaleY;

  // Tissue structures
  [...structures].forEach(s => {
    const cx2 = toCx(s.cx), cy2 = toCy(s.cy);
    const rx = toRx(s.rx), ry = toRy(s.ry);
    ctx.save();
    ctx.translate(cx2, cy2);
    ctx.rotate(s.rotation * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, 2 * Math.PI);
    const isHov = s.id === hoveredId, isSel = s.id === selectedId;
    ctx.fillStyle = s.color + (isSel ? "ff" : "cc");
    ctx.fill();
    if (isHov || isSel) {
      ctx.strokeStyle = isSel ? "#ffb800" : "#ffffff";
      ctx.lineWidth = 2; ctx.shadowColor = isSel ? "#ffb800" : "#fff"; ctx.shadowBlur = 8;
      ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.restore();
  });

  // ── Inline hover tooltip drawn at mouse position ──────────────────────────
  if (hoveredId && mousePos) {
    const hovS = structures.find(s => s.id === hoveredId);
    if (hovS) {
      const lines = [
        hovS.label,
        `Z = ${(hovS.acoustic_impedance / 1e6).toFixed(3)} MRayl`,
        `α = ${hovS.attenuation_db_cm} dB/cm/MHz`,
        `c = ${hovS.speed_of_sound} m/s`,
      ];
      const PAD = 8, LINE_H = 14, TIP_W = 160, TIP_H = PAD * 2 + lines.length * LINE_H;
      // Keep tooltip inside canvas bounds
      let tx = mousePos.x + 14, ty = mousePos.y - TIP_H / 2;
      if (tx + TIP_W > W - 4) tx = mousePos.x - TIP_W - 14;
      if (ty < 4) ty = 4;
      if (ty + TIP_H > H - 4) ty = H - TIP_H - 4;

      // Shadow + background
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
      ctx.fillStyle = "rgba(5,12,28,0.92)";
      ctx.beginPath();
      ctx.roundRect(tx, ty, TIP_W, TIP_H, 5);
      ctx.fill();
      ctx.restore();

      // Border
      ctx.strokeStyle = "#00d4ff55"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tx, ty, TIP_W, TIP_H, 5); ctx.stroke();

      // Text
      ctx.textAlign = "left";
      lines.forEach((line, i) => {
        const ly = ty + PAD + i * LINE_H + 10;
        if (i === 0) {
          ctx.font = "bold 10px monospace"; ctx.fillStyle = "#ffffff";
        } else {
          ctx.font = "9px monospace"; ctx.fillStyle = "#7dc8e8";
        }
        ctx.fillText(line, tx + PAD, ly);
      });

      // Tiny connector dot
      ctx.beginPath(); ctx.arc(mousePos.x, mousePos.y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = "#00d4ff"; ctx.shadowColor = "#00d4ff"; ctx.shadowBlur = 6;
      ctx.fill(); ctx.shadowBlur = 0;
    }
  }

  // Blood vessel — drawn as an animated tube
  if (vessel) {
    const vx = toCx(vessel.cx), vy = toCy(vessel.cy);
    const vRad = vessel.angle * Math.PI / 180;
    const len = 80;
    const dx = Math.cos(vRad) * len, dy = Math.sin(vRad) * len;
    const r = 8;

    ctx.save();
    // Vessel tube
    ctx.beginPath();
    ctx.moveTo(vx - dx, vy - dy);
    ctx.lineTo(vx + dx, vy + dy);
    ctx.strokeStyle = "#cc2244cc";
    ctx.lineWidth = r * 2;
    ctx.lineCap = "round";
    ctx.stroke();

    // Vessel outline
    ctx.beginPath();
    ctx.moveTo(vx - dx, vy - dy);
    ctx.lineTo(vx + dx, vy + dy);
    ctx.strokeStyle = "#ff4466";
    ctx.lineWidth = r * 2 + 2;
    ctx.stroke();

    // Blood flow arrows
    ctx.strokeStyle = "#ff8899";
    ctx.lineWidth = 1.5;
    const arrowSpacing = 30;
    for (let t = -1; t <= 1; t += 0.5) {
      const ax = vx + dx * t, ay = vy + dy * t;
      const alen = 10;
      ctx.beginPath();
      ctx.moveTo(ax - Math.cos(vRad) * alen, ay - Math.sin(vRad) * alen);
      ctx.lineTo(ax + Math.cos(vRad) * alen, ay + Math.sin(vRad) * alen);
      ctx.stroke();
      // Arrowhead
      const ahead = 5;
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(vRad) * alen, ay + Math.sin(vRad) * alen);
      ctx.lineTo(ax + Math.cos(vRad + 2.5) * ahead + Math.cos(vRad) * alen,
                 ay + Math.sin(vRad + 2.5) * ahead + Math.sin(vRad) * alen);
      ctx.moveTo(ax + Math.cos(vRad) * alen, ay + Math.sin(vRad) * alen);
      ctx.lineTo(ax + Math.cos(vRad - 2.5) * ahead + Math.cos(vRad) * alen,
                 ay + Math.sin(vRad - 2.5) * ahead + Math.sin(vRad) * alen);
      ctx.stroke();
    }

    ctx.fillStyle = "#ff6677"; ctx.font = "9px monospace"; ctx.textAlign = "center";
    ctx.fillText(`vessel ${vessel.velocity} cm/s`, vx, vy - r - 4);
    ctx.restore();
  }

  // Probe — draw on whichever edge it's on
  const { edge, pos, angle } = probe;
  let px, py, angleRad = angle * Math.PI / 180;
  if (edge === "bottom")      { px = W / 2 + pos * scaleX; py = H - 8; }
  else if (edge === "top")    { px = W / 2 + pos * scaleX; py = 8; }
  else if (edge === "left")   { px = 8; py = H / 2 + pos * scaleY; }
  else                         { px = W - 8; py = H / 2 + pos * scaleY; }

  // Probe rect perpendicular to edge
  ctx.save();
  ctx.translate(px, py);
  if (edge === "left" || edge === "right") ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#00d4ff"; ctx.shadowColor = "#00d4ff"; ctx.shadowBlur = 10;
  ctx.fillRect(-22, -4, 44, 6);
  ctx.shadowBlur = 0;
  ctx.restore();

  // Beam line from probe
  const beamDirRad = angleRad;
  let bx, by;
  if (edge === "bottom")      { bx = Math.sin(beamDirRad); by = -Math.cos(beamDirRad); }
  else if (edge === "top")    { bx = Math.sin(beamDirRad); by = Math.cos(beamDirRad); }
  else if (edge === "left")   { bx = Math.cos(beamDirRad); by = Math.sin(beamDirRad); }
  else                         { bx = -Math.cos(beamDirRad); by = Math.sin(beamDirRad); }

  ctx.beginPath(); ctx.moveTo(px, py);
  ctx.lineTo(px + bx * H * 1.2, py + by * H * 1.2);
  ctx.strokeStyle = "rgba(0,212,255,0.25)"; ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);

  ctx.fillStyle = "rgba(90,133,170,0.5)"; ctx.font = "9px monospace"; ctx.textAlign = "left";
  ctx.fillText("SHEPP-LOGAN PHANTOM  hover=inspect  click=edit", 8, 14);
  ctx.fillText(`probe: ${edge} edge, pos=${pos.toFixed(1)} cm, θ=${angle}°`, 8, H - 8);
}

// ─── A-mode draw ──────────────────────────────────────────────────────────────
function drawAmode(canvas, data) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#030810"; ctx.fillRect(0, 0, W, H);

  if (!data || !data.echo) {
    ctx.fillStyle = "rgba(90,133,170,0.35)"; ctx.font = "11px monospace"; ctx.textAlign = "center";
    ctx.fillText("A-mode — move probe to scan", W / 2, H / 2);
    ctx.textAlign = "left"; return;
  }

  const { echo, depth_cm } = data;
  const maxD = depth_cm[depth_cm.length - 1] || 20;
  const pL = 32, pB = 18, pT = 24, pw = W - pL - 8, ph = H - pB - pT;

  // Grid lines + depth labels
  const depthMarks = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20].filter(d => d <= maxD);
  depthMarks.forEach(d => {
    const x = pL + (d / maxD) * pw;
    ctx.strokeStyle = d === 0 ? "rgba(0,212,255,0.2)" : "rgba(26,50,90,0.35)";
    ctx.lineWidth = d % 5 === 0 ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, pT + ph); ctx.stroke();
    ctx.fillStyle = "rgba(90,133,170,0.6)"; ctx.font = "8px monospace"; ctx.textAlign = "center";
    ctx.fillText(d + "cm", x, H - 4);
  });

  // Centre baseline
  const midY = pT + ph / 2;
  ctx.beginPath(); ctx.moveTo(pL, midY); ctx.lineTo(pL + pw, midY);
  ctx.strokeStyle = "rgba(0,212,255,0.15)"; ctx.lineWidth = 1; ctx.stroke();

  // Find peak for normalisation — use 99th percentile to avoid clipping
  const sorted = [...echo.map(Math.abs)].sort((a, b) => a - b);
  const peakE = sorted[Math.floor(sorted.length * 0.999)] || 1e-6;
  const scale = (ph / 2 - 6) / peakE;

  // --- Filled waveform (above + mirror below for classic A-mode look) --------
  const gradient = ctx.createLinearGradient(0, pT, 0, pT + ph);
  gradient.addColorStop(0,   "rgba(0,255,136,0.05)");
  gradient.addColorStop(0.5, "rgba(0,255,136,0.55)");
  gradient.addColorStop(1,   "rgba(0,255,136,0.05)");

  // Build path for fill (mirror both sides)
  ctx.beginPath();
  ctx.moveTo(pL, midY);
  for (let i = 0; i < echo.length; i++) {
    const x = pL + (depth_cm[i] / maxD) * pw;
    const y = midY - echo[i] * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  // Trace back mirrored
  for (let i = echo.length - 1; i >= 0; i--) {
    const x = pL + (depth_cm[i] / maxD) * pw;
    const y = midY + echo[i] * scale;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = gradient; ctx.fill();

  // --- Bright stroke line on top ------------------------------------------
  ctx.beginPath();
  for (let i = 0; i < echo.length; i++) {
    const x = pL + (depth_cm[i] / maxD) * pw;
    const y = midY - echo[i] * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#00ff88"; ctx.lineWidth = 1.2;
  ctx.shadowColor = "#00ff88"; ctx.shadowBlur = 5;
  ctx.stroke(); ctx.shadowBlur = 0;

  // Mirror stroke (dimmer)
  ctx.beginPath();
  for (let i = 0; i < echo.length; i++) {
    const x = pL + (depth_cm[i] / maxD) * pw;
    const y = midY + echo[i] * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(0,255,136,0.35)"; ctx.lineWidth = 0.8; ctx.stroke();

  // Labels
  ctx.textAlign = "left"; ctx.fillStyle = "rgba(0,212,255,0.7)"; ctx.font = "bold 9px monospace";
  ctx.fillText("A-MODE  RF echo vs depth", pL + 4, pT - 6);
  ctx.fillStyle = "rgba(90,133,170,0.5)"; ctx.font = "8px monospace";
  ctx.fillText("↑ reflection", pL + 4, pT + 10);
}

// ─── B-mode draw ──────────────────────────────────────────────────────────────
function drawBmode(canvas, data) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

  if (!data || !data.lines || data.lines.length === 0) {
    ctx.fillStyle = "rgba(90,133,170,0.35)"; ctx.font = "11px monospace"; ctx.textAlign = "center";
    ctx.fillText("B-mode live — move probe to update", W / 2, H / 2);
    ctx.textAlign = "left"; return;
  }

  const { lines, x_range, probe_x } = data;
  const numLines = lines.length;
  const lineW = Math.max(1, W / numLines);
  const numDepth = lines[0].envelope ? lines[0].envelope.length : (lines[0].echo ? lines[0].echo.length : 0);
  if (numDepth === 0) return;

  const imgData = ctx.createImageData(W, H);
  const px = imgData.data;

  lines.forEach((line, li) => {
    const samples = line.envelope || line.echo;
    if (!samples) return;
    const xStart = Math.round(li * lineW);
    const xEnd   = Math.min(W, Math.round((li + 1) * lineW));

    for (let si = 0; si < numDepth; si++) {
      const py2 = Math.floor((si / numDepth) * H);
      if (py2 >= H) continue;

      const raw = Math.abs(samples[si]);
      // Log compression — same as real US scanners
      const logVal = Math.log1p(raw * 200) / Math.log1p(200);
      // Gamma curve to boost mid-range (tissue texture)
      const brightness = Math.round(Math.min(255, Math.pow(logVal, 0.55) * 255));

      for (let xp = xStart; xp < xEnd; xp++) {
        const idx = (py2 * W + xp) * 4;
        if (idx + 3 >= px.length) continue;
        px[idx]     = brightness;
        px[idx + 1] = brightness;
        px[idx + 2] = brightness;
        px[idx + 3] = 255;
      }
    }
  });

  ctx.putImageData(imgData, 0, 0);

  // Depth scale on left edge
  ctx.fillStyle = "rgba(0,212,255,0.5)"; ctx.font = "7px monospace"; ctx.textAlign = "right";
  [0, 5, 10, 15, 20].forEach(d => {
    const y = Math.round((d / 20) * H);
    ctx.strokeStyle = "rgba(0,212,255,0.15)"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(12, y); ctx.stroke();
    ctx.fillText(d + "cm", 26, y + 4);
  });

  // Probe-centre marker
  if (x_range && probe_x !== undefined) {
    const xSpan = x_range[1] - x_range[0];
    const cX = ((probe_x - x_range[0]) / xSpan) * W;
    ctx.strokeStyle = "rgba(0,212,255,0.7)"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(cX, 0); ctx.lineTo(cX, H * 0.08); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#00d4ff"; ctx.font = "8px monospace"; ctx.textAlign = "center";
    ctx.fillText(`▼ ${probe_x.toFixed(1)}cm`, cX, 18);
    ctx.fillStyle = "rgba(90,133,170,0.4)";
    ctx.fillText(`${x_range[0].toFixed(1)}`, 20, H - 5);
    ctx.textAlign = "right";
    ctx.fillText(`${x_range[1].toFixed(1)}cm`, W - 4, H - 5);
  }

  ctx.fillStyle = "rgba(0,212,255,0.65)"; ctx.font = "bold 9px monospace"; ctx.textAlign = "left";
  ctx.fillText("B-MODE  grayscale scan", 30, 14);
}

// ─── Doppler draw ─────────────────────────────────────────────────────────────
function drawDoppler(canvas, data) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#030810"; ctx.fillRect(0, 0, W, H);
  if (!data) {
    ctx.fillStyle = "rgba(90,133,170,0.35)"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    ctx.fillText("Doppler auto-updates with probe and vessel settings", W / 2, H / 2);
    ctx.textAlign = "left"; return;
  }
  const { frequencies, spectrum, vessel_velocity, wall_freq, fd_hz } = data;
  if (!frequencies) return;
  const pL = 30, pB = 16, pT = 14, pw = W - pL - 8, ph = H - pB - pT;
  ctx.fillStyle = "rgba(90,133,170,0.5)"; ctx.font = "7px monospace"; ctx.textAlign = "right";
  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const y = pT + ph * (1 - f);
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + pw, y);
    ctx.strokeStyle = "rgba(26,50,90,0.4)"; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.fillText((f * 100).toFixed(0) + "%", pL - 2, y + 3);
  });
  const maxF = frequencies[frequencies.length - 1];
  [-4000, -2000, 0, 2000, 4000].forEach(f => {
    if (Math.abs(f) > maxF) return;
    const x = pL + (f + maxF) / (2 * maxF) * pw;
    ctx.textAlign = "center"; ctx.fillText(f + " Hz", x, H - 3);
  });
  const maxS = Math.max(...spectrum, 1e-9);
  ctx.beginPath();
  frequencies.forEach((f, i) => {
    const x = pL + i / frequencies.length * pw;
    const y = pT + ph * (1 - spectrum[i] / maxS);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#a855f7"; ctx.lineWidth = 1.5; ctx.shadowColor = "#a855f7"; ctx.shadowBlur = 5;
  ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(168,85,247,0.06)"; ctx.fill();
  if (wall_freq) {
    const wx = pL + (wall_freq + maxF) / (2 * maxF) * pw;
    ctx.strokeStyle = "rgba(255,107,53,0.5)"; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(wx, pT); ctx.lineTo(wx, pT + ph); ctx.stroke(); ctx.setLineDash([]);
  }
  // Mark Doppler peak
  if (fd_hz !== undefined) {
    const fx = pL + (fd_hz + maxF) / (2 * maxF) * pw;
    ctx.strokeStyle = "#00ff88aa"; ctx.lineWidth = 1; ctx.setLineDash([4, 2]);
    ctx.beginPath(); ctx.moveTo(fx, pT); ctx.lineTo(fx, pT + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#00ff88"; ctx.font = "8px monospace"; ctx.textAlign = "center";
    ctx.fillText(`fd=${fd_hz.toFixed(0)} Hz`, fx, pT + 8);
  }
  ctx.textAlign = "left"; ctx.fillStyle = "rgba(90,133,170,0.5)"; ctx.font = "9px monospace";
  ctx.fillText(`DOPPLER  v=${vessel_velocity?.toFixed(0)} cm/s`, pL + 4, pT + 10);
}

// ─── Doppler simulation ───────────────────────────────────────────────────────
function simulateDoppler(probeAngle, probeEdge, vesselAngle, vesselVelocity, freqMhz, snrDb) {
  const c = 1540, fc = freqMhz * 1e6;

  // ── Convert probe to an absolute bearing in degrees (0° = up / north, CW positive)
  // probeAngle is a tilt relative to the edge's inward normal.
  // bottom edge: normal points up   (0°)
  // top edge:    normal points down (180°)
  // left edge:   normal points right (90°)
  // right edge:  normal points left (270°)
  let probeBearing = probeAngle; // bottom default: 0° + tilt
  if (probeEdge === "top")   probeBearing = 180 + probeAngle;
  if (probeEdge === "left")  probeBearing =  90 + probeAngle;
  if (probeEdge === "right") probeBearing = 270 + probeAngle;

  // ── Convert vessel angle to the same bearing convention.
  // vessel.angle is 0-179 where 0° = rightward (standard math angle),
  // so bearing = 90° - vessel.angle  (i.e. north-up, CW).
  const vesselBearing = (90 - vesselAngle + 360) % 360;

  // ── Angle between beam and vessel flow direction
  let thetaDeg = Math.abs(probeBearing - vesselBearing);
  if (thetaDeg > 180) thetaDeg = 360 - thetaDeg;
  const theta = thetaDeg * Math.PI / 180;

  // ── Doppler shift fd = 2·v·cos(θ)·f/c
  // Sign: if beam and vessel point in roughly the same direction → negative fd (away)
  //       if they oppose → positive fd (toward).
  const dotSign = Math.cos(theta) >= 0 ? -1 : 1; // toward probe = positive convention
  const fd = dotSign * 2 * (vesselVelocity / 100) * Math.abs(Math.cos(theta)) * fc / c;

  const N = 512, maxF = 6000;
  const freqs = Array.from({ length: N }, (_, i) => -maxF + 2 * maxF * i / (N - 1));
  const snrLin = Math.pow(10, Math.min(snrDb, 60) / 10); // cap at 60 dB to keep noise visible

  // Spectral width scales with velocity (turbulence broadening)
  const sigma = 150 + vesselVelocity * 1.2;

  const spectrum = freqs.map(f => {
    const sig = Math.exp(-0.5 * ((f - fd) / sigma) ** 2);
    // Noise floor inversely proportional to SNR
    const noise = (1 / Math.sqrt(snrLin)) * Math.random() * 0.35;
    return Math.max(0, sig + noise);
  });

  // Wall filter: clamp near-zero frequencies (high-pass, removes slow-moving tissue)
  const wallHz = 80;
  spectrum.forEach((_, i) => {
    if (Math.abs(freqs[i]) < wallHz) spectrum[i] *= Math.abs(freqs[i]) / wallHz;
  });

  return {
    frequencies: freqs,
    spectrum,
    vessel_velocity: vesselVelocity,
    velocity_scale: maxF,
    wall_freq: wallHz,
    fd_hz: fd,
    theta_deg: thetaDeg,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function UltrasoundPage() {
  const [structures,  setStructures]  = useState([]);
  const [probe,       setProbe]       = useState({ edge: "bottom", pos: 0, angle: 0 });
  const [freqMhz,     setFreqMhz]     = useState(5);
  const [snrDb,       setSnrDb]       = useState(300);
  const [mode,        setMode]        = useState("amode");
  const [amodeData,   setAmodeData]   = useState(null);
  const [bmodeData,   setBmodeData]   = useState(null);
  const [dopplerData, setDopplerData] = useState(null);
  const [hoveredId,   setHoveredId]   = useState(null);
  const [selectedId,  setSelectedId]  = useState(null);
  const [selectedS,   setSelectedS]   = useState(null);
  const [editForm,    setEditForm]    = useState({});
  const [vessel,      setVessel]      = useState({ cx: 1.5, cy: 2, angle: 30, velocity: 60 });
  const [scanning,    setScanning]    = useState(false);
  const [mousePos,    setMousePos]    = useState(null);

  const phantomRef = useRef(null);
  const amodeRef   = useRef(null);
  const bmodeRef   = useRef(null);
  const dopplerRef = useRef(null);

  const fetchPhantom = useCallback(async () => {
    const data = await api.phantomStructures();
    setStructures(data.structures);
  }, []);
  useEffect(() => { fetchPhantom(); }, [fetchPhantom]);

  // A-mode: translate probe edge+pos to probe_x, probe_y, angle
  const probeToScanParams = useCallback((p = probe) => {
    let probe_x = 0, probe_y = 0, angle = p.angle;
    if (p.edge === "bottom")     { probe_x = p.pos; probe_y = 11;  angle = p.angle; }
    else if (p.edge === "top")   { probe_x = p.pos; probe_y = -11; angle = 180 + p.angle; }
    else if (p.edge === "left")  { probe_x = -9;  probe_y = p.pos; angle = 90 + p.angle; }
    else                          { probe_x = 9;   probe_y = p.pos; angle = 270 + p.angle; }
    return { probe_x, probe_y, angle };
  }, [probe]);

  const fetchAmode = useCallback(async (p = probe) => {
    const { probe_x, probe_y, angle } = probeToScanParams(p);
    const data = await api.amodeScam({ probe_x, probe_y, angle, frequency_mhz: freqMhz });
    setAmodeData(data);
  }, [probe, freqMhz, probeToScanParams]);

  const fetchBmode = useCallback(async (p = probe) => {
    const { probe_x, probe_y, angle } = probeToScanParams(p);
    const data = await api.bmodeScam({ probe_x, probe_y, angle, frequency_mhz: freqMhz, num_lines: 60, fan_width: 7 });
    setBmodeData(data);
  }, [probe, freqMhz, probeToScanParams]);

  // A-mode: instant update on every probe move (backend is ~18ms, totally fine)
  useEffect(() => { const t = setTimeout(() => fetchAmode(), 0); return () => clearTimeout(t); }, [fetchAmode]);
  // B-mode: 400ms debounce — heavier call (60 lines), runs on separate thread
  useEffect(() => { const t = setTimeout(() => fetchBmode(), 400); return () => clearTimeout(t); }, [fetchBmode]);

  // Doppler auto-update
  useEffect(() => {
    setDopplerData(simulateDoppler(probe.angle, probe.edge, vessel.angle, vessel.velocity, freqMhz, snrDb));
  }, [probe, vessel, freqMhz, snrDb]);

  // Resize canvases
  const resizeCanvas = (ref) => {
    if (!ref.current) return;
    const par = ref.current.parentElement; if (!par) return;
    ref.current.width = par.clientWidth; ref.current.height = par.clientHeight;
  };
  useEffect(() => {
    [phantomRef, amodeRef, bmodeRef, dopplerRef].forEach(resizeCanvas);
    const onResize = () => [phantomRef, amodeRef, bmodeRef, dopplerRef].forEach(resizeCanvas);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { resizeCanvas(phantomRef); drawPhantom(phantomRef.current, structures, probe, hoveredId, selectedId, vessel, mousePos); },
    [structures, probe, hoveredId, selectedId, vessel, mousePos]);
  useEffect(() => { resizeCanvas(amodeRef); drawAmode(amodeRef.current, amodeData); }, [amodeData]);
  useEffect(() => { resizeCanvas(bmodeRef); drawBmode(bmodeRef.current, bmodeData); }, [bmodeData]);
  useEffect(() => { resizeCanvas(dopplerRef); drawDoppler(dopplerRef.current, dopplerData); }, [dopplerData]);

  // Phantom mouse events
  const phantomCoords = (e) => {
    const c = phantomRef.current; if (!c) return null;
    const rect = c.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const scaleX = c.width / 20, scaleY = c.height / 22;
    return { nx: (mx - c.width / 2) / scaleX, ny: (my - c.height / 2) / scaleY };
  };
  const hitTest = (mx, my) => {
    for (const s of [...structures].reverse()) {
      const cos = Math.cos(s.rotation * Math.PI / 180), sin = Math.sin(s.rotation * Math.PI / 180);
      const dx = (mx - s.cx) * cos + (my - s.cy) * sin;
      const dy = -(mx - s.cx) * sin + (my - s.cy) * cos;
      if ((dx / s.rx) ** 2 + (dy / s.ry) ** 2 <= 1) return s;
    }
    return null;
  };
  const onPhantomHover = e => {
    const c = phantomRef.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (c.width / rect.width);
    const canvasY = (e.clientY - rect.top) * (c.height / rect.height);
    setMousePos({ x: canvasX, y: canvasY });
    const coords = phantomCoords(e); if (!coords) return;
    setHoveredId(hitTest(coords.nx, coords.ny)?.id || null);
  };
  const onPhantomClick = e => {
    const c = phantomCoords(e); if (!c) return;
    const hit = hitTest(c.nx, c.ny);
    if (hit) {
      setSelectedId(hit.id); setSelectedS(hit);
      setEditForm({ acoustic_impedance: hit.acoustic_impedance, attenuation_db_cm: hit.attenuation_db_cm, speed_of_sound: hit.speed_of_sound });
    } else { setSelectedId(null); setSelectedS(null); }
  };
  const saveEdit = async () => {
    if (!selectedId) return;
    await api.updateStructure(selectedId, editForm);
    await fetchPhantom(); await fetchAmode();
  };
  const bmodeScan = async () => {
    setScanning(true);
    await fetchBmode();
    setScanning(false);
  };

  const MODES = ["amode", "bmode", "doppler"];
  const EDGES = ["bottom", "top", "left", "right"];

  return (
    <div className="page" style={{ flexDirection: "column" }}>
      <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center", flexShrink: 0, background: "var(--panel)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", letterSpacing: 2 }}>ULTRASOUND SIMULATOR</span>
        <div style={{ width: 1, height: 16, background: "var(--border2)" }} />
        <div className="toggle-group">
          {MODES.map(m => (
            <button key={m} className={`toggle-btn ${mode === m ? "active" : ""}`} onClick={() => setMode(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        {mode === "bmode" && (
          <button className="btn primary" onClick={bmodeScan} disabled={scanning}>
            {scanning ? "⏳ Scanning…" : "▶ B-mode Scan"}
          </button>
        )}
        <span style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>
          hover phantom = inspect · click = edit tissue
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Left sidebar */}
        <div className="sidebar" style={{ width: 240 }}>
          <div className="panel-section">
            <div className="panel-title">Probe Settings</div>

            <div style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>Probe Edge</div>
            <div className="toggle-group" style={{ marginBottom: 8 }}>
              {EDGES.map(e => (
                <button key={e} className={`toggle-btn ${probe.edge === e ? "active" : ""}`}
                  onClick={() => setProbe(p => ({ ...p, edge: e }))}>
                  {e[0].toUpperCase() + e.slice(1)}
                </button>
              ))}
            </div>

            <div className="control-row">
              <div className="control-label">
                <span>Position</span>
                <span className="control-value">{probe.pos.toFixed(1)} cm</span>
              </div>
              <input type="range" className="slider" min={-8} max={8} step={0.2}
                value={probe.pos} onChange={e => setProbe(p => ({ ...p, pos: Number(e.target.value) }))} />
            </div>

            <div className="control-row">
              <div className="control-label">
                <span>Beam Angle</span>
                <span className="control-value">{probe.angle}°</span>
              </div>
              <input type="range" className="slider" min={-45} max={45} step={1}
                value={probe.angle} onChange={e => setProbe(p => ({ ...p, angle: Number(e.target.value) }))} />
            </div>

            <div className="control-row">
              <div className="control-label">
                <span>Frequency</span>
                <span className="control-value">{freqMhz} MHz</span>
              </div>
              <input type="range" className="slider" min={1} max={20} step={0.5}
                value={freqMhz} onChange={e => setFreqMhz(Number(e.target.value))} />
            </div>

            <div className="control-row">
              <div className="control-label">
                <span>SNR</span>
                <span className="control-value">{snrDb >= 1000 ? "∞ dB" : snrDb + " dB"}</span>
              </div>
              <input type="range" className="slider" min={0} max={1000} step={5}
                value={snrDb} onChange={e => setSnrDb(Number(e.target.value))} />
            </div>
          </div>

          {/* Vessel / Doppler controls — always visible */}
          <div className="panel-section" style={{ border: "1px solid rgba(168,85,247,0.3)" }}>
            <div className="panel-title" style={{ color: "#a855f7" }}>Blood Vessel</div>

            <div className="control-row">
              <div className="control-label">
                <span>Vessel Angle</span>
                <span className="control-value">{vessel.angle}°</span>
              </div>
              <input type="range" className="slider" min={0} max={179} step={1}
                value={vessel.angle} onChange={e => setVessel(v => ({ ...v, angle: Number(e.target.value) }))} />
            </div>

            <div className="control-row">
              <div className="control-label">
                <span>Blood Velocity</span>
                <span className="control-value">{vessel.velocity} cm/s</span>
              </div>
              <input type="range" className="slider" min={5} max={200} step={5}
                value={vessel.velocity} onChange={e => setVessel(v => ({ ...v, velocity: Number(e.target.value) }))} />
            </div>

            <div className="control-row">
              <div className="control-label">
                <span>Vessel X pos</span>
                <span className="control-value">{vessel.cx.toFixed(1)} cm</span>
              </div>
              <input type="range" className="slider" min={-7} max={7} step={0.5}
                value={vessel.cx} onChange={e => setVessel(v => ({ ...v, cx: Number(e.target.value) }))} />
            </div>

            <div className="info-card" style={{ fontSize: 9 }}>
              <div style={{ color: "var(--text2)", lineHeight: 1.6 }}>
                fd = 2·v·cos(θ)·f/c<br />
                θ = beam vs vessel angle<br />
                fd ≈ {dopplerData?.fd_hz !== undefined ? dopplerData.fd_hz.toFixed(0) : "—"} Hz
              </div>
            </div>
          </div>

          {/* Hover info is now shown as an inline tooltip directly on the phantom canvas */}

          {/* Edit selected */}
          {selectedS && (
            <div className="panel-section" style={{ border: "1px solid var(--warn)44" }}>
              <div className="panel-title" style={{ color: "var(--warn)" }}>✎ EDIT: {selectedS.label}</div>
              <div className="control-row">
                <div className="control-label"><span>Z (MRayl)</span></div>
                <input type="number" className="select" step={0.01}
                  value={(editForm.acoustic_impedance / 1e6).toFixed(3)}
                  onChange={e => setEditForm(f => ({ ...f, acoustic_impedance: parseFloat(e.target.value) * 1e6 }))} />
              </div>
              <div className="control-row">
                <div className="control-label"><span>Attenuation α</span></div>
                <input type="number" className="select" step={0.05}
                  value={editForm.attenuation_db_cm}
                  onChange={e => setEditForm(f => ({ ...f, attenuation_db_cm: parseFloat(e.target.value) }))} />
              </div>
              <div className="control-row">
                <div className="control-label"><span>Sound Speed (m/s)</span></div>
                <input type="number" className="select" step={10}
                  value={editForm.speed_of_sound}
                  onChange={e => setEditForm(f => ({ ...f, speed_of_sound: parseFloat(e.target.value) }))} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn primary" style={{ flex: 1 }} onClick={saveEdit}>Apply</button>
                <button className="btn" onClick={() => { setSelectedId(null); setSelectedS(null); }}>✕</button>
              </div>
            </div>
          )}
        </div>

        {/* 4-panel grid */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 4, padding: 4, overflow: "hidden" }}>

          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">⬟ SHEPP-LOGAN PHANTOM</span>
              <span style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>hover·click to edit</span>
            </div>
            <div className="viz-body" style={{ position: "relative", overflow: "hidden", cursor: hoveredId ? "pointer" : "default" }}
              onMouseMove={onPhantomHover} onMouseLeave={() => { setHoveredId(null); setMousePos(null); }} onClick={onPhantomClick}>
              <canvas ref={phantomRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            </div>
          </div>

          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">◈ A-MODE</span>
              <span style={{ fontSize: 9, color: "var(--accent3)", fontFamily: "var(--font-mono)" }}>live · {freqMhz} MHz</span>
            </div>
            <div className="viz-body" style={{ position: "relative", overflow: "hidden" }}>
              <canvas ref={amodeRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            </div>
          </div>

          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">▦ B-MODE</span>
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: scanning ? "var(--accent)" : bmodeData ? "var(--accent4)" : "var(--text3)" }}>
                {scanning ? "scanning…" : bmodeData ? "scan image" : "click ▶ B-mode Scan"}
              </span>
            </div>
            <div className="viz-body" style={{ position: "relative", overflow: "hidden" }}>
              <canvas ref={bmodeRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            </div>
          </div>

          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">◌ DOPPLER</span>
              <span style={{ fontSize: 9, color: "#a855f7", fontFamily: "var(--font-mono)" }}>
                v={vessel.velocity} cm/s · θ={vessel.angle}° · fd≈{dopplerData?.fd_hz?.toFixed(0) ?? "—"} Hz
              </span>
            </div>
            <div className="viz-body" style={{ position: "relative", overflow: "hidden" }}>
              <canvas ref={dopplerRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            </div>
          </div>

        </div>
      </div>

      <div className="status-bar">
        <div className="status-item">mode <span>{mode}</span></div>
        <div className="status-item">edge <span>{probe.edge}</span></div>
        <div className="status-item">pos <span>{probe.pos.toFixed(1)} cm</span></div>
        <div className="status-item">angle <span>{probe.angle}°</span></div>
        <div className="status-item">freq <span>{freqMhz} MHz</span></div>
        <div className="status-item">SNR <span>{snrDb >= 1000 ? "∞" : snrDb} dB</span></div>
        <div className="status-item">λ <span>{(1540 / (freqMhz * 1e6) * 1000).toFixed(3)} mm</span></div>
        <div className="status-item">vessel_v <span>{vessel.velocity} cm/s</span></div>
        <div className="status-item">fd <span>{dopplerData?.fd_hz?.toFixed(0) ?? "—"} Hz</span></div>
      </div>
    </div>
  );
}