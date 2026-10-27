// Pages de travail : Recherche, Rédiger, Documents, Courriels, Agenda, Veille.

const sourcesHtml = (s) => (s || []).length ? '<h3>Sources consultées</h3>' + s.map((x) => `<div class="small">• <a href="${J.esc(x.url)}" data-ext="1">${J.esc(x.title || x.url)}</a></div>`).join('') : '';
const dossierOptions = async () => (await J.call('dossiers.list')).items.filter((d) => d.stage !== 'clos').map((d) => `<option value="${d.id}">${J.esc(d.title)}</option>`).join('');

// ---------- RECHERCHE ----------
J.pages.recherche = async (root) => {
  const opts = await dossierOptions();
  root.innerHTML = `<h1>Recherche web & projet parlementaire</h1><p class="sub">Antécédents, compétence, actualité, chiffres et pistes de questions — avec sources. Le résultat est enregistré dans <b>02-Recherches</b> du parlement.</p>
    <div class="card"><div class="row sp"><label class="f">Sujet, projet, texte ou question à creuser</label>${J.micBtn('rq')}</div><textarea id="rq" placeholder="Ex. Projet d'ordonnance relatif aux zones de basses émissions : antécédents et questions déjà posées"></textarea>
    <div class="grid g2"><div><label class="f">Parlement ciblé</label><select id="rp">${J.parlOptions(J.P.actif)}</select></div><div><label class="f">Ajouter au dossier (optionnel)</label><select id="rd"><option value="">— aucun —</option>${opts}</select></div></div>
    <label class="chk"><input type="checkbox" id="rdeep"> Recherche approfondie</label>
    <button class="pri" data-act="doResearch">Lancer la recherche</button></div><div id="rOut"></div>`;
};
J.act.doResearch = (el) => J.busy(el, async () => {
  const q = J.val('rq'); if (!q.trim()) throw new Error('Décris le sujet à rechercher.');
  const r = await J.call('research.web', { query: q, parlement: J.val('rp'), dossierId: J.val('rd') || undefined, deep: J.val('rdeep') });
  J.state.lastResearch = r;
  document.getElementById('rOut').innerHTML = `<div class="card"><div class="row sp"><h2>Résultat</h2><span class="row">${J.speakBtn('#rBody')}<button class="sm" data-act="rCopy">Copier</button><button class="sm" data-act="rToDraft">Rédiger à partir de ceci</button><button class="sm" data-act="rToDossier">Créer un dossier</button></span></div><div id="rBody">${J.md(r.answer)}</div>${sourcesHtml(r.sources)}${r.file ? `<p class="path">Enregistré : ${J.esc(r.file)}</p>` : ''}</div>`;
}, 'Recherche en cours (30-90 s)…');
J.act.rCopy = () => J.copy(J.state.lastResearch.answer);
J.act.rToDraft = () => { J.state.draftPrefill = { subject: J.state.lastResearch.query, context: J.state.lastResearch.answer, parlement: J.state.lastResearch.parlement }; J.go('redaction'); };
J.act.rToDossier = async () => { const r = J.state.lastResearch; const d = await J.call('dossiers.create', { title: r.query.slice(0, 90), parlement: r.parlement, stage: 'recherche' }); await J.call('dossiers.patch', { id: d.id, patch: {} }); J.go('dossiers', d.id); };

