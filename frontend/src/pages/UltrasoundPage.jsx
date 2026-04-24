import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api";
import { Slider, Select } from "../components/ControlPanel";

const PHANTOM_W = 400, PHANTOM_H = 480;

// Convert phantom coords (-1..1 scaled) to canvas pixels
function phantomToCanvas(cx, cy, rx, ry, canvasW, canvasH) {
  const scaleX = canvasW / 20; // 20 cm wide phantom
  const scaleY = canvasH / 24; // 24 cm tall phantom
  return {
    cx: canvasW / 2 + cx * scaleX,
    cy: canvasH / 2 + cy * scaleY,
    rx: rx * scaleX,
    ry: ry * scaleY,
  };
}

function drawPhantom(canvas, structures, probeX, probeY, probeAngle, hoveredId, selectedId) {
  if (!canvas || !structures) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#050810";
  ctx.fillRect(0, 0, W, H);

  // Draw each structure (in reverse order so later ones overlap correctly)
  structures.forEach((s) => {
    const { cx: pcx, cy: pcy, rx: prx, ry: pry } = phantomToCanvas(
      s.cx, s.cy, s.rx, s.ry, W, H
    );
    ctx.save();
    ctx.translate(pcx, pcy);
    ctx.rotate((s.rotation * Math.PI) / 180);

    ctx.beginPath();
    ctx.ellipse(0, 0, prx, pry, 0, 0, Math.PI * 2);
    ctx.fillStyle = s.color + (s.id === selectedId ? "ff" : "cc");
    ctx.strokeStyle = s.id === hoveredId ? "#ffffff" : s.id === selectedId ? "#ffb800" : "transparent";
    ctx.lineWidth = s.id === hoveredId || s.id === selectedId ? 2 : 0;
    ctx.shadowColor = s.id === hoveredId ? "#ffffff" : "transparent";
    ctx.shadowBlur = s.id === hoveredId ? 8 : 0;
    ctx.fill();
    if (ctx.lineWidth > 0) ctx.stroke();
    ctx.restore();
  });

  // Draw probe
  const px = W / 2 + probeX * (W / 20);
  const py = H - 10;
  const angleRad = (probeAngle * Math.PI) / 180;

  // Probe bar
  ctx.fillStyle = "#00d4ff";
  ctx.fillRect(px - 20, py - 6, 40, 6);
  ctx.shadowColor = "#00d4ff"; ctx.shadowBlur = 10;
  ctx.fillRect(px - 20, py - 6, 40, 6);
  ctx.shadowBlur = 0;

  // Beam line
  const beamLen = H;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + beamLen * Math.sin(angleRad), py - beamLen * Math.cos(angleRad));
  ctx.strokeStyle = "rgba(0,212,255,0.25)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Title
  ctx.fillStyle = "rgba(136,153,187,0.6)";
  ctx.font = "10px Space Mono, monospace";
  ctx.fillText("SHEPP-LOGAN PHANTOM", 10, 18);
  ctx.fillText(`probe: (${probeX.toFixed(1)}, ${probeY.toFixed(1)}) cm  θ=${probeAngle}°`, 10, H - 12);
}

function drawAmode(canvas, data) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#050810";
  ctx.fillRect(0, 0, W, H);

  const { echo, depth_cm } = data;
  if (!echo) return;

  const maxDepth = depth_cm[depth_cm.length - 1];
  const maxEcho = Math.max(...echo.map(Math.abs)) || 1;

  // Grid
  ctx.strokeStyle = "rgba(30,45,74,0.4)"; ctx.lineWidth = 1;
  for (let d = 0; d <= maxDepth; d += 2) {
    const x = (d / maxDepth) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = "rgba(136,153,187,0.4)";
    ctx.font = "8px Space Mono, monospace";
    ctx.fillText(`${d}cm`, x + 2, H - 4);
  }

  // Baseline
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.strokeStyle = "rgba(136,153,187,0.2)"; ctx.lineWidth = 1; ctx.stroke();

  // Echo signal
  ctx.beginPath();
  for (let i = 0; i < echo.length; i++) {
    const x = (depth_cm[i] / maxDepth) * W;
    const y = H / 2 - (echo[i] / maxEcho) * (H / 2 - 10);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#00ff88"; ctx.lineWidth = 1.5;
  ctx.shadowColor = "#00ff88"; ctx.shadowBlur = 6;
  ctx.stroke(); ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(136,153,187,0.6)";
  ctx.font = "10px Space Mono, monospace";
  ctx.fillText("A-MODE SCAN", 8, 14);
}

