/* =============================================================================
  Instrument Tracker — app.js (PRO, aligned with current index.html)
  - Dashboard + Next picker + Log + History filters + Instruments manager
  - Compatible con DB vieja (migra y no rompe)
  - PWA wiring desde pwa.js
============================================================================= */

'use strict';

import { STORAGE_KEY, INSTRUMENTS, DEFAULT_SETTINGS, DEFAULT_INSTRUMENT_STATE } from './config.js';
import { setupInstallPrompt, registerServiceWorker } from './pwa.js';

const deepClone = (typeof structuredClone === 'function')
  ? structuredClone
  : (obj) => JSON.parse(JSON.stringify(obj));

/* =========================
   DOM Helpers
========================= */

const $  = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function clamp(n, a, b){
  n = Number(n);
  if(Number.isNaN(n)) n = a;
  return Math.max(a, Math.min(b, n));
}
function todayISO(){
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}
function toISO(dt){ return new Date(dt).toISOString(); }
function daysSince(iso){
  if(!iso) return 999;
  const a = new Date(iso);
  const b = new Date();
  return Math.floor((b - a) / (1000*60*60*24));
}
function fmtMinutes(min){
  min = Number(min||0);
  if(min < 60) return `${min} min`;
  const h = Math.floor(min/60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function safeInt(v){ return Number.parseInt(String(v ?? '0'), 10) || 0; }

/* rolling windows */
function startOfWindow(days){
  const x = new Date();
  x.setHours(0,0,0,0);
  x.setDate(x.getDate() - (days-1));
  return x;
}

/* =========================
   Storage / DB
========================= */

function resetDB(){
  const db = {
    version: 2,
    createdAt: toISO(Date.now()),
    settings: deepClone(DEFAULT_SETTINGS),
    instruments: {},
    sessions: [],
    ui: {
      lastPickId: null,
      lastPickedAt: null
    }
  };
  INSTRUMENTS.forEach(i => { db.instruments[i.id] = DEFAULT_INSTRUMENT_STATE(); });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  return db;
}

function normalizeDB(db){
  // Base shape
  db = db && typeof db === 'object' ? db : {};
  db.version = db.version || 1;

  // Settings
  db.settings = db.settings || deepClone(DEFAULT_SETTINGS);
  db.settings.weights = db.settings.weights || deepClone(DEFAULT_SETTINGS.weights);
  db.settings.avoidRepeat = (db.settings.avoidRepeat !== false);
  db.settings.showConfetti = (db.settings.showConfetti !== false);

  // Data
  db.instruments = db.instruments || {};
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.ui = db.ui || { lastPickId:null, lastPickedAt:null };

  // Ensure instruments states exist
  INSTRUMENTS.forEach(i => {
    if(!db.instruments[i.id]) db.instruments[i.id] = DEFAULT_INSTRUMENT_STATE();
    db.instruments[i.id] = { ...DEFAULT_INSTRUMENT_STATE(), ...db.instruments[i.id] };
  });

  // Ensure weights for all instruments, clamp to 0..5 (stored scale)
  INSTRUMENTS.forEach(i => {
    const cur = db.settings.weights[i.id];
    if(typeof cur !== 'number') db.settings.weights[i.id] = DEFAULT_SETTINGS.weights[i.id] ?? 2;
    db.settings.weights[i.id] = clamp(db.settings.weights[i.id], 0, 5);
  });

  // Sanitize sessions: accept old + new schema
  db.sessions = db.sessions
    .filter(s => s && s.instrumentId && (s.at || s.date))
    .map(s => {
      const at = s.at || (s.date ? toISO(new Date(s.date + 'T12:00:00')) : toISO(Date.now()));
      const date = s.date || String(at).slice(0,10) || todayISO();
      return {
        id: s.id || uid(),
        at,
        date,
        who: String(s.who || 'Alek'),
        instrumentId: String(s.instrumentId),
        minutesTotal: Number(s.minutesTotal || 0),
        mood: clamp(s.mood ?? 4, 1, 5),
        difficulty: String(s.difficulty || 'easy'),
        tech: { minutes: Number(s.tech?.minutes || 0), notes: String(s.tech?.notes || '') },
        theory: { minutes: Number(s.theory?.minutes || 0), notes: String(s.theory?.notes || '') },
        rep: { minutes: Number(s.rep?.minutes || 0), notes: String(s.rep?.notes || '') },
        tags: Array.isArray(s.tags) ? s.tags.slice(0, 20) : [],
      };
    })
    // newest first
    .sort((a,b) => new Date(b.at) - new Date(a.at));

  return db;
}

function loadDB(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) throw new Error('empty');
    return normalizeDB(JSON.parse(raw));
  }catch(_){
    return resetDB();
  }
}
function saveDB(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
}

let DB = loadDB();

/* =========================
   UI: Toast + Confetti
========================= */

let toastTimer = null;

function toast(msg, hint=''){
  const t = $('#toast');
  if(!t) return;

  // Ensure structure exists
  if(!t.dataset.ready){
    t.innerHTML = `
      <div class="toast__row">
        <div class="toast__msg"></div>
        <div class="toast__hint"></div>
      </div>
    `;
    t.dataset.ready = '1';
  }

  const a = $('.toast__msg', t);
  const b = $('.toast__hint', t);
  if(a) a.textContent = msg || '';
  if(b) b.textContent = hint || '';

  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2800);
}