// ---------- RÉDIGER ----------
J.pages.redaction = async (root) => {
  const pre = J.state.draftPrefill || {}; J.state.draftPrefill = null;
  const opts = await dossierOptions();
  root.innerHTML = `<h1>Rédiger une question ou une interpellation</h1><p class="sub">Choisis le parlement : le modèle (structure, ton, destinataire, rappels réglementaires) s'adapte. Texte sauvegardé dans <b>03-Interpellations-et-Questions</b>.</p>
    <div class="card"><div class="grid g2"><div><label class="f">Parlement</label><select id="wp">${J.parlOptions(pre.parlement || J.P.actif)}</select></div><div><label class="f">Modèle</label><select id="wi"></select></div></div>
    <div class="grid g2"><div><label class="f">Langue</label><select id="wl"><option value="">Par défaut (${J.S.profile.langue})</option><option value="fr">Français</option><option value="nl">Néerlandais</option><option value="en">Anglais</option></select></div>
    <div><label class="f">Dossier lié (optionnel)</label><select id="wd"><option value="">— aucun —</option>${opts}</select></div></div>
    <div class="row sp"><label class="f">Sujet / angle</label>${J.micBtn('ws')}</div><input id="ws" value="${J.esc(pre.subject || '')}" placeholder="Ex. Retards récurrents du tram 10">
    <div class="row sp"><label class="f">Contexte et faits disponibles (colle une recherche, un article…)</label>${J.micBtn('wc')}</div><textarea id="wc" style="min-height:130px">${J.esc(pre.context || '')}</textarea>
    <label class="f">Consignes spécifiques</label><input id="wx" placeholder="Ex. Ton ferme, insister sur le budget">
    <div style="margin-top:12px"><button class="gold" data-act="doDraft">Rédiger avec Jarvis</button></div></div><div id="wOut"></div>`;
  J.bindParl('wp', 'wi');
};
J.act.doDraft = (el) => J.busy(el, async () => {
  if (!J.val('ws').trim()) throw new Error('Indique le sujet.');
  const r = await J.call('draft.run', { instrumentId: J.val('wi'), subject: J.val('ws'), context: J.val('wc'), language: J.val('wl') || undefined, dossierId: J.val('wd') || undefined, instructions: J.val('wx') });
  J.state.lastDraft = r;
  document.getElementById('wOut').innerHTML = `<div class="card"><div class="row sp"><h2>${J.esc(r.label)} <span class="muted small">· ${J.esc(r.parlement)}</span></h2><span class="row">${J.speakBtn('#wText')}<button class="sm" data-act="wFb" data-v="1">👍</button><button class="sm" data-act="wFb" data-v="-1">👎</button></span></div>
    <textarea class="big" id="wText">${J.esc(r.text)}</textarea>
    <div class="row" style="margin-top:10px"><button class="pri sm" data-act="wLearn">Enregistrer mes corrections</button><button class="sm" data-act="wCopy">Copier</button><button class="sm" data-act="wExport">Exporter .md</button><button class="sm" data-act="wMail">Créer un courriel</button>${J.val('wd') ? '' : '<button class="sm" data-act="wDossier">Créer un dossier avec ce texte</button>'}</div>
    ${r.file ? `<p class="path">Enregistré : ${J.esc(r.file)}</p>` : ''}</div>`;
}, 'Rédaction en cours…');
J.act.wCopy = () => J.copy(J.val('wText'));
J.act.wExport = () => J.download(J.val('wText'), 'brouillon.md');
J.act.wMail = () => { J.state.composePrefill = { subject: J.state.lastDraft.subject, body: J.val('wText') }; J.go('courriels'); };
J.act.wFb = async (el) => { const c = el.dataset.v === '-1' ? prompt('Qu\'est-ce qui ne va pas ? (optionnel)') : ''; await J.call('brain.feedback', { rating: Number(el.dataset.v), comment: c || '', output: J.val('wText') }); J.toast('Merci, retour pris en compte', 'ok'); };
J.act.wLearn = async () => { // pas de dossier : on apprend directement de la différence
  const r = J.state.lastDraft; const d = await J.call('dossiers.create', { title: r.subject.slice(0, 90), parlement: J.val('wp'), instrument: r.instrumentId, stage: 'redaction' });
  const saved = await J.call('dossiers.saveDraft', { id: d.id, draft: { text: r.text, original: r.text, label: r.label, parlement: r.parlement, instrumentId: r.instrumentId } });
  await J.call('dossiers.saveDraft', { id: d.id, draft: { id: saved.id, text: J.val('wText') } }); J.toast('Corrections enregistrées dans un nouveau dossier', 'ok');
};
J.act.wDossier = async () => { const r = J.state.lastDraft; const d = await J.call('dossiers.create', { title: r.subject.slice(0, 90), parlement: J.val('wp'), instrument: r.instrumentId, stage: 'redaction' }); await J.call('dossiers.saveDraft', { id: d.id, draft: { text: J.val('wText'), original: r.text, label: r.label, parlement: r.parlement, instrumentId: r.instrumentId } }); J.go('dossiers', d.id); };

