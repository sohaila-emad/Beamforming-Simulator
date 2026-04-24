import React, { useState } from "react";
import BeamformingLab from "./pages/BeamformingLab";
import FiveGPage from "./pages/FiveGPage";
import UltrasoundPage from "./pages/UltrasoundPage";
import RadarPage from "./pages/RadarPage";
import "./App.css";

const TABS = [
  { id: "lab", label: "⚡ Beamforming Lab", icon: "⚡" },
  { id: "5g", label: "📡 5G Simulator", icon: "📡" },
  { id: "us", label: "🫀 Ultrasound", icon: "🫀" },
  { id: "radar", label: "🎯 Radar", icon: "🎯" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("lab");

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">◎</span>
          <span className="brand-name">BeamSim</span>
          <span className="brand-sub">2D Phased Array Simulator</span>
        </div>
        <nav className="tab-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {activeTab === "lab" && <BeamformingLab />}
        {activeTab === "5g" && <FiveGPage />}
        {activeTab === "us" && <UltrasoundPage />}
        {activeTab === "radar" && <RadarPage />}
      </main>
    </div>
  );
}
