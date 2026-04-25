"""
Flask REST API for Beamforming Simulator
All routes follow RESTful conventions with JSON payloads.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request
from flask_cors import CORS
import numpy as np

from core.beamforming_engine import (
    BeamformingParams, BeamformingCalculator,
    ArrayLayout, WindowType
)
from models.scenarios import FiveGScenario, SheppLoganPhantom, RadarScenario

app = Flask(__name__)
CORS(app)

# ── Singleton scenario instances ──────────────────────────────────────────────
_fiveg = FiveGScenario()
_phantom = SheppLoganPhantom()
_radar = RadarScenario()

# Pre-populate radar with some targets
_radar.add_target("r1", 1500, 45, 50)
_radar.add_target("r2", 2500, 135, 30)
_radar.add_target("r3", 800, 270, 80)


def _parse_params(data: dict) -> BeamformingParams:
    layout_str = data.get("layout", "linear").lower()
    layout = ArrayLayout.LINEAR if layout_str == "linear" else ArrayLayout.CURVED
    window_str = data.get("window", "rectangular").lower()
    window_map = {
        "rectangular": WindowType.RECTANGULAR,
        "hanning": WindowType.HANNING,
        "hamming": WindowType.HAMMING,
        "blackman": WindowType.BLACKMAN,
        "kaiser": WindowType.KAISER,
        "chebyshev": WindowType.CHEBYSHEV,
    }
    window = window_map.get(window_str, WindowType.RECTANGULAR)
    return BeamformingParams(
        num_elements=int(data.get("num_elements", 16)),
        frequency=float(data.get("frequency", 3e9)),
        beam_direction=float(data.get("beam_direction", 0)),
        element_spacing_ratio=float(data.get("spacing_ratio", 0.5)),
        layout=layout,
        curvature_radius=float(data.get("curvature_radius", 1.0)),
        window_type=window,
        kaiser_beta=float(data.get("kaiser_beta", 6.0)),
        snr_db=float(data.get("snr_db", 30.0)),
        speed=float(data.get("speed", 3e8)),
    )


# ─────────────────────────────────────────────
#  Core Beamforming Routes
# ─────────────────────────────────────────────

@app.route("/api/beam/pattern", methods=["POST"])
def beam_pattern():
    """Compute beam pattern (array factor) for given parameters."""
    data = request.json or {}
    params = _parse_params(data)
    calc = BeamformingCalculator(params)
    theta = np.linspace(-90, 90, 361)
    theta_rad, af_db = calc.compute_array_factor(theta)
    return jsonify({
        "theta_deg": theta.tolist(),
        "theta_rad": theta_rad.tolist(),
        "af_db": af_db.tolist(),
        "params": {
            "wavelength": params.wavelength,
            "element_spacing": params.element_spacing,
            "wavenumber": params.wavenumber,
        }
    })


@app.route("/api/beam/interference", methods=["POST"])
def interference_map():
    """Compute 2D interference field map."""
    data = request.json or {}
    params = _parse_params(data)
    calc = BeamformingCalculator(params)

    resolution = int(data.get("resolution", 150))
    x_range = data.get("x_range", [-10, 10])
    y_range = data.get("y_range", [-1, 10])

    result = calc.compute_interference_map(
        x_range=tuple(x_range),
        y_range=tuple(y_range),
        resolution=resolution
    )
    return jsonify(result)


@app.route("/api/beam/positions", methods=["POST"])
def antenna_positions():
    """Return antenna element positions for given array config."""
    data = request.json or {}
    params = _parse_params(data)
    calc = BeamformingCalculator(params)
    return jsonify({
        "positions": calc.get_positions(),
        "weights": calc.get_weights(),
    })


@app.route("/api/beam/scenarios", methods=["GET"])
def get_scenarios():
    """Get preset scenario configurations."""
    return jsonify({
        "5g": {
            "num_elements": 57,
            "frequency": 3.5e9,
            "beam_direction": 0,
            "spacing_ratio": 0.5,
            "layout": "linear",
            "window": "chebyshev",
            "snr_db": 25,
            "speed": 3e8,
            "label": "5G Beamforming",
            "description": "3.5 GHz massive MIMO, 57 elements, linear ULA"
        },
        "ultrasound": {
            "num_elements": 128,
            "frequency": 5e6,
            "beam_direction": 0,
            "spacing_ratio": 0.5,
            "layout": "linear",
            "window": "hanning",
            "snr_db": 20,
            "speed": 1540,
            "label": "Ultrasound",
            "description": "5 MHz transducer, 128 elements, v_sound=1540 m/s"
        },
        "radar": {
            "num_elements": 32,
            "frequency": 10e9,
            "beam_direction": 0,
            "spacing_ratio": 0.5,
            "layout": "linear",
            "window": "hamming",
            "snr_db": 15,
            "speed": 3e8,
            "label": "Radar (X-band)",
            "description": "10 GHz X-band radar, 32 elements"
        },
        "tumor": {
            "num_elements": 23,
            "frequency": 0.9e9,
            "beam_direction": 0,
            "spacing_ratio": 0.5,
            "layout": "curved",
            "curvature_radius": 2.0,
            "window": "blackman",
            "snr_db": 30,
            "speed": 1540,
            "label": "Tumor Ablation",
            "description": "Focused ultrasound, curved array, 0.9 GHz"
        }
    })


# ─────────────────────────────────────────────
#  5G Scenario Routes
# ─────────────────────────────────────────────

@app.route("/api/5g/state", methods=["GET"])
def fiveg_state():
    return jsonify(_fiveg.get_state())


@app.route("/api/5g/user/move", methods=["POST"])
def fiveg_move_user():
    data = request.json or {}
    user_id = data.get("user_id")
    x = data.get("x")
    y = data.get("y")
    if user_id and x is not None and y is not None:
        _fiveg.set_user_position(user_id, float(x), float(y))
    return jsonify(_fiveg.get_state())


@app.route("/api/5g/tower/beam", methods=["GET"])
def fiveg_tower_beam():
    tower_id = request.args.get("tower_id", "t1")
    return jsonify(_fiveg.get_beam_profile(tower_id))


@app.route("/api/5g/tower/update", methods=["POST"])
def fiveg_tower_update():
    data = request.json or {}
    tower_id = data.get("tower_id")
    if tower_id and tower_id in _fiveg.towers:
        tower = _fiveg.towers[tower_id]
        if "coverage_radius" in data:
            tower.coverage_radius = float(data["coverage_radius"])
        if "num_elements" in data:
            tower.num_elements = int(data["num_elements"])
        if "frequency" in data:
            tower.frequency = float(data["frequency"])
        _fiveg._update_all_beams()
    return jsonify(_fiveg.get_state())


@app.route("/api/5g/tower/move", methods=["POST"])
def fiveg_move_tower():
    data = request.json or {}
    tower_id = data.get("tower_id")
    x = data.get("x")
    y = data.get("y")
    if tower_id and x is not None and y is not None and tower_id in _fiveg.towers:
        _fiveg.towers[tower_id].x = float(x)
        _fiveg.towers[tower_id].y = float(y)
        _fiveg._update_all_beams()
    return jsonify(_fiveg.get_state())


@app.route("/api/5g/reset", methods=["POST"])
def fiveg_reset():
    global _fiveg
    _fiveg = FiveGScenario()
    return jsonify(_fiveg.get_state())


# ─────────────────────────────────────────────
#  Ultrasound Scenario Routes
# ─────────────────────────────────────────────

@app.route("/api/ultrasound/phantom", methods=["GET"])
def phantom_structures():
    return jsonify({"structures": _phantom.get_structures_data()})


@app.route("/api/ultrasound/amode", methods=["POST"])
def amode_scan():
    data = request.json or {}
    probe_x = float(data.get("probe_x", 0))
    probe_y = float(data.get("probe_y", 0))
    angle = float(data.get("angle", 0))
    freq_mhz = float(data.get("frequency_mhz", 5.0))
    result = _phantom.compute_amode(probe_x, probe_y, angle, freq_mhz)
    return jsonify(result)


@app.route("/api/ultrasound/structure/update", methods=["POST"])
def update_structure():
    data = request.json or {}
    struct_id = data.get("id")
    updates = data.get("updates", {})
    if struct_id:
        _phantom.update_structure(struct_id, updates)
    return jsonify({"structures": _phantom.get_structures_data()})


@app.route("/api/ultrasound/bmode", methods=["POST"])
def bmode_scan():
    """Compute multiple A-mode lines to form B-mode image, centred on probe_x."""
    data = request.json or {}
    probe_x   = float(data.get("probe_x", 0))
    probe_y   = float(data.get("probe_y", 0))
    angle     = float(data.get("angle", 0))
    freq_mhz  = float(data.get("frequency_mhz", 5.0))
    num_lines = int(data.get("num_lines", 64))
    fan_width = float(data.get("fan_width", 8.0))  # half-width in cm around probe_x

    x_left  = probe_x - fan_width
    x_right = probe_x + fan_width
    x_positions = np.linspace(x_left, x_right, num_lines)
    bmode_lines = []
    for px in x_positions:
        result = _phantom.compute_amode(px, probe_y, angle, freq_mhz)
        bmode_lines.append({
            "x": float(px),
            "echo": result["echo"],
            "depth_cm": result["depth_cm"]
        })

    return jsonify({
        "lines": bmode_lines,
        "num_lines": num_lines,
        "x_range": [float(x_left), float(x_right)],
        "probe_x": probe_x
    })


# ─────────────────────────────────────────────
#  Radar Scenario Routes
# ─────────────────────────────────────────────

@app.route("/api/radar/state", methods=["GET"])
def radar_state():
    return jsonify(_radar.get_state())


@app.route("/api/radar/scan", methods=["POST"])
def radar_scan():
    data = request.json or {}
    angle = float(data.get("angle", 0))
    result = _radar.compute_scan_return(angle)
    return jsonify(result)


@app.route("/api/radar/ppi", methods=["GET"])
def radar_ppi():
    return jsonify(_radar.get_ppi_scan())


@app.route("/api/radar/target/add", methods=["POST"])
def add_radar_target():
    data = request.json or {}
    import uuid
    tid = data.get("id", f"r{str(uuid.uuid4())[:4]}")
    _radar.add_target(
        tid,
        float(data.get("distance", 1000)),
        float(data.get("angle", 0)),
        float(data.get("size", 50))
    )
    return jsonify(_radar.get_state())


@app.route("/api/radar/target/update", methods=["POST"])
def update_radar_target():
    data = request.json or {}
    tid = data.get("id")
    updates = {k: v for k, v in data.items() if k != "id"}
    if tid:
        _radar.update_target(tid, **updates)
    return jsonify(_radar.get_state())


@app.route("/api/radar/target/remove", methods=["POST"])
def remove_radar_target():
    data = request.json or {}
    tid = data.get("id")
    if tid:
        _radar.remove_target(tid)
    return jsonify(_radar.get_state())


@app.route("/api/radar/settings", methods=["POST"])
def update_radar_settings():
    data = request.json or {}
    if "beam_width" in data:
        _radar.beam_width_deg = float(data["beam_width"])
    if "scan_speed" in data:
        _radar.scan_speed_deg_s = float(data["scan_speed"])
    if "snr_db" in data:
        _radar.snr_db = float(data["snr_db"])
    if "num_elements" in data:
        _radar.num_elements = int(data["num_elements"])
    return jsonify(_radar.get_state())


if __name__ == "__main__":
    app.run(debug=True, port=5000)