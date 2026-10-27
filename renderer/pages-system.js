// Pages système : Cerveau, Assistant, Réglages, Diagnostic.

// ---------- CERVEAU ----------
J.pages.cerveau = async (root) => {
  const b = await J.call('brain.list'); const cats = b.categories;
  const top = (o) => Object.entries(o).sort((a, c) => c[1] - a[1]).slice(0, 6);
  root.innerHTML = `<h1>🧠 Cerveau</h1><p class="sub">Ce que Jarvis a appris de toi. Il enrichit cette mémoire quand tu travailles : tes demandes, tes corrections de brouillons et tes 👍/👎. Tout est local, modifiable et effaçable.</p>
    <div class="card"><div class="row sp"><label class="chk" style="margin:0"><input type="checkbox" id="bLearn" ${b.learning ? 'checked' : ''}> Apprentissage automatique actif</label>
      <span class="row"><button class="sm" data-act="bExport">Exporter</button><button class="sm" data-act="bImport">Importer</button><button class="sm danger" data-act="bReset">Tout oublier</button></span></div>
      <p class="muted small" style="margin-bottom:0">Les contenus des documents analysés et des courriels ne sont jamais transmis à la mémoire.</p></div>
    <div class="card"><h2>Ajouter un souvenir</h2><div class="row"><input id="bText" class="grow" placeholder="Ex. Je préfère des questions courtes, chiffrées, sans adjectifs"><select id="bCat" style="width:200px">${Object.entries(cats).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button class="pri" data-act="bAdd">Retenir</button></div></div>
    ${Object.entries(cats).map(([k, label]) => { const fs = b.facts.filter((f) => f.category === k); return fs.length ? `<div class="card"><h2>${label} <span class="pill">${fs.length}</span></h2>${fs.map((f) => `<div class="fact"><div class="t"><input value="${J.esc(f.text)}" data-act-change="bEdit" data-id="${f.id}" class="bf"><span class="muted small">${f.source} · vu ${f.count}× ${f.pinned ? '· 📌' : ''}</span></div><button class="sm" data-act="bPin" data-id="${f.id}" data-p="${f.pinned ? 0 : 1}">${f.pinned ? 'Détacher' : '📌'}</button><button class="sm danger" data-act="bDel" data-id="${f.id}">✕</button></div>`).join('')}</div>` : ''; }).join('') || '<div class="empty">Le cerveau est vide. Utilise Jarvis : il va commencer à retenir tes préférences.</div>'}
    <div class="card"><h2>Habitudes observées</h2><div class="grid g3"><div><h3>Thèmes</h3>${top(b.stats.themes).map(([k, n]) => `<div class="small">${J.esc(k)} <span class="pill">${n}</span></div>`).join('') || '<span class="muted small">—</span>'}</div>
      <div><h3>Instruments</h3>${top(b.stats.instruments).map(([k, n]) => `<div class="small">${J.esc(k)} <span class="pill">${n}</span></div>`).join('') || '<span class="muted small">—</span>'}</div>
      <div><h3>Fonctions utilisées</h3>${top(b.stats.usage).map(([k, n]) => `<div class="small">${J.esc(k)} <span class="pill">${n}</span></div>`).join('') || '<span class="muted small">—</span>'}</div></div></div>`;
  document.getElementById('bLearn').addEventListener('change', (e) => J.call('settings.set', { brain: { learning: e.target.checked } }));
  J.$$('.bf').forEach((i) => i.addEventListener('change', () => J.call('brain.update', { id: i.dataset.id, patch: { text: i.value } }).then(() => J.toast('Modifié', 'ok'))));
};
J.act.bAdd = async () => { await J.call('brain.add', { text: J.val('bText'), category: J.val('bCat'), pinned: true }); J.render(); };
J.act.bDel = async (el) => { await J.call('brain.remove', { id: el.dataset.id }); J.render(); };
J.act.bPin = async (el) => { await J.call('brain.update', { id: el.dataset.id, patch: { pinned: el.dataset.p === '1' } }); J.render(); };
J.act.bReset = async () => { if (confirm('Effacer toute la mémoire de Jarvis ?')) { await J.call('brain.reset'); J.render(); } };
J.act.bExport = async () => { const p = await J.call('brain.export'); if (p) J.toast('Exporté : ' + p, 'ok'); };
J.act.bImport = async () => { const n = await J.call('brain.import'); if (n !== null) { J.toast(n + ' souvenirs au total', 'ok'); J.render(); } };

