import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../utils/api";

// ─── Pure math (client-side, runs in RAF) ────────────────────────────────────
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function gaussRand() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function getWeights(N, type) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const n = i / Math.max(N - 1, 1);
    switch (type) {
      case "hanning":  w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * n)); break;
      case "hamming":  w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * n); break;
      case "blackman": w[i] = 0.42 - 0.5 * Math.cos(2*Math.PI*n) + 0.08*Math.cos(4*Math.PI*n); break;
      case "kaiser":   { const b=6, x=2*n-1; w[i]=Math.exp(-0.5*b*b*(1-x*x)); break; }
      case "gaussian": { const s=0.35; w[i]=Math.exp(-0.5*((n-0.5)/s)**2); break; }
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
    for (let n=0; n<N; n++) pos.push({ x:(n-(N-1)/2)*d, y:0 });
  } else if (layout === "curved") {
    const arc = clamp(curvature,5,180)*DEG;
    const R = N>1 ? d*(N-1)/arc : d;
    for (let n=0; n<N; n++) {
      const a = -arc/2 + n*arc/Math.max(N-1,1);
      pos.push({ x:R*Math.sin(a), y:R*(1-Math.cos(a)) });
    }
  } else {
    const R = d*N/(2*Math.PI);
    for (let n=0; n<N; n++) {
      const a = 2*Math.PI*n/N;
      pos.push({ x:R*Math.cos(a), y:R*Math.sin(a) });
    }
  }
  return pos;
}

function computeAF(thetaDeg, p, noisy=false) {
  const lambda = p.speed/p.frequency, d = p.spacing_ratio*lambda;
  const k=2*Math.PI/lambda, steer=p.beam_direction*DEG, t=thetaDeg*DEG;
  const weights=getWeights(p.num_elements,p.window);
  const pos=getElemPos(p.num_elements,d,p.layout,p.curvature_radius);
  const snrLin=Math.pow(10,p.snr_db/10);
  const noiseAmp=noisy ? 1/Math.sqrt(snrLin)*0.3 : 0;
  let re=0, im=0;
  for (let n=0; n<p.num_elements; n++) {
    const px=pos[n].x, py=pos[n].y||0;
    const beta = k*((px*Math.sin(t)+py*Math.cos(t))-(px*Math.sin(steer)+py*Math.cos(steer)));
    const wn = weights[n] + (noiseAmp ? gaussRand()*noiseAmp : 0);
    re += wn*Math.cos(beta); im += wn*Math.sin(beta);
  }
  return Math.sqrt(re*re+im*im);
}

function getPeakAF(p) {
  return getWeights(p.num_elements, p.window).reduce((a,b)=>a+b, 0);
}

function computeAFdB(thetaDeg, p, noisy=false) {
  const af=computeAF(thetaDeg,p,noisy), pk=getPeakAF(p);
  return af/pk<=0 ? -80 : 20*Math.log10(af/pk);
}

function computeMetrics(p) {
  const step=0.25; let vals=[], peakDb=-Infinity;
  for (let a=-180; a<=180; a+=step) {
    const db=computeAFdB(a,p); vals.push({a,db});
    if (db>peakDb) peakDb=db;
  }
  const bd=p.beam_direction, thresh=peakDb-3;
  let lo=bd, hi=bd;
  for (const v of vals) {
    if (v.a<bd && Math.abs(v.a-bd)<90 && v.db>=thresh) lo=v.a;
    if (v.a>bd && Math.abs(v.a-bd)<90 && v.db>=thresh) hi=v.a;
  }
  const hpbw=Math.max(0.1,hi-lo);
  let sll=-80;
  for (let i=1;i<vals.length-1;i++)
    if (vals[i].db>vals[i-1].db&&vals[i].db>vals[i+1].db&&Math.abs(vals[i].a-bd)>hpbw*0.9&&vals[i].db>sll)
      sll=vals[i].db;
  let nulls=0;
  for (let i=1;i<vals.length-1;i++)
    if (vals[i].db<vals[i-1].db-1&&vals[i].db<vals[i+1].db-1) nulls++;
  const sumW=getWeights(p.num_elements,p.window).reduce((a,b)=>a+b,0);
  const gain=10*Math.log10(sumW);
  return { sll:sll.toFixed(1), hpbw:hpbw.toFixed(1), gain:gain.toFixed(1), nulls, peak:peakDb.toFixed(1) };
}

