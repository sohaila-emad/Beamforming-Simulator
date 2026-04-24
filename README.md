# BeamSim — 2D Phased Array Beamforming Simulator

A full-stack web application implementing a 2D beamforming simulator with three specialized scenario modules: **5G**, **Ultrasound**, and **Radar**. Built with Flask (Python) backend and React frontend, following strict OOP principles.

---

## Project Structure

```
beamforming-simulator/
├── backend/                        # Flask Python backend
│   ├── app.py                      # Flask REST API entry point
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── core/
│   │   └── beamforming_engine.py   # OOP beamforming math engine
│   └── models/
│       └── scenarios.py            # 5G, Ultrasound, Radar scenario classes
│
├── frontend/                       # React frontend
│   ├── public/index.html
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│       ├── App.jsx                 # Root component + navigation
│       ├── App.css                 # Global design system
│       ├── index.js
│       ├── utils/
│       │   └── api.js              # All backend API calls
│       ├── store/
│       │   └── index.js            # Zustand global state stores
│       ├── components/
│       │   └── ControlPanel.jsx    # Reusable parameter controls
│       └── pages/
│           ├── BeamformingLab.jsx  # Core beam pattern + interference map
│           ├── FiveGPage.jsx       # 5G tower/user simulator
│           ├── UltrasoundPage.jsx  # Shepp-Logan phantom scanner
│           └── RadarPage.jsx       # 360° PPI radar display
│
└── docker-compose.yml              # One-command launch
```

---

## OOP Architecture

### Backend Class Hierarchy

```
BeamformingParams (dataclass)          ← all parameters in one place

AntennaArray (ABC)
  ├── LinearArray                      ← ULA geometry
  └── CurvedArray                      ← arc geometry
ArrayFactory                           ← creates correct subclass

BeamformingCalculator
  ├── compute_array_factor()           ← polar beam pattern (dB)
  ├── compute_interference_map()       ← 2D field map
  └── _add_noise()                     ← SNR-based noise injection

FiveGScenario
  ├── Tower (dataclass)
  ├── NetworkUser (dataclass)
  ├── _update_all_beams()              ← auto-steer on user move
  └── _compute_rssi()                  ← free-space path loss

SheppLoganPhantom
  ├── PhantomStructure (dataclass)
  ├── compute_amode()                  ← echo trace with attenuation
  └── update_structure()              ← editable tissue properties

RadarScenario
  ├── RadarTarget (dataclass)
  ├── compute_scan_return()            ← range profile per angle
  └── get_ppi_scan()                   ← full 360° PPI
```

### Enums & Constants
- `ArrayLayout` — LINEAR / CURVED
- `WindowType` — RECTANGULAR / HANNING / HAMMING / BLACKMAN / KAISER / CHEBYSHEV

---

## Features

### ⚡ Beamforming Lab (Core)
- 7+ adjustable parameters: elements, frequency, beam direction, spacing ratio, curvature, SNR, window type
- Real-time polar beam pattern (dB scale with grid)
- 2D constructive/destructive interference field map (canvas-rendered)
- **Apodization/windowing**: rectangular, Hanning, Hamming, Blackman, Kaiser (adjustable β), Chebyshev
- SNR control (0–60 dB) affecting beam noise floor visually
- Quick-load presets: 5G / Ultrasound / Radar / Tumor Ablation
- Live metrics: peak gain, HPBW, wavelength

### 📡 5G Simulator
- 3 towers (auto-placed), 2 draggable users
- Towers auto-steer beam toward closest user via free-space path loss model
- Coverage radius displayed per tower
- Signal strength (RSSI in dBm) shown on beam links
- Per-tower mini beam pattern (live)
- Editable: coverage radius, element count per tower
- Multi-user connectivity when both are in range

### 🫀 Ultrasound Simulator
- Shepp-Logan phantom with 10 anatomically-labelled structures
- Each structure has: acoustic impedance (Z), attenuation (α dB/cm/MHz), sound speed
- **Hover** structures → inspect tissue properties
- **Click** structures → edit parameters live
- Draggable probe with adjustable angle and frequency
- A-mode output: echo amplitude vs depth with attenuation model
- B-mode: multi-line lateral scan (64 lines)
- Proper ultrasound physics: reflection from impedance mismatch, exponential attenuation

### 🎯 Radar Simulator
- 360° PPI (Plan Position Indicator) display with phosphor-persistence style
- Real steering (phase array, no mechanical rotation)
- Add up to 5 solid targets: distance, angle, size all configurable
- Adjustable beam width (wide = fast coarse, narrow = slow precise)
- Adjustable scan speed and SNR
- Range profile display per sweep angle
- Live target detection highlighting

---

## Quick Start

### Option A — Docker (recommended)

```bash
docker-compose up --build
```

- Frontend → http://localhost:3000
- Backend API → http://localhost:5000/api

### Option B — Manual

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python app.py
```

**Frontend:**
```bash
cd frontend
npm install
npm start
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/beam/pattern` | Compute polar beam pattern |
| POST | `/api/beam/interference` | Compute 2D interference map |
| POST | `/api/beam/positions` | Get antenna element positions |
| GET  | `/api/beam/scenarios` | Preset scenario configs |
| GET  | `/api/5g/state` | Current 5G tower/user state |
| POST | `/api/5g/user/move` | Move a user to new position |
| POST | `/api/5g/tower/update` | Update tower parameters |
| GET  | `/api/ultrasound/phantom` | Shepp-Logan structure list |
| POST | `/api/ultrasound/amode` | Run A-mode scan |
| POST | `/api/ultrasound/bmode` | Run B-mode scan |
| POST | `/api/ultrasound/structure/update` | Edit tissue properties |
| GET  | `/api/radar/state` | Radar state + targets |
| POST | `/api/radar/scan` | Single-angle scan return |
| GET  | `/api/radar/ppi` | Full 360° PPI data |
| POST | `/api/radar/target/add` | Add radar target |
| POST | `/api/radar/target/update` | Modify target |
| POST | `/api/radar/target/remove` | Delete target |
| POST | `/api/radar/settings` | Update radar parameters |

---

## Physics Notes

### 5G
- Frequency: 3.5 GHz (sub-6 FR1 band)
- Element spacing: λ/2 (Nyquist criterion, avoids grating lobes)
- Path loss: Free-space model FSPL = 20log(d) + 20log(f) − 147.55

### Ultrasound
- Propagation speed: 1540 m/s (soft tissue average)
- Frequency range: 1–20 MHz
- Attenuation: exponential, α·d·f dB loss
- Reflection: |Z2−Z1|²/(Z2+Z1)² at interfaces

### Radar
- Band: X-band, 10 GHz
- Range: up to 5 km
- Detection: range equation, 1/r⁴ power fall-off
- Beam width determines angular resolution

### Apodization Windows (sidelobe reduction)
| Window | Peak Sidelobe | Main Lobe Width |
|--------|--------------|-----------------|
| Rectangular | −13 dB | Narrowest |
| Hanning | −32 dB | 1.5× |
| Hamming | −43 dB | 1.5× |
| Blackman | −74 dB | 1.7× |
| Kaiser (β=6) | −44 dB | Adjustable |

---

## Dependencies

**Backend:** Python 3.11, Flask 3.0, Flask-CORS, NumPy, SciPy

**Frontend:** React 18, Zustand, Axios