// ---------- DOCUMENTS ----------
J.pages.documents = async (root) => {
  const st = await J.call('index.stats');
  root.innerHTML = `<h1>Documents</h1><p class="sub">Analyse d'un document local (aucune recherche web), index plein-texte de tes dossiers et recherche dedans.</p>
    <div class="card"><h2>🔒 Analyser un document</h2><div class="row"><input id="dFile" class="grow" placeholder="Aucun fichier choisi" readonly><button data-act="pickDoc">Choisir…</button></div>
      <label class="f">Question (optionnel)</label><input id="dQst" placeholder="Ex. Quels sont les engagements budgétaires ?">
      ${J.S._env.local ? '<p class="muted small">✅ Moteur local : le document ne quitte pas ton Mac.</p>' : '<label class="chk"><input type="checkbox" id="dCloud"> J\'autorise l\'envoi du texte de ce document à mon moteur IA cloud (aucune recherche web n\'est faite)</label>'}
      <button class="pri" data-act="doAnalyze">Analyser</button><div id="aOut" style="margin-top:12px"></div></div>
    <div class="card"><h2>🗂️ Index documentaire</h2><p class="muted small">${st.files} fichier(s) · ${st.chunks} extraits · ${st.updated ? 'mis à jour ' + J.fmtDate(st.updated) : 'jamais indexé'}. Formats : PDF, DOCX, TXT, MD, EML, HTML.</p>
      ${J.S.docs.folders.map((f) => `<div class="row sp"><span class="path">${J.esc(f)}</span><button class="sm danger" data-act="rmFolder" data-f="${J.esc(f)}">Retirer</button></div>`).join('')}
      <div class="row" style="margin-top:10px"><button data-act="addFolder">Ajouter un dossier</button><button class="pri" data-act="doIndex">Indexer maintenant</button><span class="muted small" id="progress"></span></div></div>
    <div class="card"><h2>🔎 Chercher dans l'index</h2><div class="row"><input id="iq" class="grow" placeholder="mobilité Bruxelles budget 2026"><button class="pri" data-act="doSearch">Chercher</button></div>
      <label class="chk"><input type="checkbox" id="isyn"> Faire une synthèse avec l'IA (envoie les extraits trouvés au moteur)</label><div id="iOut" style="margin-top:10px"></div></div>`;
};
J.act.pickDoc = async () => { const p = await J.call('doc.pick'); if (p) document.getElementById('dFile').value = p; };
J.act.doAnalyze = (el) => J.busy(el, async () => {
  const file = J.val('dFile'); if (!file) throw new Error('Choisis un document.');
  const r = await J.call('doc.analyze', { file, question: J.val('dQst'), allowCloud: J.S._env.local ? true : J.val('dCloud') });
  document.getElementById('aOut').innerHTML = `<p class="muted small">${r.chars.toLocaleString('fr-BE')} caractères analysés · ${r.local ? 'moteur local' : 'moteur cloud'} · sans recherche web</p><div id="aBody">${J.md(r.answer)}</div><button class="sm" data-act="aCopy">Copier</button> ${J.speakBtn('#aBody')}`;
  J.state.lastAnalysis = r.answer;
}, 'Analyse…');
J.act.aCopy = () => J.copy(J.state.lastAnalysis);
J.act.addFolder = async () => { await J.call('docs.addFolder'); await J.refreshMeta(); J.render(); };
J.act.rmFolder = async (el) => { await J.call('docs.removeFolder', { folder: el.dataset.f }); await J.refreshMeta(); J.render(); };
J.act.doIndex = (el) => J.busy(el, async () => { const r = await J.call('index.build'); J.toast(`Index : ${r.files} fichiers (${r.added} nouveaux)${r.errors.length ? ', ' + r.errors.length + ' erreur(s)' : ''}`, r.errors.length ? '' : 'ok'); J.render(); }, 'Indexation…');
J.act.doSearch = (el) => J.busy(el, async () => {
  const r = await J.call('index.search', { query: J.val('iq'), synthesize: J.val('isyn') });
  document.getElementById('iOut').innerHTML = (r.answer ? `<div class="card" style="background:var(--soft)">${J.md(r.answer)}</div>` : '') + (r.hits.length ? r.hits.map((h) => `<div class="card"><div class="row sp"><b>${J.esc(h.name)}</b><button class="sm" data-act="showFile" data-f="${J.esc(h.file)}">Afficher dans le Finder</button></div><div class="small muted">${J.esc(h.text.slice(0, 420))}…</div></div>`).join('') : '<div class="empty">Aucun résultat. Pense à indexer tes documents.</div>');
});
J.act.showFile = (el) => J.call('app.openPath', { p: el.dataset.f });