// ─── Canvas renderers ────────────────────────────────────────────────────────

function drawLiveField(canvas, p, waveT) {
  if (!canvas||!canvas.width||!canvas.height) return;
  const ctx=canvas.getContext("2d");
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#030810"; ctx.fillRect(0,0,W,H);

  const lambda=p.speed/p.frequency, d=p.spacing_ratio*lambda;
  const cx=W/2, cy=H*0.80;
  const pos=getElemPos(p.num_elements,d,p.layout,p.curvature_radius);
  const weights=getWeights(p.num_elements,p.window);
  const steer=p.beam_direction*DEG;
  const k=2*Math.PI/lambda;
  const peak=getPeakAF(p);

  // Scale: fit array across 60% of canvas width
  const arraySpan = Math.max(
    ...pos.map(ep=>Math.abs(ep.x)), lambda*0.5
  ) * 2 || lambda;
  const pxPerM = (W*0.55) / arraySpan;

  // Beam lobe overlay
  const R=Math.min(W,H)*0.43;
  ctx.beginPath();
  for (let ti=-90; ti<=90; ti+=0.6) {
    const af=clamp(computeAF(ti,p)/peak,0,1);
    const r=R*af;
    const x=cx+r*Math.sin(ti*DEG), y=cy-r*Math.cos(ti*DEG);
    ti===-90 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.strokeStyle="rgba(0,212,255,0.6)"; ctx.lineWidth=1.5; ctx.stroke();
  ctx.fillStyle="rgba(0,212,255,0.04)"; ctx.fill();

  // Propagating wave rings per element
  pos.forEach((ep, n) => {
    const ex=cx+ep.x*pxPerM, ey=cy-(ep.y||0)*pxPerM;
    const steerDelay=(ep.x*Math.sin(steer)+(ep.y||0)*Math.cos(steer))/lambda;
    const w=weights[n];

    for (let ring=0; ring<6; ring++) {
      const phase=((waveT - steerDelay*0.35 + ring/6) % 1 + 1) % 1;
      const ringR=phase*Math.min(W,H)*0.76;
      if (ringR<2) continue;
      const alpha=w*(1-phase)*0.58;
      ctx.beginPath();
      p.layout==="circular"
        ? ctx.arc(ex,ey,ringR,0,2*Math.PI)
        : ctx.arc(ex,ey,ringR,Math.PI,2*Math.PI);
      ctx.strokeStyle=`rgba(0,212,255,${alpha.toFixed(3)})`;
      ctx.lineWidth=1.1; ctx.stroke();
    }

    // Element dot
    const br=0.3+0.7*w;
    ctx.beginPath(); ctx.arc(ex,ey,4,0,2*Math.PI);
    ctx.fillStyle=`rgba(0,212,255,${br.toFixed(2)})`;
    ctx.shadowColor="#00d4ff"; ctx.shadowBlur=6*w;
    ctx.fill(); ctx.shadowBlur=0;

    ctx.fillStyle="rgba(90,133,170,0.7)"; ctx.font="7px monospace";
    ctx.textAlign="center"; ctx.fillText(n+1,ex,ey+14);
  });

  // Beam direction arrow
  const arrowLen=Math.min(W,H)*0.38;
  const ax=cx+Math.sin(steer)*arrowLen, ay=cy-Math.cos(steer)*arrowLen;
  ctx.strokeStyle="rgba(255,107,53,0.85)"; ctx.lineWidth=2;
  ctx.setLineDash([6,3]);
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(ax,ay); ctx.stroke();
  ctx.setLineDash([]);
  // arrowhead
  const ah=10, aw=5, px2=Math.cos(steer), py2=Math.sin(steer);
  ctx.beginPath();
  ctx.moveTo(ax,ay);
  ctx.lineTo(ax-Math.sin(steer)*ah-px2*aw, ay+Math.cos(steer)*ah-py2*aw);
  ctx.lineTo(ax-Math.sin(steer)*ah+px2*aw, ay+Math.cos(steer)*ah+py2*aw);
  ctx.closePath(); ctx.fillStyle="rgba(255,107,53,0.85)"; ctx.fill();

  ctx.textAlign="left"; ctx.fillStyle="rgba(90,133,170,0.5)";
  ctx.font="9px monospace"; ctx.fillText("LIVE WAVE FIELD",8,14);
}

function drawPolar(canvas, p) {
  if (!canvas||!canvas.width||!canvas.height) return;
  const ctx=canvas.getContext("2d");
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#030810"; ctx.fillRect(0,0,W,H);
  const cx=W/2, cy=H/2, R=Math.min(W,H)*0.40;

  [0,-10,-20,-40].forEach(db=>{
    const r=R*Math.pow(10,db/20);
    ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI);
    ctx.strokeStyle=db===0?"rgba(30,60,100,0.7)":"rgba(26,50,90,0.4)";
    ctx.lineWidth=0.6; ctx.stroke();
    ctx.fillStyle="rgba(90,133,170,0.4)"; ctx.font="7px monospace"; ctx.textAlign="left";
    ctx.fillText(db+"dB", cx+r*0.71+2, cy-r*0.71);
  });
  for (let a=0;a<360;a+=30) {
    const rad=(a-90)*DEG;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+R*Math.cos(rad),cy+R*Math.sin(rad));
    ctx.strokeStyle="rgba(26,50,90,0.4)"; ctx.lineWidth=0.5; ctx.stroke();
    ctx.fillStyle="rgba(90,133,170,0.55)"; ctx.font="7px monospace"; ctx.textAlign="center";
    ctx.fillText(a+"°", cx+(R+10)*Math.cos(rad), cy+(R+10)*Math.sin(rad)+3);
  }
  const peak=getPeakAF(p);
  ctx.beginPath();
  for (let ti=-180;ti<=180;ti+=0.5) {
    const af=clamp(computeAF(ti,p)/peak,0,1.05);
    const r=R*af, rad=(ti-90)*DEG;
    ti===-180 ? ctx.moveTo(cx+r*Math.cos(rad),cy+r*Math.sin(rad))
              : ctx.lineTo(cx+r*Math.cos(rad),cy+r*Math.sin(rad));
  }
  ctx.strokeStyle="#00d4ff"; ctx.lineWidth=1.6;
  ctx.shadowColor="#00d4ff"; ctx.shadowBlur=4; ctx.stroke(); ctx.shadowBlur=0;
  ctx.fillStyle="rgba(0,212,255,0.04)"; ctx.fill();
  ctx.textAlign="left"; ctx.fillStyle="rgba(90,133,170,0.5)";
  ctx.font="9px monospace"; ctx.fillText("POLAR PATTERN (360°)",6,13);
}

