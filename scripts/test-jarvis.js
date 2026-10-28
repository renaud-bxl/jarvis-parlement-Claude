// Tests de la conversation vocale de Jarvis (routage, parole, écoute, consentement). Autonome, sans réseau : fetch est simulé.
// Lancer : node scripts/test-jarvis.js        (JV_ONLY_CORPUS=1 : seulement la mesure du corpus de routage)
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const vm = require('vm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-jv-'));
process.env.JARVIS_INSECURE_SECRETS = '1'; // test uniquement : pas de trousseau hors Electron
process.env.JARVIS_DATA_DIR = path.join(tmp, 'data'); process.env.JARVIS_DOCS_DIR = path.join(tmp, 'Jarvis-Parlement');

// ---------------------------------------------------------------------------------------------------------------
// Corpus : [phrase dictée, intention attendue (null = laissée au moteur IA / conversation), arguments attendus (sous-chaînes)]
// ---------------------------------------------------------------------------------------------------------------
const CORPUS = [
  // --- Courriels : résumé / contrôle
  ['Check mes mails', 'mails'], ['tiens, check mes mails', 'mails'], ['Jarvis, check mes mails', 'mails'], ['ok Jarvis check mes mails', 'mails'],
  ["est-ce que j'ai de nouveaux mails ?", 'mails'], ["j'ai des nouveaux messages ?", 'mails'], ['vérifie ma boîte mail', 'mails'],
  ["regarde mes courriels s'il te plaît", 'mails'], ['peux-tu checker mes mails', 'mails'], ['pourriez-vous vérifier mes courriels', 'mails'],
  ["je voudrais savoir si j'ai reçu des mails", 'mails'], ['quoi de neuf dans ma boîte de réception', 'mails'], ['résume-moi mes mails', 'mails'],
  ['résume mes courriels non lus', 'mails'], ['chèque mes mails', 'mails'], ['check mes mèles', 'mails'], ['mes mails', 'mails'],
  ['y a-t-il du nouveau dans ma messagerie ?', 'mails'], ['dis-moi si j’ai des e-mails importants', 'mails'], ['checke mon courrier', 'mails'],
  ['quels sont mes mails urgents', 'mails'], ['Bonjour Jarvis, peux-tu regarder mes mails ?', 'mails'], ['regarde si j’ai du nouveau courrier', 'mails'],
  ['Alors, check-moi mes mails', 'mails'], ["euh vérifie mes e-mails s'il vous plaît", 'mails'],
  // --- Courriels : lecture à voix haute
  ['lis-moi le dernier mail de Marie', 'mails_read', { from: 'Marie', index: -1 }], ['lis-moi mes mails', 'mails_read', { all: true }],
  ['lis mes nouveaux messages', 'mails_read'], ['lis le deuxième mail', 'mails_read', { index: 2 }], ['lis-moi le premier courriel', 'mails_read', { index: 1 }],
  ['peux-tu me lire le dernier mail', 'mails_read', { index: -1 }], ['lis tous les mails', 'mails_read', { all: true }],
  ['lis-moi le mail de Jean Dupont', 'mails_read', { from: 'Jean Dupont' }], ['lis le mail numéro 3', 'mails_read', { index: 3 }],
  ['lis-moi les mails de la STIB', 'mails_read', { from: 'STIB' }], ['lecture des mails', 'mails_read'], ['lis le troisième', 'mails_read', { index: 3 }],
  ['je voudrais que tu me lises mes courriels', 'mails_read'],
  // --- Courriels : réponse
  ['réponds-lui que je suis d’accord', 'mail_reply', { instruction: 'je suis d’accord' }],
  ['réponds au premier mail en disant que je confirme', 'mail_reply', { index: 1, instruction: 'je confirme' }],
  ['réponds à Marie que je serai présent', 'mail_reply', { from: 'Marie', instruction: 'je serai présent' }],
  ['réponds au dernier mail', 'mail_reply', { index: -1 }], ['répondre à ce mail', 'mail_reply'],
  ['pourriez-vous répondre au mail de Jean en disant merci', 'mail_reply', { from: 'Jean', instruction: 'merci' }],
  ['je voudrais répondre au deuxième mail', 'mail_reply', { index: 2 }], ['réponds à ce message et dis que je refuse', 'mail_reply', { instruction: 'je refuse' }],
  ['réponds-lui oui, je viendrai', 'mail_reply', { instruction: 'oui, je viendrai' }], ['Jarvis, réponds-lui merci beaucoup pour l’invitation', 'mail_reply'],
  // --- Courriels : rédaction (jamais d'envoi)
  ['écris un mail à Marie', 'mail_compose'], ['envoie un mail au cabinet du ministre', 'mail_compose'], ['rédige-moi un courriel de remerciement', 'mail_compose'],
  ['je voudrais envoyer un message à mon collaborateur', 'mail_compose'], ['prépare un mail pour le chef de groupe', 'mail_compose'],
  // --- Briefing
  ['fais-moi le briefing du jour', 'briefing'], ['mon briefing', 'briefing'], ['quel est le programme du jour', 'briefing'], ['on fait le point sur ma journée', 'briefing'],
  ['donne-moi mon point du jour', 'briefing'], ["qu'est-ce qui m'attend aujourd'hui", 'briefing'], ["prépare mon briefing s'il vous plaît", 'briefing'], ['le brief du matin', 'briefing'],
  // --- Agenda
  ['qu’est-ce que j’ai demain', 'agenda', { days: 2 }], ['Quel est mon agenda demain ?', 'agenda', { days: 2 }], ['résume mon agenda de la semaine', 'agenda', { days: 7 }],
  ["qu'est-ce que j'ai à l'agenda aujourd'hui", 'agenda', { days: 1 }], ["j'ai quoi demain ?", 'agenda', { days: 2 }], ['mes rendez-vous cette semaine', 'agenda', { days: 7 }],
  ['est-ce que j’ai des réunions aujourd’hui', 'agenda', { days: 1 }], ['c’est quoi mon planning de la semaine', 'agenda', { days: 7 }], ['mon emploi du temps demain', 'agenda', { days: 2 }],
  ["qu'est-ce que j'ai de prévu cette semaine", 'agenda', { days: 7 }], ['quelle est ma prochaine réunion', 'agenda'], ['montre-moi mon calendrier', 'agenda'],
  ['qu’est-ce que j’ai après-demain', 'agenda', { days: 3 }], ["je voudrais connaître mon agenda d'aujourd'hui", 'agenda', { days: 1 }],
  // --- Dossiers
  ['quelles sont mes échéances', 'dossiers'], ['mes dossiers en cours', 'dossiers'], ['où en sont mes dossiers', 'dossiers'], ['quelles sont les prochaines échéances', 'dossiers'],
  ['fais le point sur mes dossiers', 'dossiers'],
  // --- Veille
  ['fais-moi une veille sur le logement à Bruxelles', 'veille_topic', { topic: 'le logement à Bruxelles' }], ['fais une veille sur la ZBE', 'veille_topic', { topic: 'la ZBE' }],
  ['je voudrais une veille concernant les crèches', 'veille_topic', { topic: 'les crèches' }], ['peux-tu faire une veille au sujet de la STIB', 'veille_topic', { topic: 'la STIB' }],
  ['veille sur la mobilité douce', 'veille_topic', { topic: 'la mobilité douce' }], ["Jarvis, fais une veille sur le tram 10 s'il te plaît", 'veille_topic', { topic: 'le tram 10' }],
  ['lance une veille sur les prix de l’énergie', 'veille_topic', { topic: 'les prix de l’énergie' }], ["surveille l'actualité sur la propreté publique", 'veille_topic', { topic: 'la propreté publique' }],
  ['fais une vaille sur le climat', 'veille_topic', { topic: 'le climat' }], ['fais une veille', 'veille_topic', { topic: '' }],
  ['lance la veille', 'veille_run'], ['actualise ma veille', 'veille_run'], ['mets à jour la veille', 'veille_run'], ['fais la veille du jour', 'veille_run'], ["relance la veille s'il te plaît", 'veille_run'],
  // --- Recherche
  ['fais une recherche sur la ZBE', 'recherche', { query: 'la ZBE' }], ['recherche les antécédents parlementaires sur le tram 10', 'recherche', { query: 'le tram 10' }],
  ['je voudrais une recherche approfondie sur les crèches à Bruxelles', 'recherche', { query: 'les crèches à Bruxelles' }], ['cherche des informations sur le budget 2026', 'recherche', { query: 'le budget 2026' }],
  ['documente-moi sur le logement social', 'recherche', { query: 'le logement social' }], ['recherche sur la 5G', 'recherche', { query: '5G' }],
  // --- Rédaction parlementaire
  ['rédige-moi une interpellation sur le logement', 'redaction', { subject: 'le logement', kind: 'interpellation' }], ['rédige une question écrite sur les crèches', 'redaction', { subject: 'les crèches', kind: 'question écrite' }],
  ["prépare une question d'actualité sur la ZBE", 'redaction', { subject: 'la ZBE', kind: "question d'actualité" }], ['écris une question orale à propos de la propreté', 'redaction', { subject: 'la propreté', kind: 'question orale' }],
  ['je voudrais rédiger une résolution concernant le climat', 'redaction', { subject: 'le climat', kind: 'résolution' }], ['rédige-moi une interpellation', 'redaction', { subject: '' }],
  ['peux-tu me rédiger une question sur le tram 10 ?', 'redaction', { subject: 'le tram 10' }], ['Jarvis rédige une interpellation sur la sécurité dans le métro', 'redaction', { subject: 'la sécurité dans le métro' }],
  // --- Documents
  ['cherche dans mes documents le budget mobilité', 'documents', { query: 'le budget mobilité' }], ["qu'est-ce qu'il y a dans mes documents sur la propreté", 'documents', { query: 'la propreté' }],
  ['retrouve dans mes fichiers le rapport sur le tram', 'documents', { query: 'le rapport sur le tram' }], ['recherche dans mes documents tout ce qui concerne le CPAS', 'documents'],
  ['dans mes documents, que dit-on du budget 2026', 'documents'],
  // --- Mémoire
  ['retiens que je préfère des questions courtes', 'remember', { text: 'je préfère des questions courtes' }], ['souviens-toi que je suis membre de la commission mobilité', 'remember', { text: 'je suis membre de la commission mobilité' }],
  ["n'oublie pas que je préfère le tutoiement", 'remember', { text: 'je préfère le tutoiement' }], ['note que mon groupe s’appelle Ecolo', 'remember', { text: 'mon groupe s’appelle Ecolo' }],
  ['retiens ça : je veux des réponses en trois phrases', 'remember', { text: 'je veux des réponses en trois phrases' }], ['Jarvis retiens que je préfère être appelé Monsieur le député', 'remember'],
  // --- Navigation
  ['ouvre les dossiers', 'navigate', { page: 'dossiers' }], ['ouvre l’agenda', 'navigate', { page: 'agenda' }], ['va dans les réglages', 'navigate', { page: 'reglages' }],
  ['ouvre mes documents', 'navigate', { page: 'documents' }], ['retourne à l’accueil', 'navigate', { page: 'accueil' }], ['emmène-moi à la veille', 'navigate', { page: 'veille' }],
  ['ouvre la mémoire', 'navigate', { page: 'cerveau' }], ['ouvre les courriels', 'navigate', { page: 'courriels' }], ['ouvre le diagnostic', 'navigate', { page: 'diagnostic' }],
  ['ouvre les paramètres', 'navigate', { page: 'reglages' }], ['ouvre le tableau de bord', 'navigate', { page: 'tableau' }], ["s'il te plaît, ouvre la page de rédaction", 'navigate', { page: 'redaction' }],
  // --- Aide, politesse, contrôle de la voix
  ['que sais-tu faire ?', 'help'], ["qu'est-ce que tu peux faire", 'help'], ['aide', 'help'], ['que pouvez-vous faire pour moi', 'help'], ['tu peux faire quoi', 'help'],
  ['merci', 'thanks'], ['merci Jarvis', 'thanks'], ['super, merci', 'thanks'], ['ok merci beaucoup', 'thanks'], ["c'est bon, merci", 'thanks'], ['parfait merci Jarvis', 'thanks'],
  ["merci c'est tout", 'thanks'], ['au revoir', 'thanks'], ['à plus tard', 'thanks'],
  ['annule', 'cancel'], ['laisse tomber', 'cancel'], ['non merci', 'cancel'], ['rien', 'cancel'],
  ['stop', 'stop'], ['arrête', 'stop'], ['tais-toi', 'stop'], ['chut', 'stop'], ['ça suffit', 'stop'], ['silence', 'stop'], ['Jarvis stop', 'stop'], ['arrête de parler', 'stop'], ['ok stop', 'stop'],
  ['répète', 'repeat'], ['répète ça', 'repeat'], ['peux-tu répéter ?', 'repeat'], ['redis-moi ça', 'repeat'], ['pardon ?', 'repeat'], ['tu peux répéter la dernière phrase', 'repeat'],
  ["je n'ai pas compris", 'repeat'], ['comment ?', 'repeat'],
  ['lis-moi le texte', 'read_last'], ['lis-moi ça à voix haute', 'read_last'], ['lis la réponse', 'read_last'], ['lis-moi le brouillon', 'read_last'],
  ['plus lentement', 'speech_rate', { dir: -1 }], ['parle plus lentement', 'speech_rate', { dir: -1 }], ['tu peux parler moins vite', 'speech_rate', { dir: -1 }], ['ralentis un peu', 'speech_rate', { dir: -1 }],
  ['plus vite', 'speech_rate', { dir: 1 }], ["parle plus vite s'il te plaît", 'speech_rate', { dir: 1 }], ['accélère', 'speech_rate', { dir: 1 }], ['vitesse normale', 'speech_rate', { dir: 0 }],
  ['change de parlement', 'parlement_switch', { name: '' }], ['passe au parlement fédéral', 'parlement_switch', { name: 'fédéral' }], ['bascule sur le parlement Benelux', 'parlement_switch', { name: 'Benelux' }],
  ['utilise le Parlement wallon', 'parlement_switch', { name: 'wallon' }], ['je veux changer de parlement', 'parlement_switch', { name: '' }],
  ['nouvelle conversation', 'new_conversation'], ['on recommence', 'new_conversation'], ['efface la conversation', 'new_conversation'], ["oublie ce qu'on s'est dit", 'new_conversation'], ['repartons de zéro', 'new_conversation'],
  ['bonjour', 'hello'], ['salut Jarvis', 'hello'], ['tu es là ?', 'hello'], ["tu m'entends ?", 'hello'], ['coucou', 'hello'], ['Bonjour Jarvis, check mes mails', 'mails'],
  ['oui', 'ack'], ['non', 'ack'],
  // --- Boîte mail intelligente (tri, réactions, événements) : Jarvis n'ajoute jamais rien lui-même
  ['trie mes mails', 'mails'], ['quels mails sont importants', 'mails'], ["qu'est-ce qui attend ma réaction", 'mails'], ['as-tu des invitations dans mes mails', 'mails'], ['est-ce que j’ai des événements dans mes courriels', 'mails'],
  ['ajoute-le à mon agenda', 'mails', { addEvent: true }], ['mets cet événement dans mon agenda', 'mails', { addEvent: true }], ["qu'est-ce que je dois répondre", 'mails'], ['classe mes courriels par priorité', 'mails'], ['y a-t-il des mails sans réponse', 'mails'],
  // --- Garde-fous : Jarvis ne supprime / n'envoie jamais de lui-même
  ['supprime tous mes mails', 'safety'], ['efface le dossier Tram 10', 'safety'], ['vide la corbeille', 'safety'], ['supprime le dernier mail', 'safety'],
  // --- Vide / bruit / hallucinations de transcription
  ['', 'empty'], ['   ', 'empty'], ["Sous-titres réalisés par la communauté d'Amara.org", 'empty'], ["Merci d'avoir regardé cette vidéo", 'empty'], ['...', 'empty'], ['Sous-titrage ST’ 501', 'empty'],
  // --- Doivent rester au moteur IA (conversation / compréhension libre)
  ['quelle est la capitale de la Belgique', null], ['explique-moi la différence entre une interpellation et une question orale', null], ['raconte-moi une blague', null],
  ['combien de députés siègent au parlement bruxellois', null], ['réponds-moi simplement', null], ["qu'est-ce que dit la presse sur le tram 10", null],
  ['fais le point sur la réforme du stationnement', null], ['quelle heure est-il', null], ['traduis ce texte en néerlandais', null], ['ça va ?', null],
  ['est-ce que la ZBE est légale', null], ["peux-tu m'expliquer ce qu'est un CPAS", null], ['check la météo', null], ['écris un poème sur Bruxelles', null],
  ['écris-moi un discours sur la sécurité', null], ['le deuxième', null], ["qu'est-ce que tu penses de la ZBE", null], ['donne-moi trois arguments pour la gratuité des transports', null],
];

