// Utilitaires d'interface partagés. Espace de noms global : J
const J = window.J = { pages: {}, act: {}, state: {}, S: null, P: null };

J.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
J.call = (m, a) => window.jarvis.call(m, a || {});
J.$ = (sel, root = document) => root.querySelector(sel);
J.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
J.val = (id) => { const e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : undefined; };
J.fmtDate = (iso) => iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
J.fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' }) : '';

// Markdown minimal et sûr (échappement d'abord, liens http(s) uniquement).
J.md = (src) => {
  const inline = (t) => J.esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" data-ext="1">$1</a>')
    .replace(/(^|[\s(>])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" data-ext="1">$2</a>');
  const lines = String(src || '').replace(/\r/g, '').split('\n'); const out = []; let list = null, code = false, tbl = [];
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushT = () => { if (!tbl.length) return; const rows = tbl.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    out.push('<table>' + rows.map((r, i) => '<tr>' + r.map((c) => `<${i ? 'td' : 'th'}>${inline(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>'); tbl = []; };
  for (const l of lines) {
    if (/^```/.test(l)) { close(); out.push(code ? '</pre>' : '<pre>'); code = !code; continue; }
    if (code) { out.push(J.esc(l)); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) { close(); tbl.push(l); continue; } else flushT();
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (/^---+$/.test(l.trim())) { close(); out.push('<hr>'); }
    else if (!l.trim()) close();
    else { close(); out.push(`<p>${inline(l)}</p>`); }
  }
  flushT(); close(); if (code) out.push('</pre>');
  return `<div class="md">${out.join('\n')}</div>`;
};

J.toast = (msg, type = '') => {
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  document.getElementById('toasts').appendChild(el); setTimeout(() => el.remove(), type === 'err' ? 7000 : 3500);
};
J.err = (e) => { console.error(e); J.toast(e.message || String(e), 'err'); };

// Exécute fn() en désactivant le bouton avec un indicateur de chargement.
J.busy = async (btn, fn, label) => {
  const old = btn ? btn.innerHTML : ''; if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label || 'En cours…'}`; }
  try { return await fn(); } catch (e) { J.err(e); } finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
};

J.modal = (html, onMount) => {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="back"><div class="modal">${html}</div></div>`;
  root.querySelector('.back').addEventListener('mousedown', (e) => { if (e.target.classList.contains('back')) J.closeModal(); });
  if (onMount) onMount(root.querySelector('.modal'));
};
J.closeModal = () => { document.getElementById('modal-root').innerHTML = ''; };

// Listes de parlements / instruments
J.parlName = (id) => { const p = J.P?.parlements.find((x) => x.id === id); return p ? p.nom : (id || '—'); };
J.parlOptions = (sel, onlyActive = true) => (J.P?.parlements || []).filter((p) => !onlyActive || J.P.actifs.includes(p.id)).map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${J.esc(p.nom)}</option>`).join('');
J.instrOptions = (parlId, sel) => {
  const p = J.P?.parlements.find((x) => x.id === parlId);
  const customs = (J.P?.custom || []).filter((c) => (c.parlementId === 'custom'));
  return (p ? p.instruments : []).map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${J.esc(i.label)}</option>`).join('') + (customs.length ? '<optgroup label="Mes modèles">' + customs.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${J.esc(c.label)}</option>`).join('') + '</optgroup>' : '');
};
// Lie un <select> parlement à un <select> instrument
J.bindParl = (parlId, instrId, selInstr) => {
  const p = document.getElementById(parlId), i = document.getElementById(instrId); if (!p || !i) return;
  const fill = (s) => { i.innerHTML = J.instrOptions(p.value, s); };
  fill(selInstr); p.addEventListener('change', () => fill());
};

J.refreshMeta = async () => { J.S = await J.call('settings.get'); J.P = await J.call('parlements.list'); };

J.download = async (text, name) => { const p = await J.call('app.saveText', { text, name }); if (p) J.toast('Enregistré : ' + p, 'ok'); };
J.copy = async (text) => { try { await navigator.clipboard.writeText(text); J.toast('Copié', 'ok'); } catch { J.toast('Copie impossible', 'err'); } };

// Délégation d'événements : data-act="nom" appelle J.act[nom](element, event)
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); J.call('app.openExternal', { url: a.href }).catch(J.err); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = J.act[el.dataset.act]; if (!fn) return console.warn('Action inconnue', el.dataset.act);
  try { await fn(el, e); } catch (err) { J.err(err); }
});

J.icons = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>', folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h6"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  brain: '<path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 1V4a3 3 0 00-3 0zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 1"/>',
  chat: '<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', bank: '<path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
};
J.icon = (n) => `<svg viewBox="0 0 24 24">${J.icons[n] || ''}</svg>`;

// ---------- Voix : parler (synthèse macOS) et écouter (micro → Whisper) ----------
J.plain = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[#*_`>|]/g, '').replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ').trim();
J.voices = () => (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => /^fr/i.test(v.lang));
J.chunks = (text) => { const parts = J.plain(text).match(/[^.!?;:]+[.!?;:]?/g) || []; let buf = ''; const out = []; for (const p of parts) { if ((buf + p).length > 220) { if (buf) out.push(buf.trim()); buf = p; } else buf += p; } if (buf.trim()) out.push(buf.trim()); return out; };
let speakToken = 0, curAudio = null;
J.stopSpeak = () => { speakToken++; if (curAudio) { curAudio.pause(); curAudio = null; } if (window.speechSynthesis) speechSynthesis.cancel(); };
const systemSpeak = (chunks) => {
  if (!window.speechSynthesis) return J.toast('Synthèse vocale indisponible', 'err');
  const v = J.S?.voice || {}; const voices = J.voices();
  const voice = voices.find((x) => x.name === v.ttsVoice) || voices.find((x) => /fr-BE/i.test(x.lang)) || voices[0];
  for (const c of chunks) { const u = new SpeechSynthesisUtterance(c); u.lang = voice?.lang || 'fr-FR'; if (voice) u.voice = voice; u.rate = Number(v.ttsRate) || 1; speechSynthesis.speak(u); }
};
const playWav = (b64, token) => new Promise((res) => { if (token !== speakToken) return res(); const a = new Audio('data:audio/wav;base64,' + b64); curAudio = a; a.onended = a.onerror = () => res(); a.play().catch(() => res()); });
// Parler : voix Piper (open source, hors-ligne) si installée, sinon voix macOS.
J.speak = async (text) => {
  J.stopSpeak(); const my = speakToken; const chunks = J.chunks(text); if (!chunks.length) return;
  if ((J.S?.voice?.engine) === 'piper') {
    try {
      let next = J.call('voice.synth', { text: chunks[0] });
      for (let i = 0; i < chunks.length; i++) { const wav = await next; if (my !== speakToken) return; next = i + 1 < chunks.length ? J.call('voice.synth', { text: chunks[i + 1] }) : null; if (next) next.catch(() => {}); await playWav(wav, my); }
      return;
    } catch (e) { J.toast('Voix Piper indisponible, voix système utilisée : ' + e.message, 'err'); }
  }
  systemSpeak(chunks);
};
J.act.speakEl = (el) => { const t = document.querySelector(el.dataset.sel); J.speak(t ? (t.value ?? t.innerText) : ''); };
J.act.speakStop = () => J.stopSpeak();
J.speakBtn = (sel) => `<button class="sm" data-act="speakEl" data-sel="${sel}" title="Lire à voix haute">🔊 Écouter</button><button class="sm ghost" data-act="speakStop" title="Arrêter la lecture">⏹</button>`;
J.micBtn = (target) => `<button class="sm" data-act="mic" data-target="${target}" title="Dicter">🎤 Dicter</button>`;

let rec = null;
J.act.mic = async (el) => {
  if (rec) { rec.stop(); return; } // 2e clic = arrêter
  if (!J.S._env.sttReady) return J.modal(`<h2>🎤 Dictée</h2><p>La transcription vocale n'est pas encore configurée.</p><p><b>Option rapide :</b> utilise la dictée macOS — place le curseur dans le champ et appuie deux fois sur <b>Fn</b> (à activer dans Réglages Système › Clavier › Dictée).</p><p><b>Option intégrée :</b> configure Whisper (OpenAI ou serveur local) dans <a href="#reglages">Réglages › Voix</a>.</p><div class="row"><button class="pri" data-act="closeModal">OK</button></div>`);
  const st = await J.call('voice.micStatus');
  if (st !== 'granted') return J.modal(`<h2>Micro refusé</h2><p>Autorise Jarvis Parlement dans Réglages Système › Confidentialité › Micro, puis réessaie.</p><div class="row"><button class="pri" data-act="openMic">Ouvrir les réglages</button><button data-act="closeModal">Fermer</button></div>`);
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return J.toast('Micro inaccessible', 'err'); }
  const chunks = []; const old = el.innerHTML;
  const mr = new MediaRecorder(stream); rec = mr;
  el.innerHTML = '⏹ Arrêter'; el.classList.add('pri');
  mr.ondataavailable = (e) => chunks.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); rec = null; el.classList.remove('pri'); el.innerHTML = '<span class="spin"></span> Transcription…'; el.disabled = true;
    try {
      const blob = new Blob(chunks, { type: mr.mimeType }); const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
      const { text } = await J.call('voice.transcribe', { audio: b64, mime: mr.mimeType });
      const t = document.getElementById(el.dataset.target); if (t) { t.value = (t.value ? t.value + ' ' : '') + text; t.dispatchEvent(new Event('input')); }
    } catch (e) { J.err(e); } finally { el.innerHTML = old; el.disabled = false; }
  };
  mr.start(); setTimeout(() => { if (rec === mr) mr.stop(); }, 120000);
};
J.act.openMic = () => J.call('voice.openMicSettings');
window.speechSynthesis && (speechSynthesis.onvoiceschanged = () => {});
