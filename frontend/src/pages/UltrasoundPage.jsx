import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api";

// ─── Phantom draw ─────────────────────────────────────────────────────────────
function drawPhantom(canvas, structures, probeX, probeAngle, hoveredId, selectedId) {
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

  // Draw structures back to front
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
      ctx.lineWidth = 2;
      ctx.shadowColor = isSel ? "#ffb800" : "#fff";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  });

  // Probe
  const px = W / 2 + probeX * scaleX;
  const py = H - 8;
  const angleRad = probeAngle * Math.PI / 180;
  ctx.fillStyle = "#00d4ff";
  ctx.shadowColor = "#00d4ff"; ctx.shadowBlur = 10;
  ctx.fillRect(px - 22, py - 6, 44, 6);
  ctx.shadowBlur = 0;

  // Beam line
  ctx.beginPath(); ctx.moveTo(px, py);
  ctx.lineTo(px + H * 1.2 * Math.sin(angleRad), py - H * 1.2 * Math.cos(angleRad));
  ctx.strokeStyle = "rgba(0,212,255,0.2)"; ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);

  ctx.fillStyle = "rgba(90,133,170,0.5)"; ctx.font = "9px monospace"; ctx.textAlign = "left";
  ctx.fillText("SHEPP-LOGAN PHANTOM  hover=inspect  click=edit", 8, 14);
  ctx.fillText(`probe x=${probeX.toFixed(1)} cm  θ=${probeAngle}°`, 8, H - 8);
}

// ─── A-mode draw ──────────────────────────────────────────────────────────────
function drawAmode(canvas, data) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#030810"; ctx.fillRect(0, 0, W, H);
  if (!data || !data.echo) {
    ctx.fillStyle = "rgba(90,133,170,0.35)"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    ctx.fillText("A-mode — move probe to scan", W/2, H/2); ctx.textAlign = "left"; return;
  }
  const { echo, depth_cm } = data;
  const maxD = depth_cm[depth_cm.length - 1] || 20;
  const maxE = Math.max(...echo.map(Math.abs), 1e-6);
  const pL = 28, pB = 14, pT = 14, pw = W - pL - 6, ph = H - pB - pT;

  // Grid
  [0,5,10,15,20].filter(d=>d<=maxD).forEach(d=>{
    const x = pL + d / maxD * pw;
    ctx.strokeStyle = "rgba(26,50,90,0.4)"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, pT + ph); ctx.stroke();
    ctx.fillStyle = "rgba(90,133,170,0.5)"; ctx.font = "7px monospace"; ctx.textAlign = "center";
    ctx.fillText(d + "cm", x, H - 3);
  });
  ctx.beginPath(); ctx.moveTo(pL, pT + ph/2); ctx.lineTo(pL + pw, pT + ph/2);
  ctx.strokeStyle = "rgba(30,60,100,0.4)"; ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < echo.length; i++) {
    const x = pL + depth_cm[i] / maxD * pw;
    const y = pT + ph/2 - (echo[i] / maxE) * (ph/2 - 4);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#00ff88"; ctx.lineWidth = 1.5;
  ctx.shadowColor = "#00ff88"; ctx.shadowBlur = 4; ctx.stroke(); ctx.shadowBlur = 0;

  ctx.textAlign = "left"; ctx.fillStyle = "rgba(90,133,170,0.5)"; ctx.font = "9px monospace";
  ctx.fillText("A-MODE  echo amplitude vs depth", pL + 4, pT + 10);
}