function drawAFPlot(canvas, p) {
  if (!canvas||!canvas.width||!canvas.height) return;
  const ctx=canvas.getContext("2d");
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#030810"; ctx.fillRect(0,0,W,H);
  const pL=30,pB=18,pT=14,pR=6, pw=W-pL-pR, ph=H-pB-pT;

  [0,-10,-20,-30,-40,-60,-80].forEach(db=>{
    const y=pT+ph*(1-(db+80)/80);
    ctx.beginPath(); ctx.moveTo(pL,y); ctx.lineTo(pL+pw,y);
    ctx.strokeStyle=db===0?"rgba(30,60,100,0.7)":"rgba(26,50,90,0.4)";
    ctx.lineWidth=0.5; ctx.stroke();
    ctx.fillStyle="rgba(90,133,170,0.5)"; ctx.font="7px monospace"; ctx.textAlign="right";
    ctx.fillText(db,pL-2,y+3);
  });
  [-90,-60,-30,0,30,60,90].forEach(a=>{
    const x=pL+(a+90)/180*pw;
    ctx.fillStyle="rgba(90,133,170,0.4)"; ctx.font="7px monospace"; ctx.textAlign="center";
    ctx.fillText(a+"°",x,H-4);
  });

  const sx=pL+(p.beam_direction+90)/180*pw;
  ctx.strokeStyle="rgba(255,107,53,0.4)"; ctx.lineWidth=0.8; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(sx,pT); ctx.lineTo(sx,pT+ph); ctx.stroke(); ctx.setLineDash([]);

  ctx.beginPath();
  for (let i=0;i<=pw;i++) {
    const ti=-90+180*i/pw;
    const y=pT+ph*(1-(clamp(computeAFdB(ti,p),-80,0)+80)/80);
    i===0 ? ctx.moveTo(pL+i,y) : ctx.lineTo(pL+i,y);
  }
  ctx.strokeStyle="#00ff9d"; ctx.lineWidth=1.5; ctx.stroke();

  if (p.snr_db<1000) {
    ctx.beginPath();
    for (let i=0;i<=pw;i++) {
      const ti=-90+180*i/pw;
      const y=pT+ph*(1-(clamp(computeAFdB(ti,p,true),-80,0)+80)/80);
      i===0 ? ctx.moveTo(pL+i,y) : ctx.lineTo(pL+i,y);
    }
    ctx.strokeStyle="rgba(255,107,53,0.4)"; ctx.lineWidth=0.8; ctx.stroke();
  }

  ctx.textAlign="left"; ctx.fillStyle="rgba(90,133,170,0.5)";
  ctx.font="9px monospace"; ctx.fillText("ARRAY FACTOR (dB)",pL+4,pT+10);
}

