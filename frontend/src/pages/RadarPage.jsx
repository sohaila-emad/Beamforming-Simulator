import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api";
import { Slider } from "../components/ControlPanel";

const MAX_TARGETS = 5;
const TARGET_COLORS = ["#ffb800", "#ff6b35", "#00ff88", "#a855f7", "#00d4ff"];

function polarToCanvas(angle, distance, cx, cy, R, maxRange) {
  const rad = ((angle - 90) * Math.PI) / 180;
  const r = (distance / maxRange) * R;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function canvasToPolar(px, py, cx, cy, R, maxRange) {
  const dx = px - cx, dy = py - cy;
  const r = Math.hypot(dx, dy);
  const distance = Math.min((r / R) * maxRange, maxRange * 0.95);
  const angle = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
  return { angle, distance };
}

function drawRadarPPI(canvas, state, ppiData, scanAngle, draggingTarget, hoverTarget) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.42;
  const MAX_RANGE = 5000;

  ctx.fillStyle = "#020a06"; ctx.fillRect(0, 0, W, H);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "#030d08"; ctx.fill();

  // Range rings
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,80,30,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "rgba(0,180,60,0.4)"; ctx.font = "8px Space Mono, monospace";
    ctx.fillText(`${(MAX_RANGE * i / 4 / 1000).toFixed(1)} km`, cx + 4, cy - (R * i) / 4);
  }

  // Angle spokes
  for (let a = 0; a < 360; a += 30) {
    const rad = ((a - 90) * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad));
    ctx.strokeStyle = "rgba(0,80,30,0.3)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "rgba(0,200,60,0.5)"; ctx.font = "9px Space Mono, monospace"; ctx.textAlign = "center";
    ctx.fillText(`${a}°`, cx + (R + 14) * Math.cos(rad), cy + (R + 14) * Math.sin(rad) + 3);
  }
  ctx.textAlign = "left";

  // PPI returns (phosphor)
  if (ppiData?.ppi) {
    ppiData.ppi.forEach(({ angle, peak_power, peak_range }) => {
      if (peak_power < 0.05) return;
      const { x, y } = polarToCanvas(angle, peak_range, cx, cy, R, MAX_RANGE);
      const alpha = peak_power * 0.6;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,255,80,${alpha})`;
      ctx.shadowColor = "#00ff50"; ctx.shadowBlur = peak_power * 12;
      ctx.fill(); ctx.shadowBlur = 0;
    });
  }

  // Sweep beam
  const sweepRad = ((scanAngle - 90) * Math.PI) / 180;
  const bwRad = ((state?.beam_width || 5) * Math.PI) / 180;
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, sweepRad - bwRad / 2, sweepRad + bwRad / 2); ctx.closePath();
  const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  sweepGrad.addColorStop(0, "rgba(0,255,80,0.4)"); sweepGrad.addColorStop(1, "rgba(0,255,80,0.02)");
  ctx.fillStyle = sweepGrad; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.lineTo(cx + R * Math.cos(sweepRad), cy + R * Math.sin(sweepRad));
  ctx.strokeStyle = "rgba(0,255,80,0.9)"; ctx.lineWidth = 2;
  ctx.shadowColor = "#00ff50"; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;

  // Targets with drag affordance
  state?.targets?.forEach((t, idx) => {
    const col = TARGET_COLORS[idx % TARGET_COLORS.length];
    const { x: tx, y: ty } = polarToCanvas(t.angle, t.distance, cx, cy, R, MAX_RANGE);
    const sz = Math.max(4, (t.size / 100) * 9);
    const isDrag = draggingTarget === t.id;
    const isHover = hoverTarget === t.id;

    // Drag trail ring
    if (isDrag || isHover) {
      ctx.beginPath(); ctx.arc(tx, ty, sz + 8, 0, Math.PI * 2);
      ctx.strokeStyle = col + "55"; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }

    ctx.beginPath(); ctx.arc(tx, ty, sz, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = isDrag ? 2.5 : 1.5;
    ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col + (isDrag ? "88" : "66"); ctx.fill();
    ctx.shadowColor = "#00ff50"; ctx.shadowBlur = 0;

    ctx.fillStyle = isDrag ? col : "#ffb800";
    ctx.font = `${isDrag ? "bold " : ""}9px Space Mono, monospace`;
    ctx.fillText(`${t.id} ${(t.distance / 1000).toFixed(1)}km`, tx + sz + 3, ty + 3);

    // Crosshair when dragging
    if (isDrag) {
      ctx.strokeStyle = col + "aa"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#00ff50"; ctx.shadowColor = "#00ff50"; ctx.shadowBlur = 10;
  ctx.fill(); ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(0,200,60,0.5)"; ctx.font = "10px Space Mono, monospace";
  ctx.fillText("PPI RADAR DISPLAY", 12, 18);
  ctx.font = "8px Space Mono, monospace"; ctx.fillStyle = "rgba(0,200,60,0.35)";
  ctx.fillText("drag targets to reposition", 12, H - 10);
}

function drawRangeProfile(canvas, scanData) {
  if (!canvas || !scanData) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#020a06"; ctx.fillRect(0, 0, W, H);
  const { range_bins, power } = scanData; if (!range_bins) return;
  const maxRange = range_bins[range_bins.length - 1];
  ctx.strokeStyle = "rgba(0,60,20,0.5)"; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = (i / 5) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = "rgba(0,200,60,0.4)"; ctx.font = "8px Space Mono, monospace";
    ctx.fillText(`${((maxRange * i) / 5 / 1000).toFixed(1)}km`, x + 2, H - 4);
  }
  ctx.beginPath();
  for (let i = 0; i < power.length; i++) {
    const x = (range_bins[i] / maxRange) * W;
    const y = H - power[i] * (H - 20) - 4;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#00ff50"; ctx.lineWidth = 1.5;
  ctx.shadowColor = "#00ff50"; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0,200,60,0.5)"; ctx.font = "10px Space Mono, monospace";
  ctx.fillText(`RANGE PROFILE  θ=${scanData.scan_angle?.toFixed(0)}°`, 8, 14);
}

export default function RadarPage() {
  const [state, setState] = useState(null);
  const [ppiData, setPpiData] = useState(null);
  const [scanData, setScanData] = useState(null);
  const [scanAngle, setScanAngle] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [beamWidth, setBeamWidth] = useState(5);
  const [scanSpeed, setScanSpeed] = useState(3);
  const [snrDb, setSnrDb] = useState(20);
  const [newTarget, setNewTarget] = useState({ distance: 1500, angle: 90, size: 40 });
  const [draggingTarget, setDraggingTarget] = useState(null);
  const [hoverTarget, setHoverTarget] = useState(null);

  const ppiRef = useRef(null);
  const rangeRef = useRef(null);
  const scanRef = useRef(null);
  const scanAngleRef = useRef(0);
  const stateRef = useRef(null);

  const fetchState = useCallback(async () => {
    const s = await api.radarState(); setState(s); stateRef.current = s;
  }, []);
  const fetchPPI = useCallback(async () => { const d = await api.radarPPI(); setPpiData(d); }, []);

  useEffect(() => { fetchState(); fetchPPI(); }, [fetchState, fetchPPI]);

  // Canvas resize + redraw
  useEffect(() => {
    [ppiRef, rangeRef].forEach((ref) => {
      if (!ref.current) return;
      const p = ref.current.parentElement;
      ref.current.width = p.clientWidth; ref.current.height = p.clientHeight;
    });
    drawRadarPPI(ppiRef.current, state, ppiData, scanAngle, draggingTarget, hoverTarget);
    drawRangeProfile(rangeRef.current, scanData);
  }, [state, ppiData, scanData, scanAngle, draggingTarget, hoverTarget]);

  // Scan animation
  useEffect(() => {
    if (!scanning) { if (scanRef.current) clearInterval(scanRef.current); return; }
    scanRef.current = setInterval(async () => {
      const next = (scanAngleRef.current + scanSpeed) % 360;
      scanAngleRef.current = next; setScanAngle(next);
      const ret = await api.radarScan(next); setScanData(ret);
      if (Math.floor(next / 10) !== Math.floor((next - scanSpeed) / 10)) {
        const d = await api.radarPPI(); setPpiData(d);
      }
    }, 100);
    return () => clearInterval(scanRef.current);
  }, [scanning, scanSpeed]);

  // ── Target dragging on PPI ──
  const getPpiMetrics = () => {
    if (!ppiRef.current) return null;
    const { width: W, height: H } = ppiRef.current;
    return { cx: W / 2, cy: H / 2, R: Math.min(W, H) * 0.42, MAX_RANGE: 5000 };
  };

  const getMousePolar = (e) => {
    if (!ppiRef.current) return null;
    const rect = ppiRef.current.getBoundingClientRect();
    const m = getPpiMetrics(); if (!m) return null;
    return canvasToPolar(e.clientX - rect.left, e.clientY - rect.top, m.cx, m.cy, m.R, m.MAX_RANGE);
  };

  const getTargetAtMouse = (e) => {
    if (!ppiRef.current || !state?.targets) return null;
    const rect = ppiRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const m = getPpiMetrics(); if (!m) return null;
    for (const t of state.targets) {
      const { x, y } = polarToCanvas(t.angle, t.distance, m.cx, m.cy, m.R, m.MAX_RANGE);
      const sz = Math.max(4, (t.size / 100) * 9) + 10;
      if (Math.hypot(mx - x, my - y) <= sz) return t.id;
    }
    return null;
  };

  const handlePpiMouseDown = (e) => {
    const tid = getTargetAtMouse(e);
    if (tid) { setDraggingTarget(tid); e.preventDefault(); }
  };

  const handlePpiMouseMove = (e) => {
    if (draggingTarget) {
      const polar = getMousePolar(e); if (!polar) return;
      setState(s => {
        if (!s) return s;
        return { ...s, targets: s.targets.map(t => t.id === draggingTarget ? { ...t, angle: polar.angle, distance: polar.distance } : t) };
      });
    } else {
      setHoverTarget(getTargetAtMouse(e));
    }
  };

  const handlePpiMouseUp = async (e) => {
    if (!draggingTarget) return;
    const polar = getMousePolar(e);
    if (polar) {
      const s = await api.updateTarget({ id: draggingTarget, angle: polar.angle, distance: polar.distance });
      setState(s); stateRef.current = s;
      const d = await api.radarPPI(); setPpiData(d);
    }
    setDraggingTarget(null);
  };

  const updateSettings = async (updates) => { const s = await api.radarSettings(updates); setState(s); stateRef.current = s; };
  const addTarget = async () => {
    if ((state?.targets?.length || 0) >= MAX_TARGETS) return;
    const s = await api.addTarget(newTarget); setState(s); stateRef.current = s; await fetchPPI();
  };
  const removeTarget = async (tid) => { const s = await api.removeTarget(tid); setState(s); stateRef.current = s; await fetchPPI(); };
  const updateTarget = async (tid, key, val) => {
    const s = await api.updateTarget({ id: tid, [key]: val }); setState(s); stateRef.current = s; await fetchPPI();
  };

  return (
    <div className="page">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="panel-section">
          <div className="panel-title">Scanner Control</div>
          <button className={`btn ${scanning ? "danger" : "success"}`} onClick={() => setScanning(v => !v)}>
            {scanning ? "⬛ Stop Scan" : "▶ Start Scan"}
          </button>
          <Slider label="Scan Speed (°/step)" value={scanSpeed} min={1} max={20} step={1}
            onChange={(v) => { setScanSpeed(v); updateSettings({ scan_speed: v }); }} />
          <Slider label="Beam Width (°)" value={beamWidth} min={1} max={30} step={1}
            onChange={(v) => { setBeamWidth(v); updateSettings({ beam_width: v }); }} />
          <Slider label="SNR (dB)" value={snrDb} min={0} max={1000} step={1}
            onChange={(v) => { setSnrDb(v); updateSettings({ snr_db: v }); }} />
          <div className="info-card" style={{ fontSize: 10 }}>
            <div style={{ color: "var(--text2)", lineHeight: 1.6 }}>
              <strong style={{ color: "#00ff50" }}>Wide beam</strong> → fast scan, coarse<br />
              <strong style={{ color: "#00ff50" }}>Narrow beam</strong> → precise localization
            </div>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-title">Add Target ({state?.targets?.length || 0}/{MAX_TARGETS})</div>
          <Slider label="Distance (m)" value={newTarget.distance} min={200} max={4500} step={100}
            onChange={(v) => setNewTarget(t => ({ ...t, distance: v }))} />
          <Slider label="Angle (°)" value={newTarget.angle} min={0} max={359} step={5}
            onChange={(v) => setNewTarget(t => ({ ...t, angle: v }))} />
          <Slider label="Size (m)" value={newTarget.size} min={5} max={200} step={5}
            onChange={(v) => setNewTarget(t => ({ ...t, size: v }))} />
          <button className="btn primary" onClick={addTarget} disabled={(state?.targets?.length || 0) >= MAX_TARGETS}>
            + Add Target
          </button>
        </div>

        <div className="panel-section">
          <div className="panel-title">Targets</div>
          {state?.targets?.map((t, idx) => (
            <div key={t.id} className="info-card" style={{ marginBottom: 8, borderColor: TARGET_COLORS[idx % TARGET_COLORS.length] + "44" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                <span style={{ color: TARGET_COLORS[idx % TARGET_COLORS.length], fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 }}>
                  ◆ {t.id}
                </span>
                <button className="btn danger" style={{ padding: "2px 8px", fontSize: 10 }} onClick={() => removeTarget(t.id)}>✕</button>
              </div>
              <div className="info-row"><span>Distance</span><strong>{t.distance?.toFixed(0)} m</strong></div>
              <div className="info-row"><span>Angle</span><strong>{t.angle?.toFixed(1)}°</strong></div>
              <div className="info-row"><span>Size</span><strong>{t.size} m</strong></div>
              <div style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
                drag on PPI to move
              </div>
              <Slider label="Dist (m)" value={t.distance} min={200} max={4900} step={50}
                onChange={(v) => updateTarget(t.id, "distance", v)} />
              <Slider label="Angle (°)" value={t.angle} min={0} max={359} step={1}
                onChange={(v) => updateTarget(t.id, "angle", v)} />
              <Slider label="Size (m)" value={t.size} min={5} max={200} step={5}
                onChange={(v) => updateTarget(t.id, "size", v)} />
            </div>
          ))}
          {(!state?.targets || state.targets.length === 0) && (
            <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>No targets. Add up to {MAX_TARGETS}.</div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="content">
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", background: "var(--panel)", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#00ff50" }}>🎯 Radar PPI Display</span>
          <div style={{ fontSize: 9, color: "rgba(0,200,60,0.5)", fontFamily: "var(--font-mono)" }}>
            drag targets to reposition · sliders for precise control
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
            <div className="status-item">angle <span style={{ color: "#00ff50" }}>{scanAngle.toFixed(0)}°</span></div>
            <div className="status-item">beam_w <span style={{ color: "#00ff50" }}>{beamWidth}°</span></div>
            <div className="status-item">snr <span style={{ color: "#00ff50" }}>{snrDb >= 1000 ? "∞" : snrDb} dB</span></div>
            <div className={`badge ${scanning ? "connected" : "warn"}`}>{scanning ? "SCANNING" : "IDLE"}</div>
          </div>
        </div>

        <div className="viz-area" style={{ padding: 8, gap: 8, flexDirection: "column" }}>
          <div style={{ flex: 2, display: "flex", gap: 8, overflow: "hidden" }}>
            <div className="viz-panel" style={{ flex: 2 }}>
              <div className="viz-header" style={{ background: "#030d08", borderColor: "#0a2010" }}>
                <span className="viz-title" style={{ color: "#00cc40" }}>PPI PLAN POSITION INDICATOR</span>
                <span style={{ fontSize: 9, color: "rgba(0,180,60,0.5)", fontFamily: "var(--font-mono)" }}>
                  {hoverTarget ? `hover: ${hoverTarget}` : draggingTarget ? `moving: ${draggingTarget}` : "drag targets to move"}
                </span>
              </div>
              <div className="viz-body" style={{ background: "#020a06", cursor: draggingTarget ? "grabbing" : hoverTarget ? "grab" : "default" }}
                onMouseDown={handlePpiMouseDown}
                onMouseMove={handlePpiMouseMove}
                onMouseUp={handlePpiMouseUp}
                onMouseLeave={() => { setDraggingTarget(null); setHoverTarget(null); }}>
                <canvas ref={ppiRef} style={{ display: "block", width: "100%", height: "100%" }} />
              </div>
            </div>

            <div className="viz-panel" style={{ flex: 1 }}>
              <div className="viz-header" style={{ background: "#030d08", borderColor: "#0a2010" }}>
                <span className="viz-title" style={{ color: "#00cc40" }}>RANGE PROFILE</span>
              </div>
              <div className="viz-body" style={{ background: "#020a06" }}>
                <canvas ref={rangeRef} style={{ display: "block", width: "100%", height: "100%" }} />
              </div>
            </div>
          </div>
        </div>

        <div className="status-bar">
          <div className="status-item">freq <span>10 GHz (X-band)</span></div>
          <div className="status-item">max_range <span>5000 m</span></div>
          <div className="status-item">targets <span>{state?.targets?.length || 0}/{MAX_TARGETS}</span></div>
          <div className="status-item">sweep <span>{scanAngle.toFixed(0)}°</span></div>
          <div className="status-item">beam <span>{beamWidth}°</span></div>
        </div>
      </div>
    </div>
  );
}