// ---------- COURRIELS ----------
J.pages.courriels = async (root) => {
  const accs = await J.call('mail.accounts'); const pre = J.state.composePrefill || {}; J.state.composePrefill = null;
  const smtp = accs.filter((a) => a.type === 'imap');
  root.innerHTML = `<h1>Courriels</h1><p class="sub">Lecture seule (rien n'est marqué comme lu), résumé à la demande, envoi d'un .eml uniquement après ta validation.</p>
    <div class="card"><div class="row sp"><h2>Comptes</h2><span class="row"><button data-act="addMail">+ Compte IMAP/SMTP</button><a class="btn" href="#agenda" style="text-decoration:none">+ Compte Google</a></span></div>
    ${accs.map((a) => `<div class="row sp" style="padding:5px 0"><span>${a.type === 'google' ? '🟢' : '✉️'} <b>${J.esc(a.label)}</b> <span class="muted small">${J.esc(a.email)}</span></span><span class="row"><button class="sm" data-act="testMail" data-id="${a.id}">Tester</button><button class="sm danger" data-act="rmMail" data-id="${a.id}">Retirer</button></span></div>`).join('') || '<p class="muted">Aucun compte. Ajoute un compte IMAP (parlement, Gmail avec mot de passe d\'application…) ou connecte Google.</p>'}</div>
    <div class="card"><h2>Lire & résumer</h2><div class="row"><select id="mAcc" class="grow">${accs.map((a) => `<option value="${a.id}">${J.esc(a.label)}</option>`).join('')}</select><select id="mN" style="width:90px"><option>5</option><option selected>10</option><option>20</option></select><button data-act="readMail">Lire</button><button class="pri" data-act="sumMail">Lire et résumer</button></div>
      ${J.S._env.local ? '' : '<label class="chk"><input type="checkbox" id="mCloud"> J\'autorise l\'envoi du contenu de ces courriels au moteur IA cloud (pour le résumé)</label>'}<div id="mOut" style="margin-top:12px"></div></div>
    <div class="card"><h2>Envoyer un message</h2>
      ${smtp.length ? `<div class="grid g2"><div><label class="f">Compte d'envoi</label><select id="cAcc">${smtp.map((a) => `<option value="${a.id}" data-email="${J.esc(a.email)}">${J.esc(a.label)}</option>`).join('')}</select></div><div><label class="f">À</label><input id="cTo" placeholder="destinataire@exemple.be"></div></div>
      <div class="grid g2"><div><label class="f">Cc</label><input id="cCc"></div><div><label class="f">Objet</label><input id="cSub" value="${J.esc(pre.subject || '')}"></div></div>
      <label class="f">Message</label><textarea id="cBody" style="min-height:220px">${J.esc(pre.body || '')}</textarea>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="sendCompose">Vérifier et envoyer…</button><button data-act="loadEml">Ouvrir un .eml</button><button data-act="saveEml">Enregistrer en .eml</button></div>
      <p class="muted small">Une fenêtre de confirmation affiche le compte, tous les destinataires et le texte. Texte brut, sans pièce jointe.</p>` : '<p class="muted">Ajoute un compte IMAP/SMTP pour pouvoir envoyer (les comptes Google sont en lecture seule).</p>'}</div>`;
};
J.act.addMail = () => J.modal(`<h2>Ajouter un compte IMAP / SMTP</h2><p class="muted small">Paramètres fournis par ton hébergeur ou l'administrateur du parlement. Pour Gmail : imap.gmail.com / smtp.gmail.com avec un mot de passe d'application. Les mots de passe sont stockés dans le trousseau chiffré.</p>
  <div class="grid g2"><div><label class="f">Nom du compte</label><input id="mLab" placeholder="Parlement"></div><div><label class="f">Adresse e-mail</label><input id="mEm"></div>
  <div><label class="f">Serveur IMAP</label><input id="mIh" placeholder="imap.exemple.be"></div><div><label class="f">Port IMAP</label><input id="mIp" value="993"></div>
  <div><label class="f">Serveur SMTP</label><input id="mSh" placeholder="smtp.exemple.be"></div><div><label class="f">Port SMTP (587 ou 465)</label><input id="mSp" value="587"></div>
  <div><label class="f">Identifiant (si différent de l'adresse)</label><input id="mUs"></div><div><label class="f">Mot de passe / mot de passe d'application</label><input id="mPw" type="password"></div></div>
  <div class="row" style="margin-top:14px"><button class="pri" data-act="saveMail">Ajouter</button><button data-act="closeModal">Annuler</button></div>`);