const MOD = process.env.JV_MODULE || '../src/jarvis';
const jv = require(MOD);
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'").trim();
const argOk = (got, exp) => (typeof exp === 'string' ? fold(got).includes(fold(exp)) : exp === got || (typeof exp === 'boolean' && !!got === exp));

function scoreCorpus(verbose) {
  const fails = []; let pass = 0;
  for (const [text, want, args] of CORPUS) {
    let r; try { r = jv.fastRoute(text); } catch (e) { r = { intent: 'ERREUR ' + e.message }; }
    const got = r ? r.intent : null; let ok = got === want;
    if (ok && args) for (const k of Object.keys(args)) if (!argOk((r.args || {})[k], args[k])) { ok = false; break; }
    if (ok) pass++; else fails.push({ text, want, got, args: r && r.args, wantArgs: args });
  }
  return { pass, total: CORPUS.length, fails };
}

const sc = scoreCorpus();
console.log(`Corpus de routage : ${sc.pass}/${sc.total} (${(100 * sc.pass / sc.total).toFixed(1)} %)`);
if (process.env.JV_VERBOSE || process.env.JV_ONLY_CORPUS) for (const f of sc.fails) console.log('  ✗', JSON.stringify(f.text), '→', f.got, JSON.stringify(f.args || {}), '| attendu', f.want, JSON.stringify(f.wantArgs || {}));

