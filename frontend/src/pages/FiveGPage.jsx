import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api";
import { Slider } from "../components/ControlPanel";

const GRID_W = 1000, GRID_H = 700;
const TOWER_COLORS = { t1: "#00d4ff", t2: "#00ff88", t3: "#ff6b35" };
const USER_COLORS = { u1: "#a855f7", u2: "#ffb800" };

function draw5G(canvas, state, beamProfiles) {
  if (!canvas || !state) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#050810";
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = "rgba(30,45,74,0.4)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const toCanvas = (x, y) => ({ cx: W / 2 + x * 0.8, cy: H / 2 - y * 0.8 });

  const { towers, users } = state;

  // Draw coverage circles
  Object.values(towers).forEach((t) => {
    const { cx, cy } = toCanvas(t.x, t.y);
    const cr = t.coverage_radius * 0.8;
    const col = TOWER_COLORS[t.id] || "#00d4ff";

    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.strokeStyle = col + "44";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fill
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    grad.addColorStop(0, col + "08");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fill();
  });

  // Draw beam lines to connected users
  Object.values(users).forEach((u) => {
    if (!u.connected_tower) return;
    const tower = towers[u.connected_tower];
    if (!tower) return;
    const { cx: tx, cy: ty } = toCanvas(tower.x, tower.y);
    const { cx: ux, cy: uy } = toCanvas(u.x, u.y);
    const col = TOWER_COLORS[tower.id] || "#00d4ff";

    const grad = ctx.createLinearGradient(tx, ty, ux, uy);
    grad.addColorStop(0, col + "cc");
    grad.addColorStop(1, (USER_COLORS[u.id] || "#ffffff") + "88");

    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(ux, uy);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.shadowColor = col;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Signal strength marker at midpoint
    const mx = (tx + ux) / 2, my = (ty + uy) / 2;
    ctx.fillStyle = col + "cc";
    ctx.font = "9px Space Mono, monospace";
    ctx.fillText(`${u.signal_strength?.toFixed(0)} dBm`, mx + 4, my - 4);
  });

  // Draw towers
  Object.values(towers).forEach((t) => {
    const { cx, cy } = toCanvas(t.x, t.y);
    const col = TOWER_COLORS[t.id] || "#00d4ff";

    // Tower icon (triangle)
    ctx.beginPath();
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx - 12, cy + 10);
    ctx.lineTo(cx + 12, cy + 10);
    ctx.closePath();
    ctx.fillStyle = col + "33";
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // Beam direction arrow
    const bdRad = (t.beam_direction * Math.PI) / 180;
    const arrowLen = 40;
    const ax = cx + arrowLen * Math.sin(bdRad);
    const ay = cy - arrowLen * Math.cos(bdRad);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay);
    ctx.strokeStyle = col + "99"; ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.fillStyle = col;
    ctx.font = "bold 11px Space Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(t.id.toUpperCase(), cx, cy + 24);
    ctx.fillStyle = "rgba(136,153,187,0.7)";
    ctx.font = "9px Space Mono, monospace";
    ctx.fillText(`${t.beam_direction.toFixed(0)}° · ${t.num_elements}el`, cx, cy + 35);
    ctx.fillText(`${(t.frequency / 1e9).toFixed(1)} GHz`, cx, cy + 45);
    ctx.textAlign = "left";
  });

  // Draw users
  Object.values(users).forEach((u) => {
    const { cx, cy } = toCanvas(u.x, u.y);
    const col = USER_COLORS[u.id] || "#ffffff";
    const connected = !!u.connected_tower;

    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = col + "33";
    ctx.strokeStyle = connected ? col : "#666";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = connected ? col : "transparent";
    ctx.shadowBlur = connected ? 12 : 0;
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = col;
    ctx.font = "bold 10px Space Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(u.id.toUpperCase(), cx, cy - 14);
    ctx.fillStyle = connected ? col + "bb" : "#66666688";
    ctx.font = "9px Space Mono, monospace";
    ctx.fillText(connected ? `→ ${u.connected_tower}` : "no signal", cx, cy + 20);
    ctx.textAlign = "left";
  });

  // Title
  ctx.fillStyle = "rgba(136,153,187,0.5)";
  ctx.font = "10px Space Mono, monospace";
  ctx.fillText("5G NETWORK SIMULATOR", 12, 20);
  ctx.fillText("drag users to move · right-panel shows live tower params", 12, H - 10);
}

// Beam pattern mini-canvas
function drawMiniBeam(canvas, data, color) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#050810";
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H * 0.92;
  const R = Math.min(W, H) * 0.75;

  // Grid
  [0.25, 0.5, 0.75, 1].forEach((f) => {
    ctx.beginPath(); ctx.arc(cx, cy, R * f, Math.PI, 2 * Math.PI);
    ctx.strokeStyle = "rgba(30,45,74,0.6)"; ctx.lineWidth = 1; ctx.stroke();
  });

  const { theta_deg, af_db } = data;
  if (!theta_deg) return;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < theta_deg.length; i++) {
    const r = ((af_db[i] + 60) / 60) * R;
    const rad = theta_deg[i] * Math.PI / 180;
    const x = cx + r * Math.sin(rad), y = cy - r * Math.cos(rad);
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.stroke(); ctx.shadowBlur = 0;
}