J.act.saveMail = async () => { await J.call('mail.add', { label: J.val('mLab'), email: J.val('mEm'), imapHost: J.val('mIh'), imapPort: J.val('mIp'), smtpHost: J.val('mSh'), smtpPort: J.val('mSp'), imapUser: J.val('mUs'), imapPass: J.val('mPw') }); J.closeModal(); J.render(); };
J.act.rmMail = async (el) => { if (confirm('Retirer ce compte ?')) { await J.call('mail.remove', { id: el.dataset.id }); J.render(); } };
J.act.testMail = (el) => J.busy(el, async () => { const r = await J.call('mail.test', { id: el.dataset.id }); J.toast(r.detail, 'ok'); });
const msgHtml = (m, i) => `<div class="card mailcard" id="mc${i}"><div class="row sp"><b>${J.esc(m.subject)}</b>${m.unread ? '<span class="pill gold">non lu</span>' : ''}</div><div class="muted small">${J.esc(m.from)} · ${J.esc(m.date ? J.fmtDate(m.date) : '')}${m.attachments && m.attachments.length ? ' · 📎 ' + J.esc(m.attachments.join(', ')) : ''}</div>
  <div class="row" style="margin:8px 0"><button class="sm" data-act="mailRead" data-i="${i}">🔊 Lire ce mail</button><button class="sm pri" data-act="mailReply" data-i="${i}">↩ Répondre</button></div>${J.mailBody(m, i)}</div>`;
