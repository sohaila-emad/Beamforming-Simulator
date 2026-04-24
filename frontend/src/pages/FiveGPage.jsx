import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api";
import { Slider } from "../components/ControlPanel";

const TOWER_COLORS = { t1: "#00d4ff", t2: "#00ff88", t3: "#ff6b35" };
const USER_COLORS = { u1: "#a855f7", u2: "#ffb800" };
const KEY_STEP = 20;

// WASD = user1, IJKL = user2
const KEY_MAP_FULL = {
  w: { uid: "u1", dx: 0, dy: KEY_STEP },
  s: { uid: "u1", dx: 0, dy: -KEY_STEP },
  a: { uid: "u1", dx: -KEY_STEP, dy: 0 },
  d: { uid: "u1", dx: KEY_STEP, dy: 0 },
  i: { uid: "u2", dx: 0, dy: KEY_STEP },
  k: { uid: "u2", dx: 0, dy: -KEY_STEP },
  j: { uid: "u2", dx: -KEY_STEP, dy: 0 },
  l: { uid: "u2", dx: KEY_STEP, dy: 0 },
};

function draw5G(canvas, state, beamProfiles, dragHighlight) {
  if (!canvas || !state) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#050810";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(30,45,74,0.4)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const toCanvas = (x, y) => ({ cx: W / 2 + x * 0.8, cy: H / 2 - y * 0.8 });
  const { towers, users } = state;

  // Coverage circles
  Object.values(towers).forEach((t) => {
    const { cx, cy } = toCanvas(t.x, t.y);
    const cr = t.coverage_radius * 0.8;
    const col = TOWER_COLORS[t.id] || "#00d4ff";
    const hi = dragHighlight === t.id;
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.strokeStyle = hi ? col + "88" : col + "44";
    ctx.lineWidth = hi ? 2.5 : 1.5;
    ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    grad.addColorStop(0, col + (hi ? "14" : "08")); grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad; ctx.fill();
  });

  // Beam lines — one per (tower, user) pair, dual-user gets dashed style + badge
  Object.values(users).forEach((u) => {
    if (!u.connected_tower) return;
    const tower = towers[u.connected_tower]; if (!tower) return;
    const { cx: tx, cy: ty } = toCanvas(tower.x, tower.y);
    const { cx: ux, cy: uy } = toCanvas(u.x, u.y);
    const tCol = TOWER_COLORS[tower.id] || "#00d4ff";
    const uCol = USER_COLORS[u.id] || "#fff";
    const isDual = (tower.connected_users?.length || 0) > 1;
    const grad = ctx.createLinearGradient(tx, ty, ux, uy);
    grad.addColorStop(0, tCol + "cc"); grad.addColorStop(1, uCol + "88");
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(ux, uy);
    if (isDual) ctx.setLineDash([8, 4]);
    ctx.strokeStyle = grad; ctx.lineWidth = isDual ? 1.5 : 2;
    ctx.shadowColor = tCol; ctx.shadowBlur = isDual ? 4 : 8; ctx.stroke();
    ctx.shadowBlur = 0; ctx.setLineDash([]);
    const mx = (tx + ux) / 2, my = (ty + uy) / 2;
    ctx.fillStyle = uCol + "cc"; ctx.font = "9px Space Mono, monospace";
    ctx.fillText(`${u.signal_strength?.toFixed(0)} dBm`, mx + 4, my - 4);
  });
  // Dual-user badge
  Object.values(towers).forEach((t) => {
    if ((t.connected_users?.length || 0) < 2) return;
    const { cx, cy } = toCanvas(t.x, t.y);
    ctx.fillStyle = "#ffb800"; ctx.font = "bold 9px Space Mono, monospace"; ctx.textAlign = "center";
    ctx.fillText(`⇄ ${t.connected_users.length} users`, cx, cy - 24);
    ctx.textAlign = "left";
  });

  // Towers
  Object.values(towers).forEach((t) => {
    const { cx, cy } = toCanvas(t.x, t.y);
    const col = TOWER_COLORS[t.id] || "#00d4ff";
    const hi = dragHighlight === t.id;
    ctx.beginPath(); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx - 12, cy + 10); ctx.lineTo(cx + 12, cy + 10); ctx.closePath();
    ctx.fillStyle = hi ? col + "55" : col + "33"; ctx.strokeStyle = col;
    ctx.lineWidth = hi ? 3 : 2; ctx.shadowColor = col; ctx.shadowBlur = hi ? 20 : 12;
    ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    const bdRad = (t.beam_direction * Math.PI) / 180;
    const ax = cx + 40 * Math.sin(bdRad), ay = cy - 40 * Math.cos(bdRad);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay);
    ctx.strokeStyle = col + "99"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.font = "bold 11px Space Mono, monospace"; ctx.textAlign = "center";
    ctx.fillText(t.id.toUpperCase(), cx, cy + 24);
    ctx.fillStyle = "rgba(136,153,187,0.7)"; ctx.font = "9px Space Mono, monospace";
    ctx.fillText(`${t.beam_direction.toFixed(0)}° · ${t.num_elements}el`, cx, cy + 35);
    ctx.fillText(`${(t.frequency / 1e9).toFixed(1)} GHz`, cx, cy + 45);
    ctx.textAlign = "left";
  });

  // Users
  Object.values(users).forEach((u) => {
    const { cx, cy } = toCanvas(u.x, u.y);
    const col = USER_COLORS[u.id] || "#fff";
    const connected = !!u.connected_tower;
    const hi = dragHighlight === u.id;
    ctx.beginPath(); ctx.arc(cx, cy, hi ? 10 : 8, 0, Math.PI * 2);
    ctx.fillStyle = col + "33"; ctx.strokeStyle = connected ? col : "#666";
    ctx.lineWidth = hi ? 3 : 2.5; ctx.shadowColor = connected ? col : "transparent";
    ctx.shadowBlur = connected ? (hi ? 20 : 12) : 0; ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = col; ctx.font = "bold 10px Space Mono, monospace"; ctx.textAlign = "center";
    ctx.fillText(u.id.toUpperCase(), cx, cy - 14);
    ctx.fillStyle = connected ? col + "bb" : "#66666688"; ctx.font = "9px Space Mono, monospace";
    ctx.fillText(connected ? `→ ${u.connected_tower}` : "no signal", cx, cy + 20);
    ctx.textAlign = "left";
  });

  ctx.fillStyle = "rgba(136,153,187,0.5)"; ctx.font = "10px Space Mono, monospace";
  ctx.fillText("5G NETWORK SIMULATOR", 12, 20);
  ctx.font = "9px Space Mono, monospace";
  ctx.fillStyle = USER_COLORS.u1 + "99"; ctx.fillText("U1: WASD", 12, H - 24);
  ctx.fillStyle = USER_COLORS.u2 + "99"; ctx.fillText("U2: IJKL", 90, H - 24);
  ctx.fillStyle = "rgba(136,153,187,0.4)"; ctx.fillText("drag towers & users to reposition", 12, H - 10);
}

