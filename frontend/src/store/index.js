import { create } from "zustand";

// ─── Core beamforming parameter store ────────────────────────────────────────
export const useBeamStore = create((set, get) => ({
  // Parameters
  num_elements: 16,
  frequency: 3e9,
  beam_direction: 0,
  spacing_ratio: 0.5,
  layout: "linear",
  curvature_radius: 1.0,
  window: "rectangular",
  kaiser_beta: 6.0,
  snr_db: 30,
  speed: 3e8,
  mode: "transmitting",

  // Results
  beamPattern: null,
  interferenceMap: null,
  loading: false,

  setParam: (key, value) => set({ [key]: value }),
  setParams: (params) => set(params),
  setBeamPattern: (data) => set({ beamPattern: data }),
  setInterferenceMap: (data) => set({ interferenceMap: data }),
  setLoading: (v) => set({ loading: v }),

  getParams: () => {
    const s = get();
    return {
      num_elements: s.num_elements,
      frequency: s.frequency,
      beam_direction: s.beam_direction,
      spacing_ratio: s.spacing_ratio,
      layout: s.layout,
      curvature_radius: s.curvature_radius,
      window: s.window,
      kaiser_beta: s.kaiser_beta,
      snr_db: s.snr_db,
      speed: s.speed,
    };
  },
}));

// ─── 5G scenario store ────────────────────────────────────────────────────────
export const useFiveGStore = create((set) => ({
  towers: {},
  users: {},
  selectedTower: "t1",
  beamProfiles: {},
  loading: false,
  setState: (data) => set(data),
  setBeamProfile: (towerId, profile) =>
    set((s) => ({ beamProfiles: { ...s.beamProfiles, [towerId]: profile } })),
  setLoading: (v) => set({ loading: v }),
}));

// ─── Radar scenario store ─────────────────────────────────────────────────────
export const useRadarStore = create((set) => ({
  targets: [],
  current_angle: 0,
  beam_width: 5,
  scan_speed: 10,
  snr_db: 20,
  ppiData: null,
  scanReturn: null,
  scanning: false,
  setState: (data) => set(data),
  setPpiData: (data) => set({ ppiData: data }),
  setScanReturn: (data) => set({ scanReturn: data }),
  toggleScanning: () => set((s) => ({ scanning: !s.scanning })),
}));

// ─── Ultrasound scenario store ────────────────────────────────────────────────
export const useUltrasoundStore = create((set) => ({
  structures: [],
  probeX: 0,
  probeY: 0,
  probeAngle: 0,
  frequencyMhz: 5,
  amodeData: null,
  bmodeData: null,
  selectedStructure: null,
  mode: "amode",
  setState: (data) => set(data),
  setProbe: (x, y, angle) => set({ probeX: x, probeY: y, probeAngle: angle }),
  setAmodeData: (data) => set({ amodeData: data }),
  setBmodeData: (data) => set({ bmodeData: data }),
  setSelectedStructure: (s) => set({ selectedStructure: s }),
}));
