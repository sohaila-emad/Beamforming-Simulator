"""
Beamforming Engine - Core OOP Module
Implements phased array beamforming mathematics with apodization/windowing support.
"""
import numpy as np
from abc import ABC, abstractmethod
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Optional, Tuple


class ArrayLayout(Enum):
    LINEAR = "linear"
    CURVED = "curved"


class WindowType(Enum):
    RECTANGULAR = "rectangular"
    HANNING = "hanning"
    HAMMING = "hamming"
    BLACKMAN = "blackman"
    KAISER = "kaiser"
    CHEBYSHEV = "chebyshev"


@dataclass
class BeamformingParams:
    """Encapsulates all beamforming configuration parameters."""
    num_elements: int = 16
    frequency: float = 3e9          # Hz
    beam_direction: float = 0.0     # degrees
    element_spacing_ratio: float = 0.5  # spacing / wavelength
    layout: ArrayLayout = ArrayLayout.LINEAR
    curvature_radius: float = 1.0   # only for curved arrays
    window_type: WindowType = WindowType.RECTANGULAR
    kaiser_beta: float = 6.0        # Kaiser window parameter
    snr_db: float = 30.0            # Signal-to-Noise Ratio in dB
    speed: float = 3e8              # wave propagation speed (m/s)

    @property
    def wavelength(self) -> float:
        return self.speed / self.frequency

    @property
    def element_spacing(self) -> float:
        return self.element_spacing_ratio * self.wavelength

    @property
    def wavenumber(self) -> float:
        return 2 * np.pi / self.wavelength


class AntennaArray(ABC):
    """Abstract base class for phased array geometries."""

    def __init__(self, params: BeamformingParams):
        self.params = params

    @abstractmethod
    def get_positions(self) -> np.ndarray:
        """Return (N, 2) array of element positions in meters."""
        pass

    def get_apodization_weights(self) -> np.ndarray:
        """Compute apodization window weights for sidelobe reduction."""
        N = self.params.num_elements
        wt = self.params.window_type

        if wt == WindowType.RECTANGULAR:
            return np.ones(N)
        elif wt == WindowType.HANNING:
            return np.hanning(N)
        elif wt == WindowType.HAMMING:
            return np.hamming(N)
        elif wt == WindowType.BLACKMAN:
            return np.blackman(N)
        elif wt == WindowType.KAISER:
            return np.kaiser(N, self.params.kaiser_beta)
        elif wt == WindowType.CHEBYSHEV:
            # Dolph-Chebyshev approximation via Kaiser
            return np.kaiser(N, self.params.kaiser_beta * 1.2)
        return np.ones(N)


class LinearArray(AntennaArray):
    """Uniform Linear Array (ULA)."""

    def get_positions(self) -> np.ndarray:
        N = self.params.num_elements
        d = self.params.element_spacing
        indices = np.arange(-(N - 1) / 2, (N - 1) / 2 + 1)
        return np.column_stack([indices * d, np.zeros(N)])


class CurvedArray(AntennaArray):
    """Curved (arc) phased array."""

    def get_positions(self) -> np.ndarray:
        N = self.params.num_elements
        R = self.params.curvature_radius
        arc_angle = np.pi / 3  # 60 degree arc
        angle_step = arc_angle / max(N - 1, 1)
        start_angle = -arc_angle / 2
        angles = [start_angle + n * angle_step for n in range(N)]
        return np.array([
            [R * np.sin(a), -R * np.cos(a)] for a in angles
        ])


class ArrayFactory:
    """Factory for creating antenna array instances."""

    @staticmethod
    def create(params: BeamformingParams) -> AntennaArray:
        if params.layout == ArrayLayout.LINEAR:
            return LinearArray(params)
        elif params.layout == ArrayLayout.CURVED:
            return CurvedArray(params)
        raise ValueError(f"Unknown layout: {params.layout}")


