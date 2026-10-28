// Mises à jour : alerte « Nouvelle version disponible », fenêtre de la version (notes, installer / plus tard / ignorer),
// progression du téléchargement et carte « Mises à jour » des Réglages. Toute la logique (vérification, téléchargement,
// empreinte, installation) est dans le processus principal (src/updater.js) ; ici, uniquement l'affichage et les clics.
(() => {
  const CSS = `.upd-notes{white-space:pre-wrap;overflow:auto;max-height:230px;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:10px 0 14px;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.upd-notes:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.upd-meta{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin:0 0 4px}
.upd-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px}
.upd-actions .upd-link{margin-left:auto;font-size:13px}
.upd-prog-label{font-size:13.5px;margin:6px 0 2px}
.upd-prog .onb-bar{margin:8px 0 10px}
.upd-row{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
.upd-note{background:var(--banner-bg);border:1px solid var(--banner-line);color:var(--banner-ink);border-radius:10px;padding:8px 12px;font-size:13px;margin:10px 0 0}`;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => J.esc(s);
  const ui = { status: null, progress: null, alerted: '', watching: false, version: '' };
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const mb = (n) => (Number(n) / 1048576 >= 10 ? Math.round(Number(n) / 1048576) : Math.round(Number(n) / 104857.6) / 10).toString().replace('.', ',') + ' Mo';
  const when = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString('fr-BE', { dateStyle: 'medium', timeStyle: 'short' }) : ''; };
  const hour = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : ''; };
  function ago(iso) {
    const t = Date.parse(iso); if (!Number.isFinite(t)) return 'jamais';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'à l’instant'; if (s < 3600) return `il y a ${Math.round(s / 60)} min`; if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    return `il y a ${Math.round(s / 86400)} j`;
  }
  const voiceBusy = () => !!(J.speaking || (J.jv && ((J.jv.state && J.jv.state !== 'idle') || J.jv.listening)));
  const modalOpen = () => !!document.querySelector('#modal-root .modal[data-upd]');
  const css = () => { if (!$('upd-css')) { const st = document.createElement('style'); st.id = 'upd-css'; st.textContent = CSS; document.head.appendChild(st); } };

  // ------------------------------------------------------------------ alerte ------------------------------------------------------------------
  function alertAvailable(v) {
    if (!v || !J.notify) return;
    ui.alerted = v.version;
    J.notify.push({ id: 'update-available', type: 'info', icon: 'update', title: `Nouvelle version ${v.version} disponible`, detail: 'Cliquez ici pour l’installer', tag: 'Mise à jour', ttl: 0, onClick: () => openModal() });
  }
  const dropAlert = (id) => { try { J.notify && J.notify.dismiss(id); } catch { /* ok */ } };

  // Quand la fenêtre se ferme sans décision (Échap, clic à côté), l'alerte revient : la mise à jour n'est pas perdue de vue.
  function watchClose() {
    if (ui.watching) return; const root = $('modal-root'); if (!root || typeof MutationObserver === 'undefined') return; ui.watching = true;
    const mo = new MutationObserver(() => {
      if (modalOpen()) return; mo.disconnect(); ui.watching = false;
      const s = ui.status; if (s && s.state === 'available' && !ui.progress && s.latest) alertAvailable(s.latest);
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------ fenêtre « Nouvelle version » ------------------------------------------------------------------
  async function openModal() {
    if (ui.progress && ui.progress.phase === 'done') ui.progress = null;
    let s; try { s = await J.call('update.status'); } catch (e) { return J.err(e); }
    ui.status = s; const v = s.latest;
    if (ui.progress && ['download', 'verify', 'mount', 'restart'].includes(ui.progress.phase)) { showModal(v || { version: ui.progress.version, notes: '', htmlUrl: '', size: 0, canAutoInstall: true }, s); return; }
    if (!v) { J.toast('Jarvis est à jour.', 'ok'); return; }
    showModal(v, s);
  }
  function showModal(v, s) {
    css(); ui.version = v.version;
    const auto = v.canAutoInstall;
    J.modal(`<h2>Nouvelle version ${esc(v.version)}</h2>
      <div class="upd-meta"><span class="muted">Vous utilisez la version ${esc(s.current)}${v.publishedAt ? ' · publiée le ' + esc(when(v.publishedAt)) : ''}${v.size ? ' · ' + esc(mb(v.size)) : ''}</span></div>
      <div class="upd-notes" tabindex="0" role="region" aria-label="Notes de version">${v.notes ? esc(v.notes) : '<span class="muted">Aucune note de version n’a été publiée.</span>'}</div>
      <div id="updStage"></div>`, (m) => { m.dataset.upd = '1'; renderStage(v, s); });
    watchClose();
  }
  function renderStage(v, s) {
    const box = $('updStage'); if (!box) return; v = v || (ui.status && ui.status.latest) || { version: ui.version, htmlUrl: '', canAutoInstall: true }; s = s || ui.status || {};
    const p = ui.progress;
    if (p && ['download', 'verify', 'mount', 'restart'].includes(p.phase)) {
      const pct = Math.max(0, Math.min(100, Math.round(p.percent || 0)));
      const label = p.phase === 'download' ? `Téléchargement… ${pct} %${p.total ? ` (${mb(p.received || 0)} sur ${mb(p.total)})` : ''}` : p.phase === 'verify' ? 'Vérification de l’intégrité du fichier…' : p.phase === 'mount' ? 'Contrôle du contenu de la mise à jour…' : (p.message || 'Installation en cours : Jarvis va se fermer puis se rouvrir…');
      box.innerHTML = `<div class="upd-prog" role="status"><div class="upd-prog-label" id="updLbl">${esc(label)}</div><div class="onb-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progression de la mise à jour"><i style="width:${pct}%"></i></div>
        <div class="upd-actions">${p.phase === 'download' ? '<button data-act="updCancel">Annuler</button>' : ''}<span class="muted small">Ne fermez pas Jarvis : il se rouvrira tout seul.</span></div></div>`;
      return;
    }
    if (p && p.phase === 'fallback') { box.innerHTML = `<div class="upd-note" role="status">${esc(p.message || '')}</div><div class="upd-actions"><button class="pri" data-act="closeModal">Compris</button></div>`; return; }
    if (p && p.phase === 'done') { box.innerHTML = `<div class="upd-note" role="status">${esc(p.message || '')}</div><div class="upd-actions"><button class="pri" data-act="closeModal">Fermer</button></div>`; return; }
    if (ui.error) { box.innerHTML = `<div class="upd-note" role="alert"><b>La mise à jour n’a pas abouti.</b> ${esc(ui.error)} <br>Votre version actuelle n’a pas été modifiée.</div><div class="upd-actions"><button class="pri" data-act="updInstall">Réessayer</button><button data-act="closeModal">Fermer</button>${v.htmlUrl ? `<a class="upd-link" data-ext="1" href="${esc(v.htmlUrl)}">Voir sur GitHub</a>` : ''}</div>`; return; }
    const note = !v.canAutoInstall ? '<div class="upd-note">Cette version ne peut pas être installée automatiquement (empreinte de contrôle absente). Ouvrez la page de la version pour la télécharger.</div>' : (s.dev ? '<div class="upd-note">Mode développement : l’installation est simulée, rien n’est téléchargé ni modifié.</div>' : '<p class="muted small" style="margin:6px 0 0">Jarvis télécharge le fichier officiel depuis GitHub, vérifie son empreinte (sha256), puis se ferme et se rouvre tout seul. Vos données ne sont pas touchées.</p>');
    box.innerHTML = `${note}<div class="upd-actions" style="margin-top:14px">
      ${v.canAutoInstall ? '<button class="pri" data-act="updInstall">Installer maintenant</button>' : '<button class="pri" data-act="updManual">Ouvrir la page de la version</button>'}
      <button data-act="updLater">Plus tard</button><button data-act="updSkip">Ignorer cette version</button>
      ${v.htmlUrl ? `<a class="upd-link" data-ext="1" href="${esc(v.htmlUrl)}">Voir sur GitHub</a>` : ''}</div>`;
    const first = box.querySelector('button.pri'); if (first) first.focus();
  }

  // ------------------------------------------------------------------ actions ------------------------------------------------------------------
  async function install(force) {
    ui.error = '';
    let r; try { r = await J.call('update.install', { force: !!force, voice: voiceBusy() }); } catch (e) { return J.err(e); }
    if (r && r.busy) {
      const ok = await J.confirm(`${cap((r.reasons || []).join(' ; '))}. Installer quand même ? Ce qui est en cours sera interrompu.`, { ok: 'Installer quand même', title: 'Jarvis est occupé' });
      if (ok) return install(true);
      openModal(); return; // « Plus tard » : on ne force jamais
    }
    if (r && r.manual) { J.call('app.openExternal', { url: r.url }).catch(J.err); J.toast('Page de la version ouverte dans votre navigateur.', 'ok'); return; }
    if (r && r.simulated) { if (!modalOpen()) await openModal(); return; }
    if (r && r.started) { dropAlert('update-available'); ui.progress = ui.progress || { phase: 'download', percent: 0, version: r.version }; if (!modalOpen()) await openModal(); else renderStage(); }
  }
  J.act.updInstall = () => install(false);
  J.act.updManual = async () => { const v = ui.status && ui.status.latest; if (v && v.htmlUrl) { await J.call('app.openExternal', { url: v.htmlUrl }); } };
  J.act.updCancel = async () => { try { await J.call('update.cancel'); } catch (e) { J.err(e); } };
  J.act.updLater = async () => { const v = ui.status && ui.status.latest; J.closeModal(); if (v) { try { await J.call('update.snooze', { version: v.version }); J.toast('D’accord, je vous le rappellerai demain.', 'ok'); } catch (e) { J.err(e); } } dropAlert('update-available'); refreshCard(); };
  J.act.updSkip = async () => { const v = ui.status && ui.status.latest; J.closeModal(); if (v) { try { await J.call('update.skip', { version: v.version }); J.toast(`La version ${v.version} est ignorée. Vous pouvez annuler dans Réglages › Mises à jour.`, 'ok'); } catch (e) { J.err(e); } } dropAlert('update-available'); refreshCard(); };
  J.act.updUnskip = async (el) => { const v = el.dataset.v; await J.call('update.skip', { version: v, undo: true }); J.toast('Cette version ne sera plus ignorée.', 'ok'); refreshCard(); try { const s = await J.call('update.status'); ui.status = s; if (s.state === 'available') alertAvailable(s.latest); } catch { /* ok */ } };
  J.act.updOpen = () => openModal();
  J.act.updCheck = (el) => J.busy(el, async () => {
    const s = await J.call('update.check'); ui.status = s; drawCard(s);
    if (s.state === 'available') J.toast(`La version ${s.latest.version} est disponible.`, 'ok');
    else if (s.state === 'uptodate') J.toast('Jarvis est à jour.', 'ok');
    else if (s.state === 'error' && s.error) J.toast(s.error.message, 'err');
  }, 'Vérification…');

  // ------------------------------------------------------------------ événements du processus principal ------------------------------------------------------------------
  function onProgress(d) {
    d = d || {}; ui.progress = d;
    if (['download', 'verify', 'mount', 'restart'].includes(d.phase)) {
      if (!modalOpen() && d.phase === 'download' && !d.simulated) J.notify.push({ id: 'update-progress', type: 'info', icon: 'update', title: `Téléchargement de la version ${d.version || ''}…`, detail: 'Cliquez ici pour voir la progression', ttl: 0, onClick: () => openModal() });
      const bar = $('updStage') && $('updStage').querySelector('.onb-bar');
      if (bar && d.phase === 'download') { const pct = Math.round(d.percent || 0); bar.firstElementChild.style.width = pct + '%'; bar.setAttribute('aria-valuenow', String(pct)); const l = $('updLbl'); if (l) l.textContent = `Téléchargement… ${pct} %${d.total ? ` (${mb(d.received || 0)} sur ${mb(d.total)})` : ''}`; }
      else renderStage();
    } else {
      dropAlert('update-progress');
      if (d.phase === 'cancelled') { ui.progress = null; J.toast('Téléchargement annulé.', 'ok'); if (modalOpen()) openModal(); if (ui.status && ui.status.state === 'available') alertAvailable(ui.status.latest); }
      else if (d.phase === 'waiting') {
        J.confirm(`${cap((d.reasons || []).join(' ; '))}. Redémarrer maintenant pour installer la version ${d.version} ? Ce qui est en cours sera interrompu.`, { ok: 'Installer maintenant', title: 'Jarvis est occupé' }).then((ok) => { if (ok) install(true); else { ui.progress = null; J.call('update.cancel').catch(() => {}); alertAvailable({ version: d.version }); } });
      } else if (d.phase === 'fallback') { if (!modalOpen()) openModal().then(() => renderStage()); else renderStage(); }
      else if (d.phase === 'done') { if (modalOpen()) renderStage(); else J.toast(d.message || 'Terminé.', 'ok'); }
    }
  }
  function onError(d) {
    d = d || {}; ui.progress = null; dropAlert('update-progress'); ui.error = d.message || 'Erreur inattendue.';
    if (modalOpen()) renderStage();
    else J.notify.push({ id: 'update-error', type: 'err', title: d.kind === 'install' ? 'La dernière mise à jour a échoué' : 'La mise à jour a échoué', detail: ui.error, ttl: 0 });
    refreshCard();
  }
  async function onAvailable(d) {
    if (d && d.open) { openModal(); return; }
    if (!d || !d.version) return;
    try { ui.status = await J.call('update.status'); } catch { /* ok */ }
    alertAvailable(d); refreshCard();
  }

  // ------------------------------------------------------------------ carte « Mises à jour » des Réglages ------------------------------------------------------------------
  const HOURS = [1, 3, 6, 12, 24, 48, 72];
  const hoursLabel = (h) => (h === 1 ? 'Toutes les heures' : h === 24 ? 'Tous les jours' : h === 48 ? 'Tous les 2 jours' : h === 72 ? 'Tous les 3 jours' : `Toutes les ${h} heures`);
  function pill(s) {
    if (s.state === 'installing') return '<span class="pill gold">Installation en cours</span>';
    if (s.state === 'available') return `<span class="pill gold">Nouvelle version ${esc(s.latest.version)}</span>`;
    if (s.state === 'ignored') return '<span class="pill warn">Version ignorée</span>';
    if (s.state === 'snoozed') return '<span class="pill warn">Rappel reporté</span>';
    if (s.state === 'error') { const k = s.error && s.error.kind; return k === 'network' ? '<span class="pill warn">Réseau indisponible</span>' : k === 'ratelimit' ? `<span class="pill warn">Limite GitHub${s.rateLimitUntil ? ' : réessai vers ' + esc(hour(s.rateLimitUntil)) : ''}</span>` : '<span class="pill ko">Vérification impossible</span>'; }
    if (s.state === 'uptodate') return '<span class="pill ok">À jour</span>';
    return '<span class="pill">Pas encore vérifié</span>';
  }
  function drawCard(s) {
    const card = $('sec-maj'); if (!card || !s) return; css();
    const hours = HOURS.includes(s.checkHours) ? HOURS : [...HOURS, s.checkHours].sort((a, b) => a - b);
    const ign = s.ignored || '';
    const avail = s.state === 'available' && s.latest;
    card.innerHTML = `<h2>${J.hi('refresh')}Mises à jour</h2>
      <div class="upd-row"><span>Version installée : <b>${esc(s.current)}</b></span>${pill(s)}</div>
      <p class="muted small" style="margin:6px 0 0" id="updLast">Dernière vérification : ${s.lastCheck ? esc(when(s.lastCheck)) + ' (' + esc(ago(s.lastCheck)) + ')' : 'jamais'}${s.error && s.state === 'error' ? ' · ' + esc(s.error.message) : ''}</p>
      <div class="row" style="margin-top:12px"><button class="sm pri" id="updCheck" data-act="updCheck">Vérifier maintenant</button>${avail ? `<button class="sm gold" data-act="updOpen">Voir la version ${esc(s.latest.version)}</button>` : ''}</div>
      <div class="row" style="margin-top:12px"><label class="chk" style="margin:0"><input type="checkbox" id="updAuto" ${s.auto ? 'checked' : ''}> Vérifier automatiquement</label>
        <label for="updHours" class="muted small">Fréquence</label><select id="updHours" style="width:auto" ${s.auto ? '' : 'disabled'}>${hours.map((h) => `<option value="${h}" ${h === s.checkHours ? 'selected' : ''}>${esc(hoursLabel(h))}</option>`).join('')}</select></div>
      ${ign ? `<p class="small" style="margin:12px 0 0">Version ignorée : <b>${esc(ign)}</b> <button class="sm" data-act="updUnskip" data-v="${esc(ign)}">Annuler l’ignorance</button></p>` : ''}
      ${s.dev ? '<div class="upd-note">Mode développement : l’installation est simulée.</div>' : ''}
      <p class="muted small" style="margin-bottom:0">Jarvis interroge uniquement le dépôt officiel sur GitHub, sans envoyer de données personnelles. Rien n’est jamais installé sans votre clic, et le fichier est vérifié (empreinte sha256) avant d’être utilisé.</p>`;
    const a = $('updAuto'), h = $('updHours');
    if (a) a.addEventListener('change', async () => { try { ui.status = await J.call('update.configure', { auto: a.checked }); J.toast(a.checked ? 'Vérification automatique activée' : 'Vérification automatique désactivée', 'ok'); drawCard(ui.status); } catch (e) { J.err(e); refreshCard(); } });
    if (h) h.addEventListener('change', async () => { try { ui.status = await J.call('update.configure', { checkHours: Number(h.value) }); J.toast('Fréquence enregistrée', 'ok'); drawCard(ui.status); } catch (e) { J.err(e); refreshCard(); } });
  }
  async function refreshCard() { if (!$('sec-maj')) return; try { const s = await J.call('update.status'); ui.status = s; drawCard(s); } catch (e) { const c = $('sec-maj'); if (c) c.innerHTML = `<h2>Mises à jour</h2><p class="muted">${esc(J.errMsg(e))}</p>`; } }
  function mountCard(root) {
    if (!root || root.querySelector('#sec-maj')) return; css();
    const card = document.createElement('div'); card.className = 'card'; card.id = 'sec-maj';
    const after = root.querySelector('#sec-app'); if (after) after.insertAdjacentElement('afterend', card); else root.appendChild(card);
    const nav = root.querySelector('.sect-nav'); if (nav) { const b = document.createElement('button'); b.className = 'chip'; b.dataset.act = 'obGo'; b.dataset.sec = 'sec-maj'; b.dataset.focus = '#updCheck'; b.textContent = 'Mises à jour'; nav.appendChild(b); }
    card.innerHTML = '<h2>Mises à jour</h2><p class="muted small">Chargement…</p>'; refreshCard();
  }
  const origReglages = J.pages && J.pages.reglages;
  if (typeof origReglages === 'function') J.pages.reglages = async (root, arg) => { await origReglages(root, arg); mountCard(root); };

  // ------------------------------------------------------------------ démarrage ------------------------------------------------------------------
  if (window.jarvis && window.jarvis.on) {
    window.jarvis.on('update-available', onAvailable);
    window.jarvis.on('update-progress', onProgress);
    window.jarvis.on('update-error', onError);
  }
  // Interface rechargée alors qu'une version est déjà connue : l'alerte réapparaît (sans nouvelle notification macOS).
  setTimeout(async () => { try { const s = await J.call('update.status'); ui.status = s; if (s.state === 'available' && s.latest) alertAvailable(s.latest); } catch { /* sans gravité */ } }, 1200);

  // ------------------------------------------------------------------ annonce visible : accueil + barre latérale ------------------------------------------------------------------
  // Tant qu'une version plus récente est disponible (et pas ignorée), l'accueil et le menu l'affichent en permanence, avec le bouton « Mettre à jour ».
  const BANNER_CSS = `.jv-update{display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;margin:6px auto 0;padding:8px 14px;border-radius:12px;border:1px solid rgba(255,210,31,.6);background:rgba(255,210,31,.14);color:#fff;font-size:14px;max-width:760px;text-align:center}.jv-update b{color:#ffd21f}
.side-update{display:block;width:100%;margin:0 0 6px;padding:7px 10px;border-radius:10px;border:1px solid rgba(255,210,31,.7);background:rgba(255,210,31,.16);color:#ffe58a;font-size:12px;font-weight:700;text-align:left;cursor:pointer}.side-update:hover{background:rgba(255,210,31,.28)}`;
  let bannerBusy = false;
  async function refreshBanner() {
    if (bannerBusy) return; bannerBusy = true;
    try {
      if (!$('upd-banner-css')) { const st = document.createElement('style'); st.id = 'upd-banner-css'; st.textContent = BANNER_CSS; document.head.appendChild(st); }
      let s = null; try { s = await J.call('update.status'); } catch { s = null; }
      ui.status = s || ui.status;
      document.querySelectorAll('.jv-update, .side-update').forEach((n) => n.remove());
      const v = s && s.state === 'available' && s.latest ? s.latest : null; if (!v) return;
      const foot = document.querySelector('.side-foot');
      if (foot) { const b = document.createElement('button'); b.className = 'side-update'; b.dataset.act = 'updOpen'; b.textContent = `⬆ Version ${v.version} disponible · Mettre à jour`; b.setAttribute('aria-label', `Nouvelle version ${v.version} disponible : ouvrir la mise à jour`); foot.insertBefore(b, foot.firstChild); }
      const top = document.querySelector('#jv .jv-top');
      if (top) { const d = document.createElement('div'); d.className = 'jv-update'; d.setAttribute('role', 'status'); d.innerHTML = `<span>⬆ <b>Nouvelle version ${esc(v.version)}</b> disponible sur GitHub</span><button class="pri sm" data-act="updOpen">Mettre à jour</button>`; top.insertAdjacentElement('afterend', d); }
    } finally { bannerBusy = false; }
  }
  for (const n of ['updSkip', 'updLater', 'updUnskip']) { const f = J.act[n]; if (typeof f === 'function') J.act[n] = async (...a) => { try { return await f(...a); } finally { refreshBanner(); } }; }
  // L'écran d'accueil est défini par un script chargé après celui-ci : on l'enveloppe une fois tous les scripts exécutés.
  setTimeout(() => { const origAccueil = J.pages && J.pages.accueil; if (typeof origAccueil === 'function' && !origAccueil._upd) { const w = async (root, arg) => { await origAccueil(root, arg); refreshBanner(); J.call('update.checkStale').then((st) => { if (st && st.state === 'available') refreshBanner(); }).catch(() => {}); }; w._upd = true; J.pages.accueil = w; } }, 0);
  if (window.jarvis && window.jarvis.on) for (const ch of ['update-available', 'update-progress', 'update-error']) window.jarvis.on(ch, () => setTimeout(refreshBanner, 300));
  window.addEventListener('hashchange', () => setTimeout(refreshBanner, 400));
  setTimeout(refreshBanner, 1500); setInterval(refreshBanner, 5 * 60000);

  J.update = { open: openModal, status: () => ui.status, refreshCard, _handle: { onAvailable, onProgress, onError }, _ui: ui };
})();
