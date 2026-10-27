// Pages : Accueil (briefing), Parlements, Dossiers (de la veille à la réponse).

// ---------- TABLEAU DE BORD (ancien accueil : briefing, échéances, raccourcis) ----------
J.pages.tableau = async (root) => {
  const [last, dos] = await Promise.all([J.call('briefing.last'), J.call('dossiers.list')]);
  const nom = J.S.profile.nom ? ', ' + J.esc(J.S.profile.nom.split(' ')[0]) : '';
  const soon = dos.items.filter((d) => d.stage !== 'clos' && d.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 5);
  const tiles = [
    ['recherche', 'Recherche web & projet', 'Antécédents, compétence, angles de questions'], ['documents', 'Analyser un document', 'Sans recherche web, 100 % local possible'],
    ['tableau', 'Briefing du jour', 'Agenda, dossiers, veille, courrier'], ['courriels', 'Lire & résumer mes courriels', 'Lecture seule, rien n\'est marqué lu'],
    ['courriels', 'Envoyer un .eml', 'Après validation explicite'], ['reglages', 'Configuration', 'Profil, moteur IA, comptes'],
    ['documents', 'Indexer & chercher', 'Dans tous vos documents'], ['diagnostic', 'Diagnostic', 'Tout vérifier en un clic'],
    ['agenda', 'Google Agenda', 'Connexion native'], ['veille', 'Veille automatique', 'Activer ou retirer'], ['redaction', 'Modèles par parlement', 'Question, interpellation, résolution…'],
  ];
  root.innerHTML = `
    <h1>Tableau de bord${nom}</h1>
    <p class="sub">${new Date().toLocaleDateString('fr-BE', { dateStyle: 'full' })} · Parlement actif : <b>${J.esc(J.parlName(J.P.actif))}</b></p>
    ${J.S._env.configured ? '' : '<div class="banner"><b>Dernière étape :</b> configure ton moteur IA pour activer Jarvis. <a href="#reglages">Ouvrir les Réglages →</a></div>'}
    <div class="card">
      <div class="row sp"><h2>☀️ Briefing du jour</h2>
        <div class="row">${J.speakBtn('#briefOut')}<label class="chk" style="margin:0"><input type="checkbox" id="brFresh"> Actualiser la veille d'abord</label><button class="pri" data-act="brief">Générer le briefing</button></div></div>
      <div id="briefOut">${last ? `<p class="muted small">Généré le ${J.fmtDate(last.t)}</p>${J.md(last.text)}` : '<div class="empty">Aucun briefing pour l\'instant. Il rassemble ton agenda, tes dossiers, ta veille et tes pistes de questions.</div>'}</div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>⏰ Échéances</h2>${soon.length ? soon.map((d) => `<div class="row sp" style="padding:5px 0"><a href="#dossiers/${d.id}">${J.esc(d.title)}</a><span class="pill gold">${J.fmtDay(d.deadline)}</span></div>`).join('') : '<p class="muted">Aucune échéance. Ajoute une date limite dans tes dossiers.</p>'}</div>
      <div class="card"><h2>🚀 Démarrer un dossier</h2><p class="muted">De l'idée à la question déposée, tout est suivi au même endroit.</p><button class="pri" data-act="newDossier">Nouveau dossier</button> <button data-act="goVeille">Voir la veille</button></div>
    </div>
    <h2 style="margin-top:8px">Tout ce que Jarvis sait faire</h2>
    <div class="grid g4">${tiles.map((t) => `<a class="tile" href="#${t[0]}"><b>${t[1]}</b><span>${t[2]}</span></a>`).join('')}</div>`;
};
J.act.brief = (el) => J.busy(el, async () => {
  const r = await J.call('briefing.run', { refreshVeille: J.val('brFresh') });
  document.getElementById('briefOut').innerHTML = `<p class="muted small">Généré le ${J.fmtDate(r.t)}</p>${J.md(r.text)}`;
}, 'Préparation…');
J.act.goVeille = () => J.go('veille');

