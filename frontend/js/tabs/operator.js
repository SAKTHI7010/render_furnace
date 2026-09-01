import { api } from '../api.js';
import { state, currentSnap, setPlaySpeed, syncPlayback, operatorStatus, logHeat } from '../state.js';
import { kpi, showLoading, pill, advCard } from '../main.js';
import { FurnaceRenderer } from '../furnace.js';

let furnace = null;
let loopActive = false;
let loopTimer = null;
let uiTimer = null;

export function activate() {
    if (!furnace) {
        furnace = new FurnaceRenderer(document.getElementById('furnace-canvas'));
        
        document.getElementById('btn-start').addEventListener('click', onStart);
        document.getElementById('btn-tap').addEventListener('click', onTap);
        
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setPlaySpeed(parseInt(btn.dataset.speed));
            });
        });
        
        document.querySelectorAll('.quick-add').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('op-material').value = btn.dataset.mat;
                document.getElementById('op-mass').value = btn.dataset.mass;
                onAdd();
            });
        });
        
        document.getElementById('btn-add').addEventListener('click', onAdd);
        
        api.operatorAdditions().then(res => {
            const sel = document.getElementById('op-material');
            sel.innerHTML = '';
            res.materials.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                sel.appendChild(opt);
            });
        });
        
        ['op-charge', 'op-power', 'op-c', 'op-cu'].forEach(id => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(id + '-val');
            el.addEventListener('input', () => valEl.textContent = el.value);
        });
        
        if (!loopActive) {
            loopActive = true;
            uiTimer = setInterval(updateUI, 800);
            loopTimer = setInterval(loop, 400);
        }
    }
}

export function getHeatSpec() {
    return {
        plant: state.plant,
        charge_t: parseFloat(document.getElementById('op-charge').value),
        power_kW: parseFloat(document.getElementById('op-power').value),
        carbon_pct: parseFloat(document.getElementById('op-c').value),
        copper_pct: parseFloat(document.getElementById('op-cu').value)
    };
}

async function onStart() {
    try {
        showLoading(true);
        const spec = getHeatSpec();
        const res = await api.operatorStart(spec);
        
        state.sessionId = res.session_id;
        state.frames = res.frames;
        state.frameIdx = 0;
        state.running = true;
        state.tapped = false;
        state.complete = false;
        state.appliedAdds = [];
        state.addLog = [];
        state.heatLog = [];
        
        logHeat('Start heat', `${spec.charge_t} t, ${spec.power_kW} kW, C=${spec.carbon_pct}%, Cu=${spec.copper_pct}%`, 0);
        
        document.getElementById('btn-start').disabled = true;
        document.getElementById('btn-tap').disabled = false;
        document.getElementById('btn-add').disabled = false;
        
        setPlaySpeed(10);
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-speed="10"]').classList.add('active');
        
        document.getElementById('op-log').innerHTML = 'Heat started.\n';
        document.getElementById('op-end-text').textContent = '';
        document.getElementById('op-adv').innerHTML = '';
        
        // Initialize an empty Plotly chart in op-trend
        Plotly.newPlot('op-trend', [], {
            paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'#0f1418',
            margin:{l:30,r:30,t:10,b:20}, height:150,
            xaxis:{gridcolor:'#20262c', zeroline:false},
            yaxis:{gridcolor:'#20262c', zeroline:false},
        }, {responsive:true, displayModeBar:false});
        
    } catch (e) {
        alert(e.message);
    } finally {
        showLoading(false);
    }
}

async function onAdd() {
    if (!state.sessionId || state.tapped || state.complete) return;
    try {
        const mat = document.getElementById('op-material').value;
        const mass = parseFloat(document.getElementById('op-mass').value);
        
        showLoading(true);
        const res = await api.operatorInject({
            session_id: state.sessionId,
            frame_idx: state.frameIdx,
            material: mat,
            mass_kg: mass
        });
        
        state.frames = res.frames;
        state.appliedAdds.push({material: mat, mass_kg: mass, frame_idx: res.cut_idx});
        
        const simMin = state.frames[state.frameIdx].t_min;
        logHeat('Inject', `${mass}kg ${mat}`, simMin);
        
        const log = document.getElementById('op-log');
        log.innerHTML += `Added ${mass}kg ${mat} at min ${simMin.toFixed(1)}\n`;
        log.scrollTop = log.scrollHeight;
    } catch (e) {
        alert(e.message);
    } finally {
        showLoading(false);
    }
}

