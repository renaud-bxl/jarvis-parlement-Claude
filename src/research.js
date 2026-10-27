// Les « métiers » de Jarvis : recherche, analyse locale, briefing, veille, rédaction, assistant.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const llm = require('./llm');
const brain = require('./brain');
const templates = require('./templates');
const dossiers = require('./dossiers');
const indexer = require('./indexer');
const google = require('./google');
const mail = require('./mail');
const workspace = require('./workspace');
const activeParl = () => store.settings.get().profile.parlementActif || store.settings.get().profile.parlements[0];
const srcMd = (src) => (src && src.length ? '\n\n## Sources\n' + src.map((x) => `- [${x.title}](${x.url})`).join('\n') : '');

const BASE = `Tu es JARVIS, l'assistant de travail d'un parlementaire belge. Tu travailles en français (ou dans la langue demandée : FR/NL/EN).
Contexte institutionnel : Parlement bruxellois et francophone bruxellois, Chambre et Sénat, Parlements wallon et de la Fédération Wallonie-Bruxelles, Parlement Benelux, Parlement européen.
Règles impératives :
- Ne jamais inventer un fait, un chiffre, une citation, un numéro de document ou une URL. Si tu ne sais pas ou n'as pas trouvé : dis-le.
- Distinguer clairement « Confirmé (source) » et « À vérifier ».
- Vérifier le niveau de pouvoir compétent avant d'attribuer une compétence (fédéral, région, communauté, commune, Europe).
- Citer les sources (titre + URL) et les dates. Les dates sont en fuseau Europe/Brussels.
- Tu prépares, tu ne déposes ni n'envoies rien : le parlementaire relit et décide.
- Style : clair, structuré, sans remplissage.
Date du jour : ${'${DATE}'}.`;

function system(extra = '') {
  const date = new Date().toLocaleDateString('fr-BE', { dateStyle: 'full', timeZone: 'Europe/Brussels' });
  return [BASE.replace('${DATE}', date), brain.promptBlock(), extra].filter(Boolean).join('\n\n');
}
const parlementName = (id) => templates.all().parlements.find((p) => p.id === id)?.nom || id || '';
function needAI() { if (!llm.configured()) throw new Error("Moteur IA non configuré. Ouvre Réglages › Moteur IA."); }

// 1. Recherche web et projet parlementaire
async function webResearch({ query, parlement, dossierId, deep }) {
  needAI();
  const p = parlement ? `Parlement ciblé : ${parlementName(parlement)}.` : '';
  const out = await llm.complete({
    system: system(`MISSION : recherche web sur un sujet parlementaire. ${p}
Format de sortie (markdown) :
## Résumé (5 lignes max)
## Compétence et autorité (niveau de pouvoir, ministre / organe compétent)
## Antécédents parlementaires (questions, interpellations, réponses, débats : n°, date, auteur, lien)
## Actualité récente (faits datés)
## Chiffres clés (avec source)
## Angles possibles pour une question ou une interpellation (5 pistes concrètes)
## Sources consultées (titre — URL)
## Points à vérifier (ce qui n'a pas pu être confirmé)`),
    prompt: `${deep ? 'Recherche approfondie. ' : ''}Sujet / projet : ${query}`,
    web: true, maxTokens: 6000,
  });
  const rec = { query, parlement: parlement || '', answer: out.text, sources: out.sources, model: out.model };
  if (dossierId) dossiers.addResearch(dossierId, rec);
  rec.file = workspace.save(parlement || activeParl(), 'recherches', query, `# Recherche : ${query}\n\n${out.text}${srcMd(out.sources)}\n`);
  brain.noteUsage('recherche', { parlement, theme: query.slice(0, 40) });
  brain.learnFromInteraction('recherche', query, out.text);
  return rec;
}

