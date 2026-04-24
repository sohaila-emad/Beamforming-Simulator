"""
Scenario Models - OOP implementations for 5G, Ultrasound, and Radar scenarios.
Each scenario encapsulates its own physics, parameters, and computation logic.
"""
import numpy as np
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from core.beamforming_engine import BeamformingParams, BeamformingCalculator, ArrayLayout, WindowType


# ─────────────────────────────────────────────
#  5G Scenario
# ─────────────────────────────────────────────

@dataclass
class Tower:
    id: str
    x: float
    y: float
    frequency: float = 3.5e9
    power_dbm: float = 43.0
    num_elements: int = 32
    beam_direction: float = 0.0
    coverage_radius: float = 500.0
    connected_users: List[str] = field(default_factory=list)


@dataclass
class NetworkUser:
    id: str
    x: float
    y: float
    connected_tower: Optional[str] = None
    signal_strength: float = 0.0


class FiveGScenario:
    """5G beamforming scenario with tower-user connectivity."""

    FREQUENCY = 3.5e9
    SPEED = 3e8
    COVERAGE_RADIUS = 500.0

    def __init__(self):
        self.towers: Dict[str, Tower] = {}
        self.users: Dict[str, NetworkUser] = {}
        self._init_default_layout()

    def _init_default_layout(self):
        self.towers = {
            "t1": Tower("t1", -300, 200, frequency=3.5e9, coverage_radius=400),
            "t2": Tower("t2", 0, -200, frequency=3.5e9, coverage_radius=400),
            "t3": Tower("t3", 300, 200, frequency=3.5e9, coverage_radius=400),
        }
        self.users = {
            "u1": NetworkUser("u1", -100, 50),
            "u2": NetworkUser("u2", 200, -100),
        }
        self._update_all_beams()

    def move_user(self, user_id: str, dx: float, dy: float):
        if user_id in self.users:
            self.users[user_id].x += dx
            self.users[user_id].y += dy
            self._update_all_beams()

    def set_user_position(self, user_id: str, x: float, y: float):
        if user_id in self.users:
            self.users[user_id].x = x
            self.users[user_id].y = y
            self._update_all_beams()

    def _update_all_beams(self):
        """Recalculate beam directions and connectivity for all towers.
        A tower can serve multiple users simultaneously."""
        for tower in self.towers.values():
            tower.connected_users = []

        for user in self.users.values():
            best_tower = None
            best_rssi = -999
            for tower in self.towers.values():
                dist = np.sqrt((tower.x - user.x) ** 2 + (tower.y - user.y) ** 2)
                if dist <= tower.coverage_radius:
                    rssi = self._compute_rssi(tower, dist)
                    if rssi > best_rssi:
                        best_rssi = rssi
                        best_tower = tower

            if best_tower:
                user.connected_tower = best_tower.id
                user.signal_strength = best_rssi
                best_tower.connected_users.append(user.id)
            else:
                user.connected_tower = None
                user.signal_strength = -999

        # Steer each tower: single user -> toward user; multiple -> toward centroid
        for tower in self.towers.values():
            if len(tower.connected_users) == 1:
                u = self.users[tower.connected_users[0]]
                tower.beam_direction = float(np.degrees(np.arctan2(u.x - tower.x, u.y - tower.y)))
            elif len(tower.connected_users) > 1:
                cx = float(np.mean([self.users[uid].x for uid in tower.connected_users]))
                cy = float(np.mean([self.users[uid].y for uid in tower.connected_users]))
                tower.beam_direction = float(np.degrees(np.arctan2(cx - tower.x, cy - tower.y)))

    def _compute_rssi(self, tower: Tower, distance: float) -> float:
        """Free space path loss model."""
        if distance < 1:
            distance = 1
        wavelength = self.SPEED / tower.frequency
        fspl = 20 * np.log10(distance) + 20 * np.log10(tower.frequency) - 147.55
        return tower.power_dbm - fspl

    def get_beam_profile(self, tower_id: str) -> dict:
        tower = self.towers[tower_id]
        params = BeamformingParams(
            num_elements=tower.num_elements,
            frequency=tower.frequency,
            beam_direction=tower.beam_direction,
            element_spacing_ratio=0.5,
            layout=ArrayLayout.LINEAR,
            speed=self.SPEED,
        )
        calc = BeamformingCalculator(params)
        theta = np.linspace(-90, 90, 361)
        theta_rad, af_db = calc.compute_array_factor(theta)
        return {
            "theta_deg": theta.tolist(),
            "theta_rad": theta_rad.tolist(),
            "af_db": af_db.tolist(),
            "beam_direction": tower.beam_direction,
            "connected_users": tower.connected_users,
        }

    def get_state(self) -> dict:
        self._update_all_beams()
        return {
            "towers": {tid: {
                "id": t.id, "x": t.x, "y": t.y,
                "frequency": t.frequency,
                "beam_direction": round(t.beam_direction, 1),
                "coverage_radius": t.coverage_radius,
                "num_elements": t.num_elements,
                "connected_users": t.connected_users
            } for tid, t in self.towers.items()},
            "users": {uid: {
                "id": u.id, "x": u.x, "y": u.y,
                "connected_tower": u.connected_tower,
                "signal_strength": round(u.signal_strength, 1)
            } for uid, u in self.users.items()}
        }


