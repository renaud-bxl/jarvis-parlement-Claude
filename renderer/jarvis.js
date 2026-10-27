// Écran d'accueil « Jarvis » : orbe animé, salutation parlée, conversation vocale (écouter → comprendre → agir → répondre à voix haute).
(() => {
  const H = J.jv = { token: 0, loop: false, listening: null, state: 'idle', level: 0, pending: null, empties: 0 };
  const store = { get: (k, d) => { try { const v = localStorage.getItem('jv.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('jv.' + k, JSON.stringify(v)); } catch { /* ok */ } } };
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const onPage = () => !!$('jv');
  J.state.jh = J.state.jh || [];

  // ---------- Orbe ----------
  const COL = { idle: ['#1f6fd1', '#9fcaff'], listening: ['#ffd21f', '#fff4b8'], thinking: ['#8fbcff', '#ffffff'], speaking: ['#3d9bff', '#ffd21f'] };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  let cur = [hex(COL.idle[0]), hex(COL.idle[1])];
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  function startOrb(canvas) {
    const g = canvas.getContext('2d'); const W = canvas.width, C = W / 2; let t = 0, lv = 0;
    const draw = () => {
      if (!canvas.isConnected) return;
      t += 0.016; const target = COL[H.state] || COL.idle;
      cur = [mix(cur[0], hex(target[0]), 0.06), mix(cur[1], hex(target[1]), 0.06)];
      let want = 0.06 + 0.04 * Math.sin(t * 1.4);
      if (H.state === 'listening') want = Math.min(1, H.level * 9);
      else if (H.state === 'speaking') want = 0.35 + 0.3 * Math.abs(Math.sin(t * 6.3) * Math.sin(t * 2.1 + 1));
      else if (H.state === 'thinking') want = 0.18;
      lv += (want - lv) * 0.18;
      const base = W * 0.2 * (1 + lv * 0.16);
      g.clearRect(0, 0, W, W);
      const glow = g.createRadialGradient(C, C, base * 0.4, C, C, W * 0.5);
      glow.addColorStop(0, rgb(cur[0], 0.28 + lv * 0.25)); glow.addColorStop(1, rgb(cur[0], 0));
      g.fillStyle = glow; g.fillRect(0, 0, W, W);
      for (let k = 2; k >= 0; k--) {
        g.beginPath(); const amp = 3 + lv * (16 + k * 6), rr = base * (1.2 + k * 0.17), sp = H.state === 'thinking' ? 2.6 : 1;
        for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2; const r = rr + Math.sin(a * (3 + k) + t * (1 + k * 0.5) * sp) * amp + Math.sin(a * (5 - k) - t * 1.3 * sp) * amp * 0.5; const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.closePath(); g.strokeStyle = rgb(k === 1 ? cur[1] : cur[0], 0.7 - k * 0.2); g.lineWidth = 2.2 - k * 0.5; g.stroke();
      }
      if (H.state === 'thinking') { g.save(); g.translate(C, C); g.rotate(t * 2.4); g.beginPath(); g.arc(0, 0, base * 1.5, 0, Math.PI * 0.55); g.strokeStyle = rgb(cur[1], 0.95); g.lineWidth = 3; g.lineCap = 'round'; g.stroke(); g.restore(); }
      const core = g.createRadialGradient(C - base * 0.3, C - base * 0.35, base * 0.1, C, C, base);
      core.addColorStop(0, rgb(cur[1], 1)); core.addColorStop(0.55, rgb(cur[0], 0.95)); core.addColorStop(1, rgb(mix(cur[0], [7, 48, 106], 0.6), 0.95));
      g.beginPath(); g.arc(C, C, base, 0, Math.PI * 2); g.fillStyle = core; g.shadowColor = rgb(cur[0], 0.8); g.shadowBlur = 40 + lv * 50; g.fill(); g.shadowBlur = 0;
      requestAnimationFrame(draw);
    };
    draw();
  }
  const setState = (s, status) => { H.state = s; const el = $('jvStatus'); if (el && status !== undefined) el.textContent = status; const o = $('orbBtn'); if (o) o.dataset.state = s; };

  // ---------- Parole ----------
  const say = async (text) => {
    if (!text || store.get('muted', false)) { await wait(250); return; }
    setState('speaking'); try { await J.speak(text); } finally { if (H.state === 'speaking') setState('idle'); }
  };

  // ---------- Affichage ----------
  const typeIn = (el, text) => { el.textContent = text; el.classList.add('in'); };
  function renderAbilities(g, animate) {
    const ul = $('jvCan'); if (!ul) return;
    const items = g.abilities.slice(0, 4);
    ul.innerHTML = g.ready ? items.map((a, i) => `<li data-i="${i}" class="${animate ? '' : 'in'}"><button data-act="jvAbility" data-id="${a.id}">Je peux <b>${J.esc(a.say)}</b></button></li>`).join('') + `<li class="more ${animate ? '' : 'in'}"><span>…et bien d'autres choses : courrier, agenda, documents, dossiers, mémoire.</span></li>`
      : `<li class="in"><button data-act="jvSetup">Configurer mon moteur d'IA →</button></li>`;
    if (animate) [...ul.children].forEach((li, i) => setTimeout(() => li.classList.add('in'), i * 900));
  }
  function showOut(res) {
    const out = $('jvOut'); if (!out) return;
    const parts = [];
    if (res.md) parts.push(`<div class="jv-card"><div class="row sp"><b>${J.esc(titleFor(res.intent))}</b><span class="row">${res.readAloud ? `<button class="sm" data-act="jvRead">🔊 Lire le texte</button>` : ''}<button class="sm ghost" data-act="jvCopy">Copier</button></span></div><div id="jvMd">${J.md(res.md)}</div></div>`);
    if (res.messages && res.messages.length && !res.replyTo) {
      H.mails = res.messages;
      parts.push(`<div class="jv-card"><div class="row sp"><b>${res.messages.length} message${res.messages.length > 1 ? 's' : ''}</b><span class="row"><button class="sm" data-act="jvMailAll">🔊 Lire tous</button><button class="sm ghost" data-act="jvMailStop">⏹</button></span></div>` + res.messages.map((m, i) => `<div class="jv-mail" id="jm${i}"><div class="grow"><b>${J.esc(m.subject)}</b>${m.unread ? ' <span class="pill gold">non lu</span>' : ''}<div class="muted small">${J.esc(J.nameOf(m.from))} · ${J.esc(m.date ? J.fmtDate(m.date) : '')}</div><div class="small">${J.esc((m.text || '').replace(/\s+/g, ' ').slice(0, 140))}…</div></div><span class="row"><button class="sm" data-act="jvMailRead" data-i="${i}">🔊 Lire</button><button class="sm" data-act="jvMailShow" data-i="${i}">👁 Afficher</button><button class="sm pri" data-act="jvMailReply" data-i="${i}">↩ Répondre</button></span></div>`).join('') + '</div>');
    }
    const btns = [];
    if (res.link) btns.push(`<button class="pri sm" data-act="jvGo" data-page="${res.link.page}">${J.esc(res.link.label)} →</button>`);
    if (res.file) btns.push(`<button class="sm" data-act="jvFile" data-p="${J.esc(res.file)}">Afficher le fichier</button>`);
    (res.suggest || []).forEach((s) => btns.push(`<button class="sm chip" data-act="jvSay" data-t="${J.esc(s)}">${J.esc(s)}</button>`));
    if (btns.length) parts.push(`<div class="jv-actions">${btns.join('')}</div>`);
    out.innerHTML = parts.join('');
    H.last = res;
  }
  const titleFor = (i) => ({ mails: 'Vos courriels', veille_topic: 'Veille', veille_run: 'Veille', recherche: 'Recherche', redaction: 'Brouillon', briefing: 'Briefing du jour', agenda: 'Agenda', dossiers: 'Dossiers', documents: 'Dans vos documents', remember: 'Mémoire', help: 'Ce que je sais faire' }[i] || 'Réponse');
  const compact = () => { const r = $('jv'); if (r) r.classList.add('compact'); };

  // ---------- Un tour de conversation ----------
  async function turn(text) {
    compact(); $('jvHeard').textContent = '« ' + text + ' »'; $('jvOut').innerHTML = '';
    setState('thinking', 'Je m’en occupe…');
    let confirmed, pending = null;
    if (H.pending) {
      const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (/^(oui|ouais|d'accord|ok|okay|vas-y|bien sur|volontiers|exact|affirmatif)/.test(t)) { pending = H.pending; confirmed = /toujours/.test(t) ? 'always' : true; }
      else if (/^(non|pas |surtout pas|annule|refuse)/.test(t)) { pending = H.pending; confirmed = false; }
      H.pending = null;
    }
    let res;
    try { res = await J.call('jarvis.command', { text, history: J.state.jh.slice(-8), pending, confirmed }); }
    catch (e) { res = { ok: false, say: 'Je n’ai pas pu terminer : ' + e.message }; }
    if (!onPage()) return res;
    J.state.jh.push({ role: 'user', content: text }, { role: 'assistant', content: res.say || '' });
    if (res.confirm) H.pending = res.confirm;
    showOut(res); setState('idle', '');
    if (res.say) { $('jvSay').textContent = res.say; await say(res.say); }
    if (res.readAll && onPage()) await J.readMails(res.messages, (i) => { J.$$('.jv-mail').forEach((c) => c.classList.toggle('reading', c.id === 'jm' + i)); });
    if (res.replyTo && onPage()) { res.end = true; await J.mailReply(res.replyTo, res.replyInstruction); }
    if (res.navigate && onPage()) J.go(res.navigate);
    return res;
  }

  // ---------- Écoute ----------
  async function listenOnce() {
    if (!J.S._env.sttReady) { setState('idle', 'La reconnaissance vocale n’est pas disponible. Écrivez votre demande ci-dessous.'); return null; }
    let h;
    try { h = await J.listen({ vad: true, noSpeechMs: 9000, onLevel: (v) => { H.level = v; } }); }
    catch (e) { setState('idle', e.code === 'MIC' ? 'Micro refusé : autorisez Jarvis Parlement dans Réglages Système › Confidentialité › Micro.' : e.message); if (e.code === 'MIC') J.call('voice.openMicSettings'); return null; }
    H.listening = h; setState('listening', 'Je vous écoute…');
    const r = await h.done; H.listening = null;
    if (!r.wav) { H.empties++; return ''; }
    H.empties = 0; setState('thinking', 'Je transcris…');
    try { return (await J.transcribe(r.wav)).trim(); }
    catch (e) { setState('idle', e.message); J.toast(e.message, 'err'); return null; }
  }
  async function conversation() {
    if (H.loop) return; H.loop = true; const my = ++H.token;
    try {
      while (H.token === my && onPage()) {
        const text = await listenOnce();
        if (H.token !== my || !onPage()) break;
        if (text === null) break;
        if (text === '') { if (H.empties >= 2) { setState('idle', 'Je reste disponible : touchez l’orbe pour me parler.'); break; } continue; }
        const res = await turn(text);
        if (!store.get('converse', true) || res?.end || H.token !== my) break;
      }
    } finally { H.loop = false; if (onPage() && H.state !== 'speaking' && !H.listening) setState('idle'); }
  }
  const halt = () => { J.stopReading(); H.token++; if (H.listening) { H.listening.stop(); H.listening = null; } J.stopSpeak(); H.loop = false; H.state = 'idle'; };
  J.leave = halt;

  // ---------- Page ----------
  J.pages.accueil = async (root) => {
    halt(); H.empties = 0;
    const g = await J.call('jarvis.greeting'); const first = !J.state.greeted; const muted = store.get('muted', false);
    const nom = g.nom;
    root.innerHTML = `<div id="jv" class="jv${first ? '' : ' compact'}">
      <div class="jv-top"><span class="jv-parl">${J.esc(J.parlName(J.P.actif))}</span><span class="row"><a class="jv-link" href="#tableau">Tableau de bord</a><button class="jv-ico" id="jvMute" data-act="jvMute" title="Couper ou activer la voix de Jarvis">${muted ? '🔇' : '🔊'}</button></span></div>
      <button class="orb-btn" id="orbBtn" data-act="jvOrb" data-state="idle" aria-label="Parler à Jarvis"><canvas id="orb" width="640" height="640"></canvas></button>
      <div class="jv-hello" id="jvHello" aria-live="polite">
        <div class="h1" id="jh1">Bonjour</div>
        ${nom ? `<div class="h2" id="jh2">${J.esc(nom)}</div>` : ''}
        <div class="h3" id="jh3">Que puis-je faire pour vous aujourd’hui ?</div>
      </div>
      ${J.S._env.piperReady || store.get('voiceLater', false) ? '' : `<div class="jv-voice" id="jvVoice"><span>🎙 Pour une <b>vraie voix humaine</b> (gratuite, hors-ligne, ≈ 21 Mo), choisissez la mienne :</span><span class="row"><button data-act="jvVoiceInstall" data-id="siwis">Voix de femme</button><button data-act="jvVoiceInstall" data-id="tom">Voix d’homme</button><button class="ghost" data-act="jvVoiceLater">Plus tard</button></span><span class="small" id="progress"></span></div>`}
      <ul class="jv-can" id="jvCan"></ul>
      <div class="jv-status" id="jvStatus"></div>
      <div class="jv-heard" id="jvHeard"></div>
      <div class="jv-say" id="jvSay"></div>
      <div id="jvOut" class="jv-out"></div>
      <div class="jv-bar">
        <button class="jv-mic" data-act="jvOrb" title="Parler (touchez à nouveau pour terminer)">🎤</button>
        <input id="jvIn" placeholder="Parlez, ou écrivez : « check mes mails », « fais une veille sur… », « rédige une question sur… »" autocomplete="off">
        <button class="pri" data-act="jvSend">Envoyer</button>
      </div>
      <label class="jv-conv"><input type="checkbox" id="jvConv" ${store.get('converse', true) ? 'checked' : ''}> Conversation continue (j’écoute à nouveau après chaque réponse)</label>
    </div>`;
    startOrb($('orb'));
    $('jvIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') J.act.jvSend(); });
    $('jvConv').addEventListener('change', (e) => store.set('converse', e.target.checked));

    if (!first) { ['jh1', 'jh2', 'jh3'].forEach((id) => $(id)?.classList.add('in')); renderAbilities(g, false); if (J.state.jh.length === 0) $('jv').classList.remove('compact'); return; }
    // Première arrivée : salutation parlée, lignes qui apparaissent au rythme de la voix.
    J.state.greeted = true;
    const lines = [$('jh1'), $('jh2'), $('jh3')].filter(Boolean);
    const speak = !muted; const speech = g.intro + ' ' + g.offer;
    const per = speak ? 80 : 0;
    lines[0].classList.add('in');
    if (lines[1]) setTimeout(() => lines[1] && onPage() && lines[1].classList.add('in'), 700 + per * 2);
    setTimeout(() => onPage() && $('jh3').classList.add('in'), 1500 + per * (nom.length / 2 + 4));
    const introMs = speak ? Math.max(3500, g.intro.length * 68) : 2400;
    setTimeout(() => onPage() && renderAbilities(g, true), introMs);
    const my = H.token;
    await wait(500);
    if (H.token !== my || !onPage()) return;
    if (speak) { setState('speaking'); await say(speech); }
    else await wait(2500);
    if (H.token === my && onPage() && g.ready && store.get('converse', true) && J.S._env.sttReady) conversation();
  };

  // ---------- Actions ----------
  J.act.jvOrb = () => {
    if (H.listening) { H.listening.stop(); return; }
    if (H.state === 'thinking') return;
    if (J.speaking) { J.stopReading(); H.token++; H.loop = false; setState('idle'); }
    conversation();
  };
  J.act.jvSend = async () => {
    const i = $('jvIn'); const t = i.value.trim(); if (!t) return; i.value = '';
    if (H.listening) { H.listening.stop(); H.token++; H.loop = false; }
    J.stopSpeak(); H.token++; H.loop = false; await turn(t);
  };
  J.act.jvSay = (el) => { $('jvIn').value = el.dataset.t; J.act.jvSend(); };
  J.act.jvAbility = (el) => {
    J.call('jarvis.greeting').then((g) => {
      const ab = g.abilities.find((x) => x.id === el.dataset.id); if (!ab) return;
      const input = $('jvIn');
      if (/\s$/.test(ab.phrase)) { halt(); input.value = ab.phrase; input.focus(); setState('idle', 'Complétez la phrase puis appuyez sur Entrée — ou dites-la à voix haute.'); }
      else { input.value = ab.phrase; J.act.jvSend(); }
    });
  };
  J.act.jvVoiceInstall = async (el) => {
    const box = $('jvVoice'); box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try { await J.call('voice.install', { voiceId: el.dataset.id }); await J.refreshMeta(); box.innerHTML = '<span>✓ Voix installée. Elle sera utilisée par défaut — vous pouvez en changer dans Réglages › Voix.</span>'; setTimeout(() => box.remove(), 6000); await say(el.dataset.id === 'tom' ? 'Bonjour, voici ma voix. Que puis-je faire pour vous ?' : 'Bonjour, voici ma voix. Que puis-je faire pour vous ?'); }
    catch (e) { J.err(e); box.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
  };
  J.act.jvVoiceLater = () => { store.set('voiceLater', true); $('jvVoice')?.remove(); };
  J.act.jvMailAll = () => J.readMails(H.mails, (i) => { J.$$('.jv-mail').forEach((c) => c.classList.toggle('reading', c.id === 'jm' + i)); });
  J.act.jvMailStop = () => { J.stopReading(); J.$$('.jv-mail').forEach((c) => c.classList.remove('reading')); setState('idle'); };
  J.act.jvMailRead = (el) => { J.stopReading(); J.readMails([H.mails[Number(el.dataset.i)]]); };
  J.act.jvMailReply = (el) => J.mailReply(H.mails[Number(el.dataset.i)]);
  J.act.jvMailShow = (el) => { const m = H.mails[Number(el.dataset.i)]; J.modal(`<h2>${J.esc(m.subject)}</h2><div class="muted small">${J.esc(m.from)} · ${J.esc(m.date ? J.fmtDate(m.date) : '')}</div><div class="row" style="margin:10px 0"><button class="sm" data-act="jvMailRead" data-i="${el.dataset.i}">🔊 Lire</button><button class="sm pri" data-act="jvMailReply" data-i="${el.dataset.i}">↩ Répondre</button><button class="sm" data-act="closeModal">Fermer</button></div>${J.mailBody(m, 0)}`); J.mountMailFrames(); };
  J.act.jvSetup = () => J.go('reglages');
  J.act.jvGo = (el) => J.go(el.dataset.page);
  J.act.jvFile = (el) => J.call('app.openPath', { p: el.dataset.p });
  J.act.jvCopy = () => J.copy(H.last?.md || '');
  J.act.jvRead = () => { if (J.speaking) { J.stopSpeak(); setState('idle'); } else say(H.last?.readAloud || H.last?.md || ''); };
  J.act.jvMute = (el) => { const m = !store.get('muted', false); store.set('muted', m); el.textContent = m ? '🔇' : '🔊'; if (m) J.stopSpeak(); };
})();
