// Routeur et démarrage.
const NAV = [
  ['accueil', 'Jarvis', 'orb'], ['tableau', 'Tableau de bord', 'home'], ['dossiers', 'Dossiers', 'folder'], ['recherche', 'Recherche', 'search'], ['redaction', 'Rédiger', 'pen'], ['modeles', 'Modèles', 'layers'],
  ['documents', 'Documents', 'file'], ['courriels', 'Courriels', 'mail'], ['agenda', 'Agenda', 'cal'], ['veille', 'Veille', 'eye'], ['assistant', 'Assistant', 'chat'],
  'sep', ['parlements', 'Parlements', 'bank'], ['cerveau', 'Cerveau', 'brain'], ['reglages', 'Réglages', 'gear'], ['diagnostic', 'Diagnostic', 'pulse'],
];
const TITLES = Object.fromEntries(NAV.filter((n) => n !== 'sep').map((n) => [n[0], n[1]]));

J.go = (page, arg) => { location.hash = '#' + page + (arg ? '/' + arg : ''); };

// Mise en route : 4 étapes calculées à partir de l'état réel (profil, moteur IA testé, voix, micro).
J.onb = () => {
  const s = J.S, o = s.onboarding || {};
  const steps = [
    { id: 'profil', label: 'Ton profil', hint: 'Nom, titre et signature des textes.', done: !!String(s.profile.nom || '').trim() },
    { id: 'ia', label: 'Moteur IA', hint: s._env.configured ? 'Configuré : il reste à le tester.' : 'Choisis un moteur et colle ta clé (ou utilise Ollama, gratuit et local).', done: !!o.aiOk && !!s._env.configured },
    { id: 'voix', label: 'Voix de Jarvis', hint: 'Une voix féminine humaine est fournie ; tu peux choisir une voix d’homme.', done: !!s._env.piperReady },
    { id: 'micro', label: 'Micro et reconnaissance vocale', hint: o.micOk && !o.speechOk ? 'Micro autorisé : il reste à autoriser et tester la reconnaissance vocale.' : 'Pour dicter et parler à Jarvis.', done: !!o.micOk && !!o.speechOk },
  ];
  const n = steps.filter((x) => x.done).length;
  return { steps, n, all: n === steps.length, dismissed: !!(o.dismissed || o.done) };
};

