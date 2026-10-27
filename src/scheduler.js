// Veille automatique : tâche quotidienne interne à l'app (tourne tant que l'app est ouverte ; rattrapage au lancement).
const store = require('./store');

let timer = null, notify = () => {}, runner = null, running = false;

function init({ onNotify, run }) {
  notify = onNotify || notify; runner = run;
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 5000);
}

function due(v, d = new Date()) {
  if (!v.enabled || !v.topics.length) return false;
  if (!v.days.includes(d.getDay())) return false;
  const [h, m] = v.time.split(':').map(Number);
  const target = new Date(d); target.setHours(h, m, 0, 0);
  if (d < target) return false;
  return !v.lastRun || new Date(v.lastRun) < target;
}

async function tick() {
  if (running || !runner) return;
  const v = store.settings.get().veille;
  if (!due(v)) return;
  running = true;
  try {
    const r = await runner();
    notify('Veille terminée', `${r.created} nouveauté(s) détectée(s).`);
  } catch (e) { notify('Veille : échec', e.message); store.settings.set({ veille: { lastRun: store.now() } }); }
  finally { running = false; }
}

function status() {
  const v = store.settings.get().veille;
  return { enabled: v.enabled, time: v.time, days: v.days, lastRun: v.lastRun, topics: v.topics.length, running };
}

function configure({ enabled, time, days }) {
  const patch = {};
  if (enabled !== undefined) patch.enabled = !!enabled;
  if (time) { if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Heure invalide (HH:MM).'); patch.time = time; }
  if (days) patch.days = days;
  store.settings.set({ veille: patch }); return status();
}

// « Retirer la veille automatique » : désactive la planification ET efface l'heure/jours. Les sujets et résultats sont conservés.
function remove() {
  const s = store.settings.get();
  store.settings.replace({ ...s, veille: { ...s.veille, enabled: false, lastRun: null, time: '07:30', days: [1, 2, 3, 4, 5] } });
  return status();
}

module.exports = { init, status, configure, remove, due };
