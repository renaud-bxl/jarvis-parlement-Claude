// Modèles d'interpellation / de questions par parlement cible.
// Les structures sont des trames de travail : les limites formelles (longueur, délais, forme de dépôt)
// varient selon le règlement en vigueur et ne sont PAS codées en dur — Jarvis rappelle toujours de les vérifier.
const store = require('./store');

const S = {
  contexte: { nom: 'Contexte', guide: 'Rappel factuel bref et sourcé (2-4 phrases) : ce qui s\'est passé, chiffres, dates.' },
  constat: { nom: 'Constat', guide: 'Le problème identifié, avec données vérifiables et références officielles.' },
  antecedents: { nom: 'Antécédents', guide: 'Questions, réponses, engagements ou textes antérieurs sur le sujet (numéros, dates).' },
  questions: { nom: 'Questions', guide: 'Questions numérotées, courtes, précises, répondables (chiffres, calendrier, budget, responsable).' },
  conclusion: { nom: 'Demande', guide: 'Ce que le parlementaire attend : engagement, calendrier, information, mesure.' },
};

const mk = (id, label, mode, recipient, sections, extra = {}) => ({ id, label, mode, recipient, sections, ...extra });

const ORAL_PLENIERE = (id) => mk(id, 'Question d\'actualité (séance plénière)', 'oral', 'Ministre / Gouvernement',
  [S.contexte, { nom: 'Question', guide: 'Une à deux questions maximum, très directes, formulées à l\'oral (phrases courtes).' }],
  { tone: 'vif, direct, oral, sans jargon', lengthHint: 'très court : environ 1 minute de lecture orale', notes: 'Le caractère d\'actualité et le délai de dépôt sont fixés par le règlement : à vérifier.' });
const ORAL_COMMISSION = (id) => mk(id, 'Question orale (commission)', 'oral', 'Ministre compétent',
  [S.contexte, S.constat, S.questions],
  { tone: 'précis, courtois, oral', lengthHint: 'court à moyen (2-3 minutes à l\'oral)', notes: 'Les modalités d\'inscription à l\'ordre du jour de la commission sont à vérifier.' });
const INTERPELLATION = (id) => mk(id, 'Interpellation (commission)', 'oral', 'Ministre compétent',
  [S.contexte, S.constat, S.antecedents, S.questions, S.conclusion],
  { tone: 'argumenté, critique mais factuel, oral', lengthHint: 'moyen à long (4-6 minutes à l\'oral), avec réplique prévue', notes: 'L\'interpellation donne lieu à débat et éventuellement à une motion : vérifier le règlement. Prévoir 2-3 points pour la réplique.', hasReply: true });
const ECRITE = (id, recipient = 'Ministre compétent') => mk(id, 'Question écrite', 'écrit', recipient,
  [{ nom: 'Intitulé', guide: 'Objet de la question en une ligne.' }, S.contexte, S.questions],
  { tone: 'sobre, administratif, très précis', lengthHint: 'court à moyen ; questions fermées et chiffrées', notes: 'Les limites de longueur et la forme de dépôt sont fixées par le règlement : à vérifier.' });
const RESOLUTION = (id) => mk(id, 'Proposition de résolution', 'écrit', 'Assemblée',
  [{ nom: 'Développements', guide: 'Exposé des motifs : contexte, constat, justification.' }, { nom: 'Considérants', guide: 'Liste de « considérant que… » factuels et sourcés.' }, { nom: 'Dispositif', guide: '« Demande au Gouvernement… » : mesures précises, numérotées.' }],
  { tone: 'formel, juridique', lengthHint: 'long, structuré', notes: 'Forme, recevabilité et signatures requises : à vérifier au règlement.' });

