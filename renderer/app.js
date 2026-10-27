// Routeur et démarrage.
const NAV = [
  ['accueil', 'Jarvis', 'orb'], ['tableau', 'Tableau de bord', 'home'], ['dossiers', 'Dossiers', 'folder'], ['recherche', 'Recherche', 'search'], ['redaction', 'Rédiger', 'pen'],
  ['documents', 'Documents', 'file'], ['courriels', 'Courriels', 'mail'], ['agenda', 'Agenda', 'cal'], ['veille', 'Veille', 'eye'], ['assistant', 'Assistant', 'chat'],
  'sep', ['parlements', 'Parlements', 'bank'], ['cerveau', 'Cerveau', 'brain'], ['reglages', 'Réglages', 'gear'], ['diagnostic', 'Diagnostic', 'pulse'],
];

J.go = (page, arg) => { location.hash = '#' + page + (arg ? '/' + arg : ''); };

async function render() {
  const [page, arg] = (location.hash.slice(1) || 'accueil').split('/');
  if (J.leave) J.leave();
  const fn = J.pages[page] || J.pages.accueil;
  J.$$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.page === page));
  const root = document.getElementById('view');
  root.innerHTML = '<div class="muted">Chargement…</div>';
  try { await fn(root, arg); } catch (e) { root.innerHTML = `<div class="card"><h2>Erreur</h2><p>${J.esc(e.message)}</p></div>`; console.error(e); }
  document.getElementById('main').scrollTop = 0;
}
J.render = render;

function drawChrome() {
  document.getElementById('nav').innerHTML = NAV.map((n) => n === 'sep' ? '<div class="sep"></div>' : `<a data-page="${n[0]}" href="#${n[0]}">${J.icon(n[2])}${n[1]}</a>`).join('');
  const sel = document.getElementById('activeParl');
  sel.innerHTML = J.P.parlements.filter((p) => J.P.actifs.includes(p.id)).map((p) => `<option value="${p.id}" ${p.id === J.P.actif ? 'selected' : ''}>${J.esc(p.nom)}</option>`).join('');
  const b = document.getElementById('aiBadge'), env = J.S._env;
  b.className = 'badge' + (env.configured ? ' ok' : '');
  b.innerHTML = `<i></i>${env.configured ? (env.local ? 'IA locale prête' : 'IA cloud prête') : 'IA non configurée'}`;
}
J.drawChrome = drawChrome;

document.getElementById('activeParl').addEventListener('change', async (e) => {
  await J.call('parlements.setActive', { id: e.target.value });
  await J.refreshMeta(); drawChrome(); render();
});
window.addEventListener('hashchange', render);

window.jarvis.on('navigate', (p) => J.go(p));
window.jarvis.on('brain-updated', (d) => { if (d.added) J.toast('🧠 Jarvis a retenu ' + d.added + ' nouvelle préférence' + (d.added > 1 ? 's' : ''), 'ok'); if (location.hash.startsWith('#cerveau')) render(); });
window.jarvis.on('veille-done', (d) => { J.toast(d.title + ' — ' + d.body, 'ok'); if (location.hash.startsWith('#veille')) render(); });
window.jarvis.on('progress', (d) => { J.state.progress = d.label; const el = document.getElementById('progress'); if (el) el.textContent = d.label; });

(async () => {
  await J.refreshMeta();
  drawChrome();
  if (!J.S.firstRunDone && !location.hash) location.hash = '#reglages';
  render();
})();