function drawMiniBeam(canvas, data, color) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#050810"; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.92, R = Math.min(W, H) * 0.75;
  [0.25, 0.5, 0.75, 1].forEach((f) => {
    ctx.beginPath(); ctx.arc(cx, cy, R * f, Math.PI, 2 * Math.PI);
    ctx.strokeStyle = "rgba(30,45,74,0.6)"; ctx.lineWidth = 1; ctx.stroke();
  });
  const { theta_deg, af_db } = data; if (!theta_deg) return;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < theta_deg.length; i++) {
    const r = ((af_db[i] + 60) / 60) * R;
    const rad = theta_deg[i] * Math.PI / 180;
    const x = cx + r * Math.sin(rad), y = cy - r * Math.cos(rad);
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.stroke(); ctx.shadowBlur = 0;
}

export default function FiveGPage() {
  const [state, setState] = useState(null);
  const [beamProfiles, setBeamProfiles] = useState({});
  const [dragging, setDragging] = useState(null);
  const [dragHighlight, setDragHighlight] = useState(null);
  const [editingTower, setEditingTower] = useState(null);
  const [flashingTowers, setFlashingTowers] = useState({});
  const canvasRef = useRef(null);
  const miniRefs = { t1: useRef(null), t2: useRef(null), t3: useRef(null) };
  const stateRef = useRef(null);
  const prevBeamDirsRef = useRef({});

  const refreshProfiles = useCallback(async (data) => {
    const profiles = {};
    for (const tid of Object.keys(data.towers)) {
      profiles[tid] = await api.fivegTowerBeam(tid);
    }
    setBeamProfiles(profiles);
    // Detect beam direction changes and flash those towers
    const changed = [];
    Object.values(data.towers).forEach(t => {
      const prev = prevBeamDirsRef.current[t.id];
      if (prev !== undefined && Math.abs(prev - t.beam_direction) > 0.5) changed.push(t.id);
      prevBeamDirsRef.current[t.id] = t.beam_direction;
    });
    if (changed.length > 0) {
      setFlashingTowers(f => {
        const next = { ...f };
        changed.forEach(tid => { next[tid] = Date.now(); });
        return next;
      });
    }
  }, []);

  const fetchState = useCallback(async () => {
    const data = await api.fivegState();
    setState(data); stateRef.current = data;
    await refreshProfiles(data);
  }, [refreshProfiles]);

  useEffect(() => { fetchState(); }, [fetchState]);

  // Keyboard movement (WASD / IJKL) with repeat on hold
  useEffect(() => {
    const pressed = new Set();
    const pending = {};

    const doMove = async (uid, dx, dy) => {
      if (!stateRef.current) return;
      const u = stateRef.current.users[uid]; if (!u) return;
      try {
        const data = await api.fivegMoveUser(uid, u.x + dx, u.y + dy);
        setState(data); stateRef.current = data;
        await refreshProfiles(data);
      } catch (_) {}
    };

    const tick = () => {
      pressed.forEach(key => {
        const m = KEY_MAP_FULL[key]; if (m) doMove(m.uid, m.dx, m.dy);
      });
    };
    const interval = setInterval(tick, 100);

    const onDown = (e) => {
      const k = e.key.toLowerCase();
      if (KEY_MAP_FULL[k]) { e.preventDefault(); pressed.add(k); }
    };
    const onUp = (e) => { pressed.delete(e.key.toLowerCase()); };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { clearInterval(interval); window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [refreshProfiles]);

  // Redraw canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    const c = canvasRef.current, p = c.parentElement;
    c.width = p.clientWidth; c.height = p.clientHeight;
    draw5G(c, state, beamProfiles, dragHighlight);
  }, [state, beamProfiles, dragHighlight]);

  // Redraw mini beams
  useEffect(() => {
    Object.entries(miniRefs).forEach(([tid, ref]) => {
      if (ref.current && beamProfiles[tid]) {
        const p = ref.current.parentElement;
        ref.current.width = p?.clientWidth || 200;
        ref.current.height = p?.clientHeight || 80;
        drawMiniBeam(ref.current, beamProfiles[tid], TOWER_COLORS[tid]);
      }
    });
  }, [beamProfiles]);

  const toWorld = (cx, cy) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const { width, height } = canvasRef.current;
    return { x: (cx - width / 2) / 0.8, y: -(cy - height / 2) / 0.8 };
  };

  const hitDist = (entity, mx, my) => {
    if (!canvasRef.current) return 9999;
    const { width: W, height: H } = canvasRef.current;
    return Math.hypot(mx - (W / 2 + entity.x * 0.8), my - (H / 2 - entity.y * 0.8));
  };

  const handleMouseDown = (e) => {
    if (!state) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    for (const [tid, t] of Object.entries(state.towers)) {
      if (hitDist(t, mx, my) < 22) { setDragging({ id: tid, type: "tower" }); setDragHighlight(tid); return; }
    }
    for (const [uid, u] of Object.entries(state.users)) {
      if (hitDist(u, mx, my) < 18) { setDragging({ id: uid, type: "user" }); setDragHighlight(uid); return; }
    }
  };

  const handleMouseMove = (e) => {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const { id, type } = dragging;
    setState(s => {
      if (!s) return s;
      if (type === "tower") return { ...s, towers: { ...s.towers, [id]: { ...s.towers[id], x, y } } };
      return { ...s, users: { ...s.users, [id]: { ...s.users[id], x, y } } };
    });
  };

  const handleMouseUp = async (e) => {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const { id, type } = dragging;
    let data;
    try {
      if (type === "tower") data = await api.fivegMoveTower(id, x, y);
      else data = await api.fivegMoveUser(id, x, y);
      setState(data); stateRef.current = data;
      await refreshProfiles(data);
    } catch (err) {
      // If tower move API not available, fall back to just moving in state
      console.warn("Tower move:", err);
    }
    setDragging(null); setDragHighlight(null);
  };

  const updateTower = async (tid, key, val) => {
    const data = await api.fivegUpdateTower({ tower_id: tid, [key]: val });
    setState(data); stateRef.current = data;
    await refreshProfiles(data);
  };

  const reset = async () => {
    const data = await api.fivegReset();
    setState(data); stateRef.current = data;
  };

  return (
    <div className="page">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center", background: "var(--panel)", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>📡 5G Beamforming Simulator</span>
          <span style={{ fontSize: 9, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
            <span style={{ color: USER_COLORS.u1 + "cc" }}>U1: WASD</span>
            {" · "}
            <span style={{ color: USER_COLORS.u2 + "cc" }}>U2: IJKL</span>
            {" · drag towers or users to reposition"}
          </span>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={reset}>↺ Reset</button>
        </div>

        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp} onMouseLeave={() => { setDragging(null); setDragHighlight(null); }}>
          <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: dragging ? "grabbing" : "grab" }} />
        </div>

        <div className="status-bar">
          {state && Object.values(state.users).map((u) => (
            <div key={u.id} className="status-item">
              <span style={{ color: USER_COLORS[u.id] }}>{u.id}</span>{" "}
              <span style={{ color: u.connected_tower ? "var(--accent3)" : "var(--danger)" }}>
                {u.connected_tower ? `→ ${u.connected_tower} (${u.signal_strength?.toFixed(0)} dBm)` : "No signal"}
              </span>
            </div>
          ))}
          {state && Object.values(state.towers).map((t) => (
            <div key={t.id} className="status-item">
              <span style={{ color: TOWER_COLORS[t.id] }}>{t.id.toUpperCase()}</span>{" "}
              <span>{t.connected_users?.length ? t.connected_users.join("+") : "idle"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel - tower controls */}
      <div className="sidebar" style={{ borderLeft: "1px solid var(--border)", borderRight: "none" }}>
        {state && Object.values(state.towers).map((tower) => {
          const isFlashing = flashingTowers[tower.id] && (Date.now() - flashingTowers[tower.id]) < 1200;
          return (
          <div className="panel-section" key={tower.id}
            style={{ border: editingTower === tower.id ? `1px solid ${TOWER_COLORS[tower.id]}44` : undefined }}>
            <div className="panel-title" style={{ color: TOWER_COLORS[tower.id], display: "flex", justifyContent: "space-between", alignItems: "center",
              background: isFlashing ? TOWER_COLORS[tower.id] + "22" : undefined, transition: "background 0.3s", borderRadius: 3, padding: "2px 4px" }}>
              <span>▲ Tower {tower.id.toUpperCase()} {isFlashing ? "⟳" : ""}</span>
              <button className="btn" style={{ padding: "1px 7px", fontSize: 9 }}
                onClick={() => setEditingTower(editingTower === tower.id ? null : tower.id)}>
                {editingTower === tower.id ? "▲" : "✎"}
              </button>
            </div>

            <div style={{ height: 80, position: "relative", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--bg3)" }}>
              <canvas ref={miniRefs[tower.id]} style={{ width: "100%", height: "100%" }} />
            </div>

            <div className="info-card">
              <div className="info-row"><span>Steer</span><strong style={{ color: TOWER_COLORS[tower.id] }}>{tower.beam_direction?.toFixed(1)}°</strong></div>
              <div className="info-row"><span>Position</span><strong>({tower.x?.toFixed(0)}, {tower.y?.toFixed(0)})</strong></div>
              <div className="info-row"><span>Freq</span><strong>{(tower.frequency / 1e9).toFixed(2)} GHz</strong></div>
              <div className="info-row"><span>Coverage</span><strong>{tower.coverage_radius} m</strong></div>
              <div className="info-row">
                <span>Users</span>
                <strong style={{ color: tower.connected_users?.length > 1 ? "#ffb800" : undefined }}>
                  {tower.connected_users?.length > 0 ? tower.connected_users.join(" + ") : <span style={{ color: "var(--text3)" }}>none</span>}
                </strong>
              </div>
            </div>

            {editingTower === tower.id && (
              <div style={{ marginTop: 6 }}>
                <Slider label="Coverage (m)" value={tower.coverage_radius}
                  min={100} max={800} step={10}
                  onChange={(v) => updateTower(tower.id, "coverage_radius", v)} />
                <Slider label="Elements" value={tower.num_elements}
                  min={4} max={128} step={4}
                  onChange={(v) => updateTower(tower.id, "num_elements", v)} />
                <Slider label="Frequency (GHz)" value={tower.frequency / 1e9}
                  min={0.7} max={28} step={0.1}
                  fmt={v => v.toFixed(1) + " GHz"}
                  onChange={(v) => updateTower(tower.id, "frequency", v * 1e9)} />
                <div style={{ fontSize: 9, color: "var(--accent3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                  ✓ changes applied live
                </div>
              </div>
            )}
          </div>
        );
        })}

        <div className="panel-section">
          <div className="panel-title">Controls</div>
          <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text2)", lineHeight: 1.9 }}>
            <span style={{ color: USER_COLORS.u1 }}>■</span> U1 move: W/A/S/D<br />
            <span style={{ color: USER_COLORS.u2 }}>■</span> U2 move: I/J/K/L<br />
            <span style={{ color: "var(--text3)" }}>▲</span> Drag tower to relocate<br />
            <span style={{ color: "var(--text3)" }}>●</span> Drag user to reposition
          </div>
        </div>
      </div>
    </div>
  );
}