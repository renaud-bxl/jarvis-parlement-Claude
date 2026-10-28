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
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg; el.title = 'Cliquer pour fermer';
  if (type === 'err') el.setAttribute('role', 'alert');
  el.addEventListener('click', () => el.remove());
  const box = document.getElementById('toasts'); box.appendChild(el); while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), type === 'err' ? 8000 : 3800);
};
// Message d'erreur lisible : jamais de « [object Object] » ni de trace technique.
J.errMsg = (e) => { const m = String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']*': (Error: )?/, '').trim(); return m || 'Une erreur est survenue. Réessaie dans un instant.'; };
J.err = (e) => { console.error(e); J.toast(J.errMsg(e), 'err'); };

// Exécute fn() en désactivant le bouton avec un indicateur de chargement.
J.busy = async (btn, fn, label) => {
  if (btn && btn.getAttribute && btn.getAttribute('aria-busy') === 'true') return;
  const old = btn ? btn.innerHTML : ''; const w = btn && btn.offsetWidth;
  if (btn) { if (w) btn.style.minWidth = w + 'px'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = `<span class="spin" aria-hidden="true"></span> ${label || 'En cours…'}`; }
  try { return await fn(); } catch (e) { J.err(e); } finally { if (btn && btn.isConnected !== false) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.style.minWidth = ''; btn.innerHTML = old; } }
};

// Fenêtre modale accessible : rôle dialog, focus piégé, Échap pour fermer, retour du focus.
let modalFrom = null;
J.modal = (html, onMount, opts = {}) => {
  const root = document.getElementById('modal-root');
  if (!root.firstChild) modalFrom = document.activeElement;
  root.innerHTML = `<div class="back"><div class="modal${opts.narrow ? ' narrow' : ''}" role="dialog" aria-modal="true" tabindex="-1">${html}</div></div>`;
  const m = root.querySelector('.modal'); const h = m.querySelector('h2'); if (h) { h.id = 'modal-title'; m.setAttribute('aria-labelledby', 'modal-title'); }
  root.querySelector('.back').addEventListener('mousedown', (e) => { if (e.target.classList.contains('back')) J.closeModal(); });
  if (onMount) onMount(m);
  J.a11y(m);
  const first = m.querySelector('input:not([type=hidden]),select,textarea') || m.querySelector('button.pri,button.gold') || m.querySelector('button'); (first || m).focus();
};
J.closeModal = () => { const r = document.getElementById('modal-root'); r.innerHTML = ''; if (modalFrom && modalFrom.isConnected) modalFrom.focus(); modalFrom = null; };
// Confirmation maison (remplace confirm()) : renvoie une promesse booléenne.
J.confirm = (msg, { ok = 'Confirmer', danger = false, title = 'Confirmer' } = {}) => new Promise((resolve) => {
  J.modal(`<h2>${J.esc(title)}</h2><p>${J.esc(msg)}</p><div class="row" style="margin-top:16px;justify-content:flex-end"><button data-cf="0">Annuler</button><button class="${danger ? 'danger' : 'pri'}" data-cf="1">${J.esc(ok)}</button></div>`, (m) => {
    m.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => { J.closeModal(); resolve(b.dataset.cf === '1'); }));
    m.closest('.back').addEventListener('mousedown', (e) => { if (e.target.classList.contains('back')) resolve(false); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') resolve(false); });
  }, { narrow: true });
  document.querySelector('#modal-root [data-cf="0"]')?.focus();
});
// Saisie courte maison (remplace prompt(), non supporté par Electron) : renvoie le texte, ou null si annulé.
J.ask = (msg, { title = 'Ton avis', ok = 'Envoyer', placeholder = '' } = {}) => new Promise((resolve) => {
  J.modal(`<h2>${J.esc(title)}</h2><label class="f" for="askIn">${J.esc(msg)}</label><input id="askIn" placeholder="${J.esc(placeholder)}"><div class="row" style="margin-top:16px;justify-content:flex-end"><button data-ak="0">Passer</button><button class="pri" data-ak="1">${J.esc(ok)}</button></div>`, (m) => {
    const done = (v) => { J.closeModal(); resolve(v); };
    m.querySelectorAll('[data-ak]').forEach((b) => b.addEventListener('click', () => done(b.dataset.ak === '1' ? m.querySelector('#askIn').value : null)));
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') resolve(null); if (e.key === 'Enter') { e.preventDefault(); done(m.querySelector('#askIn').value); } });
    m.closest('.back').addEventListener('mousedown', (e) => { if (e.target.classList.contains('back')) resolve(null); });
  }, { narrow: true });
});
// Squelette de chargement
J.skeleton = (n = 3) => `<div aria-hidden="true"><span class="skel h"></span>${'<span class="skel"></span><span class="skel s"></span>'.repeat(n)}<span class="skel b"></span></div><span class="sr">Chargement…</span>`;
// Icône de titre
J.hi = (n) => `<span class="h-ico" aria-hidden="true">${J.icon(n)}</span>`;