// ---------- ASSISTANT ----------
J.pages.assistant = async (root) => {
  J.state.chat = J.state.chat || [];
  root.innerHTML = `<h1>Assistant</h1><p class="sub">Discute librement avec Jarvis. Il connaît tes préférences et peut chercher sur le web ou dans tes documents.</p>
    <div class="chat" id="chat">${J.state.chat.map(msgBubble).join('') || '<div class="empty">Pose une question : « Prépare-moi trois angles de question sur… »</div>'}</div>
    <div class="card"><textarea id="cIn" style="min-height:70px" placeholder="Écris ou dicte ton message…"></textarea><div class="row sp" style="margin-top:8px"><span class="row">${J.micBtn('cIn')}<label class="chk" style="margin:0"><input type="checkbox" id="cWeb"> Web</label><label class="chk" style="margin:0"><input type="checkbox" id="cDocs"> Mes documents</label><label class="chk" style="margin:0"><input type="checkbox" id="cSpeak" ${J.S.voice.autoSpeak ? 'checked' : ''}> Réponses à voix haute</label></span><span class="row"><button class="sm" data-act="cClear">Nouvelle conversation</button><button class="pri" data-act="cSend">Envoyer</button></span></div></div>`;
  document.getElementById('cSpeak').addEventListener('change', (e) => { J.S.voice.autoSpeak = e.target.checked; J.call('settings.set', { voice: { autoSpeak: e.target.checked } }); if (!e.target.checked) J.stopSpeak(); });
  document.getElementById('cIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) J.act.cSend(J.$('[data-act=cSend]')); });
};
const msgBubble = (m) => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">${m.role === 'user' ? J.esc(m.content) : J.md(m.content) + `<button class="sm ghost" data-act="speakMsg" data-i="${J.state.chat.indexOf(m)}">🔊</button>` + (m.sources?.length ? '<div class="small muted">' + m.sources.map((s) => `<a data-ext="1" href="${J.esc(s.url)}">${J.esc(s.title)}</a>`).join(' · ') + '</div>' : '')}</div>`;
J.act.speakMsg = (el) => J.speak(J.state.chat[Number(el.dataset.i)].content);
J.act.cClear = () => { J.state.chat = []; J.render(); };
J.act.cSend = (el) => J.busy(el, async () => {
  const t = J.val('cIn').trim(); if (!t) return;
  J.state.chat.push({ role: 'user', content: t }); document.getElementById('chat').innerHTML = J.state.chat.map(msgBubble).join(''); document.getElementById('cIn').value = '';
  const r = await J.call('chat.send', { messages: J.state.chat.map((m) => ({ role: m.role, content: m.content })), useWeb: J.val('cWeb'), useDocs: J.val('cDocs') });
  J.state.chat.push({ role: 'assistant', content: r.text, sources: r.sources }); if (J.val('cSpeak')) J.speak(r.text); document.getElementById('chat').innerHTML = J.state.chat.map(msgBubble).join('');
}, 'Jarvis réfléchit…');

// ---------- RÉGLAGES ----------
J.pages.reglages = async (root) => {
  await J.refreshMeta(); const s = J.S, p = s.profile, ai = s.ai;
  root.innerHTML = `<h1>Réglages</h1><p class="sub">Profil, moteur IA, confidentialité. Données stockées dans <span class="path">${J.esc(s._env.dataDir)}</span></p>
    ${s.firstRunDone ? '' : '<div class="banner"><b>Bienvenue !</b> Renseigne ton profil et ton moteur IA : c\'est tout ce qu\'il faut pour démarrer.</div>'}
    <div class="card"><h2>👤 Profil</h2><div class="grid g3"><div><label class="f">Nom</label><input id="pNom" value="${J.esc(p.nom)}"></div><div><label class="f">Titre</label><input id="pTitre" value="${J.esc(p.titre)}"></div><div><label class="f">Groupe politique</label><input id="pGroupe" value="${J.esc(p.groupe)}"></div>
      <div><label class="f">Parti</label><input id="pParti" value="${J.esc(p.parti)}"></div><div><label class="f">Circonscription</label><input id="pCirc" value="${J.esc(p.circonscription)}"></div><div><label class="f">Langue par défaut</label><select id="pLang"><option value="fr" ${p.langue === 'fr' ? 'selected' : ''}>Français</option><option value="nl" ${p.langue === 'nl' ? 'selected' : ''}>Néerlandais</option><option value="en" ${p.langue === 'en' ? 'selected' : ''}>Anglais</option></select></div></div>
      <label class="f">Signature des textes</label><input id="pSig" value="${J.esc(p.signature)}" placeholder="Prénom Nom, Député bruxellois"><p class="muted small">Parlements actifs : <a href="#parlements">gérer mes parlements →</a></p></div>
    <div class="card"><h2>🤖 Moteur IA</h2>
      <div class="grid g2"><div><label class="f">Fournisseur</label><select id="aProv"><option value="anthropic" ${ai.provider === 'anthropic' ? 'selected' : ''}>Claude (Anthropic) — recherche web intégrée</option><option value="ollama" ${ai.provider === 'ollama' ? 'selected' : ''}>Ollama — 100 % local</option><option value="openai" ${ai.provider === 'openai' ? 'selected' : ''}>Compatible OpenAI (autre serveur)</option></select></div>
      <div><label class="f">Recherche web</label><label class="chk"><input type="checkbox" id="aWeb" ${ai.webSearch ? 'checked' : ''}> Autoriser Jarvis à chercher sur le web</label></div></div>
      <div id="provAnthropic" ${ai.provider === 'anthropic' ? '' : 'hidden'}><div class="grid g3"><div><label class="f">Clé API Anthropic</label><input id="aKey" type="password" placeholder="${s._secrets.anthropic_key ? '•••••• (enregistrée)' : 'sk-ant-…'}"></div><div><label class="f">Modèle principal</label><select id="aModel" data-cur="${J.esc(ai.model)}"><option>${J.esc(ai.model)}</option></select></div><div><label class="f">Modèle rapide (mémoire, tri)</label><select id="aFast" data-cur="${J.esc(ai.fastModel)}"><option>${J.esc(ai.fastModel)}</option></select></div></div><div class="row"><span id="aModelsMsg" class="muted small"></span><button class="sm ghost" data-act="aRefresh">↻ Actualiser la liste</button></div>
        <p class="muted small">Clé à créer sur <a data-ext="1" href="https://console.anthropic.com/settings/keys">console.anthropic.com</a> (facturation à l'usage, distincte de l'abonnement Claude).</p></div>
      <div id="provLocal" ${ai.provider === 'anthropic' ? 'hidden' : ''}><div class="grid g3"><div><label class="f">Adresse du serveur</label><input id="aBase" value="${J.esc(ai.baseUrl)}"></div><div><label class="f">Modèle</label><select id="aLocal" data-cur="${J.esc(ai.localModel)}"><option>${J.esc(ai.localModel)}</option></select></div><div><label class="f">Clé (si nécessaire)</label><input id="aKey2" type="password" placeholder="${s._secrets.openai_key ? '•••••• (enregistrée)' : 'optionnel'}"></div></div>
        <p class="muted small" id="aLocalMsg" style="color:var(--warn)"></p><p class="muted small">Ollama : installe-le depuis <a data-ext="1" href="https://ollama.com">ollama.com</a> puis <code>ollama pull mistral</code>. Avec un moteur local, tes documents ne quittent jamais ton Mac.</p></div>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="saveSettings">Enregistrer</button><button data-act="testAI">Tester le moteur</button></div></div>
    <div class="card"><h2>🎙️ Voix</h2>
      <p class="muted small"><b>Parler</b> : voix humaines françaises open source (modèles <a data-ext="1" href="https://github.com/rhasspy/piper">Piper</a>), gratuites et 100 % hors-ligne : deux voix de femme, deux voix d'homme. Choisis la tienne ci-dessous. <b>Écouter</b> : reconnaissance vocale de macOS, gratuite et intégrée (rien à configurer). Whisper reste possible en option ci-dessous.</p>
      <h3>Voix de Jarvis</h3><div id="vPiper" class="muted small">Chargement des voix…</div>
      <div class="grid g3" style="margin-top:8px"><div><label class="f">Vitesse</label><input id="vRate" type="range" min="0.7" max="1.4" step="0.05" value="${s.voice.ttsRate}"></div>
      <div><label class="f">Voix système (secours)</label><select id="vVoice"></select></div><div><label class="f">&nbsp;</label><button data-act="vTest">🔊 Tester la voix</button> <button class="ghost" data-act="speakStop">⏹</button></div></div>
      <h3 style="margin-top:14px">Écoute (transcription)</h3>
      <div class="grid g3"><div><label class="f">Serveur de transcription</label><input id="vUrl" value="${J.esc(s.voice.sttUrl)}"></div><div><label class="f">Modèle</label><input id="vModel" value="${J.esc(s.voice.sttModel)}"></div><div><label class="f">Clé (inutile en local)</label><input id="vKey" type="password" placeholder="${s._secrets.stt_key ? '•••••• (enregistrée)' : 'sk-…'}"></div></div>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="vSave">Enregistrer</button><button data-act="vMic">Vérifier le micro</button><span class="pill ${s._env.sttReady ? 'ok' : 'warn'}">${s._env.sttReady ? 'Écoute prête' : 'Écoute non configurée'}</span><span class="muted small" id="progress"></span></div></div>
    <div class="card"><h2>⚙️ Application</h2><div class="row"><label class="chk" style="margin:0"><input type="checkbox" id="oLogin"> Lancer Jarvis à l'ouverture de session</label><button class="sm" data-act="saveLogin">Appliquer</button><button class="sm" data-act="openData">Ouvrir le dossier de données</button></div>
      <p class="muted small">Les clés et mots de passe sont chiffrés par le trousseau macOS ${s._env.encrypted ? '(actif ✓)' : '(indisponible ✗)'}. Aucune télémétrie.</p></div>`;
  const fillVoices = () => { const vs = J.voices(); document.getElementById('vVoice').innerHTML = vs.length ? vs.map((v) => `<option value="${J.esc(v.name)}" ${v.name === s.voice.ttsVoice ? 'selected' : ''}>${J.esc(v.name)} (${v.lang})</option>`).join('') : '<option value="">Voix par défaut</option>'; };
  J.drawPiper(); fillVoices(); if (window.speechSynthesis) speechSynthesis.onvoiceschanged = fillVoices;
  document.getElementById('aProv').addEventListener('change', (e) => { document.getElementById('provAnthropic').hidden = e.target.value !== 'anthropic'; document.getElementById('provLocal').hidden = e.target.value === 'anthropic'; if (e.target.value === 'ollama') document.getElementById('aBase').value = 'http://localhost:11434/v1'; J.loadModels(); });
  ['aKey', 'aKey2', 'aBase'].forEach((id) => document.getElementById(id)?.addEventListener('change', () => J.loadModels()));
  J.loadModels();
};
// Remplit automatiquement les listes de modèles selon le fournisseur (et la clé / l'adresse saisies).
J.loadModels = async () => {
  const prov = J.val('aProv'); const anth = prov === 'anthropic';
  const ids = anth ? ['aModel', 'aFast'] : ['aLocal']; const msg = document.getElementById('aModelsMsg');
  if (anth && msg) msg.textContent = 'Recherche des modèles…';
  const r = await J.call('ai.models', { provider: prov, baseUrl: J.val('aBase'), key: (anth ? J.val('aKey') : J.val('aKey2')) || undefined });
  const list = r.models || [];
  for (const id of ids) {
    const el = document.getElementById(id); if (!el) continue; const cur = el.dataset.cur || el.value;
    if (!list.length) { el.outerHTML = `<input id="${id}" data-cur="${J.esc(cur)}" value="${J.esc(cur)}" placeholder="nom du modèle">`; continue; }
    const pref = id === 'aFast' ? (list.find((m) => /haiku/i.test(m.id)) || {}).id : (list.find((m) => /sonnet/i.test(m.id)) || {}).id;
    const keep = list.some((m) => m.id === cur); const sel = keep ? cur : (pref || list[0].id);
    const html = list.map((m) => `<option value="${J.esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${J.esc(m.label)}${m.label !== m.id ? ' — ' + J.esc(m.id) : ''}</option>`).join('');
    if (el.tagName === 'SELECT') el.innerHTML = html; else el.outerHTML = `<select id="${id}" data-cur="${J.esc(cur)}">${html}</select>`;
  }
  if (msg) msg.textContent = list.length ? `${list.length} modèles disponibles` : (r.error || '');
  const la = document.getElementById('aLocalMsg'); if (la) la.textContent = list.length ? '' : (r.error || '');
};
J.act.aRefresh = () => J.loadModels();
J.act.saveSettings = (el) => J.busy(el, async () => {
  const prov = J.val('aProv');
  await J.call('settings.set', { profile: { nom: J.val('pNom'), titre: J.val('pTitre'), groupe: J.val('pGroupe'), parti: J.val('pParti'), circonscription: J.val('pCirc'), langue: J.val('pLang'), signature: J.val('pSig') },
    ai: { provider: prov, webSearch: J.val('aWeb'), ...(prov === 'anthropic' ? { model: J.val('aModel') || 'claude-sonnet-5-5', fastModel: J.val('aFast') || 'claude-haiku-5-5' } : { baseUrl: J.val('aBase'), localModel: J.val('aLocal') }) } });
  const k = prov === 'anthropic' ? J.val('aKey') : J.val('aKey2');
  if (k && k.trim()) await J.call('secret.set', { name: prov === 'anthropic' ? 'anthropic_key' : 'openai_key', value: k.trim() });
  await J.refreshMeta(); J.drawChrome(); J.toast('Réglages enregistrés', 'ok'); J.render();
});
J.act.testAI = (el) => J.busy(el, async () => { const r = await J.call('ai.test'); J.toast(`Moteur OK : ${r.model} (${r.ms} ms)`, 'ok'); }, 'Test…');
J.drawPiper = async () => {
  const st = await J.call('voice.status'); const cur = J.S.voice.engine === 'piper' && st.voices.find((x) => x.id === J.S.voice.piperVoice)?.installed ? J.S.voice.piperVoice : '';
  document.getElementById('vPiper').innerHTML = st.voices.map((v) => `<div class="row sp" style="padding:5px 0;border-bottom:1px solid var(--line)"><span><b>${J.esc(v.label)}</b> <span class="pill">${v.gender}</span> ${v.installed ? '<span class="pill ok">installée</span>' : `<span class="muted">≈ ${v.mb} Mo</span>`} ${cur === v.id ? '<span class="pill gold">utilisée</span>' : ''}</span>
    <span class="row">${v.installed ? `<button class="sm" data-act="vUse" data-id="${v.id}">▶ Écouter et utiliser</button><button class="sm danger" data-act="vDel" data-id="${v.id}">Supprimer</button>` : `<button class="sm pri" data-act="vInstall" data-id="${v.id}">Télécharger et utiliser</button>`}</span></div>`).join('')
    + `<div class="row" style="margin-top:8px"><label class="chk" style="margin:0"><input type="radio" name="vEng" id="vEngSys" ${cur ? '' : 'checked'}> Utiliser la voix système macOS à la place</label></div>`;
  document.getElementById('vEngSys').addEventListener('change', async () => { await J.call('settings.set', { voice: { engine: 'system' } }); await J.refreshMeta(); J.drawPiper(); });
};
J.act.vInstall = (el) => J.busy(el, async () => { await J.call('voice.install', { voiceId: el.dataset.id }); await J.refreshMeta(); J.toast('Voix installée et activée', 'ok'); J.drawPiper(); }, 'Téléchargement…');
J.act.vUse = async (el) => { await J.call('settings.set', { voice: { engine: 'piper', piperVoice: el.dataset.id } }); await J.refreshMeta(); J.drawPiper(); J.speak('Bonjour, je suis Jarvis. Voici ma voix.'); };
J.act.vDel = async (el) => { if (!confirm('Supprimer cette voix ?')) return; await J.call('voice.removeVoice', { voiceId: el.dataset.id }); if (J.S.voice.piperVoice === el.dataset.id) await J.call('settings.set', { voice: { engine: 'system' } }); await J.refreshMeta(); J.drawPiper(); };
J.act.vTest = () => { J.S.voice = { ...J.S.voice, ttsVoice: J.val('vVoice'), ttsRate: J.val('vRate') }; J.call('settings.set', { voice: { ttsRate: Number(J.val('vRate')), ttsVoice: J.val('vVoice') } }); J.speak('Bonjour, je suis Jarvis. Je suis prêt à travailler avec vous.'); };
J.act.vSave = async () => { await J.call('settings.set', { voice: { ttsVoice: J.val('vVoice'), ttsRate: Number(J.val('vRate')), sttUrl: J.val('vUrl').trim(), sttModel: J.val('vModel').trim() } }); const k = J.val('vKey'); if (k && k.trim()) await J.call('secret.set', { name: 'stt_key', value: k.trim() }); await J.refreshMeta(); J.toast('Voix enregistrée', 'ok'); J.render(); };
J.act.vMic = async () => { const st = await J.call('voice.micStatus'); st === 'granted' ? J.toast('Micro autorisé ✓', 'ok') : J.act.mic({ dataset: {}, classList: { add() {}, remove() {} } }); };
J.act.saveLogin = async () => { const on = await J.call('app.loginItem', { enabled: J.val('oLogin') }); J.toast(on ? 'Lancement automatique activé' : 'Lancement automatique désactivé', 'ok'); };
J.act.openData = () => J.call('app.openDataDir');

// ---------- DIAGNOSTIC ----------
J.pages.diagnostic = async (root) => {
  root.innerHTML = `<h1>Diagnostic</h1><p class="sub">Vérifie le moteur IA, les comptes, l'agenda, l'index, la veille et le cerveau.</p><div class="card"><button class="pri" data-act="runDiag">Lancer le diagnostic</button> <span id="dSum" class="muted"></span><div id="dOut" style="margin-top:12px"></div></div>`;
  J.act.runDiag(J.$('[data-act=runDiag]'));
};
J.act.runDiag = (el) => J.busy(el, async () => {
  const r = await J.call('diag.run'); J.state.diag = r;
  document.getElementById('dSum').textContent = r.summary;
  document.getElementById('dOut').innerHTML = r.checks.map((c) => `<div class="diag"><span class="pill ${c.status}">${{ ok: 'OK', warn: 'À voir', ko: 'Problème' }[c.status]}</span><b>${J.esc(c.name)}</b><span class="muted">${J.esc(c.detail)}</span></div>`).join('') + '<div style="margin-top:12px"><button class="sm" data-act="dCopyDiag">Copier le rapport</button></div>';
}, 'Contrôles en cours…');
J.act.dCopyDiag = () => J.copy(J.state.diag.checks.map((c) => `[${c.status}] ${c.name} — ${c.detail}`).join('\n'));
