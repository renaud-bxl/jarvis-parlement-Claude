// Pages système : Cerveau, Assistant, Réglages (avec « Mise en route »), Diagnostic.

const calm = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollToEl = (el) => el && el.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });

// ---------- CERVEAU ----------
J.pages.cerveau = async (root) => {
  const b = await J.call('brain.list'); const cats = b.categories;
  const top = (o) => Object.entries(o).sort((a, c) => c[1] - a[1]).slice(0, 6);
  const none = '<span class="muted small">Pas encore de données</span>';
  root.innerHTML = `<h1>${J.hi('brain')}Cerveau</h1><p class="sub">Ce que Jarvis a appris de toi. Il enrichit cette mémoire quand tu travailles : tes demandes, tes corrections de brouillons et tes retours « bon » ou « à améliorer ». Tout est local, modifiable et effaçable.</p>
    <div class="card"><div class="row sp"><label class="chk" style="margin:0"><input type="checkbox" id="bLearn" ${b.learning ? 'checked' : ''}> Apprentissage automatique actif</label>
      <span class="row"><button class="sm" data-act="bExport">Exporter</button><button class="sm" data-act="bImport">Importer</button><button class="sm danger" data-act="bReset">Tout oublier</button></span></div>
      <p class="muted small" style="margin-bottom:0">Les contenus des documents analysés et des courriels ne sont jamais transmis à la mémoire.</p></div>
    <div class="card"><h2>Ajouter un souvenir</h2><div class="row"><input id="bText" class="grow" data-enter="bAdd" aria-label="Souvenir à retenir" placeholder="Ex. Je préfère des questions courtes, chiffrées, sans adjectifs"><select id="bCat" aria-label="Catégorie" style="width:200px">${Object.entries(cats).map(([k, v]) => `<option value="${k}">${J.esc(v)}</option>`).join('')}</select><button class="pri" data-act="bAdd">Retenir</button></div></div>
    ${Object.entries(cats).map(([k, label]) => { const fs = b.facts.filter((f) => f.category === k); return fs.length ? `<div class="card"><h2>${J.esc(label)} <span class="pill">${fs.length}</span></h2>${fs.map((f) => `<div class="fact"><div class="t"><input value="${J.esc(f.text)}" data-id="${f.id}" class="bf" aria-label="Souvenir : modifier le texte"><span class="muted small">${J.esc(f.source)} · vu ${f.count} fois ${f.pinned ? '· épinglé' : ''}</span></div><button class="sm" data-act="bPin" data-id="${f.id}" data-p="${f.pinned ? 0 : 1}" title="${f.pinned ? 'Détacher ce souvenir' : 'Épingler : Jarvis le garde toujours en tête'}" aria-pressed="${!!f.pinned}">${J.icon('pin')} ${f.pinned ? 'Détacher' : 'Épingler'}</button><button class="sm danger" data-act="bDel" data-id="${f.id}" aria-label="Oublier ce souvenir" title="Oublier ce souvenir">${J.icon('trash')}</button></div>`).join('')}</div>` : ''; }).join('') || '<div class="empty"><b>Le cerveau est vide pour l\'instant</b>Utilise Jarvis : il retient tes préférences au fil de tes demandes et de tes corrections. Tu peux aussi lui en donner une ci-dessus.</div>'}
    <div class="card"><h2>Habitudes observées</h2><div class="grid g3"><div><h3>Thèmes</h3>${top(b.stats.themes).map(([k, n]) => `<div class="small">${J.esc(k)} <span class="pill">${n}</span></div>`).join('') || none}</div>
      <div><h3>Instruments</h3>${top(b.stats.instruments).map(([k, n]) => `<div class="small">${J.esc(k)} <span class="pill">${n}</span></div>`).join('') || none}</div>
      <div><h3>Fonctions utilisées</h3>${top(b.stats.usage).map(([k, n]) => `<div class="small">${J.esc(k)} <span class="pill">${n}</span></div>`).join('') || none}</div></div></div>`;
  document.getElementById('bLearn').addEventListener('change', (e) => J.call('settings.set', { brain: { learning: e.target.checked } }).then(() => J.toast(e.target.checked ? 'Apprentissage activé' : 'Apprentissage en pause', 'ok')).catch(J.err));
  J.$$('.bf').forEach((i) => i.addEventListener('change', () => J.call('brain.update', { id: i.dataset.id, patch: { text: i.value } }).then(() => J.toast('Souvenir modifié', 'ok')).catch(J.err)));
};
J.act.bAdd = async () => { if (!String(J.val('bText') || '').trim()) { document.getElementById('bText').focus(); throw new Error('Écris ce que Jarvis doit retenir.'); } await J.call('brain.add', { text: J.val('bText'), category: J.val('bCat'), pinned: true }); J.toast('Souvenir ajouté', 'ok'); J.render(); };
J.act.bDel = async (el) => { await J.call('brain.remove', { id: el.dataset.id }); J.render(); };
J.act.bPin = async (el) => { await J.call('brain.update', { id: el.dataset.id, patch: { pinned: el.dataset.p === '1' } }); J.render(); };
J.act.bReset = async () => { if (await J.confirm('Jarvis oubliera toutes tes préférences et tes habitudes. Cette action est définitive.', { ok: 'Tout oublier', danger: true, title: 'Effacer la mémoire de Jarvis' })) { await J.call('brain.reset'); J.toast('Mémoire effacée', 'ok'); J.render(); } };
J.act.bExport = async () => { const p = await J.call('brain.export'); if (p) J.toast('Exporté : ' + p, 'ok'); };
J.act.bImport = async () => { const n = await J.call('brain.import'); if (n !== null) { J.toast(n + ' souvenirs au total', 'ok'); J.render(); } };

