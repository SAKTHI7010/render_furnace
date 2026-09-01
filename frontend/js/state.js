export const state = {
  plant: 'if_msme_12t',
  plants: [],
  configs: {},
  // Operator console
  sessionId: null,
  frames: [],
  frameIdx: 0,
  running: false,
  tapped: false,
  complete: false,
  speed: 10,
  chargeT: 12.0,
  powerKW: 5200,
  carbonPct: 0.30,
  copperPct: 0.20,
  appliedAdds: [],
  addLog: [],
  heatLog: [],
  playAnchorWall: 0,
  playAnchorFrame: 0,
  endText: '',
  // Tab results
  trajResult: null,
  physicsResult: null,
  ekfResult: null,
  mlResult: null,
  driftResult: null,
  mixResult: null,
  economicsResult: null,
  validationResult: null,
  // Settings
  settings: {},
};

export function framesPerTick(speed) {
  return {0:0, 1:1, 10:6, 60:30}[speed] ?? 6;
}

export function syncPlayback() {
  if (!state.frames.length || !state.running || state.tapped || state.complete || state.speed === 0) return;
  const now = Date.now() / 1000;
  const ticks = Math.max(0, Math.floor((now - state.playAnchorWall) / 0.080));
  const i = Math.min(state.playAnchorFrame + ticks * framesPerTick(state.speed), state.frames.length - 1);
  state.frameIdx = i;
  if (i >= state.frames.length - 1) state.complete = true;
  return i;
}

export function setPlaySpeed(s) {
  syncPlayback();
  state.speed = s;
  state.playAnchorFrame = state.frameIdx;
  state.playAnchorWall = Date.now() / 1000;
}

export function logHeat(event, detail = '', sim_min = null) {
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  state.heatLog.push({clock, sim_min: sim_min !== null ? parseFloat(sim_min).toFixed(1) : '', event, detail});
}

export function currentSnap() {
  if (!state.frames.length) return null;
  const i = Math.max(0, Math.min(state.frameIdx, state.frames.length - 1));
  return state.frames[i];
}

export function operatorStatus(snap, aim) {
  if (!snap) return {text: 'press START HEAT', kind: 'warn'};
  if (state.tapped) {
    const hit = Math.abs(snap.T_bath_C - aim) <= 15;
    return {text: 'TAPPED — ' + (hit ? 'on aim' : `${(snap.T_bath_C - aim).toFixed(0)}°C off aim`), kind: hit ? 'ok' : 'warn'};
  }
  if (state.complete) return {text: 'heat complete — press TAP HEAT', kind: 'ok'};
  if (snap.melted_pct > 99 && snap.T_bath_C >= aim - 5) return {text: 'READY TO TAP — on temperature & fully melted', kind: 'ok'};
  if (snap.melted_pct < 2) return {text: 'heating solid charge', kind: 'warn'};
  return {text: `melting — ${(aim - snap.T_bath_C).toFixed(0)} °C below tap aim`, kind: 'warn'};
}