// Accessibilité : relie chaque <label class="f"> à son champ, et nomme les champs sans libellé.
let uid = 0;
J.a11y = (root = document) => {
  const items = [...root.querySelectorAll('label.f:not([for]),input,select,textarea')];
  let pending = null;
  for (const el of items) {
    if (el.tagName === 'LABEL') { pending = el; continue; }
    if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') { continue; }
    if (pending) { if (!el.id) el.id = 'f' + (++uid); pending.htmlFor = el.id; pending = null; continue; }
    if (!el.id && !el.getAttribute('aria-label') && !el.closest('label')) { const t = el.getAttribute('placeholder') || el.title; if (t) el.setAttribute('aria-label', t); }
    else if (!el.getAttribute('aria-label') && !el.closest('label') && !document.querySelector(`label[for="${el.id}"]`)) { const t = el.getAttribute('placeholder') || el.title; if (t) el.setAttribute('aria-label', t); }
  }
  root.querySelectorAll('[data-act][role=button]:not([tabindex])').forEach((e) => e.setAttribute('tabindex', '0'));
};

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
// Clavier : Entrée / Espace sur un élément cliquable non-bouton ; Entrée dans un champ [data-enter] ; Échap ferme la fenêtre ; ⌘K / Ctrl+K parle à Jarvis.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Escape' && document.querySelector('#modal-root .modal')) { J.closeModal(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches('[data-act][role=button]')) { e.preventDefault(); t.click(); return; }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && t.matches && t.matches('input[data-enter]')) { e.preventDefault(); const b = document.querySelector(`[data-act="${t.dataset.enter}"]`); if (b) b.click(); return; }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && t.matches && t.matches('textarea[data-enter]')) { e.preventDefault(); const b = document.querySelector(`[data-act="${t.dataset.enter}"]`); if (b) b.click(); return; }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault(); if (location.hash && location.hash !== '#accueil') J.go('accueil');
    let n = 0; const tick = () => { const i = document.getElementById('jvIn'); if (i) i.focus(); else if (n++ < 20) setTimeout(tick, 80); }; tick();
  }
});

J.icons = {
  orb: '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8.5" opacity=".6"/><path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2"/>', home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>', folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h6"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  brain: '<path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 1V4a3 3 0 00-3 0zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 1"/>',
  chat: '<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  rocket: '<path d="M5 15c-1.5 1.2-2 4-2 6 2 0 4.8-.5 6-2M14 4c3-1.5 6-1.5 6-1.5S20 5.500 18.500 8.500L14 13l-3-3zM9 10l-4 .5L7 8M14 15l-.5 4 2.500-2"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.500l9 5 9-5"/>', speaker: '<path d="M4 9v6h4l5 4V5L8 9zM16.500 8.500a5 5 0 010 7M19 6a8.500 8.500 0 010 12"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>', plus: '<path d="M12 5v14M5 12h14"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>', bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 14h.01M15 14h.01"/>',
  up: '<path d="M7 11v9H4v-9zM7 11l4-8c1.500 0 2.500 1 2.500 2.500V9H19a2 2 0 012 2.300l-1.200 6.500A2 2 0 0117.800 20H7"/>', down: '<path d="M7 13V4H4v9zM7 13l4 8c1.500 0 2.500-1 2.500-2.500V15H19a2 2 0 002-2.300l-1.200-6.500A2 2 0 0017.800 4H7"/>',
  pin: '<path d="M9 3h6l-1 6 3 3H7l3-3zM12 12v9"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>', refresh: '<path d="M20 11a8 8 0 00-14.500-3M4 4v4h4M4 13a8 8 0 0014.500 3M20 20v-4h-4"/>', send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>', spark: '<path d="M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800zM19 17l.8 2.200L22 20l-2.200.8L19 23l-.8-2.200L16 20l2.200-.8z"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', bank: '<path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
};
J.icon = (n) => `<svg viewBox="0 0 24 24">${J.icons[n] || ''}</svg>`;

