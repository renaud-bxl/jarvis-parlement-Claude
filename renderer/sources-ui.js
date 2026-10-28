// Réglages › « Sources de veille » : catalogue des sources belges (presse, Belga, Moniteur, parlements, administrations),
// cases à cocher, ajout manuel, restriction de la recherche web. Monté dans la page Réglages par un point d'ancrage <div id="sourcesBox">,
// et résumé affiché en haut de la page Veille. Aucune modification des pages existantes : on enveloppe J.pages.reglages et J.pages.veille.
(() => {
  const esc = (s) => J.esc(s);
  const $ = (id) => document.getElementById(id);
  const ACCESS = { libre: 'accès libre', partiel: 'accès partiel', abonnement: 'abonnement' };
  const LANG = { fr: 'FR', nl: 'NL', en: 'EN', multi: 'multilingue' };
  const ui = { data: null, err: '', open: null };

  function css() {
    if ($('srcCss')) return;
    const st = document.createElement('style'); st.id = 'srcCss';
    st.textContent = `
#sec-sources .src-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0 4px}
#sec-sources .src-bar .grow{flex:1;min-width:8px}
#sec-sources .src-opt{margin:10px 0 2px}
#sec-sources details.src-grp{border:1px solid var(--line);border-radius:10px;margin:10px 0 0;background:var(--card)}
#sec-sources details.src-grp>summary{cursor:pointer;list-style:none;padding:9px 12px;display:flex;align-items:center;gap:8px;border-radius:10px;font-size:14px}
#sec-sources details.src-grp>summary::-webkit-details-marker{display:none}
#sec-sources details.src-grp>summary::before{content:"";width:7px;height:7px;border-right:2px solid var(--mute);border-bottom:2px solid var(--mute);transform:rotate(-45deg);transition:transform .15s;margin-right:4px;flex:none}
#sec-sources details.src-grp[open]>summary::before{transform:rotate(45deg)}
#sec-sources details.src-grp>summary:hover{background:var(--hover)}
#sec-sources .src-list{border-top:1px solid var(--line)}
#sec-sources .src-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line)}
#sec-sources .src-row:last-child{border-bottom:none}
#sec-sources .src-row label.src-chk{margin:0;display:flex;align-items:flex-start;gap:9px;color:var(--ink);font-size:14px;cursor:pointer;min-width:0}
#sec-sources .src-row input[type=checkbox]{margin-top:3px;flex:none;width:16px;height:16px;accent-color:var(--acc)}
#sec-sources .src-name{font-weight:600;overflow-wrap:anywhere}
#sec-sources .src-sub{display:block;font-weight:400;color:var(--mute);font-size:12.5px;overflow-wrap:anywhere}
#sec-sources .src-pills{display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end;align-items:center}
#sec-sources .src-note{grid-column:1/-1;margin:0 0 0 25px;color:var(--mute);font-size:12.5px}
#sec-sources .src-add{border:1px dashed color-mix(in srgb,var(--mute) 45%,var(--line));border-radius:10px;margin-top:14px;padding:0}
#sec-sources .src-add>summary{cursor:pointer;padding:10px 14px;font-weight:600;border-radius:10px}
#sec-sources .src-add>summary:hover{background:var(--hover)}
#sec-sources .src-form{padding:4px 14px 14px}
#sec-sources .src-form .grid{margin-bottom:6px}
#sec-sources .src-err{color:var(--ko);font-size:13px;margin:8px 0 0}
#sec-sources .src-empty{padding:10px 12px;color:var(--mute);font-size:13px}
#srcInfo .src-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
@media (max-width:760px){#sec-sources .src-row{grid-template-columns:1fr}#sec-sources .src-pills{justify-content:flex-start;margin-left:25px}}`;
    document.head.appendChild(st);
  }

  const pills = (s) => [
    s.feeds.length ? `<span class="pill ok" title="${esc(s.feeds.map((f) => f.label).join(', '))}">flux RSS${s.feeds.length > 1 ? ' ×' + s.feeds.length : ''}</span>` : '<span class="pill" title="Pas de flux RSS public : Jarvis cherche sur le web, dans ce site uniquement.">recherche web</span>',
    `<span class="pill ${s.access === 'libre' ? '' : 'warn'}">${ACCESS[s.access] || ''}</span>`,
    `<span class="pill">${LANG[s.lang] || ''}</span>`,
  ].join('');

  function rowHtml(s) {
    const id = 'src_' + s.id.replace(/[^A-Za-z0-9_-]/g, '_');
    const where = s.parlements.includes('*') ? 'tous les parlements' : s.parlements.map((p) => J.parlName(p)).join(', ');
    const note = s.check === 'refuse-lecteurs' ? "Ce site refuse les lecteurs automatiques : Jarvis le consulte par la recherche web, restreinte à son domaine." : (s.note || '');
    return `<div class="src-row" data-src="${esc(s.id)}">
      <label class="chk src-chk" for="${id}" title="${s.custom ? 'Source ajoutée par toi' : esc(s.defaultChecked ? 'Cochée par défaut pour ce parlement' : (s.parlements.includes('*') ? 'Décochée par défaut (source facultative)' : 'Suggérée pour : ' + where))}"><input type="checkbox" id="${id}" data-act="srcToggle" data-id="${esc(s.id)}" ${s.checked ? 'checked' : ''}><span class="src-name">${esc(s.name)}<span class="src-sub">${esc(s.domains.join(', '))}</span></span></label>
      <span class="src-pills">${pills(s)}${s.custom ? `<button class="sm danger" data-act="srcRemove" data-id="${esc(s.id)}" data-name="${esc(s.name)}" aria-label="Retirer la source ${esc(s.name)}" title="Retirer cette source">${J.icon('trash')}</button>` : ''}</span>
      ${note ? `<p class="src-note">${esc(note)}</p>` : ''}</div>`;
  }

  function groupHtml(c, open) {
    const on = c.items.filter((s) => s.checked).length;
    const body = c.items.length ? c.items.map(rowHtml).join('') : '<p class="src-empty">Aucune source ajoutée pour l\'instant. Utilise « Ajouter une source » ci-dessous.</p>';
    return `<details class="src-grp" data-cat="${esc(c.id)}" ${open ? 'open' : ''}><summary><b>${esc(c.label)}</b><span class="pill" data-count="${esc(c.id)}">${on}/${c.items.length}</span></summary><div class="src-list">${body}</div></details>`;
  }

  function formHtml(d) {
    const left = d.limits.customLeft;
    return `<details class="src-add" id="srcAddBox"><summary>Ajouter une source</summary><div class="src-form">
      <p class="muted small">Ajoute un média ou un site officiel que Jarvis ne connaît pas encore. Seules les adresses http(s) publiques sont acceptées (ni identifiants, ni réseau interne). ${left > 0 ? left + ' ajout(s) possible(s).' : '<b>Limite atteinte</b> : retire une source ajoutée avant d\'en ajouter une autre.'}</p>
      <div class="grid g2"><div><label class="f" for="srcName">Nom</label><input id="srcName" maxlength="80" data-enter="srcAdd" autocomplete="off" placeholder="Ex. Le Ligueur"></div>
      <div><label class="f" for="srcSite">Adresse du site</label><input id="srcSite" type="url" maxlength="300" data-enter="srcAdd" autocomplete="off" placeholder="https://www.exemple.be/"></div>
      <div><label class="f" for="srcFeed">Adresse du flux RSS (facultatif)</label><input id="srcFeed" type="url" maxlength="300" data-enter="srcAdd" autocomplete="off" placeholder="https://www.exemple.be/rss.xml"></div>
      <div class="row" style="align-items:flex-end;flex-wrap:nowrap"><div style="flex:2"><label class="f" for="srcCat">Catégorie</label><select id="srcCat">${d.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === 'perso' ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="f" for="srcLang">Langue</label><select id="srcLang"><option value="fr">Français</option><option value="nl">Néerlandais</option><option value="en">Anglais</option><option value="multi">Plusieurs langues</option></select></div></div></div>
      <p class="src-err" id="srcErr" role="alert" hidden></p>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="srcAdd" ${left > 0 ? '' : 'disabled'}>${J.icon('plus')} Ajouter la source</button></div></div></details>`;
  }

  function draw() {
    const box = $('sourcesBox'); if (!box) return;
    const d = ui.data;
    if (!d) { box.innerHTML = ui.err ? `<div class="empty err" role="alert"><b>Les sources n'ont pas pu être chargées</b>${esc(ui.err)}<div class="row"><button class="pri" data-act="srcReload">Réessayer</button></div></div>` : '<p class="muted small">Chargement des sources…</p>'; return; }
    const open = ui.open || new Set(d.categories.filter((c) => c.id !== 'perso' ? c.items.some((s) => s.checked) : c.items.length).map((c) => c.id));
    box.innerHTML = `<p class="muted small" style="margin-top:0">Jarvis connaît d'avance ces sources belges. Les sources cochées sont interrogées pour la veille, les recherches et toute question d'actualité (« Y a-t-il eu des manifestations ce dimanche ? ») : il lit leurs flux RSS, cherche dans leurs sites et te donne les faits avec les liens. Les sites sans flux RSS sont consultés par la recherche web, limitée à leur domaine. Vérifié le ${esc(d.verified.split('-').reverse().join('/'))}.</p>
      <div class="src-bar"><span class="pill gold" id="srcCount" role="status">${d.checked} source${d.checked > 1 ? 's' : ''} cochée${d.checked > 1 ? 's' : ''} sur ${d.total}</span><span class="muted small">Par défaut pour : ${esc(J.parlName(d.parlement))}</span><span class="grow"></span>
        <button class="sm" data-act="srcAll" data-on="1">Tout cocher</button><button class="sm" data-act="srcAll" data-on="0">Tout décocher</button><button class="sm" data-act="srcReset">Rétablir les valeurs par défaut</button></div>
      <label class="chk src-opt"><input type="checkbox" id="srcStrict" data-act="srcStrict" ${d.strict ? 'checked' : ''}> Limiter la recherche web aux sources cochées (recommandé)</label>
      <p class="muted small" style="margin:0 0 4px 24px">Décoché, Jarvis cherche sur tout le web belge et international, en privilégiant ces sources. ${d.checked === 0 ? '<b>Aucune source n\'est cochée : la recherche n\'est pas restreinte.</b>' : ''}</p>
      ${d.categories.map((c) => groupHtml(c, open.has(c.id))).join('')}
      ${formHtml(d)}`;
    box.querySelectorAll('details.src-grp').forEach((el) => el.addEventListener('toggle', () => { ui.open = new Set([...box.querySelectorAll('details.src-grp[open]')].map((x) => x.dataset.cat)); }));
    ui.open = open;
  }
  async function load() {
    try { ui.data = await J.call('sources.list'); ui.err = ''; } catch (e) { ui.data = null; ui.err = J.errMsg(e); }
    draw();
  }
  // Met à jour compteurs et pastilles sans tout redessiner (le focus clavier reste sur la case).
  function patchCounts(d) {
    ui.data = d;
    const c = $('srcCount'); if (c) c.textContent = `${d.checked} source${d.checked > 1 ? 's' : ''} cochée${d.checked > 1 ? 's' : ''} sur ${d.total}`;
    for (const cat of d.categories) { const p = document.querySelector(`[data-count="${cat.id}"]`); if (p) p.textContent = `${cat.items.filter((s) => s.checked).length}/${cat.items.length}`; }
  }
  const refocus = (sel) => { const e = document.querySelector(sel); if (e) e.focus({ preventScroll: true }); };

  J.act.srcReload = () => load();
  J.act.srcToggle = async (el) => {
    const want = el.checked; el.disabled = true;
    try { patchCounts(await J.call('sources.toggle', { id: el.dataset.id, on: want })); }
    catch (e) { el.checked = !want; J.err(e); }
    finally { el.disabled = false; el.focus({ preventScroll: true }); }
  };
  J.act.srcStrict = async (el) => {
    const want = el.checked;
    try { ui.data = await J.call('sources.options', { strict: want }); J.toast(want ? 'Recherche web limitée aux sources cochées' : 'Recherche web ouverte, sources cochées en priorité', 'ok'); }
    catch (e) { el.checked = !want; J.err(e); }
  };
  J.act.srcAll = (el) => J.busy(el, async () => {
    const on = el.dataset.on === '1';
    if (!on && !await J.confirm('Décocher toutes les sources ? Sans source cochée, la recherche web n\'est plus restreinte.', { ok: 'Tout décocher', title: 'Décocher toutes les sources' })) return;
    ui.data = await J.call('sources.setAll', { on }); draw(); J.toast(on ? 'Toutes les sources sont cochées' : 'Aucune source cochée', 'ok'); refocus(`[data-act="srcAll"][data-on="${on ? 1 : 0}"]`);
  }, 'Enregistrement…');
  J.act.srcReset = (el) => J.busy(el, async () => {
    if (!await J.confirm(`Rétablir les cases par défaut pour « ${J.parlName(ui.data ? ui.data.parlement : '')} » ? Tes sources ajoutées sont conservées.`, { ok: 'Rétablir', title: 'Valeurs par défaut' })) return;
    ui.data = await J.call('sources.reset'); ui.open = null; draw(); J.toast('Valeurs par défaut rétablies', 'ok'); refocus('[data-act="srcReset"]');
  }, 'Enregistrement…');
  J.act.srcRemove = async (el) => {
    if (!await J.confirm(`Retirer la source « ${el.dataset.name} » ? Elle ne sera plus interrogée.`, { ok: 'Retirer', danger: true, title: 'Retirer cette source' })) return;
    try { ui.data = await J.call('sources.remove', { id: el.dataset.id }); draw(); J.toast('Source retirée', 'ok'); refocus('#sec-sources summary'); } catch (e) { J.err(e); }
  };
  J.act.srcAdd = (el) => J.busy(el, async () => {
    const err = $('srcErr'); if (err) { err.hidden = true; err.textContent = ''; }
    try {
      const r = await J.call('sources.add', { name: J.val('srcName'), site: J.val('srcSite'), feed: J.val('srcFeed'), category: J.val('srcCat'), lang: J.val('srcLang') });
      ui.data = r.list; ui.open = new Set([...(ui.open || []), r.source.category]); draw();
      J.toast(r.feedStatus === 'ko' ? 'Source ajoutée, mais son flux RSS ne répond pas' : 'Source ajoutée et cochée', r.feedStatus === 'ko' ? 'err' : 'ok');
      if (r.feedStatus === 'ko') { const b = $('srcAddBox'); const n = document.createElement('p'); n.className = 'src-err'; n.setAttribute('role', 'status'); n.textContent = r.feedMessage; (b || $('sourcesBox')).appendChild(n); }
    } catch (e) {
      const m = J.errMsg(e); const b = $('srcErr'); if (b) { b.textContent = m; b.hidden = false; } J.toast(m, 'err'); const f = $('srcName'); if (f && !String(J.val('srcName') || '').trim()) f.focus();
    }
  }, 'Ajout…');

  // ---------- Réglages : carte « Sources de veille » ----------
  function mountReglages(root) {
    if (!root || root.querySelector('#sec-sources')) return; css();
    let box = root.querySelector('#sourcesBox'); let card;
    if (box) { card = box.closest('.card') || box.parentElement; if (card && !card.id) card.id = 'sec-sources'; }
    else {
      card = document.createElement('div'); card.className = 'card'; card.id = 'sec-sources';
      card.innerHTML = `<h2>${J.hi('eye')}Sources de veille</h2><div id="sourcesBox"></div>`;
      const after = root.querySelector('#sec-ia') || root.querySelector('#sec-profil'); if (after) after.insertAdjacentElement('afterend', card); else root.appendChild(card);
      const nav = root.querySelector('.sect-nav'); if (nav) { const b = document.createElement('button'); b.className = 'chip'; b.dataset.act = 'obGo'; b.dataset.sec = 'sec-sources'; b.dataset.focus = '#sec-sources summary'; b.textContent = 'Sources de veille'; const ref = [...nav.children].find((x) => x.dataset.sec === 'sec-voix'); nav.insertBefore(b, ref || null); }
    }
    ui.open = null; draw(); load();
  }
  const origReglages = J.pages && J.pages.reglages;
  if (typeof origReglages === 'function') J.pages.reglages = async (root, arg) => { await origReglages(root, arg); mountReglages(root); if (arg === 'sources') { const c = root.querySelector('#sec-sources'); if (c) c.scrollIntoView({ block: 'start' }); } };

  // ---------- Veille : rappel des sources interrogées ----------
  async function mountVeille(root) {
    if (!root || root.querySelector('#srcInfo')) return; css();
    let d, v; try { [d, v] = await Promise.all([J.call('sources.list'), J.call('veille.items')]); } catch { return; }
    const last = v && Array.isArray(v.runs) && v.runs[0] && Array.isArray(v.runs[0].sources) ? v.runs[0] : null;
    const card = document.createElement('div'); card.className = 'card'; card.id = 'srcInfo';
    card.innerHTML = `<div class="row sp"><div><h2 style="margin:0 0 2px">Sources interrogées</h2><span class="muted small">${d.checked} source${d.checked > 1 ? 's' : ''} cochée${d.checked > 1 ? 's' : ''} (${d.withFeed} avec flux RSS) · recherche web ${d.strict ? 'limitée à ces sources' : 'ouverte'}</span></div><a class="btn sm" href="#reglages/sources">Choisir les sources</a></div>`
      + (last && last.sources.length ? `<p class="small" style="margin:10px 0 0"><b>Dernière veille (${esc(J.fmtDate(last.t))})</b> : ${last.sources.length} sources consultées${last.feedsOk !== undefined ? `, ${last.feedsOk} flux RSS lus${last.feedsKo ? `, ${last.feedsKo} injoignable${last.feedsKo > 1 ? 's' : ''}` : ''}` : ''}.</p><div class="src-chips">${last.sources.map((s) => `<span class="pill" title="${s.via === 'flux' ? (s.feed ? 'Flux RSS lu' : 'Flux RSS injoignable : recherche web') : 'Recherche web'}">${esc(s.name)}</span>`).join('')}</div>` : '<p class="muted small" style="margin:10px 0 0">Le rapport de chaque veille indiquera les sources consultées.</p>');
    const sub = root.querySelector('.sub'); if (!root.isConnected || root.querySelector('#srcInfo')) return;
    if (sub) sub.insertAdjacentElement('afterend', card); else root.prepend(card);
  }
  const origVeille = J.pages && J.pages.veille;
  if (typeof origVeille === 'function') J.pages.veille = async (root, arg) => { await origVeille(root, arg); mountVeille(root).catch(() => {}); };
})();