# ─────────────────────────────────────────────
#  Ultrasound Scenario
# ─────────────────────────────────────────────

@dataclass
class PhantomStructure:
    id: str
    shape: str           # 'ellipse', 'circle'
    cx: float            # center x (cm)
    cy: float            # center y (cm)
    rx: float            # semi-axis x (cm)
    ry: float            # semi-axis y (cm)
    acoustic_impedance: float = 1.63e6   # Pa·s/m (tissue default)
    attenuation_db_cm: float = 0.5       # dB/cm/MHz
    speed_of_sound: float = 1540.0      # m/s
    label: str = "Tissue"
    color: str = "#888888"
    rotation: float = 0.0  # degrees


class SheppLoganPhantom:
    """Shepp-Logan phantom with ultrasound tissue properties."""

    def __init__(self):
        self.structures: List[PhantomStructure] = self._init_structures()
        self.width_cm = 20.0
        self.height_cm = 24.0

    def _init_structures(self) -> List[PhantomStructure]:
        return [
            PhantomStructure("s0", "ellipse", 0, 0, 9.2, 11.0,
                             acoustic_impedance=1.63e6, attenuation_db_cm=0.5,
                             label="Skull/Outer", color="#cccccc", rotation=0),
            PhantomStructure("s1", "ellipse", 0, -0.0184, 8.7440, 10.3235,
                             acoustic_impedance=1.58e6, attenuation_db_cm=0.3,
                             label="Brain tissue", color="#ddaa88", rotation=0),
            PhantomStructure("s2", "ellipse", 0.22, 0, 6.24, 8.24,
                             acoustic_impedance=1.60e6, attenuation_db_cm=0.4,
                             label="White matter", color="#cc9966", rotation=-18),
            PhantomStructure("s3", "ellipse", -0.22, 0, 3.11, 6.24,
                             acoustic_impedance=1.62e6, attenuation_db_cm=0.45,
                             label="Gray matter", color="#bb8855", rotation=18),
            PhantomStructure("s4", "ellipse", 0, 0.35, 1.41, 1.94,
                             acoustic_impedance=1.52e6, attenuation_db_cm=0.1,
                             label="Ventricle (CSF)", color="#4488cc", rotation=0),
            PhantomStructure("s5", "ellipse", 0, 1.0, 0.46, 0.46,
                             acoustic_impedance=1.52e6, attenuation_db_cm=0.1,
                             label="Ventricle (CSF)", color="#4488cc", rotation=0),
            PhantomStructure("s6", "ellipse", -0.08, -0.605, 0.46, 0.23,
                             acoustic_impedance=1.70e6, attenuation_db_cm=0.8,
                             label="Tumor (dense)", color="#ff6644", rotation=0),
            PhantomStructure("s7", "ellipse", 0.06, -0.605, 0.23, 0.23,
                             acoustic_impedance=1.68e6, attenuation_db_cm=0.7,
                             label="Lesion", color="#ff8866", rotation=0),
            PhantomStructure("s8", "ellipse", 0.06, -0.105, 0.23, 0.23,
                             acoustic_impedance=1.55e6, attenuation_db_cm=0.2,
                             label="Cyst (fluid)", color="#66aaff", rotation=0),
            PhantomStructure("s9", "ellipse", 0, 0.1, 0.23, 0.46,
                             acoustic_impedance=1.55e6, attenuation_db_cm=0.2,
                             label="Fluid region", color="#88bbff", rotation=0),
        ]

    def get_structures_data(self) -> List[dict]:
        return [{
            "id": s.id, "shape": s.shape,
            "cx": s.cx, "cy": s.cy, "rx": s.rx, "ry": s.ry,
            "acoustic_impedance": s.acoustic_impedance,
            "attenuation_db_cm": s.attenuation_db_cm,
            "speed_of_sound": s.speed_of_sound,
            "label": s.label, "color": s.color, "rotation": s.rotation
        } for s in self.structures]

    def update_structure(self, struct_id: str, updates: dict):
        for s in self.structures:
            if s.id == struct_id:
                for k, v in updates.items():
                    if hasattr(s, k):
                        setattr(s, k, v)
                break

    def compute_amode(self, probe_x_cm: float, probe_y_cm: float,
                      beam_angle_deg: float, frequency_mhz: float = 5.0) -> dict:
        """
        Compute A-mode ultrasound scan along a beam line from probe.
        Returns time-domain echo signal.
        """
        SPEED_SOUND = 1540.0  # m/s
        max_depth_cm = 20.0
        num_samples = 1000
        depth = np.linspace(0, max_depth_cm, num_samples)

        angle_rad = np.radians(beam_angle_deg)
        beam_x = probe_x_cm + depth * np.sin(angle_rad)
        beam_y = probe_y_cm + depth * np.cos(angle_rad)

        echo = np.zeros(num_samples)
        cumulative_attenuation = np.zeros(num_samples)

        prev_impedance = 1.63e6  # air/skin interface
        for i, (bx, by) in enumerate(zip(beam_x, beam_y)):
            # Normalize to phantom coords (-1 to 1)
            nx = bx / (self.width_cm / 2)
            ny = by / (self.height_cm / 2) - 1

            for struct in self.structures:
                cos_r = np.cos(np.radians(struct.rotation))
                sin_r = np.sin(np.radians(struct.rotation))
                dx = (nx - struct.cx / 9.2) * cos_r + (ny - struct.cy / 11.0) * sin_r
                dy = -(nx - struct.cx / 9.2) * sin_r + (ny - struct.cy / 11.0) * cos_r

                val = (dx / (struct.rx / 9.2)) ** 2 + (dy / (struct.ry / 11.0)) ** 2
                if val <= 1.0:
                    current_impedance = struct.acoustic_impedance
                    if abs(current_impedance - prev_impedance) > 1e4:
                        reflection = ((current_impedance - prev_impedance) /
                                      (current_impedance + prev_impedance)) ** 2
                        atten = cumulative_attenuation[i] if i > 0 else 0
                        echo[i] += reflection * np.exp(-atten)
                        prev_impedance = current_impedance

                    cumulative_attenuation[i] = (cumulative_attenuation[i - 1] if i > 0 else 0) + \
                                                struct.attenuation_db_cm * depth[i] * frequency_mhz / 8.686
                    break

        time_us = depth * 2 / (SPEED_SOUND * 100) * 1e6  # microseconds

        # Add noise
        echo += np.random.randn(num_samples) * 0.01

        return {
            "depth_cm": depth.tolist(),
            "time_us": time_us.tolist(),
            "echo": echo.tolist(),
            "probe_x": probe_x_cm,
            "probe_y": probe_y_cm,
            "angle_deg": beam_angle_deg,
        }


