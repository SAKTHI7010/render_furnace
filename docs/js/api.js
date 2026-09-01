const BASE = window.SMARTMELT_API_URL || '';

async function apiFetch(path, {method='GET', body}={}) {
  const opts = {
    method,
    headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${path}: ${res.status} ${err}`);
  }
  return res.json();
}

export const api = {
  health: () => apiFetch('/api/health'),
  configs: () => apiFetch('/api/configs'),
  operatorStart: (body) => apiFetch('/api/operator/start', {method:'POST', body}),
  operatorInject: (body) => apiFetch('/api/operator/inject', {method:'POST', body}),
  operatorTap: (body) => apiFetch('/api/operator/tap', {method:'POST', body}),
  operatorAdditions: () => apiFetch('/api/operator/additions'),
  operatorAdvisories: (body) => apiFetch('/api/operator/advisories', {method:'POST', body}),
  trajectory: (body) => apiFetch('/api/trajectory', {method:'POST', body}),
  physics: (body) => apiFetch('/api/physics', {method:'POST', body}),
  ekf: (body) => apiFetch('/api/ekf', {method:'POST', body}),
  mlTrain: (body) => apiFetch('/api/ml/train', {method:'POST', body}),
  mlGenerate: (body) => apiFetch('/api/ml/generate', {method:'POST', body}),
  driftCached: (body) => apiFetch('/api/drift/cached', {method:'POST', body}),
  driftGenerate: (body) => apiFetch('/api/drift/generate', {method:'POST', body}),
  chargemixMaterials: () => apiFetch('/api/chargemix/materials'),
  chargemixOptimise: (body) => apiFetch('/api/chargemix/optimise', {method:'POST', body}),
  chargemixEvaluate: (body) => apiFetch('/api/chargemix/evaluate', {method:'POST', body}),
  economics: (body) => apiFetch('/api/economics', {method:'POST', body}),
  validation: (body) => apiFetch('/api/validation', {method:'POST', body}),
};