// ---------- Voix : parler (synthèse macOS) et écouter (micro → Whisper) ----------
// ---- Préparation du texte pour la synthèse vocale française (rien d'illisible n'est lu : liens, emojis, symboles, markdown) ----
const FR_U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_T = { 20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante', 60: 'soixante', 70: 'septante', 80: 'quatre-vingt', 90: 'nonante' }; // français de Belgique : septante, nonante
const fr100 = (n, fin) => { if (n < 20) return FR_U[n]; const d = Math.floor(n / 10) * 10, u = n % 10; if (d === 80) return u ? 'quatre-vingt-' + FR_U[u] : (fin ? 'quatre-vingts' : 'quatre-vingt'); return FR_T[d] + (u === 1 ? ' et un' : u ? '-' + FR_U[u] : ''); };
const fr1000 = (n, fin) => { const c = Math.floor(n / 100), r = n % 100; let s = ''; if (c) s = (c === 1 ? 'cent' : FR_U[c] + ' cent') + (c > 1 && !r && fin ? 's' : ''); if (r) s += (s ? ' ' : '') + fr100(r, fin); return s; };
J.frInt = (n) => {
  n = Math.floor(Math.abs(Number(n))); if (!Number.isFinite(n)) return ''; if (n === 0) return 'zéro';
  if (n >= 1e15) return String(n).split('').map((d) => FR_U[Number(d)]).join(' ');
  const scales = [[1e12, 'billion'], [1e9, 'milliard'], [1e6, 'million'], [1e3, 'mille']]; const out = []; let rest = n;
  for (const [v, name] of scales) { const q = Math.floor(rest / v); if (!q) continue; rest %= v; if (name === 'mille') out.push(q === 1 ? 'mille' : fr1000(q, false) + ' mille'); else out.push(fr1000(q, false) + ' ' + name + (q > 1 ? 's' : '')); }
  if (rest) out.push(fr1000(rest, true)); return out.join(' ');
};
const frOrd = (n, fem) => { if (n === 1) return fem ? 'première' : 'premier'; let w = J.frInt(n).replace(/(cent|vingt)s$/, '$1'); if (/e$/.test(w)) w = w.slice(0, -1); else if (/cinq$/.test(w)) w += 'u'; else if (/neuf$/.test(w)) w = w.slice(0, -1) + 'v'; return w + 'ième'; };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dayWord = (d) => (Number(d) === 1 ? 'premier' : J.frInt(Number(d)));
const digitsWords = (s) => String(s).split('').map((d) => (/\d/.test(d) ? FR_U[Number(d)] : d)).join(' ');
const parseNum = (str) => {
  let s = String(str).replace(/[\s  ]/g, ''); let neg = false; if (/^[−–-]/.test(s)) { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
  let ip, fp = '';
  if (s.includes(',') && s.includes('.')) { const li = Math.max(s.lastIndexOf(','), s.lastIndexOf('.')); ip = s.slice(0, li).replace(/[.,]/g, ''); fp = s.slice(li + 1); }
  else if (s.includes(',')) { const p = s.split(','); ip = p[0]; fp = p.slice(1).join(''); }
  else if (s.includes('.')) { if (/^\d{1,3}(\.\d{3})+$/.test(s)) ip = s.replace(/\./g, ''); else { const p = s.split('.'); ip = p[0]; fp = p.slice(1).join(''); } }
  else ip = s;
  return { neg, ip: ip || '0', fp };
};
const numWords = (p) => {
  let w;
  if (p.ip.length > 15 || (p.ip.length > 1 && p.ip[0] === '0')) w = digitsWords(p.ip); else w = J.frInt(Number(p.ip));
  if (p.fp) { const z = p.fp.match(/^0*/)[0].length; const rest = p.fp.slice(z); w += ' virgule ' + Array(z).fill('zéro').join(' ') + (z && rest ? ' ' : '') + (rest ? (rest.length <= 3 ? J.frInt(Number(rest)) : digitsWords(rest)) : ''); }
  return (p.neg ? 'moins ' : '') + w.trim();
};
const numVal = (p) => Number(p.ip) + (p.fp ? Number('0.' + p.fp) : 0);
const LETTER = { A: 'a', B: 'bé', C: 'cé', D: 'dé', E: 'eu', F: 'effe', G: 'gé', H: 'ache', I: 'i', J: 'ji', K: 'ka', L: 'elle', M: 'emme', N: 'enne', O: 'o', P: 'pé', Q: 'ku', R: 'erre', S: 'esse', T: 'té', U: 'u', V: 'vé', W: 'double vé', X: 'ixe', Y: 'i grec', Z: 'zède' };
const ACRO_WORD = new Set(['STIB', 'TEC', 'OTAN', 'ONU', 'IRIS', 'SIAMU', 'CIRB', 'FOREM', 'ONEM', 'UNESCO', 'UNICEF', 'COCOF', 'COCOM', 'COCON', 'BELGA', 'ACTIRIS', 'BRUPARTNERS', 'ALLO']);
const spell = (w) => w.split('').map((c) => LETTER[c] || c).join(' ');
const ROMAN = (s) => { const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let n = 0; for (let i = 0; i < s.length; i++) { const a = v[s[i]], b = v[s[i + 1]] || 0; n += a < b ? -a : a; } return n; };
const UNITS = [['km/h', 'kilomètre-heure', 'kilomètres-heure'], ['km²', 'kilomètre carré', 'kilomètres carrés'], ['km2', 'kilomètre carré', 'kilomètres carrés'], ['m²', 'mètre carré', 'mètres carrés'], ['m2', 'mètre carré', 'mètres carrés'], ['m³', 'mètre cube', 'mètres cubes'], ['m3', 'mètre cube', 'mètres cubes'],
  ['km', 'kilomètre', 'kilomètres'], ['cm', 'centimètre', 'centimètres'], ['mm', 'millimètre', 'millimètres'], ['kg', 'kilo', 'kilos'], ['ha', 'hectare', 'hectares'], ['TWh', 'térawattheure', 'térawattheures'], ['GWh', 'gigawattheure', 'gigawattheures'], ['MWh', 'mégawattheure', 'mégawattheures'], ['kWh', 'kilowattheure', 'kilowattheures'],
  ['GW', 'gigawatt', 'gigawatts'], ['MW', 'mégawatt', 'mégawatts'], ['kW', 'kilowatt', 'kilowatts'], ['°C', 'degré', 'degrés'], ['°', 'degré', 'degrés'], ['min', 'minute', 'minutes']];
const UNIT_RX = new RegExp('(?<![\\w.,])([+−–-]?\\d[\\d\\s\\u00a0\\u202f.,]*?)\\s?(' + UNITS.map((u) => u[0].replace(/[/.]/g, (c) => '\\' + c)).join('|') + ')(?![\\p{L}\\d])', 'gu');
const ABBR = [
  [/\bn[°º]\s?/gi, 'numéro '], [/\barts\.\s?/gi, 'articles '], [/\bart\.\s?/gi, 'article '], [/\bal\.\s?(?=\d)/gi, 'alinéa '], [/§\s?/g, 'paragraphe '], [/\bpp\.\s?(?=\d)/g, 'pages '], [/\bp\.\s?(?=\d)/g, 'page '],
  [/\bcf\.\s?/gi, 'voir '], [/\bc\.-à-d\.?/gi, "c'est-à-dire"], [/\bp\.\s?ex\./gi, 'par exemple'], [/\bex\.\s?(?=:)/gi, 'par exemple'], [/\betc\.(?=\s+[A-ZÀ-Ý]|\s*$)/g, 'et cetera.'], [/\betc\.?/gi, 'et cetera'], [/\benv\.\s?/gi, 'environ '],
  [/\bMmes\b\.?/g, 'Mesdames'], [/\bMme\b\.?/g, 'Madame'], [/\bMlle\b\.?/g, 'Mademoiselle'], [/\bMM\.\s?/g, 'Messieurs '], [/\bM\.\s?(?=[A-ZÀ-Ý])/g, 'Monsieur '], [/\bDr\.?\s(?=[A-ZÀ-Ý])/g, 'Docteur '], [/\bPr\.?\s(?=[A-ZÀ-Ý])/g, 'Professeur '],
  [/\bvs\.?\s/gi, 'contre '], [/\bchap\.\s?/gi, 'chapitre '], [/\bréf\.\s?/gi, 'référence '], [/\btél\.?\s?:?/gi, 'téléphone '], [/\bBxl\b/g, 'Bruxelles'], [/\bhab\./gi, 'habitants'], [/\bmin\.\s(?=[A-ZÀ-Ý])/g, 'ministre '],
];

J.speechText = (input) => {
  let s = String(input == null ? '' : input).normalize('NFC').replace(/\r/g, '');
  s = s.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ').replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:be|brussels|com|org|net|eu|fr|nl|gov|info)\b(?:\/\S*)?/gi, ' ');
  s = s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, ' ').replace(/[✓✔✗✘✕✖➜➤➔→←↑↓↔⇒⇐▶◀■□▪▫●○◆◇★☆◦‣⁃⏹⏸▸▹►◄※†‡¶]/g, ' ');
  s = s.replace(/[’‘´`]/g, "'").replace(/[«»"“”„‟‹›]/g, '').replace(/[   ]/g, ' ');
  // Lignes : titres, listes, tableaux, citations -> phrases terminées
  const lines = s.split('\n'); const out = [];
  for (let raw of lines) {
    let l = raw.trim(); if (!l) { out.push(null); continue; }
    if (/^(?:[-*_]\s*){3,}$/.test(l) || /^\|?[\s:|-]+\|?$/.test(l) && /-/.test(l)) continue;
    let block = false;
    if (/^#{1,6}\s+/.test(l)) { l = l.replace(/^#{1,6}\s+/, ''); block = true; }
    if (/^>+\s?/.test(l)) l = l.replace(/^(?:>\s?)+/, '');
    if (/^(?:[-*•◦▪‣+]|\d{1,3}[.)])\s+/.test(l)) { l = l.replace(/^(?:[-*•◦▪‣+]|\d{1,3}[.)])\s+/, ''); block = true; }
    if (/^\|.*\|$/.test(l)) { l = l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(', '); block = true; }
    l = l.replace(/(\*\*|__|\*|~~)/g, '').replace(/(^|[\s(])_+|_+(?=[\s).,;:!?]|$)/g, '$1').replace(/`/g, '');
    if (block && !/[.!?…:;]$/.test(l)) l += '.';
    out.push(l);
  }
  s = ''; for (const l of out) { if (l === null) { s = s.replace(/[^.!?…]\s*$/, (m) => m.trimEnd() + '.') + ' '; } else s += (s && !/\s$/.test(s) ? ' ' : '') + l; }
  // Abréviations et sigles
  s = s.replace(/\b((?:[A-ZÀ-Ý]\.){2,})/g, (m) => m.replace(/\./g, '')).replace(/\bN-VA\b/g, 'enne vé a').replace(/\bCD&V\b/g, 'cé dé et vé').replace(/\bcdH\b/g, 'cé dé ache').replace(/\bCO[2₂]\b/g, 'C O deux').replace(/\bPM\s?(\d+(?:[.,]\d+)?)\b/g, 'P M $1');
  for (const [rx, to] of ABBR) s = s.replace(rx, to);
  s = s.replace(/\b([A-ZÀ-Ý])\.\s+(?=[A-ZÀ-Ý][a-zà-ÿ])/g, '$1 ');
  // Chiffres romains après un mot de contexte
  s = s.replace(/\b(siècle|article|chapitre|titre|livre|section|annexe|phase|tome|partie|Louis|Charles|Léopold|Albert|Philippe|Baudouin|Henri|Jean|Paul|François|Napoléon|Guillaume|Marie)\s+([IVXLCDM]{1,7})(e|ème|er|re)?\b/g, (m, w, r, suf) => { const n = ROMAN(r); if (!n) return m; return w + ' ' + (/^(siècle)$/i.test(w) ? frOrd(n) : /^[A-ZÀ-Ý]/.test(w) ? (n === 1 ? 'premier' : J.frInt(n)) : J.frInt(n)); });
  s = s.replace(/\b([IVXLCDM]{1,7})(?:e|ème)\s+siècle/g, (m, r) => (ROMAN(r) ? frOrd(ROMAN(r)) + ' siècle' : m));
  // Téléphone
  s = s.replace(/(?<![\w.,/-])((?:\+\d{1,3}[\s.]?)?)(0\d{1,3})((?:[\s./-]?\d{2,3}){2,4})(?![\w])/g, (m, pre, a, rest) => { const grp = rest.replace(/[\s./-]/g, ' ').trim(); const parts = (rest.match(/\d{2,3}/g) || []); return (pre ? 'plus ' + digitsWords(pre.replace(/\D/g, '')) + ', ' : '') + digitsWords(a) + ', ' + parts.map((p) => (p.length === 2 ? J.frInt(Number(p)) : digitsWords(p))).join(', ') + (grp ? '' : ''); });
  // Dates
  const dateTxt = (d, mo, y) => { const yy = y.length === 2 ? '20' + y : y; return dayWord(d) + ' ' + MONTHS[Number(mo) - 1] + (y ? ' ' + J.frInt(Number(yy)) : ''); };
  s = s.replace(/\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, (m, y, mo, d) => dateTxt(d, mo, y));
  s = s.replace(/\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](\d{4}|\d{2})\b/g, (m, d, mo, y) => dateTxt(d, mo, y));
  s = s.replace(/\b(le|du|au|depuis le|jusqu'au|dès le|avant le|après le)\s+(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\b(?![/\d])/gi, (m, w, d, mo) => w + ' ' + dateTxt(d, mo, ''));
  s = s.replace(new RegExp('\\b1\\s(' + MONTHS.join('|') + ')\\b', 'gi'), 'premier $1');
  // Heures
  const hourTxt = (h, mi) => { h = Number(h); const hw = h === 0 ? 'minuit' : (h === 1 ? 'une heure' : J.frInt(h) + ' heures'); const m = mi && Number(mi) ? ' ' + J.frInt(Number(mi)) : ''; return hw + m; };
  s = s.replace(/(?<![\d:.,])([01]?\d|2[0-3])\s?[hH]\s?([0-5]\d)?(?![\p{L}\d])/gu, (m, h, mi) => hourTxt(h, mi));
  s = s.replace(/(?<![\d:.,])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, (m, h, mi) => hourTxt(h, mi));
  s = s.replace(/(heures?(?:\s\S+)?)\s*[-–]\s*(?=(?:\d|une? heure|minuit))/g, '$1 à ');
  // Argent, pourcentages, unités
  s = s.replace(/(\d+(?:[.,]\d+)?)\s?(Md|M|k)\s?€/g, (m, n, u) => { const p = parseNum(n); const v = numVal(p); return numWords(p) + ' ' + (u === 'k' ? 'mille euros' : u === 'M' ? (v >= 2 ? 'millions' : 'million') + " d'euros" : (v >= 2 ? 'milliards' : 'milliard') + " d'euros"); });
  s = s.replace(/(?<![\w.,])([+−–-]?\d[\d\s  .,]*\d|[+−–-]?\d)\s?(€|euros?|EUR)(?![\p{L}])/gu, (m, n) => { const p = parseNum(n); const v = numVal(p); let w = numWords({ ...p, fp: '' }) + (v >= 2 ? ' euros' : ' euro'); const c = p.fp.slice(0, 2).padEnd(2, '0'); if (p.fp && Number(c)) w += ' ' + J.frInt(Number(c)); return w; });
  s = s.replace(/(?<![\w.,])([+−–-]?\d[\d\s  .,]*\d|[+−–-]?\d)\s?%/g, (m, n) => (/^\+/.test(n) ? 'plus ' : '') + numWords(parseNum(n)) + ' pour cent');
  s = s.replace(UNIT_RX, (m, n, u) => { const p = parseNum(n); const un = UNITS.find((x) => x[0] === u); return (/^\+/.test(n) ? 'plus ' : '') + numWords(p) + ' ' + (numVal(p) >= 2 ? un[2] : un[1]); });
  s = s.replace(/\bd'€/g, "d'euros").replace(/€/g, ' euros');
  // Ordinaux et fractions
  s = s.replace(/\b(\d{1,3})\s?(er|ère|re|nd|nde)\b/g, (m, n, suf) => frOrd(Number(n), /^(ère|re|nde)$/.test(suf)));
  s = s.replace(/\b(\d{1,3})\s?(e|ème|eme)\b(?![\p{L}])/gu, (m, n) => frOrd(Number(n)));
  s = s.replace(/\b1\/2\b/g, 'un demi').replace(/\b1\/3\b/g, 'un tiers').replace(/\b2\/3\b/g, 'deux tiers').replace(/\b1\/4\b/g, 'un quart').replace(/\b3\/4\b/g, 'trois quarts');
  // Plages et nombres
  s = s.replace(/(\d)\s?[-–]\s?(?=\d)/g, '$1 à ');
  s = s.replace(/(?<![\w.,])([+−–-])?(\d{1,3}(?:[\s  .]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?![\w])/g, (m, sg, n, off, whole) => {
    const before = whole.slice(Math.max(0, off - 1), off); let sign = '';
    if (sg === '+' && (off === 0 || /[\s(]/.test(before))) sign = 'plus '; else if (sg && sg !== '+' && (off === 0 || /[\s(]/.test(before))) sign = 'moins '; else if (sg) return m.replace(sg, sg + ' ').replace(/\d.*$/, '') + numWords(parseNum(n));
    return sign + numWords(parseNum(n));
  });
  s = s.replace(/(?<![\w])(\d+)(?![\w])/g, (m, n) => numWords(parseNum(n)));
  // Sigles : épelés lettre par lettre sauf ceux qui se prononcent comme des mots
  const toks = s.match(/[A-Za-zÀ-ÿ]{2,}/g) || []; const upper = toks.filter((w) => w === w.toUpperCase()).length; const shout = toks.length >= 5 && upper / toks.length > 0.6;
  s = s.replace(/\b[A-ZÀ-Ý]{2,6}(?:-[A-ZÀ-Ý]{2,6})*\b/g, (w) => { if (shout) return w.charAt(0) + w.slice(1).toLowerCase(); return w.split('-').map((p) => (ACRO_WORD.has(p) || p.length >= 5 ? (ACRO_WORD.has(p) ? p.toLowerCase() : p.charAt(0) + p.slice(1).toLowerCase()) : spell(p.replace(/[ÀÂÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E')))).join(' '); });
  // Symboles
  s = s.replace(/\bet\/ou\b/gi, 'et ou').replace(/\s&\s/g, ' et ').replace(/&/g, ' et ').replace(/\s\+\s/g, ' plus ').replace(/\s=\s/g, ' égale ').replace(/[≈~]\s?(?=\d)/g, 'environ ').replace(/×/g, ' fois ').replace(/≥/g, ' au moins ').replace(/≤/g, ' au plus ').replace(/\s>\s/g, ' supérieur à ').replace(/\s<\s/g, ' inférieur à ').replace(/#(?=\p{L})/gu, '').replace(/[#*^<>|{}\\=@]/g, ' ').replace(/(?<=\p{L})\/(?=\p{L})/gu, ' ');
  // Parenthèses, tirets, points de suspension
  s = s.replace(/\s*\[\d+\]/g, '').replace(/\s*\(\s*\d+\s*\)/g, '').replace(/[(\[]\s*([^()[\]]{1,200}?)\s*[)\]]/g, ', $1, ').replace(/[()[\]]/g, ' ');
  s = s.replace(/\s[—–]\s|\s-\s|—|–/g, ', ').replace(/\s·\s/g, ', ').replace(/(?<=\p{L})-(?=\s)/gu, '').replace(/\.{3,}|…/g, (m, off, w) => (/^\s*[a-zà-ÿ]/.test(w.slice(off + m.length)) ? ',' : '.'));
  s = s.replace(/[!?]{2,}/g, (m) => m[0]).replace(/\s*;\s*/g, '; ').replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])(?=[^\s])/g, '$1 ').replace(/([a-zà-ÿ][.!?])(?=[A-ZÀ-Ý])/g, '$1 ').replace(/,(\s*,)+/g, ',').replace(/,\s*([.!?])/g, '$1').replace(/([.!?])\s*,/g, '$1').replace(/^[\s,;:.]+/, '').replace(/([.!?])\s*([.;:])/g, '$1').replace(/:\s*([.!?])/g, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  if (s && !/[.!?…]$/.test(s)) s += '.';
  return s;
};
J.plain = (t) => J.speechText(t);
J.voices = () => (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => /^fr/i.test(v.lang));
// Coupe aux phrases : un premier morceau court (démarrage rapide), puis des morceaux de ≈ 240 caractères.
J.chunks = (text) => {
  const clean = J.speechText(text); if (!clean) return [];
  const pieces = [];
  for (const sent of clean.split(/(?<=[.!?])\s+/)) {
    if (sent.length <= 260) { pieces.push(sent); continue; }
    let buf = '';
    for (const p of sent.split(/(?<=[,;:])\s+/)) { if (buf && (buf + ' ' + p).length > 200) { pieces.push(buf); buf = p; } else buf = buf ? buf + ' ' + p : p; }
    if (buf) pieces.push(buf);
  }
  const hard = []; for (const p of pieces) { let q = p; while (q.length > 300) { const i = q.lastIndexOf(' ', 260); hard.push(q.slice(0, i > 100 ? i : 260).trim()); q = q.slice(i > 100 ? i : 260).trim(); } if (q) hard.push(q); }
  const out = []; let buf = '';
  for (const p of hard) {
    const max = out.length === 0 ? 130 : 240;
    if (!buf) buf = p; else if ((buf + ' ' + p).length <= max && (out.length > 0 || buf.length < 60)) buf += ' ' + p; else { out.push(buf); buf = p; }
  }
  if (buf) out.push(buf);
  return out;
};
// Bruit / hallucinations typiques de la reconnaissance sur du silence (« Sous-titres réalisés par… », « Merci d'avoir regardé… »).
J.isNoise = (input) => {
  const t = String(input || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘´`]/g, "'").replace(/\s+/g, ' ').trim();
  if (!t || !/[a-z0-9]/.test(t)) return true;
  if (/sous[- ]?titr|amara\.org|subtitles? by|transcribed by|thanks? for watching|thank you for watching|merci d'avoir (?:regarde|visionne|ecoute|suivi)|n'oubliez pas de (?:vous )?abonner|abonnez-vous|abonne-toi|a bientot pour une prochaine|a la prochaine video|merci a tous d'avoir|radio-canada|st'? ?501|sous-titres? realise/.test(t)) return true;
  if (/^[\[(].*[\])]$/.test(t)) return true;
  if (/^(?:you|oh|ah|euh+|heu+|hum+|hmm+|mmh+|uh|um|mm+|bah|ben|hein|pff+|\.+)(?:[\s,.!?]+(?:you|oh|ah|euh+|heu+|hum+|hmm+|mmh+|uh|um|mm+|bah|ben|hein|pff+))*[\s.!?]*$/.test(t)) return true;
  const w = t.split(/\s+/); return w.length >= 6 && new Set(w).size <= 2;
};
// Texte entendu -> phrase propre : sans « Jarvis », sans doublon de reconnaissance, majuscule initiale. '' si c'est du bruit.
J.cleanHeard = (input) => {
  let s = String(input || '').replace(/\s+/g, ' ').trim(); if (!s || J.isNoise(s)) return '';
  const orig = s;
  s = s.replace(/^(?:(?:hey|ok|okay|salut|dis|oh|eh)\s+)?jarvis(?:e|ice|isse)?\b[\s,;:!.-]*/i, '').replace(/[\s,;:-]*\bjarvis(?:e|ice|isse)?\b[\s.!?]*$/i, '').trim();
  if (!s) return orig;
  const d = s.match(/^(.{6,}?)(?:[\s.!?,]+\1)+[\s.!?]*$/i); if (d) s = d[1];
  return s.charAt(0).toUpperCase() + s.slice(1);
};
let speakToken = 0, curAudio = null, curRelease = null;
J.stopSpeak = () => {
  speakToken++; J.speaking = false;
  if (curAudio) { try { curAudio.pause(); } catch { /* ok */ } curAudio = null; }
  if (curRelease) { const r = curRelease; curRelease = null; r(); }
  if (window.speechSynthesis) speechSynthesis.cancel();
};
// Lecture avec la voix du système, phrase par phrase (arrêt immédiat, pas de coupure des longs textes).
const systemSpeak = async (chunks, my) => {
  if (!window.speechSynthesis) { J.toast('Synthèse vocale indisponible', 'err'); return; }
  const v = J.S?.voice || {}; const voices = J.voices();
  const voice = voices.find((x) => x.name === v.ttsVoice) || voices.find((x) => /fr-BE/i.test(x.lang)) || voices.find((x) => /fr-FR/i.test(x.lang)) || voices[0];
  for (const c of chunks) {
    if (my !== speakToken) return;
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(c); u.lang = voice?.lang || 'fr-FR'; if (voice) u.voice = voice; u.rate = Math.min(1.6, Math.max(0.5, Number(v.ttsRate) || 1));
      let ended = false; const done = () => { if (!ended) { ended = true; clearTimeout(guard); if (curRelease === done) curRelease = null; resolve(); } };
      const guard = setTimeout(done, 3000 + c.length * 120);
      curRelease = done; u.onend = u.onerror = done; speechSynthesis.speak(u);
    });
  }
};
const playWav = (b64, token) => new Promise((res) => {
  if (token !== speakToken) return res();
  const a = new Audio('data:audio/wav;base64,' + b64); curAudio = a;
  const done = () => { if (curRelease === done) curRelease = null; if (curAudio === a) curAudio = null; res(); };
  curRelease = done; a.onended = a.onerror = done; a.play().catch(done);
});
// Parler : voix Piper (open source, hors-ligne) si installée, sinon voix macOS.
J.speak = async (text) => {
  J.stopSpeak(); const my = speakToken; const chunks = J.chunks(text); if (!chunks.length) return;
  J.speaking = true; try { await speakInner(chunks, my); } finally { if (my === speakToken) J.speaking = false; }
};
const speakInner = async (chunks, my) => {
  let rest = chunks;
  if ((J.S?.voice?.engine) === 'piper' && J.S?._env?.piperReady) {
    const jobs = []; const fetchAt = (i) => { if (i < chunks.length && !jobs[i]) { jobs[i] = J.call('voice.synth', { text: chunks[i] }); jobs[i].catch(() => {}); } };
    fetchAt(0); fetchAt(1); let i = 0;
    try {
      for (; i < chunks.length; i++) {
        const wav = await jobs[i]; if (my !== speakToken) return;
        fetchAt(i + 2); // pré-génération des morceaux suivants pendant la lecture
        if (wav) await playWav(wav, my); if (my !== speakToken) return;
      }
      return;
    } catch (e) { if (my !== speakToken) return; if (!J.state.piperWarned) { J.state.piperWarned = true; J.toast('Voix Piper indisponible, voix système utilisée : ' + e.message, 'err'); } rest = chunks.slice(i); }
  }
  await systemSpeak(rest, my);
};
J.act.speakEl = (el) => { const t = document.querySelector(el.dataset.sel); J.speak(t ? (t.value ?? t.innerText) : ''); };
J.act.speakStop = () => J.stopSpeak();
// Arrête la requête IA en cours (recherche, rédaction, analyse) : le bouton d'origine redevient utilisable.
J.act.aiCancel = async () => { await J.call('ai.cancel'); J.toast('Demande arrêtée', 'ok'); };
J.act.skipToContent = (el, e) => { e.preventDefault(); document.getElementById('view').focus(); };
J.speakBtn = (sel) => `<button class="sm" data-act="speakEl" data-sel="${sel}" title="Lire à voix haute">${J.icon('speaker')} Écouter</button><button class="sm ghost" data-act="speakStop" title="Arrêter la lecture" aria-label="Arrêter la lecture">${J.icon('stop')}</button>`;
J.micBtn = (target) => `<button class="sm" data-act="mic" data-target="${target}" title="Dicter (micro)">${J.icon('mic')} Dicter</button>`;

// Enregistre le micro en WAV 16 kHz mono, avec détection de fin de phrase (silence). Retourne { done: Promise<{wav, spoke, reason}>, stop() }.
const encodeWav = (chunks, rate) => {
  let n = 0; for (const c of chunks) n += c.length; const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  let peak = 0; for (let i = 0; i < n; i++) { const a = Math.abs(all[i]); if (a > peak) peak = a; }
  const gain = peak > 0.005 && peak < 0.5 ? Math.min(4, 0.7 / peak) : 1; // micro faible : léger relèvement du niveau
  const ratio = rate / 16000; const len = Math.floor(n / ratio); const pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) { const a = Math.floor(i * ratio), b = Math.min(n, Math.floor((i + 1) * ratio)); let sum = 0; for (let k = a; k < b; k++) sum += all[k]; const v = Math.max(-1, Math.min(1, (sum / Math.max(1, b - a)) * gain)); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  const buf = new ArrayBuffer(44 + len * 2), dv = new DataView(buf); const w = (p, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(p + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * 2, true);
  new Int16Array(buf, 44).set(pcm);
  const bytes = new Uint8Array(buf); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const micError = (msg, code) => { const e = new Error(msg); e.code = code; return e; };
// Écoute : calibration du bruit, seuil adaptatif avec hystérésis, fin de phrase au silence, rognage du silence avant/après la parole.
// Erreurs : code MIC (refusé), NOMIC (aucun micro), BUSY (micro pris par une autre app), MICERR.
J.listen = async ({ vad = true, maxMs = 45000, noSpeechMs = 8000, endSilenceMs = 1300, onLevel, onSpeech } = {}) => {
  let st = 'granted'; try { st = await J.call('voice.micStatus'); } catch { /* hors Electron */ }
  if (st !== 'granted') throw micError('Micro refusé', 'MIC');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
  catch (err) {
    const n = (err && err.name) || '';
    if (/NotAllowed|Security/.test(n)) throw micError('Micro refusé', 'MIC');
    if (/NotFound|Overconstrained|DevicesNotFound/.test(n)) throw micError('Aucun micro détecté. Branchez un micro ou choisissez-en un dans Réglages Système › Son › Entrée.', 'NOMIC');
    if (/NotReadable|Abort|TrackStart/.test(n)) throw micError('Le micro est utilisé par une autre application. Fermez-la puis réessayez.', 'BUSY');
    throw micError('Micro inaccessible : ' + ((err && err.message) || n), 'MICERR');
  }
  const ctx = new AudioContext(); if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream); const proc = ctx.createScriptProcessor(4096, 1, 1);
  const frames = []; let resolve; const done = new Promise((r) => { resolve = r; });
  const t0 = performance.now(); const cal = []; let noise = 0.005, lastVoice = 0, run = 0, spoke = false, over = false, first = -1, last = -1, voiced = 0;
  const finish = (reason) => {
    if (over) return; over = true;
    try { proc.disconnect(); src.disconnect(); } catch { /* ok */ }
    stream.getTracks().forEach((t) => t.stop()); const rate = ctx.sampleRate; ctx.close().catch(() => {});
    let wav = null; const long = voiced >= 3 || !vad; // moins de ≈ 0,25 s de voix = clic ou bruit
    if (reason !== 'error' && long && (spoke || !vad)) {
      const a = vad && first >= 0 ? Math.max(0, first - 4) : 0; const b = vad && last >= 0 ? Math.min(frames.length, last + 4) : frames.length; wav = encodeWav(frames.slice(a, b), rate);
    }
    resolve({ reason, spoke, wav, ms: Math.round(performance.now() - t0) });
  };
  const tr = stream.getAudioTracks()[0]; if (tr) tr.onended = () => finish('error');
  proc.onaudioprocess = (e) => {
    if (over) return;
    const d = e.inputBuffer.getChannelData(0); frames.push(new Float32Array(d)); const idx = frames.length - 1;
    let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i]; const rms = Math.sqrt(sum / d.length); const now = performance.now();
    if (onLevel) onLevel(rms);
    if (cal.length < 5 && rms < 0.15) { cal.push(rms); const s = [...cal].sort((x, y) => x - y); noise = Math.min(0.04, s[Math.floor(s.length / 2)]); return; }
    const thr = Math.max(0.014, noise * 3), low = thr * 0.6;
    if (rms > thr) { run++; if (run >= 2 && !spoke) { spoke = true; first = idx - 1; if (onSpeech) onSpeech(); } }
    else { run = 0; if (!spoke) noise = noise * 0.96 + Math.min(rms, 0.04) * 0.04; }
    if (spoke && rms > low) { lastVoice = now; last = idx; if (rms > thr) voiced++; }
    if (vad) { if (spoke && now - lastVoice > endSilenceMs) finish('silence'); else if (!spoke && now - t0 > noSpeechMs) finish('nospeech'); }
    if (now - t0 > maxMs) finish('max');
  };
  src.connect(proc); proc.connect(ctx.destination);
  return { done, stop: () => finish('manual') };
};
J.transcribe = async (wav) => (await J.call('voice.transcribe', { audio: wav, mime: 'audio/wav' })).text;

// Bouton « Dicter » des formulaires : clic = écouter, 2e clic = arrêter.
let dict = null;
J.act.mic = async (el) => {
  if (dict) { dict.stop(); return; }
  if (!J.S._env.sttReady) return J.modal(`<h2>Dictée vocale</h2><p>La reconnaissance vocale n'est pas disponible. Utilise la dictée macOS : appuie deux fois sur <b>Fn</b> dans le champ.</p><p>Ou configure Whisper dans <a href="#reglages">Réglages › Voix</a>.</p><div class="row"><button class="pri" data-act="closeModal">OK</button></div>`);
  const old = el.innerHTML; let h;
  try { h = await J.listen({ vad: true, noSpeechMs: 10000 }); } catch (e) { if (e.code === 'MIC') return J.modal(`<h2>Micro refusé</h2><p>Autorise Jarvis Parlement dans Réglages Système › Confidentialité › Micro, puis réessaie.</p><div class="row"><button class="pri" data-act="openMic">Ouvrir les réglages</button><button data-act="closeModal">Fermer</button></div>`); return J.err(e); }
  dict = h; el.innerHTML = J.icon('stop') + ' Arrêter'; el.classList.add('pri');
  const r = await h.done; dict = null; el.classList.remove('pri');
  if (!r.wav) { el.innerHTML = old; return J.toast("Je n'ai rien entendu", 'err'); }
  el.innerHTML = '<span class="spin" aria-hidden="true"></span> Transcription…'; el.disabled = true;
  try { const text = await J.transcribe(r.wav); const t = document.getElementById(el.dataset.target); if (t && text) { t.value = (t.value ? t.value + ' ' : '') + text; t.dispatchEvent(new Event('input')); } }
  catch (e) { J.err(e); } finally { el.innerHTML = old; el.disabled = false; }
};
J.act.openMic = () => J.call('voice.openMicSettings');
window.speechSynthesis && (speechSynthesis.onvoiceschanged = () => {});