export default function UltrasoundPage() {
  const [structures, setStructures] = useState([]);
  const [probeX, setProbeX] = useState(0);
  const [probeY, setProbeY] = useState(0);
  const [probeAngle, setProbeAngle] = useState(0);
  const [freqMhz, setFreqMhz] = useState(5);
  const [amodeData, setAmodeData] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedStruct, setSelectedStruct] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [mode, setMode] = useState("amode");

  const phantomRef = useRef(null);
  const amodeRef = useRef(null);

  const fetchPhantom = useCallback(async () => {
    const data = await api.phantomStructures();
    setStructures(data.structures);
  }, []);

  const fetchAmode = useCallback(async () => {
    const data = await api.amodeScam({ probe_x: probeX, probe_y: probeY, angle: probeAngle, frequency_mhz: freqMhz });
    setAmodeData(data);
  }, [probeX, probeY, probeAngle, freqMhz]);

  useEffect(() => { fetchPhantom(); }, [fetchPhantom]);
  useEffect(() => {
    const t = setTimeout(fetchAmode, 200);
    return () => clearTimeout(t);
  }, [fetchAmode]);

  useEffect(() => {
    if (!phantomRef.current) return;
    const canvas = phantomRef.current;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    drawPhantom(canvas, structures, probeX, probeY, probeAngle, hoveredId, selectedId);
  }, [structures, probeX, probeY, probeAngle, hoveredId, selectedId]);

  useEffect(() => {
    if (!amodeRef.current) return;
    const canvas = amodeRef.current;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    drawAmode(canvas, amodeData);
  }, [amodeData]);

  const handlePhantomClick = (e) => {
    if (!phantomRef.current) return;
    const rect = phantomRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = phantomRef.current.width, H = phantomRef.current.height;

    for (const s of [...structures].reverse()) {
      const { cx: pcx, cy: pcy, rx: prx, ry: pry } = phantomToCanvas(s.cx, s.cy, s.rx, s.ry, W, H);
      const dx = (mx - pcx) / prx, dy = (my - pcy) / pry;
      if (dx * dx + dy * dy <= 1) {
        setSelectedId(s.id);
        setSelectedStruct(s);
        setEditForm({
          acoustic_impedance: s.acoustic_impedance,
          attenuation_db_cm: s.attenuation_db_cm,
          speed_of_sound: s.speed_of_sound,
        });
        return;
      }
    }
    setSelectedId(null); setSelectedStruct(null);
  };

  const handlePhantomHover = (e) => {
    if (!phantomRef.current) return;
    const rect = phantomRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = phantomRef.current.width, H = phantomRef.current.height;

    let found = null;
    for (const s of [...structures].reverse()) {
      const { cx: pcx, cy: pcy, rx: prx, ry: pry } = phantomToCanvas(s.cx, s.cy, s.rx, s.ry, W, H);
      const dx = (mx - pcx) / prx, dy = (my - pcy) / pry;
      if (dx * dx + dy * dy <= 1) { found = s.id; break; }
    }
    setHoveredId(found);
  };

  const saveStructureEdit = async () => {
    if (!selectedId) return;
    await api.updateStructure(selectedId, editForm);
    await fetchPhantom();
    await fetchAmode();
  };

  return (
    <div className="page">
      {/* Left sidebar */}
      <div className="sidebar">
        <div className="panel-section">
          <div className="panel-title">Probe Settings</div>

          <Slider label="Position X" value={probeX} min={-8} max={8} step={0.2}
            unit=" cm" onChange={setProbeX} />
          <Slider label="Beam Angle" value={probeAngle} min={-45} max={45} step={1}
            unit="°" onChange={setProbeAngle} />
          <Slider label="Frequency" value={freqMhz} min={1} max={20} step={0.5}
            unit=" MHz" onChange={setFreqMhz} />
        </div>

        <div className="panel-section">
          <div className="panel-title">Scan Mode</div>
          <div className="toggle-group">
            {["amode", "bmode"].map((m) => (
              <button key={m} className={`toggle-btn ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Selected structure editor */}
        {selectedStruct && (
          <div className="panel-section">
            <div className="panel-title" style={{ color: "var(--warn)" }}>
              ✎ Edit Structure
            </div>
            <div className="info-card">
              <div className="info-row"><span>Label</span><strong>{selectedStruct.label}</strong></div>
            </div>

            <div className="control-row">
              <div className="control-label"><span>Acoustic Impedance (MRayl)</span></div>
              <input type="number" className="select"
                value={(editForm.acoustic_impedance / 1e6).toFixed(3)}
                step={0.01}
                onChange={(e) => setEditForm((f) => ({ ...f, acoustic_impedance: parseFloat(e.target.value) * 1e6 }))} />
            </div>
            <div className="control-row">
              <div className="control-label"><span>Attenuation (dB/cm/MHz)</span></div>
              <input type="number" className="select"
                value={editForm.attenuation_db_cm}
                step={0.05}
                onChange={(e) => setEditForm((f) => ({ ...f, attenuation_db_cm: parseFloat(e.target.value) }))} />
            </div>
            <div className="control-row">
              <div className="control-label"><span>Speed of Sound (m/s)</span></div>
              <input type="number" className="select"
                value={editForm.speed_of_sound}
                step={10}
                onChange={(e) => setEditForm((f) => ({ ...f, speed_of_sound: parseFloat(e.target.value) }))} />
            </div>
            <button className="btn primary" onClick={saveStructureEdit}>Apply Changes</button>
            <button className="btn" onClick={() => { setSelectedId(null); setSelectedStruct(null); }}>Cancel</button>
          </div>
        )}

        {/* Hover tooltip */}
        {hoveredId && !selectedStruct && (() => {
          const s = structures.find((x) => x.id === hoveredId);
          if (!s) return null;
          return (
            <div className="panel-section">
              <div className="panel-title">Structure Info</div>
              <div className="info-card">
                <div className="info-row"><span>Label</span><strong>{s.label}</strong></div>
                <div className="info-row"><span>Z (MRayl)</span><strong>{(s.acoustic_impedance / 1e6).toFixed(3)}</strong></div>
                <div className="info-row"><span>α (dB/cm/MHz)</span><strong>{s.attenuation_db_cm}</strong></div>
                <div className="info-row"><span>c (m/s)</span><strong>{s.speed_of_sound}</strong></div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Main content */}
      <div className="content">
        <div style={{
          padding: "8px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", gap: 8, alignItems: "center", background: "var(--panel)", flexShrink: 0
        }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
            🫀 Ultrasound Simulator · Shepp-Logan Phantom
          </span>
          <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
            hover structures to inspect · click to edit
          </span>
        </div>

        <div className="viz-area" style={{ padding: 8, gap: 8, flexDirection: "column" }}>
          {/* Top: Phantom + A-mode side by side */}
          <div style={{ flex: 2, display: "flex", gap: 8, overflow: "hidden" }}>
            {/* Phantom viewer */}
            <div className="viz-panel" style={{ flex: 1 }}>
              <div className="viz-header">
                <span className="viz-title">PHANTOM VIEW</span>
                <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                  click to edit structures
                </span>
              </div>
              <div className="viz-body" style={{ position: "relative" }}
                onMouseMove={handlePhantomHover}
                onMouseLeave={() => setHoveredId(null)}
                onClick={handlePhantomClick}>
                <canvas ref={phantomRef}
                  style={{ display: "block", width: "100%", height: "100%", cursor: hoveredId ? "pointer" : "default" }} />
              </div>
            </div>

            {/* A-mode */}
            <div className="viz-panel" style={{ flex: 1 }}>
              <div className="viz-header">
                <span className="viz-title">{mode.toUpperCase()} OUTPUT</span>
                <span style={{ fontSize: 10, color: "var(--accent3)", fontFamily: "var(--font-mono)" }}>
                  {freqMhz} MHz probe
                </span>
              </div>
              <div className="viz-body">
                <canvas ref={amodeRef} style={{ display: "block", width: "100%", height: "100%" }} />
              </div>
            </div>
          </div>
        </div>

        <div className="status-bar">
          <div className="status-item">probe_x <span>{probeX.toFixed(1)} cm</span></div>
          <div className="status-item">angle <span>{probeAngle}°</span></div>
          <div className="status-item">freq <span>{freqMhz} MHz</span></div>
          <div className="status-item">λ <span>{(1540 / (freqMhz * 1e6) * 1000).toFixed(3)} mm</span></div>
          <div className="status-item">mode <span>{mode}</span></div>
        </div>
      </div>
    </div>
  );
}