// ---------- PARLEMENTS ----------
J.pages.parlements = async (root) => {
  await J.refreshMeta(); J.drawChrome();
  const P = J.P; const folders = Object.fromEntries(P.folders.parlements.map((f) => [f.id, f]));
  const actifs = P.parlements.filter((p) => P.actifs.includes(p.id)), dispo = P.parlements.filter((p) => !P.actifs.includes(p.id));
  root.innerHTML = `<h1>Mes parlements</h1>
    <p class="sub">Tu peux siéger dans plusieurs assemblées, ou en changer : les modèles d'interpellation s'adaptent, tout le reste fonctionne pareil. Chaque parlement actif reçoit automatiquement son dossier dans <span class="path">${J.esc(P.folders.root)}</span>.</p>
    ${actifs.map((p) => `<div class="card"><div class="row sp"><div><h2 style="margin:0">${J.esc(p.nom)} ${p.id === P.actif ? '<span class="pill ok">actif</span>' : ''}</h2><span class="muted small">${J.esc(p.niveau || '')}</span></div>
        <div class="row">${p.id !== P.actif ? `<button class="sm" data-act="parlActive" data-id="${p.id}">Rendre actif</button>` : ''}<button class="sm" data-act="parlOpen" data-id="${p.id}">Ouvrir le dossier</button><button class="sm danger" data-act="parlRemove" data-id="${p.id}">Retirer</button></div></div>
        <p class="path">${J.esc(folders[p.id]?.path || '')}</p>
        <div class="row">${p.instruments.map((i) => `<span class="pill">${J.esc(i.label)}</span>`).join('')}</div>
        <p class="muted small" style="margin-bottom:0">Sous-dossiers : 01-Veille · 02-Recherches · 03-Interpellations-et-Questions · 04-Documents · 05-Courriers · 06-Archives</p></div>`).join('')}
    <div class="card"><h2>➕ Ajouter un parlement</h2>
      <div class="row"><select id="addParl" class="grow">${dispo.map((p) => `<option value="${p.id}">${J.esc(p.nom)}</option>`).join('') || '<option value="">(tous déjà actifs)</option>'}</select><button class="pri" data-act="parlAdd">Ajouter</button></div>
      <p class="muted small">Retirer un parlement ne supprime jamais son dossier sur ton disque.</p></div>
    <div class="card"><h2>🏛️ Créer un parlement personnalisé</h2>
      <p class="muted small">Un parlement qui n'est pas dans la liste (conseil communal, assemblée provinciale…) : Jarvis copie les modèles d'un parlement proche, à adapter ensuite.</p>
      <div class="grid g3"><div><label class="f">Nom</label><input id="cpNom" placeholder="Conseil communal de …"></div><div><label class="f">Niveau</label><input id="cpNiv" placeholder="Commune"></div>
      <div><label class="f">Copier les modèles de</label><select id="cpBase">${P.parlements.map((p) => `<option value="${p.id}">${J.esc(p.nom)}</option>`).join('')}</select></div></div>
      <button class="pri" style="margin-top:12px" data-act="parlCreate">Créer</button></div>
    <div class="card"><h2>📝 Modèles personnalisés</h2><p class="muted small">Crée ou ajuste tes propres trames (sections, ton, destinataire). Elles apparaissent dans « Mes modèles » au moment de rédiger.</p>
      ${P.custom.map((c) => `<div class="row sp" style="padding:4px 0"><span>${J.esc(c.label)} <span class="muted small">· ${J.esc(c.parlementNom)}</span></span><span><button class="sm" data-act="tplEdit" data-id="${c.id}">Modifier</button> <button class="sm danger" data-act="tplDel" data-id="${c.id}">Supprimer</button></span></div>`).join('') || '<p class="muted">Aucun modèle personnalisé.</p>'}
      <button data-act="tplEdit" style="margin-top:8px">Nouveau modèle</button></div>`;
};
const reParl = async () => { await J.refreshMeta(); J.drawChrome(); J.render(); };
J.act.parlActive = async (el) => { await J.call('parlements.setActive', { id: el.dataset.id }); reParl(); };
J.act.parlOpen = (el) => J.call('parlements.openFolder', { id: el.dataset.id });
J.act.parlRemove = async (el) => { if (!confirm('Retirer ce parlement de ta liste active ? (son dossier reste sur ton disque)')) return; await J.call('parlements.remove', { id: el.dataset.id }); reParl(); };
J.act.parlAdd = async () => { const id = J.val('addParl'); if (!id) return; await J.call('parlements.add', { id }); J.toast('Parlement ajouté — dossier créé', 'ok'); reParl(); };
J.act.parlCreate = async () => { await J.call('parlements.create', { nom: J.val('cpNom'), niveau: J.val('cpNiv'), baseOn: J.val('cpBase') }); J.toast('Parlement créé — dossier créé', 'ok'); reParl(); };
J.act.tplDel = async (el) => { await J.call('templates.remove', { id: el.dataset.id }); reParl(); };
J.act.tplEdit = (el) => {
  const c = J.P.custom.find((x) => x.id === el.dataset.id) || {};
  J.modal(`<h2>${c.id ? 'Modifier' : 'Nouveau'} modèle</h2>
    <label class="f">Parlement (libellé)</label><input id="tNom" value="${J.esc(c.parlementNom || J.parlName(J.P.actif))}">
    <label class="f">Nom du modèle</label><input id="tLab" value="${J.esc(c.label || '')}" placeholder="Interpellation courte">
    <div class="grid g2"><div><label class="f">Mode</label><select id="tMode"><option>écrit</option><option ${c.mode === 'oral' ? 'selected' : ''}>oral</option></select></div><div><label class="f">Destinataire</label><input id="tRec" value="${J.esc(c.recipient || '')}"></div></div>
    <div class="grid g2"><div><label class="f">Ton</label><input id="tTon" value="${J.esc(c.tone || '')}" placeholder="direct, factuel"></div><div><label class="f">Longueur</label><input id="tLen" value="${J.esc(c.lengthHint || '')}" placeholder="court"></div></div>
    <label class="f">Sections (une par ligne, « Nom : consigne »)</label><textarea id="tSec" placeholder="Contexte : rappel factuel&#10;Questions : numérotées">${J.esc((c.sections || []).map((s) => s.nom + (s.guide ? ' : ' + s.guide : '')).join('\n'))}</textarea>
    <label class="f">Rappels réglementaires</label><input id="tNot" value="${J.esc(c.notes || '')}">
    <div class="row" style="margin-top:14px"><button class="pri" data-act="tplSave" data-id="${c.id || ''}">Enregistrer</button><button data-act="closeModal">Annuler</button></div>`);
};
J.act.closeModal = () => J.closeModal();
J.act.tplSave = async (el) => {
  await J.call('templates.save', { id: el.dataset.id || undefined, parlementNom: J.val('tNom'), label: J.val('tLab'), mode: J.val('tMode'), recipient: J.val('tRec'), tone: J.val('tTon'), lengthHint: J.val('tLen'), sections: J.val('tSec'), notes: J.val('tNot') });
  J.closeModal(); reParl();
};

