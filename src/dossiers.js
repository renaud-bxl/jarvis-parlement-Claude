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

const load = () => store.read('dossiers', { items: [] });
const save = (d) => store.write('dossiers', d);

function list() { return { stages: STAGES, items: load().items.sort((a, b) => b.updated.localeCompare(a.updated)) }; }
function get(id) { const d = load().items.find((x) => x.id === id); if (!d) throw new Error('Dossier introuvable.'); return d; }

function create(p) {
  if (!p.title || !p.title.trim()) throw new Error('Titre requis.');
  const d = load();
  const item = { id: store.uid('d'), title: p.title.trim(), theme: p.theme || '', parlement: p.parlement || '', instrument: p.instrument || '', stage: p.stage || 'veille', deadline: p.deadline || '',
    notes: p.notes || '', research: [], drafts: [], answer: '', sources: p.sources || [], history: [{ t: store.now(), text: 'Dossier créé' }], created: store.now(), updated: store.now() };
  d.items.push(item); save(d); return item;
}

function patch(id, p) {
  const d = load(); const it = d.items.find((x) => x.id === id);
  if (!it) throw new Error('Dossier introuvable.');
  for (const k of ['title', 'theme', 'parlement', 'instrument', 'deadline', 'notes', 'answer']) if (p[k] !== undefined) it[k] = p[k];
  if (p.stage && p.stage !== it.stage) { it.history.push({ t: store.now(), text: `Étape : ${STAGES.find((s) => s.id === it.stage)?.label} → ${STAGES.find((s) => s.id === p.stage)?.label}` }); it.stage = p.stage; }
  it.updated = store.now(); save(d); return it;
}

function remove(id) { const d = load(); d.items = d.items.filter((x) => x.id !== id); save(d); return true; }

function addResearch(id, r) {
  const d = load(); const it = d.items.find((x) => x.id === id); if (!it) return null;
  it.research.unshift({ id: store.uid('r'), t: store.now(), ...r });
  it.history.push({ t: store.now(), text: 'Recherche ajoutée : ' + (r.query || '').slice(0, 80) });
  if (it.stage === 'veille') it.stage = 'recherche';
  it.updated = store.now(); save(d); return it;
}

function addDraft(id, dr) {
  const d = load(); const it = d.items.find((x) => x.id === id); if (!it) return null;
  if (dr.id) { const ex = it.drafts.find((x) => x.id === dr.id); if (ex) { Object.assign(ex, dr, { t: store.now() }); it.updated = store.now(); save(d); return ex; } }
  const item = { id: store.uid('b'), t: store.now(), ...dr };
  it.drafts.unshift(item);
  it.history.push({ t: store.now(), text: 'Brouillon enregistré (' + (dr.label || 'texte') + ')' });
  if (['veille', 'recherche'].includes(it.stage)) it.stage = 'redaction';
  it.updated = store.now(); save(d); return item;
}

function deleteItem(id, kind, itemId) {
  const d = load(); const it = d.items.find((x) => x.id === id); if (!it) return false;
  it[kind] = it[kind].filter((x) => x.id !== itemId); it.updated = store.now(); save(d); return true;
}

function upcoming() {
  const today = new Date().toISOString().slice(0, 10);
  return load().items.filter((i) => i.stage !== 'clos' && i.deadline && i.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 10);
}

module.exports = { STAGES, list, get, create, patch, remove, addResearch, addDraft, deleteItem, upcoming };