function drawInterference(canvas, ifData, positions) {
  if (!canvas||!canvas.width||!canvas.height) return;
  const ctx=canvas.getContext("2d");
  const W=canvas.width, H=canvas.height;
  ctx.fillStyle="#030810"; ctx.fillRect(0,0,W,H);

  if (!ifData||!ifData.intensity) {
    ctx.fillStyle="rgba(90,133,170,0.35)"; ctx.font="11px monospace"; ctx.textAlign="center";
    ctx.fillText("Click  ▶ Compute Interference Map  to generate",W/2,H/2-8);
    ctx.fillText("(runs on backend — click after changing params)",W/2,H/2+12);
    ctx.textAlign="left"; return;
  }
  const {intensity,x_range,y_range}=ifData;
  const rows=intensity.length, cols=intensity[0].length;
  const cw=W/cols, ch=H/rows;
  for (let row=0;row<rows;row++) {
    for (let col=0;col<cols;col++) {
      const v=intensity[row][col];
      let r,g,b;
      if (v<0){const t=-v;r=Math.round(t*30);g=Math.round(t*50);b=Math.round(30+t*200);}
      else    {const t= v;r=Math.round(t*220);g=Math.round(t*50);b=Math.round(t*30);}
      ctx.fillStyle=`rgb(${r},${g},${b})`;
      ctx.fillRect(Math.round(col*cw),Math.round((rows-1-row)*ch),Math.ceil(cw),Math.ceil(ch));
    }
  }
  if (positions&&x_range&&y_range) {
    const xS=W/(x_range[1]-x_range[0]), yS=H/(y_range[1]-y_range[0]);
    positions.forEach(([px2,py2])=>{
      const ccx=(px2-x_range[0])*xS, ccy=H-(py2-y_range[0])*yS;
      ctx.beginPath(); ctx.arc(ccx,ccy,4,0,2*Math.PI);
      ctx.fillStyle="#00ff88"; ctx.shadowColor="#00ff88"; ctx.shadowBlur=8;
      ctx.fill(); ctx.shadowBlur=0;
    });
  }
  ctx.fillStyle="rgba(136,153,187,0.6)"; ctx.font="9px monospace"; ctx.textAlign="left";
  ctx.fillText("INTERFERENCE MAP",8,14);
  const lgW=80, lgX=W-lgW-8, lgY=H-16;
  const gr=ctx.createLinearGradient(lgX,0,lgX+lgW,0);
  gr.addColorStop(0,"rgb(30,50,230)"); gr.addColorStop(0.5,"rgb(5,5,5)"); gr.addColorStop(1,"rgb(220,50,30)");
  ctx.fillStyle=gr; ctx.fillRect(lgX,lgY,lgW,8);
  ctx.fillStyle="rgba(136,153,187,0.6)"; ctx.font="8px monospace";
  ctx.fillText("−",lgX-8,lgY+7); ctx.fillText("+",lgX+lgW+2,lgY+7);
}

