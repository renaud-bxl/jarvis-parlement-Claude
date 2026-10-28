// Surveillance des courriels en arrière-plan : toutes les N minutes, lecture SEULE des derniers messages de chaque compte
// (IMAP et Gmail), détection des nouveaux non lus, classement immédiat par règles, alertes et notifications.
// Jamais d'écriture sur un serveur de courriel : rien n'est supprimé, déplacé, marqué lu ni envoyé. Les contenus sont des DONNÉES.
// Le moteur IA n'est sollicité que s'il est local ou si l'utilisateur a donné son accord (settings.jarvis.cloudMailOk) ; sinon règles seules.
const store = require('./store');
const mail = require('./mail');
const mailbox = require('./mailbox');

const READ_N = 30;                 // derniers messages lus par compte et par passage
const READ_TIMEOUT_MS = 90e3;
const AI_TIMEOUT_MS = 150e3;
const SEEN_MAX = 6000;             // clés de courriels déjà vus (mémoire bornée)
const RECENT_MS = 7 * 864e5;       // un non lu plus ancien n'est jamais « nouveau » (réapparu dans la fenêtre de lecture)
const BACKOFF_MAX_MS = 3600e3;
const START_DELAY_MS = 10e3;
const RESUME_DELAY_MS = 8e3;
const GRACE_MS = 60e3;             // après un réveil, le réseau peut mettre du temps à revenir : pas d'alerte d'erreur

const deps = { emit() {}, notify() {}, onCounts() {}, setTimer: (f, ms) => setTimeout(f, ms), clearTimer: (t) => clearTimeout(t), clock: () => new Date() };
let timer = null; let busy = false; let started = false; let stopped = true; let paused = false; let graceUntil = 0; let token = 0;
let lastRun = null; let lastCounts = null;
const accState = new Map(); // compte → { fails, nextAt, errNotified, error }

const settings = () => store.settings.get().mail;
const minutesOf = (cfg = settings()) => Math.min(60, Math.max(1, Math.floor(Number(cfg.watchMinutes)) || 3));
const safe = (f) => { try { return f(); } catch (e) { console.error('mailwatch :', String((e && e.message) || e).slice(0, 200)); return undefined; } };
const oneLine = (s, n) => String(s == null ? '' : s).replace(/[\p{C}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const withTimeout = (p, ms, msg) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(msg)), ms); Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });

// ---------- État persistant : clés déjà vues + base de référence de chaque compte ----------
function loadState() {
  const d = store.read('mailwatch', { accounts: {}, seen: {} });
  return { accounts: d && typeof d.accounts === 'object' && d.accounts ? d.accounts : {}, seen: d && typeof d.seen === 'object' && d.seen ? d.seen : {} };
}
function saveState(st) {
  const keys = Object.keys(st.seen);
  if (keys.length > SEEN_MAX) { keys.sort((a, b) => st.seen[a] - st.seen[b]).slice(0, keys.length - SEEN_MAX).forEach((k) => delete st.seen[k]); }
  store.write('mailwatch', st);
}

