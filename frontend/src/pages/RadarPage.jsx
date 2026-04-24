import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api";
import { Slider } from "../components/ControlPanel";

const MAX_TARGETS = 5;

function drawRadarPPI(canvas, state, ppiData, scanAngle) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.42;

  // Background
  ctx.fillStyle = "#020a06";
  ctx.fillRect(0, 0, W, H);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "#030d08";
  ctx.fill();

  // Phosphor persistence effect (glow rings)
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,80,30,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    const label = ((state?.targets?.length ? 5000 : 5000) * i / 4 / 1000).toFixed(1) + " km";
    ctx.fillStyle = "rgba(0,180,60,0.4)";
    ctx.font = "8px Space Mono, monospace";
    ctx.fillText(label, cx + 4, cy - (R * i) / 4);
  }

  // Angle spokes
  for (let a = 0; a < 360; a += 30) {
    const rad = ((a - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad));
    ctx.strokeStyle = "rgba(0,80,30,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(0,200,60,0.5)";
    ctx.font = "9px Space Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${a}°`, cx + (R + 14) * Math.cos(rad), cy + (R + 14) * Math.sin(rad) + 3);
  }
  ctx.textAlign = "left";

  // PPI returns (previous sweeps — phosphor glow)
  if (ppiData?.ppi) {
    ppiData.ppi.forEach(({ angle, peak_power, peak_range }) => {
      if (peak_power < 0.05) return;
      const rad = ((angle - 90) * Math.PI) / 180;
      const r = (peak_range / 5000) * R;
      const x = cx + r * Math.cos(rad);
      const y = cy + r * Math.sin(rad);
      const alpha = peak_power * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,255,80,${alpha})`;
      ctx.shadowColor = "#00ff50";
      ctx.shadowBlur = peak_power * 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  // Sweep beam
  const sweepRad = ((scanAngle - 90) * Math.PI) / 180;
  const grad = ctx.createConicalGradient
    ? null  // not standard — use radial sector
    : null;

  // Draw sweep sector
  const bwRad = ((state?.beam_width || 5) * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, sweepRad - bwRad / 2, sweepRad + bwRad / 2);
  ctx.closePath();
  const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  sweepGrad.addColorStop(0, "rgba(0,255,80,0.4)");
  sweepGrad.addColorStop(1, "rgba(0,255,80,0.02)");
  ctx.fillStyle = sweepGrad;
  ctx.fill();

  // Sweep leading edge line
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + R * Math.cos(sweepRad), cy + R * Math.sin(sweepRad));
  ctx.strokeStyle = "rgba(0,255,80,0.9)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "#00ff50"; ctx.shadowBlur = 8;
  ctx.stroke(); ctx.shadowBlur = 0;

  // Targets (ground truth overlay)
  state?.targets?.forEach((t) => {
    const trad = ((t.angle - 90) * Math.PI) / 180;
    const tr = (t.distance / 5000) * R;
    const tx = cx + tr * Math.cos(trad);
    const ty = cy + tr * Math.sin(trad);
    const sz = Math.max(3, (t.size / 100) * 8);

    ctx.beginPath();
    ctx.arc(tx, ty, sz, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffb800";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#ffb80066";
    ctx.fill();

    ctx.fillStyle = "#ffb800";
    ctx.font = "9px Space Mono, monospace";
    ctx.fillText(`${t.id} ${(t.distance / 1000).toFixed(1)}km`, tx + sz + 3, ty + 3);
  });

  // Center dot
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#00ff50"; ctx.shadowColor = "#00ff50"; ctx.shadowBlur = 10;
  ctx.fill(); ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(0,200,60,0.5)";
  ctx.font = "10px Space Mono, monospace";
  ctx.fillText("PPI RADAR DISPLAY", 12, 18);
}

function drawRangeProfile(canvas, scanData) {
  if (!canvas || !scanData) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#020a06";
  ctx.fillRect(0, 0, W, H);

  const { range_bins, power } = scanData;
  if (!range_bins) return;

  const maxRange = range_bins[range_bins.length - 1];

  // Grid
  ctx.strokeStyle = "rgba(0,60,20,0.5)"; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = (i / 5) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = "rgba(0,200,60,0.4)";
    ctx.font = "8px Space Mono, monospace";
    ctx.fillText(`${((maxRange * i) / 5 / 1000).toFixed(1)}km`, x + 2, H - 4);
  }

  // Power trace
  ctx.beginPath();
  for (let i = 0; i < power.length; i++) {
    const x = (range_bins[i] / maxRange) * W;
    const y = H - power[i] * (H - 20) - 4;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#00ff50"; ctx.lineWidth = 1.5;
  ctx.shadowColor = "#00ff50"; ctx.shadowBlur = 6;
  ctx.stroke(); ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(0,200,60,0.5)";
  ctx.font = "10px Space Mono, monospace";
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

  const ppiRef = useRef(null);
  const rangeRef = useRef(null);
  const scanRef = useRef(null);
  const scanAngleRef = useRef(0);

  const fetchState = useCallback(async () => {
    const s = await api.radarState();
    setState(s);
  }, []);

  const fetchPPI = useCallback(async () => {
    const d = await api.radarPPI();
    setPpiData(d);
  }, []);

  useEffect(() => { fetchState(); fetchPPI(); }, [fetchState, fetchPPI]);

  // Canvas resize
  useEffect(() => {
    [ppiRef, rangeRef].forEach((ref) => {
      if (!ref.current) return;
      const p = ref.current.parentElement;
      ref.current.width = p.clientWidth;
      ref.current.height = p.clientHeight;
    });
    drawRadarPPI(ppiRef.current, state, ppiData, scanAngle);
    drawRangeProfile(rangeRef.current, scanData);
  }, [state, ppiData, scanData, scanAngle]);

  // Scanning animation
  useEffect(() => {
    if (!scanning) {
      if (scanRef.current) clearInterval(scanRef.current);
      return;
    }
    scanRef.current = setInterval(async () => {
      const nextAngle = (scanAngleRef.current + scanSpeed) % 360;
      scanAngleRef.current = nextAngle;
      setScanAngle(nextAngle);
      const ret = await api.radarScan(nextAngle);
      setScanData(ret);
      // Refresh PPI every full rotation
      if (Math.floor(nextAngle / 10) !== Math.floor((nextAngle - scanSpeed) / 10)) {
        const d = await api.radarPPI();
        setPpiData(d);
      }
    }, 100);
    return () => clearInterval(scanRef.current);
  }, [scanning, scanSpeed]);

  const updateSettings = async (updates) => {
    const s = await api.radarSettings(updates);
    setState(s);
  };

  const addTarget = async () => {
    if ((state?.targets?.length || 0) >= MAX_TARGETS) return;
    const s = await api.addTarget(newTarget);
    setState(s);
    await fetchPPI();
  };

  const removeTarget = async (tid) => {
    const s = await api.removeTarget(tid);
    setState(s);
    await fetchPPI();
  };

  const updateTarget = async (tid, key, val) => {
    const s = await api.updateTarget({ id: tid, [key]: val });
    setState(s);
    await fetchPPI();
  };

  return (
    <div className="page">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="panel-section">
          <div className="panel-title">Scanner Control</div>
          <button
            className={`btn ${scanning ? "danger" : "success"}`}
            onClick={() => setScanning((v) => !v)}>
            {scanning ? "⬛ Stop Scan" : "▶ Start Scan"}
          </button>

          <Slider label="Scan Speed (°/step)" value={scanSpeed} min={1} max={20} step={1}
            onChange={(v) => { setScanSpeed(v); updateSettings({ scan_speed: v }); }} />
          <Slider label="Beam Width (°)" value={beamWidth} min={1} max={30} step={1}
            onChange={(v) => { setBeamWidth(v); updateSettings({ beam_width: v }); }} />
          <Slider label="SNR (dB)" value={snrDb} min={0} max={40} step={1}
            onChange={(v) => { setSnrDb(v); updateSettings({ snr_db: v }); }} />

          <div className="info-card" style={{ fontSize: 10 }}>
            <div style={{ color: "var(--text2)", lineHeight: 1.5 }}>
              Wide beam → fast scan, coarse detection<br />
              Narrow beam → slower, precise target sizing
            </div>
          </div>
        </div>

        {/* Add target */}
        <div className="panel-section">
          <div className="panel-title">Add Target ({state?.targets?.length || 0}/{MAX_TARGETS})</div>
          <Slider label="Distance (m)" value={newTarget.distance} min={200} max={4500} step={100}
            onChange={(v) => setNewTarget((t) => ({ ...t, distance: v }))} />
          <Slider label="Angle (°)" value={newTarget.angle} min={0} max={359} step={5}
            onChange={(v) => setNewTarget((t) => ({ ...t, angle: v }))} />
          <Slider label="Size (m)" value={newTarget.size} min={5} max={200} step={5}
            onChange={(v) => setNewTarget((t) => ({ ...t, size: v }))} />
          <button className="btn primary" onClick={addTarget}
            disabled={(state?.targets?.length || 0) >= MAX_TARGETS}>
            + Add Target
          </button>
        </div>

        {/* Target list */}
        <div className="panel-section">
          <div className="panel-title">Targets</div>
          {state?.targets?.map((t) => (
            <div key={t.id} className="info-card" style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "var(--warn)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 }}>
                  ◆ {t.id}
                </span>
                <button className="btn danger" style={{ padding: "2px 8px", fontSize: 10 }}
                  onClick={() => removeTarget(t.id)}>✕</button>
              </div>
              <div className="info-row"><span>Distance</span><strong>{t.distance} m</strong></div>
              <div className="info-row"><span>Angle</span><strong>{t.angle}°</strong></div>
              <div className="info-row"><span>Size</span><strong>{t.size} m</strong></div>
              <Slider label="Size" value={t.size} min={5} max={200} step={5}
                onChange={(v) => updateTarget(t.id, "size", v)} />
            </div>
          ))}
          {(!state?.targets || state.targets.length === 0) && (
            <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
              No targets. Add up to 5.
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="content">
        <div style={{
          padding: "8px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", gap: 8, alignItems: "center", background: "var(--panel)", flexShrink: 0
        }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#00ff50" }}>
            🎯 Radar PPI Display
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
            <div className="status-item">angle <span style={{ color: "#00ff50" }}>{scanAngle.toFixed(0)}°</span></div>
            <div className="status-item">beam_w <span style={{ color: "#00ff50" }}>{beamWidth}°</span></div>
            <div className="status-item">snr <span style={{ color: "#00ff50" }}>{snrDb} dB</span></div>
            <div className={`badge ${scanning ? "connected" : "warn"}`}>{scanning ? "SCANNING" : "IDLE"}</div>
          </div>
        </div>

        <div className="viz-area" style={{ padding: 8, gap: 8, flexDirection: "column" }}>
          <div style={{ flex: 2, display: "flex", gap: 8, overflow: "hidden" }}>
            {/* PPI Display */}
            <div className="viz-panel" style={{ flex: 2 }}>
              <div className="viz-header" style={{ background: "#030d08", borderColor: "#0a2010" }}>
                <span className="viz-title" style={{ color: "#00cc40" }}>PPI PLAN POSITION INDICATOR</span>
              </div>
              <div className="viz-body" style={{ background: "#020a06" }}>
                <canvas ref={ppiRef} style={{ display: "block", width: "100%", height: "100%" }} />
              </div>
            </div>

            {/* Range profile */}
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
          <div className="status-item">targets <span>{state?.targets?.length || 0}</span></div>
          <div className="status-item">sweep <span>{scanAngle.toFixed(0)}°</span></div>
        </div>
      </div>
    </div>
  );
}