const showMails = (ms, head = '') => {
  J.state.mails = ms;
  document.getElementById('mOut').innerHTML = (ms.length ? `${head}<div class="row sp" style="margin-bottom:8px"><b>${ms.length} message${ms.length > 1 ? 's' : ''}</b><span class="row"><button class="sm" data-act="mailReadAll">🔊 Lire tous les mails</button><button class="sm ghost" data-act="mailStop">⏹ Arrêter la lecture</button></span></div>` + ms.map(msgHtml).join('') : '<div class="empty">Boîte vide.</div>');
  J.mountMailFrames(document.getElementById('mOut'));
};
J.act.readMail = (el) => J.busy(el, async () => { showMails(await J.call('mail.read', { id: J.val('mAcc'), limit: Number(J.val('mN')) })); });
J.act.sumMail = (el) => J.busy(el, async () => { const r = await J.call('mail.summarize', { id: J.val('mAcc'), limit: Number(J.val('mN')), allowCloud: J.S._env.local ? true : J.val('mCloud') }); showMails(r.messages, `<div class="card" style="background:var(--soft)">${J.md(r.summary)}</div>`); }, 'Lecture et résumé…');
J.act.mailRead = (el) => { J.stopReading(); const m = J.state.mails[Number(el.dataset.i)]; J.readMails([m]); };
J.act.mailReadAll = () => J.readMails(J.state.mails, (i) => { J.$$('.mailcard').forEach((c) => c.classList.toggle('reading', c.id === 'mc' + i)); const c = document.getElementById('mc' + i); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
J.act.mailStop = () => { J.stopReading(); J.$$('.mailcard').forEach((c) => c.classList.remove('reading')); };
J.act.mailReply = (el) => J.mailReply(J.state.mails[Number(el.dataset.i)]);
const buildRaw = async () => J.call('mail.compose', { from: document.getElementById('cAcc').selectedOptions[0].dataset.email, to: J.val('cTo'), cc: J.val('cCc'), subject: J.val('cSub'), body: J.val('cBody') });
J.act.sendCompose = (el) => J.busy(el, async () => {
  const raw = J.state.loadedEml || await buildRaw(); const r = await J.call('mail.send', { id: J.val('cAcc'), raw });
  if (r.sent) { J.toast('Message accepté par le serveur SMTP (' + r.accepted.join(', ') + ')', 'ok'); J.state.loadedEml = null; } else J.toast('Envoi annulé');
});
J.act.loadEml = async () => { const r = await J.call('mail.pickEml'); if (!r) return; J.state.loadedEml = r.raw; const h = (k) => (r.raw.match(new RegExp('^' + k + ':\\s*(.*)$', 'mi')) || [])[1] || ''; document.getElementById('cTo').value = h('To'); document.getElementById('cCc').value = h('Cc'); document.getElementById('cSub').value = h('Subject'); document.getElementById('cBody').value = r.raw.split(/\r?\n\r?\n/).slice(1).join('\n\n'); J.toast('.eml chargé : il sera envoyé tel quel après confirmation', 'ok'); };
J.act.saveEml = async () => { const raw = await buildRaw(); const p = await J.call('mail.saveEml', { raw }); if (p) J.toast('Enregistré : ' + p, 'ok'); };

// ---------- AGENDA ----------
J.pages.agenda = async (root) => {
  const g = J.S.google; const ev = g.accounts.length ? await J.call('google.events', { days: 7 }) : { events: [], errors: [] };
  const byDay = {}; for (const e of ev.events) (byDay[String(e.start).slice(0, 10)] ||= []).push(e);
  root.innerHTML = `<h1>Agenda Google</h1><p class="sub">Connexion native (lecture seule) à Google Agenda et Gmail. Les jetons sont chiffrés dans le trousseau macOS.</p>
    <div class="card"><h2>Connexion</h2>
      ${g.accounts.map((a) => `<div class="row sp"><span>🟢 ${J.esc(a)}</span><button class="sm danger" data-act="gDisc" data-e="${J.esc(a)}">Déconnecter</button></div>`).join('')}
      <details ${g.clientId ? '' : 'open'} style="margin-top:10px"><summary><b>Identifiants Google (une seule fois)</b></summary>
        <ol class="small muted"><li>Va sur <a data-ext="1" href="https://console.cloud.google.com/apis/credentials">console.cloud.google.com › Identifiants</a> et crée un projet.</li><li>Active les API <b>Google Calendar</b> et <b>Gmail</b>.</li><li>Écran de consentement : type « Externe », ajoute ton adresse comme utilisateur test.</li><li>Crée des identifiants « ID client OAuth » de type <b>Application de bureau</b>.</li><li>Colle l'ID client et le code secret ci-dessous.</li></ol>
        <label class="f">ID client</label><input id="gId" value="${J.esc(g.clientId)}"><label class="f">Code secret du client</label><input id="gSec" type="password" placeholder="${J.S._secrets.google_client_secret ? '•••••• (enregistré)' : ''}">
        <button style="margin-top:8px" data-act="gSave">Enregistrer</button></details>
      <div style="margin-top:12px"><button class="pri" data-act="gConnect">${g.accounts.length ? 'Ajouter un autre compte Google' : 'Se connecter avec Google'}</button></div></div>
    <div class="card"><h2>7 prochains jours</h2>${ev.errors.map((e) => `<div class="banner">${J.esc(e)}</div>`).join('')}
    ${Object.keys(byDay).sort().map((d) => `<h3 style="margin-top:12px">${J.fmtDay(d)}</h3>${byDay[d].map((e) => `<div class="row" style="padding:3px 0"><span class="pill">${e.allDay ? 'journée' : new Date(e.start).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span><span class="grow">${J.esc(e.title)}${e.location ? ` <span class="muted small">· ${J.esc(e.location)}</span>` : ''}</span><span class="muted small">${J.esc(e.calendar)}</span></div>`).join('')}`).join('') || '<p class="muted">Aucun événement (ou agenda non connecté).</p>'}</div>`;
};
J.act.gSave = async () => { await J.call('settings.set', { google: { clientId: J.val('gId').trim() } }); const s = J.val('gSec'); if (s) await J.call('secret.set', { name: 'google_client_secret', value: s.trim() }); await J.refreshMeta(); J.toast('Enregistré', 'ok'); J.render(); };
J.act.gConnect = (el) => J.busy(el, async () => { const r = await J.call('google.connect'); J.toast('Connecté : ' + r.email, 'ok'); await J.refreshMeta(); J.render(); }, 'En attente de Google (navigateur)…');
J.act.gDisc = async (el) => { await J.call('google.disconnect', { email: el.dataset.e }); await J.refreshMeta(); J.render(); };

// ---------- VEILLE ----------
J.pages.veille = async (root) => {
  const [v, items] = await Promise.all([J.call('veille.status'), J.call('veille.items')]);
  const topics = J.S.veille.topics; const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  root.innerHTML = `<h1>Veille</h1><p class="sub">Jarvis surveille tes sujets sur le web et te propose des pistes de questions. Chaque exécution est classée dans <b>01-Veille</b> du parlement concerné.</p>
    <div class="card"><h2>Sujets surveillés</h2><div id="topics">${topics.map(topicRow).join('')}</div>
      <div class="row" style="margin-top:8px"><button data-act="addTopic">+ Sujet</button><button data-act="saveTopics">Enregistrer</button><button class="pri" data-act="runVeille">Lancer la veille maintenant</button></div></div>
    <div class="card"><h2>Veille automatique ${v.enabled ? '<span class="pill ok">active</span>' : '<span class="pill">désactivée</span>'}</h2>
      <p class="muted small">S'exécute chaque jour choisi à l'heure indiquée, tant que Jarvis est ouvert (rattrapage au lancement si le Mac dormait).${v.lastRun ? ' Dernière exécution : ' + J.fmtDate(v.lastRun) + '.' : ''}</p>
      <div class="row"><label class="chk" style="margin:0"><input type="checkbox" id="vEn" ${v.enabled ? 'checked' : ''}> Activer</label><input id="vTime" type="time" value="${v.time}" style="width:120px">
      ${days.map((d, i) => `<label class="chk" style="margin:0"><input type="checkbox" class="vDay" value="${i}" ${v.days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}<button data-act="saveSchedule">Enregistrer</button></div>
      <div style="margin-top:12px"><button class="danger" data-act="removeVeille">Retirer la veille automatique</button> <span class="muted small">Supprime la planification (tes sujets et résultats sont conservés).</span></div></div>
    <h2>Dernières trouvailles</h2>
    ${items.items.filter((i) => i.status !== 'ignored').slice(0, 40).map((i) => `<div class="card"><div class="row sp"><b>${J.esc(i.title)}</b><span class="row"><span class="pill">${J.esc(i.topic)}</span>${'★'.repeat(i.score)}</span></div>
      <p style="margin:6px 0">${J.esc(i.summary)}</p>${i.idea ? `<p class="small"><b>Piste :</b> ${J.esc(i.idea)}</p>` : ''}
      <div class="row">${i.url ? `<a data-ext="1" href="${J.esc(i.url)}" class="small">${J.esc(i.source || i.url)}</a>` : ''}<span class="muted small">${J.esc(i.date)}</span><span class="grow"></span>
      ${i.status === 'dossier' ? '<span class="pill ok">dossier créé</span>' : `<button class="sm pri" data-act="vDossier" data-id="${i.id}">→ Créer un dossier</button>`}<button class="sm" data-act="vIgnore" data-id="${i.id}">Ignorer</button></div></div>`).join('') || '<div class="empty">Aucune trouvaille. Ajoute des sujets puis lance la veille.</div>'}`;
};
const topicRow = (t) => `<div class="row topic" style="margin-bottom:6px"><input class="tl" placeholder="Sujet (ex. mobilité Bruxelles)" value="${J.esc(t.label || '')}" style="flex:2"><input class="tk" placeholder="mots-clés" value="${J.esc(t.keywords || '')}" style="flex:2"><select class="tp" style="flex:2"><option value="">Parlement : actif</option>${J.parlOptions(t.parlement)}</select><button class="sm danger" data-act="rmTopic">✕</button></div>`;
const readTopics = () => J.$$('.topic').map((r) => ({ label: J.$('.tl', r).value, keywords: J.$('.tk', r).value, parlement: J.$('.tp', r).value }));
J.act.addTopic = () => document.getElementById('topics').insertAdjacentHTML('beforeend', topicRow({}));
J.act.rmTopic = (el) => el.closest('.topic').remove();
J.act.saveTopics = async () => { await J.call('veille.topics', { topics: readTopics() }); await J.refreshMeta(); J.toast('Sujets enregistrés', 'ok'); };
J.act.runVeille = (el) => J.busy(el, async () => { await J.call('veille.topics', { topics: readTopics() }); await J.refreshMeta(); const r = await J.call('veille.run'); J.toast(`${r.created} nouveauté(s)${r.errors.length ? ' · ' + r.errors[0] : ''}`, r.errors.length ? 'err' : 'ok'); J.render(); }, 'Veille en cours (1-3 min)…');
J.act.saveSchedule = async () => { await J.call('veille.configure', { enabled: J.val('vEn'), time: J.val('vTime'), days: J.$$('.vDay').filter((c) => c.checked).map((c) => Number(c.value)) }); J.toast('Planification enregistrée', 'ok'); J.render(); };
J.act.removeVeille = async () => { if (!confirm('Retirer la veille automatique ?')) return; await J.call('veille.remove'); J.toast('Veille automatique retirée', 'ok'); J.render(); };
J.act.vDossier = async (el) => { const d = await J.call('veille.toDossier', { id: el.dataset.id }); J.go('dossiers', d.id); };
J.act.vIgnore = async (el) => { await J.call('veille.setStatus', { id: el.dataset.id, status: 'ignored' }); J.render(); };
