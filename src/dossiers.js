// Dossiers parlementaires : de la veille à la réponse. Un dossier = une question / interpellation / texte suivi de bout en bout.
const store = require('./store');

const STAGES = [
  { id: 'veille', label: 'Veille & idée' },
  { id: 'recherche', label: 'Recherche' },
  { id: 'redaction', label: 'Rédaction' },
  { id: 'relecture', label: 'Relecture' },
  { id: 'depot', label: 'Dépôt / envoi' },
  { id: 'suivi', label: 'Suivi & réponse' },
  { id: 'clos', label: 'Clos' },
];

const MAX_ITEMS = 2000, MAX_HISTORY = 200, MAX_RESEARCH = 40, MAX_DRAFTS = 60;
const KINDS = new Set(['research', 'drafts', 'sources']);
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const load = () => {
  const d = store.read('dossiers', { items: [] });
  if (!Array.isArray(d.items)) d.items = [];
  d.items = d.items.filter((x) => x && typeof x === 'object' && typeof x.id === 'string');
  for (const it of d.items) {
    for (const k of ['research', 'drafts', 'sources', 'history']) if (!Array.isArray(it[k])) it[k] = [];
    if (typeof it.title !== 'string') it.title = 'Sans titre';
    if (typeof it.updated !== 'string') it.updated = it.created || store.now();
    if (!STAGES.some((s) => s.id === it.stage)) it.stage = 'veille';
  }
  return d;
};
const save = (d) => store.write('dossiers', d);

function list() { return { stages: STAGES, items: load().items.sort((a, b) => b.updated.localeCompare(a.updated)) }; }
function get(id) { const d = load().items.find((x) => x.id === id); if (!d) throw new Error('Dossier introuvable.'); return d; }

function create(p) {
  p = p && typeof p === 'object' ? p : {};
  if (typeof p.title !== 'string' || !p.title.trim()) throw new Error('Titre requis.');
  const d = load();
  if (d.items.length >= MAX_ITEMS) throw new Error('Nombre maximal de dossiers atteint : clos ou supprime des dossiers.');
  const sources = (Array.isArray(p.sources) ? p.sources : []).slice(0, 50).filter((x) => x && typeof x.url === 'string').map((x) => ({ url: clip(x.url, 2000), title: clip(x.title, 300) }));
  const item = { id: store.uid('d'), title: clip(p.title.trim(), 300), theme: clip(p.theme, 200), parlement: clip(p.parlement, 80), instrument: clip(p.instrument, 120), stage: STAGES.some((s) => s.id === p.stage) ? p.stage : 'veille', deadline: /^\d{4}-\d{2}-\d{2}$/.test(p.deadline || '') ? p.deadline : '',
    notes: clip(p.notes, 100000), research: [], drafts: [], answer: '', sources, history: [{ t: store.now(), text: 'Dossier créé' }], created: store.now(), updated: store.now() };
  d.items.push(item); save(d); return item;
}

function patch(id, p) {
  const d = load(); const it = d.items.find((x) => x.id === id);
  if (!it) throw new Error('Dossier introuvable.');
  p = p && typeof p === 'object' ? p : {};
  const LIM = { title: 300, theme: 200, parlement: 80, instrument: 120, deadline: 10, notes: 100000, answer: 100000 };
  for (const k of Object.keys(LIM)) if (p[k] !== undefined) it[k] = clip(p[k], LIM[k]);
  if (p.title !== undefined && !it.title.trim()) throw new Error('Titre requis.');
  if (p.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(it.deadline)) it.deadline = '';
  if (p.stage && p.stage !== it.stage && STAGES.some((s) => s.id === p.stage)) { it.history.push({ t: store.now(), text: `Étape : ${STAGES.find((s) => s.id === it.stage)?.label} → ${STAGES.find((s) => s.id === p.stage)?.label}` }); it.stage = p.stage; }
  it.updated = store.now(); save(d); return it;
}

function remove(id) { const d = load(); d.items = d.items.filter((x) => x.id !== id); save(d); return true; }

function addResearch(id, r) {
  const d = load(); const it = d.items.find((x) => x.id === id); if (!it) return null;
  it.research.unshift({ id: store.uid('r'), t: store.now(), ...r });
  it.research = it.research.slice(0, MAX_RESEARCH);
  it.history.push({ t: store.now(), text: 'Recherche ajoutée : ' + (r.query || '').slice(0, 80) }); it.history = it.history.slice(-MAX_HISTORY);
  if (it.stage === 'veille') it.stage = 'recherche';
  it.updated = store.now(); save(d); return it;
}

function addDraft(id, dr) {
  const d = load(); const it = d.items.find((x) => x.id === id); if (!it) return null;
  dr = { ...dr }; for (const k of ['__proto__', 'constructor', 'prototype']) delete dr[k];
  if (typeof dr.text === 'string') dr.text = dr.text.slice(0, 500000);
  if (dr.id) { const ex = it.drafts.find((x) => x.id === dr.id); if (ex) { Object.assign(ex, dr, { t: store.now() }); it.updated = store.now(); save(d); return ex; } }
  const item = { id: store.uid('b'), t: store.now(), ...dr };
  it.drafts.unshift(item); it.drafts = it.drafts.slice(0, MAX_DRAFTS);
  it.history.push({ t: store.now(), text: 'Brouillon enregistré (' + (dr.label || 'texte') + ')' }); it.history = it.history.slice(-MAX_HISTORY);
  if (['veille', 'recherche'].includes(it.stage)) it.stage = 'redaction';
  it.updated = store.now(); save(d); return item;
}

function deleteItem(id, kind, itemId) {
  if (!KINDS.has(kind)) throw new Error('Type d\'élément inconnu.');
  const d = load(); const it = d.items.find((x) => x.id === id); if (!it) return false;
  it[kind] = it[kind].filter((x) => x.id !== itemId); it.updated = store.now(); save(d); return true;
}

function upcoming() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date()); // AAAA-MM-JJ à Bruxelles
  return load().items.filter((i) => i.stage !== 'clos' && i.deadline && i.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 10);
}

module.exports = { STAGES, list, get, create, patch, remove, addResearch, addDraft, deleteItem, upcoming };