// 2. Analyse d'un document local (aucune recherche web)
async function analyzeDocument({ file, question, allowCloud }) {
  needAI();
  if (!llm.isLocal() && !allowCloud) throw new Error('Le moteur actif est un service cloud : coche « J\'autorise l\'envoi de ce document au moteur » ou passe sur un moteur local (Ollama).');
  if (!file || !fs.existsSync(file)) throw new Error('Fichier introuvable.');
  let text = (await indexer.extractText(file)).trim();
  if (!text) throw new Error('Aucun texte lisible dans ce document (PDF scanné ? un OCR est nécessaire).');
  const total = text.length;
  if (text.length > 60000) { // résumé par blocs puis synthèse
    const parts = []; for (let i = 0; i < text.length; i += 40000) parts.push(text.slice(i, i + 40000));
    const sums = [];
    for (const [i, part] of parts.slice(0, 8).entries()) sums.push(`### Partie ${i + 1}\n` + (await llm.complete({ system: system('Résume fidèlement cette partie en conservant chiffres, dates, noms, articles.'), prompt: part, fast: true, maxTokens: 1800 })).text);
    text = sums.join('\n\n');
  }
  const out = await llm.complete({
    system: system(`MISSION : analyser un document fourni par l'utilisateur, SANS recherche web. Tu t'appuies uniquement sur le document. Cite les passages (entre guillemets courts) avec leur localisation approximative.
Format : ## Nature du document ## Points essentiels ## Chiffres et dates ## Enjeux politiques ## Questions parlementaires possibles ## Zones d'ombre / à vérifier`),
    prompt: `${question || 'Analyse ce document pour un parlementaire.'}\n\n--- DOCUMENT : ${path.basename(file)} (${total} caractères) ---\n${text}`,
    maxTokens: 4500,
  });
  brain.noteUsage('analyse-doc');
  // Pas d'apprentissage sur le contenu du document (confidentialité) : seulement la consigne de l'utilisateur.
  if (question) brain.learnFromInteraction('analyse-doc', question, '(contenu du document non transmis à la mémoire)');
  return { answer: out.text, file, chars: total, local: llm.isLocal() };
}

// Recherche + question dans l'index documentaire
async function askIndex({ query, k = 6, synthesize }) {
  const hits = indexer.search(query, k);
  if (!synthesize || !hits.length) return { hits };
  needAI();
  const ctx = hits.map((h, i) => `[${i + 1}] ${h.name}\n${h.text}`).join('\n\n');
  const out = await llm.complete({ system: system('MISSION : répondre en t\'appuyant UNIQUEMENT sur les extraits fournis, avec renvois [n]. Si les extraits ne suffisent pas, dis-le.'), prompt: `Question : ${query}\n\nEXTRAITS :\n${ctx}`, maxTokens: 2500 });
  return { hits, answer: out.text };
}