// ---------- ASSISTANT ----------
const ASSIST_IDEAS = ['Prépare-moi trois angles de question sur la mobilité à Bruxelles', 'Résume les antécédents d\'un projet d\'ordonnance', 'Aide-moi à reformuler une question plus courte'];
J.pages.assistant = async (root) => {
  J.state.chat = J.state.chat || [];
  root.innerHTML = `<h1>Assistant</h1><p class="sub">Discute librement avec Jarvis. Il connaît tes préférences et peut chercher sur le web ou dans tes documents.</p>
    <div class="chat" id="chat" role="log" aria-live="polite" aria-label="Conversation">${J.state.chat.map(msgBubble).join('') || chatEmpty()}</div>
    <div class="card"><textarea id="cIn" style="min-height:70px" aria-label="Ton message" placeholder="Écris ou dicte ton message… (Entrée pour envoyer, Maj + Entrée pour un retour à la ligne)"></textarea><div class="row sp" style="margin-top:8px"><span class="row">${J.micBtn('cIn')}<label class="chk" style="margin:0"><input type="checkbox" id="cWeb"> Web</label><label class="chk" style="margin:0"><input type="checkbox" id="cDocs"> Mes documents (si le moteur est en ligne, des extraits lui sont envoyés)</label><label class="chk" style="margin:0"><input type="checkbox" id="cSpeak" ${J.S.voice.autoSpeak ? 'checked' : ''}> Réponses à voix haute</label></span><span class="row"><button class="sm" data-act="cClear">Nouvelle conversation</button><button class="pri" data-act="cSend">${J.icon('send')} Envoyer</button></span></div></div>`;
  document.getElementById('cSpeak').addEventListener('change', (e) => { J.S.voice.autoSpeak = e.target.checked; J.call('settings.set', { voice: { autoSpeak: e.target.checked } }); if (!e.target.checked) J.stopSpeak(); });
  document.getElementById('cIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); J.act.cSend(J.$('[data-act=cSend]')); } });
  J.act.cIdea = (el) => { const t = document.getElementById('cIn'); t.value = el.dataset.t; t.focus(); };
  const c = document.getElementById('chat'); if (J.state.chat.length) c.scrollTop = c.scrollHeight;
  document.getElementById('cIn').focus({ preventScroll: true });
};
const chatEmpty = () => `<div class="empty"><b>Pose une question à Jarvis</b>Il peut préparer des angles de question, résumer un dossier ou reformuler un texte.<div class="chips" style="justify-content:center;margin-top:12px">${ASSIST_IDEAS.map((x) => `<button type="button" class="chip" data-act="cIdea" data-t="${J.esc(x)}">${J.esc(x)}</button>`).join('')}</div></div>`;
const msgBubble = (m) => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">${m.role === 'user' ? J.esc(m.content) : J.md(m.content) + `<button class="sm ghost" data-act="speakMsg" data-i="${J.state.chat.indexOf(m)}" aria-label="Lire cette réponse à voix haute" title="Lire à voix haute">${J.icon('speaker')}</button>` + (m.sources?.length ? '<div class="small muted">' + m.sources.map((s) => `<a data-ext="1" href="${J.esc(s.url)}">${J.esc(s.title)}</a>`).join(' · ') + '</div>' : '')}</div>`;
J.act.speakMsg = (el) => J.speak(J.state.chat[Number(el.dataset.i)].content);
J.act.cClear = () => { J.state.chat = []; J.render(); };
J.act.cSend = (el) => J.busy(el, async () => {
  const input = document.getElementById('cIn'); const t = input.value.trim(); if (!t) { input.focus(); return; }
  const box = document.getElementById('chat');
  J.state.chat.push({ role: 'user', content: t }); box.innerHTML = J.state.chat.map(msgBubble).join('') + '<div class="msg a" id="typing"><span class="typing" aria-label="Jarvis réfléchit"><i></i><i></i><i></i></span></div>'; input.value = ''; box.lastElementChild.scrollIntoView({ block: 'nearest' });
  try {
    const r = await J.call('chat.send', { messages: J.state.chat.map((m) => ({ role: m.role, content: m.content })), useWeb: J.val('cWeb'), useDocs: J.val('cDocs'), allowCloud: J.S._env.local ? true : !!J.val('cDocs') });
    J.state.chat.push({ role: 'assistant', content: r.text, sources: r.sources }); if (J.val('cSpeak')) J.speak(r.text);
    box.innerHTML = J.state.chat.map(msgBubble).join(''); box.lastElementChild.scrollIntoView({ block: 'nearest' });
  } catch (e) {
    // Le message n'est pas perdu : il revient dans le champ pour réessayer.
    J.state.chat.pop(); input.value = t;
    box.innerHTML = (J.state.chat.map(msgBubble).join('') || '') + `<div class="msg a err" role="alert"><b>Jarvis n'a pas pu répondre.</b><br>${J.esc(J.errMsg(e))}<div class="row" style="margin-top:8px"><a class="btn sm" href="#reglages">Vérifier mon moteur IA</a></div></div>`;
    J.err(e);
  }
}, 'Jarvis réfléchit…');

// ---------- RÉGLAGES ----------
const setOnb = async (patch) => { await J.call('settings.set', { onboarding: patch }); await J.refreshMeta(); J.drawChrome(); J.drawOnb(); };
const profileFields = () => ({ nom: J.val('pNom'), titre: J.val('pTitre'), groupe: J.val('pGroupe'), parti: J.val('pParti'), circonscription: J.val('pCirc'), langue: J.val('pLang'), signature: J.val('pSig') });

// Carte « Mise en route » : 4 étapes cochées d'après l'état réel, chacune renvoie à la bonne section.
J.drawOnb = () => {
  const box = document.getElementById('onb'); if (!box) return;
  const o = J.onb(); const open = o.steps.findIndex((x) => !x.done);
  if (o.dismissed) { box.innerHTML = ''; return; }
  if (o.all) {
    box.innerHTML = `<div class="card onb" role="region" aria-label="Mise en route"><div class="row sp"><div><h2 style="margin-bottom:2px">Tout est prêt</h2><span class="muted">Profil, moteur IA, voix et micro sont configurés. Jarvis t'attend.</span></div><button class="gold" data-act="obFinish">Parler à Jarvis</button></div></div>`; return;
  }
  const btn = (s, i) => {
    const pri = i === open ? 'pri' : '';
    if (s.id === 'profil') return `<button class="sm ${pri}" data-act="obGo" data-sec="sec-profil" data-focus="#pNom">Renseigner</button>`;
    if (s.id === 'ia') return J.S._env.configured ? `<button class="sm ${pri}" data-act="testAI">Tester le moteur</button>` : `<button class="sm ${pri}" data-act="obGo" data-sec="sec-ia" data-focus="#aProv">Configurer</button>`;
    if (s.id === 'voix') return `<button class="sm ${pri}" data-act="obGo" data-sec="sec-voix" data-focus="#vPiper button">Choisir ma voix (femme ou homme)</button>`;
    return `<button class="sm ${pri}" data-act="obMic">Autoriser le micro</button>`;
  };
  box.innerHTML = `<div class="card onb" role="region" aria-label="Mise en route"><div class="row sp"><h2 style="margin:0">Mise en route · Étape ${open + 1}/4</h2><button class="sm ghost" data-act="obLater">Plus tard</button></div>
    <div class="onb-bar" role="progressbar" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${o.n}" aria-label="${o.n} étapes sur 4 terminées"><i style="width:${o.n * 25}%"></i></div>
    ${o.steps.map((s, i) => `<div class="onb-step ${s.done ? 'done' : ''}"><span class="dot" aria-hidden="true">✓</span><div class="tt"><b>${i + 1}. ${s.label}${s.done ? '<span class="sr"> (terminé)</span>' : ''}</b><span>${s.hint}</span></div>${s.done ? '<span class="pill ok">Fait</span>' : `<span class="row" style="flex:none">${btn(s, i)}</span>`}</div>`).join('')}</div>`;
};
J.act.obGo = (el) => { const sec = document.getElementById(el.dataset.sec); scrollToEl(sec); const f = sec && sec.querySelector(el.dataset.focus || 'input,select'); if (f) setTimeout(() => f.focus({ preventScroll: true }), calm() ? 0 : 400); };
J.act.obLater = async () => { await setOnb({ dismissed: true }); J.toast('Tu peux la retrouver plus tard dans les Réglages.', 'ok'); };
J.act.obFinish = async () => { await setOnb({ done: true }); J.go('accueil'); };
// Micro : demande l'autorisation, puis propose un petit test de dictée (qui déclenche aussi l'autorisation de reconnaissance vocale de macOS).
J.act.obMic = (el) => J.busy(el, async () => {
  const st = await J.call('voice.micStatus');
  if (st !== 'granted') return J.modal(`<h2>Micro non autorisé</h2><p>Jarvis a besoin du micro pour t'écouter. Ouvre les réglages de macOS, active <b>Jarvis Parlement</b> dans « Confidentialité › Micro », puis reviens ici et réessaie.</p><div class="row" style="margin-top:14px"><button class="pri" data-act="openMic">Ouvrir les réglages macOS</button><button data-act="closeModal">Fermer</button></div>`, null, { narrow: true });
  await setOnb({ micOk: true }); J.toast('Micro autorisé', 'ok');
  J.modal(`<h2>Micro autorisé</h2><p>Teste la dictée : clique sur « Écouter » et dis une phrase. Si macOS demande l'accès à la reconnaissance vocale, accepte.</p><div id="dicRes" aria-live="polite" class="card" style="background:var(--soft);min-height:56px;margin:12px 0 0"><span class="muted">Le texte reconnu apparaîtra ici.</span></div><div class="row" style="margin-top:14px"><button class="pri" data-act="obDictee">${J.icon('mic')} Écouter</button><button data-act="closeModal">Terminer</button></div>`, null, { narrow: true });
}, 'Vérification…');
J.act.obDictee = (el) => J.busy(el, async () => {
  const out = document.getElementById('dicRes'); out.innerHTML = '<span class="muted">Je t\'écoute… parle maintenant.</span>';
  try {
    const h = await J.listen({ vad: true, noSpeechMs: 8000 }); const r = await h.done;
    if (!r.wav) { out.innerHTML = '<span class="muted">Je n\'ai rien entendu. Rapproche-toi du micro et réessaie.</span>'; return; }
    out.innerHTML = '<span class="muted">Transcription…</span>'; const text = await J.transcribe(r.wav);
    out.innerHTML = text ? `<b>Entendu :</b> « ${J.esc(text)} »` : '<span class="muted">Rien de reconnu. Réessaie en parlant un peu plus fort.</span>';
  } catch (e) { out.innerHTML = `<b>La dictée n'a pas fonctionné.</b> ${J.esc(J.errMsg(e))}<br><span class="muted small">Vérifie « Confidentialité › Reconnaissance vocale » dans les réglages de macOS.</span>`; }
}, 'Écoute…');

J.pages.reglages = async (root, arg) => {
  await J.refreshMeta(); const s = J.S, p = s.profile, ai = s.ai;
  const mode = ai.provider === 'openai' ? (/^https:\/\/api\.openai\.com/.test(ai.baseUrl) ? 'openai-cloud' : 'openai') : ai.provider;
  root.innerHTML = `<h1>Réglages</h1><p class="sub">Profil, moteur IA, voix, confidentialité. Données stockées dans <span class="path">${J.esc(s._env.dataDir)}</span></p>
    <div id="onb"></div>
    <div class="sect-nav chips" role="navigation" aria-label="Sections des réglages"><button class="chip" data-act="obGo" data-sec="sec-profil" data-focus="#pNom">Profil</button><button class="chip" data-act="obGo" data-sec="sec-ia" data-focus="#aProv">Moteur IA</button><button class="chip" data-act="obGo" data-sec="sec-voix" data-focus="#vRate">Voix et micro</button><button class="chip" data-act="obGo" data-sec="sec-app" data-focus="#oLogin">Application</button></div>
    <div class="card" id="sec-profil"><h2>${J.hi('user')}Profil</h2><div class="grid g3"><div><label class="f">Nom</label><input id="pNom" value="${J.esc(p.nom)}" autocomplete="name"></div><div><label class="f">Titre</label><input id="pTitre" value="${J.esc(p.titre)}"></div><div><label class="f">Groupe politique</label><input id="pGroupe" value="${J.esc(p.groupe)}"></div>
      <div><label class="f">Parti</label><input id="pParti" value="${J.esc(p.parti)}"></div><div><label class="f">Circonscription</label><input id="pCirc" value="${J.esc(p.circonscription)}"></div><div><label class="f">Langue par défaut</label><select id="pLang"><option value="fr" ${p.langue === 'fr' ? 'selected' : ''}>Français</option><option value="nl" ${p.langue === 'nl' ? 'selected' : ''}>Néerlandais</option><option value="en" ${p.langue === 'en' ? 'selected' : ''}>Anglais</option></select></div></div>
      <label class="f">Signature des textes</label><input id="pSig" value="${J.esc(p.signature)}" placeholder="Prénom Nom, Député bruxellois">
      <div class="row" style="margin-top:12px"><button class="pri" data-act="saveProfile">Enregistrer le profil</button><span class="muted small">Parlements actifs : <a href="#parlements">gérer mes parlements →</a></span></div></div>
    <div class="card" id="sec-ia"><h2>${J.hi('bot')}Moteur IA</h2>
      <div class="grid g2"><div><label class="f">Fournisseur</label><select id="aProv">
          <option value="anthropic" ${mode === 'anthropic' ? 'selected' : ''}>Claude (Anthropic) — clé API · recherche web intégrée</option>
          <option value="openai-cloud" ${mode === 'openai-cloud' ? 'selected' : ''}>OpenAI (GPT) — clé API</option>
          <option value="ollama" ${mode === 'ollama' ? 'selected' : ''}>Ollama — 100 % local et gratuit</option>
          <option value="openai" ${mode === 'openai' ? 'selected' : ''}>Autre serveur compatible OpenAI (LM Studio…)</option></select></div>
      <div><span class="f" style="display:block;font-size:12px;color:var(--mute);margin:10px 0 4px;font-weight:600">Recherche web</span><label class="chk" style="margin-top:8px"><input type="checkbox" id="aWeb" ${ai.webSearch ? 'checked' : ''}> Autoriser Jarvis à chercher sur le web</label></div></div>
      <div id="provAnthropic" ${mode === 'anthropic' ? '' : 'hidden'}><div class="grid g3"><div><label class="f">Clé API Anthropic (Claude)</label><input id="aKey" type="password" autocomplete="off" placeholder="${s._secrets.anthropic_key ? '•••••• (enregistrée)' : 'sk-ant-…'}"></div><div><label class="f">Modèle principal</label><select id="aModel" data-cur="${J.esc(ai.model)}"><option>${J.esc(ai.model)}</option></select></div><div><label class="f">Modèle rapide (mémoire, tri)</label><select id="aFast" data-cur="${J.esc(ai.fastModel)}"><option>${J.esc(ai.fastModel)}</option></select></div></div>
        <p class="muted small">Clé à créer sur <a data-ext="1" href="https://console.anthropic.com/settings/keys">console.anthropic.com</a> (facturation à l'usage, distincte de l'abonnement Claude). Les modèles apparaissent dès que la clé est saisie.</p></div>
      <div id="provOpenAI" ${mode === 'openai-cloud' ? '' : 'hidden'}><div class="grid g3"><div><label class="f">Clé API OpenAI</label><input id="aKeyO" type="password" autocomplete="off" placeholder="${s._secrets.openai_key ? '•••••• (enregistrée)' : 'sk-…'}"></div><div><label class="f">Modèle principal</label><select id="aOModel" data-cur="${J.esc(ai.localModel)}"><option>${J.esc(ai.localModel)}</option></select></div><div><label class="f">Modèle rapide (mémoire, tri)</label><select id="aOFast" data-cur="${J.esc(ai.fastLocalModel || '')}"><option>${J.esc(ai.fastLocalModel || '')}</option></select></div></div>
        <p class="muted small">Clé à créer sur <a data-ext="1" href="https://platform.openai.com/api-keys">platform.openai.com/api-keys</a> (facturation à l'usage, distincte de l'abonnement ChatGPT). Les modèles apparaissent dès que la clé est saisie. La recherche web passe par DuckDuckGo avec ce fournisseur.</p></div>
      <div id="provLocal" ${mode === 'ollama' || mode === 'openai' ? '' : 'hidden'}><div class="grid g3"><div><label class="f">Adresse du serveur</label><input id="aBase" value="${J.esc(ai.baseUrl)}"></div><div><label class="f">Modèle</label><select id="aLocal" data-cur="${J.esc(ai.localModel)}"><option>${J.esc(ai.localModel)}</option></select></div><div><label class="f">Clé (si nécessaire)</label><input id="aKey2" type="password" autocomplete="off" placeholder="${s._secrets.compat_key ? '•••••• (enregistrée)' : 'optionnel'}"></div></div>
        <p class="small" id="aLocalMsg" role="status" style="color:var(--warn)"></p><p class="muted small">Ollama : installe-le depuis <a data-ext="1" href="https://ollama.com">ollama.com</a> puis <code>ollama pull mistral</code>. Avec un moteur local, tes documents ne quittent jamais ton Mac.</p></div>
      <div class="row" style="margin-top:10px"><span id="aModelsMsg" class="muted small" role="status"></span><button class="sm ghost" data-act="aRefresh">${J.icon('refresh')} Actualiser la liste des modèles</button></div>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="saveSettings">Enregistrer</button><button data-act="testAI">Enregistrer et tester le moteur</button>${s.onboarding?.aiOk && s._env.configured ? '<span class="pill ok">Testé avec succès</span>' : ''}</div></div>
    <div class="card" id="sec-voix"><h2>${J.hi('speaker')}Voix et micro</h2>
      <p class="muted small"><b>Parler</b> : voix humaines françaises open source (modèles <a data-ext="1" href="https://github.com/rhasspy/piper">Piper</a>), gratuites et 100 % hors-ligne : deux voix de femme, deux voix d'homme. Choisis la tienne ci-dessous. <b>Écouter</b> : reconnaissance vocale de macOS, gratuite et intégrée (rien à configurer). Whisper reste possible en option ci-dessous.</p>
      <h3>Voix de Jarvis</h3><div id="vPiper" class="muted small">Chargement des voix…</div>
      <div class="grid g2" style="margin-top:8px"><div><label class="f">Vitesse</label><input id="vRate" type="range" min="0.7" max="1.4" step="0.05" value="${s.voice.ttsRate}"></div>
      <div><label class="f" style="visibility:hidden">Test</label><div class="row"><button data-act="vTest">${J.icon('speaker')} Tester la voix</button><button class="ghost" data-act="speakStop" aria-label="Arrêter la lecture">${J.icon('stop')}</button></div></div></div>
      <h3 style="margin-top:14px">Écoute (transcription)</h3>
      <div class="grid g3"><div><label class="f">Serveur de transcription</label><input id="vUrl" value="${J.esc(s.voice.sttUrl)}"></div><div><label class="f">Modèle</label><input id="vModel" value="${J.esc(s.voice.sttModel)}"></div><div><label class="f">Clé (inutile en local)</label><input id="vKey" type="password" autocomplete="off" placeholder="${s._secrets.stt_key ? '•••••• (enregistrée)' : 'sk-…'}"></div></div>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="vSave">Enregistrer</button><button data-act="obMic">Vérifier le micro</button><span class="pill ${s._env.sttReady ? 'ok' : 'warn'}">${s._env.sttReady ? 'Écoute prête' : 'Écoute non configurée'}</span>${s.onboarding?.micOk ? '<span class="pill ok">Micro autorisé</span>' : ''}<span class="muted small" id="progress" aria-live="polite"></span></div></div>
    <div class="card" id="sec-app"><h2>${J.hi('gear')}Application</h2><div class="row"><label class="chk" style="margin:0"><input type="checkbox" id="oLogin" ${s.app?.loginItem ? 'checked' : ''}> Lancer Jarvis à l'ouverture de session</label><button class="sm" data-act="saveLogin">Appliquer</button><button class="sm" data-act="openData">Ouvrir le dossier de données</button></div>
      <p class="muted small">Les clés et mots de passe sont chiffrés par le trousseau macOS ${s._env.encrypted ? '(actif)' : '(indisponible : les clés ne pourront pas être enregistrées en sécurité)'}. Aucune télémétrie.</p></div>`;
  J.drawOnb();
  J.drawPiper();
  document.getElementById('aProv').addEventListener('change', (e) => {
    const v = e.target.value; document.getElementById('provAnthropic').hidden = v !== 'anthropic'; document.getElementById('provOpenAI').hidden = v !== 'openai-cloud'; document.getElementById('provLocal').hidden = !(v === 'ollama' || v === 'openai');
    if (v === 'ollama') document.getElementById('aBase').value = 'http://localhost:11434/v1'; if (v === 'openai' && /api\.openai\.com|11434/.test(J.val('aBase'))) document.getElementById('aBase').value = 'http://localhost:1234/v1';
    J.loadModels();
  });
  ['aKey', 'aKeyO', 'aKey2', 'aBase'].forEach((id) => document.getElementById(id)?.addEventListener('change', () => J.loadModels()));
  J.loadModels();
  if (arg === 'miseenroute') document.getElementById('onb')?.scrollIntoView({ block: 'start' });
};
// Remplit automatiquement les listes de modèles selon le fournisseur (et la clé / l'adresse saisies).
J.loadModels = async () => {
  const v = J.val('aProv'); if (!v) return; const cfg = { anthropic: { ids: ['aModel', 'aFast'], key: 'aKey', prov: 'anthropic' }, 'openai-cloud': { ids: ['aOModel', 'aOFast'], key: 'aKeyO', prov: 'openai', base: 'https://api.openai.com/v1' }, ollama: { ids: ['aLocal'], key: 'aKey2', prov: 'ollama' }, openai: { ids: ['aLocal'], key: 'aKey2', prov: 'openai' } }[v];
  const msg = document.getElementById('aModelsMsg'); if (msg) msg.textContent = 'Recherche des modèles…';
  let r; try { r = await J.call('ai.models', { provider: cfg.prov, baseUrl: cfg.base || J.val('aBase'), key: J.val(cfg.key) || undefined }); } catch (e) { r = { models: [], error: J.errMsg(e) }; }
  if (J.val('aProv') !== v) return; // l'utilisateur a changé de fournisseur entre-temps
  const list = r.models || [];
  for (const id of cfg.ids) {
    const el = document.getElementById(id); if (!el) continue; const cur = el.dataset.cur || el.value;
    if (!list.length) { const keep = v === 'openai-cloud' && !/^(gpt|o\d|chatgpt)/.test(cur) ? '' : cur; el.outerHTML = `<input id="${id}" data-cur="${J.esc(keep)}" value="${J.esc(keep)}" aria-label="Nom du modèle" placeholder="${v === 'openai-cloud' ? 'ex. gpt-5' : 'nom du modèle'}">`; continue; }
    const fastish = /Fast$/.test(id); const pick = (re) => (list.find((m) => re.test(m.id)) || {}).id;
    const pref = fastish ? pick(/haiku|nano|mini/i) : (v === 'anthropic' ? pick(/sonnet/i) : v === 'openai-cloud' ? (pick(/^gpt-\d+(\.\d+)?$/) || pick(/^gpt-/)) : undefined);
    const sel = list.some((m) => m.id === cur) ? cur : (pref || list[0].id);
    const html = list.map((m) => `<option value="${J.esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${J.esc(m.label)}${m.label !== m.id ? ' — ' + J.esc(m.id) : ''}</option>`).join('');
    if (el.tagName === 'SELECT') el.innerHTML = html; else el.outerHTML = `<select id="${id}" data-cur="${J.esc(cur)}" aria-label="Modèle">${html}</select>`;
  }
  if (msg) msg.textContent = list.length ? `${list.length} modèles disponibles` : (r.error || '');
  const la = document.getElementById('aLocalMsg'); if (la) la.textContent = list.length ? '' : (r.error || '');
};
J.act.aRefresh = () => J.loadModels();
const persistAI = async () => {
  const v = J.val('aProv'); let ai = { webSearch: J.val('aWeb') }; let keyField = null, keyName = null;
  if (v === 'anthropic') { ai = { ...ai, provider: 'anthropic', model: J.val('aModel') || 'claude-sonnet-5-5', fastModel: J.val('aFast') || 'claude-haiku-5-5' }; keyField = 'aKey'; keyName = 'anthropic_key'; }
  else if (v === 'openai-cloud') { ai = { ...ai, provider: 'openai', baseUrl: 'https://api.openai.com/v1', localModel: J.val('aOModel'), fastLocalModel: J.val('aOFast') }; keyField = 'aKeyO'; keyName = 'openai_key'; }
  else { ai = { ...ai, provider: v, baseUrl: J.val('aBase'), localModel: J.val('aLocal'), fastLocalModel: '' }; keyField = 'aKey2'; keyName = 'compat_key'; }
  const k = (J.val(keyField) || '').trim(); if (k) { await J.call('secret.set', { name: keyName, value: k }); const f = document.getElementById(keyField); f.value = ''; f.placeholder = '•••••• (enregistrée)'; }
  await J.call('settings.set', { profile: profileFields(), ai });
  await J.refreshMeta(); J.drawChrome();
};
J.act.saveProfile = (el) => J.busy(el, async () => { await J.call('settings.set', { profile: profileFields() }); await J.refreshMeta(); J.drawChrome(); J.drawOnb(); J.toast('Profil enregistré', 'ok'); }, 'Enregistrement…');
J.act.saveSettings = (el) => J.busy(el, async () => { await persistAI(); J.drawOnb(); J.toast('Réglages enregistrés', 'ok'); }, 'Enregistrement…');
J.act.testAI = (el) => J.busy(el, async () => {
  if (document.getElementById('aProv')) await persistAI();
  try { const r = await J.call('ai.test'); await setOnb({ aiOk: true }); J.toast(`Moteur OK : ${r.model} (${r.ms} ms)`, 'ok'); }
  catch (e) { await J.call('settings.set', { onboarding: { aiOk: false } }).catch(() => {}); await J.refreshMeta(); J.drawOnb(); throw new Error(J.errMsg(e) + ' Vérifie la clé ou l\'adresse du serveur dans « Moteur IA », puis réessaie.'); }
}, 'Test en cours…');
J.drawPiper = async () => {
  const box = document.getElementById('vPiper'); if (!box) return;
  const st = await J.call('voice.status'); const cur = J.S.voice.engine === 'piper' && st.voices.find((x) => x.id === J.S.voice.piperVoice)?.installed ? J.S.voice.piperVoice : '';
  box.innerHTML = st.voices.map((v) => `<div class="line" style="border-bottom:1px solid var(--line)"><span style="white-space:normal"><b>${J.esc(v.label)}</b> <span class="pill">${J.esc(v.gender)}</span> ${v.installed ? `<span class="pill ok">${v.bundled ? 'fournie avec l’application' : 'installée'}</span>` : `<span class="muted">≈ ${v.mb} Mo</span>`} ${cur === v.id ? '<span class="pill gold">utilisée</span>' : ''}</span>
    <span class="row" style="flex:none">${v.installed ? `<button class="sm" data-act="vUse" data-id="${v.id}">${J.icon('speaker')} Écouter et utiliser</button>${v.bundled ? '' : `<button class="sm danger" data-act="vDel" data-id="${v.id}">Supprimer</button>`}` : `<button class="sm pri" data-act="vInstall" data-id="${v.id}">Télécharger et utiliser</button>`}</span></div>`).join('')
    + '<p class="muted small" style="margin-top:8px">Jarvis parle toujours avec une voix humaine : la voix de ton ordinateur n’est jamais utilisée.</p>';
};
J.act.vInstall = (el) => J.busy(el, async () => { await J.call('voice.install', { voiceId: el.dataset.id }); await J.refreshMeta(); J.drawChrome(); J.toast('Voix installée et activée', 'ok'); J.drawPiper(); J.drawOnb(); }, 'Téléchargement…');
J.act.vUse = async (el) => { await J.call('settings.set', { voice: { engine: 'piper', piperVoice: el.dataset.id } }); await J.refreshMeta(); J.drawPiper(); J.drawOnb(); J.speak('Bonjour, je suis Jarvis. Voici ma voix.'); };
J.act.vDel = async (el) => { if (!await J.confirm('Supprimer cette voix de ton Mac ? Tu pourras la télécharger à nouveau.', { ok: 'Supprimer', danger: true, title: 'Supprimer la voix' })) return; await J.call('voice.removeVoice', { voiceId: el.dataset.id }); if (J.S.voice.piperVoice === el.dataset.id) await J.call('settings.set', { voice: { engine: 'piper', piperVoice: 'siwis' } }); await J.refreshMeta(); J.drawPiper(); J.drawOnb(); };
J.act.vTest = async () => { J.S.voice = { ...J.S.voice, ttsRate: J.val('vRate') }; await J.call('settings.set', { voice: { ttsRate: Number(J.val('vRate')) } }); J.speak('Bonjour, je suis Jarvis. Je suis prêt à travailler avec vous.'); };
J.act.vSave = (el) => J.busy(el, async () => { await J.call('settings.set', { voice: { ttsRate: Number(J.val('vRate')), sttUrl: J.val('vUrl').trim(), sttModel: J.val('vModel').trim() } }); const k = J.val('vKey'); if (k && k.trim()) { await J.call('secret.set', { name: 'stt_key', value: k.trim() }); document.getElementById('vKey').value = ''; } await J.refreshMeta(); J.toast('Voix enregistrée', 'ok'); }, 'Enregistrement…');
J.act.vMic = (el) => J.act.obMic(el);
J.act.saveLogin = async () => { const want = J.val('oLogin'); const on = await J.call('app.loginItem', { enabled: want }); await J.call('settings.set', { app: { loginItem: !!on } }); J.toast(on ? 'Jarvis se lancera à l\'ouverture de session' : 'Lancement automatique désactivé', 'ok'); };
J.act.openData = () => J.call('app.openDataDir');

// ---------- DIAGNOSTIC ----------
J.pages.diagnostic = async (root) => {
  root.innerHTML = `<h1>Diagnostic</h1><p class="sub">Vérifie le moteur IA, les comptes, l'agenda, l'index, la veille et le cerveau.</p><div class="card"><div class="row"><button class="pri" data-act="runDiag">Relancer le diagnostic</button> <span id="dSum" class="muted" role="status"></span></div><div id="dOut" style="margin-top:12px" aria-live="polite"></div></div>`;
  J.act.runDiag(J.$('[data-act=runDiag]'));
};
J.act.runDiag = (el) => J.busy(el, async () => {
  const out = document.getElementById('dOut'); if (!out) return;
  out.innerHTML = '<p class="muted small">Les contrôles peuvent prendre quelques secondes (moteur IA, comptes, réseau)…</p>' + J.skeleton(3);
  let r; try { r = await J.call('diag.run'); } catch (e) { out.innerHTML = `<div class="empty err" role="alert"><b>Le diagnostic n'a pas pu s'exécuter</b>${J.esc(J.errMsg(e))}</div>`; throw e; }
  J.state.diag = r;
  if (!document.getElementById('dSum') || !document.getElementById('dOut')) return; // l'utilisateur a quitté la page pendant le diagnostic
  const ko = r.checks.filter((c) => c.status === 'ko').length, warn = r.checks.filter((c) => c.status === 'warn').length;
  document.getElementById('dSum').innerHTML = `<span class="pill ${ko ? 'ko' : warn ? 'warn' : 'ok'}">${ko ? ko + ' problème' + (ko > 1 ? 's' : '') : warn ? warn + ' point' + (warn > 1 ? 's' : '') + ' à voir' : 'Tout est en ordre'}</span> <span class="muted small">${J.esc(r.summary)}</span>`;
  out.innerHTML = r.checks.map((c) => `<div class="diag"><span class="pill ${c.status}">${{ ok: 'OK', warn: 'À voir', ko: 'Problème' }[c.status] || J.esc(c.status)}</span><b>${J.esc(c.name)}</b><span class="muted">${J.esc(c.detail)}</span></div>`).join('') + `<div style="margin-top:12px"><button class="sm" data-act="dCopyDiag">${J.icon('copy')} Copier le rapport</button></div>`;
}, 'Contrôles en cours…');
J.act.dCopyDiag = () => J.copy(J.state.diag.checks.map((c) => `[${c.status}] ${c.name} — ${c.detail}`).join('\n'));