function confettiBurst(){
  if(!DB.settings.showConfetti) return;
  const wrap = $('#confetti');
  if(!wrap) return;

  wrap.innerHTML = '';
  const n = 18;
  const w = window.innerWidth;
  const x0 = w * 0.5;

  for(let i=0;i<n;i++){
    const p = document.createElement('i');
    const x = x0 + (Math.random()*240 - 120);
    const y = 10 + Math.random()*10;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.animationDelay = `${Math.random()*120}ms`;
    p.style.width = `${8 + Math.random()*6}px`;
    p.style.height = `${10 + Math.random()*10}px`;
    wrap.appendChild(p);
    setTimeout(() => p.remove(), 1100);
  }
}

/* =========================
   Navigation (tabs + goto)
========================= */

function setActiveView(view){
  // view ids are: view-home, view-next, view-log, view-history, view-instruments
  const id = `view-${view}`;
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === id));

  // little UX: reset scroll
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindNav(){
  $$('.tab').forEach(b => b.addEventListener('click', () => setActiveView(b.dataset.view)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => setActiveView(b.dataset.goto)));
}

/* =========================
   Core calculations / caches
========================= */

function computeCaches(){
  const w7  = startOfWindow(7);
  const w30 = startOfWindow(30);

  const per = {};
  INSTRUMENTS.forEach(i => per[i.id] = { m7:0, m30:0, last:null });

  for(const s of DB.sessions){
    const dt = new Date(s.at);
    const id = s.instrumentId;
    const total = Number(s.minutesTotal || 0);
    if(!per[id]) continue;

    if(dt >= w7)  per[id].m7 += total;
    if(dt >= w30) per[id].m30 += total;

    if(!per[id].last || new Date(per[id].last) < dt) per[id].last = s.at;
  }

  INSTRUMENTS.forEach(i => {
    const st = DB.instruments[i.id];
    st.minutesWeek = per[i.id].m7;
    st.minutesMonth = per[i.id].m30;
    st.lastStudiedAt = per[i.id].last || st.lastStudiedAt || null;
  });

  saveDB();
}

function componentTotals(days=30){
  const from = startOfWindow(days);
  const out = { tech:0, theory:0, rep:0 };
  for(const s of DB.sessions){
    const dt = new Date(s.at);
    if(dt < from) continue;
    out.tech += Number(s.tech?.minutes || 0);
    out.theory += Number(s.theory?.minutes || 0);
    out.rep += Number(s.rep?.minutes || 0);
  }
  return out;
}

function totalMinutes(days=30){
  const from = startOfWindow(days);
  let sum = 0;
  for(const s of DB.sessions){
    const dt = new Date(s.at);
    if(dt < from) continue;
    sum += Number(s.minutesTotal || 0);
  }
  return sum;
}

function totalSessions(days=30){
  const from = startOfWindow(days);
  let c = 0;
  for(const s of DB.sessions){
    if(new Date(s.at) >= from) c++;
  }
  return c;
}

