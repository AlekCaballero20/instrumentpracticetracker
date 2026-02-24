'use strict';

/**
 * Instrument Tracker — config.js (v2)
 * Data + defaults separados del core.
 * - Listas canon (instrumentos/áreas/personas/componentes)
 * - Defaults robustos + helpers para evitar estados inválidos
 */

export const STORAGE_KEY = 'instrument-tracker:v2';

/* =========================
   Personas (para registrar)
========================= */
export const PEOPLE = [
  { id: 'Alek', label: 'Alek' },
  { id: 'Cata', label: 'Cata' },
  { id: 'Duo',  label: 'Duo'  }
];

/* =========================
   Componentes de estudio
========================= */
export const COMPONENTS = [
  { id: 'tech',   label: 'Técnico',     icon: '🎯' },
  { id: 'theory', label: 'Teórico',     icon: '🧠' },
  { id: 'rep',    label: 'Repertorio',  icon: '🎵' },
];

/* =========================
   Dificultad / Mood
========================= */
export const DIFFICULTY = [
  { id: 'easy', label: 'Fácil' },
  { id: 'ok',   label: 'Ok'    },
  { id: 'hard', label: 'Duro'  },
];

export const MOOD = {
  min: 1,
  max: 5,
  default: 3
};

/* =========================
   Instrumentos / Áreas
   - id: string estable (no lo cambies si ya hay datos)
   - type: 'instrument' | 'area'
========================= */
export const INSTRUMENTS = [
  { id:'piano',            name:'Piano',              icon:'🎹', color:'var(--p2)', type:'instrument' },
  { id:'guitarra-elec',    name:'Guitarra eléctrica', icon:'🎸', color:'var(--p3)', type:'instrument' },
  { id:'guitarra-ac',      name:'Guitarra acústica',  icon:'🪕', color:'var(--p5)', type:'instrument' },
  { id:'bajo',             name:'Bajo eléctrico',     icon:'🎸', color:'var(--p6)', type:'instrument' },
  { id:'violin',           name:'Violín',             icon:'🎻', color:'var(--p1)', type:'instrument' },
  { id:'cello',            name:'Cello',              icon:'🎻', color:'var(--p4)', type:'instrument' },
  { id:'flauta-traversa',  name:'Flauta traversa',    icon:'🪈', color:'var(--p6)', type:'instrument' },
  { id:'bateria',          name:'Batería',            icon:'🥁', color:'var(--p5)', type:'instrument' },

  { id:'canto',            name:'Canto',              icon:'🎤', color:'var(--p3)', type:'area' },
  { id:'composicion',      name:'Composición',        icon:'✍️', color:'var(--p1)', type:'area' },
  { id:'teoria',           name:'Teoría',             icon:'📚', color:'var(--p2)', type:'area' },
  { id:'produccion',       name:'Producción musical', icon:'🎛️', color:'var(--p6)', type:'area' },

  { id:'ukelele',          name:'Ukelele',            icon:'🎶', color:'var(--p4)', type:'instrument' },
  { id:'flauta-dulce',     name:'Flauta dulce',       icon:'🎼', color:'var(--p2)', type:'instrument' },
];

/* =========================
   Helpers
========================= */

export function instrumentById(id){
  return INSTRUMENTS.find(x => x.id === id) || null;
}

export function clamp(n, a, b){
  n = Number(n);
  if(Number.isNaN(n)) n = a;
  return Math.max(a, Math.min(b, n));
}

/**
 * Asegura que exista un weight por instrumento, sin romper si agregas nuevos.
 * 0..5 (como tu slider actual).
 */
export function buildDefaultWeights(partial = {}){
  const out = {};
  for(const it of INSTRUMENTS){
    const val = partial[it.id];
    // defaults razonables por tipo
    const fallback = (it.type === 'area') ? 2 : 2;
    out[it.id] = clamp(typeof val === 'number' ? val : fallback, 0, 5);
  }
  return out;
}

/* =========================
   Defaults
========================= */

/**
 * Settings globales de la app.
 * Nota: hoy tu app.js usa:
 * - weights (0..5)
 * - avoidRepeat
 * - showConfetti
 *
 * Yo agrego opcionales listos para anti-procrastinación,
 * sin obligarte a implementarlos ya.
 */
export const DEFAULT_SETTINGS = {
  // prioridad manual por instrumento/área (0..5)
  weights: buildDefaultWeights({
    piano: 4,
    'guitarra-elec': 3,
    'guitarra-ac': 2,
    bajo: 2,
    violin: 3,
    cello: 2,
    'flauta-traversa': 2,
    bateria: 2,
    canto: 3,
    composicion: 2,
    teoria: 2,
    produccion: 2,
    ukelele: 1,
    'flauta-dulce': 1,
  }),

  // evita escoger el mismo dos veces seguidas (cuando hay opciones)
  avoidRepeat: true,

  // confetti para el refuerzo dopaminérgico legal
  showConfetti: true,

  // opcionales “anti-procrastinación” (no rompen nada si no los usas)
  streakGoalMin: 20,      // meta diaria sugerida
  dailyNudge: true,       // futuro: nudges/recordatorios dentro de la app
  defaultWho: 'Alek',     // futuro: autoselección en registro
};

/**
 * Estado por instrumento/área dentro del DB.
 */
export const DEFAULT_INSTRUMENT_STATE = () => ({
  available: true,        // “a la mano”
  condition: '',          // ej: “solo con audífonos”
  archived: false,

  lastStudiedAt: null,    // ISO datetime
  minutesWeek: 0,
  minutesMonth: 0,
});

/**
 * Default de sesión (por si en el futuro quieres “templates”).
 */
export const DEFAULT_SESSION_TEMPLATE = () => ({
  who: DEFAULT_SETTINGS.defaultWho,
  mood: MOOD.default,
  difficulty: 'ok',
  tech: { minutes: 0, notes: '' },
  theory: { minutes: 0, notes: '' },
  rep: { minutes: 0, notes: '' },
  tags: [],
  notes: '',
});