// ---------------------------------------------------------------------------------------------------------------
// Jeu « tenu à l'écart » : écrit après la mise au point des règles, mesure la généralisation.
const HELD = [
  ['dis donc Jarvis, tu peux me dire si j’ai reçu quelque chose d’important par mail ?', 'mails'], ['regarde un peu ma boîte de réception', 'mails'], ['je dois checker mes courriels là', 'mails'],
  ['qu’est-ce qu’il y a de nouveau dans mes mails', 'mails'], ['fais-moi un résumé de mes courriels', 'mails'], ['mes courriels non lus s’il te plaît', 'mails'], ['jette un œil à mes messages', 'mails'],
  ['Jarvis tu veux bien vérifier si j’ai des nouveaux e-mails', 'mails'], ['lis-moi le dernier courriel de la ministre', 'mails_read', { index: -1 }], ['lis-moi le courriel du cabinet', 'mails_read', { from: 'cabinet' }],
  ['lis-moi mes messages non lus', 'mails_read'], ['tu peux me lire le premier message', 'mails_read', { index: 1 }], ['lis le quatrième mail', 'mails_read', { index: 4 }],
  ['réponds à Jean-Pierre que je le rappelle demain', 'mail_reply', { from: 'Jean-Pierre', instruction: 'je le rappelle demain' }], ['réponds-lui que je ne pourrai pas venir', 'mail_reply', { instruction: 'je ne pourrai pas venir' }],
  ['réponds au deuxième mail pour dire que je suis d’accord', 'mail_reply', { index: 2, instruction: 'je suis d’accord' }], ['tu peux répondre à ce courriel s’il te plaît', 'mail_reply'],
  ['écris un courriel à la présidente de la commission', 'mail_compose'], ['peux-tu m’envoyer un e-mail de rappel à mon équipe', 'mail_compose'],
  ['donne-moi mon briefing', 'briefing'], ['jarvis le point du jour', 'briefing'], ['qu’est-ce que j’ai de prévu cet après-midi', 'agenda', { days: 1 }], ['j’ai des réunions demain ?', 'agenda', { days: 2 }],
  ['dis-moi mon agenda pour la semaine', 'agenda', { days: 7 }], ['mon calendrier de demain', 'agenda', { days: 2 }], ['est-ce que j’ai un rendez-vous aujourd’hui', 'agenda', { days: 1 }],
  ['quelles échéances ai-je cette semaine', 'dossiers'], ['donne-moi l’état de mes dossiers en cours', 'dossiers'],
  ['je voudrais que tu me fasses une veille sur les loyers à Ixelles', 'veille_topic', { topic: 'les loyers à Ixelles' }], ['fais une veille concernant l’enseignement qualifiant', 'veille_topic', { topic: 'l’enseignement qualifiant' }],
  ['veille au sujet de la police zonale', 'veille_topic', { topic: 'la police zonale' }], ['lance une veille à propos du budget régional', 'veille_topic', { topic: 'le budget régional' }],
  ['relance toutes mes veilles', 'veille_run'], ['mets à jour mes veilles', 'veille_run'],
  ['effectue une recherche sur le plan Good Move', 'recherche', { query: 'le plan Good Move' }], ['cherche des informations concernant les maisons de repos', 'recherche', { query: 'les maisons de repos' }],
  ['rédige une question d’actualité à propos du tram 9', 'redaction', { subject: 'le tram 9', kind: 'actualité' }], ['peux-tu rédiger une interpellation concernant la propreté à Schaerbeek', 'redaction', { subject: 'la propreté à Schaerbeek', kind: 'interpellation' }],
  ['prépare-moi une proposition de résolution sur le climat', 'redaction', { subject: 'le climat' }], ['écris une question écrite sur les subsides culturels', 'redaction', { subject: 'les subsides culturels', kind: 'écrite' }],
  ['trouve dans mes documents le rapport de la Cour des comptes', 'documents'], ['qu’est-ce qui est écrit dans mes notes sur la sécurité routière', 'documents'],
  ['souviens-toi que mon collaborateur s’appelle Karim', 'remember', { text: 'mon collaborateur s’appelle Karim' }], ['note bien que je préfère les réponses courtes', null],
  ['va à la page des réglages', 'navigate', { page: 'reglages' }], ['ouvre-moi mes courriels', 'navigate', { page: 'courriels' }], ['direction l’agenda', 'navigate', { page: 'agenda' }],
  ['tu fais quoi comme choses', null], ['merci beaucoup Jarvis, bonne journée', 'thanks'], ['très bien merci', 'thanks'], ['arrête-toi', 'stop'], ['stop Jarvis, ça suffit', 'stop'],
  ['tu peux répéter s’il te plaît', 'repeat'], ['redis ça', 'repeat'], ['plus doucement s’il te plaît', 'speech_rate', { dir: -1 }], ['parle un peu plus vite', 'speech_rate', { dir: 1 }],
  ['remets la vitesse normale', 'speech_rate', { dir: 0 }], ['je voudrais travailler sur le parlement wallon', 'parlement_switch', { name: 'wallon' }], ['on change de parlement', 'parlement_switch'],
  ['démarre une nouvelle conversation', 'new_conversation'], ['lis-moi le résumé', 'read_last'], ['supprime ce dossier', 'safety'], ['envoie directement la question au ministre', 'safety'],
  ['merci d’avoir regardé', 'empty'], ['Sous-titrage Société Radio-Canada', 'empty'], ['euh', 'empty'],
  ['quel temps fait-il à Bruxelles', null], ['donne-moi la liste des commissions du parlement bruxellois', null], ['résume-moi cet article', null], ['pourquoi la STIB a augmenté ses tarifs', null],
  ['réponds à ma question : combien y a-t-il de communes à Bruxelles', null], ['lis ce paragraphe et corrige les fautes', null], ['écris-moi un résumé de la séance', null],
];