function calcStreakDays(){
  // streak by calendar date with any session
  const dates = new Set(DB.sessions.map(s => s.date));
  let streak = 0;

  // Start from today and count backwards as long as dates exist
  const d = new Date();
  for(;;){
    const iso = (function(){
      const x = new Date(d);
      x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
      return x.toISOString().slice(0,10);
    })();

    if(!dates.has(iso)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function instrumentMeta(id){
  return INSTRUMENTS.find(i => i.id === id);
}

function weightToMultiplier(w0to5){
  // stored weight 0..5, display multiplier ~0.7..1.5
  const w = clamp(w0to5, 0, 5);
  const mult = 0.7 + (w * 0.16);
  return Math.round(mult * 10) / 10; // 1 decimal
}

/* =========================
   Picker: "¿Qué sigue?"
========================= */

function scoreInstrument(id){
  const st = DB.instruments[id];
  if(!st || st.archived) return -Infinity;
  if(!st.available) return -Infinity;

  const w = clamp(DB.settings.weights[id] ?? 2, 0, 5);
  const mult = 0.7 + (w * 0.16);

  const d = daysSince(st.lastStudiedAt);
  const m30 = Number(st.minutesMonth || 0);

  // Rules (per UI):
  // - More days since last -> more priority
  // - Less minutes in 30d -> more priority
  // - Manual priority multiplier
  let score =
    (d * 5) +
    (Math.max(0, 240 - m30) * 0.10);

  score *= mult;

  if(DB.settings.avoidRepeat && DB.ui.lastPickId === id) score -= 18;

  score += (Math.random() * 2.5); // controlled variety

  return score;
}

function pickNext({ avoidLast=true } = {}){
  const candidates = INSTRUMENTS
    .map(i => i.id)
    .filter(id => DB.instruments[id]?.available && !DB.instruments[id]?.archived);

  if(!candidates.length) return null;

  let bestId = null;
  let bestScore = -Infinity;

  for(const id of candidates){
    let sc = scoreInstrument(id);
    if(avoidLast && DB.ui.lastPickId && id === DB.ui.lastPickId) sc -= 10; // even more variety
    if(sc > bestScore){
      bestScore = sc;
      bestId = id;
    }
  }

  if(!bestId) bestId = candidates[0];

  DB.ui.lastPickId = bestId;
  DB.ui.lastPickedAt = toISO(Date.now());
  saveDB();
  return bestId;
}

/* =========================
   Sessions CRUD
========================= */

function addSession(payload){
  const s = {
    id: uid(),
    at: payload.at || toISO(Date.now()),
    date: payload.date || todayISO(),
    who: String(payload.who || 'Alek'),
    instrumentId: String(payload.instrumentId),
    minutesTotal: Number(payload.minutesTotal || 0),
    mood: clamp(Number(payload.mood ?? 4), 1, 5),
    difficulty: String(payload.difficulty || 'easy'),
    tech: { minutes: Number(payload.techMinutes || 0), notes: String(payload.techNotes || '').trim() },
    theory: { minutes: Number(payload.theoryMinutes || 0), notes: String(payload.theoryNotes || '').trim() },
    rep: { minutes: Number(payload.repMinutes || 0), notes: String(payload.repNotes || '').trim() },
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0,20) : [],
  };

  // Auto total if missing
  if(!s.minutesTotal){
    s.minutesTotal = s.tech.minutes + s.theory.minutes + s.rep.minutes;
  }

  if(!s.instrumentId) throw new Error('instrumentId missing');
  if(s.minutesTotal <= 0) throw new Error('minutes must be > 0');

  DB.sessions.unshift(s);

  const st = DB.instruments[s.instrumentId];
  if(st) st.lastStudiedAt = s.at;

  computeCaches();
  DB.sessions.sort((a,b) => new Date(b.at) - new Date(a.at));
  saveDB();
  return s;
}

function deleteSession(id){
  const idx = DB.sessions.findIndex(x => x.id === id);
  if(idx >= 0){
    DB.sessions.splice(idx, 1);
    computeCaches();
    saveDB();
    return true;
  }
  return false;
}

function clearAllSessions(){
  DB.sessions = [];
  INSTRUMENTS.forEach(i => {
    DB.instruments[i.id].lastStudiedAt = null;
    DB.instruments[i.id].minutesWeek = 0;
    DB.instruments[i.id].minutesMonth = 0;
  });
  DB.ui.lastPickId = null;
  DB.ui.lastPickedAt = null;
  computeCaches();
  saveDB();
}

/* =========================
   Render: Dashboard
========================= */

function renderDashboard(){
  computeCaches();

  const m30 = totalMinutes(30);
  const s30 = totalSessions(30);
  const m7  = totalMinutes(7);
  const s7  = totalSessions(7);
  const streak = calcStreakDays();

  const kpi30 = $('#kpi30');
  const kpi30Meta = $('#kpi30Meta');
  const kpi7 = $('#kpi7');
  const kpi7Meta = $('#kpi7Meta');
  const kpiStreak = $('#kpiStreak');
  const kpiStreakMeta = $('#kpiStreakMeta');
  const kpiForgot = $('#kpiForgot');

  if(kpi30) kpi30.textContent = fmtMinutes(m30);
  if(kpi30Meta) kpi30Meta.textContent = `${s30} sesión(es)`;
  if(kpi7) kpi7.textContent = fmtMinutes(m7);
  if(kpi7Meta) kpi7Meta.textContent = `${s7} sesión(es)`;
  if(kpiStreak) kpiStreak.textContent = `${streak} día(s)`;
  if(kpiStreakMeta) kpiStreakMeta.textContent = streak ? 'Sosteniendo el hábito' : 'Arranquen hoy con 10 min';

  // Most forgotten (max days since)
  let maxD = -1, maxId = null;
  for(const i of INSTRUMENTS){
    const st = DB.instruments[i.id];
    if(st.archived) continue;
    const d = daysSince(st.lastStudiedAt);
    if(d > maxD){ maxD = d; maxId = i.id; }
  }
  if(kpiForgot){
    const meta = instrumentMeta(maxId);
    kpiForgot.textContent = meta ? `${meta.icon} ${meta.name} · ${maxD}d` : '—';
  }

  // Component distribution (30d)
  const bars = $('#compBars');
  if(bars){
    const comps = componentTotals(30);
    const sum = comps.tech + comps.theory + comps.rep || 1;
    const pTech = Math.round((comps.tech/sum) * 100);
    const pTheo = Math.round((comps.theory/sum) * 100);
    const pRep  = 100 - pTech - pTheo;

    bars.innerHTML = `
      <div class="progress" title="Técnico ${pTech}%"><i style="--w:${pTech}%"></i></div>
      <div class="progress" title="Teórico ${pTheo}%"><i style="--w:${pTheo}%"></i></div>
      <div class="progress" title="Repertorio ${pRep}%"><i style="--w:${pRep}%"></i></div>
    `;
  }

  // Top instruments (30d)
  const topRank = $('#topRank');
  if(topRank){
    // compute minutes per instrument in 30d
    const from = startOfWindow(30);
    const m = {};
    INSTRUMENTS.forEach(i => m[i.id] = 0);
    for(const s of DB.sessions){
      if(new Date(s.at) < from) continue;
      m[s.instrumentId] = (m[s.instrumentId] || 0) + Number(s.minutesTotal || 0);
    }

    const top = INSTRUMENTS
      .map(i => ({ id:i.id, minutes: m[i.id] || 0, meta:i }))
      .filter(x => !DB.instruments[x.id]?.archived)
      .sort((a,b) => b.minutes - a.minutes)
      .slice(0, 5);

    if(!top.length || top.every(x => x.minutes === 0)){
      topRank.innerHTML = `<div class="muted" style="padding:8px 0;">Aún no hay un “top”. Estudien para que exista.</div>`;
    }else{
      topRank.innerHTML = top.map((x, idx) => `
        <div class="rank__row">
          <div class="rank__left">
            <span class="rank__num">${idx+1}</span>
            <span class="rank__badge" style="background: linear-gradient(135deg, ${x.meta.color}, var(--p6));">${esc(x.meta.icon)}</span>
            <span class="rank__name">${esc(x.meta.name)}</span>
          </div>
          <div class="rank__right">${fmtMinutes(x.minutes)}</div>
        </div>
      `).join('');
    }
  }

  // Availability chips
  renderAvailChips();
}

/* =========================
   Render: Availability chips
========================= */

function renderAvailChips(){
  const wrap = $('#availChips');
  if(!wrap) return;

  const html = INSTRUMENTS
    .filter(i => !DB.instruments[i.id]?.archived)
    .map(i => {
      const st = DB.instruments[i.id];
      const on = !!st.available;
      return `
        <button class="chip ${on ? 'is-on' : ''}" type="button" data-avail="${esc(i.id)}" title="Toggle disponible">
          <span class="chip__dot" aria-hidden="true"></span>
          <span class="chip__icon" aria-hidden="true">${esc(i.icon)}</span>
          <span class="chip__label">${esc(i.name)}</span>
        </button>
      `;
    }).join('');

  wrap.innerHTML = html || `<div class="muted">No hay instrumentos activos.</div>`;

  $$('[data-avail]', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-avail');
      DB.instruments[id].available = !DB.instruments[id].available;
      saveDB();
      renderAvailChips();
      renderNextCard(null); // if availability changed, next suggestion may change
    });
  });

  const toggleAll = $('#toggleAllAvailBtn');
  if(toggleAll && !toggleAll.dataset.bound){
    toggleAll.dataset.bound = '1';
    toggleAll.addEventListener('click', () => {
      INSTRUMENTS.forEach(i => {
        if(DB.instruments[i.id]?.archived) return;
        DB.instruments[i.id].available = true;
      });
      saveDB();
      renderAvailChips();
      toast('Listo', 'Todos quedaron “a la mano” ✅');
    });
  }
}

