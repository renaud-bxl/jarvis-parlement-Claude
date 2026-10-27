// Le « cerveau » : mémoire durable des préférences du parlementaire, enrichie à l'usage.
// Trois sources d'apprentissage : (1) ce que tu demandes, (2) tes corrections des brouillons, (3) tes retours 👍/👎.
const store = require('./store');
const llm = require('./llm');

const CATEGORIES = {
  identite: 'Identité & mandat',
  style: 'Style de rédaction',
  theme: 'Thèmes & priorités',
  procedure: 'Procédure & parlements',
  sources: 'Sources & médias',
  workflow: 'Façon de travailler',
  evite: 'À éviter',
};

let emit = () => {};
const setEmitter = (fn) => { emit = fn; };

const load = () => store.read('brain', { facts: [], stats: { usage: {}, themes: {}, instruments: {}, parlements: {} }, log: [] });
const save = (b) => store.write('brain', b);

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function similar(a, b) {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 3)), B = new Set(norm(b).split(' ').filter((w) => w.length > 3));
  if (!A.size || !B.size) return false;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.75;
}

function list() { const b = load(); return { facts: b.facts, stats: b.stats, categories: CATEGORIES, learning: store.settings.get().brain.learning }; }

function addFact(text, category = 'workflow', source = 'manuel', pinned = false) {
  text = String(text || '').trim();
  if (!text) throw new Error('Texte vide.');
  if (!CATEGORIES[category]) category = 'workflow';
  const b = load();
  const dup = b.facts.find((f) => similar(f.text, text));
  if (dup) { dup.count++; dup.updated = store.now(); if (pinned) dup.pinned = true; save(b); return dup; }
  const f = { id: store.uid('f'), text, category, source, count: 1, pinned, created: store.now(), updated: store.now() };
  b.facts.push(f); save(b); emit('brain-updated', { added: 1 });
  return f;
}
function updateFact(id, patch) {
  const b = load(); const f = b.facts.find((x) => x.id === id);
  if (!f) throw new Error('Souvenir introuvable.');
  if (patch.text !== undefined) f.text = String(patch.text).trim();
  if (patch.category && CATEGORIES[patch.category]) f.category = patch.category;
  if (patch.pinned !== undefined) f.pinned = !!patch.pinned;
  f.updated = store.now(); save(b); return f;
}
function removeFact(id) { const b = load(); b.facts = b.facts.filter((f) => f.id !== id); save(b); return true; }
function reset() { save({ facts: [], stats: { usage: {}, themes: {}, instruments: {}, parlements: {} }, log: [] }); return true; }
function exportAll() { return load(); }
function importAll(data) {
  if (!data || !Array.isArray(data.facts)) throw new Error('Fichier de cerveau invalide.');
  const b = load();
  for (const f of data.facts) if (f.text && !b.facts.some((x) => similar(x.text, f.text))) b.facts.push({ ...f, id: store.uid('f') });
  save(b); return b.facts.length;
}

// Statistiques d'usage purement locales (aucun appel IA).
function noteUsage(kind, { theme, instrument, parlement } = {}) {
  const b = load(); const s = b.stats;
  s.usage[kind] = (s.usage[kind] || 0) + 1;
  if (theme) s.themes[theme] = (s.themes[theme] || 0) + 1;
  if (instrument) s.instruments[instrument] = (s.instruments[instrument] || 0) + 1;
  if (parlement) s.parlements[parlement] = (s.parlements[parlement] || 0) + 1;
  save(b);
}

// Bloc injecté dans chaque prompt : profil + souvenirs les plus utiles.
function promptBlock(max = 40) {
  const st = store.settings.get(); const p = st.profile; const b = load();
  const lines = [];
  if (p.nom) lines.push(`- Utilisateur : ${p.nom}${p.titre ? ' (' + p.titre + ')' : ''}${p.groupe ? ', groupe ' + p.groupe : ''}${p.parti ? ', ' + p.parti : ''}${p.circonscription ? ', ' + p.circonscription : ''}.`);
  if (p.langue) lines.push(`- Langue de travail par défaut : ${({ fr: 'français', nl: 'néerlandais', en: 'anglais' })[p.langue] || p.langue}.`);
  const now = Date.now();
  const scored = b.facts.map((f) => ({ f, s: (f.pinned ? 100 : 0) + Math.log2(1 + f.count) * 2 + Math.max(0, 3 - (now - Date.parse(f.updated)) / 864e5 / 30) })).sort((a, c) => c.s - a.s).slice(0, max);
  for (const { f } of scored) lines.push(`- [${CATEGORIES[f.category]}] ${f.text}`);
  const top = (o) => Object.entries(o).sort((a, c) => c[1] - a[1]).slice(0, 5).map(([k]) => k);
  const themes = top(b.stats.themes); if (themes.length) lines.push(`- Thèmes les plus travaillés : ${themes.join(', ')}.`);
  return lines.length ? 'MÉMOIRE (préférences apprises de l\'utilisateur — à respecter sans les citer) :\n' + lines.join('\n') : '';
}