// Veille
async function runVeille(override) {
  needAI();
  const st = store.settings.get(); const topics = override || st.veille.topics;
  if (!topics.length) throw new Error('Ajoute au moins un sujet de veille.');
  const db = store.read('veille', { items: [], runs: [] });
  const known = new Set(db.items.map((i) => i.url || i.title));
  let created = 0; const errors = []; const runStart = store.now(); const fresh = [];
  for (const t of topics) {
    try {
      const out = await llm.complete({
        system: system('MISSION : veille parlementaire et médiatique. Cherche sur le web les faits des 3 derniers jours (et l\'agenda parlementaire à venir) sur le sujet. Réponds par un JSON strict : {"items":[{"titre":"","resume":"","url":"","date":"AAAA-MM-JJ","source":"","pertinence":1-3,"piste":"idée de question ou d\'interpellation"}]}. 6 éléments maximum, uniquement des faits vérifiés par une page réellement consultée.'),
        prompt: `Sujet de veille : ${t.label}${t.keywords ? ' (mots-clés : ' + t.keywords + ')' : ''}${t.parlement ? ' — Parlement : ' + parlementName(t.parlement) : ''}`,
        web: true, json: true, maxTokens: 3500,
      });
      const items = out.data?.items || [];
      for (const it of items) {
        const key = it.url || it.titre; if (!it.titre || known.has(key)) continue; known.add(key);
        db.items.unshift({ id: store.uid('v'), topic: t.label, parlement: t.parlement || '', title: it.titre, summary: it.resume || '', url: it.url || '', date: it.date || '', source: it.source || '', score: Number(it.pertinence) || 1, idea: it.piste || '', found: store.now(), status: 'new' });
        fresh.push(db.items[0]); created++;
      }
    } catch (e) { errors.push(`${t.label} : ${e.message}`); }
  }
  const newOnes = db.items.filter((i) => i.found >= runStart);
  const byP = {}; for (const i of newOnes) (byP[i.parlement || activeParl()] ||= []).push(i);
  for (const [pid, arr] of Object.entries(byP)) workspace.save(pid, 'veille', 'veille', `# Veille du ${new Date().toLocaleDateString('fr-BE')}\n\n` + arr.map((i) => `## ${i.title}\n*${i.topic}* · ${i.date || ''} · ${i.source || ''}\n\n${i.summary}\n\n**Piste :** ${i.idea}\n\n${i.url}\n`).join('\n'));
  db.items = db.items.slice(0, 400);
  db.runs.unshift({ t: store.now(), created, errors }); db.runs = db.runs.slice(0, 30);
  store.write('veille', db);
  if (!override) store.settings.set({ veille: { lastRun: store.now() } });
  return { created, errors, items: fresh };
}
const veilleItems = () => store.read('veille', { items: [], runs: [] });
function veilleSetStatus(id, status) { const d = veilleItems(); const i = d.items.find((x) => x.id === id); if (i) i.status = status; store.write('veille', d); return true; }

// 3. Briefing du jour
async function briefing({ refreshVeille } = {}) {
  needAI();
  if (refreshVeille && store.settings.get().veille.topics.length) await runVeille().catch(() => {});
  const st = store.settings.get(); const parts = [];
  let cal = { events: [], errors: [] };
  if (st.google.accounts.length) cal = await google.events(3).catch((e) => ({ events: [], errors: [e.message] }));
  parts.push('AGENDA (3 prochains jours) :\n' + (cal.events.map((e) => `- ${e.start} → ${e.title}${e.location ? ' @ ' + e.location : ''} [${e.calendar}]`).join('\n') || '(aucun événement ou agenda non connecté)'));
  const dos = dossiers.upcoming();
  parts.push('DOSSIERS EN COURS & ÉCHÉANCES :\n' + (dossiers.list().items.filter((d) => d.stage !== 'clos').slice(0, 12).map((d) => `- [${dossiers.STAGES.find((s) => s.id === d.stage).label}] ${d.title}${d.deadline ? ' (échéance ' + d.deadline + ')' : ''}`).join('\n') || '(aucun)') + (dos.length ? '\nÉchéances proches : ' + dos.map((d) => d.deadline + ' ' + d.title).join(' ; ') : ''));
  const v = veilleItems().items.filter((i) => i.status === 'new').slice(0, 15);
  parts.push('VEILLE (nouveautés non traitées) :\n' + (v.map((i) => `- (${i.topic}) ${i.title} — ${i.summary.slice(0, 160)} ${i.url}`).join('\n') || '(aucune veille enregistrée)'));
  if (st.mail.briefingIncludesMail) {
    const lines = [];
    for (const a of mail.listAccounts()) { try { for (const m of (await mail.read(a.id, 8)).filter((x) => x.unread)) lines.push(`- ${a.email} | ${m.from} | ${m.subject}`); } catch { /* compte indisponible */ } }
    parts.push('COURRIELS NON LUS (en-têtes seulement) :\n' + (lines.join('\n') || '(aucun)'));
  }
  const out = await llm.complete({
    system: system('MISSION : briefing du matin. Format : ## Période couverte & sources consultées ## À faire aujourd\'hui (priorités) ## Agenda ## Dossiers & échéances ## Veille : ce qui mérite une question ## Courriers à traiter ## Pistes de questions/interpellations (3 max, avec instrument et parlement conseillés). Sépare faits confirmés et éléments à vérifier. Sois concis.'),
    prompt: parts.join('\n\n'), maxTokens: 3500,
  });
  const rec = { t: store.now(), text: out.text, errors: cal.errors };
  store.write('briefing', rec);
  brain.noteUsage('briefing');
  return rec;
}