class BeamformingCalculator:
    """
    Core beamforming math engine.
    Computes beam patterns, interference maps, and steering vectors.
    """

    def __init__(self, params: BeamformingParams):
        self.params = params
        self._array = ArrayFactory.create(params)

    def update_params(self, params: BeamformingParams):
        self.params = params
        self._array = ArrayFactory.create(params)

    def _add_noise(self, signal: np.ndarray) -> np.ndarray:
        """Add Gaussian noise based on SNR parameter."""
        snr_linear = 10 ** (self.params.snr_db / 10)
        signal_power = np.mean(np.abs(signal) ** 2)
        noise_power = signal_power / snr_linear if snr_linear > 0 else signal_power
        noise = np.sqrt(noise_power / 2) * (
            np.random.randn(*signal.shape) + 1j * np.random.randn(*signal.shape)
        )
        return signal + noise

    def compute_array_factor(self, theta_deg: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Compute the array factor (beam pattern) over angle range.
        Returns: (theta_rad, array_factor_dB)
        """
        positions = self._array.get_positions()
        weights = self._array.get_apodization_weights()
        k = self.params.wavenumber
        theta_b_rad = np.radians(self.params.beam_direction)
        theta_rad = np.radians(theta_deg)

        # Steering delays
        if self.params.layout == ArrayLayout.LINEAR:
            d = self.params.element_spacing
            steering_delay = -k * d * np.sin(theta_b_rad)
            af = np.zeros(len(theta_rad), dtype=complex)
            for n in range(self.params.num_elements):
                phase = n * (k * d * np.sin(theta_rad) + steering_delay)
                af += weights[n] * np.exp(1j * phase)
        else:
            steering_delays = -k * (
                positions[:, 0] * np.sin(theta_b_rad) +
                positions[:, 1] * np.cos(theta_b_rad)
            )
            af = np.zeros(len(theta_rad), dtype=complex)
            for n in range(self.params.num_elements):
                phase = k * (
                    positions[n, 0] * np.sin(theta_rad) +
                    positions[n, 1] * np.cos(theta_rad)
                ) + steering_delays[n]
                af += weights[n] * np.exp(1j * phase)

        af_magnitude = np.abs(af)

        # Add noise effect
        if self.params.snr_db < 60:
            noise_floor = np.max(af_magnitude) * 10 ** (-self.params.snr_db / 20)
            af_magnitude += np.abs(noise_floor * np.random.randn(len(af_magnitude)))

        af_normalized = af_magnitude / (np.max(af_magnitude) + 1e-12)
        af_db = 20 * np.log10(af_normalized + 1e-12)
        af_db = np.clip(af_db, -60, 0)

        return theta_rad, af_db

    def compute_interference_map(
        self, x_range: Tuple[float, float] = (-10, 10),
        y_range: Tuple[float, float] = (-1, 10),
        resolution: int = 200
    ) -> dict:
        """
        Compute 2D constructive/destructive interference field map.
        Returns dict with grid arrays and field intensity.
        """
        positions = self._array.get_positions()
        weights = self._array.get_apodization_weights()
        k = self.params.wavenumber
        theta_b_rad = np.radians(self.params.beam_direction)

        x = np.linspace(x_range[0], x_range[1], resolution)
        y = np.linspace(y_range[0], y_range[1], resolution)
        X, Y = np.meshgrid(x, y)

        if self.params.layout == ArrayLayout.LINEAR:
            d = self.params.element_spacing
            steering_delay = -k * d * np.sin(theta_b_rad)
            field_map = np.zeros_like(X, dtype=complex)
            for idx, pos in enumerate(positions):
                dist = np.sqrt((X - pos[0]) ** 2 + (Y - pos[1]) ** 2)
                dist[dist == 0] = 1e-6
                phase_shift = -idx * steering_delay
                field_map += weights[idx] * np.exp(1j * (k * dist + phase_shift))
        else:
            steering_delays = -k * (
                positions[:, 0] * np.sin(theta_b_rad) +
                positions[:, 1] * np.cos(theta_b_rad)
            )
            field_map = np.zeros_like(X, dtype=complex)
            for idx, pos in enumerate(positions):
                dist = np.sqrt((X - pos[0]) ** 2 + (Y - pos[1]) ** 2)
                dist[dist == 0] = 1e-6
                field_map += weights[idx] * np.exp(1j * (k * dist + steering_delays[idx]))

        intensity = np.real(field_map)
        max_val = np.max(np.abs(intensity))
        if max_val > 0:
            intensity /= max_val

        return {
            "x": x.tolist(),
            "y": y.tolist(),
            "intensity": intensity.tolist(),
            "positions": positions.tolist(),
            "x_range": list(x_range),
            "y_range": list(y_range),
        }

    def get_positions(self) -> List[List[float]]:
        return self._array.get_positions().tolist()

    def get_weights(self) -> List[float]:
        return self._array.get_apodization_weights().tolist()
