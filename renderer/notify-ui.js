// Centre d'alertes : toutes les alertes passagères de l'application s'affichent ici, en BAS À DROITE (jamais en haut).
// Pile de cartes cliquables (4 visibles au plus, les autres regroupées « +N alertes »). Les alertes ordinaires disparaissent après ~12 s
// (pause au survol, au focus clavier et quand la fenêtre est cachée) ; les alertes urgentes restent jusqu'au clic ou à la fermeture.
// Une alerte de courriel ouvre ce courriel dans « Courriels ». Compteur d'alertes de suivi : badge de la barre latérale.
(() => {
  const MAX_VISIBLE = 4; const MAX_EXPANDED = 12; const MAX_KEPT = 30; const TTL = 12000;
  const ICONS = { mail: '✉️', urgent: '🚨', veille: '📰', brain: '🧠', ok: '✅', err: '⚠️', error: '⚠️', info: 'ℹ️', agenda: '📅' };
  const CSS = `#al-root{position:fixed;right:20px;bottom:20px;z-index:99;display:flex;flex-direction:column;gap:8px;width:min(380px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:visible;pointer-events:none}
body:has(#main.jv-main) #al-root{bottom:92px}
#al-root.open{overflow-y:auto;pointer-events:auto}
#al-root .al{pointer-events:auto;display:flex;align-items:stretch;background:var(--toast,#1a3a7a);color:#fff;border-radius:12px;border-left:4px solid var(--acc2,#ffd21f);box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:hidden;animation:al-in .22s ease-out;flex:none}
#al-root .al[data-urgent="1"]{background:color-mix(in srgb,#b3261e 60%,var(--toast,#1a3a7a));border-left-color:#ffb4a6}
#al-root .al[data-type=ok]{background:#1d6b46;border-left-color:#7be0ae}
#al-root .al[data-type=err]{background:#a8321f;border-left-color:#ffb4a6}
#al-root .al-main{flex:1;min-width:0;display:flex;gap:10px;align-items:flex-start;text-align:left;padding:10px 4px 10px 12px;background:transparent;border:0;border-radius:0;color:inherit;font:inherit;font-weight:400;cursor:pointer}
#al-root .al-main:hover:not(:disabled){background:rgba(255,255,255,.1);border:0}
#al-root .al-ico{font-size:17px;line-height:1.35;flex:none}
#al-root .al-txt{min-width:0;display:flex;flex-direction:column;gap:1px}
#al-root .al-t{font-weight:700;font-size:13.5px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#al-root .al-d{font-size:12.5px;line-height:1.4;opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#al-root .al-tag{align-self:flex-start;margin-top:3px;font-size:11px;font-weight:700;border-radius:99px;padding:1px 8px;background:var(--acc2,#ffd21f);color:#0a1f3f}
#al-root .al-x{flex:none;align-self:flex-start;width:32px;height:32px;margin:4px 4px 0 0;padding:0;font-size:20px;line-height:1;border:0;border-radius:8px;background:transparent;color:rgba(255,255,255,.85)}
#al-root .al-x:hover:not(:disabled){background:rgba(255,255,255,.18);border:0;color:#fff}
#al-root button:focus-visible{outline:2px solid #fff;outline-offset:-3px}
#al-root .al-more{pointer-events:auto;display:flex;gap:8px;justify-content:flex-end;flex:none}
#al-root .al-more button{background:var(--toast,#1a3a7a);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:99px;padding:3px 12px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.3)}
#al-root .al-more button:hover:not(:disabled){background:color-mix(in srgb,#fff 14%,var(--toast,#1a3a7a));border-color:rgba(255,255,255,.5)}
@keyframes al-in{from{opacity:0;transform:translateY(10px)}}
@media (prefers-reduced-motion:reduce){#al-root .al{animation:none}}
#toasts{display:none}
.nav-badge{margin-left:auto;min-width:20px;padding:0 6px;border-radius:99px;background:rgba(255,255,255,.2);color:#fff;font-size:11.5px;font-weight:700;line-height:18px;text-align:center}
.nav-badge.hot{background:#ff6b57;color:#fff}
.side-follow{display:block;font-size:12px;color:#ffe58a;text-decoration:none;border:1px solid rgba(255,210,31,.4);background:rgba(255,210,31,.08);border-radius:8px;padding:6px 10px}
.side-follow:hover{background:rgba(255,210,31,.16)}.side-follow.hot{border-color:#ff8a76;color:#ffd0c7;background:rgba(255,107,87,.12)}
.side-follow:focus-visible{outline:2px solid #ffd21f;outline-offset:2px}`;

  const oneLine = (s, n) => String(s == null ? '' : s).replace(/[\p{C}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const state = { list: [], seq: 0, expanded: false, hover: false, focus: false, counts: { count: 0, urgent: 0 }, els: new Map(), root: null, more: null, timer: null };

  function ensureRoot() {
    if (state.root && state.root.isConnected !== false) return state.root;
    if (!document.getElementById('al-css')) { const st = document.createElement('style'); st.id = 'al-css'; st.textContent = CSS; document.head.appendChild(st); }
    let r = document.getElementById('al-root');
    if (!r) {
      r = document.createElement('div'); r.id = 'al-root'; r.setAttribute('role', 'region'); r.setAttribute('aria-label', 'Alertes'); document.body.appendChild(r);
      r.addEventListener('mouseenter', () => { state.hover = true; }); r.addEventListener('mouseleave', () => { state.hover = false; });
      r.addEventListener('focusin', () => { state.focus = true; }); r.addEventListener('focusout', () => { state.focus = false; });
    }
    state.root = r; return r;
  }

  function makeCard(a) {
    const el = document.createElement('div'); el.className = 'al'; el.dataset.id = a.id; el.dataset.type = a.type; el.dataset.urgent = a.urgent ? '1' : '0';
    const loud = a.urgent || a.type === 'err';
    el.setAttribute('role', loud ? 'alert' : 'status'); el.setAttribute('aria-live', loud ? 'assertive' : 'polite'); el.setAttribute('aria-atomic', 'true');
    const main = document.createElement('button'); main.type = 'button'; main.className = 'al-main';
    main.setAttribute('aria-label', [a.title, a.detail, a.tag].filter(Boolean).join('. ') + (a.key || a.go || a.onClick ? ' — activer pour ouvrir' : ' — activer pour fermer'));
    const ico = document.createElement('span'); ico.className = 'al-ico'; ico.setAttribute('aria-hidden', 'true'); ico.textContent = ICONS[a.urgent ? 'urgent' : a.icon || a.type] || ICONS.info;
    const txt = document.createElement('span'); txt.className = 'al-txt';
    const t = document.createElement('span'); t.className = 'al-t'; t.textContent = a.title; txt.appendChild(t);
    if (a.detail) { const d = document.createElement('span'); d.className = 'al-d'; d.textContent = a.detail; txt.appendChild(d); }
    if (a.tag) { const g = document.createElement('span'); g.className = 'al-tag'; g.textContent = a.tag; txt.appendChild(g); }
    main.appendChild(ico); main.appendChild(txt);
    const x = document.createElement('button'); x.type = 'button'; x.className = 'al-x'; x.setAttribute('aria-label', 'Fermer l’alerte : ' + a.title); x.title = 'Fermer'; x.textContent = '×';
    main.addEventListener('click', () => activate(a.id)); x.addEventListener('click', () => dismiss(a.id));
    el.appendChild(main); el.appendChild(x); return el;
  }

  // Quelles alertes montrer : les urgentes d'abord (les plus récentes), puis les autres, 4 au plus ; affichées de la plus ancienne à la plus récente.
  function visible() {
    const all = state.list; if (state.expanded) return all.slice(-MAX_EXPANDED);
    const pick = [...all].sort((a, b) => (b.urgent - a.urgent) || (b.seq - a.seq)).slice(0, MAX_VISIBLE);
    return pick.sort((a, b) => a.seq - b.seq);
  }
  function sync() {
    const root = ensureRoot(); const vis = visible(); const keep = new Set(vis.map((a) => a.id));
    for (const [id, el] of [...state.els]) if (!keep.has(id)) { el.remove(); state.els.delete(id); }
    let prev = null;
    for (const a of vis) {
      let el = state.els.get(a.id); if (!el) { el = makeCard(a); state.els.set(a.id, el); }
      if (prev ? prev.nextSibling !== el : root.firstChild !== el) root.insertBefore(el, prev ? prev.nextSibling : root.firstChild);
      prev = el;
    }
    const hidden = state.list.length - vis.length;
    if (hidden > 0 || state.expanded) {
      if (!state.more) {
        const m = document.createElement('div'); m.className = 'al-more'; const b1 = document.createElement('button'); b1.type = 'button'; b1.dataset.role = 'more'; const b2 = document.createElement('button'); b2.type = 'button'; b2.dataset.role = 'clear'; b2.textContent = 'Tout fermer';
        b1.addEventListener('click', () => { state.expanded = !state.expanded; sync(); }); b2.addEventListener('click', () => clear());
        m.appendChild(b1); m.appendChild(b2); state.more = m;
      }
      const b1 = state.more.firstChild; b1.textContent = state.expanded ? 'Réduire' : `+${hidden} alerte${hidden > 1 ? 's' : ''}`;
      b1.setAttribute('aria-expanded', state.expanded ? 'true' : 'false'); b1.setAttribute('aria-label', state.expanded ? 'Réduire la pile d’alertes' : `Afficher ${hidden} autre${hidden > 1 ? 's' : ''} alerte${hidden > 1 ? 's' : ''}`);
      if (state.more.parentNode !== root) root.appendChild(state.more); else if (root.lastChild !== state.more) root.appendChild(state.more);
    } else if (state.more && state.more.parentNode) { state.more.remove(); }
    root.classList.toggle('open', state.expanded);
    if (!state.list.length) { state.expanded = false; stopTimer(); } else startTimer();
  }

  function push(o) {
    o = o || {}; const title = oneLine(o.title, 140); const detail = oneLine(o.detail, 200);
    if (!title && !detail) return null;
    const urgent = o.urgent === true; const type = String(o.type || o.kind || 'info').replace(/[^a-z-]/g, '') || 'info';
    // Même message déjà affiché (ex. : même toast répété) : on remet le minuteur à zéro au lieu d'empiler.
    const dup = state.list.find((x) => (o.id ? x.id === o.id : (x.title === title && x.detail === detail && x.type === type && !x.fixedId)));
    const ttl = urgent ? 0 : (Number.isFinite(o.ttl) ? o.ttl : TTL);
    const a = { id: o.id ? String(o.id) : 'al' + (++state.seq), fixedId: !!o.id, seq: ++state.seq, type, icon: o.icon || '', title: title || detail, detail: title ? detail : '', tag: oneLine(o.tag, 60), urgent, ttl, left: ttl, key: o.key ? String(o.key) : '', keys: Array.isArray(o.keys) ? o.keys.slice(0, 50).map(String) : [], go: o.go ? String(o.go) : '', onClick: typeof o.onClick === 'function' ? o.onClick : null };
    if (dup) { const el = state.els.get(dup.id); if (el) { el.remove(); state.els.delete(dup.id); } state.list.splice(state.list.indexOf(dup), 1); a.id = dup.id; }
    state.list.push(a);
    while (state.list.length > MAX_KEPT) { const i = state.list.findIndex((x) => !x.urgent); const gone = state.list.splice(i >= 0 ? i : 0, 1)[0]; const el = state.els.get(gone.id); if (el) { el.remove(); state.els.delete(gone.id); } }
    sync(); return a.id;
  }
  function dismiss(id) {
    const i = state.list.findIndex((x) => x.id === id); if (i < 0) return false;
    state.list.splice(i, 1); const el = state.els.get(id); if (el) { el.remove(); state.els.delete(id); }
    sync();
    // Le focus ne reste jamais sur une carte disparue : retour au contenu.
    if (document.activeElement === document.body && state.list.length === 0) { const v = document.getElementById('view'); if (v && v.focus) v.focus({ preventScroll: true }); }
    return true;
  }
  function clear() { for (const [, el] of state.els) el.remove(); state.els.clear(); state.list = []; sync(); }
  function activate(id) {
    const a = state.list.find((x) => x.id === id); if (!a) return;
    dismiss(id);
    try {
      if (a.onClick) a.onClick(a);
      else if (a.type === 'mail' || a.key) openMail(a.key || (a.keys && a.keys[0]) || '');
      else if (a.go) J.go(a.go);
    } catch (e) { console.error(e); }
  }

  // Minuteur commun : retire les alertes ordinaires expirées. En pause au survol, au focus clavier et fenêtre cachée.
  function tick(ms) {
    if (state.hover || state.focus || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    const gone = state.list.filter((a) => !a.urgent && a.ttl > 0 && (a.left -= ms) <= 0);
    if (gone.length) { for (const a of gone) { state.list.splice(state.list.indexOf(a), 1); const el = state.els.get(a.id); if (el) { el.remove(); state.els.delete(a.id); } } sync(); }
  }
  function startTimer() { if (!state.timer && typeof setInterval === 'function') state.timer = setInterval(() => tick(250), 250); }
  function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  // ---- Courriels : ouvrir celui de l'alerte (la page Courriels défile jusqu'à lui, le met en évidence et l'affiche) ----
  function openMail(key) {
    J.state.openMailKey = key || null;
    if (!key) { if ((location.hash || '').split('/')[0] !== '#courriels') J.go('courriels'); J.state.openMailKey = null; return; }
    if (document.getElementById('smartBox') && J.mbOpenKey) { const k = J.state.openMailKey; J.state.openMailKey = null; J.mbOpenKey(k); return; }
    if ((location.hash || '').split('/')[0] !== '#courriels') J.go('courriels'); // la page, en se montant, ouvre J.state.openMailKey
  }
  // Alerte venue de la surveillance (processus principal) : { id, kind, urgent, key, keys, title, detail, tag, go }
  function pushMail(d) {
    d = d || {}; const kind = d.kind === 'mail' ? 'mail' : (d.kind === 'error' ? 'error' : (d.kind === 'ok' ? 'ok' : 'info'));
    push({ id: d.id, type: kind, urgent: d.urgent === true, title: d.title, detail: d.detail, tag: d.tag, key: d.key, keys: d.keys, go: d.go });
    if (kind === 'mail' && (location.hash || '').startsWith('#courriels') && J.mbSoftRefresh) J.mbSoftRefresh();
  }

  // ---- Compteur d'alertes de suivi : badge sur « Courriels » + résumé en bas de la barre latérale ----
  function setCounts(c) { c = c || {}; state.counts = { count: Math.max(0, Math.floor(Number(c.count)) || 0), urgent: Math.max(0, Math.floor(Number(c.urgent)) || 0) }; paint(); }
  function paint() {
    const { count, urgent } = state.counts;
    const link = document.querySelector('#nav a[data-page="courriels"]');
    if (link) {
      let b = link.querySelector('.nav-badge');
      if (count > 0) {
        if (!b) { b = document.createElement('span'); link.appendChild(b); }
        b.className = 'nav-badge' + (urgent ? ' hot' : ''); b.textContent = count > 99 ? '99+' : String(count); b.setAttribute('aria-hidden', 'true');
        link.setAttribute('aria-label', `Courriels, ${count} alerte${count > 1 ? 's' : ''} de suivi${urgent ? ', dont ' + urgent + ' urgente' + (urgent > 1 ? 's' : '') : ''}`);
      } else { if (b) b.remove(); link.removeAttribute('aria-label'); }
    }
    const foot = document.querySelector('.side-foot');
    if (foot) {
      let s = foot.querySelector('.side-follow');
      if (count > 0) {
        if (!s) { s = document.createElement('a'); s.href = '#courriels'; foot.insertBefore(s, foot.firstChild); }
        s.className = 'side-follow' + (urgent ? ' hot' : ''); s.textContent = `🔔 ${count} à suivre${urgent ? ' · ' + urgent + ' urgent' + (urgent > 1 ? 's' : '') : ''}`;
        s.title = 'Courriels à suivre : échéances, expéditeurs urgents, messages sans réponse';
      } else if (s) s.remove();
    }
  }
  async function refresh() { try { setCounts(await J.call('mailbox.alertCount')); } catch { /* pas de compteur : sans gravité */ } }

  // Compatibilité : les anciens J.toast(msg, type) passent par le centre d'alertes (en bas à droite).
  const toast = (msg, type = '') => { push({ type: type === 'err' ? 'err' : type === 'ok' ? 'ok' : 'info', title: String(msg), ttl: type === 'err' ? 10000 : 6000 }); };

  // Échap : ferme l'alerte la plus récente (si le focus est dans la pile, ou si rien d'autre n'utilise la touche).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !state.list.length) return;
    const inStack = !!(state.root && state.root.contains && state.root.contains(document.activeElement));
    const busy = !!document.querySelector('#modal-root .modal') || J.speaking || (J.state.mail && J.state.mail.reading != null);
    const t = e.target; const typing = !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')));
    if (!inStack && (busy || typing)) return;
    const last = [...state.list].sort((a, b) => b.seq - a.seq)[0]; if (last) { dismiss(last.id); e.preventDefault(); }
  });

  J.toast = toast;
  ensureRoot();
  J.notify = { push, dismiss, clear, list: () => state.list.map((a) => ({ id: a.id, type: a.type, title: a.title, detail: a.detail, urgent: a.urgent })), openMail, pushMail, setCounts, refresh, paint, counts: () => ({ ...state.counts }),
    MAX_VISIBLE, TTL, _tick: tick, _state: state, _sync: sync };
})();