let hp = 0; const hfail = [];
for (const [text, want, args] of HELD) {
  const r = jv.fastRoute(text); const got = r ? r.intent : null; let ok = got === want;
  if (ok && args) for (const k of Object.keys(args)) if (!argOk((r.args || {})[k], args[k])) ok = false;
  if (ok) hp++; else hfail.push([text, got, want]);
}
console.log(`Jeu tenu à l'écart : ${hp}/${HELD.length} (${(100 * hp / HELD.length).toFixed(1)} %)`);
if (process.env.JV_VERBOSE) for (const f of hfail) console.log('  ✗', JSON.stringify(f));
if (process.env.JV_ONLY_CORPUS) { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); }
const loadUi = (file) => {
  const J0 = {}; const win = { speechSynthesis: null }; const doc = { addEventListener() {}, getElementById() { return null; }, createElement() { return {}; }, querySelectorAll() { return []; }, querySelector() { return null; }, body: {} };
  const ctx = { window: win, document: doc, navigator: {}, console, setTimeout, clearTimeout, performance, Audio: function () {}, MutationObserver: function () { this.observe = () => {}; }, requestAnimationFrame() {}, getComputedStyle: () => ({}), localStorage: { getItem() { return null; }, setItem() {} }, btoa, atob, TextEncoder };
  win.document = doc; vm.createContext(ctx); vm.runInContext(fs.readFileSync(file, 'utf8'), ctx); return win.J;
};


