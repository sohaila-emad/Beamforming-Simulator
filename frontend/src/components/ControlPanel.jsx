import React from "react";

const WINDOWS = ["rectangular", "hanning", "hamming", "blackman", "kaiser", "chebyshev"];
const LAYOUTS = ["linear", "curved"];

function Slider({ label, value, min, max, step = 1, unit = "", onChange, format }) {
  const display = format ? format(value) : `${value}${unit}`;
  return (
    <div className="control-row">
      <div className="control-label">
        <span>{label}</span>
        <span className="control-value">{display}</span>
      </div>
      <input
        type="range" className="slider"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <div className="control-row">
      {label && <div className="control-label"><span>{label}</span></div>}
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}
      </select>
    </div>
  );
}

export default function ControlPanel({ params, onChange, onCompute, loading }) {
  const set = (key) => (val) => onChange({ ...params, [key]: val });

  const freqLabel = (v) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GHz`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MHz`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} kHz`;
    return `${v} Hz`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Array Config */}
      <div className="panel-section">
        <div className="panel-title">Array Config</div>

        <Slider label="Elements" value={params.num_elements} min={2} max={128} step={2}
          onChange={set("num_elements")} />

        <div className="control-row">
          <div className="control-label"><span>Layout</span></div>
          <div className="toggle-group">
            {LAYOUTS.map((l) => (
              <button key={l} className={`toggle-btn ${params.layout === l ? "active" : ""}`}
                onClick={() => onChange({ ...params, layout: l })}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {params.layout === "curved" && (
          <Slider label="Curvature Radius" value={params.curvature_radius}
            min={0.5} max={10} step={0.1} unit=" m" onChange={set("curvature_radius")} />
        )}

        <Slider label="Element Spacing" value={params.spacing_ratio}
          min={0.25} max={2} step={0.05} unit="λ" onChange={set("spacing_ratio")} />
      </div>

      {/* Wave Parameters */}
      <div className="panel-section">
        <div className="panel-title">Wave Parameters</div>

        <div className="control-row">
          <div className="control-label"><span>Frequency</span>
            <span className="control-value">{freqLabel(params.frequency)}</span>
          </div>
          <input type="range" className="slider"
            min={1e6} max={100e9} step={1e6}
            value={params.frequency}
            onChange={(e) => set("frequency")(Number(e.target.value))} />
        </div>

        <Slider label="Beam Direction" value={params.beam_direction}
          min={-90} max={90} step={1} unit="°" onChange={set("beam_direction")} />

        <Slider label="SNR" value={params.snr_db}
          min={0} max={60} step={1} unit=" dB" onChange={set("snr_db")} />
      </div>

      {/* Apodization */}
      <div className="panel-section">
        <div className="panel-title">Apodization</div>
        <Select label="Window Function" value={params.window}
          options={WINDOWS.map((w) => ({
            value: w,
            label: w.charAt(0).toUpperCase() + w.slice(1)
          }))}
          onChange={set("window")} />
        {params.window === "kaiser" && (
          <Slider label="Kaiser β" value={params.kaiser_beta}
            min={0} max={20} step={0.5} onChange={set("kaiser_beta")} />
        )}
        <div className="info-card" style={{ fontSize: 10 }}>
          <div style={{ color: "var(--text2)", lineHeight: 1.5 }}>
            {params.window === "rectangular" && "No apodization — best resolution, highest sidelobes"}
            {params.window === "hanning" && "Smooth taper — 32dB sidelobe suppression"}
            {params.window === "hamming" && "Similar to Hanning, -43dB sidelobes"}
            {params.window === "blackman" && "High sidelobe suppression (-74dB), wider main lobe"}
            {params.window === "kaiser" && `Adjustable via β. β=${params.kaiser_beta} → good trade-off`}
            {params.window === "chebyshev" && "Equiripple sidelobes — Dolph-Chebyshev family"}
          </div>
        </div>
      </div>

      {/* Compute */}
      <button className="btn primary" onClick={onCompute} disabled={loading}>
        {loading ? "Computing…" : "▶ Compute Pattern"}
      </button>
    </div>
  );
}

export { Slider, Select };
