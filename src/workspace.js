// Arborescence ~/Documents/Jarvis-Parlement/<Parlement>/<sous-dossiers>, créée automatiquement pour chaque parlement actif.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const templates = require('./templates');

const ROOT = store.DOCS_DEFAULT;
const SUBS = {
  modeles: '00-Modeles',
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
// Nom de fichier/dossier sûr : lettres latines et chiffres uniquement (aucun séparateur, point, caractère nul ou Unicode exotique).
const slug = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function safeName(name, max = 60) { return slug(name).slice(0, max).replace(/-+$/, '') || 'document'; }

function folderName(parlementId) {
  if (FIXED[parlementId]) return FIXED[parlementId];
  const p = templates.all().parlements.find((x) => x.id === parlementId);
  const n = slug(p ? p.nom : parlementId).slice(0, 80) || 'Autre';
  return n.startsWith('Parlement') ? n : 'Parlement-' + n;
}

const MODELES_README = `MODELES DE DOCUMENTS - mode d'emploi
=====================================

Deposez ici VOS modeles Word (.docx de preference) : une question ecrite, une question
orale, une interpellation, une question d'actualite, une resolution... Quand Jarvis redige un
texte pour ce parlement, il suit EXACTEMENT votre modele (structure, formules, ton, mise en
page, en-tete, logo) et vous remet un fichier Word (.docx) pret a relire.

COMMENT NOMMER LES FICHIERS (association automatique)
  question-ecrite.docx          -> question ecrite
  question-orale.docx           -> question orale (commission)
  question-actualite.docx       -> question d'actualite (seance pleniere)
  interpellation.docx           -> interpellation
  resolution.docx               -> proposition de resolution
  demande-explications.docx     -> demande d'explications (Senat)
  recommandation.docx           -> proposition de recommandation (Benelux)
Vous pouvez aussi choisir vous-meme le fichier de chaque type dans l'application (page Modeles).

DEUX FACONS DE PREPARER UN MODELE
  1. Modele a champs : ecrivez {{sujet}}, {{date}}, {{contexte}}, {{questions}}... ou <<sujet>>,
     ou [Nom du ministre] la ou Jarvis doit ecrire. {{date}}, {{auteur}}, {{groupe}},
     {{signature}} sont remplis automatiquement depuis votre profil.
  2. Modele-exemple : une ancienne question deja redigee, sans aucun champ. Jarvis en deduit la
     structure et le ton, puis reecrit le contenu paragraphe par paragraphe en gardant vos styles.

FORMATS
  .docx / .dotx : utilises directement (recommande).
  .doc / .odt / .rtf / .pdf : convertis automatiquement SI LibreOffice ou OpenOffice est installe
  sur ce Mac. Sinon, ouvrez le fichier dans Word et faites Enregistrer sous... > .docx.
  .docm (macros) : refuses pour votre securite.

CONFIDENTIALITE
  Avec un moteur IA local (Ollama), vos modeles ne quittent jamais ce Mac. Avec un moteur en ligne,
  un modele n'est envoye qu'avec votre accord explicite (page Modeles).
  Jarvis ne depose et n'envoie jamais rien : vous relisez le Word avant tout depot.

Les sous-dossiers _convertis et _corbeille sont geres par Jarvis (la corbeille contient les modeles
retires : vous pouvez les recuperer).
`;

function ensure(parlementId) {
  const base = path.join(ROOT, folderName(parlementId));
  for (const s of Object.values(SUBS)) fs.mkdirSync(path.join(base, s), { recursive: true });
  try { fs.writeFileSync(path.join(base, SUBS.modeles, 'LISEZ-MOI.txt'), MODELES_README, { flag: 'wx', mode: 0o644 }); } catch { /* déjà présent */ }
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
// Ne remplace jamais un fichier existant (numéro -2, -3… en cas d'homonyme) et reste strictement sous la racine de travail.
function save(parlementId, sub, name, content) {
  try {
    if (!parlementId || typeof parlementId !== 'string') parlementId = store.settings.get().profile.parlements[0];
    if (!parlementId) return null;
    if (!Object.prototype.hasOwnProperty.call(SUBS, sub)) return null;
    const dir = path.join(ensure(parlementId), SUBS[sub]);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${stamp}_${safeName(name)}`;
    let file = path.join(dir, base + '.md');
    for (let n = 2; ; n++) {
      if (path.relative(ROOT, file).startsWith('..')) return null;
      try { fs.writeFileSync(file, String(content == null ? '' : content), { flag: 'wx', mode: 0o600 }); return file; }
      catch (e) { if (e.code !== 'EEXIST' || n > 500) throw e; file = path.join(dir, `${base}-${n}.md`); }
    }
  } catch (e) { console.error('workspace.save :', e.code || e.message); return null; }
}

function info() {
  const ids = store.settings.get().profile.parlements;
  return { root: ROOT, parlements: ids.map((id) => ({ id, name: folderName(id), path: path.join(ROOT, folderName(id)), exists: fs.existsSync(path.join(ROOT, folderName(id))) })) };
}

module.exports = { ROOT, SUBS, folderName, ensure, ensureAll, save, info, safeName };