# ─────────────────────────────────────────────
#  Radar Scenario
# ─────────────────────────────────────────────

@dataclass
class RadarTarget:
    id: str
    distance: float   # meters
    angle: float      # degrees from north
    size: float       # meters (radar cross-section proxy)
    rcs_dbsm: float = 10.0  # radar cross section dBsm

    @property
    def x(self) -> float:
        return self.distance * np.sin(np.radians(self.angle))

    @property
    def y(self) -> float:
        return self.distance * np.cos(np.radians(self.angle))


class RadarScenario:
    """Rotating 360° radar scanner with target detection."""

    FREQUENCY = 10e9  # X-band radar
    SPEED = 3e8
    MAX_RANGE = 5000.0  # meters

    def __init__(self):
        self.targets: Dict[str, RadarTarget] = {}
        self.current_angle: float = 0.0
        self.scan_speed_deg_s: float = 10.0
        self.beam_width_deg: float = 5.0
        self.num_elements: int = 32
        self.snr_db: float = 20.0
        self._sweep_data: List[dict] = []
        self._ppi_data: np.ndarray = np.zeros((360,))

    def add_target(self, tid: str, distance: float, angle: float, size: float):
        self.targets[tid] = RadarTarget(tid, distance, angle, size)

    def remove_target(self, tid: str):
        self.targets.pop(tid, None)

    def update_target(self, tid: str, **kwargs):
        if tid in self.targets:
            for k, v in kwargs.items():
                setattr(self.targets[tid], k, v)

    def compute_scan_return(self, scan_angle_deg: float) -> dict:
        """
        Compute radar return for a given scan angle.
        Returns range profile (range vs power).
        """
        range_bins = np.linspace(0, self.MAX_RANGE, 500)
        power = np.zeros(len(range_bins))

        half_bw = self.beam_width_deg / 2

        for target in self.targets.values():
            angle_diff = abs(scan_angle_deg - target.angle) % 360
            if angle_diff > 180:
                angle_diff = 360 - angle_diff

            if angle_diff <= half_bw:
                # Radar range equation
                r = target.distance
                if r < 1:
                    r = 1
                wavelength = self.SPEED / self.FREQUENCY
                # Pattern gain factor
                gain_factor = np.cos(np.radians(angle_diff / half_bw * 90)) ** 2
                # Power proportional to 1/r^4
                received_power = (gain_factor * target.size ** 2) / r ** 4
                # Add to nearest range bin
                bin_idx = np.argmin(np.abs(range_bins - r))
                spread = max(1, int(target.size / (self.MAX_RANGE / 500)))
                for bi in range(max(0, bin_idx - spread), min(len(range_bins), bin_idx + spread + 1)):
                    power[bi] += received_power * np.exp(-((bi - bin_idx) / max(spread, 1)) ** 2)

        # Add thermal noise
        snr_linear = 10 ** (self.snr_db / 10)
        noise_floor = np.max(power) / snr_linear if np.max(power) > 0 else 1e-10
        power += np.abs(noise_floor * np.random.randn(len(range_bins)))

        # Normalize
        if np.max(power) > 0:
            power_norm = power / np.max(power)
        else:
            power_norm = power

        return {
            "scan_angle": scan_angle_deg,
            "range_bins": range_bins.tolist(),
            "power": power_norm.tolist(),
        }

    def get_ppi_scan(self) -> dict:
        """Compute full 360° PPI scan data."""
        angles = np.arange(0, 360, 1.0)
        ppi = []
        for angle in angles:
            ret = self.compute_scan_return(angle)
            peak_power = float(np.max(ret["power"]))
            peak_range = float(ret["range_bins"][int(np.argmax(ret["power"]))])
            ppi.append({
                "angle": float(angle),
                "peak_power": peak_power,
                "peak_range": peak_range,
            })
        return {
            "ppi": ppi,
            "targets": [{
                "id": t.id, "distance": t.distance,
                "angle": t.angle, "size": t.size,
                "x": t.x, "y": t.y
            } for t in self.targets.values()]
        }

    def get_state(self) -> dict:
        return {
            "current_angle": self.current_angle,
            "scan_speed": self.scan_speed_deg_s,
            "beam_width": self.beam_width_deg,
            "num_elements": self.num_elements,
            "snr_db": self.snr_db,
            "targets": [{
                "id": t.id, "distance": t.distance,
                "angle": t.angle, "size": t.size,
                "x": t.x, "y": t.y
            } for t in self.targets.values()]
        }