/* =========================
   Render: Next picker
========================= */

let NEXT_SELECTED_ID = null;

function renderNextCard(chosenId=null){
  const box = $('#nextResult');
  if(!box) return;

  const btnLog = $('#logFromNextBtn');
  const btnTimer = $('#startTimerBtn');

  if(!chosenId){
    NEXT_SELECTED_ID = null;
    box.innerHTML = `
      <div class="next-card__placeholder">
        Presiona <b>Elegir ahora</b> y te digo qué estudiar sin sabotearte 😌
      </div>
    `;
    if(btnLog) btnLog.disabled = true;
    if(btnTimer) btnTimer.disabled = true;
    return;
  }

  NEXT_SELECTED_ID = chosenId;
  const meta = instrumentMeta(chosenId);
  const st = DB.instruments[chosenId];
  const d = daysSince(st.lastStudiedAt);
  const w = clamp(DB.settings.weights[chosenId] ?? 2, 0, 5);
  const mult = weightToMultiplier(w);

  box.innerHTML = `
    <div class="item" style="margin:0;">
      <div class="item__left" style="min-width:0">
        <div class="badge" style="background: linear-gradient(135deg, ${meta?.color || 'var(--p2)'}, var(--p6));">
          ${esc(meta?.icon || '🎵')}
        </div>
        <div style="min-width:0">
          <div class="item__title">${esc(meta?.name || '—')}</div>
          <div class="item__sub">
            Última vez: ${st.lastStudiedAt ? `${d} día(s) atrás` : 'nunca'} ·
            30 días: ${fmtMinutes(st.minutesMonth||0)} ·
            Prioridad: ${mult}x
          </div>
          ${st.condition ? `<div class="item__sub">⚠️ ${esc(st.condition)}</div>` : ''}
        </div>
      </div>
      <div class="item__right">
        <span class="btn__pill">Sugerido</span>
      </div>
    </div>
  `;

  if(btnLog) btnLog.disabled = false;
  if(btnTimer) btnTimer.disabled = false;
}

