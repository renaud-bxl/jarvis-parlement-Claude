// Veille automatique : tâche quotidienne interne à l'app (tourne tant que l'app est ouverte ; rattrapage au lancement et au réveil du Mac).
// Toutes les heures sont celles de Bruxelles (Europe/Brussels), heure d'été comprise, quel que soit le fuseau du Mac.
const store = require('./store');

const TZ = 'Europe/Brussels';
let timer = null, notify = () => {}, runner = null, running = false;
let retryAt = 0, attempts = 0; // reprise après une panne réseau (en mémoire)

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Date/heure murale à Bruxelles : { date: 'AAAA-MM-JJ', min: minutes depuis minuit, dow: 0..6 }
function brussels(d) {
  const p = {}; for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), dow: DOW[p.weekday] };
}
const validTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

function init({ onNotify, run }) {
  notify = onNotify || notify; runner = run;
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 60 * 1000);
  if (timer.unref) timer.unref();
  setTimeout(tick, 5000);
}
function stop() { if (timer) clearInterval(timer); timer = null; }

function due(v, d = new Date()) {
  if (!v || !v.enabled || !Array.isArray(v.topics) || !v.topics.length || !validTime(v.time)) return false;
  const now = brussels(d);
  if (!Array.isArray(v.days) || !v.days.includes(now.dow)) return false;
  const [h, m] = v.time.split(':').map(Number); const target = h * 60 + m;
  if (now.min < target) return false;
  if (!v.lastRun) return true;
  const last = new Date(v.lastRun); if (isNaN(last)) return true;
  const l = brussels(last);
  if (l.date < now.date) return true;        // dernière exécution un jour précédent
  if (l.date > now.date) return false;       // horloge reculée : ne pas rejouer
  return l.min < target;                     // aujourd'hui : seulement si elle précède l'heure prévue
}

async function tick() {
  if (running || !runner) return;
  if (retryAt && Date.now() < retryAt) return;
  let v; try { v = store.settings.get().veille; } catch { return; }
  if (!due(v)) return;
  running = true; const prevRun = v.lastRun;
  try {
    store.settings.set({ veille: { lastRun: store.now() } }); // marque AVANT : aucune double exécution même si l'app plante en cours de route
    const r = await runner();
    attempts = 0; retryAt = 0;
    notify('Veille terminée', `${r.created} nouveauté(s) détectée(s)${r.sources && r.sources.length ? ' dans ' + r.sources.length + ' source(s) consultée(s)' : ''}.${r.errors && r.errors.length ? ' ' + r.errors.length + ' sujet(s) en erreur.' : ''}`);
  } catch (e) {
    const network = /injoignable|Impossible de joindre|ne répond pas|connexion/i.test(e.message || '');
    if (network && attempts < 3) { // hors-ligne : on retente dans 15 min (3 fois), sans perdre la veille du jour
      attempts++; retryAt = Date.now() + 15 * 60 * 1000;
      try { store.settings.set({ veille: { lastRun: prevRun || null } }); } catch { /* ok */ }
      notify('Veille reportée', 'Pas de connexion : nouvel essai dans 15 minutes.');
    } else { attempts = 0; retryAt = 0; notify('Veille : échec', e.message); }
  } finally { running = false; }
}

function status() {
  const v = store.settings.get().veille;
  return { enabled: v.enabled, time: v.time, days: v.days, lastRun: v.lastRun, topics: v.topics.length, running };
}

function configure({ enabled, time, days } = {}) {
  const patch = {};
  if (enabled !== undefined) patch.enabled = !!enabled;
  if (time !== undefined && time !== '') { if (!validTime(time)) throw new Error('Heure invalide (HH:MM).'); patch.time = time; }
  if (days !== undefined) {
    if (!Array.isArray(days) || days.length > 7 || !days.every((x) => Number.isInteger(x) && x >= 0 && x <= 6)) throw new Error('Jours invalides.');
    patch.days = [...new Set(days)].sort();
  }
  store.settings.set({ veille: patch }); return status();
}

// « Retirer la veille automatique » : désactive la planification ET efface l'heure/jours. Les sujets et résultats sont conservés.
function remove() {
  const s = store.settings.get();
  store.settings.replace({ ...s, veille: { ...s.veille, enabled: false, lastRun: null, time: '07:30', days: [1, 2, 3, 4, 5] } });
  return status();
}

module.exports = { init, stop, tick, status, configure, remove, due, brussels };