let lastBody = null; let fetchMode = 'ok';
global.fetch = async (url, opts) => {
  if (fetchMode === 'down') { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }
  const body = JSON.parse(opts.body); lastBody = body; const sys = String(body.system || ''); let text = 'OK';
  if (sys.includes('module de compréhension')) text = fetchMode === 'garbage' ? 'je ne sais pas' : JSON.stringify(global.__route || { intent: 'chat', args: {} });
  else if (sys.includes('veille parlementaire')) text = JSON.stringify({ items: [] });
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) };
};

(async () => {
  const ok = (m) => console.log('  ✓', m);
  assert(sc.pass / sc.total >= 0.98, 'corpus de routage < 98 %'); ok(`corpus de routage ≥ 98 % (${sc.pass}/${sc.total})`);
  assert(hp / HELD.length >= 0.95, 'jeu tenu à l\'écart < 95 %'); ok('généralisation (jeu tenu à l\'écart) ≥ 95 %');

  // --- Garde-fous : aucune intention destructrice
  const store = require('../src/store'); const llm = require('../src/llm'); const mail = require('../src/mail'); const mailbox = require('../src/mailbox');
  assert(!Object.keys(jv.ACTIONS).some((k) => /^(send|delete|remove|supprime|envoie|depose|publish)/.test(k))); ok('aucune action d\'envoi / de suppression / de dépôt');
  for (const p of ['supprime tous mes mails', 'envoie-le sans me demander', 'dépose la question maintenant', 'efface mes dossiers', 'vide la corbeille']) assert.strictEqual(jv.fastRoute(p).intent, 'safety', p);
  let r = await jv.command({ text: 'supprime tous mes mails' }); assert(/ne supprime|jamais/.test(r.say) && r.intent === 'safety'); ok('« supprime… / envoie… / dépose… » : refus poli, rien n\'est fait');
  assert.strictEqual(jv.fastRoute('ajoute-le à mon agenda').intent, 'mails'); ok('« ajoute-le à mon agenda » ouvre la boîte intelligente (aucun ajout automatique)');

  // --- Bruit / hallucinations : mêmes verdicts côté serveur et côté écran
  const J = loadUi(path.join(__dirname, '..', 'renderer', 'ui.js'));
  const noises = ["Sous-titres réalisés par la communauté d'Amara.org", "Merci d'avoir regardé cette vidéo", 'Sous-titrage ST’ 501', '...', '', '[Musique]', 'euh', 'merci merci merci merci merci merci'];
  const goods = ['Check mes mails', 'Merci', 'oui', 'Quel est mon agenda demain ?', 'stop'];
  for (const n of noises) { assert(jv.isNoise(n), 'serveur : ' + n); assert(J.isNoise(n), 'écran : ' + n); assert.strictEqual(J.cleanHeard(n), ''); }
  for (const g of goods) { assert(!jv.isNoise(g), 'serveur : ' + g); assert(!J.isNoise(g), 'écran : ' + g); }
  assert.strictEqual(J.cleanHeard('jarvis, check mes mails'), 'Check mes mails'); assert.strictEqual(J.cleanHeard('check mes mails check mes mails'), 'Check mes mails'); assert.strictEqual(J.cleanHeard('  vérifie   mes courriels Jarvis. '), 'Vérifie mes courriels'); ok('transcription : bruit et hallucinations écartés, « Jarvis » retiré, majuscule, doublons');

  // --- Parole française
  const T = (x) => J.speechText(x);
  assert.strictEqual(T('Rendez-vous le 27/10/2026 à 14h30.'), 'Rendez-vous le vingt-sept octobre deux mille vingt-six à quatorze heures trente.');
  assert(/zède bé eu/.test(T('La ZBE.')) && /emme erre/.test(T('Le MR et le PS.')) && /pé esse/.test(T('Le MR et le PS.')) && /\bstib\b/.test(T('La STIB.'))); ok('sigles ZBE / MR / PS épelés, STIB prononcé');
  assert.strictEqual(T('Coût : 1 234,50 €.'), 'Coût: mille deux cent trente-quatre euros cinquante.'); assert(/douze virgule cinq pour cent/.test(T('hausse de 12,5 %'))); assert(/septante.*nonante/.test(T('70 et 90'))); assert(/quatre-vingts/.test(T('80'))); assert(/premier novembre/.test(T('le 1er novembre'))); assert(/numéro quarante-cinq/.test(T('n° 45'))); assert(/article douze/.test(T('art. 12'))); ok('nombres, euros, pourcentages, dates, heures, ordinaux, « n° », « art. » (septante / nonante)');
  assert(!/[\u{1F300}-\u{1FAFF}]|https?:|www\./u.test(T('Super 🚀 voir https://exemple.be/a et www.stib.be 👍'))); assert(!/[*#|_`]/.test(T('## Titre\n**gras** et _italique_ `code`\n| a | b |\n|---|---|\n| 1 | 2 |'))); ok('emojis, URLs, markdown et tableaux jamais lus');
  assert(/, aparté,/.test(T('Phrase (aparté) suite.')) && !/\(/.test(T('(note) texte'))); ok('parenthèses : lues comme un aparté, sans symbole');
  const long = Array(40).fill('Ceci est une phrase assez longue pour tester le découpage.').join(' '); const ch = J.chunks(long);
  assert(ch.length > 3 && ch.every((c) => c.length <= 300) && ch[0].length <= 140 && ch.every((c) => /[.!?]$/.test(c))); ok('découpage aux phrases, premier morceau court (démarrage rapide)');
  assert.strictEqual(JSON.stringify(J.chunks('Bonjour. Ça va ?')), '["Bonjour. Ça va?"]'); assert.strictEqual(J.chunks('  ').length, 0); ok('chunks : phrases courtes regroupées, texte vide ignoré');

  // --- Commandes de contrôle de la voix et de la conversation
  store.settings.set({ profile: { nom: 'Camille Martin', parlements: ['bxl-pb', 'be-chambre', 'wallon'], parlementActif: 'bxl-pb' }, ai: { provider: 'anthropic' } });
  store.setSecret('anthropic_key', 'sk-test');
  r = await jv.command({ text: 'plus lentement' }); assert(r.settingsChanged && store.settings.get().voice.ttsRate < 1); const slow = store.settings.get().voice.ttsRate;
  r = await jv.command({ text: 'parle plus vite' }); assert(store.settings.get().voice.ttsRate > slow); r = await jv.command({ text: 'vitesse normale' }); assert.strictEqual(store.settings.get().voice.ttsRate, 1);
  for (let i = 0; i < 6; i++) await jv.command({ text: 'plus lentement' }); assert(store.settings.get().voice.ttsRate >= 0.6); r = await jv.command({ text: 'plus lentement' }); assert(/aussi lentement/.test(r.say)); await jv.command({ text: 'vitesse normale' }); ok('« plus lentement / plus vite / vitesse normale » règlent la vitesse (bornée 0,6–1,5)');
  r = await jv.command({ text: 'passe au parlement wallon' }); assert(r.refreshParlement && store.settings.get().profile.parlementActif === 'wallon'); r = await jv.command({ text: 'bascule sur le parlement fédéral' }); assert.strictEqual(store.settings.get().profile.parlementActif, 'be-chambre');
  r = await jv.command({ text: 'change de parlement' }); assert(/3 parlements/.test(r.say)); r = await jv.command({ text: 'passe au parlement Benelux' }); assert(/pas dans votre liste/.test(r.say) && r.navigate === 'parlements'); ok('changement de parlement actif (liste de l\'utilisateur, ambiguïtés, parlement absent)');
  r = await jv.command({ text: 'stop' }); assert(r.stop && r.silent && r.say === ''); r = await jv.command({ text: 'merci' }); assert(r.end === true && /plaisir/.test(r.say)); r = await jv.command({ text: 'annule' }); assert(r.end === true && r.intent === 'cancel'); ok('« stop » silencieux, « merci » et « annule » terminent');
  r = await jv.command({ text: 'bonjour' }); const first = r.say; assert(/Camille/.test(first)); r = await jv.command({ text: 'répète' }); assert(r.repeat && r.say === first); r = await jv.command({ text: 'nouvelle conversation' }); assert(r.newConversation); r = await jv.command({ text: 'répète' }); assert(r.repeat && /repart de zéro/.test(r.say)); ok('« répète » rejoue la dernière phrase ; « nouvelle conversation » remet à zéro');
  r = await jv.command({ text: 'lis-moi le texte' }); assert(r.readLast); r = await jv.command({ text: '' }); assert.strictEqual(r.intent, 'empty'); r = await jv.command({ text: "Merci d'avoir regardé" }); assert.strictEqual(r.intent, 'empty'); ok('« lis-moi le texte » et texte vide / hallucination');

  // --- Consentement cloud avant d'envoyer des mails au moteur en ligne : oui / non / toujours
  mail.addAccount({ email: 'moi@exemple.be', imapHost: 'imap.exemple.be', smtpHost: 'smtp.exemple.be', imapPass: 'x' });
  const calls = []; const msg = { id: 'k', fromName: 'Marie', subject: 'RDV', message: { subject: 'RDV', from: 'Marie <m@x.be>' } };
  mailbox.triage = async (o) => { calls.push(o); return { total: 1, counts: { reaction: 1, event: 0 }, groups: { reaction: ['k'], event: [], important: [], info: [], promo: [] }, items: { k: msg }, errors: [], consentNeeded: !!o.rulesOnly }; }; mailbox.getMessage = () => msg.message;
  store.settings.set({ jarvis: { cloudMailOk: false } });
  r = await jv.command({ text: 'check mes mails' }); assert(r.confirm && /oui, toujours/.test(r.say) && calls.length === 0); ok('mails + moteur en ligne : demande de consentement, rien n\'est envoyé avant la réponse');
  r = await jv.command({ text: 'non', pending: r.confirm }); assert(calls.length === 1 && calls[0].allowCloud === false && calls[0].rulesOnly === true); ok('« non » : tri simple local, aucune donnée transmise');
  r = await jv.command({ text: 'check mes mails' }); r = await jv.command({ text: 'oui', pending: r.confirm }); assert(calls[calls.length - 1].allowCloud === true && store.settings.get().jarvis.cloudMailOk === false); ok('« oui » : autorisé une seule fois');
  r = await jv.command({ text: 'check mes mails' }); r = await jv.command({ text: 'oui, toujours', pending: r.confirm }); assert(store.settings.get().jarvis.cloudMailOk === true); r = await jv.command({ text: 'check mes mails' }); assert(!r.confirm && calls[calls.length - 1].allowCloud === true); ok('« oui, toujours » : mémorisé, plus de question');
  store.settings.set({ jarvis: { cloudMailOk: false } }); r = await jv.command({ text: 'check mes mails' }); r = await jv.command({ text: 'fais-moi le briefing', pending: r.confirm }); assert(r.intent === 'briefing'); ok('une autre demande à la place de la réponse est traitée normalement (aucun consentement implicite)');
  for (const [t, v] of [['oui', true], ['ouais', true], ['d\'accord', true], ['oui toujours', 'always'], ['oui, à chaque fois', 'always'], ['non', false], ['non merci', false], ['surtout pas', false], ['peut-être', null], ['check mes mails', null]]) assert.strictEqual(jv.parseConfirm(t), v, t); ok('lecture de oui / non / toujours');

  // --- Routeur IA : JSON validé, repli propre
  const S = jv.sanitizeRoute;
  assert.deepStrictEqual(S({ intent: 'envoyer_tout', args: {} }), { intent: 'chat', args: {} }); assert.deepStrictEqual(S(null), { intent: 'chat', args: {} }); assert.deepStrictEqual(S('x'), { intent: 'chat', args: {} });
  assert.strictEqual(S({ intent: 'Mails' }).intent, 'mails'); assert.strictEqual(S({ intent: 'check_mails' }).intent, 'mails'); assert.strictEqual(S({ intent: 'delete_all' }).intent, 'chat');
  assert.strictEqual(S({ intent: 'agenda', args: { days: '99' } }).args.days, 1); assert.strictEqual(S({ intent: 'agenda', args: { days: 7 } }).args.days, 7); assert.strictEqual(S({ intent: 'veille_topic', args: { topic: { x: 1 } } }).args.topic, ''); assert.strictEqual(S({ intent: 'mail_reply', args: { instruction: 'ok' } }).args.last, true); ok('sanitizeRoute : intention inconnue → chat, arguments typés et bornés');
  global.__route = { intent: 'veille_topic', args: { topic: 'les tarifs de la STIB' } }; let rr = await jv.route('euh dis donc la stib elle augmente ses prix je voudrais surveiller ça', []); assert.deepStrictEqual(rr, { intent: 'veille_topic', args: { topic: 'les tarifs de la STIB' } });
  global.__route = { intent: 'supprimer_les_mails', args: {} }; rr = await jv.route('x', []); assert.strictEqual(rr.intent, 'chat'); fetchMode = 'garbage'; rr = await jv.route('x', []); assert.strictEqual(rr.intent, 'chat'); assert(!rr.degraded);
  fetchMode = 'down'; rr = await jv.route('x', []); assert(rr.degraded && rr.intent === 'chat'); r = await jv.command({ text: 'dis donc quelle est la capitale du Bénélux' }); assert(r.ok === false && /Les commandes simples/.test(r.say)); fetchMode = 'ok'; ok('routeur IA : réponse invalide → chat ; moteur injoignable → message clair + commandes locales');
  console.log('\nTous les tests Jarvis passent ✅'); fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('\n❌ ÉCHEC :', e); process.exit(1); });