function bindNext(){
  const pickBtn = $('#pickNextBtn');
  const altBtn = $('#pickAltBtn');
  const quickHome = $('#quickNextBtn');
  const logFrom = $('#logFromNextBtn');
  const startTimer = $('#startTimerBtn');

  if(pickBtn && !pickBtn.dataset.bound){
    pickBtn.dataset.bound = '1';
    pickBtn.addEventListener('click', () => {
      const id = pickNext({ avoidLast:false });
      if(!id){
        toast('Nada disponible', 'Marca algo “a la mano” primero.');
        renderNextCard(null);
        return;
      }
      renderNextCard(id);
      toast('Siguiente recomendado', `${instrumentMeta(id)?.name || id}`);
    });
  }

  if(altBtn && !altBtn.dataset.bound){
    altBtn.dataset.bound = '1';
    altBtn.addEventListener('click', () => {
      const id = pickNext({ avoidLast:true });
      if(!id){
        toast('Nada disponible', 'Marca algo “a la mano” primero.');
        renderNextCard(null);
        return;
      }
      renderNextCard(id);
      toast('Otra opción', `${instrumentMeta(id)?.name || id}`);
    });
  }

  // Home quick button jumps to Next and picks
  if(quickHome && !quickHome.dataset.bound){
    quickHome.dataset.bound = '1';
    quickHome.addEventListener('click', () => {
      setActiveView('next');
      const id = pickNext({ avoidLast:false });
      if(!id){
        toast('Nada disponible', 'Marca algo “a la mano” primero.');
        renderNextCard(null);
        return;
      }
      renderNextCard(id);
      toast('Recomendación lista', `${instrumentMeta(id)?.name || id}`);
    });
  }

  // From Next: prefill log form
  if(logFrom && !logFrom.dataset.bound){
    logFrom.dataset.bound = '1';
    logFrom.addEventListener('click', () => {
      if(!NEXT_SELECTED_ID) return;
      setActiveView('log');
      prefillLog({ instrumentId: NEXT_SELECTED_ID });
      toast('Listo', 'Registrar sesión con ese instrumento ✅');
    });
  }

  // From Next: start timer + go log
  if(startTimer && !startTimer.dataset.bound){
    startTimer.dataset.bound = '1';
    startTimer.addEventListener('click', () => {
      if(!NEXT_SELECTED_ID) return;
      setActiveView('log');
      prefillLog({ instrumentId: NEXT_SELECTED_ID });
      timerStart(); // start immediately
      toast('Cronómetro', 'Corriendo. Tú solo estudia.');
    });
  }
}

/* =========================
   Log form + Timer
========================= */

function fillInstrumentSelects(){
  const sel = $('#instrumentSelect');
  const filter = $('#filterInstrument');

  const options = INSTRUMENTS
    .filter(i => !DB.instruments[i.id]?.archived)
    .map(i => `<option value="${esc(i.id)}">${esc(i.icon)} ${esc(i.name)}</option>`)
    .join('');

  if(sel){
    sel.innerHTML = options;
  }

  if(filter){
    filter.innerHTML = `<option value="all">Todos</option>` + options;
  }
}

function prefillLog({ instrumentId=null } = {}){
  const who = $('#who');
  const inst = $('#instrumentSelect');
  const date = $('#date');
  const total = $('#totalMin');

  if(date) date.value = todayISO();
  if(inst && instrumentId) inst.value = instrumentId;

  // leave who as is
  if(total && (!total.value || safeInt(total.value) <= 0)) total.value = 20;

  // Default split (nice habit)
  const t = $('#techMin'); const th = $('#theoryMin'); const r = $('#repMin');
  if(t && th && r){
    const tot = safeInt(total?.value || 20) || 20;
    // 50/25/25
    t.value = Math.round(tot * 0.5);
    th.value = Math.round(tot * 0.25);
    r.value = Math.max(0, tot - safeInt(t.value) - safeInt(th.value));
  }

  // Clear notes/tags
  ['techNotes','theoryNotes','repNotes','tags'].forEach(id => {
    const el = $('#' + id);
    if(el) el.value = '';
  });

  // Mood UI
  const mood = $('#mood');
  const moodPill = $('#moodPill');
  if(mood && moodPill) moodPill.textContent = String(mood.value || 4);
}

function readDifficulty(){
  // radios: diffEasy/diffOk/diffHard
  const r = $('input[name="diff"]:checked');
  return r ? r.value : 'easy';
}

function bindLog(){
  const form = $('#logForm');
  const resetBtn = $('#resetFormBtn');
  const mood = $('#mood');
  const moodPill = $('#moodPill');

  if(mood && moodPill && !mood.dataset.bound){
    mood.dataset.bound = '1';
    mood.addEventListener('input', () => { moodPill.textContent = String(mood.value); });
  }

  if(resetBtn && !resetBtn.dataset.bound){
    resetBtn.dataset.bound = '1';
    resetBtn.addEventListener('click', () => {
      prefillLog({ instrumentId: $('#instrumentSelect')?.value || null });
      toast('Limpio', 'Formulario reseteado sin drama.');
    });
  }

  if(form && !form.dataset.bound){
    form.dataset.bound = '1';
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      try{
        const who = $('#who')?.value || 'Alek';
        const instrumentId = $('#instrumentSelect')?.value;
        const date = $('#date')?.value || todayISO();

        const minutesTotal = safeInt($('#totalMin')?.value);
        const techMinutes = safeInt($('#techMin')?.value);
        const theoryMinutes = safeInt($('#theoryMin')?.value);
        const repMinutes = safeInt($('#repMin')?.value);

        const mood = safeInt($('#mood')?.value || 4);
        const difficulty = readDifficulty();

        const techNotes = $('#techNotes')?.value || '';
        const theoryNotes = $('#theoryNotes')?.value || '';
        const repNotes = $('#repNotes')?.value || '';

        const tagsRaw = ($('#tags')?.value || '').trim();
        const tags = tagsRaw
          ? tagsRaw.split(',').map(x => x.trim()).filter(Boolean).slice(0, 20)
          : [];

        // “at” real: date + current time (so sorting feels right)
        const now = new Date();
        const at = new Date(date + 'T' + String(now.toTimeString()).slice(0,8));

        addSession({
          who,
          instrumentId,
          date,
          at: toISO(at),
          minutesTotal,
          mood,
          difficulty,
          techMinutes, theoryMinutes, repMinutes,
          techNotes, theoryNotes, repNotes,
          tags
        });

        confettiBurst();
        toast('Sesión guardada', 'Menos procrastinación, más poder 😌🎶');

        // Update views
        renderAll();

        // keep in log view, but gently reset for next entry
        prefillLog({ instrumentId });

      }catch(err){
        toast('No se pudo guardar', String(err?.message || err));
      }
    });
  }
}

