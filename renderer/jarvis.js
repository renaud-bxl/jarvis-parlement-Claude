// Écran d'accueil « Jarvis » : orbe animé, salutation parlée, conversation vocale (écouter → comprendre → agir → répondre à voix haute).
(() => {
  const H = J.jv = { token: 0, turnId: 0, loop: false, listening: null, state: 'idle', level: 0, pending: null, empties: 0, raf: 0, busy: false, last: null, mails: [] };
  const store = { get: (k, d) => { try { const v = localStorage.getItem('jv.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('jv.' + k, JSON.stringify(v)); } catch { /* ok */ } } };
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const onPage = () => !!$('jv');
  const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  J.state.jh = J.state.jh || [];

  // ---------- Orbe « cockpit » : anneaux qui tournent, barres vocales, « J » central ----------
  const COL = { idle: ['#3d8bff', '#9fcaff'], listening: ['#ffd21f', '#fff2a8'], thinking: ['#6fb1ff', '#ffffff'], speaking: ['#35a2ff', '#ffd21f'] };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  let cur = [hex(COL.idle[0]), hex(COL.idle[1])];
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const GOLD = [255, 210, 31];
  const stopOrb = () => { if (H.raf) cancelAnimationFrame(H.raf); H.raf = 0; H.orbResume = null; };
  function startOrb(canvas) {
    stopOrb();
    const g = canvas.getContext('2d'); const W = canvas.width, C = W / 2; let t = 0, lv = 0, spin = 0, prev = 0;
    const N = 132;
    const draw = (dt) => {
      const sp = reduceMotion() ? 0.15 : 1; t += dt * sp; const target = COL[H.state] || COL.idle;
      cur = [mix(cur[0], hex(target[0]), 0.06), mix(cur[1], hex(target[1]), 0.06)];
      let want = 0.07 + 0.05 * Math.sin(t * 1.3);
      if (H.state === 'listening') want = Math.min(1, 0.12 + H.level * 10);
      else if (H.state === 'speaking') want = 0.45 + 0.4 * Math.abs(Math.sin(t * 5.1) * Math.sin(t * 2.3 + 1));
      else if (H.state === 'thinking') want = 0.16;
      lv += (want - lv) * 0.2; spin += (H.state === 'thinking' ? 2.7 : 0.36) * dt * sp;
      g.clearRect(0, 0, W, W);
      const halo = g.createRadialGradient(C, C, W * 0.12, C, C, W * 0.5);
      halo.addColorStop(0, rgb(cur[0], 0.32 + lv * 0.28)); halo.addColorStop(0.55, rgb(cur[0], 0.08)); halo.addColorStop(1, rgb(cur[0], 0));
      g.fillStyle = halo; g.fillRect(0, 0, W, W);
      g.save(); g.translate(C, C); g.rotate(spin * 0.4);
      for (let i = 0; i < 180; i++) { const a = (i / 180) * Math.PI * 2, big = i % 5 === 0; g.beginPath(); g.moveTo(Math.cos(a) * W * 0.465, Math.sin(a) * W * 0.465); g.lineTo(Math.cos(a) * W * (big ? 0.445 : 0.455), Math.sin(a) * W * (big ? 0.445 : 0.455)); g.strokeStyle = rgb(big ? cur[1] : cur[0], big ? 0.55 : 0.3); g.lineWidth = big ? 2.4 : 1.4; g.stroke(); }
      g.restore();
      g.save(); g.translate(C, C); g.rotate(-spin * 1.6 - t * 0.12); g.lineCap = 'round';
      [[0.1, 1.1], [1.9, 2.5], [3.6, 5.0]].forEach(([a0, a1], k) => { g.beginPath(); g.arc(0, 0, W * (0.425 - k * 0.012), a0 + k, a1 + k * 0.6); g.strokeStyle = rgb(GOLD, 0.95 - k * 0.2); g.lineWidth = 5 - k; g.shadowColor = rgb(GOLD, 0.8); g.shadowBlur = 14; g.stroke(); });
      g.restore(); g.shadowBlur = 0;
      g.beginPath(); g.arc(C, C, W * 0.385, 0, Math.PI * 2); g.strokeStyle = rgb(cur[0], 0.45); g.lineWidth = 2; g.stroke();
      g.save(); g.translate(C, C); g.rotate(spin * 2.2 + t * 0.35); g.beginPath(); g.arc(0, 0, W * 0.385, 0, Math.PI * 0.45); g.strokeStyle = rgb(cur[1], 0.95); g.lineWidth = 4; g.lineCap = 'round'; g.shadowColor = rgb(cur[0], 1); g.shadowBlur = 16; g.stroke(); g.restore(); g.shadowBlur = 0;
      const r0 = W * 0.285;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        const n = (Math.sin(i * 0.9 + t * 3.1) + Math.sin(i * 2.3 - t * 2.2) + Math.sin(i * 0.37 + t * 1.1) + 3) / 6;
        const len = W * (0.012 + n * (0.01 + lv * 0.085));
        g.beginPath(); g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0); g.lineTo(C + Math.cos(a) * (r0 + len), C + Math.sin(a) * (r0 + len));
        g.strokeStyle = rgb(mix(cur[0], cur[1], (Math.sin(a * 2 + t) + 1) / 2), 0.9); g.lineWidth = W * 0.0065; g.lineCap = 'round'; g.stroke();
      }
      const R = W * 0.255 * (1 + lv * 0.03);
      const core = g.createRadialGradient(C, C - R * 0.3, R * 0.1, C, C, R);
      core.addColorStop(0, '#0f3a82'); core.addColorStop(0.65, '#0a2559'); core.addColorStop(1, '#061a3f');
      g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fillStyle = core; g.shadowColor = rgb(cur[0], 0.9); g.shadowBlur = 28 + lv * 40; g.fill(); g.shadowBlur = 0;
      g.lineWidth = 3; g.strokeStyle = rgb(cur[1], 0.85); g.stroke();
      g.beginPath(); g.arc(C, C, R * 0.88, 0, Math.PI * 2); g.strokeStyle = rgb(cur[0], 0.35); g.lineWidth = 1.5; g.stroke();
      g.font = `700 ${Math.round(R * 1.15)}px "Helvetica Neue", Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = rgb(GOLD, 0.85); g.shadowBlur = 18 + lv * 36; g.fillStyle = H.state === 'thinking' ? `rgba(255,210,31,${0.65 + 0.35 * Math.sin(t * 6)})` : '#ffd21f'; g.fillText('J', C, C + R * 0.06); g.shadowBlur = 0;
    };
    const frame = (ts) => {
      H.raf = 0; if (!canvas.isConnected || document.hidden) return; // page quittée ou fenêtre masquée : plus aucun calcul
      const dt = prev ? Math.min(0.05, (ts - prev) / 1000) : 0.016; prev = ts; draw(dt); H.raf = requestAnimationFrame(frame);
    };
    H.orbResume = () => { if (!H.raf && canvas.isConnected && !document.hidden) { prev = 0; H.raf = requestAnimationFrame(frame); } };
    H.orbResume();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && H.orbResume) H.orbResume(); });

  // ---------- États (repos / écoute / réflexion / parole) ----------
  const STATUS = { idle: '', listening: 'Je vous écoute…  (touchez pour terminer)', thinking: 'Je réfléchis…', speaking: 'Je parle…  (touchez pour m’interrompre)' };
  const ORB_LABEL = { idle: 'Parler à Jarvis', listening: 'Terminer l’écoute', thinking: 'Jarvis réfléchit', speaking: 'Interrompre Jarvis' };
  const MIC_LABEL = { idle: '🎤 Parler à Jarvis', listening: '⏹ Terminer', thinking: '… Je réfléchis', speaking: '⏹ Interrompre' };
  const setState = (s, status) => {
    H.state = s; const root = $('jv'); if (root) root.dataset.state = s;
    const el = $('jvStatus'); if (el) el.textContent = status !== undefined ? status : STATUS[s] || '';
    const o = $('orbBtn'); if (o) { o.dataset.state = s; o.setAttribute('aria-label', ORB_LABEL[s] || ORB_LABEL.idle); o.setAttribute('aria-pressed', String(s === 'listening')); }
    const m = $('jvMic'); if (m) { m.textContent = MIC_LABEL[s] || MIC_LABEL.idle; m.setAttribute('aria-pressed', String(s === 'listening')); m.disabled = s === 'thinking'; }
  };
  // Message d'erreur / d'aide, annoncé aux lecteurs d'écran, avec un bouton d'action facultatif.
  const notice = (msg, act, label) => {
    const n = $('jvNotice'); if (!n) return;
    if (!msg) { n.innerHTML = ''; n.hidden = true; return; }
    n.hidden = false; n.innerHTML = `<span>${J.esc(msg)}</span>` + (act ? `<button class="sm" data-act="${act}">${J.esc(label)}</button>` : '');
  };

  // ---------- Parole ----------
  const say = async (text) => {
    if (!text || store.get('muted', false)) { await wait(250); return; }
    const rel = H.stream && !H.stream.closed ? H.stream.hold() : null; // pas d'écho : le micro ignore ma propre voix
    setState('speaking'); try { await J.speak(text); } finally { if (rel) rel(); if (H.state === 'speaking') setState('idle'); }
  };

  // ---------- Affichage ----------
  const CHIP = { mails: ['✉', 'Check mes mails'], veille: ['◎', 'Faire une veille'], redaction: ['✎', 'Rédiger une question'], briefing: ['☀', 'Briefing du jour'], agenda: ['▦', 'Mon agenda'], recherche: ['⌕', 'Recherche'], documents: ['▤', 'Mes documents'], dossiers: ['▣', 'Mes dossiers'] };
  function renderAbilities(g, animate) {
    const ul = $('jvCan'), ch = $('jvChips'); if (!ul || !ch) return;
    if (!g.ready) { ul.innerHTML = ''; ch.innerHTML = `<button class="in" data-act="jvSetup"><i>⚙</i>Configurer mon moteur d’IA</button>`; return; }
    ul.innerHTML = `<li class="${animate ? '' : 'in'}">Je peux <b>checker vos mails</b></li><li class="${animate ? '' : 'in'}">Je peux <b>faire une veille sur un sujet</b></li><li class="soft ${animate ? '' : 'in'}">…et bien d’autres choses : courrier, agenda, documents, dossiers, mémoire.</li>`;
    ch.innerHTML = g.abilities.map((a) => `<button class="${animate ? '' : 'in'}" data-act="jvAbility" data-id="${a.id}"><i>${(CHIP[a.id] || ['•'])[0]}</i>${J.esc((CHIP[a.id] || [0, a.label])[1])}</button>`).join('');
    if (animate) { [...ul.children].forEach((li, i) => setTimeout(() => li.classList.add('in'), i * 900)); [...ch.children].forEach((b, i) => setTimeout(() => b.classList.add('in'), 2000 + i * 140)); }
  }
  const scrollDown = () => { const s = $('jvStage'); if (s) requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; }); };
  // Historique de la conversation (bulles) : l'utilisateur à droite, Jarvis à gauche.
  function addMsg(role, text, extra) {
    const log = $('jvLog'); if (!log) return null;
    const d = document.createElement('div'); d.className = 'jv-msg ' + role + (extra ? ' ' + extra : '');
    if (extra === 'wait') d.innerHTML = '<i></i><i></i><i></i>'; else d.textContent = text;
    log.appendChild(d); while (log.children.length > 40) log.firstChild.remove(); scrollDown(); return d;
  }
  function showOut(res) {
    const out = $('jvOut'); if (!out) return;
    const parts = [];
    if (res.md) parts.push(`<div class="jv-card"><div class="row sp"><b>${J.esc(titleFor(res.intent))}</b><span class="row">${res.readAloud ? `<button class="sm" data-act="jvRead">🔊 Lire le texte</button>` : ''}<button class="sm ghost" data-act="jvCopy">Copier</button></span></div><div id="jvMd">${J.md(res.md)}</div></div>`);
    if (res.triage && J.mbSectionsHtml) parts.push(`<div class="jv-card jv-tri">${J.mbSectionsHtml(res.triage)}</div>`);
    else if (res.messages && res.messages.length && !res.replyTo) {
      H.mails = res.messages;
      parts.push(`<div class="jv-card"><div class="row sp"><b>${res.messages.length} message${res.messages.length > 1 ? 's' : ''}</b><span class="row"><button class="sm" data-act="jvMailAll">🔊 Lire tous</button><button class="sm ghost" data-act="jvMailStop" aria-label="Arrêter la lecture">⏹</button></span></div>` + res.messages.map((m, i) => `<div class="jv-mail" id="jm${i}"><div class="grow"><b>${J.esc(m.subject)}</b>${m.unread ? ' <span class="pill gold">non lu</span>' : ''}<div class="muted small">${J.esc(J.nameOf(m.from))} · ${J.esc(m.date ? J.fmtDate(m.date) : '')}</div><div class="small">${J.esc((m.text || '').replace(/\s+/g, ' ').slice(0, 140))}…</div></div><span class="row"><button class="sm" data-act="jvMailRead" data-i="${i}">🔊 Lire</button><button class="sm" data-act="jvMailShow" data-i="${i}">👁 Afficher</button><button class="sm pri" data-act="jvMailReply" data-i="${i}">↩ Répondre</button></span></div>`).join('') + '</div>');
    }
    const btns = [];
    if (res.link) btns.push(`<button class="pri sm" data-act="jvGo" data-page="${res.link.page}">${J.esc(res.link.label)} →</button>`);
    if (res.file) btns.push(`<button class="sm" data-act="jvFile" data-p="${J.esc(res.file)}">Afficher le fichier</button>`);
    (res.suggest || []).forEach((s) => btns.push(`<button class="sm chip" data-act="jvSay" data-t="${J.esc(s)}">${J.esc(s)}</button>`));
    if (btns.length) parts.push(`<div class="jv-actions">${btns.join('')}</div>`);
    out.innerHTML = parts.join('');
    H.last = res; scrollDown();
  }
  const titleFor = (i) => ({ mails: 'Vos courriels', veille_topic: 'Veille', veille_run: 'Veille', recherche: 'Recherche', redaction: 'Brouillon', briefing: 'Briefing du jour', agenda: 'Agenda', dossiers: 'Dossiers', documents: 'Dans vos documents', remember: 'Mémoire', help: 'Ce que je sais faire' }[i] || 'Réponse');
  const compact = () => { const r = $('jv'); if (r) r.classList.add('compact'); };
  const resetConversation = () => { J.state.jh = []; H.last = null; H.pending = null; H.mails = []; const l = $('jvLog'); if (l) l.innerHTML = ''; const o = $('jvOut'); if (o) o.innerHTML = ''; };

  // ---------- Un tour de conversation ----------
  async function turn(text, opts = {}) {
    const heard = opts.voice ? (J.cleanHeard(text) || text) : String(text).trim();
    if (!heard) return null;
    const id = ++H.turnId; H.busy = true; notice('');
    compact(); $('jvOut').innerHTML = ''; addMsg('me', heard); const wait$ = addMsg('bot', '', 'wait');
    setState('thinking');
    let res;
    try {
      res = await Promise.race([J.call('jarvis.command', { text: heard, history: J.state.jh.slice(-8), pending: H.pending }), new Promise((_r, rej) => setTimeout(() => rej(new Error('Le moteur met trop de temps à répondre.')), 150000))]);
    } catch (e) { res = { ok: false, say: 'Je n’ai pas pu terminer : ' + e.message }; }
    if (wait$) wait$.remove();
    if (id !== H.turnId || !onPage()) { H.busy = false; return null; } // interrompu par l'utilisateur ou page quittée
    H.busy = false; H.pending = res.confirm || null;
    if (res.settingsChanged || res.refreshParlement) { try { await J.refreshMeta(); if (res.refreshParlement) { if (J.drawChrome) J.drawChrome(); const pb = document.querySelector('.jv-parl b'); if (pb) pb.textContent = J.parlName(J.P.actif); } } catch { /* ok */ } }
    if (res.stop) { halt(); setState('idle', 'Je me tais. Touchez l’orbe (ou Espace) pour me parler.'); return res; }
    if (res.newConversation) resetConversation();
    if (res.readLast) {
      const txt = H.last && (H.last.readAloud || H.last.md);
      setState('idle', ''); await say(txt ? J.plain(txt) : 'Je n’ai rien à lire pour le moment.'); return res;
    }
    if (!res.repeat && !res.newConversation) J.state.jh.push({ role: 'user', content: heard }, { role: 'assistant', content: res.say || '' });
    J.state.jh = J.state.jh.slice(-40);
    if (res.say) addMsg(res.ok === false ? 'bot err' : 'bot', res.say);
    if (!res.repeat) showOut(res);
    setState('idle', '');
    if (res.say) await say(res.say);
    if (res.readAll && onPage()) await J.readMails(res.messages, (i) => { J.$$('.jv-mail').forEach((c) => c.classList.toggle('reading', c.id === 'jm' + i)); });
    if (res.replyTo && onPage()) { res.end = true; await J.mailReply(res.replyTo, res.replyInstruction); }
    if (res.navigate && onPage()) J.go(res.navigate);
    return res;
  }

  // ---------- Micro : réveil par « Hé Jarvis », puis conversation ----------
  // Mot de réveil : « Hé Jarvis », « Hey Jarvis », « Ok Jarvis », « Salut Jarvis », « Jarvis »… suivi (ou non) de la demande dans la même phrase.
  const WAKE_PRE = '(?:h[eéè]+|hey|hé|eh|et|ok|okay|salut|alors|dis|dites|bonjour|bonsoir|all?[oô]|oh|ah)';
  const WAKE_RX = new RegExp('^\\s*(?:' + WAKE_PRE + '[\\s,.!?-]+){0,2}(?:jarvis|jar\\s?vis|jarvisse|jarvice|jarviss|djarvis|charvis|yarvis|garvis|jervis)\\b[\\s,.:;!?-]*', 'i');
  J.wakeSplit = (text) => { const t = String(text || ''); const m = WAKE_RX.exec(t); return m ? { woke: true, rest: t.slice(m[0].length).trim() } : { woke: false, rest: t.trim() }; };
  const micPill = () => {
    const b = $('jvMicMode'); if (!b) return;
    const on = !!H.micOn; b.setAttribute('aria-pressed', String(on)); b.dataset.on = on ? '1' : '0';
    b.innerHTML = on ? `<i class="dot"></i> Micro activé · dites « Hé Jarvis »<span class="jv-meter" aria-hidden="true"><b id="jvMeter"></b></span>` : '<i class="dot"></i> Micro coupé · touchez pour l’activer';
    b.title = on ? 'Couper le micro' : 'Activer le micro : Jarvis vous écoute et se réveille quand vous dites « Hé Jarvis »';
  };
  const heard = (t, kind) => { const h = $('jvHeard'); if (!h) return; h.textContent = t ? (kind === 'ignored' ? `Entendu : « ${t} » — dites « Hé Jarvis » pour me réveiller` : `Entendu : « ${t} »`) : ''; h.dataset.kind = kind || ''; };
  const micError = (e) => {
    const hint = { MIC: ['Micro refusé : autorisez Jarvis Parlement dans Réglages Système › Confidentialité et sécurité › Microphone, puis touchez le bouton du micro.', 'openMic', 'Ouvrir les réglages'], NOMIC: [e.message, 'openSound', 'Réglages du son'], BUSY: [e.message, null, null] }[e.code];
    setState('idle', ''); notice(hint ? hint[0] : (e.message || 'Le micro est inaccessible.'), hint && hint[1], hint && hint[2]); return null;
  };
  // ---- Micro ouvert en continu : le flux ne se ferme jamais pendant la transcription ; les phrases détectées sont traitées une par une ----
  const ACTIVE_MS = 12000;                  // après « Hé Jarvis » ou une réponse : je reste à l'écoute 12 s sans mot de réveil
  const isActive = () => Date.now() < (H.activeUntil || 0);
  const idleStatus = () => (H.stream && !H.stream.closed ? (isActive() ? 'Je vous écoute…' : 'Micro actif : dites « Hé Jarvis »') : '');
  const closeStream = () => { if (H.dog) { clearInterval(H.dog); H.dog = 0; } if (H.stream) { try { H.stream.stop(); } catch { /* ok */ } H.stream = null; } H.activeUntil = 0; H.level = 0; const m = $('jvMeter'); if (m) m.style.width = '0'; };
  async function openStream() {
    if (H.stream && !H.stream.closed) return H.stream;
    if (H.opening) return H.opening;
    if (!J.S._env.sttReady) { setState('idle', ''); notice('La reconnaissance vocale n’est pas disponible sur ce Mac. Écrivez votre demande ci-dessous.', 'jvSetup', 'Ouvrir les réglages'); return null; }
    H.opening = (async () => {
      try {
        const st = await J.listenStream({
          onSegment: (seg) => { H.q = (H.q || Promise.resolve()).then(() => handleSegment(seg)).catch((e) => console.error('[micro] segment', e)); },
          onLevel: (v) => { H.level = v; const m = $('jvMeter'); if (m) m.style.width = Math.min(100, Math.round(v * 1100)) + '%'; },
          onSpeechStart: () => { if (!H.busy && H.state !== 'speaking' && H.state !== 'thinking') setState('listening', isActive() ? 'Je vous écoute…' : 'Je vous entends…'); },
        });
        H.stream = st; notice(''); H.deaf = 0; setState('idle', idleStatus());
        // Surveillance : état affiché, retour en veille après la fenêtre active, avertissement si aucun son n'arrive du micro.
        H.dog = setInterval(() => {
          if (!onPage() || !H.stream) return closeStream();
          if (H.stream.closed) { closeStream(); if (onPage()) { setState('idle', ''); notice('Le micro s’est déconnecté. Vérifiez-le puis touchez le bouton du micro.'); } return; }
          if (H.state === 'idle') { const want = idleStatus(); const el = $('jvStatus'); if (el && el.textContent !== want) setState('idle', want); }
          if (!H.micOn && !isActive() && !H.busy && H.state !== 'speaking') { closeStream(); setState('idle', 'Touchez l’orbe, appuyez sur Espace ou activez le micro pour me parler.'); return; }
          const quiet = performance.now() - H.stream.info.lastSoundAt;
          if (quiet > 15000 && H.stream.info.maxRms < 0.002) { H.deaf = 1; notice('Je n’entends aucun son venant du micro. Vérifiez qu’il n’est pas coupé et choisissez le bon micro dans Réglages Système › Son › Entrée.', 'openSound', 'Réglages du son'); }
          else if (H.deaf && H.stream.info.maxRms >= 0.002) { H.deaf = 0; notice(''); }
        }, 1000);
        return st;
      } catch (e) { micError(e); return null; }
      finally { H.opening = null; }
    })();
    return H.opening;
  }
  // Une phrase captée : transcription locale, puis réveil / commande. La capture est suspendue pendant le traitement et la réponse (pas d'écho).
  async function handleSegment(seg) {
    if (!H.stream || H.stream.closed || !onPage()) return;
    const release = H.stream.hold(); const wake = !isActive();
    console.log('[micro]', wake ? 'réveil' : 'actif', 'phrase', seg.ms + ' ms', 'pic=' + seg.peak.toFixed(3));
    try {
      setState('thinking', 'Je transcris…');
      const out = await J.call('voice.transcribe', { audio: seg.wav, mime: 'audio/wav', offline: wake });
      const text = J.cleanHeard(String(out.text || '').trim());
      console.log('[micro] transcrit (' + (out.mode || '?') + ') :', JSON.stringify(out.text), '→', JSON.stringify(text));
      if (!text) { setState('idle', idleStatus()); return; }
      const w = J.wakeSplit(text); let cmd = text;
      if (wake) {
        if (!w.woke) { heard(text, 'ignored'); setState('idle', idleStatus()); return; }       // pas le mot de réveil : ignoré (traité localement, rien n'est envoyé)
        cmd = w.rest; heard(text); H.activeUntil = Date.now() + ACTIVE_MS;
        if (!cmd) { await say('Oui ?'); H.activeUntil = Date.now() + ACTIVE_MS; setState('idle', idleStatus()); return; }
      } else if (w.woke) {
        cmd = w.rest; if (!cmd) { await say('Oui ?'); H.activeUntil = Date.now() + ACTIVE_MS; setState('idle', idleStatus()); return; }
      }
      heard(cmd); H.activeUntil = Date.now() + 120000; // pendant le traitement, la fenêtre reste ouverte
      const res = await turn(cmd, { voice: true });
      H.activeUntil = res && !res.end && store.get('converse', true) ? Date.now() + ACTIVE_MS : 0;
    } catch (e) {
      const msg = String(e.message || e); H.activeUntil = 0;
      if (/Reconnaissance vocale refusée/.test(msg)) { setState('idle', ''); notice(msg, 'openSpeech', 'Ouvrir les réglages'); }
      else if (/hors-ligne/.test(msg)) { setState('idle', ''); notice(msg + ' Vous pouvez toujours toucher l’orbe pour me parler.', 'openSpeech', 'Ouvrir les réglages'); H.micOn = false; store.set('micOn', false); micPill(); }
      else { setState('idle', ''); notice('Je n’ai pas pu transcrire : ' + msg + ' Vous pouvez aussi écrire votre demande ci-dessous.'); }
    } finally { release(); if (onPage() && H.state !== 'speaking' && H.state !== 'thinking') setState('idle', idleStatus()); }
  }
  const startWatch = () => { if (H.micOn && onPage() && J.S._env.sttReady) openStream(); };
  // Appui sur l'orbe / Espace : j'écoute tout de suite (sans mot de réveil) pendant 12 s ; un second appui referme la fenêtre.
  async function pushToTalk() {
    if (isActive() && H.stream && !H.busy) { H.activeUntil = 0; setState('idle', idleStatus()); return; }
    const st = await openStream(); if (!st) return; H.activeUntil = Date.now() + ACTIVE_MS; setState('idle', 'Je vous écoute…'); notice('');
  }
  const conversation = pushToTalk;

  // Arrêt immédiat : voix, lecture des mails, écoute, tour en cours.
  const halt = () => { J.stopReading(); H.token++; H.turnId++; H.busy = false; H.activeUntil = 0; J.stopSpeak(); H.level = 0; H.state = 'idle'; };
  const stopAll = () => { halt(); const w = document.querySelector('#jvLog .wait'); if (w) w.remove(); J.$$('.jv-mail').forEach((c) => c.classList.remove('reading')); if (onPage()) setState('idle', ''); };
  const onKey = (e) => {
    if (!onPage()) return;
    const el = document.activeElement; const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if (document.querySelector('#modal-root .modal')) return;
    if (e.key === 'Escape') { if (J.speaking || isActive() || H.state !== 'idle') { e.preventDefault(); stopAll(); } else if (typing) el.blur(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || (el && /^(BUTTON|A)$/.test(el.tagName))) return;
    if (e.key === ' ') { e.preventDefault(); J.act.jvOrb(); } else if (e.key === '/') { e.preventDefault(); const i = $('jvIn'); if (i) i.focus(); }
  };
  document.addEventListener('keydown', onKey);
  J.leave = () => { halt(); closeStream(); stopOrb(); const m = $('main'); if (m) m.classList.remove('jv-main'); };

  // ---------- Page ----------
  J.pages.accueil = async (root) => {
    halt(); H.empties = 0; $('main').classList.add('jv-main');
    const g = await J.call('jarvis.greeting'); const first = !J.state.greeted; const muted = store.get('muted', false);
    const nom = g.nom; const hasHist = J.state.jh.length > 0; const comp = !first && hasHist;
    root.innerHTML = `<section id="jv" class="jv${comp ? ' compact' : ''}" data-state="idle" aria-label="Conversation avec Jarvis">
      <div class="jv-top"><span class="jv-parl">Parlement actif : <b>${J.esc(J.parlName(J.P.actif))}</b></span><span class="row"><button class="jv-link" data-act="jvNew" title="Effacer la conversation et repartir de zéro">Nouvelle conversation</button><a class="jv-link" href="#tableau">Tableau de bord</a><button class="jv-ico" id="jvMute" data-act="jvMute" aria-pressed="${muted}" aria-label="${muted ? 'Activer la voix de Jarvis' : 'Couper la voix de Jarvis'}" title="Couper ou activer la voix de Jarvis">${muted ? '🔇' : '🔊'}</button></span></div>
      <div class="jv-hero">
        <div class="jv-eyebrow">VOTRE ASSISTANT PARLEMENTAIRE</div>
        <button class="orb-btn" id="orbBtn" data-act="jvOrb" data-state="idle" aria-label="Parler à Jarvis" aria-pressed="false" aria-keyshortcuts="Space"><canvas id="orb" width="800" height="800" aria-hidden="true"></canvas></button>
        <div class="jv-hello" id="jvHello" aria-live="polite">
          <div class="h1" id="jh1">Bonjour</div>
          ${nom ? `<div class="h2" id="jh2">${J.esc(nom)}</div>` : ''}
          <div class="h3" id="jh3">Que puis-je faire pour vous aujourd’hui ?</div>
        </div>
      </div>
      <div class="jv-stage" id="jvStage" tabindex="-1">
        ${J.S._env.piperReady || store.get('voiceLater', false) ? '' : `<div class="jv-voice" id="jvVoice" role="region" aria-label="Voix humaine"><span>🎙 Pour une <b>vraie voix humaine</b> (gratuite, hors-ligne, ≈ 21 Mo), choisissez la mienne :</span><span class="row"><button data-act="jvVoiceInstall" data-id="siwis">Voix de femme</button><button data-act="jvVoiceInstall" data-id="tom">Voix d’homme</button><button class="ghost" data-act="jvVoiceLater">Plus tard</button></span><span class="small" id="progress"></span></div>`}
        <ul class="jv-lines" id="jvCan"></ul>
        <div class="jv-chips" id="jvChips"></div>
        <div class="jv-log" id="jvLog" role="log" aria-live="polite" aria-label="Conversation"></div>
        <div id="jvOut" class="jv-out"></div>
      </div>
      <div class="jv-dock"><button class="jv-micmode" id="jvMicMode" data-act="jvMicToggle" aria-pressed="false"></button><div class="jv-status" id="jvStatus" role="status" aria-live="polite"></div><div class="jv-heard" id="jvHeard" aria-live="off"></div><div class="jv-notice" id="jvNotice" role="alert" hidden></div></div>
      <div class="jv-bar">
        <button class="jv-mic" id="jvMic" data-act="jvOrb" aria-pressed="false" aria-keyshortcuts="Space" title="Parler (Espace) — touchez à nouveau pour terminer">🎤 Parler à Jarvis</button>
        <input id="jvIn" aria-label="Votre demande à Jarvis" placeholder="Dites-moi : « Fais une veille sur le logement à Bruxelles »…" autocomplete="off">
        <button class="pri" data-act="jvSend">Envoyer</button>
      </div>
      <div class="jv-foot"><label class="jv-conv"><input type="checkbox" id="jvConv" ${store.get('converse', true) ? 'checked' : ''}> Conversation continue (j’écoute à nouveau après chaque réponse)</label><span class="jv-keys">Espace : parler · Échap : arrêter · / : écrire</span></div>
    </section>`;
    J.state.jh.forEach((m) => { if (m.content) addMsg(m.role === 'user' ? 'me' : 'bot', m.content); });
    H.micOn = store.get('micOn', false); startOrb($('orb')); setState('idle'); micPill();
    $('jvIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') J.act.jvSend(); });
    $('jvConv').addEventListener('change', (e) => store.set('converse', e.target.checked));

    if (!first) { ['jh1', 'jh2', 'jh3'].forEach((id) => $(id)?.classList.add('in')); renderAbilities(g, false); startWatch(); return; }
    // Première arrivée : salutation parlée, lignes qui apparaissent au rythme de la voix.
    J.state.greeted = true;
    const lines = [$('jh1'), $('jh2'), $('jh3')].filter(Boolean);
    const speak = !muted; const speech = g.intro + ' ' + g.offer;
    const per = speak ? 80 : 0;
    lines[0].classList.add('in');
    if (lines[1]) setTimeout(() => lines[1] && onPage() && lines[1].classList.add('in'), 700 + per * 2);
    setTimeout(() => onPage() && $('jh3') && $('jh3').classList.add('in'), 1500 + per * (nom.length / 2 + 4));
    const introMs = speak ? Math.max(3500, g.intro.length * 68) : 2400;
    setTimeout(() => onPage() && renderAbilities(g, true), introMs);
    const my = H.token;
    await wait(500);
    if (H.token !== my || !onPage()) return;
    if (speak) { setState('speaking'); await say(speech); }
    else await wait(2500);
    if (H.token === my && onPage() && g.ready) { if (H.micOn) startWatch(); else if (J.S._env.sttReady) notice('Touchez le bouton « Micro » pour que je vous écoute, puis dites « Hé Jarvis ».'); }
  };

  // ---------- Actions ----------
  J.act.jvOrb = () => {
    if (H.state === 'thinking') { stopAll(); notice('Demande annulée.'); return; }
    if (J.speaking || H.state === 'speaking') { stopAll(); return; }   // un clic coupe la voix immédiatement
    notice(''); pushToTalk();
  };
  J.act.jvSend = async () => {
    const i = $('jvIn'); const t = i.value.trim(); if (!t) return;
    if (H.busy) { J.toast('Je réfléchis encore à votre demande précédente…'); return; }
    i.value = ''; halt(); await turn(t);
  };
  J.act.jvSay = (el) => { $('jvIn').value = el.dataset.t; J.act.jvSend(); };
  J.act.jvNew = () => { stopAll(); resetConversation(); notice(''); const r = $('jv'); if (r) r.classList.remove('compact'); J.call('jarvis.command', { text: 'nouvelle conversation' }).catch(() => {}); };
  J.act.jvMicToggle = async () => {
    H.micOn = !H.micOn; store.set('micOn', H.micOn); micPill(); notice(''); heard('');
    if (H.micOn) { const st = await openStream(); if (!st) { H.micOn = false; store.set('micOn', false); micPill(); } }
    else if (!isActive() && !H.busy) { closeStream(); setState('idle', ''); }
  };
  J.act.openSpeech = () => J.call('voice.openSpeechSettings').catch(() => {});
  J.act.openSound = () => J.call('app.openExternal', { url: 'x-apple.systempreferences:com.apple.Sound-Settings.extension' }).catch(() => {});
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
    try { await J.call('voice.install', { voiceId: el.dataset.id }); await J.refreshMeta(); box.innerHTML = '<span>✓ Voix installée. Elle sera utilisée par défaut — vous pouvez en changer dans Réglages › Voix.</span>'; setTimeout(() => box.remove(), 6000); await say('Bonjour, voici ma voix. Que puis-je faire pour vous ?'); }
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
  J.act.jvRead = () => { if (J.speaking) { J.stopSpeak(); setState('idle'); } else say(J.plain(H.last?.readAloud || H.last?.md || '')); };
  J.act.jvMute = (el) => { const m = !store.get('muted', false); store.set('muted', m); el.textContent = m ? '🔇' : '🔊'; el.setAttribute('aria-pressed', String(m)); el.setAttribute('aria-label', m ? 'Activer la voix de Jarvis' : 'Couper la voix de Jarvis'); if (m) J.stopSpeak(); };
})();
