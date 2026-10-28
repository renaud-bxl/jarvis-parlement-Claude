// Page « Modèles » : les modèles Word de l'utilisateur, par type de document, pour le parlement actif.
// + boutons réutilisables « Télécharger le Word / Afficher / Ouvrir dans Word / Aperçu PDF » (page Rédiger, écran Jarvis).
(() => {
  const esc = (s) => J.esc(s);
  const KIND_LABEL = { champs: 'Modèle à champs', exemple: 'Modèle-exemple' };
  const SIZE = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');
  const state = { open: new Set() };

  // ---------- Boutons Word réutilisables ----------
  // data-p : chemin du .docx produit par Jarvis ; les actions passent par l'API (validée côté backend).
  J.docxButtons = (p, { name = '', office = false, big = true } = {}) => {
    const a = `data-p="${esc(p)}" data-n="${esc(name)}"`;
    return `<button class="${big ? 'gold' : 'pri'} sm" data-act="docxDownload" ${a}>${J.icon('file')} Télécharger le Word</button>`
      + `<button class="sm" data-act="docxOpen" ${a}>Ouvrir dans Word</button><button class="sm" data-act="docxShow" ${a}>Afficher dans le Finder</button>`
      + (office ? `<button class="sm ghost" data-act="docxPdf" ${a}>Aperçu PDF</button>` : '');
  };
  J.act.docxDownload = (el) => J.busy(el, async () => { const dest = await J.call('modeles.exportDocx', { path: el.dataset.p, name: el.dataset.n || undefined }); if (dest) J.toast('Word enregistré : ' + dest, 'ok'); }, 'Enregistrement…');
  J.act.docxOpen = (el) => J.busy(el, async () => { await J.call('modeles.openDocx', { path: el.dataset.p }); }, 'Ouverture…');
  J.act.docxShow = async (el) => { await J.call('modeles.showDocx', { path: el.dataset.p }); };
  J.act.docxPdf = (el) => J.busy(el, async () => { await J.call('modeles.previewPdf', { path: el.dataset.p }); }, 'Conversion…');

  // Écran Jarvis (voix) : le résultat d'une action peut porter files:[{label,path,kind}] — on ajoute les boutons sous la réponse sans toucher à jarvis.js.
  let pending = null; let pendingT = 0;
  const call0 = J.call;
  J.call = (m, a) => {
    const p = call0(m, a);
    if (m === 'jarvis.command') p.then((res) => { pending = res && Array.isArray(res.files) && res.files.length ? res.files.filter((f) => f && typeof f.path === 'string').slice(0, 6) : null; clearTimeout(pendingT); if (pending) pendingT = setTimeout(() => { pending = null; }, 4000); }, () => { pending = null; });
    return p;
  };
  const ACT = { docx: 'docxDownload', open: 'docxOpen', show: 'docxShow', pdf: 'docxPdf' };
  const inject = () => {
    if (!pending) return; const out = document.getElementById('jvOut'); if (!out || !out.querySelector('.jv-card')) return;
    const html = pending.filter((f) => ACT[f.kind]).map((f) => `<button class="${f.kind === 'docx' ? 'gold ' : ''}sm" data-act="${ACT[f.kind]}" data-p="${esc(f.path)}" data-n="">${esc(String(f.label || 'Word').slice(0, 40))}</button>`).join('');
    pending = null; if (!html) return;
    const bar = out.querySelector('.jv-actions'); if (bar) bar.insertAdjacentHTML('afterbegin', html); else out.insertAdjacentHTML('beforeend', `<div class="jv-actions">${html}</div>`);
  };
  const view = document.getElementById('view'); if (view) new MutationObserver(inject).observe(view, { childList: true, subtree: true });

  // ---------- Page « Modèles » ----------
  const stateCell = (m) => {
    if (!m) return '<span class="pill">À ajouter</span>';
    if (m.status === 'erreur') return '<span class="pill ko">Illisible</span>';
    if (m.status === 'conversion') return '<span class="pill warn">Conversion requise</span>';
    return `<span class="pill ok">${J.icon('check')} Ajouté et analysé</span>`;
  };
  const detail = (it) => {
    const m = it.model; if (!m) return '';
    if (m.status !== 'ok') return `<div class="mdl-alert" role="alert"><b>${m.status === 'conversion' ? 'Ce format doit être converti' : 'Ce modèle ne peut pas être utilisé'}</b>${esc(m.error)}</div>`;
    const sec = (m.sections || []).map((s) => `<li><b>${esc(s.nom)}</b> <span class="muted small">${s.role === 'automatique' ? 'rempli automatiquement' : 'rédigé par Jarvis'}${s.words ? ' · ~' + s.words + ' mots' : ''}</span></li>`).join('');
    const fields = (m.fields || []).map((f) => `<span class="chip" title="${f.auto ? 'Rempli automatiquement depuis ton profil' : 'Rédigé par Jarvis'}">${esc(f.label || f.key)}${f.auto ? ' ·auto' : ''}</span>`).join('');
    return `<div class="mdl-detail">
      <div class="mdl-facts"><span><b>${esc(KIND_LABEL[m.kind] || m.kind)}</b></span><span>${m.words} mots · ${m.paragraphs} paragraphes</span>${m.tables ? `<span>${m.tables} tableau${m.tables > 1 ? 'x' : ''}</span>` : ''}${m.images ? `<span>${m.images} image${m.images > 1 ? 's' : ''}/logo conservé${m.images > 1 ? 's' : ''}</span>` : ''}${m.headers ? '<span>en-tête conservé</span>' : ''}${m.footers ? '<span>pied de page conservé</span>' : ''}${m.language ? `<span>langue : ${esc(m.language.toUpperCase())}</span>` : ''}</div>
      ${m.kind === 'champs' ? `<h3>Champs détectés</h3><div class="chips">${fields || '<span class="muted small">Aucun</span>'}</div>` : ''}
      <h3>Sections, dans l'ordre</h3>${sec ? `<ol class="mdl-sec">${sec}</ol>` : '<p class="muted small">Aucune section repérée.</p>'}
      ${m.tone || m.lengthHint || (m.formulas && (m.formulas.appel || m.formulas.politesse)) ? `<h3>Fiche du modèle</h3><dl class="mdl-dl">${m.tone ? `<dt>Ton</dt><dd>${esc(m.tone)}</dd>` : ''}${m.lengthHint ? `<dt>Longueur</dt><dd>${esc(m.lengthHint)}</dd>` : ''}${m.formulas && m.formulas.appel ? `<dt>Formule d'appel</dt><dd>${esc(m.formulas.appel)}</dd>` : ''}${m.formulas && m.formulas.politesse ? `<dt>Politesse</dt><dd>${esc(m.formulas.politesse)}</dd>` : ''}</dl>` : ''}
      ${(m.warnings || []).map((w) => `<div class="mdl-alert warn" role="status">${esc(w)}</div>`).join('')}
      <details class="mdl-prev"><summary>Aperçu du texte détecté</summary><pre>${esc(m.preview || '(vide)')}</pre></details>
    </div>`;
  };
  const row = (it, d) => {
    const m = it.model; const open = state.open.has(it.id);
    const files = d.files.map((f) => `<option value="${esc(f.name)}" ${it.assigned === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    const unsure = m && m.kind === 'exemple' && m.canAnalyze;
    return `<section class="card mdl" aria-labelledby="mh-${esc(it.id)}">
      <div class="row sp"><h2 id="mh-${esc(it.id)}">${esc(it.label)}</h2>${stateCell(m)}</div>
      <p class="muted small" style="margin-top:2px">${esc(it.mode === 'oral' ? 'Oral' : 'Écrit')} · destinataire : ${esc(it.recipient || '—')}</p>
      ${m ? `<div class="row sp mdl-file"><span class="path" title="${esc(m.file)}">${esc(m.file)}</span><span class="muted small">${esc(m.ext)} · ${SIZE(m.size)} · association : ${esc(m.source)}${m.converted ? ' · converti en .docx' : ''}</span></div>`
        : `<div class="mdl-empty"><b>Aucun modèle pour ce type de document.</b> Jarvis produira un Word propre (titre, sections, signature). Ajoute ton modèle pour qu'il suive exactement ta mise en page.</div>`}
      ${detail(it)}
      <div class="row mdl-actions">
        <button class="${m ? '' : 'pri'}" data-act="mdAdd" data-i="${esc(it.id)}">${J.icon(m ? 'file' : 'plus')} ${m ? 'Remplacer' : 'Ajouter mon modèle'}</button>
        ${unsure ? `<button class="gold" data-act="mdAnalyze" data-i="${esc(it.id)}" title="Le moteur IA déduit les sections, le ton et les formules de ton exemple">Analyser avec l'IA</button>` : ''}
        ${m ? `<button class="danger sm" data-act="mdRemove" data-i="${esc(it.id)}" data-f="${esc(m.file)}">${J.icon('trash')} Supprimer le modèle</button>` : ''}
        <label class="mdl-pick"><span class="sr">Fichier à utiliser pour ${esc(it.label)}</span><select data-md-assign="${esc(it.id)}" aria-label="Fichier à utiliser pour ${esc(it.label)}"><option value="">Automatique (d'après le nom du fichier)</option>${files}</select></label>
      </div></section>`;
  };

  J.pages.modeles = async (root) => {
    const pid = J.P.actif; const d = await J.call('modeles.list', { parlementId: pid });
    const have = d.instruments.filter((i) => i.model).length;
    const cloud = d.local ? '<p class="muted small"><span class="pill ok">Local</span> Moteur local : tes modèles ne quittent jamais ce Mac.</p>'
      : `<label class="chk"><input type="checkbox" data-act="mdConsent" ${d.consentCloud ? 'checked' : ''}> J'autorise l'envoi de mes modèles à mon moteur IA en ligne pour rédiger fidèlement (sans cet accord, Jarvis produit un Word standard et n'envoie jamais ton modèle).</label>`;
    const office = d.office.found ? `<span class="pill ok">${esc(d.office.name)} détecté</span> Conversion des formats .doc, .odt, .rtf et .pdf possible, et aperçu PDF.`
      : `<span class="pill">LibreOffice non détecté</span> Facultatif : sans lui, utilise des fichiers <b>.docx</b> (dans Word : Fichier › Enregistrer sous › Document Word).`;
    root.innerHTML = `<h1>${J.hi('file')}Modèles de documents</h1><p class="sub">Dépose ton modèle de question, d'interpellation… pour <b>${esc(d.parlementNom)}</b>. Quand Jarvis rédige, il suit <b>exactement</b> ton modèle (structure, formules, ton, mise en page, en-tête, logo) et te remet un fichier <b>Word (.docx)</b> à télécharger.</p>
      <div class="card gold"><div class="row sp"><h2>${J.hi('folder')}Dossier des modèles</h2><button data-act="mdFolder">${J.icon('folder')} Ouvrir le dossier des modèles</button></div>
        <p class="path" style="margin:6px 0">${esc(d.folder)}</p>
        <p class="muted small">Tu peux aussi y déposer tes fichiers toi-même : nomme-les <code>question-ecrite.docx</code>, <code>interpellation.docx</code>, <code>question-orale.docx</code>, <code>question-actualite.docx</code>… (un fichier <b>LISEZ-MOI.txt</b> t'explique tout). Ou choisis le fichier de chaque type dans la liste ci-dessous.</p>
        ${cloud}<p class="muted small" style="margin-top:6px">${office}</p></div>
      ${have ? '' : `<div class="empty"><b>Aucun modèle pour le moment</b>Pars de ton plus beau document : une ancienne question ou interpellation en .docx (même sans champ), ou un modèle avec des champs <code>{{sujet}}</code>, <code>{{contexte}}</code>, <code>{{questions}}</code>. Jarvis garde tes polices, tes marges et ton logo.<div class="row"><button class="pri" data-act="mdFirst">${J.icon('plus')} Ajouter mon premier modèle</button><button data-act="mdFolder">Ouvrir le dossier</button></div></div>`}
      ${d.instruments.map((it) => row(it, d)).join('')}
      ${d.ignored.length ? `<div class="card"><h2>Fichiers ignorés</h2>${d.ignored.map((f) => `<div class="line"><span class="path">${esc(f.name)}</span><span class="pill warn">${esc(f.problem)}</span></div>`).join('')}</div>` : ''}`;
    root.querySelectorAll('select[data-md-assign]').forEach((s) => s.addEventListener('change', async () => {
      try { await J.call('modeles.assign', { parlementId: pid, instrumentId: s.dataset.mdAssign, file: s.value }); J.toast(s.value ? 'Fichier choisi pour ce type de document' : 'Association automatique rétablie', 'ok'); J.render(); } catch (e) { J.err(e); J.render(); }
    }));
  };

  J.act.mdFolder = () => J.call('modeles.openFolder', { parlementId: J.P.actif });
  J.act.mdFirst = () => J.call('modeles.list', { parlementId: J.P.actif }).then((d) => { const i = d.instruments.find((x) => /ecrite/.test(x.id)) || d.instruments[0]; return J.act.mdAdd({ dataset: { i: i.id }, isConnected: false }); });
  J.act.mdAdd = (el) => J.busy(el.isConnected === false ? null : el, async () => {
    const r = await J.call('modeles.add', { parlementId: J.P.actif, instrumentId: el.dataset.i });
    if (!r) return; state.open.add(el.dataset.i); J.toast('Modèle ajouté et analysé : ' + r.file, 'ok'); await J.render();
  }, 'Analyse…');
  J.act.mdRemove = async (el) => {
    const ok = await J.confirm(`Retirer le modèle « ${el.dataset.f} » ? Seule la copie de Jarvis est concernée : elle est déplacée dans le sous-dossier _corbeille (récupérable) ; ton fichier d'origine n'est pas touché.`, { ok: 'Supprimer le modèle', danger: true, title: 'Supprimer le modèle' });
    if (!ok) return; await J.call('modeles.remove', { parlementId: J.P.actif, instrumentId: el.dataset.i }); J.toast('Modèle retiré (déplacé dans _corbeille)', 'ok'); J.render();
  };
  J.act.mdAnalyze = async (el) => {
    let allow = false;
    if (!J.S._env.local) { const cons = !!document.querySelector('[data-act="mdConsent"]:checked'); if (!cons) { allow = await J.confirm("Ton moteur IA est un service en ligne : le texte de ce modèle va lui être envoyé pour en déduire la structure et le ton. Continuer ?", { ok: 'Envoyer et analyser', title: 'Envoyer ce modèle ?' }); if (!allow) return; } }
    return J.busy(el, async () => { await J.call('modeles.analyze', { parlementId: J.P.actif, instrumentId: el.dataset.i, allowCloud: allow }); state.open.add(el.dataset.i); J.toast('Fiche du modèle établie par l\'IA', 'ok'); await J.render(); }, 'Analyse…');
  };
  J.act.mdConsent = async (el) => { try { await J.call('modeles.setConsent', { allow: !!el.checked }); J.toast(el.checked ? 'Envoi des modèles au moteur en ligne autorisé' : 'Envoi des modèles au moteur en ligne désactivé', 'ok'); } catch (e) { el.checked = !el.checked; J.err(e); } };
})();