/* ---- Timer ---- */

let TIMER = {
  running: false,
  startedAt: null,
  elapsedMs: 0,
  raf: null
};

function fmtClock(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function timerTick(){
  const clock = $('#timerClock');
  const status = $('#timerStatus');
  if(!TIMER.running) return;

  const now = performance.now();
  const ms = TIMER.elapsedMs + (now - TIMER.startedAt);
  if(clock) clock.textContent = fmtClock(ms);
  if(status) status.textContent = 'Corriendo…';

  TIMER.raf = requestAnimationFrame(timerTick);
}

function timerStart(){
  if(TIMER.running) return;
  TIMER.running = true;
  TIMER.startedAt = performance.now();
  TIMER.raf = requestAnimationFrame(timerTick);

  const b1 = $('#timerStart');
  const b2 = $('#timerStop');
  const b3 = $('#timerApply');
  if(b1) b1.disabled = true;
  if(b2) b2.disabled = false;
  if(b3) b3.disabled = true;

  const status = $('#timerStatus');
  if(status) status.textContent = 'Corriendo…';
}

function timerStop(){
  if(!TIMER.running) return;
  TIMER.running = false;

  const now = performance.now();
  TIMER.elapsedMs += (now - TIMER.startedAt);
  TIMER.startedAt = null;

  if(TIMER.raf) cancelAnimationFrame(TIMER.raf);
  TIMER.raf = null;

  const b1 = $('#timerStart');
  const b2 = $('#timerStop');
  const b3 = $('#timerApply');
  if(b1) b1.disabled = false;
  if(b2) b2.disabled = true;
  if(b3) b3.disabled = false;

  const status = $('#timerStatus');
  if(status) status.textContent = 'Pausado. Puedes aplicar.';
}

function timerResetUI(){
  TIMER.running = false;
  TIMER.startedAt = null;
  TIMER.elapsedMs = 0;
  if(TIMER.raf) cancelAnimationFrame(TIMER.raf);
  TIMER.raf = null;

  const clock = $('#timerClock');
  const status = $('#timerStatus');
  if(clock) clock.textContent = '00:00';
  if(status) status.textContent = 'Listo.';

  const b1 = $('#timerStart');
  const b2 = $('#timerStop');
  const b3 = $('#timerApply');
  if(b1) b1.disabled = false;
  if(b2) b2.disabled = true;
  if(b3) b3.disabled = true;
}

function timerApply(){
  const minutes = Math.max(1, Math.round(TIMER.elapsedMs / 60000));
  const total = $('#totalMin');
  if(total){
    const cur = safeInt(total.value);
    total.value = String(cur > 0 ? cur + minutes : minutes);
  }
  toast('Aplicado', `Sumé ${minutes} min al total.`);
  timerResetUI();
}

function bindTimer(){
  const bStart = $('#timerStart');
  const bStop = $('#timerStop');
  const bApply = $('#timerApply');

  if(bStart && !bStart.dataset.bound){
    bStart.dataset.bound = '1';
    bStart.addEventListener('click', timerStart);
  }
  if(bStop && !bStop.dataset.bound){
    bStop.dataset.bound = '1';
    bStop.addEventListener('click', timerStop);
  }
  if(bApply && !bApply.dataset.bound){
    bApply.dataset.bound = '1';
    bApply.addEventListener('click', timerApply);
  }

  // initial state
  timerResetUI();
}

/* =========================
   History view: filters + list
========================= */

function bindHistory(){
  const clearAllBtn = $('#clearAllBtn');
  const resetFiltersBtn = $('#resetFiltersBtn');
  const search = $('#searchInput');
  const inst = $('#filterInstrument');
  const who = $('#filterWho');
  const range = $('#filterRange');

  function rerender(){ renderHistory(); }

  [search, inst, who, range].forEach(el => {
    if(!el) return;
    if(el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('input', rerender);
    el.addEventListener('change', rerender);
  });

  if(resetFiltersBtn && !resetFiltersBtn.dataset.bound){
    resetFiltersBtn.dataset.bound = '1';
    resetFiltersBtn.addEventListener('click', () => {
      if(search) search.value = '';
      if(inst) inst.value = 'all';
      if(who) who.value = 'all';
      if(range) range.value = '30';
      renderHistory();
      toast('Filtros limpios', 'Menos “dónde quedó”, más claridad.');
    });
  }

  if(clearAllBtn && !clearAllBtn.dataset.bound){
    clearAllBtn.dataset.bound = '1';
    clearAllBtn.addEventListener('click', () => {
      if(confirm('¿Borrar TODAS las sesiones? (no hay marcha atrás)')){
        clearAllSessions();
        renderAll();
        toast('Hecho', 'Historial borrado.');
      }
    });
  }
}

function renderHistory(){
  const list = $('#historyList');
  const empty = $('#historyEmpty');
  if(!list) return;

  const q = ($('#searchInput')?.value || '').trim().toLowerCase();
  const inst = $('#filterInstrument')?.value || 'all';
  const who = $('#filterWho')?.value || 'all';
  const days = Number($('#filterRange')?.value || 30);
  const from = startOfWindow(days);

  const filtered = DB.sessions.filter(s => {
    if(new Date(s.at) < from) return false;
    if(inst !== 'all' && s.instrumentId !== inst) return false;
    if(who !== 'all' && String(s.who) !== who) return false;

    if(!q) return true;

    const meta = instrumentMeta(s.instrumentId);
    const hay = [
      meta?.name, meta?.id,
      s.who,
      s.difficulty,
      (s.tags || []).join(','),
      s.tech?.notes, s.theory?.notes, s.rep?.notes
    ].join(' ').toLowerCase();

    return hay.includes(q);
  });

  if(!filtered.length){
    list.innerHTML = '';
    if(empty) empty.hidden = false;
    return;
  }
  if(empty) empty.hidden = true;

  list.innerHTML = filtered.slice(0, 200).map(s => {
    const meta = instrumentMeta(s.instrumentId);
    const dt = new Date(s.at);
    const when = dt.toLocaleString([], { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });

    const tech = Number(s.tech?.minutes||0);
    const theo = Number(s.theory?.minutes||0);
    const rep  = Number(s.rep?.minutes||0);

    const tags = (s.tags && s.tags.length)
      ? `<div class="tags">${s.tags.slice(0,8).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
      : '';

    const notesLine = [
      tech ? `🎯 ${tech}m` : '',
      theo ? `🧠 ${theo}m` : '',
      rep ? `🎵 ${rep}m` : '',
      `Mood ${'⭐'.repeat(s.mood||4)}`,
      s.difficulty ? `· ${esc(s.difficulty)}` : ''
    ].filter(Boolean).join(' · ');

    const extraNotes = [
      s.tech?.notes ? `🎯 ${esc(s.tech.notes)}` : '',
      s.theory?.notes ? `🧠 ${esc(s.theory.notes)}` : '',
      s.rep?.notes ? `🎵 ${esc(s.rep.notes)}` : '',
    ].filter(Boolean);

    return `
      <div class="item">
        <div class="item__left" style="min-width:0">
          <div class="badge" style="background: linear-gradient(135deg, ${meta?.color || 'var(--p2)'}, var(--p6));">
            ${esc(meta?.icon || '🎵')}
          </div>
          <div style="min-width:0">
            <div class="item__title">${esc(meta?.name || '—')} · ${fmtMinutes(s.minutesTotal)} <span class="muted small">· ${esc(s.who || '')}</span></div>
            <div class="item__sub">${esc(when)} · ${notesLine}</div>
            ${tags}
            ${extraNotes.length ? `<div class="item__sub" title="Notas">${extraNotes.join(' · ')}</div>` : ''}
          </div>
        </div>
        <div class="item__right">
          <button class="btn btn--ghost" type="button" data-del="${esc(s.id)}">
            <span class="btn__icon" aria-hidden="true">🗑️</span> Borrar
          </button>
        </div>
      </div>
    `;
  }).join('');

  $$('[data-del]', list).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del');
      if(confirm('¿Borrar esta sesión?')){
        deleteSession(id);
        renderAll();
        toast('Sesión eliminada', 'Ya fue. Next.');
      }
    });
  });
}

/* =========================
   Instruments view: list + settings
========================= */

function renderInstruments(){
  const wrap = $('#instrList');
  const summary = $('#instrSummary');
  if(!wrap) return;

  const activeCount = INSTRUMENTS.filter(i => !DB.instruments[i.id]?.archived).length;
  const availCount = INSTRUMENTS.filter(i => !DB.instruments[i.id]?.archived && DB.instruments[i.id]?.available).length;
  if(summary) summary.textContent = `${activeCount} activos · ${availCount} disponibles hoy`;

  const html = INSTRUMENTS.map(i => {
    const st = DB.instruments[i.id];
    const w = clamp(DB.settings.weights[i.id] ?? 2, 0, 5);
    const mult = weightToMultiplier(w);

    const last = st.lastStudiedAt ? `${daysSince(st.lastStudiedAt)}d` : '—';
    const availLabel = st.available ? 'Disponible' : 'No disponible';

    return `
      <div class="item ${st.archived ? 'is-archived' : ''}">
        <div class="item__left" style="min-width:0">
          <div class="badge" style="background: linear-gradient(135deg, ${i.color}, var(--p6));">
            ${esc(i.icon)}
          </div>
          <div style="min-width:0">
            <div class="item__title">${esc(i.name)} <span class="muted small">· ${esc(i.type)}</span></div>
            <div class="item__sub">${availLabel} · Última vez: ${last} · 30 días: ${fmtMinutes(st.minutesMonth||0)}</div>

            <div class="row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:8px;">
              <span class="toggle">
                <span class="muted small">A la mano</span>
                <span class="switch ${st.available ? 'is-on' : ''}" data-toggle="${esc(i.id)}" role="button" aria-label="toggle availability"></span>
              </span>

              <span class="muted small">Prioridad</span>
              <input class="select" data-weight="${esc(i.id)}" type="range" min="0" max="5" step="1" value="${w}" style="max-width:180px; padding:0; height:38px;">
              <span class="btn__pill" data-weightpill="${esc(i.id)}">${mult}x</span>

              <button class="btn btn--ghost" type="button" data-archive="${esc(i.id)}">
                <span class="btn__icon" aria-hidden="true">${st.archived ? '📦' : '🗄️'}</span>
                ${st.archived ? 'Activar' : 'Archivar'}
              </button>
            </div>

            <label class="field" style="margin-top:10px;">
              <span class="muted small">Condición</span>
              <input class="input" data-cond="${esc(i.id)}" placeholder="Ej: solo con audífonos / solo finde / etc." value="${esc(st.condition||'')}">
            </label>
          </div>
        </div>
      </div>
    `;
  }).join('');

  wrap.innerHTML = html;

  // Toggle availability
  $$('[data-toggle]', wrap).forEach(sw => {
    sw.addEventListener('click', () => {
      const id = sw.getAttribute('data-toggle');
      DB.instruments[id].available = !DB.instruments[id].available;
      saveDB();
      renderInstruments();
      renderAvailChips();
    });
  });

  // Weight slider
  $$('[data-weight]', wrap).forEach(r => {
    r.addEventListener('input', () => {
      const id = r.getAttribute('data-weight');
      const val = clamp(r.value, 0, 5);
      DB.settings.weights[id] = val;
      const pill = $(`[data-weightpill="${CSS.escape(id)}"]`, wrap);
      if(pill) pill.textContent = `${weightToMultiplier(val)}x`;
      saveDB();
    });
  });

  // Archive
  $$('[data-archive]', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-archive');
      DB.instruments[id].archived = !DB.instruments[id].archived;

      // If archived, also set unavailable (cleaner picker)
      if(DB.instruments[id].archived) DB.instruments[id].available = false;

      saveDB();
      fillInstrumentSelects();
      computeCaches();
      renderAll();
    });
  });

  // Condition input (debounced)
  let condTimer = null;
  $$('[data-cond]', wrap).forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.getAttribute('data-cond');
      clearTimeout(condTimer);
      condTimer = setTimeout(() => {
        DB.instruments[id].condition = String(inp.value || '').trim();
        saveDB();
      }, 250);
    });
  });

  // Settings toggles
  const toggleRepeat = $('#toggleRepeat');
  const toggleConfetti = $('#toggleConfetti');

  if(toggleRepeat && !toggleRepeat.dataset.bound){
    toggleRepeat.dataset.bound = '1';
    toggleRepeat.checked = !!DB.settings.avoidRepeat;
    toggleRepeat.addEventListener('change', () => {
      DB.settings.avoidRepeat = !!toggleRepeat.checked;
      saveDB();
      toast('Ajuste guardado', DB.settings.avoidRepeat ? 'Evita repetirse.' : 'Puede repetirse.');
    });
  }else if(toggleRepeat){
    toggleRepeat.checked = !!DB.settings.avoidRepeat;
  }

  if(toggleConfetti && !toggleConfetti.dataset.bound){
    toggleConfetti.dataset.bound = '1';
    toggleConfetti.checked = !!DB.settings.showConfetti;
    toggleConfetti.addEventListener('change', () => {
      DB.settings.showConfetti = !!toggleConfetti.checked;
      saveDB();
      toast('Ajuste guardado', DB.settings.showConfetti ? 'Confetti ON.' : 'Confetti OFF.');
    });
  }else if(toggleConfetti){
    toggleConfetti.checked = !!DB.settings.showConfetti;
  }
}

/* =========================
   Backup / Restore
========================= */

function downloadBackup(){
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `instrument-tracker-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast('Backup descargado', 'JSON listo.');
}

async function restoreBackup(file){
  const txt = await file.text();
  const db = normalizeDB(JSON.parse(txt));
  DB = db;
  saveDB();
  computeCaches();
  renderAll();
  toast('Restaurado', 'Tu backup volvió de la muerte.');
}

/* =========================
   Render all
========================= */

function renderAll(){
  fillInstrumentSelects();
  renderDashboard();
  renderNextCard(NEXT_SELECTED_ID); // keep if already chosen, but may be invalid now
  renderHistory();
  renderInstruments();
}

/* =========================
   Init
========================= */

function init(){
  // PWA
  setupInstallPrompt({ installBtnEl: $('#installBtn') });
  registerServiceWorker('./sw.js').catch(() => {});

  window.addEventListener('offline', () => toast('Offline', 'Sigue funcionando. Tu internet puede descansar.'));
  window.addEventListener('online',  () => toast('Online', 'Volvimos al mundo real.'));

  // Navigation
  bindNav();

  // Populate selects
  fillInstrumentSelects();

  // Next view
  bindNext();

  // Log + Timer
  prefillLog();
  bindLog();
  bindTimer();

  // History
  bindHistory();

  // Backup / Restore
  const backupBtn = $('#backupBtn');
  const restoreBtn = $('#restoreBtn');
  const restoreFile = $('#restoreFile');

  if(backupBtn && !backupBtn.dataset.bound){
    backupBtn.dataset.bound = '1';
    backupBtn.addEventListener('click', downloadBackup);
  }
  if(restoreBtn && restoreFile && !restoreBtn.dataset.bound){
    restoreBtn.dataset.bound = '1';
    restoreBtn.addEventListener('click', () => restoreFile.click());
    restoreFile.addEventListener('change', async () => {
      const f = restoreFile.files?.[0];
      if(!f) return;
      try{
        await restoreBackup(f);
      }catch(err){
        toast('Restore falló', 'Ese JSON está raro o corrupto.');
      }finally{
        restoreFile.value = '';
      }
    });
  }

  // Initial render
  computeCaches();
  renderAll();

  // Default view
  setActiveView('home');
}

document.addEventListener('DOMContentLoaded', init);