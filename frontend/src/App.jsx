import React, { useState, useRef, useCallback } from "react";
import BeamformingLab from "./pages/BeamformingLab";
import FiveGPage from "./pages/FiveGPage";
import UltrasoundPage from "./pages/UltrasoundPage";
import RadarPage from "./pages/RadarPage";
import "./App.css";

export const BF_DEFAULT_P = {
  num_elements: 8, frequency: 10e9, beam_direction: 0,
  spacing_ratio: 0.5, layout: "linear", curvature_radius: 60,
  window: "rectangular", snr_db: 1000, speed: 3e8,
};

const TABS = [
  { id: "lab",   label: "⚡ Beamforming Lab" },
  { id: "5g",    label: "📡 5G Simulator"    },
  { id: "us",    label: "🫀 Ultrasound"       },
  { id: "radar", label: "🎯 Radar"            },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("lab");

  // Persist BeamformingLab params across tab switches
  const [bfParams,    setBfParams]    = useState(BF_DEFAULT_P);
  const [bfHasCustom, setBfHasCustom] = useState(false);

  const onBfParamsChange = useCallback((p) => {
    setBfParams(p);
    setBfHasCustom(true);
  }, []);

  // Hover-dropdown state
  const [openDropdown, setOpenDropdown] = useState(null);
  const closeTimer = useRef(null);

  const openDrop  = (id) => { clearTimeout(closeTimer.current); setOpenDropdown(id); };
  const closeDrop = ()   => { closeTimer.current = setTimeout(() => setOpenDropdown(null), 200); };
  const keepOpen  = ()   => clearTimeout(closeTimer.current);

  const switchWithSettings = (id, useDefault) => {
    setOpenDropdown(null);
    if (id === "lab" && useDefault) {
      setBfParams(BF_DEFAULT_P);
      setBfHasCustom(false);
    }
    setActiveTab(id);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">◎</span>
          <span className="brand-name">BeamSim</span>
          <span className="brand-sub">2D Phased Array Simulator</span>
        </div>

        <nav className="tab-nav">
          {TABS.map((t) => {
            const isActive     = activeTab === t.id;
            const isOpen       = openDropdown === t.id;
            const hasDropdown  = t.id === "lab" && bfHasCustom;

            return (
              <div
                key={t.id}
                className="tab-wrapper"
                onMouseEnter={() => hasDropdown ? openDrop(t.id) : null}
                onMouseLeave={closeDrop}
              >
                <button
                  className={`tab-btn ${isActive ? "active" : ""}`}
                  onClick={() => { setOpenDropdown(null); setActiveTab(t.id); }}
                >
                  {t.label}
                  {hasDropdown && <span className="tab-chevron">▾</span>}
                </button>

                {hasDropdown && isOpen && (
                  <div
                    className="tab-dropdown"
                    onMouseEnter={keepOpen}
                    onMouseLeave={closeDrop}
                  >
                    <div className="tab-dropdown-title">Open Beamforming Lab with…</div>
                    <button
                      className="tab-dropdown-item"
                      onClick={() => switchWithSettings(t.id, false)}
                    >
                      <span className="tdi-icon">↩</span>
                      <span className="tdi-text">
                        <strong>Last settings</strong>
                        <small>Resume where you left off</small>
                      </span>
                    </button>
                    <button
                      className="tab-dropdown-item"
                      onClick={() => switchWithSettings(t.id, true)}
                    >
                      <span className="tdi-icon">↺</span>
                      <span className="tdi-text">
                        <strong>Default settings</strong>
                        <small>8-el · 10 GHz · rectangular</small>
                      </span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </header>

      <main className="app-main">
        {activeTab === "lab"   && <BeamformingLab params={bfParams} onParamsChange={onBfParamsChange} />}
        {activeTab === "5g"    && <FiveGPage />}
        {activeTab === "us"    && <UltrasoundPage />}
        {activeTab === "radar" && <RadarPage />}
      </main>
    </div>
  );
}