const LEARN_SYSTEM = `Tu es le module de mémoire d'un assistant pour parlementaire. Tu extrais UNIQUEMENT des préférences ou faits DURABLES et RÉUTILISABLES sur l'utilisateur (style, ton, formules, thèmes de prédilection, procédure, sources, habitudes, choses à éviter).
Règles : ignore les faits ponctuels du dossier ; n'enregistre aucune donnée personnelle de tiers ni contenu confidentiel ; formule chaque souvenir en une phrase courte, à l'impératif ou au présent, en français.
Réponds par un JSON strict : {"add":[{"text":"...","category":"identite|style|theme|procedure|sources|workflow|evite"}],"reinforce":["id existant"],"remove":["id contredit par la nouvelle information"]}. Liste vide si rien à retenir.`;

async function runLearning(context, label) {
  const st = store.settings.get();
  if (!st.brain.learning || !llm.configured()) return { added: 0 };
  const b = load();
  const existing = b.facts.map((f) => `${f.id}: ${f.text}`).join('\n') || '(aucun)';
  try {
    const r = await llm.complete({ system: LEARN_SYSTEM, prompt: `SOUVENIRS EXISTANTS:\n${existing}\n\nÉVÉNEMENT (${label}):\n${context}`.slice(0, 14000), fast: true, json: true, maxTokens: 800 });
    const d = r.data || {}; let added = 0;
    for (const a of d.add || []) if (a && a.text && String(a.text).length < 300) { const before = load().facts.length; addFact(a.text, a.category, 'appris:' + label); if (load().facts.length > before) added++; }
    const b2 = load();
    for (const id of d.reinforce || []) { const f = b2.facts.find((x) => x.id === id); if (f) { f.count++; f.updated = store.now(); } }
    for (const id of d.remove || []) { const f = b2.facts.find((x) => x.id === id); if (f && !f.pinned) b2.facts = b2.facts.filter((x) => x.id !== id); }
    b2.log = [...(b2.log || []).slice(-49), { t: store.now(), label, added }];
    save(b2); if (added || (d.remove || []).length) emit('brain-updated', { added });
    return { added };
  } catch { return { added: 0 }; }
}

// Appels « fire and forget » depuis les autres modules.
const learnFromInteraction = (kind, input, output) =>
  runLearning(`Demande de l'utilisateur :\n${String(input).slice(0, 3000)}\n\nRéponse produite (extrait) :\n${String(output).slice(0, 2500)}`, kind);
const learnFromEdit = (original, finalText, ctx) =>
  original && finalText && original.trim() !== finalText.trim()
    ? runLearning(`Contexte : ${ctx || ''}\nBROUILLON GÉNÉRÉ :\n${original.slice(0, 5000)}\n\nVERSION CORRIGÉE PAR L'UTILISATEUR :\n${finalText.slice(0, 5000)}\n\nDéduis les préférences de style/structure/ton révélées par les corrections.`, 'corrections')
    : Promise.resolve({ added: 0 });
const learnFromFeedback = (rating, comment, output) =>
  runLearning(`Retour utilisateur : ${rating > 0 ? '👍 satisfait' : '👎 insatisfait'}. Commentaire : ${comment || '(aucun)'}\nTexte concerné (extrait) :\n${String(output).slice(0, 2500)}`, 'retour');

module.exports = { CATEGORIES, setEmitter, list, addFact, updateFact, removeFact, reset, exportAll, importAll, noteUsage, promptBlock, learnFromInteraction, learnFromEdit, learnFromFeedback };