const PARLEMENTS = [
  { id: 'bxl-pb', nom: 'Parlement bruxellois (Région de Bruxelles-Capitale)', niveau: 'Région',
    instruments: [ORAL_PLENIERE('bxl-pb-actualite'), ORAL_COMMISSION('bxl-pb-orale'), INTERPELLATION('bxl-pb-interp'), ECRITE('bxl-pb-ecrite', 'Ministre-Président / ministre du Gouvernement bruxellois'), RESOLUTION('bxl-pb-resolution')],
    sources: ['https://www.parlement.brussels', 'https://www.weblex.irisnet.be'] },
  { id: 'bxl-pfb', nom: 'Parlement francophone bruxellois (COCOF)', niveau: 'Communauté (Cocof)',
    instruments: [ORAL_COMMISSION('bxl-pfb-orale'), INTERPELLATION('bxl-pfb-interp'), ECRITE('bxl-pfb-ecrite'), RESOLUTION('bxl-pfb-resolution')],
    sources: ['https://www.parlementfrancophone.brussels'] },
  { id: 'be-chambre', nom: 'Chambre des représentants (fédéral)', niveau: 'Fédéral',
    instruments: [ORAL_PLENIERE('be-chambre-actualite'), ORAL_COMMISSION('be-chambre-orale'), INTERPELLATION('be-chambre-interp'), ECRITE('be-chambre-ecrite'), RESOLUTION('be-chambre-resolution')],
    sources: ['https://www.lachambre.be'] },
  { id: 'be-senat', nom: 'Sénat de Belgique', niveau: 'Fédéral',
    instruments: [mk('be-senat-explications', 'Demande d\'explications (commission)', 'oral', 'Ministre compétent', [S.contexte, S.constat, S.questions], { tone: 'précis, courtois, oral', lengthHint: 'court à moyen', notes: 'Compétences du Sénat limitées : vérifier la recevabilité de la matière.' }), ECRITE('be-senat-ecrite'), RESOLUTION('be-senat-resolution')],
    sources: ['https://www.senate.be'] },
  { id: 'wallon', nom: 'Parlement de Wallonie', niveau: 'Région',
    instruments: [ORAL_PLENIERE('wallon-actualite'), ORAL_COMMISSION('wallon-orale'), INTERPELLATION('wallon-interp'), ECRITE('wallon-ecrite'), RESOLUTION('wallon-resolution')],
    sources: ['https://www.parlement-wallonie.be'] },
  { id: 'fwb', nom: 'Parlement de la Fédération Wallonie-Bruxelles', niveau: 'Communauté',
    instruments: [ORAL_PLENIERE('fwb-actualite'), ORAL_COMMISSION('fwb-orale'), INTERPELLATION('fwb-interp'), ECRITE('fwb-ecrite'), RESOLUTION('fwb-resolution')],
    sources: ['https://www.pfwb.be'] },
  { id: 'benelux', nom: 'Parlement Benelux', niveau: 'Interparlementaire',
    instruments: [
      mk('benelux-ecrite', 'Question écrite (Benelux)', 'écrit', 'Gouvernements / Comité de ministres Benelux',
        [{ nom: 'Intitulé', guide: 'Objet transfrontalier en une ligne.' }, S.contexte, { nom: 'Dimension transfrontalière', guide: 'Impact BE/NL/LU, différences entre législations, obstacles concrets.' }, S.questions],
        { tone: 'sobre, diplomatique, comparatif BE/NL/LU', lengthHint: 'court à moyen', notes: 'Distinguer question écrite, recommandation et question à un ministre régional. Vérifier le règlement d\'ordre intérieur et lire les versions FR et NL.' }),
      mk('benelux-recommandation', 'Proposition de recommandation', 'écrit', 'Comité de ministres Benelux',
        [{ nom: 'Développements', guide: 'Exposé des motifs transfrontalier, avec comparaison BE/NL/LU.' }, { nom: 'Considérants', guide: 'Considérants factuels et sourcés.' }, { nom: 'Dispositif', guide: '« Recommande au Comité de ministres… » : mesures numérotées.' }],
        { tone: 'formel, diplomatique', lengthHint: 'long, structuré', notes: 'Procédure, délais et signataires à vérifier au règlement en vigueur ; produire la version bilingue FR/NL si nécessaire.' }),
    ],
    sources: ['https://www.beneluxparl.eu/fr/', 'https://www.beneluxparl.eu/fr/questions-ecrites-et-reponses/'] },
  { id: 'pe', nom: 'Parlement européen', niveau: 'Union européenne',
    instruments: [
      mk('pe-ecrite', 'Question écrite à la Commission / au Conseil', 'écrit', 'Commission européenne ou Conseil',
        [{ nom: 'Intitulé', guide: 'Objet précis, une ligne.' }, S.contexte, { nom: 'Questions', guide: 'Questions brèves, avec base juridique européenne si possible.' }],
        { tone: 'sobre, technique', lengthHint: 'court', notes: 'Limites de longueur et nombre de questions fixés par le règlement du PE : à vérifier.' }),
      mk('pe-orale', 'Question avec demande de réponse orale', 'oral', 'Commission / Conseil', [S.contexte, S.questions], { tone: 'formel', lengthHint: 'court', notes: 'Procédure à vérifier.' }),
    ],
    sources: ['https://www.europarl.europa.eu'] },
];