async function render(keep) {
  J.refreshMeta().then(() => { if (J.drawChrome) J.drawChrome(); }).catch(() => {}); // met à jour le rappel « Mise en route » dès qu'une étape a fonctionné
  const keepTop = keep === true ? document.getElementById('main').scrollTop : 0;
  const [page, arg] = (location.hash.slice(1) || 'accueil').split('/');
  const token = (render.token = (render.token || 0) + 1);
  try { if (J.leave) J.leave(); } catch (e) { console.warn(e); }
  J.closeModal && document.querySelector('#modal-root .modal') && J.closeModal();
  const fn = J.pages[page] || J.pages.accueil;
  const cur = J.pages[page] ? page : 'accueil';
  J.$$('#nav a').forEach((a) => { const on = a.dataset.page === cur; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = (TITLES[cur] || 'Jarvis') + ' — Jarvis Parlement';
  const view = document.getElementById('view');
  const root = document.createElement('div'); root.className = 'page'; root.dataset.page = cur;
  view.replaceChildren(root); view.setAttribute('aria-busy', 'true');
  // Squelette seulement si la page tarde (évite un clignotement).
  const timer = setTimeout(() => { if (token === render.token && !root.childElementCount) root.innerHTML = cur === 'accueil' ? '' : J.skeleton(); }, 140);
  try { await fn(root, arg); }
  catch (e) {
    if (token !== render.token) return; // rendu périmé (l'utilisateur a déjà changé de page) : on l'ignore
    console.error(e);
    root.innerHTML = `<div class="empty err" role="alert"><b>Cette page n'a pas pu s'afficher</b>${J.esc(J.errMsg(e))}<div class="row"><button class="pri" data-act="reload">Réessayer</button><a class="btn" href="#accueil">Retour à Jarvis</a></div></div>`;
  } finally { clearTimeout(timer); }
  if (token !== render.token) return;
  view.removeAttribute('aria-busy');
  J.a11y(root);
  document.getElementById('main').scrollTop = keepTop;
  if (cur !== 'accueil' && !root.contains(document.activeElement)) view.focus({ preventScroll: true });
}
J.render = () => render(true);
J.act.reload = () => location.reload();

function drawChrome() {
  document.getElementById('nav').innerHTML = NAV.map((n) => n === 'sep' ? '<div class="sep" role="separator"></div>' : `<a data-page="${n[0]}" href="#${n[0]}">${J.icon(n[2])}${n[1]}</a>`).join('');
  const cur = (location.hash.slice(1) || 'accueil').split('/')[0];
  J.$$('#nav a').forEach((a) => { if (a.dataset.page === cur) { a.classList.add('on'); a.setAttribute('aria-current', 'page'); } });
  const sel = document.getElementById('activeParl');
  sel.innerHTML = J.P.parlements.filter((p) => J.P.actifs.includes(p.id)).map((p) => `<option value="${p.id}" ${p.id === J.P.actif ? 'selected' : ''}>${J.esc(p.nom)}</option>`).join('');
  sel.title = J.parlName(J.P.actif);
  const b = document.getElementById('aiBadge'), env = J.S._env;
  b.className = 'badge' + (env.configured ? ' ok' : '');
  b.innerHTML = `<i aria-hidden="true"></i>${env.configured ? (env.local ? 'IA locale prête' : 'IA cloud prête') : 'IA non configurée'}`;
  // Rappel discret tant que la mise en route n'est pas terminée.
  const foot = document.querySelector('.side-foot'); foot.querySelectorAll('.setup-hint-row, .setup-hint').forEach((n) => n.remove());
  const o = J.onb();
  if (!o.dismissed && !o.all) foot.insertAdjacentHTML('afterbegin', `<div class="setup-hint-row"><a class="setup-hint" href="#reglages/miseenroute">Mise en route : ${o.n}/4 · continuer</a><button class="setup-x" data-act="obLater" title="Ne plus afficher ce rappel" aria-label="Ne plus afficher le rappel de mise en route">×</button></div>`);
  if (J.notify) J.notify.paint(); // badge « Courriels » et résumé des alertes de suivi
}
J.drawChrome = drawChrome;

document.getElementById('activeParl').addEventListener('change', async (e) => {
  try { await J.call('parlements.setActive', { id: e.target.value }); await J.refreshMeta(); drawChrome(); render(true); } catch (err) { J.err(err); }
});
window.addEventListener('hashchange', () => render());

// Accessibilité des fragments ajoutés après le rendu (résultats, fenêtres) : libellés et rôles.
let a11yT = null;
new MutationObserver(() => { clearTimeout(a11yT); a11yT = setTimeout(() => J.a11y(document.getElementById('view')), 60); }).observe(document.getElementById('view'), { childList: true, subtree: true });

window.jarvis.on('navigate', (p) => J.go(p));
// Toutes les alertes passent par le centre d'alertes (en bas à droite, cliquables).
window.jarvis.on('brain-updated', (d) => { if (d.added) J.notify.push({ type: 'brain', title: 'Jarvis a retenu ' + d.added + ' nouvelle préférence' + (d.added > 1 ? 's' : ''), detail: 'Voir ce que Jarvis a appris', go: 'cerveau' }); if (location.hash.startsWith('#cerveau')) render(true); });
window.jarvis.on('veille-done', (d) => { J.notify.push({ type: 'veille', title: d.title, detail: d.body, go: 'veille' }); if (location.hash.startsWith('#veille')) render(true); });
window.jarvis.on('mail-alert', (d) => J.notify.pushMail(d));
window.jarvis.on('mail-alerts', (c) => J.notify.setCounts(c));
window.jarvis.on('mail-open', (d) => J.notify.openMail(d && d.key));
window.jarvis.on('progress', (d) => { J.state.progress = d.label; const el = document.getElementById('progress'); if (el) el.textContent = d.label; });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });

(async () => {
  try { await J.refreshMeta(); } catch (e) { document.getElementById('view').innerHTML = `<div class="empty err" role="alert"><b>Jarvis n'a pas pu démarrer</b>${J.esc(J.errMsg(e))}<div class="row"><button class="pri" data-act="reload">Relancer</button></div></div>`; return; }
  drawChrome(); J.notify.refresh();
  // Premier lancement : le parcours « Mise en route » s'ouvre dans Réglages.
  const o = J.onb();
  if (!location.hash && !J.S.firstRunDone && !o.dismissed && !o.all) { location.hash = '#reglages/miseenroute'; return; } // hashchange déclenche le rendu
  render();
})();