// ---------- DOSSIERS ----------
J.pages.dossiers = async (root, id) => {
  if (id) return dossierDetail(root, id);
  const { stages, items } = await J.call('dossiers.list');
  root.innerHTML = `<div class="row sp"><div><h1>Dossiers</h1><p class="sub">De la veille à la réponse : chaque question ou interpellation suit ces étapes.</p></div><button class="pri" data-act="newDossier">+ Nouveau dossier</button></div>
    <div class="kanban">${stages.map((s) => { const col = items.filter((d) => d.stage === s.id); return `<div class="col"><h4>${s.label}<span>${col.length}</span></h4>${col.map((d) => `<div class="dcard" data-act="openDossier" data-id="${d.id}"><b>${J.esc(d.title)}</b><small>${J.esc(J.parlName(d.parlement) || '')}</small>${d.deadline ? `<small>⏰ ${J.fmtDay(d.deadline)}</small>` : ''}</div>`).join('')}</div>`; }).join('')}</div>`;
};
J.act.openDossier = (el) => J.go('dossiers', el.dataset.id);
J.act.newDossier = () => {
  J.modal(`<h2>Nouveau dossier</h2><label class="f">Titre / sujet</label><input id="ndT" placeholder="Ex. Retards du tram 10 à Bruxelles">
    <div class="grid g2"><div><label class="f">Parlement</label><select id="ndP">${J.parlOptions(J.P.actif)}</select></div><div><label class="f">Instrument</label><select id="ndI"></select></div></div>
    <div class="grid g2"><div><label class="f">Thème</label><input id="ndTh" placeholder="Mobilité"></div><div><label class="f">Échéance</label><input id="ndD" type="date"></div></div>
    <label class="f">Notes</label><textarea id="ndN"></textarea>
    <div class="row" style="margin-top:14px"><button class="pri" data-act="ndSave">Créer</button><button data-act="closeModal">Annuler</button></div>`, () => J.bindParl('ndP', 'ndI'));
};
J.act.ndSave = async () => {
  const d = await J.call('dossiers.create', { title: J.val('ndT'), parlement: J.val('ndP'), instrument: J.val('ndI'), theme: J.val('ndTh'), deadline: J.val('ndD'), notes: J.val('ndN') });
  J.closeModal(); J.go('dossiers', d.id);
};