// ---------- Plan de notification (pur : testable sans Electron) ----------
// entries : [{ key, from, subject, strong, reason }] → { inapp: [alertes de l'application], native: notification macOS | null }
function plan(entries, cfg = {}) {
  const preview = cfg.notifyPreview !== false; const n = entries.length;
  if (!n) return { inapp: [], native: null };
  const strong = entries.filter((e) => e.strong); const normal = entries.filter((e) => !e.strong);
  const names = (list) => { const u = [...new Set(list.map((e) => e.from))]; return u.slice(0, 3).join(', ') + (u.length > 3 ? ` et ${u.length - 3} autre${u.length - 3 > 1 ? 's' : ''}` : ''); };
  const inapp = [];
  strong.slice(0, 3).forEach((e) => inapp.push({ id: 'mail:' + e.key, kind: 'mail', urgent: true, key: e.key, keys: [e.key], count: 1, title: `Courriel urgent · ${e.from}`, detail: preview ? e.subject : 'Nouveau courriel important', tag: e.reason || 'Important' }));
  if (strong.length > 3) { const rest = strong.slice(3); inapp.push({ id: 'mail:strong:' + rest[0].key, kind: 'mail', urgent: true, key: rest[0].key, keys: rest.map((e) => e.key), count: rest.length, title: `${rest.length} autres courriels importants`, detail: preview ? names(rest) : 'Ouvrez Courriels pour les lire.', tag: 'Important' }); }
  if (normal.length === 1) { const e = normal[0]; inapp.push({ id: 'mail:' + e.key, kind: 'mail', urgent: false, key: e.key, keys: [e.key], count: 1, title: e.from, detail: preview ? e.subject : 'Nouveau courriel' }); }
  else if (normal.length > 1) {
    const more = normal.length > 3 ? ` · +${normal.length - 3}` : '';
    inapp.push({ id: 'mail:group:' + normal[0].key, kind: 'mail', urgent: false, key: normal[0].key, keys: normal.map((e) => e.key), count: normal.length, title: `${normal.length} nouveaux courriels`, detail: preview ? normal.slice(0, 3).map((e) => e.subject).join(' · ') + more : `De ${names(normal)}` });
  }
  let native;
  if (n === 1) { const e = entries[0]; native = { title: e.strong ? `Courriel urgent · ${e.from}` : e.from, body: preview ? e.subject : 'Nouveau courriel', key: e.key, urgent: !!e.strong }; }
  else {
    const order = [...strong, ...normal];
    native = { title: `${n} nouveaux courriels` + (strong.length ? ` dont ${strong.length} urgent${strong.length > 1 ? 's' : ''}` : ''), body: preview ? order.slice(0, 3).map((e) => `${e.from} — ${e.subject}`).join('\n') + (n > 3 ? `\n+ ${n - 3} autre${n - 3 > 1 ? 's' : ''}` : '') : `De ${names(order)}`, key: (strong[0] || normal[0]).key, urgent: strong.length > 0 };
  }
  return { inapp, native };
}
function entryOf(item, m, now) {
  const from = oneLine(item ? item.fromName : (m.from || ''), 60) || 'Expéditeur inconnu'; const subject = oneLine(item ? item.subject : m.subject, 120) || '(sans objet)';
  const u = item ? safe(() => mailbox.urgencyOf(item, now)) : null;
  return { key: item ? item.key : mailbox.keyOf(m), from, subject, strong: !!u && u.rank <= 4, reason: u ? u.text : '' };
}

// ---------- Un passage ----------
async function readAccount(a) {
  try {
    const r = await withTimeout(mail.readMany([a.id], { n: READ_N, force: true }), READ_TIMEOUT_MS, 'Le serveur met trop de temps à répondre.');
    if (r && Array.isArray(r.errors) && r.errors.length) return { acc: a, error: String(r.errors[0].error || 'Erreur inconnue') };
    return { acc: a, messages: ((r && r.messages) || []).map((m) => ({ ...m, account: m.account || a.id })) };
  } catch (e) { return { acc: a, error: String((e && e.message) || e) }; }
}
function accountState(id) { let s = accState.get(id); if (!s) accState.set(id, s = { fails: 0, nextAt: 0, errNotified: false, error: '' }); return s; }

