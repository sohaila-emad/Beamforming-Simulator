// API utility — all backend calls in one place
const BASE = process.env.REACT_APP_API_URL || "http://localhost:5000/api";

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}${path}${qs ? "?" + qs : ""}`);
  return r.json();
}

export const api = {
  // Core beamforming
  beamPattern: (params) => post("/beam/pattern", params),
  interferenceMap: (params) => post("/beam/interference", params),
  antennaPositions: (params) => post("/beam/positions", params),
  getScenarios: () => get("/beam/scenarios"),

  // 5G
  fivegState: () => get("/5g/state"),
  fivegMoveUser: (user_id, x, y) => post("/5g/user/move", { user_id, x, y }),
  fivegTowerBeam: (tower_id) => get("/5g/tower/beam", { tower_id }),
  fivegUpdateTower: (data) => post("/5g/tower/update", data),
  fivegReset: () => post("/5g/reset", {}),

  // Ultrasound
  phantomStructures: () => get("/ultrasound/phantom"),
  amodeScam: (data) => post("/ultrasound/amode", data),
  bmodeScam: (data) => post("/ultrasound/bmode", data),
  updateStructure: (id, updates) => post("/ultrasound/structure/update", { id, updates }),

  // Radar
  radarState: () => get("/radar/state"),
  radarScan: (angle) => post("/radar/scan", { angle }),
  radarPPI: () => get("/radar/ppi"),
  addTarget: (data) => post("/radar/target/add", data),
  updateTarget: (data) => post("/radar/target/update", data),
  removeTarget: (id) => post("/radar/target/remove", { id }),
  radarSettings: (data) => post("/radar/settings", data),
};
