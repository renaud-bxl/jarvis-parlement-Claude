// Diagnostic complet de l'installation.
const fs = require('fs');
const os = require('os');
const store = require('./store');
const llm = require('./llm');
const mail = require('./mail');
const indexer = require('./indexer');
const brain = require('./brain');
const scheduler = require('./scheduler');
const google = require('./google');

async function run(version = '1.0.0') {
  const checks = []; const add = (name, status, detail) => checks.push({ name, status, detail });
  const st = store.settings.get();

  add('Application', 'ok', `Jarvis Parlement ${version} · macOS ${os.release()} · ${os.arch()} · Node ${process.versions.node}`);
  try { fs.accessSync(store.DIR, fs.constants.W_OK); add('Dossier de données', 'ok', store.DIR); } catch { add('Dossier de données', 'ko', 'Non accessible en écriture : ' + store.DIR); }
  add('Chiffrement des secrets', store.canEncrypt() ? 'ok' : 'warn', store.canEncrypt() ? 'Trousseau macOS (safeStorage) actif' : 'Chiffrement indisponible : les secrets sont stockés en clair-encodé');
  add('Profil', st.profile.nom ? 'ok' : 'warn', st.profile.nom ? `${st.profile.nom} · ${st.profile.parlements.join(', ')}` : 'Profil non renseigné (Réglages)');

  if (!llm.configured()) add('Moteur IA', 'ko', 'Non configuré (clé ou modèle manquant)');
  else {
    try { const p = await llm.ping(); add('Moteur IA', 'ok', `${p.model} répond en ${p.ms} ms · ${llm.isLocal() ? 'local' : 'cloud'}`); }
    catch (e) { add('Moteur IA', 'ko', e.message); }
  }
  add('Recherche web', st.ai.webSearch ? (st.ai.provider === 'anthropic' ? 'ok' : 'warn') : 'warn', st.ai.webSearch ? (st.ai.provider === 'anthropic' ? 'Outil de recherche web de Claude' : 'Recherche de secours (DuckDuckGo) — moins fiable') : 'Désactivée');

  const ix = indexer.stats();
  const folders = st.docs.folders.map((f) => `${f} ${fs.existsSync(f) ? '✓' : '✗ introuvable'}`).join(' ; ');
  add('Index documentaire', ix.files ? 'ok' : 'warn', `${ix.files} fichier(s), ${ix.chunks} extraits · mis à jour ${ix.updated || 'jamais'} · ${folders}`);

  const accs = mail.listAccounts();
  if (!accs.length) add('Courriels', 'warn', 'Aucun compte connecté');
  for (const a of accs) {
    try { const r = await Promise.race([mail.testAccount(a.id), new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé (20 s)')), 20000))]); add('Courriel · ' + a.email, 'ok', r.detail); }
    catch (e) { add('Courriel · ' + a.email, 'ko', e.message); }
  }
  if (!st.google.clientId) add('Google Agenda', 'warn', 'Identifiant client Google non renseigné');
  else if (!st.google.accounts.length) add('Google Agenda', 'warn', 'Client renseigné, aucun compte connecté');
  else { try { const e = await google.events(1); add('Google Agenda', e.errors.length ? 'ko' : 'ok', e.errors.join(' ; ') || `${st.google.accounts.length} compte(s), ${e.events.length} événement(s) aujourd'hui`); } catch (e) { add('Google Agenda', 'ko', e.message); } }

  const s = scheduler.status();
  add('Veille automatique', s.enabled ? 'ok' : 'warn', s.enabled ? `Active à ${s.time} (jours ${s.days.join(',')}) · ${s.topics} sujet(s) · dernière exécution ${s.lastRun || 'jamais'}` : 'Désactivée');
  const b = brain.list();
  add('Cerveau', b.learning ? 'ok' : 'warn', `${b.facts.length} souvenir(s) · apprentissage ${b.learning ? 'actif' : 'désactivé'}`);
  const total = checks.length, ko = checks.filter((c) => c.status === 'ko').length;
  return { checks, summary: ko ? `${ko} problème(s) sur ${total} contrôles` : 'Tout fonctionne', t: store.now() };
}

module.exports = { run };
