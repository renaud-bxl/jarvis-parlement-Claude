// Pages de travail : Recherche, Rédiger, Documents, Courriels, Agenda, Veille.

const sourcesHtml = (s) => (s || []).length ? '<h3 style="margin-top:14px">Sources consultées</h3>' + s.map((x) => `<div class="small">• <a href="${J.esc(x.url)}" data-ext="1">${J.esc(x.title || x.url)}</a></div>`).join('') : '';
const dossierOptions = async () => (await J.call('dossiers.list')).items.filter((d) => d.stage !== 'clos').map((d) => `<option value="${d.id}">${J.esc(d.title)}</option>`).join('');
const LANGS = { fr: 'Français', nl: 'Néerlandais', en: 'Anglais' };
// Affiche une erreur actionnable à la place d'un résultat (avec bouton « Réessayer »).
const outError = (id, e, retry) => { const o = document.getElementById(id); if (o) o.innerHTML = `<div class="empty err" role="alert"><b>Ça n'a pas fonctionné</b>${J.esc(J.errMsg(e))}<div class="row"><button class="pri" data-act="${retry}">Réessayer</button><a class="btn" href="#reglages">Vérifier mon moteur IA</a></div></div>`; };

// ---------- RECHERCHE ----------
const EXAMPLES = ["Projet d'ordonnance relatif aux zones de basses émissions : antécédents et questions déjà posées", 'Retards du tram 10 : chiffres de la STIB et réponses du ministre', 'Budget 2026 des crèches bruxelloises : évolution et pistes de questions'];
J.pages.recherche = async (root) => {
  const opts = await dossierOptions();
  root.innerHTML = `<h1>Recherche web & projet parlementaire</h1><p class="sub">Antécédents, compétence, actualité, chiffres et pistes de questions — avec sources. Le résultat est enregistré dans <b>02-Recherches</b> du parlement.</p>
    <div class="card"><div class="row sp"><label class="f" style="margin:0">Sujet, projet, texte ou question à creuser</label>${J.micBtn('rq')}</div><textarea id="rq" data-enter="doResearch" style="margin-top:6px" placeholder="Ex. Projet d'ordonnance relatif aux zones de basses émissions : antécédents et questions déjà posées"></textarea>
    <div class="chips" style="margin-top:8px" role="group" aria-label="Exemples de recherche"><span class="muted small" style="align-self:center">Exemples :</span>${EXAMPLES.map((x) => `<button type="button" class="chip" data-act="rEx" data-t="${J.esc(x)}">${J.esc(x.split(' : ')[0])}</button>`).join('')}</div>
    <div class="grid g2"><div><label class="f">Parlement ciblé</label><select id="rp">${J.parlOptions(J.P.actif)}</select></div><div><label class="f">Ajouter au dossier (optionnel)</label><select id="rd"><option value="">— aucun —</option>${opts}</select></div></div>
    <label class="chk"><input type="checkbox" id="rdeep"> Recherche approfondie (plus longue, plus complète)</label>
    <div class="row"><button class="pri" data-act="doResearch">${J.icon('search')} Lancer la recherche</button><span class="muted small">⌘ + Entrée pour lancer</span></div></div><div id="rOut" aria-live="polite"></div>`;
};
J.act.rEx = (el) => { const t = document.getElementById('rq'); t.value = el.dataset.t; t.focus(); };
J.act.doResearch = (el) => J.busy(el, async () => {
  const q = J.val('rq'); if (!q.trim()) { document.getElementById('rq').focus(); throw new Error('Décris le sujet à rechercher.'); }
  document.getElementById('rOut').innerHTML = `<div class="card"><p class="muted small"><span class="spin" aria-hidden="true"></span> Jarvis consulte le web et tes sources (30 à 90 secondes)…</p>${J.skeleton(2)}</div>`;
  let r; try { r = await J.call('research.web', { query: q, parlement: J.val('rp'), dossierId: J.val('rd') || undefined, deep: J.val('rdeep') }); } catch (e) { outError('rOut', e, 'doResearch'); throw e; }
  J.state.lastResearch = r;
  document.getElementById('rOut').innerHTML = `<div class="card"><div class="row sp"><h2>Résultat</h2><span class="row">${J.speakBtn('#rBody')}<button class="sm" data-act="rCopy">${J.icon('copy')} Copier</button><button class="sm" data-act="rToDraft">Rédiger à partir de ceci</button><button class="sm" data-act="rToDossier">Créer un dossier</button></span></div><div id="rBody">${J.md(r.answer)}</div>${sourcesHtml(r.sources)}${r.file ? `<p class="path">Enregistré : ${J.esc(r.file)}</p>` : ''}</div>`;
  document.getElementById('rOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}, 'Recherche en cours…');
J.act.rCopy = () => J.copy(J.state.lastResearch.answer);
J.act.rToDraft = () => { J.state.draftPrefill = { subject: J.state.lastResearch.query, context: J.state.lastResearch.answer, parlement: J.state.lastResearch.parlement }; J.go('redaction'); };
J.act.rToDossier = (el) => J.busy(el, async () => { const r = J.state.lastResearch; const d = await J.call('dossiers.create', { title: r.query.slice(0, 90), parlement: r.parlement, stage: 'recherche', notes: r.answer, sources: r.sources || [] }); J.toast('Dossier créé avec le résultat en notes', 'ok'); J.go('dossiers', d.id); }, 'Création…');

// ---------- RÉDIGER ----------
J.pages.redaction = async (root) => {
  const pre = J.state.draftPrefill || {}; J.state.draftPrefill = null;
  const opts = await dossierOptions();
  root.innerHTML = `<h1>Rédiger une question ou une interpellation</h1><p class="sub">Choisis le parlement : le modèle (structure, ton, destinataire, rappels réglementaires) s'adapte. Texte sauvegardé dans <b>03-Interpellations-et-Questions</b>.</p>
    <div class="card"><div class="grid g2"><div><label class="f">Parlement</label><select id="wp">${J.parlOptions(pre.parlement || J.P.actif)}</select></div><div><label class="f">Modèle</label><select id="wi"></select></div></div>
    <div class="grid g2"><div><label class="f">Langue</label><select id="wl"><option value="">Par défaut (${J.esc(LANGS[J.S.profile.langue] || J.S.profile.langue)})</option><option value="fr">Français</option><option value="nl">Néerlandais</option><option value="en">Anglais</option></select></div>
    <div><label class="f">Dossier lié (optionnel)</label><select id="wd"><option value="">— aucun —</option>${opts}</select></div></div>
    <div class="row sp"><label class="f">Sujet / angle</label>${J.micBtn('ws')}</div><input id="ws" data-enter="doDraft" value="${J.esc(pre.subject || '')}" placeholder="Ex. Retards récurrents du tram 10">
    <div class="row sp"><label class="f">Contexte et faits disponibles (colle une recherche, un article…)</label>${J.micBtn('wc')}</div><textarea id="wc" data-enter="doDraft" style="min-height:130px">${J.esc(pre.context || '')}</textarea>
    <label class="f">Consignes spécifiques</label><input id="wx" data-enter="doDraft" placeholder="Ex. Ton ferme, insister sur le budget">
    <div class="row" style="margin-top:12px"><button class="gold" data-act="doDraft">${J.icon('pen')} Rédiger avec Jarvis</button><span class="muted small">Jarvis prépare un brouillon : rien n'est envoyé ni déposé sans ta validation.</span></div></div><div id="wOut" aria-live="polite"></div>`;
  J.bindParl('wp', 'wi');
};
J.act.doDraft = (el) => J.busy(el, async () => {
  if (!J.val('ws').trim()) { document.getElementById('ws').focus(); throw new Error('Indique le sujet de ton texte.'); }
  document.getElementById('wOut').innerHTML = `<div class="card"><p class="muted small"><span class="spin" aria-hidden="true"></span> Jarvis rédige ton brouillon…</p>${J.skeleton(3)}</div>`;
  let r; try { r = await J.call('draft.run', { instrumentId: J.val('wi'), subject: J.val('ws'), context: J.val('wc'), language: J.val('wl') || undefined, dossierId: J.val('wd') || undefined, instructions: J.val('wx') }); } catch (e) { outError('wOut', e, 'doDraft'); throw e; }
  J.state.lastDraft = { ...r, dossierId: J.val('wd') || undefined };
  document.getElementById('wOut').innerHTML = `<div class="card"><div class="row sp"><h2>${J.esc(r.label)} <span class="muted small">· ${J.esc(r.parlement)}</span></h2><span class="row">${J.speakBtn('#wText')}<button class="sm" data-act="wFb" data-v="1" aria-label="Bon brouillon" title="Bon brouillon">${J.icon('up')}</button><button class="sm" data-act="wFb" data-v="-1" aria-label="Brouillon à améliorer" title="À améliorer">${J.icon('down')}</button></span></div>
    <textarea class="big" id="wText" aria-label="Texte du brouillon">${J.esc(r.text)}</textarea>
    <div class="row" style="margin-top:10px"><button class="pri sm" data-act="wLearn">Enregistrer mes corrections</button><button class="sm" data-act="wCopy">${J.icon('copy')} Copier</button><button class="sm" data-act="wExport">Exporter .md</button><button class="sm" data-act="wMail">Créer un courriel</button>${J.val('wd') ? '' : '<button class="sm" data-act="wDossier">Créer un dossier avec ce texte</button>'}</div>
    ${r.file ? `<p class="path">Enregistré : ${J.esc(r.file)}</p>` : ''}</div>`;
  document.getElementById('wOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}, 'Rédaction en cours…');
J.act.wCopy = () => J.copy(J.val('wText'));
J.act.wExport = () => J.download(J.val('wText'), 'brouillon.md');
J.act.wMail = () => { J.state.composePrefill = { subject: J.state.lastDraft.subject, body: J.val('wText') }; J.go('courriels'); };
// Retour 👍/👎 : « prompt() » n'existe pas dans Electron, on utilise la fenêtre J.ask.
J.act.wFb = async (el) => { const c = el.dataset.v === '-1' ? await J.ask("Qu'est-ce qui ne va pas ? (facultatif)", { title: 'Ton retour', placeholder: 'Trop long, ton trop mou…' }) : ''; if (c === null) return; await J.call('brain.feedback', { rating: Number(el.dataset.v), comment: c || '', output: J.val('wText') }); J.toast('Merci, retour pris en compte', 'ok'); };
// Enregistre les corrections : dans le dossier lié, ou dans UN seul nouveau dossier (créé au premier clic, réutilisé ensuite).
J.act.wLearn = (el) => J.busy(el, async () => {
  const r = J.state.lastDraft; const text = J.val('wText');
  if (r.draftId && r.dossierId) { await J.call('dossiers.saveDraft', { id: r.dossierId, draft: { id: r.draftId, text } }); return J.toast('Corrections enregistrées dans le dossier — Jarvis les étudie', 'ok'); }
  if (!r.savedDraftId) {
    const d = await J.call('dossiers.create', { title: r.subject.slice(0, 90), parlement: J.val('wp'), instrument: r.instrumentId, stage: 'redaction' });
    const saved = await J.call('dossiers.saveDraft', { id: d.id, draft: { text: r.text, original: r.text, label: r.label, parlement: r.parlement, instrumentId: r.instrumentId } });
    r.savedDossierId = d.id; r.savedDraftId = saved.id;
  }
  await J.call('dossiers.saveDraft', { id: r.savedDossierId, draft: { id: r.savedDraftId, text } }); J.toast('Corrections enregistrées dans un dossier — Jarvis les étudie', 'ok');
}, 'Enregistrement…');
J.act.wDossier = (el) => J.busy(el, async () => {
  const r = J.state.lastDraft; if (r.savedDossierId) return J.go('dossiers', r.savedDossierId);
  const d = await J.call('dossiers.create', { title: r.subject.slice(0, 90), parlement: J.val('wp'), instrument: r.instrumentId, stage: 'redaction' }); await J.call('dossiers.saveDraft', { id: d.id, draft: { text: J.val('wText'), original: r.text, label: r.label, parlement: r.parlement, instrumentId: r.instrumentId } }); J.go('dossiers', d.id);
}, 'Création…');

// ---------- DOCUMENTS ----------
J.pages.documents = async (root) => {
  const st = await J.call('index.stats');
  root.innerHTML = `<h1>Documents</h1><p class="sub">Analyse d'un document local (aucune recherche web), index plein-texte de tes dossiers et recherche dedans.</p>
    <div class="card"><h2>${J.hi('lock')}Analyser un document</h2><div class="row"><input id="dFile" class="grow" placeholder="Aucun fichier choisi" aria-label="Document à analyser" readonly><button data-act="pickDoc">Choisir un fichier…</button></div>
      <label class="f">Question (optionnel)</label><input id="dQst" data-enter="doAnalyze" placeholder="Ex. Quels sont les engagements budgétaires ?">
      ${J.S._env.local ? '<p class="muted small"><span class="pill ok">Local</span> Moteur local : le document ne quitte pas ton Mac.</p>' : '<label class="chk"><input type="checkbox" id="dCloud"> J\'autorise l\'envoi du texte de ce document à mon moteur IA cloud (aucune recherche web n\'est faite)</label>'}
      <button class="pri" data-act="doAnalyze">Analyser</button><div id="aOut" aria-live="polite" style="margin-top:12px"></div></div>
    <div class="card"><h2>${J.hi('layers')}Index documentaire</h2><div class="stats"><div class="stat"><b>${st.files}</b><span>fichier${st.files > 1 ? 's' : ''} indexé${st.files > 1 ? 's' : ''}</span></div><div class="stat"><b>${st.chunks}</b><span>extraits</span></div><div class="stat"><b style="font-size:15px;line-height:33px">${st.updated ? J.fmtDate(st.updated) : 'Jamais'}</b><span>dernière mise à jour</span></div></div>
      <p class="muted small">Formats : PDF, DOCX, TXT, MD, EML, HTML.</p>
      ${J.S.docs.folders.map((f) => `<div class="line"><span class="path" style="min-width:0">${J.esc(f)}</span><button class="sm danger" data-act="rmFolder" data-f="${J.esc(f)}">Retirer</button></div>`).join('') || '<div class="empty" style="padding:16px"><b>Aucun dossier surveillé</b>Ajoute un dossier de ton Mac pour que Jarvis puisse chercher dans tes documents.</div>'}
      <div class="row" style="margin-top:10px"><button data-act="addFolder">${J.icon('plus')} Ajouter un dossier</button><button class="pri" data-act="doIndex">Indexer maintenant</button><span class="muted small" id="progress" aria-live="polite"></span></div></div>
    <div class="card"><h2>${J.hi('search')}Chercher dans l'index</h2><div class="row"><input id="iq" class="grow" data-enter="doSearch" placeholder="mobilité Bruxelles budget 2026" aria-label="Recherche dans l'index"><button class="pri" data-act="doSearch">Chercher</button></div>
      <label class="chk"><input type="checkbox" id="isyn"> Faire une synthèse avec l'IA (envoie les extraits trouvés au moteur)</label><div id="iOut" aria-live="polite" style="margin-top:10px"></div></div>`;
};
J.act.pickDoc = async () => { const p = await J.call('doc.pick'); if (p) document.getElementById('dFile').value = p; };
J.act.doAnalyze = (el) => J.busy(el, async () => {
  const file = J.val('dFile'); if (!file) throw new Error('Choisis d\'abord un document avec « Choisir un fichier… ».');
  document.getElementById('aOut').innerHTML = `<p class="muted small"><span class="spin" aria-hidden="true"></span> Lecture et analyse du document…</p>${J.skeleton(2)}`;
  let r; try { r = await J.call('doc.analyze', { file, question: J.val('dQst'), allowCloud: J.S._env.local ? true : J.val('dCloud') }); } catch (e) { outError('aOut', e, 'doAnalyze'); throw e; }
  document.getElementById('aOut').innerHTML = `<p class="muted small">${r.chars.toLocaleString('fr-BE')} caractères analysés · ${r.local ? 'moteur local' : 'moteur cloud'} · sans recherche web</p><div id="aBody">${J.md(r.answer)}</div><div class="row" style="margin-top:8px"><button class="sm" data-act="aCopy">${J.icon('copy')} Copier</button>${J.speakBtn('#aBody')}</div>`;
  J.state.lastAnalysis = r.answer;
}, 'Analyse…');
J.act.aCopy = () => J.copy(J.state.lastAnalysis);
J.act.addFolder = async () => { await J.call('docs.addFolder'); await J.refreshMeta(); J.render(); };
J.act.rmFolder = async (el) => { if (!await J.confirm("Retirer ce dossier de l'index ? Tes fichiers ne sont pas touchés.", { ok: 'Retirer', danger: true, title: 'Retirer le dossier' })) return; await J.call('docs.removeFolder', { folder: el.dataset.f }); await J.refreshMeta(); J.render(); };
J.act.doIndex = (el) => J.busy(el, async () => { const r = await J.call('index.build'); J.toast(`Index : ${r.files} fichiers (${r.added} nouveaux)${r.errors.length ? ', ' + r.errors.length + ' erreur(s)' : ''}`, r.errors.length ? '' : 'ok'); J.render(); }, 'Indexation…');
J.act.doSearch = (el) => J.busy(el, async () => {
  if (!String(J.val('iq') || '').trim()) { document.getElementById('iq').focus(); throw new Error('Tape quelques mots à chercher.'); }
  const r = await J.call('index.search', { query: J.val('iq'), synthesize: J.val('isyn'), allowCloud: J.S._env.local ? true : !!J.val('isyn') });
  document.getElementById('iOut').innerHTML = (r.answer ? `<div class="card" style="background:var(--soft)">${J.md(r.answer)}</div>` : '') + (r.hits.length ? `<p class="muted small">${r.hits.length} résultat${r.hits.length > 1 ? 's' : ''}</p>` + r.hits.map((h) => `<div class="card"><div class="row sp"><b>${J.esc(h.name)}</b><button class="sm" data-act="showFile" data-f="${J.esc(h.file)}">Afficher dans le Finder</button></div><div class="small muted">${J.esc(h.text.slice(0, 420))}${h.text.length > 420 ? '…' : ''}</div></div>`).join('') : '<div class="empty"><b>Aucun résultat</b>Essaie d\'autres mots, ou clique sur « Indexer maintenant » si tu viens d\'ajouter des documents.</div>');
}, 'Recherche…');
J.act.showFile = (el) => J.call('app.openPath', { p: el.dataset.f });

// ---------- COURRIELS ----------
// La page Courriels et toutes ses actions (comptes, lecture, réponse, envoi) vivent dans renderer/mail-ui.js (J.mailPage).
J.pages.courriels = (root) => J.mailPage(root);

// ---------- AGENDA ----------
// Heures affichées en Europe/Brussels (fuseau de référence), quel que soit le fuseau du Mac. Lecture seule : rien n'est créé ni modifié chez Google.
const AG_TZ = 'Europe/Brussels', AG_ID_RE = /^\d{6,}-[a-z0-9_]{6,}\.apps\.googleusercontent\.com$/i, AG_HEX = /^#[0-9a-f]{6}$/i, AG_PERIODS = [[1, 'Aujourd\'hui'], [3, '3 jours'], [7, '7 jours'], [14, '14 jours']];
const AG_CSS = `.ag .sub{margin-top:-2px}.ag :focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.ag{--ag-ok:var(--ok);--ag-warn:var(--warn);--ag-ko:var(--ko)}
.ag-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:2px 0 16px}.ag-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card)}
.ag-seg button{border:0;border-radius:0;background:transparent;padding:7px 14px}.ag-seg button+button{border-left:1px solid var(--line)}.ag-seg button[aria-pressed=true]{background:var(--acc);color:var(--acc-ink,#fff)}
.ag-st{margin-left:auto;font-size:12.5px;color:var(--mute)}
.ag-alert{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;border:1px solid color-mix(in srgb,var(--ag-warn) 55%,var(--line));background:color-mix(in srgb,var(--ag-warn) 12%,var(--card));color:var(--ink);padding:11px 14px;border-radius:var(--r);margin-bottom:10px}
.ag-alert.ko{border-color:color-mix(in srgb,var(--ag-ko) 55%,var(--line));background:color-mix(in srgb,var(--ag-ko) 11%,var(--card))}
.ag-hero{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:18px}.ag-hero>div{flex:1 1 280px;border:1px solid var(--line);border-left:4px solid var(--acc);background:var(--card);border-radius:var(--r);padding:12px 16px;box-shadow:var(--shadow)}
.ag-hero .k{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);font-weight:700}.ag-hero .t{font-size:16px;font-weight:700;margin:2px 0}.ag-hero .now{border-left-color:var(--acc2)}
.ag-day{margin:0 0 20px;padding:2px 0}.ag-day.today{background:color-mix(in srgb,var(--acc) 6%,transparent);border-radius:var(--r);padding:10px 12px 2px;margin-left:-12px;margin-right:-12px}
.ag-day h3{margin:0 0 8px;font-size:14px;display:flex;gap:8px;align-items:center}.ag-day.today h3,.ag-day.tomorrow h3{color:var(--acc)}
.ag-day ul{list-style:none;margin:0;padding:0}.ag-ev{display:grid;grid-template-columns:84px 1fr auto;gap:12px;align-items:start;padding:10px 12px;border:1px solid var(--line);border-left:4px solid var(--cal,var(--acc));border-radius:10px;background:var(--card);margin-bottom:8px}
.ag-ev.now{border-color:var(--acc2);border-left-color:var(--acc2);background:color-mix(in srgb,var(--acc2) 13%,var(--card))}.ag-ev.past{opacity:.62}
.ag-time{font-variant-numeric:tabular-nums;line-height:1.3}.ag-time b{display:block;font-size:15px}.ag-time span,.ag-time small{display:block;color:var(--mute);font-size:12.5px}
.ag-title{font-weight:600;overflow-wrap:anywhere}.ag-meta{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--mute);font-size:12.5px;margin-top:3px}.ag-meta span{display:inline-flex;gap:4px;align-items:center}
.ag-dot{width:9px;height:9px;border-radius:50%;background:var(--cal,var(--acc));display:inline-block}
.ag-pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;font-weight:700;background:var(--soft);color:var(--ink);margin-left:6px;vertical-align:1px}.ag-pill.now{background:var(--pill-gold-bg,#fff0b8);color:var(--pill-gold,#5e4400)}.ag-pill.warn{background:var(--pill-warn-bg,#fdecc8);color:var(--pill-warn,#7a4f00)}.ag-pill.ok{background:var(--pill-ok-bg,#dcf3e6);color:var(--pill-ok,#17603d)}
.ag a.btn.sm{padding:4px 9px;font-size:12px}.ag a.btn.pri{background:var(--acc);border-color:var(--acc);color:var(--acc-ink,#fff)}.ag a.btn.pri:hover{filter:brightness(1.12);background:var(--acc)}
.ag-empty{padding:26px;text-align:center;color:var(--mute);border:1px dashed var(--line);border-radius:var(--r)}.ag-skel{height:54px;border-radius:10px;margin-bottom:8px;background:linear-gradient(90deg,var(--soft),color-mix(in srgb,var(--soft) 40%,var(--card)),var(--soft));background-size:200% 100%;animation:agsk 1.4s linear infinite}@keyframes agsk{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.ag-skel{animation:none}}
.ag-steps{list-style:none;margin:10px 0 0;padding:0;counter-reset:ag}.ag-steps>li{counter-increment:ag;position:relative;padding:0 0 14px 42px}.ag-steps>li:before{content:counter(ag);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--soft);color:var(--ink);font-weight:700;display:grid;place-items:center}
.ag-steps>li.done:before{content:"✓";background:var(--ag-ok);color:var(--card)}.ag-steps>li:not(:last-child):after{content:"";position:absolute;left:13px;top:32px;bottom:2px;width:2px;background:var(--line)}
.ag-steps b.h{display:block;margin-bottom:2px}.ag-steps .row{margin-top:6px;gap:8px;flex-wrap:wrap}.ag-msg{font-size:12.5px;margin-top:4px;min-height:1em}.ag-msg.ok{color:var(--ag-ok)}.ag-msg.ko{color:var(--ag-ko)}
.ag-acct{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)}.ag-acct:last-of-type{border:0}
.ag-pending{border:1px solid var(--acc);border-radius:var(--r);padding:12px 14px;margin-top:10px;background:color-mix(in srgb,var(--acc) 8%,var(--card))}
@media (max-width:760px){.ag-ev{grid-template-columns:70px 1fr}.ag-ev .ag-act{grid-column:2}}`;
const agKey = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: AG_TZ });
const agAdd = (k, n) => new Date(Date.parse(k + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const agDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const agHM = (ms) => new Date(ms).toLocaleTimeString('fr-BE', { timeZone: AG_TZ, hour: '2-digit', minute: '2-digit' });
const agDayLabel = (k) => { const t = new Date(k + 'T12:00:00Z').toLocaleDateString('fr-BE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const agDur = (min) => min >= 1440 ? `${Math.round(min / 1440)} j` : min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + String(min % 60).padStart(2, '0') : ''}` : `${min} min`;
const agRel = (ms, now) => { const m = Math.max(0, Math.round((ms - now) / 60000)); return m < 1 ? 'maintenant' : m < 60 ? `dans ${m} min` : m < 1440 ? `dans ${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}` : `dans ${Math.round(m / 1440)} j`; };
const agSafeUrl = (u) => /^https:\/\//i.test(u || '') ? u : '';
const agStore = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } } };
const agSt = () => (J.state.agenda ||= { days: [1, 3, 7, 14].includes(Number(agStore.get('jv_ag_days'))) ? Number(agStore.get('jv_ag_days')) : 7, seq: 0, data: null, at: 0, reauth: new Set(), pending: false });

// Découpe les événements par jour de Bruxelles (un événement sur plusieurs jours apparaît chaque jour concerné).
function agGroup(events, days, now) {
  const today = agKey(now), last = agAdd(today, days - 1), by = {};
  for (const e of events) {
    const first = agKey(e.startMs), lastK = e.endMs > e.startMs ? agKey(e.endMs - 1) : first, total = agDiff(first, lastK) + 1;
    for (let d = first < today ? today : first; d <= lastK && d <= last; d = agAdd(d, 1)) (by[d] ||= []).push({ e, n: agDiff(first, d) + 1, total, d, firstDay: d === first, lastDay: d === lastK });
  }
  const rank = (it) => (it.e.allDay || (it.total > 1 && !it.firstDay && !it.lastDay)) ? 0 : 1; // journées entières d'abord
  for (const k of Object.keys(by)) by[k].sort((a, b) => rank(a) - rank(b) || a.e.startMs - b.e.startMs);
  return by;
}
function agRow(it, now, isToday) {
  const e = it.e, multi = it.total > 1, color = AG_HEX.test(e.color || '') ? e.color : '';
  const live = !e.allDay && e.startMs <= now && now < e.endMs, past = isToday && !e.allDay && e.endMs <= now;
  let time;
  if (e.allDay || (multi && !it.firstDay && !it.lastDay)) time = `<b>Journée</b>${multi ? `<span>jour ${it.n}/${it.total}</span>` : ''}`;
  else if (multi) time = it.firstDay ? `<b>${agHM(e.startMs)}</b><span>→ jour ${it.total}</span>` : `<b>→ ${agHM(e.endMs)}</b><span>jour ${it.n}/${it.total}</span>`;
  else time = `<b>${agHM(e.startMs)}</b>${e.endMs > e.startMs ? `<span>${agHM(e.endMs)}</span><small>${agDur(Math.round((e.endMs - e.startMs) / 60000))}</small>` : ''}`;
  const resp = { tentative: ['warn', 'Peut-être'], needsAction: ['warn', 'Sans réponse'] }[e.response];
  const names = (e.attendees || []).filter((a) => !a.self).map((a) => a.name).join(', ');
  const video = agSafeUrl(e.video), cal = agSafeUrl(e.link);
  const label = `${e.title}, ${e.allDay ? 'toute la journée' : agHM(e.startMs) + (e.endMs > e.startMs ? ' à ' + agHM(e.endMs) : '')}${live ? ', en cours' : past ? ', terminé' : ''}`;
  return `<li class="ag-ev${live ? ' now' : ''}${past ? ' past' : ''}" style="${color ? `--cal:${color}` : ''}" aria-label="${J.esc(label)}">
    <div class="ag-time">${time}</div>
    <div><div class="ag-title">${J.esc(e.title)}${live ? '<span class="ag-pill now">En cours</span>' : ''}${e.kind === 'outOfOffice' ? '<span class="ag-pill">Absence</span>' : ''}${resp ? `<span class="ag-pill ${resp[0]}">${resp[1]}</span>` : ''}</div>
      <div class="ag-meta">${e.location ? `<span>📍 ${J.esc(e.location)}</span>` : ''}${e.attendeeCount > 1 ? `<span title="${J.esc(names)}">👥 ${e.attendeeCount} participants</span>` : ''}<span><i class="ag-dot" aria-hidden="true"></i>${J.esc(e.calendar)}${(e.alsoIn || []).length ? J.esc(' + ' + e.alsoIn.join(', ')) : ''}</span>${cal ? `<a data-ext="1" href="${J.esc(cal)}" aria-label="Ouvrir « ${J.esc(e.title)} » dans Google Agenda">Google Agenda ↗</a>` : ''}</div></div>
    <div class="ag-act">${video ? `<a class="btn sm pri" data-ext="1" href="${J.esc(video)}" aria-label="Rejoindre la visioconférence : ${J.esc(e.title)}">🎥 Rejoindre</a>` : ''}</div></li>`;
}

function agPaint() {
  const st = agSt(), list = document.getElementById('agList'); if (!list) return;
  const now = Date.now(), d = st.data;
  const bar = document.getElementById('agStatus');
  document.querySelectorAll('.ag-seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.d) === st.days)));
  if (!d) { list.setAttribute('aria-busy', 'true'); list.innerHTML = '<div class="ag-skel"></div><div class="ag-skel"></div><div class="ag-skel"></div><span class="sr" style="position:absolute;left:-9999px">Chargement de l\'agenda…</span>'; return; }
  list.setAttribute('aria-busy', 'false');
  if (bar) bar.textContent = st.loading ? 'Actualisation…' : `Mis à jour à ${new Date(st.at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} · heures de Bruxelles`;
  const alerts = [];
  for (const x of d.errorDetails || []) alerts.push(`<div class="ag-alert${x.reauth ? '' : ' ko'}" role="alert"><span><b>${J.esc(x.account)}</b> — ${J.esc(x.message)}</span>${x.reauth ? `<button class="sm pri" data-act="gConnect">Reconnecter ce compte</button>` : `<button class="sm" data-act="agRefresh">Réessayer</button>`}</div>`);
  if (!(d.errorDetails || []).length) for (const m of d.errors || []) alerts.push(`<div class="ag-alert ko" role="alert"><span>${J.esc(m)}</span><button class="sm" data-act="agRefresh">Réessayer</button></div>`);
  if (st.error) alerts.push(`<div class="ag-alert ko" role="alert"><span>${J.esc(st.error)}</span><button class="sm" data-act="agRefresh">Réessayer</button></div>`);
  document.getElementById('agAlerts').innerHTML = alerts.join('');
  st.reauth = new Set((d.errorDetails || []).filter((x) => x.reauth).map((x) => x.account));
  // Maintenant / prochain
  const timed = d.events.filter((e) => !e.allDay), cur = timed.filter((e) => e.startMs <= now && now < e.endMs), next = timed.find((e) => e.startMs > now);
  const hero = [];
  for (const e of cur.slice(0, 2)) hero.push(`<div class="now"><div class="k">En cours</div><div class="t">${J.esc(e.title)}</div><div class="muted small">jusqu'à ${agHM(e.endMs)}${e.location ? ' · 📍 ' + J.esc(e.location) : ''}</div></div>`);
  if (next) hero.push(`<div><div class="k">Prochain événement · ${agRel(next.startMs, now)}</div><div class="t">${J.esc(next.title)}</div><div class="muted small">${agKey(next.startMs) === agKey(now) ? 'à' : new Date(next.startMs).toLocaleDateString('fr-BE', { timeZone: AG_TZ, weekday: 'long', day: 'numeric', month: 'long' }) + ','} ${agHM(next.startMs)}${next.location ? ' · 📍 ' + J.esc(next.location) : ''}</div></div>`);
  document.getElementById('agNow').innerHTML = hero.length ? `<div class="ag-hero" aria-label="Maintenant et prochain événement">${hero.join('')}</div>` : '';
  // Liste par jour
  const by = agGroup(d.events, st.days, now), today = agKey(now), tomorrow = agAdd(today, 1);
  const keys = Object.keys(by).sort(); if (!by[today]) keys.unshift(today);
  const html = keys.map((k) => {
    const items = by[k] || [], tag = k === today ? 'today' : k === tomorrow ? 'tomorrow' : '';
    return `<section class="ag-day ${tag}" aria-labelledby="agd${k}"><h3 id="agd${k}">${tag === 'today' ? '<span class="ag-pill now" style="margin:0">Aujourd\'hui</span>' : tag === 'tomorrow' ? '<span class="ag-pill" style="margin:0">Demain</span>' : ''}${J.esc(agDayLabel(k))}<span class="muted small" style="font-weight:400;text-transform:none">${items.length ? `· ${items.length} événement${items.length > 1 ? 's' : ''}` : ''}</span></h3>
      ${items.length ? `<ul>${items.map((it) => agRow(it, now, k === today)).join('')}</ul>` : '<p class="muted small" style="margin:0 0 12px">Rien de prévu aujourd\'hui.</p>'}</section>`;
  }).join('');
  const none = !d.events.length && !(d.errorDetails || []).length && !(d.errors || []).length && !st.error;
  list.innerHTML = (none ? `<div class="ag-empty"><b>Aucun événement ${st.days === 1 ? 'aujourd\'hui' : 'sur les ' + st.days + ' prochains jours'}.</b><div class="small" style="margin-top:4px">Ton agenda est libre${(d.calendars || []).length ? ` (${d.calendars.length} agenda${d.calendars.length > 1 ? 's' : ''} consulté${d.calendars.length > 1 ? 's' : ''})` : ''}.</div></div>` : html)
    + (d.declined ? `<p class="muted small">${d.declined} événement${d.declined > 1 ? 's refusés masqués' : ' refusé masqué'}.</p>` : '');
}

async function agLoad(fresh) {
  const st = agSt(), seq = ++st.seq; st.loading = true; st.error = null;
  agPaint();
  try {
    const r = await J.call('google.events', { days: st.days, fresh: !!fresh });
    if (seq !== st.seq) return; st.data = r; st.at = Date.now();
  } catch (e) { if (seq !== st.seq) return; st.error = e.message || String(e); st.data ||= { events: [], errors: [], errorDetails: [] }; }
  st.loading = false; agPaint();
}

// Guide de connexion pas à pas (utilisé à la première connexion, et replié dans « Connexion » ensuite).
function agSetup(g, hasSecret, withConnect = true) {
  const idOk = AG_ID_RE.test(g.clientId || ''), ready = idOk && hasSecret, linked = g.accounts.length > 0;
  const open = (u, t) => `<a class="btn sm" data-ext="1" href="${u}">${t} ↗</a>`;
  return `<ol class="ag-steps">
    <li class="${idOk || linked ? 'done' : ''}"><b class="h">Crée un projet Google Cloud (gratuit)</b><span class="small muted">Un projet personnel suffit : il sert uniquement à te connecter à ton propre agenda.</span><div class="row">${open('https://console.cloud.google.com/projectcreate', 'Créer un projet')}</div></li>
    <li class="${idOk || linked ? 'done' : ''}"><b class="h">Active les deux API en lecture</b><span class="small muted">Clique sur « Activer » sur chacune des deux pages.</span><div class="row">${open('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', 'Google Calendar API')}${open('https://console.cloud.google.com/apis/library/gmail.googleapis.com', 'Gmail API')}</div></li>
    <li class="${idOk || linked ? 'done' : ''}"><b class="h">Configure l'écran de consentement</b><span class="small muted">Type « Externe », ajoute ton adresse comme utilisateur test, puis clique sur <b>Publier l'application</b> : sans cela, Google coupe la connexion au bout de 7 jours. Au premier accès, Google peut afficher « application non vérifiée » : c'est ton propre projet, choisis « Paramètres avancés › Continuer ».</span><div class="row">${open('https://console.cloud.google.com/apis/credentials/consent', 'Écran de consentement')}</div></li>
    <li class="${idOk || linked ? 'done' : ''}"><b class="h">Crée l'ID client « Application de bureau »</b><span class="small muted">Créer des identifiants › ID client OAuth › type <b>Application de bureau</b>. Google affiche alors un ID client et un code secret.</span><div class="row">${open('https://console.cloud.google.com/apis/credentials', 'Identifiants')}</div></li>
    <li class="${ready || linked ? 'done' : ''}"><b class="h">Colle l'ID client et le code secret</b>
      <label class="f" for="gId">ID client <span class="muted small">(se termine par .apps.googleusercontent.com)</span></label><input id="gId" autocomplete="off" spellcheck="false" aria-describedby="gIdMsg" value="${J.esc(g.clientId)}" placeholder="123456789012-abcdef….apps.googleusercontent.com"><div id="gIdMsg" class="ag-msg" role="status">${g.clientId ? (idOk ? '<span class="ok">Format valide ✓</span>' : '') : ''}</div>
      <label class="f" for="gSec">Code secret du client</label><input id="gSec" type="password" autocomplete="off" aria-describedby="gSecMsg" placeholder="${hasSecret ? '•••••• (déjà enregistré — laisse vide pour le conserver)' : 'GOCSPX-…'}"><div id="gSecMsg" class="ag-msg" role="status"></div>
      <div class="row"><button data-act="gSave">Enregistrer</button><span class="small muted">Le code secret est chiffré dans le trousseau macOS.</span></div></li>
    ${withConnect ? `<li class="${linked ? 'done' : ''}"><b class="h">Connecte ton compte Google</b><span class="small muted">Une page Google s'ouvre dans ton navigateur : choisis ton compte et autorise la <b>lecture seule</b> de l'agenda et de Gmail.</span>
      <div class="row"><button class="pri" data-act="gConnect" ${ready ? '' : 'disabled aria-describedby="gGoWhy"'}>${linked ? 'Ajouter un autre compte Google' : 'Se connecter avec Google'}</button>${ready ? '' : '<span id="gGoWhy" class="small muted">Enregistre d\'abord l\'ID client et le code secret (étape 5).</span>'}</div><div id="agPending"></div></li>` : ''}
  </ol>`;
}

J.pages.agenda = async (root) => {
  if (!document.getElementById('ag-css')) { const s = document.createElement('style'); s.id = 'ag-css'; s.textContent = AG_CSS; document.head.appendChild(s); }
  const g = J.S.google, st = agSt(), hasSecret = !!J.S._secrets.google_client_secret, connected = g.accounts.length > 0;
  const head = '<h1>Agenda</h1><p class="sub">Ton agenda Google en lecture seule : Jarvis consulte, ne crée, ne modifie et ne supprime jamais rien. Les jetons sont chiffrés dans le trousseau macOS.</p>';
  if (!connected) {
    root.innerHTML = `<div class="ag">${head}<div class="card"><h2>Connecte ton agenda Google</h2><p class="muted small" style="margin-top:0">À faire une seule fois, environ 5 minutes. Les boutons ouvrent les bonnes pages de Google dans ton navigateur.</p>${agSetup(g, hasSecret)}</div></div>`;
    agBindId(); return;
  }
  root.innerHTML = `<div class="ag">${head}
    <div class="ag-bar"><div class="ag-seg" role="group" aria-label="Période affichée">${AG_PERIODS.map(([n, l]) => `<button data-act="agDays" data-d="${n}" aria-pressed="${n === st.days}">${l}</button>`).join('')}</div>
      <button data-act="agRefresh" aria-label="Actualiser l'agenda">↻ Actualiser</button><span class="ag-st" id="agStatus" role="status" aria-live="polite"></span></div>
    <div id="agAlerts"></div><div id="agNow"></div><div id="agList" aria-live="polite" aria-busy="true"></div>
    <div class="card" style="margin-top:8px"><h2>Comptes Google</h2>
      ${g.accounts.map((a) => `<div class="ag-acct"><span>${st.reauth.has(a) ? '🟠' : '🟢'} ${J.esc(a)} <span class="ag-pill ${st.reauth.has(a) ? 'warn' : 'ok'}">${st.reauth.has(a) ? 'À reconnecter' : 'Lecture seule'}</span></span><button class="sm danger" data-act="gDisc" data-e="${J.esc(a)}" aria-label="Déconnecter ${J.esc(a)}">Déconnecter</button></div>`).join('')}
      <div class="row" style="margin-top:10px"><button data-act="gConnect" ${hasSecret && g.clientId ? '' : 'disabled'}>+ Ajouter un autre compte Google</button></div><div id="agPending"></div>
      <details style="margin-top:12px"><summary><b>Identifiants Google et guide de configuration</b></summary>${agSetup(g, hasSecret, false)}</details></div></div>`;
  agBindId();
  if (st.data && Date.now() - st.at < 300000) agPaint(); // affichage immédiat des données récentes pendant l'actualisation
  agLoad(false);
  clearInterval(st.tick); st.tick = setInterval(() => { // « en cours » et « prochain » restent justes ; actualisation douce toutes les 5 min
    if (!document.getElementById('agList')) return clearInterval(st.tick);
    if (Date.now() - st.at > 300000 && !st.loading) agLoad(false); else agPaint();
  }, 60000);
};
function agBindId() {
  const inp = document.getElementById('gId'); if (!inp) return;
  inp.addEventListener('input', () => { const v = inp.value.trim(), m = document.getElementById('gIdMsg'); if (!m) return; m.className = 'ag-msg ' + (!v ? '' : AG_ID_RE.test(v) ? 'ok' : 'ko'); m.textContent = !v ? '' : AG_ID_RE.test(v) ? 'Format valide ✓' : 'Ce n\'est pas un ID client valide : il ressemble à 123456789012-abc….apps.googleusercontent.com'; });
}
J.act.agDays = (el) => { const st = agSt(); st.days = Number(el.dataset.d); agStore.set('jv_ag_days', String(st.days)); st.data = null; agLoad(false); };
J.act.agRefresh = () => agLoad(true);
J.act.gSave = async () => {
  const id = J.val('gId').trim(), sec = (J.val('gSec') || '').trim(), had = !!J.S._secrets.google_client_secret, mi = document.getElementById('gIdMsg'), ms = document.getElementById('gSecMsg');
  if (mi) { mi.className = 'ag-msg'; mi.textContent = ''; } if (ms) { ms.className = 'ag-msg'; ms.textContent = ''; }
  if (!AG_ID_RE.test(id)) { if (mi) { mi.className = 'ag-msg ko'; mi.textContent = 'ID client invalide : copie-le depuis la console Google (il se termine par .apps.googleusercontent.com).'; } document.getElementById('gId')?.focus(); return; }
  if (!sec && !had) { if (ms) { ms.className = 'ag-msg ko'; ms.textContent = 'Le code secret du client est nécessaire (visible à côté de l\'ID client).'; } document.getElementById('gSec')?.focus(); return; }
  await J.call('settings.set', { google: { clientId: id } }); if (sec) await J.call('secret.set', { name: 'google_client_secret', value: sec });
  await J.refreshMeta(); J.toast('Identifiants enregistrés. Tu peux maintenant te connecter.', 'ok'); J.render();
};
J.act.gConnect = async (el) => {
  const st = agSt(); if (st.pending) return; st.pending = true;
  const slot = document.getElementById('agPending'), btns = J.$$('[data-act=gConnect]'); btns.forEach((b) => { b.disabled = true; });
  if (slot) slot.innerHTML = '<div class="ag-pending" role="status"><b>Page Google ouverte dans ton navigateur.</b><div class="small muted" style="margin:4px 0 8px">Choisis ton compte puis autorise la lecture seule de l\'agenda et de Gmail. Si rien ne s\'est ouvert, ferme cet écran et réessaie. Délai : 3 minutes.</div><button class="sm" data-act="gCancel">Annuler</button></div>';
  try {
    const r = await J.call('google.connect');
    J.toast('Connecté : ' + r.email, 'ok'); if (r.warning) J.toast(r.warning, 'err');
    st.data = null; await J.refreshMeta(); st.pending = false; J.render();
  } catch (e) {
    st.pending = false; btns.forEach((b) => { b.disabled = false; });
    const cancelled = /annulée/i.test(e.message || '');
    if (slot) slot.innerHTML = cancelled ? '' : `<div class="ag-alert ko" role="alert" style="margin-top:10px"><span>${J.esc(e.message)}</span><button class="sm" data-act="gConnect">Réessayer</button></div>`;
    if (cancelled) J.toast('Connexion annulée'); else J.err(e);
  }
};
J.act.gCancel = async () => { try { await J.call('google.cancel'); } catch { J.toast('Ferme l\'onglet Google : la connexion expirera d\'elle-même au bout de 3 minutes.'); } };
J.act.gDisc = async (el) => {
  const mail = el.dataset.e; if (!confirm(`Déconnecter ${mail} ?\n\nL'accès de Jarvis sera révoqué chez Google et le jeton effacé de ce Mac. Tes données Google ne sont pas touchées.`)) return;
  await J.call('google.disconnect', { email: mail }); const st = agSt(); st.data = null; await J.refreshMeta(); J.toast('Compte déconnecté', 'ok'); J.render();
};

// ---------- VEILLE ----------
J.pages.veille = async (root) => {
  const [v, items] = await Promise.all([J.call('veille.status'), J.call('veille.items')]);
  const topics = J.S.veille.topics; const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const shown = items.items.filter((i) => i.status !== 'ignored').slice(0, 40);
  root.innerHTML = `<h1>Veille</h1><p class="sub">Jarvis surveille tes sujets sur le web et te propose des pistes de questions. Chaque exécution est classée dans <b>01-Veille</b> du parlement concerné.</p>
    <div class="card"><h2>Sujets surveillés</h2><div id="topics">${(topics.length ? topics : [{}]).map(topicRow).join('')}</div>
      <div class="row" style="margin-top:8px"><button data-act="addTopic">${J.icon('plus')} Ajouter un sujet</button><button data-act="saveTopics">Enregistrer les sujets</button><button class="pri" data-act="runVeille">Lancer la veille maintenant</button></div></div>
    <div class="card"><h2>Veille automatique ${v.enabled ? '<span class="pill ok">active</span>' : '<span class="pill">désactivée</span>'}</h2>
      <p class="muted small">S'exécute chaque jour choisi à l'heure indiquée, tant que Jarvis est ouvert (rattrapage au lancement si le Mac dormait).${v.lastRun ? ' Dernière exécution : ' + J.fmtDate(v.lastRun) + '.' : ''}</p>
      <div class="row"><label class="chk" style="margin:0"><input type="checkbox" id="vEn" ${v.enabled ? 'checked' : ''}> Activer</label><input id="vTime" type="time" aria-label="Heure d'exécution" value="${J.esc(v.time)}" style="width:120px">
      <span class="chips" role="group" aria-label="Jours d'exécution">${days.map((d, i) => `<label class="dchip"><input type="checkbox" class="vDay" value="${i}" ${v.days.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</span><button data-act="saveSchedule">Enregistrer la planification</button></div>
      <div class="row" style="margin-top:12px"><button class="danger" data-act="removeVeille">Retirer la veille automatique</button><span class="muted small">Supprime la planification (tes sujets et résultats sont conservés).</span></div></div>
    <h2 style="margin-top:8px">Dernières trouvailles ${shown.length ? `<span class="pill">${shown.length}</span>` : ''}</h2>
    ${shown.map((i) => { const n = Math.max(1, Math.min(3, Number(i.score) || 1)); return `<div class="card"><div class="row sp"><b>${J.esc(i.title)}</b><span class="row"><span class="pill">${J.esc(i.topic)}</span><span class="pill gold" title="Pertinence ${n} sur 3" aria-label="Pertinence ${n} sur 3">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span></span></div>
      <p style="margin:6px 0">${J.esc(i.summary)}</p>${i.idea ? `<p class="small"><b>Piste :</b> ${J.esc(i.idea)}</p>` : ''}
      <div class="row">${i.url ? `<a data-ext="1" href="${J.esc(i.url)}" class="small">${J.esc(i.source || i.url)}</a>` : ''}<span class="muted small">${J.esc(i.date)}</span><span class="grow"></span>
      ${i.status === 'dossier' ? '<span class="pill ok">dossier créé</span>' : `<button class="sm pri" data-act="vDossier" data-id="${i.id}">Créer un dossier</button>`}<button class="sm" data-act="vIgnore" data-id="${i.id}">Ignorer</button></div></div>`; }).join('') || `<div class="empty"><b>Aucune trouvaille pour l'instant</b>Ajoute un sujet ci-dessus (ex. « mobilité Bruxelles »), puis lance la veille : Jarvis te rapporte les faits récents et des pistes de questions.</div>`}`;
};
const topicRow = (t) => `<div class="row topic" style="margin-bottom:6px;flex-wrap:nowrap"><input class="tl" aria-label="Sujet surveillé" placeholder="Sujet (ex. mobilité Bruxelles)" value="${J.esc(t.label || '')}" style="flex:2"><input class="tk" aria-label="Mots-clés" placeholder="mots-clés (facultatif)" value="${J.esc(t.keywords || '')}" style="flex:2"><select class="tp" aria-label="Parlement du sujet" style="flex:2"><option value="">Parlement : actif</option>${J.parlOptions(t.parlement)}</select><button class="sm danger" data-act="rmTopic" aria-label="Retirer ce sujet" title="Retirer ce sujet">${J.icon('trash')}</button></div>`;
const readTopics = () => J.$$('.topic').map((r) => ({ label: J.$('.tl', r).value.trim(), keywords: J.$('.tk', r).value.trim(), parlement: J.$('.tp', r).value })).filter((t) => t.label);
J.act.addTopic = () => { const box = document.getElementById('topics'); box.insertAdjacentHTML('beforeend', topicRow({})); box.lastElementChild.querySelector('input').focus(); };
J.act.rmTopic = (el) => el.closest('.topic').remove();
J.act.saveTopics = async () => { await J.call('veille.topics', { topics: readTopics() }); await J.refreshMeta(); J.toast('Sujets enregistrés', 'ok'); };
J.act.runVeille = (el) => J.busy(el, async () => { const t = readTopics(); if (!t.length) { J.$('.tl')?.focus(); throw new Error('Ajoute au moins un sujet à surveiller.'); } await J.call('veille.topics', { topics: t }); await J.refreshMeta(); const r = await J.call('veille.run'); J.toast(`${r.created} nouveauté(s)${r.errors.length ? ' · ' + r.errors[0] : ''}`, r.errors.length ? 'err' : 'ok'); J.render(); }, 'Veille en cours (1-3 min)…');
J.act.saveSchedule = async () => { await J.call('veille.configure', { enabled: J.val('vEn'), time: J.val('vTime'), days: J.$$('.vDay').filter((c) => c.checked).map((c) => Number(c.value)) }); J.toast('Planification enregistrée', 'ok'); J.render(); };
J.act.removeVeille = async () => { if (!await J.confirm('Retirer la veille automatique ? Tes sujets et résultats sont conservés.', { ok: 'Retirer', danger: true, title: 'Retirer la veille automatique' })) return; await J.call('veille.remove'); J.toast('Veille automatique retirée', 'ok'); J.render(); };
J.act.vDossier = (el) => J.busy(el, async () => { const d = await J.call('veille.toDossier', { id: el.dataset.id }); J.go('dossiers', d.id); }, 'Création…');
J.act.vIgnore = async (el) => { await J.call('veille.setStatus', { id: el.dataset.id, status: 'ignored' }); J.toast('Trouvaille ignorée', 'ok'); J.render(); };