// Rédaction avec modèle par parlement
async function draft({ instrumentId, subject, context, language, dossierId, instructions }) {
  needAI();
  const tpl = templates.instructions(instrumentId);
  if (!tpl) throw new Error('Modèle introuvable.');
  const f = templates.find(instrumentId); const p = store.settings.get().profile;
  let ctx = context || '';
  if (dossierId) { const d = dossiers.get(dossierId); ctx += '\n\nRECHERCHES DU DOSSIER :\n' + d.research.slice(0, 2).map((r) => r.answer.slice(0, 5000)).join('\n---\n') + (d.notes ? '\n\nNOTES :\n' + d.notes : ''); }
  const lang = ({ fr: 'français', nl: 'néerlandais', en: 'anglais' })[language || p.langue] || 'français';
  const out = await llm.complete({
    system: system(tpl + `\n\nMISSION : rédiger le texte prêt à relire, en ${lang}, au nom de ${p.nom || 'l\'utilisateur'}${p.titre ? ' (' + p.titre + ')' : ''}. N'invente aucun fait : tout élément non sourcé dans le contexte est marqué [À VÉRIFIER]. Pas de préambule : commence directement par le texte.${p.signature ? ' Signature : ' + p.signature : ''}`),
    prompt: `Sujet : ${subject}\n${instructions ? 'Consignes spécifiques : ' + instructions + '\n' : ''}\nCONTEXTE ET FAITS DISPONIBLES :\n${ctx || '(aucun : base-toi sur le sujet et signale tout ce qui doit être vérifié)'}`,
    maxTokens: 5000,
  });
  brain.noteUsage('redaction', { instrument: f.instrument.label, parlement: f.parlement.nom, theme: String(subject).slice(0, 40) });
  brain.learnFromInteraction('redaction', `${f.instrument.label} — ${subject}\n${instructions || ''}`, out.text);
  const rec = { text: out.text, instrumentId, label: f.instrument.label, parlement: f.parlement.nom, subject };
  rec.file = workspace.save(f.parlement.id, 'interpellations', `${f.instrument.label}_${subject}`, `# ${f.instrument.label} — ${subject}\n\n*${f.parlement.nom}*\n\n${out.text}\n`);
  if (dossierId) { const saved = dossiers.addDraft(dossierId, { ...rec, original: out.text }); rec.draftId = saved?.id; }
  return rec;
}

// Assistant libre
async function chat({ messages, useWeb, useDocs }) {
  needAI();
  const last = messages[messages.length - 1].content;
  let extra = '';
  let hits = [];
  if (useDocs) { hits = indexer.search(last, 5); if (hits.length) extra = '\n\nEXTRAITS DES DOCUMENTS DE L\'UTILISATEUR (cite le nom du fichier) :\n' + hits.map((h) => `[${h.name}] ${h.text}`).join('\n\n'); }
  const out = await llm.complete({ system: system('Tu es en conversation libre. Réponds de façon concise.' + extra), messages: messages.slice(-20), web: !!useWeb, maxTokens: 3500 });
  brain.noteUsage('chat');
  brain.learnFromInteraction('chat', last, out.text);
  return { text: out.text, sources: out.sources, docs: hits.map((h) => h.name) };
}

module.exports = { system, needAI, webResearch, analyzeDocument, askIndex, runVeille, veilleItems, veilleSetStatus, briefing, draft, chat, parlementName };