export default function FiveGPage() {
  const [state, setState] = useState(null);
  const [beamProfiles, setBeamProfiles] = useState({});
  const [dragging, setDragging] = useState(null);
  const canvasRef = useRef(null);
  const miniRefs = { t1: useRef(null), t2: useRef(null), t3: useRef(null) };

  const fetchState = useCallback(async () => {
    const data = await api.fivegState();
    setState(data);
    // Fetch beam profiles for all towers
    const profiles = {};
    for (const tid of Object.keys(data.towers)) {
      profiles[tid] = await api.fivegTowerBeam(tid);
    }
    setBeamProfiles(profiles);
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    draw5G(canvas, state, beamProfiles);
  }, [state, beamProfiles]);

  useEffect(() => {
    Object.entries(miniRefs).forEach(([tid, ref]) => {
      if (ref.current && beamProfiles[tid]) {
        ref.current.width = ref.current.parentElement.clientWidth;
        ref.current.height = ref.current.parentElement.clientHeight;
        drawMiniBeam(ref.current, beamProfiles[tid], TOWER_COLORS[tid]);
      }
    });
  }, [beamProfiles]);

  const toWorld = (canvasX, canvasY) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const { width, height } = canvasRef.current;
    return {
      x: (canvasX - width / 2) / 0.8,
      y: -(canvasY - height / 2) / 0.8,
    };
  };

  const handleMouseDown = (e) => {
    if (!state) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = canvasRef.current.width, H = canvasRef.current.height;

    for (const [uid, u] of Object.entries(state.users)) {
      const cx = W / 2 + u.x * 0.8, cy = H / 2 - u.y * 0.8;
      if (Math.hypot(mx - cx, my - cy) < 16) {
        setDragging(uid); return;
      }
    }
  };

  const handleMouseMove = (e) => {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    setState((s) => {
      if (!s) return s;
      return {
        ...s,
        users: { ...s.users, [dragging]: { ...s.users[dragging], x, y } }
      };
    });
  };

  const handleMouseUp = async (e) => {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const data = await api.fivegMoveUser(dragging, x, y);
    setState(data);
    const profiles = {};
    for (const tid of Object.keys(data.towers)) {
      profiles[tid] = await api.fivegTowerBeam(tid);
    }
    setBeamProfiles(profiles);
    setDragging(null);
  };

  const updateTower = async (tid, key, val) => {
    const data = await api.fivegUpdateTower({ tower_id: tid, [key]: val });
    setState(data);
    const profiles = {};
    for (const t of Object.keys(data.towers)) {
      profiles[t] = await api.fivegTowerBeam(t);
    }
    setBeamProfiles(profiles);
  };

  const reset = async () => {
    const data = await api.fivegReset();
    setState(data);
  };

  return (
    <div className="page">
      {/* Main canvas area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{
          padding: "8px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", gap: 12, alignItems: "center", background: "var(--panel)", flexShrink: 0
        }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
            📡 5G Beamforming Simulator
          </span>
          <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
            drag users · towers auto-steer
          </span>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={reset}>↺ Reset</button>
        </div>

        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setDragging(null)}>
          <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: dragging ? "grabbing" : "grab" }} />
        </div>

        {/* Status bar */}
        <div className="status-bar">
          {state && Object.values(state.users).map((u) => (
            <div key={u.id} className="status-item">
              {u.id} <span className={u.connected_tower ? "" : ""}
                style={{ color: u.connected_tower ? "var(--accent3)" : "var(--danger)" }}>
                {u.connected_tower ? `→ ${u.connected_tower} (${u.signal_strength?.toFixed(0)} dBm)` : "No signal"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel - tower controls */}
      <div className="sidebar" style={{ borderLeft: "1px solid var(--border)", borderRight: "none" }}>
        {state && Object.values(state.towers).map((tower) => (
          <div className="panel-section" key={tower.id}>
            <div className="panel-title" style={{ color: TOWER_COLORS[tower.id] }}>
              ▲ Tower {tower.id.toUpperCase()}
            </div>

            {/* Mini beam pattern */}
            <div style={{ height: 80, position: "relative", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--bg3)" }}>
              <canvas ref={miniRefs[tower.id]} style={{ width: "100%", height: "100%" }} />
            </div>

            <div className="info-card">
              <div className="info-row"><span>Direction</span><strong>{tower.beam_direction?.toFixed(1)}°</strong></div>
              <div className="info-row"><span>Elements</span><strong>{tower.num_elements}</strong></div>
              <div className="info-row"><span>Freq</span><strong>{(tower.frequency / 1e9).toFixed(2)} GHz</strong></div>
              <div className="info-row"><span>Coverage</span><strong>{tower.coverage_radius} m</strong></div>
              <div className="info-row">
                <span>Users</span>
                <strong>
                  {tower.connected_users.length > 0
                    ? tower.connected_users.join(", ")
                    : <span style={{ color: "var(--text3)" }}>none</span>}
                </strong>
              </div>
            </div>

            <Slider label="Coverage (m)" value={tower.coverage_radius}
              min={100} max={800} step={10}
              onChange={(v) => updateTower(tower.id, "coverage_radius", v)} />
            <Slider label="Elements" value={tower.num_elements}
              min={4} max={128} step={4}
              onChange={(v) => updateTower(tower.id, "num_elements", v)} />
          </div>
        ))}
      </div>
    </div>
  );
}