function onFailure(a, error, now, cfg) {
  const s = accountState(a.id); const inGrace = now.getTime() < graceUntil;
  s.fails = inGrace ? Math.min(s.fails + 1, 1) : s.fails + 1;
  s.nextAt = now.getTime() + Math.min(BACKOFF_MAX_MS, minutesOf(cfg) * 60e3 * 2 ** s.fails); // 2×, 4×, 8×… l'intervalle, plafonné à 1 h
  s.error = oneLine(error, 200);
  if (s.errNotified || inGrace) return;
  s.errNotified = true; // une seule alerte par compte tant que la panne dure
  const label = oneLine(a.label || a.email, 60);
  const detail = `${s.error || 'Erreur inconnue'} Ouvrez Courriels, puis « Tester » sur ce compte (connexion Internet, mot de passe).`;
  safe(() => deps.emit('mail-alert', { id: 'mail-error:' + a.id, kind: 'error', urgent: false, title: `Courriels : « ${label} » injoignable`, detail, go: 'courriels' }));
  safe(() => deps.notify({ title: `Courriels : « ${label} » injoignable`, body: detail, key: null, urgent: false }));
}
function onRecovered(a) {
  const s = accountState(a.id); const was = s.errNotified;
  s.fails = 0; s.nextAt = 0; s.error = ''; s.errNotified = false;
  if (was) safe(() => deps.emit('mail-alert', { id: 'mail-ok:' + a.id, kind: 'ok', urgent: false, title: `« ${oneLine(a.label || a.email, 60)} » est de nouveau joignable`, detail: 'La surveillance des courriels a repris.', go: 'courriels' }));
}

async function pass({ manual = false, now } = {}) {
  const my = token; const t0 = now || deps.clock(); const nowMs = t0.getTime(); const cfg = settings();
  if (!manual && cfg.watch === false) return { skipped: 'disabled' };
  let accs; try { accs = mail.listAccounts(); } catch (e) { return { ok: false, error: oneLine(e && e.message, 200) }; }
  const st = loadState(); const ids = new Set(accs.map((a) => a.id));
  for (const id of Object.keys(st.accounts)) if (!ids.has(id)) delete st.accounts[id];
  for (const id of [...accState.keys()]) if (!ids.has(id)) accState.delete(id);
  const due = accs.filter((a) => manual || !(accountState(a.id).nextAt > nowMs)); // compte en attente (backoff) : on le saute
  const reads = await Promise.all(due.map(readAccount));
  if (my !== token) return { cancelled: true };
  const fresh = []; const quiet = []; const summary = [];
  for (const r of reads) {
    const a = r.acc;
    if (r.error) { onFailure(a, r.error, t0, cfg); summary.push({ id: a.id, ok: false, error: oneLine(r.error, 200) }); continue; }
    onRecovered(a);
    if (!st.accounts[a.id]) { // premier passage sur ce compte : base de référence, l'historique n'est pas notifié
      st.accounts[a.id] = { baseline: t0.toISOString() };
      for (const m of r.messages) { st.seen[mailbox.keyOf(m)] = nowMs; if (m.unread) quiet.push(m); }
      summary.push({ id: a.id, ok: true, read: r.messages.length, baseline: true, fresh: 0 }); continue;
    }
    let nf = 0;
    for (const m of r.messages) {
      const k = mailbox.keyOf(m); if (st.seen[k]) continue; st.seen[k] = nowMs;
      if (!m.unread) continue;
      const t = Date.parse(m.date || m.received);
      if (Number.isFinite(t) && nowMs - t > RECENT_MS) { quiet.push(m); continue; }
      fresh.push(m); nf++;
    }
    summary.push({ id: a.id, ok: true, read: r.messages.length, fresh: nf });
  }
  safe(() => saveState(st)); // avant la livraison : au pire une alerte manquée, jamais une alerte en double
  // Classement immédiat par règles (aucune donnée envoyée), enregistré pour que la boîte intelligente s'affiche instantanément.
  const all = [...fresh, ...quiet]; let items = {}; let notes = [];
  if (all.length) { try { const ing = await mailbox.ingest(all, { ai: false, now: t0 }); items = ing.items; notes = ing.notes; } catch (e) { notes.push(oneLine(e && e.message, 120)); } }
  if (my !== token) return { cancelled: true };
  const entries = fresh.map((m) => entryOf(items[mailbox.keyOf(m)], m, t0));
  if (entries.length) {
    const out = plan(entries, cfg);
    out.inapp.forEach((a) => safe(() => deps.emit('mail-alert', a)));
    if (out.native) safe(() => deps.notify(out.native));
  }
  pushCounts(t0, entries.length > 0);
  // Amélioration par l'IA, après la notification, seulement si autorisée (moteur local ou accord explicite).
  if (all.length && safe(() => mailbox.aiAllowed())) {
    try { await withTimeout(mailbox.ingest(all.slice(0, 30), { ai: true, now: t0 }), AI_TIMEOUT_MS, "L'analyse par l'IA est trop longue."); pushCounts(t0, false); }
    catch (e) { notes.push(oneLine(e && e.message, 120)); }
  }
  return { ok: true, at: t0.toISOString(), accounts: summary, fresh: entries.length, notified: entries.length, quiet: quiet.length, notes };
}
function pushCounts(now, force) {
  const c = safe(() => mailbox.alertCount({ now })); if (!c) return;
  if (!force && lastCounts && lastCounts.count === c.count && lastCounts.urgent === c.urgent) return;
  lastCounts = c; safe(() => deps.emit('mail-alerts', c)); safe(() => deps.onCounts(c));
}