async function onTap() {
    if (!state.sessionId) return;
    try {
        showLoading(true);
        const res = await api.operatorTap({
            session_id: state.sessionId,
            frame_idx: state.frameIdx
        });
        
        state.tapped = true;
        state.speed = 0;
        document.getElementById('btn-tap').disabled = true;
        document.getElementById('btn-add').disabled = true;
        document.getElementById('btn-start').disabled = false;
        
        logHeat('Tap heat', `T=${res.T_bath_C.toFixed(0)}°C, C=${res.pct_C.toFixed(3)}%, SEC=${res.SEC_kWh_t.toFixed(0)} kWh/t`, res.tap_time_min);
        
        document.getElementById('op-end-text').textContent = `TAPPED at ${res.tap_time_min.toFixed(1)} min.\nT_bath = ${res.T_bath_C.toFixed(0)} °C\nC = ${res.pct_C.toFixed(3)} %\nSEC = ${res.SEC_kWh_t.toFixed(0)} kWh/t\nSlag FeO = ${res.slag_FeO_pct.toFixed(1)} %\nBasicity (B2) = ${res.B2.toFixed(2)}`;


        const log = document.getElementById('op-log');
        log.innerHTML += `Heat tapped.\n`;
        log.scrollTop = log.scrollHeight;
    } catch (e) {
        alert(e.message);
    } finally {
        showLoading(false);
    }
}

function loop() {
    if (!state.running) return;
    syncPlayback();
    
    const snap = currentSnap();
    if (!snap) return;
    
    const aim = state.configs[state.plant] ? state.configs[state.plant]["Tap aim (°C)"] : 1620;
    const sz = state.configs[state.plant] ? state.configs[state.plant]["Heat size (t)"] : 12;
    
    // Update Furnace
    if (furnace) {
        furnace.update(
            snap.melted_pct, snap.T_bath_C, snap.slag_total_kg, 
            snap.undissolved_kg, sz, aim
        );
        document.getElementById('furnace-temp').textContent = `${snap.T_bath_C.toFixed(0)} °C`;
    }
    
    // Update Live Plotly Trend
    const past = state.frames.slice(0, state.frameIdx + 1);
    if (past.length > 0 && document.getElementById('op-trend').querySelector('.js-plotly-plot')) {
        const t = past.map(f => f.t_min);
        const traces = [
            {x: t, y: past.map(f => f.T_bath_C), name: '°C', type: 'scatter', line: {color: '#ff6a34', width: 2}, yaxis: 'y1'},
            {x: t, y: past.map(f => f.pct_C), name: '% C', type: 'scatter', line: {color: '#33d17a', width: 2}, yaxis: 'y2'}
        ];
        Plotly.react('op-trend', traces, {
            paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'#0f1418',
            margin:{l:40,r:40,t:10,b:20}, height:150,
            xaxis:{gridcolor:'#20262c', zeroline:false},
            yaxis:{gridcolor:'#20262c', zeroline:false, side:'left'},
            yaxis2:{gridcolor:'#20262c', zeroline:false, side:'right', overlaying:'y', range:[0, Math.max(...past.map(f => f.pct_C)) * 1.5]},
            showlegend: false
        }, {responsive:true, displayModeBar:false});
    }
    
    // Update KPIs
    const kpiHtml = [
        kpi('BATH °C', snap.T_bath_C.toFixed(0)),
        kpi('CARBON %', snap.pct_C.toFixed(3)),
        kpi('MELTED %', snap.melted_pct.toFixed(1)),
        kpi('SEC KWH/T', snap.SEC_kWh_t.toFixed(0)),
        
        kpi('SLAG FEO %', snap.slag_FeO_pct.toFixed(1)),
        kpi('BASICITY B2', snap.B2.toFixed(2)),
        kpi('SILICON %', snap.pct_Si.toFixed(3)),
        kpi('MANGANESE %', snap.pct_Mn.toFixed(3)),
        
        kpi('POWER KW', snap.Q_useful_kW ? snap.Q_useful_kW.toFixed(0) : '—'),
        kpi('TOTAL KWH', snap.E_kWh.toFixed(0)),
        kpi('EXPECTED TAP °C', aim),
        kpi('ACTUAL TAP °C', state.tapped ? snap.T_bath_C.toFixed(0) : '—')
    ].join('');
    document.getElementById('op-kpi').innerHTML = kpiHtml;
    
    // Clock
    const totalS = snap.t_min * 60;
    const m = Math.floor(totalS / 60).toString().padStart(2, '0');
    const s = Math.floor(totalS % 60).toString().padStart(2, '0');
    document.getElementById('op-clock').textContent = `${m}:${s}`;
    
    // Pills
    const st = operatorStatus(snap, aim);
    document.getElementById('op-status-pill').innerHTML = pill(st.text, st.kind);
}

let lastAdvisories = [];

async function updateUI() {
    if (!state.running || state.tapped) return;
    
    // Refresh advisories every ~2 seconds
    if (Math.random() < 0.4) {
        try {
            const res = await api.operatorAdvisories({
                session_id: state.sessionId,
                frame_idx: state.frameIdx
            });
            const html = res.advisories.map(a => advCard(a[0], a[1], a[2])).join('');
            document.getElementById('op-adv').innerHTML = html;
            
            // Log new advisories
            res.advisories.forEach(a => {
                const key = a[1] + a[2];
                if (!lastAdvisories.includes(key) && a[0] !== 'ok') {
                    lastAdvisories.push(key);
                    const simMin = state.frames[state.frameIdx].t_min;
                    logHeat(`Advisory (${a[0]})`, `${a[1]}: ${a[2]}`, simMin);
                }
            });
            if (lastAdvisories.length > 20) lastAdvisories = lastAdvisories.slice(-20);
        } catch (e) {}
    }
}