// ─── B-mode draw ──────────────────────────────────────────────────────────────
function drawBmode(canvas, data) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (!data || !data.lines) {
    ctx.fillStyle = "rgba(90,133,170,0.35)"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    ctx.fillText("Click  ▶ B-mode Scan  to build image", W/2, H/2); ctx.textAlign = "left"; return;
  }
  const { lines, x_range } = data;
  const numLines = lines.length;
  const lineW = W / numLines;
  const maxDepth = lines[0]?.depth_cm?.[lines[0].depth_cm.length - 1] || 20;
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;

  lines.forEach((line, li) => {
    const px = Math.round(li * lineW);
    const maxE = Math.max(...line.echo.map(Math.abs), 1e-6);
    line.echo.forEach((v, si) => {
      const py = Math.round(si / line.echo.length * H);
      const brightness = Math.round(Math.min(255, Math.abs(v) / maxE * 255 * 3));
      const lineWi = Math.ceil(lineW);
      for (let dx = 0; dx < lineWi; dx++) {
        const idx = (py * W + Math.min(px + dx, W - 1)) * 4;
        if (idx + 3 < d.length) { d[idx]=brightness; d[idx+1]=brightness; d[idx+2]=brightness; d[idx+3]=220; }
      }
    });
  });
  ctx.putImageData(imgData, 0, 0);
  ctx.fillStyle = "rgba(90,133,170,0.5)"; ctx.font = "9px monospace"; ctx.textAlign = "left";
  ctx.fillText("B-MODE  lateral scan image", 8, 14);
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
    ctx.fillText("Click  ▶ Doppler Scan  to generate", W/2, H/2); ctx.textAlign = "left"; return;
  }
  const { frequencies, spectrum, velocity_scale, vessel_velocity, wall_freq } = data;
  if (!frequencies) { ctx.textAlign="left"; return; }
  const pL=30,pB=16,pT=14,pw=W-pL-8,ph=H-pB-pT;

  // Axes
  ctx.fillStyle="rgba(90,133,170,0.5)";ctx.font="7px monospace";ctx.textAlign="right";
  [0,0.25,0.5,0.75,1].forEach(f=>{
    const y=pT+ph*(1-f);
    ctx.beginPath();ctx.moveTo(pL,y);ctx.lineTo(pL+pw,y);
    ctx.strokeStyle="rgba(26,50,90,0.4)";ctx.lineWidth=0.5;ctx.stroke();
    ctx.fillText((f*100).toFixed(0)+"%",pL-2,y+3);
  });
  const maxF=frequencies[frequencies.length-1];
  [-4000,-2000,0,2000,4000].forEach(f=>{
    if(Math.abs(f)>maxF) return;
    const x=pL+(f+maxF)/(2*maxF)*pw;
    ctx.textAlign="center";ctx.fillText(f+" Hz",x,H-3);
  });

  // Spectrum
  const maxS=Math.max(...spectrum,1e-9);
  ctx.beginPath();
  frequencies.forEach((f,i)=>{
    const x=pL+i/frequencies.length*pw;
    const y=pT+ph*(1-spectrum[i]/maxS);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.strokeStyle="#a855f7";ctx.lineWidth=1.5;ctx.shadowColor="#a855f7";ctx.shadowBlur=5;
  ctx.stroke();ctx.shadowBlur=0;
  ctx.fillStyle="rgba(168,85,247,0.06)";ctx.fill();

  // Wall filter line
  if(wall_freq) {
    const wx=pL+(wall_freq+maxF)/(2*maxF)*pw;
    ctx.strokeStyle="rgba(255,107,53,0.5)";ctx.lineWidth=0.8;ctx.setLineDash([3,3]);
    ctx.beginPath();ctx.moveTo(wx,pT);ctx.lineTo(wx,pT+ph);ctx.stroke();ctx.setLineDash([]);
  }

  ctx.textAlign="left";ctx.fillStyle="rgba(90,133,170,0.5)";ctx.font="9px monospace";
  ctx.fillText(`DOPPLER  v=${vessel_velocity?.toFixed(0)} cm/s`,pL+4,pT+10);
}

// ─── Doppler simulation (client-side) ────────────────────────────────────────
function simulateDoppler(probeAngle, vesselAngle, vesselVelocity, freqMhz, snrDb) {
  const c=1540, fc=freqMhz*1e6;
  // Doppler shift: fd = 2*v*cos(theta)/lambda
  const theta = Math.abs(probeAngle - vesselAngle) * Math.PI / 180;
  const fd = 2 * (vesselVelocity/100) * Math.cos(theta) * fc / c;
  const N=256, maxF=5000;
  const freqs=Array.from({length:N},(_, i)=>-maxF+2*maxF*i/(N-1));
  const snrLin=Math.pow(10,snrDb/10);
  const spectrum=freqs.map(f=>{
    const sig=Math.exp(-0.5*((f-fd)/300)**2);
    const noise=(1/snrLin)*Math.random()*0.5;
    return Math.max(0,sig+noise);
  });
  return { frequencies:freqs, spectrum, vessel_velocity:vesselVelocity,
    velocity_scale:maxF, wall_freq:200 };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function UltrasoundPage() {
  const [structures,  setStructures]  = useState([]);
  const [probeX,      setProbeX]      = useState(0);
  const [probeAngle,  setProbeAngle]  = useState(0);
  const [freqMhz,     setFreqMhz]     = useState(5);
  const [snrDb,       setSnrDb]       = useState(300);
  const [mode,        setMode]        = useState("amode");
  const [amodeData,   setAmodeData]   = useState(null);
  const [bmodeData,   setBmodeData]   = useState(null);
  const [dopplerData, setDopplerData] = useState(null);
  const [hoveredId,   setHoveredId]   = useState(null);
  const [selectedId,  setSelectedId]  = useState(null);
  const [selectedS,   setSelectedS]   = useState(null);
  const [editForm,    setEditForm]     = useState({});
  const [vesselAngle, setVesselAngle] = useState(30);
  const [vesselV,     setVesselV]     = useState(60);
  const [scanning,    setScanning]    = useState(false);

  const phantomRef = useRef(null);
  const amodeRef   = useRef(null);
  const bmodeRef   = useRef(null);
  const dopplerRef = useRef(null);

  const fetchPhantom = useCallback(async()=>{
    const data = await api.phantomStructures();
    setStructures(data.structures);
  },[]);

  useEffect(()=>{ fetchPhantom(); },[fetchPhantom]);

  // A-mode auto-update
  const fetchAmode = useCallback(async()=>{
    const data = await api.amodeScam({probe_x:probeX,probe_y:0,angle:probeAngle,frequency_mhz:freqMhz});
    setAmodeData(data);
  },[probeX,probeAngle,freqMhz]);

  useEffect(()=>{ const t=setTimeout(fetchAmode,150); return()=>clearTimeout(t); },[fetchAmode]);

  // Doppler auto-update
  useEffect(()=>{
    setDopplerData(simulateDoppler(probeAngle,vesselAngle,vesselV,freqMhz,snrDb));
  },[probeAngle,vesselAngle,vesselV,freqMhz,snrDb]);

  // Resize canvases
  const resizeCanvas=(ref)=>{
    if(!ref.current) return;
    const par=ref.current.parentElement; if(!par) return;
    ref.current.width=par.clientWidth; ref.current.height=par.clientHeight;
  };

  useEffect(()=>{
    [phantomRef,amodeRef,bmodeRef,dopplerRef].forEach(resizeCanvas);
    window.addEventListener("resize",()=>[phantomRef,amodeRef,bmodeRef,dopplerRef].forEach(resizeCanvas));
  },[]);

  // Redraw on data changes
  useEffect(()=>{
    resizeCanvas(phantomRef);
    drawPhantom(phantomRef.current,structures,probeX,probeAngle,hoveredId,selectedId);
  },[structures,probeX,probeAngle,hoveredId,selectedId]);

  useEffect(()=>{
    resizeCanvas(amodeRef);
    drawAmode(amodeRef.current,amodeData);
  },[amodeData]);

  useEffect(()=>{
    resizeCanvas(bmodeRef);
    drawBmode(bmodeRef.current,bmodeData);
  },[bmodeData]);

  useEffect(()=>{
    resizeCanvas(dopplerRef);
    drawDoppler(dopplerRef.current,dopplerData);
  },[dopplerData]);

  // Phantom mouse events
  const phantomCoords=(e)=>{
    const c=phantomRef.current; if(!c) return null;
    const rect=c.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const scaleX=c.width/20, scaleY=c.height/22;
    return { nx:(mx-c.width/2)/scaleX, ny:(my-c.height/2)/scaleY };
  };

  const hitTest=(mx,my)=>{
    for (const s of [...structures].reverse()) {
      const cos=Math.cos(s.rotation*Math.PI/180), sin=Math.sin(s.rotation*Math.PI/180);
      const dx=(mx-s.cx)*cos+(my-s.cy)*sin;
      const dy=-(mx-s.cx)*sin+(my-s.cy)*cos;
      if((dx/s.rx)**2+(dy/s.ry)**2<=1) return s;
    }
    return null;
  };

  const onPhantomHover=e=>{
    const c=phantomCoords(e); if(!c) return;
    const hit=hitTest(c.nx,c.ny);
    setHoveredId(hit?.id||null);
  };

  const onPhantomClick=e=>{
    const c=phantomCoords(e); if(!c) return;
    const hit=hitTest(c.nx,c.ny);
    if(hit){
      setSelectedId(hit.id); setSelectedS(hit);
      setEditForm({acoustic_impedance:hit.acoustic_impedance,attenuation_db_cm:hit.attenuation_db_cm,speed_of_sound:hit.speed_of_sound});
    } else {
      setSelectedId(null); setSelectedS(null);
    }
  };

  const saveEdit=async()=>{
    if(!selectedId) return;
    await api.updateStructure(selectedId,editForm);
    await fetchPhantom(); await fetchAmode();
  };

  const bmodeScan=async()=>{
    setScanning(true);
    const data=await api.bmodeScam({probe_y:0,angle:probeAngle,frequency_mhz:freqMhz,num_lines:80});
    setBmodeData(data); setScanning(false);
  };

  const MODES=["amode","bmode","doppler"];

  return (
    <div className="page" style={{flexDirection:"column"}}>

      {/* Toolbar */}
      <div style={{padding:"6px 14px",borderBottom:"1px solid var(--border)",display:"flex",
        gap:10,alignItems:"center",flexShrink:0,background:"var(--panel)"}}>
        <span style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--accent)",letterSpacing:2}}>ULTRASOUND SIMULATOR</span>
        <div style={{width:1,height:16,background:"var(--border2)"}}/>
        <div className="toggle-group">
          {MODES.map(m=>(
            <button key={m} className={`toggle-btn ${mode===m?"active":""}`} onClick={()=>setMode(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        {mode==="bmode"&&(
          <button className="btn primary" onClick={bmodeScan} disabled={scanning}>
            {scanning?"⏳ Scanning…":"▶ B-mode Scan"}
          </button>
        )}
        <span style={{fontSize:9,color:"var(--text3)",fontFamily:"var(--font-mono)",marginLeft:"auto"}}>
          hover phantom=inspect · click=edit tissue properties
        </span>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        {/* Left sidebar */}
        <div className="sidebar" style={{width:240}}>
          <div className="panel-section">
            <div className="panel-title">Probe Settings</div>
            <div className="control-row">
              <div className="control-label"><span>Position X</span><span className="control-value">{probeX.toFixed(1)} cm</span></div>
              <input type="range" className="slider" min={-8} max={8} step={0.2} value={probeX} onChange={e=>setProbeX(Number(e.target.value))}/>
            </div>
            <div className="control-row">
              <div className="control-label"><span>Beam Angle</span><span className="control-value">{probeAngle}°</span></div>
              <input type="range" className="slider" min={-45} max={45} step={1} value={probeAngle} onChange={e=>setProbeAngle(Number(e.target.value))}/>
            </div>
            <div className="control-row">
              <div className="control-label"><span>Frequency</span><span className="control-value">{freqMhz} MHz</span></div>
              <input type="range" className="slider" min={1} max={20} step={0.5} value={freqMhz} onChange={e=>setFreqMhz(Number(e.target.value))}/>
            </div>
            <div className="control-row">
              <div className="control-label"><span>SNR</span><span className="control-value">{snrDb>=1000?"∞ dB":snrDb+" dB"}</span></div>
              <input type="range" className="slider" min={0} max={1000} step={5} value={snrDb} onChange={e=>setSnrDb(Number(e.target.value))}/>
            </div>
          </div>

          {/* Doppler vessel controls */}
          {mode==="doppler"&&(
            <div className="panel-section" style={{border:"1px solid var(--accent5)55"}}>
              <div className="panel-title" style={{color:"var(--accent5)"}}>Vessel / Doppler</div>
              <div className="control-row">
                <div className="control-label"><span>Vessel Angle</span><span className="control-value">{vesselAngle}°</span></div>
                <input type="range" className="slider" min={0} max={89} step={1} value={vesselAngle} onChange={e=>setVesselAngle(Number(e.target.value))}/>
              </div>
              <div className="control-row">
                <div className="control-label"><span>Blood Velocity</span><span className="control-value">{vesselV} cm/s</span></div>
                <input type="range" className="slider" min={5} max={200} step={5} value={vesselV} onChange={e=>setVesselV(Number(e.target.value))}/>
              </div>
              <div className="info-card" style={{fontSize:9}}>
                <div style={{color:"var(--text2)",lineHeight:1.6}}>
                  Doppler shift = 2·v·cos(θ)·f/c<br/>
                  θ = |probe − vessel angle|<br/>
                  fd ≈ {(2*(vesselV/100)*Math.cos(Math.abs(probeAngle-vesselAngle)*Math.PI/180)*freqMhz*1e6/1540).toFixed(0)} Hz
                </div>
              </div>
            </div>
          )}

          {/* Hover info */}
          {hoveredId&&!selectedS&&(()=>{
            const s=structures.find(x=>x.id===hoveredId); if(!s) return null;
            return (
              <div className="panel-section">
                <div className="panel-title">Structure Info</div>
                <div className="info-card">
                  <div className="info-row"><span>Label</span><strong>{s.label}</strong></div>
                  <div className="info-row"><span>Z (MRayl)</span><strong>{(s.acoustic_impedance/1e6).toFixed(3)}</strong></div>
                  <div className="info-row"><span>α (dB/cm/MHz)</span><strong>{s.attenuation_db_cm}</strong></div>
                  <div className="info-row"><span>c (m/s)</span><strong>{s.speed_of_sound}</strong></div>
                </div>
              </div>
            );
          })()}

          {/* Edit selected structure */}
          {selectedS&&(
            <div className="panel-section" style={{border:"1px solid var(--warn)44"}}>
              <div className="panel-title" style={{color:"var(--warn)"}}>✎ EDIT: {selectedS.label}</div>
              <div className="control-row">
                <div className="control-label"><span>Impedance Z (MRayl)</span></div>
                <input type="number" className="select" step={0.01}
                  value={(editForm.acoustic_impedance/1e6).toFixed(3)}
                  onChange={e=>setEditForm(f=>({...f,acoustic_impedance:parseFloat(e.target.value)*1e6}))}/>
              </div>
              <div className="control-row">
                <div className="control-label"><span>Attenuation α (dB/cm/MHz)</span></div>
                <input type="number" className="select" step={0.05}
                  value={editForm.attenuation_db_cm}
                  onChange={e=>setEditForm(f=>({...f,attenuation_db_cm:parseFloat(e.target.value)}))}/>
              </div>
              <div className="control-row">
                <div className="control-label"><span>Sound Speed (m/s)</span></div>
                <input type="number" className="select" step={10}
                  value={editForm.speed_of_sound}
                  onChange={e=>setEditForm(f=>({...f,speed_of_sound:parseFloat(e.target.value)}))}/>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button className="btn primary" style={{flex:1}} onClick={saveEdit}>Apply</button>
                <button className="btn" onClick={()=>{setSelectedId(null);setSelectedS(null);}}>✕</button>
              </div>
            </div>
          )}
        </div>

        {/* 4-panel grid */}
        <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gridTemplateRows:"1fr 1fr",
          gap:4,padding:4,overflow:"hidden"}}>

          {/* P1 – Phantom */}
          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">⬟ SHEPP-LOGAN PHANTOM</span>
              <span style={{fontSize:9,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>hover·click to edit</span>
            </div>
            <div className="viz-body" style={{position:"relative",overflow:"hidden",cursor:hoveredId?"pointer":"default"}}
              onMouseMove={onPhantomHover} onMouseLeave={()=>setHoveredId(null)} onClick={onPhantomClick}>
              <canvas ref={phantomRef} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
            </div>
          </div>

          {/* P2 – A-mode */}
          <div className="viz-panel" style={{display:mode==="amode"||mode==="bmode"?"flex":"flex",flexDirection:"column"}}>
            <div className="viz-header">
              <span className="viz-title">◈ A-MODE</span>
              <span style={{fontSize:9,color:"var(--accent3)",fontFamily:"var(--font-mono)"}}>live · {freqMhz} MHz</span>
            </div>
            <div className="viz-body" style={{position:"relative",overflow:"hidden"}}>
              <canvas ref={amodeRef} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
            </div>
          </div>

          {/* P3 – B-mode */}
          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">▦ B-MODE</span>
              <span style={{fontSize:9,fontFamily:"var(--font-mono)",color:scanning?"var(--accent)":bmodeData?"var(--accent4)":"var(--text3)"}}>
                {scanning?"scanning…":bmodeData?"scan image":"click ▶ B-mode Scan"}
              </span>
            </div>
            <div className="viz-body" style={{position:"relative",overflow:"hidden"}}>
              <canvas ref={bmodeRef} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
            </div>
          </div>

          {/* P4 – Doppler */}
          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">◌ DOPPLER</span>
              <span style={{fontSize:9,color:"var(--accent5)",fontFamily:"var(--font-mono)"}}>
                v={vesselV} cm/s · θ={vesselAngle}°
              </span>
            </div>
            <div className="viz-body" style={{position:"relative",overflow:"hidden"}}>
              <canvas ref={dopplerRef} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
            </div>
          </div>

        </div>
      </div>

      <div className="status-bar">
        <div className="status-item">mode <span>{mode}</span></div>
        <div className="status-item">probe_x <span>{probeX.toFixed(1)} cm</span></div>
        <div className="status-item">angle <span>{probeAngle}°</span></div>
        <div className="status-item">freq <span>{freqMhz} MHz</span></div>
        <div className="status-item">SNR <span>{snrDb>=1000?"∞":snrDb} dB</span></div>
        <div className="status-item">λ <span>{(1540/(freqMhz*1e6)*1000).toFixed(3)} mm</span></div>
        {mode==="doppler"&&<div className="status-item">fd <span>{(2*(vesselV/100)*Math.cos(Math.abs(probeAngle-vesselAngle)*Math.PI/180)*freqMhz*1e6/1540).toFixed(0)} Hz</span></div>}
      </div>
    </div>
  );
}