function all() {
  const t = store.read('templates', { custom: [], parlements: [] });
  return { parlements: [...PARLEMENTS, ...(t.parlements || [])], custom: t.custom || [] };
}

// Ajoute un parlement personnalisé en clonant les instruments d'un parlement existant (modifiables ensuite via les modèles personnalisés).
function addParlement({ nom, niveau, baseOn }) {
  nom = String(nom || '').trim(); if (!nom) throw new Error('Nom du parlement requis.');
  const t = store.read('templates', { custom: [], parlements: [] });
  const id = 'p_' + nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  if ([...PARLEMENTS, ...(t.parlements || [])].some((p) => p.id === id)) throw new Error('Ce parlement existe déjà.');
  const base = [...PARLEMENTS, ...(t.parlements || [])].find((p) => p.id === baseOn) || PARLEMENTS[0];
  const p = { id, nom, niveau: niveau || 'Personnalisé', custom: true, sources: [], instruments: base.instruments.map((i) => ({ ...JSON.parse(JSON.stringify(i)), id: id + '-' + i.id.split('-').slice(2).join('-'), notes: (i.notes || '') + ' Modèle copié de « ' + base.nom + ' » : adapte-le au règlement de ' + nom + '.' })) };
  t.parlements = [...(t.parlements || []), p]; store.write('templates', t);
  return p;
}
function removeParlement(id) { const t = store.read('templates', { custom: [], parlements: [] }); t.parlements = (t.parlements || []).filter((p) => p.id !== id); store.write('templates', t); return true; }

function find(instrumentId) {
  const { parlements, custom } = all();
  for (const p of parlements) { const i = p.instruments.find((x) => x.id === instrumentId); if (i) return { parlement: p, instrument: i }; }
  const c = custom.find((x) => x.id === instrumentId);
  if (c) return { parlement: { id: c.parlementId || 'custom', nom: c.parlementNom || 'Parlement personnalisé', niveau: '' }, instrument: { ...c, sections: (c.sections || []).map((s) => (typeof s === 'string' ? { nom: s, guide: '' } : s)) } };
  return null;
}

function saveCustom(tpl) {
  if (!tpl.label || !tpl.parlementNom) throw new Error('Nom du parlement et du modèle requis.');
  const t = store.read('templates', { custom: [] });
  const item = { id: tpl.id || store.uid('tpl'), label: tpl.label, parlementNom: tpl.parlementNom, parlementId: 'custom', mode: tpl.mode || 'écrit', recipient: tpl.recipient || '', tone: tpl.tone || '', lengthHint: tpl.lengthHint || '', notes: tpl.notes || '',
    sections: String(tpl.sections || '').split('\n').map((s) => s.trim()).filter(Boolean).map((l) => { const [nom, ...g] = l.split(':'); return { nom: nom.trim(), guide: g.join(':').trim() }; }),
    skeleton: tpl.skeleton || '' };
  const i = t.custom.findIndex((x) => x.id === item.id);
  if (i >= 0) t.custom[i] = item; else t.custom.push(item);
  store.write('templates', t); return item;
}
function removeCustom(id) { const t = store.read('templates', { custom: [] }); t.custom = t.custom.filter((x) => x.id !== id); store.write('templates', t); return true; }

// Consigne de rédaction spécifique au modèle choisi.
function instructions(instrumentId) {
  const f = find(instrumentId); if (!f) return '';
  const { parlement: p, instrument: i } = f;
  const sec = (i.sections || []).map((s, n) => `${n + 1}. ${s.nom}${s.guide ? ' — ' + s.guide : ''}`).join('\n');
  return `MODÈLE À SUIVRE
Parlement : ${p.nom}${p.niveau ? ' (' + p.niveau + ')' : ''}
Instrument : ${i.label} (${i.mode})
Destinataire : ${i.recipient || 'à déterminer'}
Ton : ${i.tone || 'professionnel'}
Longueur : ${i.lengthHint || 'adaptée'}
Structure :
${sec}
${i.skeleton ? '\nTrame personnalisée :\n' + i.skeleton : ''}
${i.hasReply ? 'Ajoute en fin de texte « Pistes pour la réplique » (3 points).\n' : ''}Rappel obligatoire en fin de document, section « À vérifier avant dépôt » : ${i.notes || 'règlement en vigueur, compétence du destinataire, délais'}.`;
}

module.exports = { all, find, addParlement, removeParlement, saveCustom, removeCustom, instructions };
