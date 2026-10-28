// Diagnostic complet de l'installation : chaque contrôle dit clairement ce qui va bien, ce qui ne va pas et quoi faire.
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');
const llm = require('./llm');
const mail = require('./mail');
const indexer = require('./indexer');
const brain = require('./brain');
const scheduler = require('./scheduler');
const google = require('./google');
const voice = require('./voice');
const workspace = require('./workspace');

const withTimeout = (p, ms, msg) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(msg)), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

// Un exécutable natif valide : présent, exécutable, et au format Mach-O (macOS).
function binaryState(file) {
  if (!file) return { ok: false, why: 'absent' };
  try {
    fs.accessSync(file, fs.constants.X_OK);
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
    const magic = b.toString('hex');
    if (!['cffaedfe', 'cafebabe', 'feedfacf', 'bebafeca', 'cefaedfe'].includes(magic)) return { ok: false, why: 'format invalide' };
    return { ok: true };
  } catch (e) { return { ok: false, why: e.code === 'EACCES' ? 'non exécutable' : 'illisible' }; }
}

async function run(version = '1.0.0', opts = {}) {
  const checks = []; const add = (name, status, detail) => checks.push({ name, status, detail });
  const st = store.settings.get();
  const guard = async (name, fn) => { try { await fn(); } catch (e) { add(name, 'ko', 'Contrôle impossible : ' + (e.message || e)); } };

  add('Application', 'ok', `Jarvis Parlement ${version} · macOS ${os.release()} · ${os.arch()} · Node ${process.versions.node}`);

  await guard('Dossier de données', async () => {
    try { fs.accessSync(store.DIR, fs.constants.W_OK); add('Dossier de données', 'ok', store.DIR); }
    catch { add('Dossier de données', 'ko', 'Non accessible en écriture : ' + store.DIR + '. Vérifie les droits du dossier ou l\'espace disque.'); }
    const bad = store.corruptFiles();
    if (bad.length) add('Intégrité des données', 'warn', `${bad.length} fichier(s) illisible(s) mis de côté (${bad.slice(0, 3).join(', ')}) : la dernière sauvegarde a été restaurée si elle existait. Ouvre le dossier de données pour les récupérer.`);
  });

  await guard('Chiffrement des secrets', async () => {
    const plain = store.plainSecretNames();
    if (!store.canEncrypt()) add('Chiffrement des secrets', 'ko', "Le trousseau chiffré de macOS est indisponible : Jarvis refuse d'enregistrer clés et mots de passe. Déverrouille la session macOS puis relance l'application.");
    else if (plain.length) add('Chiffrement des secrets', 'warn', `${plain.length} secret(s) hérité(s) d'une ancienne version sont encodés sans chiffrement : ressaisis-les dans Réglages (${plain.slice(0, 4).join(', ')}).`);
    else add('Chiffrement des secrets', 'ok', 'Trousseau macOS (safeStorage) actif');
  });

  add('Profil', st.profile.nom ? 'ok' : 'warn', st.profile.nom ? `${st.profile.nom} · ${st.profile.parlements.join(', ')}` : 'Profil non renseigné (Réglages › Profil)');

  await guard('Moteur IA', async () => {
    if (!llm.configured()) { add('Moteur IA', 'ko', 'Non configuré : ajoute ta clé ou choisis un modèle dans Réglages › Moteur IA.'); return; }
    try { const p = await withTimeout(llm.ping(), 10000, 'délai dépassé (10 s)'); add('Moteur IA', 'ok', `${p.model} répond en ${p.ms} ms · ${llm.isLocal() ? 'local (rien ne quitte cet ordinateur)' : 'cloud (l\'envoi de documents et courriels demande ton accord à chaque fois)'}`); }
    catch (e) { add('Moteur IA', 'ko', 'Moteur injoignable ou refusé : ' + e.message); }
  });
  add('Recherche web', st.ai.webSearch ? (st.ai.provider === 'anthropic' ? 'ok' : 'warn') : 'warn', st.ai.webSearch ? (st.ai.provider === 'anthropic' ? 'Outil de recherche web de Claude' : 'Recherche de secours (DuckDuckGo) — moins fiable') : 'Désactivée');

  // ---- Voix ----
  await guard('Voix', async () => {
    const bins = voice.binaries(); const vs = voice.status();
    const sp = binaryState(bins.speak);
    const cur = vs.voices.find((v) => v.id === st.voice.piperVoice) || vs.voices[0];
    const installed = vs.voices.filter((v) => v.installed).map((v) => v.label);
    if (st.voice.engine === 'system') add('Voix (parler)', 'ok', 'Voix du système macOS (Réglages › Voix pour passer à une voix humaine).');
    else if (!sp.ok) add('Voix (parler)', 'ko', `Moteur vocal « jarvis-speak » ${sp.why}${bins.speak ? ' (' + bins.speak + ')' : ''} : réinstalle la dernière version de l'app, ou choisis la voix système dans Réglages › Voix.`);
    else if (!cur.installed) add('Voix (parler)', 'warn', `Moteur vocal présent, mais la voix « ${cur.label} » n'est pas installée${installed.length ? ' (installées : ' + installed.join(', ') + ')' : ''} : Réglages › Voix › Installer.`);
    else add('Voix (parler)', 'ok', `Voix humaine « ${cur.label} » prête (moteur jarvis-speak ${process.arch}).`);
    const ls = binaryState(bins.listen);
    if (!ls.ok) add('Écoute (assistant jarvis-listen)', st.voice.stt === 'whisper' && voice.engine() === 'whisper' ? 'warn' : 'ko', `Assistant de reconnaissance vocale ${ls.why}${bins.listen ? ' (' + bins.listen + ')' : ''} : réinstalle la dernière version de l'app.`);
    else add('Écoute (assistant jarvis-listen)', 'ok', 'Assistant de reconnaissance vocale macOS présent.');
    add('Reconnaissance vocale', voice.configured() ? 'ok' : 'warn', voice.configured() ? `Moteur : ${voice.engine() === 'macos' ? 'reconnaissance macOS (sur l\'appareil quand possible)' : 'Whisper (serveur compatible OpenAI)'}` : 'Aucun moteur d\'écoute disponible (Réglages › Voix).');
    const sys = opts.systemPreferences;
    if (sys && process.platform === 'darwin') {
      const m = sys.getMediaAccessStatus('microphone');
      add('Autorisation du micro', m === 'granted' ? 'ok' : m === 'not-determined' ? 'warn' : 'ko',
        m === 'granted' ? 'Micro autorisé.' : m === 'not-determined' ? "Pas encore demandée : elle sera demandée au premier usage du micro." : `Micro ${m === 'denied' ? 'refusé' : 'restreint'} : Réglages Système › Confidentialité et sécurité › Microphone, puis coche Jarvis Parlement.`);
    }
  });

  // ---- Dossiers de travail ----
  await guard('Dossiers de travail', async () => {
    const info = workspace.info();
    let writable = true; try { fs.mkdirSync(info.root, { recursive: true }); fs.accessSync(info.root, fs.constants.W_OK); } catch { writable = false; }
    const missing = info.parlements.filter((p) => !p.exists);
    if (!writable) add('Dossiers de travail', 'ko', `Racine non accessible en écriture : ${info.root}. Les documents produits ne pourront pas être classés.`);
    else if (missing.length) add('Dossiers de travail', 'warn', `Dossier(s) manquant(s) pour : ${missing.map((p) => p.name).join(', ')} (Réglages › « Créer les dossiers »).`);
    else add('Dossiers de travail', 'ok', `${info.root} · ${info.parlements.length} parlement(s) actif(s), arborescence complète`);
  });

  await guard('Index documentaire', async () => {
    const ix = indexer.stats();
    const folders = st.docs.folders.map((f) => `${f} ${fs.existsSync(f) ? '✓' : '✗ introuvable'}`).join(' ; ');
    const gone = st.docs.folders.filter((f) => !fs.existsSync(f));
    add('Index documentaire', gone.length ? 'warn' : ix.files ? 'ok' : 'warn', `${ix.files} fichier(s), ${ix.chunks} extraits · mis à jour ${ix.updated || 'jamais'} · ${folders}${ix.files ? '' : ' — lance « Indexer » dans Documents.'}`);
  });

  await guard('Courriels', async () => {
    const accs = mail.listAccounts();
    if (!accs.length) add('Courriels', 'warn', 'Aucun compte connecté (Courriels › Ajouter un compte).');
    for (const a of accs) {
      try { const r = await withTimeout(mail.testAccount(a.id), 12000, 'délai dépassé (12 s)'); add('Courriel · ' + a.email, 'ok', r.detail); }
      catch (e) { add('Courriel · ' + a.email, 'ko', e.message + ' — vérifie le mot de passe (souvent un « mot de passe d\'application ») et les serveurs.'); }
    }
  });
  await guard('Google Agenda', async () => {
    if (!st.google.clientId) add('Google Agenda', 'warn', 'Identifiant client Google non renseigné (optionnel : Agenda › Connexion).');
    else if (!st.google.accounts.length) add('Google Agenda', 'warn', 'Client renseigné, aucun compte connecté.');
    else { const e = await withTimeout(google.events(1), 12000, 'délai dépassé (12 s)'); add('Google Agenda', e.errors.length ? 'ko' : 'ok', e.errors.join(' ; ') || `${st.google.accounts.length} compte(s), ${e.events.length} événement(s) aujourd'hui`); }
  });

  await guard('Veille automatique', async () => {
    const s = scheduler.status();
    add('Veille automatique', s.enabled ? (s.topics ? 'ok' : 'warn') : 'warn', s.enabled ? `Active à ${s.time} (heure de Bruxelles, jours ${s.days.join(',')}) · ${s.topics} sujet(s)${s.topics ? '' : ' — ajoute au moins un sujet'} · dernière exécution ${s.lastRun || 'jamais'}` : 'Désactivée');
  });
  await guard('Cerveau', async () => {
    const b = brain.list();
    add('Cerveau', b.learning ? 'ok' : 'warn', `${b.facts.length} souvenir(s) · apprentissage ${b.learning ? 'actif' : 'désactivé'}`);
  });

  const total = checks.length, ko = checks.filter((c) => c.status === 'ko').length, warn = checks.filter((c) => c.status === 'warn').length;
  return { checks, summary: ko ? `${ko} problème(s) sur ${total} contrôles` : warn ? `Tout fonctionne (${warn} point(s) à améliorer)` : 'Tout fonctionne', t: store.now(), version };
}

module.exports = { run, binaryState };
