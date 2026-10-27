// Arborescence ~/Documents/Jarvis-Parlement/<Parlement>/<sous-dossiers>, créée automatiquement pour chaque parlement actif.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const templates = require('./templates');

const ROOT = store.DOCS_DEFAULT;
const SUBS = {
  veille: '01-Veille',
  recherches: '02-Recherches',
  interpellations: '03-Interpellations-et-Questions',
  documents: '04-Documents',
  courriers: '05-Courriers',
  archives: '06-Archives',
};

const FIXED = {
  'bxl-pb': 'Parlement-Bruxelles', 'bxl-pfb': 'Parlement-Francophone-Bruxellois', 'be-chambre': 'Chambre-des-Representants', 'be-senat': 'Senat',
  wallon: 'Parlement-Wallonie', fwb: 'Parlement-Federation-Wallonie-Bruxelles', benelux: 'Parlement-Benelux', pe: 'Parlement-Europeen',
};
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

function folderName(parlementId) {
  if (FIXED[parlementId]) return FIXED[parlementId];
  const p = templates.all().parlements.find((x) => x.id === parlementId);
  const n = slug(p ? p.nom : parlementId);
  return n.startsWith('Parlement') ? n : 'Parlement-' + n;
}

function ensure(parlementId) {
  const base = path.join(ROOT, folderName(parlementId));
  for (const s of Object.values(SUBS)) fs.mkdirSync(path.join(base, s), { recursive: true });
  return base;
}

function ensureAll() {
  fs.mkdirSync(ROOT, { recursive: true });
  const ids = store.settings.get().profile.parlements;
  const out = ids.map((id) => ({ id, path: ensure(id) }));
  // La racine est indexée par défaut : elle couvre automatiquement tous les parlements.
  const s = store.settings.get();
  if (!s.docs.folders.includes(ROOT)) store.settings.replace({ ...s, docs: { folders: [ROOT, ...s.docs.folders] } });
  return out;
}

// Sauvegarde un document produit par Jarvis dans le bon sous-dossier du parlement. Ne lève jamais d'erreur bloquante.
function save(parlementId, sub, name, content) {
  try {
    if (!parlementId) parlementId = store.settings.get().profile.parlements[0];
    if (!parlementId) return null;
    const dir = path.join(ensure(parlementId), SUBS[sub] || sub);
    const stamp = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `${stamp}_${slug(name).slice(0, 60) || 'document'}.md`);
    fs.writeFileSync(file, content);
    return file;
  } catch { return null; }
}

function info() {
  const ids = store.settings.get().profile.parlements;
  return { root: ROOT, parlements: ids.map((id) => ({ id, name: folderName(id), path: path.join(ROOT, folderName(id)), exists: fs.existsSync(path.join(ROOT, folderName(id))) })) };
}

module.exports = { ROOT, SUBS, folderName, ensure, ensureAll, save, info };