async function dossierDetail(root, id) {
  const [d, { stages }] = await Promise.all([J.call('dossiers.get', { id }), J.call('dossiers.list')]);
  const tab = J.state.dtab || 'synthese'; const idx = stages.findIndex((s) => s.id === d.stage);
  J.state.dossier = d;
  const tabs = [['synthese', 'Synthèse'], ['recherche', `Recherche (${d.research.length})`], ['redaction', `Rédaction (${d.drafts.length})`], ['suivi', 'Envoi & suivi']];
  root.innerHTML = `<a href="#dossiers" class="muted small">← Tous les dossiers</a>
    <div class="row sp" style="margin-top:6px"><div class="grow"><input id="dTitle" value="${J.esc(d.title)}" style="font-size:22px;font-weight:700;border:none;padding:0;background:transparent"></div><button class="danger sm" data-act="dDelete">Supprimer</button></div>
    <div class="stepper">${stages.map((s, i) => `<button class="${i === idx ? 'on' : i < idx ? 'done' : ''}" data-act="dStage" data-stage="${s.id}">${s.label}</button>`).join('')}</div>
    <div class="tabs">${tabs.map((t) => `<button class="${t[0] === tab ? 'on' : ''}" data-act="dTab" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div><div id="dBody"></div>`;
  document.getElementById('dTitle').addEventListener('change', (e) => J.call('dossiers.patch', { id, patch: { title: e.target.value } }));
  drawTab(tab, d);
}
function drawTab(tab, d) {
  const b = document.getElementById('dBody');
  if (tab === 'synthese') {
    b.innerHTML = `<div class="card"><div class="grid g3"><div><label class="f">Parlement</label><select id="dP">${J.parlOptions(d.parlement, false)}</select></div><div><label class="f">Instrument</label><select id="dI"></select></div>
      <div><label class="f">Échéance</label><input id="dD" type="date" value="${J.esc(d.deadline)}"></div></div>
      <label class="f">Thème</label><input id="dTh" value="${J.esc(d.theme)}"><label class="f">Notes</label><textarea id="dN" style="min-height:140px">${J.esc(d.notes)}</textarea>
      <div style="margin-top:10px"><button class="pri" data-act="dSave">Enregistrer</button></div></div>
      <div class="card"><h3>Historique</h3>${d.history.slice().reverse().map((h) => `<div class="small"><span class="muted">${J.fmtDate(h.t)}</span> · ${J.esc(h.text)}</div>`).join('')}</div>`;
    J.bindParl('dP', 'dI', d.instrument);
  } else if (tab === 'recherche') {
    b.innerHTML = `<div class="card"><label class="f">Lancer une recherche pour ce dossier</label><div class="row"><input id="dQ" class="grow" value="${J.esc(d.title)}"><button class="pri" data-act="dResearch">Rechercher</button></div>
      <label class="chk"><input type="checkbox" id="dDeep"> Recherche approfondie</label></div>
      ${d.research.map((r) => `<div class="card"><div class="row sp"><b>${J.esc(r.query)}</b><span class="muted small">${J.fmtDate(r.t)} <button class="sm danger" data-act="dDelItem" data-kind="research" data-item="${r.id}">✕</button></span></div>${J.md(r.answer)}${(r.sources || []).length ? '<h3>Sources</h3>' + r.sources.map((s) => `<div class="small"><a href="${J.esc(s.url)}" data-ext="1">${J.esc(s.title)}</a></div>`).join('') : ''}</div>`).join('') || '<div class="empty">Aucune recherche encore.</div>'}`;
  } else if (tab === 'redaction') {
    b.innerHTML = `<div class="card"><h3>Générer un brouillon avec le modèle du parlement</h3><div class="grid g2"><div><label class="f">Parlement</label><select id="rP">${J.parlOptions(d.parlement || J.P.actif, false)}</select></div><div><label class="f">Modèle</label><select id="rI"></select></div></div>
      <label class="f">Sujet / angle</label><input id="rS" value="${J.esc(d.title)}"><label class="f">Consignes spécifiques (optionnel)</label><input id="rC" placeholder="Insister sur le coût, ton ferme…">
      <div style="margin-top:10px"><button class="gold" data-act="dDraft">Rédiger avec Jarvis</button> <span class="muted small">Utilise les recherches du dossier + ta mémoire de style.</span></div></div>
      ${d.drafts.map(draftCard).join('') || '<div class="empty">Aucun brouillon.</div>'}`;
    J.bindParl('rP', 'rI', d.instrument);
  } else {
    b.innerHTML = `<div class="card"><h3>Envoi / dépôt</h3><p class="muted">Jarvis ne dépose rien à ta place. Prépare le texte, exporte-le, ou crée un courriel (.eml) à envoyer depuis l'onglet Courriels après validation.</p>
      <div class="row"><button data-act="dToMail">Préparer un courriel avec le dernier brouillon</button><button data-act="dStage" data-stage="depot">Marquer comme déposé / envoyé</button></div></div>
      <div class="card"><h3>Réponse reçue / suivi</h3><textarea id="dAns" style="min-height:160px" placeholder="Colle ici la réponse du ministre, les suites, les relances…">${J.esc(d.answer)}</textarea>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="dAnsSave">Enregistrer</button><button data-act="dStage" data-stage="clos">Clore le dossier</button></div></div>`;
  }
}
function draftCard(x) {
  return `<div class="card" data-draft="${x.id}"><div class="row sp"><b>${J.esc(x.label || 'Brouillon')} <span class="muted small">· ${J.fmtDate(x.t)}</span></b>
    <span class="row"><button class="sm" data-act="dFb" data-v="1" data-id="${x.id}">👍</button><button class="sm" data-act="dFb" data-v="-1" data-id="${x.id}">👎</button><button class="sm danger" data-act="dDelItem" data-kind="drafts" data-item="${x.id}">✕</button></span></div>
    <textarea class="big" id="tx_${x.id}">${J.esc(x.text)}</textarea>
    <div class="row" style="margin-top:8px"><button class="pri sm" data-act="dDraftSave" data-id="${x.id}">Enregistrer mes corrections</button><button class="sm" data-act="dCopy" data-id="${x.id}">Copier</button><button class="sm" data-act="dExport" data-id="${x.id}">Exporter .md</button><button class="sm" data-act="dMailDraft" data-id="${x.id}">Créer un courriel</button>
    <span class="muted small">Tes corrections apprennent ton style à Jarvis.</span></div></div>`;
}
const dd = () => J.state.dossier;
const reD = () => J.render();
J.act.dTab = (el) => { J.state.dtab = el.dataset.tab; reD(); };
J.act.dStage = async (el) => { await J.call('dossiers.patch', { id: dd().id, patch: { stage: el.dataset.stage } }); reD(); };
J.act.dDelete = async () => { if (confirm('Supprimer ce dossier ?')) { await J.call('dossiers.remove', { id: dd().id }); J.go('dossiers'); } };
J.act.dSave = async () => { await J.call('dossiers.patch', { id: dd().id, patch: { parlement: J.val('dP'), instrument: J.val('dI'), deadline: J.val('dD'), theme: J.val('dTh'), notes: J.val('dN') } }); J.toast('Enregistré', 'ok'); };
J.act.dResearch = (el) => J.busy(el, async () => { await J.call('research.web', { query: J.val('dQ'), parlement: dd().parlement, dossierId: dd().id, deep: J.val('dDeep') }); reD(); }, 'Recherche en cours…');
J.act.dDraft = (el) => J.busy(el, async () => { await J.call('draft.run', { instrumentId: J.val('rI'), subject: J.val('rS'), instructions: J.val('rC'), dossierId: dd().id }); reD(); }, 'Rédaction…');
J.act.dDelItem = async (el) => { await J.call('dossiers.deleteItem', { id: dd().id, kind: el.dataset.kind, itemId: el.dataset.item }); reD(); };
J.act.dDraftSave = async (el) => { const x = dd().drafts.find((y) => y.id === el.dataset.id); await J.call('dossiers.saveDraft', { id: dd().id, draft: { id: x.id, text: J.val('tx_' + x.id) } }); J.toast('Enregistré — Jarvis étudie tes corrections', 'ok'); };
J.act.dCopy = (el) => J.copy(J.val('tx_' + el.dataset.id));
J.act.dExport = (el) => J.download(J.val('tx_' + el.dataset.id), 'brouillon.md');
J.act.dFb = async (el) => { const c = el.dataset.v === '-1' ? prompt('Qu\'est-ce qui ne va pas ? (optionnel)') : ''; await J.call('brain.feedback', { rating: Number(el.dataset.v), comment: c || '', output: J.val('tx_' + el.dataset.id) }); J.toast('Merci, retour pris en compte', 'ok'); };
J.act.dMailDraft = (el) => { J.state.composePrefill = { subject: dd().title, body: J.val('tx_' + el.dataset.id) }; J.go('courriels'); };
J.act.dToMail = () => { const x = dd().drafts[0]; if (!x) return J.toast('Aucun brouillon à envoyer.', 'err'); J.state.composePrefill = { subject: dd().title, body: x.text }; J.go('courriels'); };
J.act.dAnsSave = async () => { await J.call('dossiers.patch', { id: dd().id, patch: { answer: J.val('dAns') } }); J.toast('Enregistré', 'ok'); };