// Un seul passage à la fois ; un appel pendant un passage ne fait rien (pas de chevauchement).
function runOnce(opts = {}) {
  if (busy) return Promise.resolve({ skipped: 'busy' });
  busy = true;
  return (async () => {
    try { const r = await pass(opts); if (r && !r.skipped && !r.cancelled) lastRun = { at: (opts.now || deps.clock()).toISOString(), ok: r.ok !== false, fresh: r.fresh || 0, error: r.error || '' }; return r; }
    catch (e) { return { ok: false, error: oneLine(e && e.message, 200) }; }
    finally { busy = false; }
  })();
}

// ---------- Planification ----------
function schedule(ms) {
  if (timer) { deps.clearTimer(timer); timer = null; }
  if (stopped || paused) return;
  timer = deps.setTimer(async () => { timer = null; try { await runOnce(); } catch { /* jamais de plantage */ } schedule(); }, ms === undefined ? minutesOf() * 60e3 : ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
}
function start(opts = {}) {
  Object.assign(deps, opts); started = true; stopped = false; paused = false; token++;
  schedule(opts.firstDelay === undefined ? START_DELAY_MS : opts.firstDelay);
  return module.exports;
}
function stop() { stopped = true; started = false; token++; if (timer) { deps.clearTimer(timer); timer = null; } }
function reschedule() { if (started && !stopped && !paused) schedule(); }
// Mise en veille du Mac : on arrête de solliciter les serveurs ; au réveil, rattrapage rapide (réseau parfois lent à revenir).
function pause() { paused = true; token++; if (timer) { deps.clearTimer(timer); timer = null; } }
function resume() {
  if (stopped) return;
  paused = false; graceUntil = deps.clock().getTime() + GRACE_MS; for (const s of accState.values()) { s.fails = 0; s.nextAt = 0; }
  schedule(RESUME_DELAY_MS);
}
function status() {
  const cfg = settings(); const labels = Object.fromEntries(safe(() => mail.listAccounts().map((a) => [a.id, a.label || a.email])) || []);
  return { ok: true, enabled: cfg.watch !== false, minutes: minutesOf(cfg), previews: cfg.notifyPreview !== false, followDays: cfg.followDays, running: busy, paused, lastRun,
    accounts: [...accState.entries()].map(([id, s]) => ({ id, label: labels[id] || id, fails: s.fails, nextAt: s.nextAt ? new Date(s.nextAt).toISOString() : '', error: s.error })) };
}

module.exports = { start, stop, pause, resume, reschedule, runOnce, status, plan, __test: { READ_N, SEEN_MAX, RECENT_MS, BACKOFF_MAX_MS, reset() { accState.clear(); lastCounts = null; lastRun = null; graceUntil = 0; busy = false; } } };