function drawWeightBar(canvas, p) {
  if (!canvas||!canvas.width) return;
  const ctx=canvas.getContext("2d");
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#030810"; ctx.fillRect(0,0,W,H);
  const weights=getWeights(p.num_elements,p.window);
  const bw=Math.max(1,Math.floor((W-4)/p.num_elements)-1);
  const lambda=p.speed/p.frequency, d=p.spacing_ratio*lambda;
  const k=2*Math.PI/lambda, steer=p.beam_direction*DEG;
  weights.forEach((w,n)=>{
    const x=2+n*(bw+1), bh=Math.round((H-2)*w);
    const ph=((n*k*d*Math.sin(steer))%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
    ctx.fillStyle=`hsl(${Math.round(ph/(2*Math.PI)*360)},75%,${40+30*w}%)`;
    ctx.fillRect(x,H-1-bh,bw,bh);
  });
}

// ─── Constants & presets ─────────────────────────────────────────────────────
const WINDOWS=["rectangular","hanning","hamming","blackman","kaiser","gaussian"];
const LAYOUTS=["linear","curved","circular"];
const DEFAULT_P={ num_elements:8, frequency:10e9, beam_direction:0,
  spacing_ratio:0.5, layout:"linear", curvature_radius:60,
  window:"rectangular", snr_db:1000, speed:3e8 };
const PRESETS={
  "5G (28 GHz)":   {num_elements:16,frequency:28e9, beam_direction:20,spacing_ratio:0.5,layout:"linear",  window:"hanning", snr_db:300,speed:3e8},
  "Medical US":    {num_elements:32,frequency:5e6,  beam_direction:5, spacing_ratio:0.5,layout:"curved",  window:"hamming", snr_db:200,speed:1540},
  "Radar X-band":  {num_elements:24,frequency:10e9, beam_direction:0, spacing_ratio:0.5,layout:"circular",window:"blackman",snr_db:150,speed:3e8},
};

function Slider({label,value,min,max,step=1,fmt,onChange}){
  return(
    <div className="control-row">
      <div className="control-label"><span>{label}</span>
        <span className="control-value">{fmt?fmt(value):value}</span></div>
      <input type="range" className="slider" min={min} max={max} step={step}
        value={value} onChange={e=>onChange(Number(e.target.value))}/>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BeamformingLab({ params: externalParams, onParamsChange }) {
  // If App passes saved params, seed state with them; else use DEFAULT_P
  const [params,  setParamsLocal] = useState(externalParams || DEFAULT_P);
  const [ifData,  setIfData]  = useState(null);
  const [ifPos,   setIfPos]   = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ifDirty, setIfDirty] = useState(false);

  // Wrap setter so App always knows the current params
  const setParams = useCallback((updater) => {
    setParamsLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onParamsChange?.(next);
      return next;
    });
  }, [onParamsChange]);

  const c1=useRef(null), c2=useRef(null), c3=useRef(null), c4=useRef(null), wg=useRef(null);
  const pRef=useRef(params), ifRef=useRef({data:null,pos:null});
  const waveT=useRef(0), rafId=useRef(null), lastMet=useRef(0);

  useEffect(()=>{ pRef.current=params; setIfDirty(true); },[params]);
  useEffect(()=>{ ifRef.current={data:ifData,pos:ifPos}; },[ifData,ifPos]);

  const resizeAll=useCallback(()=>{
    [c1,c2,c3,c4].forEach(ref=>{
      if(!ref.current) return;
      const par=ref.current.parentElement; if(!par) return;
      const {width,height}=par.getBoundingClientRect();
      if(ref.current.width!==Math.floor(width))  ref.current.width=Math.floor(width);
      if(ref.current.height!==Math.floor(height)) ref.current.height=Math.floor(height);
    });
    if(wg.current){const par=wg.current.parentElement; if(par){wg.current.width=par.clientWidth; wg.current.height=28;}}
  },[]);

  useEffect(()=>{
    resizeAll();
    const obs=new ResizeObserver(resizeAll);
    const grid=document.getElementById("bf-grid");
    if(grid) obs.observe(grid);
    window.addEventListener("resize",resizeAll);
    return()=>{obs.disconnect(); window.removeEventListener("resize",resizeAll);};
  },[resizeAll]);

  useEffect(()=>{
    function loop(ts){
      waveT.current=(waveT.current+0.055)%1;
      const p=pRef.current;
      drawLiveField(c1.current,p,waveT.current);
      drawPolar(c2.current,p);
      drawAFPlot(c3.current,p);
      drawInterference(c4.current,ifRef.current.data,ifRef.current.pos);
      drawWeightBar(wg.current,p);
      if(ts-lastMet.current>1000){setMetrics(computeMetrics(p)); lastMet.current=ts;}
      rafId.current=requestAnimationFrame(loop);
    }
    rafId.current=requestAnimationFrame(loop);
    return()=>cancelAnimationFrame(rafId.current);
  },[]);

  const computeIF=useCallback(async()=>{
    setLoading(true);
    try {
      const[imap,pos]=await Promise.all([
        api.interferenceMap({...pRef.current,resolution:180}),
        api.antennaPositions(pRef.current),
      ]);
      setIfData(imap); setIfPos(pos.positions); setIfDirty(false);
    } catch(e){console.error(e);}
    setLoading(false);
  },[]);

  const set=key=>val=>setParams(p=>({...p,[key]:val}));
  const freqFmt=v=>v>=1e9?(v/1e9).toFixed(2)+" GHz":v>=1e6?(v/1e6).toFixed(2)+" MHz":v+" Hz";
  const snrFmt=v=>v>=1000?"∞ dB":v+" dB";

  return (
    <div className="page" style={{flexDirection:"column"}}>

      <div style={{padding:"6px 14px",borderBottom:"1px solid var(--border)",display:"flex",
        gap:10,alignItems:"center",flexShrink:0,background:"var(--panel)"}}>
        <span style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--accent)",letterSpacing:2}}>BEAMFORMING LAB</span>
        <div style={{width:1,height:16,background:"var(--border2)"}}/>
        <button className="btn" style={{opacity:0.7}}
          title="Reset to default parameters"
          onClick={()=>{ setParams(DEFAULT_P); setIfData(null); setIfPos(null); }}>
          ↺ Default
        </button>
        <div style={{width:1,height:16,background:"var(--border2)"}}/>
        {Object.keys(PRESETS).map(name=>(
          <button key={name} className="btn" onClick={()=>setParams(p=>({...p,...PRESETS[name]}))}>
            {name}
          </button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {ifDirty&&ifData&&<span style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--warn)"}}>⚠ params changed</span>}
          <button className="btn primary" onClick={computeIF} disabled={loading}>
            {loading?"⏳ Computing…":"▶ Compute Interference Map"}
          </button>
        </div>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        <div className="sidebar" style={{width:240}}>
          <div className="panel-section">
            <div className="panel-title">Array Config</div>
            <Slider label="Elements N" value={params.num_elements} min={2} max={32} onChange={set("num_elements")}/>
            <Slider label="Frequency" value={params.frequency} min={1e6} max={100e9} step={5e7} fmt={freqFmt} onChange={set("frequency")}/>
            <Slider label="Spacing d/λ" value={params.spacing_ratio} min={0.1} max={2} step={0.05} fmt={v=>v.toFixed(2)+"λ"} onChange={set("spacing_ratio")}/>
            <Slider label="Steer θ" value={params.beam_direction} min={-90} max={90} fmt={v=>v+"°"} onChange={set("beam_direction")}/>
            <Slider label="SNR" value={params.snr_db} min={0} max={1000} step={5} fmt={snrFmt} onChange={set("snr_db")}/>
          </div>

          <div className="panel-section">
            <div className="panel-title">Geometry</div>
            <div className="toggle-group">
              {LAYOUTS.map(l=>(
                <button key={l} className={`toggle-btn ${params.layout===l?"active":""}`}
                  onClick={()=>setParams(p=>({...p,layout:l}))}>{l}</button>
              ))}
            </div>
            {params.layout==="curved"&&(
              <Slider label="Curvature°" value={params.curvature_radius} min={10} max={180} fmt={v=>v+"°"} onChange={set("curvature_radius")}/>
            )}
          </div>

          <div className="panel-section">
            <div className="panel-title">Apodization / Window</div>
            <select className="select" value={params.window} onChange={e=>setParams(p=>({...p,window:e.target.value}))}>
              {WINDOWS.map(w=><option key={w} value={w}>{w.charAt(0).toUpperCase()+w.slice(1)}</option>)}
            </select>
            <canvas ref={wg} style={{display:"block",width:"100%",height:28,marginTop:5,borderRadius:3,border:"1px solid var(--border)"}}/>
            <div style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text3)",marginTop:4,lineHeight:1.5}}>
              {params.window==="rectangular"&&"No taper — best resolution, highest sidelobes"}
              {params.window==="hanning"&&"Hanning — −32 dB sidelobes"}
              {params.window==="hamming"&&"Hamming — −43 dB sidelobes"}
              {params.window==="blackman"&&"Blackman — −74 dB sidelobes, wider main lobe"}
              {params.window==="kaiser"&&"Kaiser β=6 — good sidelobe vs. resolution trade-off"}
              {params.window==="gaussian"&&"Gaussian — smooth, no sharp nulls"}
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-title">Wave Medium</div>
            <div className="toggle-group">
              {[["EM",3e8],["Sound (1540m/s)",1540]].map(([lbl,v])=>(
                <button key={lbl} className={`toggle-btn ${params.speed===v?"active":""}`}
                  onClick={()=>setParams(p=>({...p,speed:v}))}>{lbl}</button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-title">Live Metrics</div>
            {metrics?(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                {[["SLL",metrics.sll+" dB"],["HPBW",metrics.hpbw+"°"],["GAIN",metrics.gain+" dB"],["NULLS",metrics.nulls]].map(([lbl,val])=>(
                  <div key={lbl} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:3,padding:"5px 4px",textAlign:"center"}}>
                    <div style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--accent3)"}}>{val}</div>
                    <div style={{fontSize:8,color:"var(--text2)",marginTop:2,letterSpacing:1}}>{lbl}</div>
                  </div>
                ))}
              </div>
            ):<div style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>Computing…</div>}
          </div>
        </div>

        {/* 4-panel grid — all canvases always mounted */}
        <div id="bf-grid" style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",
          gridTemplateRows:"1fr 1fr",gap:4,padding:4,overflow:"hidden"}}>

          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">◎ LIVE WAVE FIELD</span>
              <span style={{fontSize:9,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>animated · real-time</span>
            </div>
            <div className="viz-body" style={{position:"relative",overflow:"hidden"}}>
              <canvas ref={c1} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
            </div>
          </div>

          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">◉ POLAR PATTERN (360°)</span>
              <span style={{fontSize:9,color:"var(--text3)",fontFamily:"var(--font-mono)"}}>live · normalized</span>
            </div>
            <div className="viz-body" style={{position:"relative",overflow:"hidden"}}>
              <canvas ref={c2} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
            </div>
          </div>

          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">▸ ARRAY FACTOR (dB)</span>
              <span style={{fontSize:9,fontFamily:"var(--font-mono)",
                color:params.snr_db<1000?"var(--warn)":"var(--text3)"}}>
                {params.snr_db<1000?`SNR ${snrFmt(params.snr_db)} — noisy overlay active`:"ideal (no noise)"}
              </span>
            </div>
            <div className="viz-body" style={{position:"relative",overflow:"hidden"}}>
              <canvas ref={c3} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
            </div>
          </div>

          <div className="viz-panel">
            <div className="viz-header">
              <span className="viz-title">⊞ INTERFERENCE MAP</span>
              <span style={{fontSize:9,fontFamily:"var(--font-mono)",
                color:loading?"var(--accent)":ifDirty&&ifData?"var(--warn)":ifData?"var(--accent4)":"var(--text3)"}}>
                {loading?"computing…":ifDirty&&ifData?"stale — click ▶ to refresh":ifData?"constructive/destructive":"click ▶ to compute"}
              </span>
            </div>
            <div className="viz-body" style={{position:"relative",overflow:"hidden"}}>
              <canvas ref={c4} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
            </div>
          </div>

        </div>
      </div>

      <div className="status-bar">
        <div className="status-item">N <span>{params.num_elements}</span></div>
        <div className="status-item">freq <span>{freqFmt(params.frequency)}</span></div>
        <div className="status-item">d/λ <span>{params.spacing_ratio.toFixed(2)}</span></div>
        <div className="status-item">θ <span>{params.beam_direction}°</span></div>
        <div className="status-item">window <span>{params.window}</span></div>
        <div className="status-item">SNR <span>{snrFmt(params.snr_db)}</span></div>
        {metrics&&<div className="status-item">HPBW <span>{metrics.hpbw}°</span></div>}
        {metrics&&<div className="status-item">Gain <span>{metrics.gain} dB</span></div>}
        {metrics&&<div className="status-item">SLL <span>{metrics.sll} dB</span></div>}
      </div>
    </div>
  );
}