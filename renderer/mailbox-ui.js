// Boîte intelligente : « Alerte suivi » en tête, puis les courriels non lus de tous les comptes classés (urgent, attente de réaction,
// événements, importants, à lire, newsletters). Vue « Historique classé » pour retrouver les courriels déjà vus ou traités.
// Le classement est LOCAL (propre à Jarvis, sur cet ordinateur) : rien n'est déplacé, supprimé ni marqué lu dans la vraie boîte.
(() => {
  const SECTIONS = [
    ['urgent', '🚨', 'Urgent', 'Expéditeurs que vous avez marqués « toujours urgent »'],
    ['reaction', '⏳', 'Attente de réaction', 'Importants, et l’expéditeur attend quelque chose de vous'],
    ['event', '📅', 'Événements', 'Une date est annoncée : ajoutez-la à votre agenda'],
    ['important', '⭐', 'Importants', 'À lire en priorité'],
    ['info', 'ℹ️', 'À lire', 'Informations courantes'],
    ['promo', '🏷️', 'Newsletters et promotions', 'Envois en masse et notifications automatiques'],
  ];
  const LABEL = Object.fromEntries(SECTIONS.map(([id, ic, l]) => [id, l]));
  const ICON = Object.fromEntries(SECTIONS.map(([id, ic]) => [id, ic]));
  const LEVEL_ICON = { overdue: '⛔', today: '🔥', soon: '⏰', vip: '⭐', important: '❗', silent: '⏳' };
  const ALERT_MAX = 6;
  const CSS = `.mb .mb-top{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.mb h2{margin:0}.mb .mb-sub{color:var(--mute);font-size:13px;margin:2px 0 0}
.mb-local{display:flex;gap:8px;align-items:flex-start;margin:10px 0 0;padding:8px 12px;border-radius:10px;background:var(--soft);color:var(--mute);font-size:12.5px}
.mb-tabs{display:inline-flex;gap:4px;margin:12px 0 2px;padding:3px;border-radius:99px;background:var(--soft)}
.mb-tabs button{border:0;border-radius:99px;background:transparent;color:var(--mute);padding:5px 14px;font-size:13px}
.mb-tabs button[aria-pressed=true]{background:var(--card);color:var(--ink);box-shadow:0 1px 4px rgba(0,0,0,.2)}
.mb-pills{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}
.mb-pill{display:inline-flex;gap:7px;align-items:center;padding:6px 12px;border-radius:99px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:13px;font-weight:600;cursor:pointer}
.mb-pill b{background:var(--soft);border-radius:99px;padding:0 8px;min-width:22px;text-align:center}.mb-pill:hover{border-color:var(--acc)}
.mb-pill.hot{border-color:var(--acc2);box-shadow:0 0 0 2px color-mix(in srgb,var(--acc2) 22%,transparent)}.mb-pill.hot b{background:var(--acc2);color:#0a1f3f}
.mb-pill.red{border-color:#ff6b57;box-shadow:0 0 0 2px color-mix(in srgb,#ff6b57 24%,transparent)}.mb-pill.red b{background:#ff6b57;color:#fff}
.mb-note{border:1px solid color-mix(in srgb,var(--acc2) 55%,var(--line));background:color-mix(in srgb,var(--acc2) 12%,var(--card));border-radius:var(--r);padding:10px 14px;margin:10px 0;font-size:13px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.mb-note.ko{border-color:color-mix(in srgb,var(--ko) 55%,var(--line));background:color-mix(in srgb,var(--ko) 10%,var(--card))}
.mb-sec{margin-top:18px}.mb-sec>summary,.mb-sec>h3{list-style:none;cursor:default;display:flex;gap:10px;align-items:baseline;margin:0 0 8px;font-size:15px;font-weight:700}
.mb-sec>summary{cursor:pointer}.mb-sec>summary::-webkit-details-marker{display:none}.mb-sec .mb-sd{font-weight:400;color:var(--mute);font-size:12.5px}
.mb-card{display:grid;gap:6px;padding:12px 14px;border:1px solid var(--line);border-left:4px solid var(--c,var(--acc));border-radius:12px;background:var(--card);margin-bottom:8px;transition:opacity .25s,transform .25s,box-shadow .3s}
.mb-card.gone{opacity:0;transform:translateX(12px)}
.mb-card[data-cat=urgent]{--c:#ff6b57}.mb-card[data-cat=alert]{--c:#ff6b57}.mb-card[data-cat=reaction]{--c:#ff9f1c}.mb-card[data-cat=event]{--c:#4f8ff0}.mb-card[data-cat=important]{--c:#ffd21f}.mb-card[data-cat=promo]{--c:var(--line)}
.mb-card[data-level=soon],.mb-card[data-level=silent]{--c:#ff9f1c}.mb-card[data-level=important]{--c:#ffd21f}
.mb-card.mb-hl{box-shadow:0 0 0 3px var(--acc2),0 8px 24px rgba(0,0,0,.3)}
.mb-h{display:flex;gap:10px;justify-content:space-between;align-items:baseline;flex-wrap:wrap}.mb-h b{overflow-wrap:anywhere}
.mb-m{color:var(--mute);font-size:12.5px}.mb-s{font-size:13.5px}
.mb-why{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;font-weight:600;color:var(--ink);background:color-mix(in srgb,#ff9f1c 18%,var(--card));border:1px solid color-mix(in srgb,#ff9f1c 50%,var(--line));border-radius:99px;padding:2px 10px;width:fit-content}
.mb-why.lv-overdue,.mb-why.lv-today,.mb-why.lv-vip{background:color-mix(in srgb,#ff6b57 20%,var(--card));border-color:color-mix(in srgb,#ff6b57 60%,var(--line))}
.mb-ev{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,var(--acc) 10%,var(--card));border:1px solid color-mix(in srgb,var(--acc) 35%,var(--line))}
.mb-ev .t{font-weight:700}.mb-ev .w{color:var(--mute);font-size:12.5px}
.mb-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;align-items:center}
.mb-snz{position:relative}.mb-snz>summary{list-style:none;display:inline-flex;gap:6px;align-items:center;padding:4px 10px;font-size:12px;font-weight:600;border:1px solid transparent;border-radius:8px;color:var(--mute);cursor:pointer}
.mb-snz>summary::-webkit-details-marker{display:none}.mb-snz>summary:hover{color:var(--ink);background:var(--hover)}
.mb-snz[open]>summary{color:var(--ink);background:var(--soft)}.mb-snz .mb-snzb{display:inline-flex;gap:6px;margin-left:6px}
.mb-ai{font-size:11.5px;color:var(--mute)}
.mb-tag{display:inline-block;padding:1px 9px;border-radius:99px;font-size:11.5px;font-weight:600;background:var(--soft);color:var(--link);margin-right:4px}
.mb-tag.done{background:var(--pill-ok-bg);color:var(--pill-ok)}.mb-tag.vip{background:color-mix(in srgb,#ff6b57 22%,var(--card));color:var(--ink)}
.mb-empty{padding:22px;text-align:center;color:var(--mute);border:1px dashed var(--line);border-radius:var(--r)}
.mb-skel{height:64px;border-radius:12px;background:linear-gradient(90deg,var(--soft),var(--card),var(--soft));background-size:200% 100%;animation:mbsk 1.2s linear infinite;margin-bottom:8px}@keyframes mbsk{to{background-position:-200% 0}}
.mb-filt{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 10px;margin:12px 0 10px;align-items:start}.mb-filt label.f{margin:0 0 3px}.mb-filt input,.mb-filt select{height:38px;min-width:0}#mhCount{margin:0 0 8px}
.mb-vip-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)}.mb-vip-row:last-child{border:0}
.mb-vip-row code{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;background:var(--soft);padding:1px 7px;border-radius:6px;overflow-wrap:anywhere}
.mb-set-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 18px;align-items:center}
@media (prefers-reduced-motion:reduce){.mb-skel{animation:none}.mb-card{transition:none}}
.mb :focus-visible,.mb-set :focus-visible{outline:2px solid var(--acc);outline-offset:2px}`;
  const S = () => (J.state.mbx ||= { res: null, at: 0, loading: false, err: '', view: 'todo', extra: {}, alertAll: false, runP: null, hist: { q: '', category: '', account: '', from: '', to: '', status: 'all', items: [], total: 0, offset: 0, counts: {}, accounts: [], loading: false, loaded: false, err: '' } });
  const dayFmt = (iso) => { try { return new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return iso; } };
  const evWhen = (e) => { if (!e) return ''; const d = dayFmt(e.start.slice(0, 10)); if (e.allDay) return d + (e.end ? ' → ' + dayFmt(e.end) : ' · toute la journée'); return `${d}, ${e.start.slice(11, 16)}${e.end ? '–' + e.end.slice(11, 16) : ''}`; };
  const dl = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' }) : '';
  const lookup = (key) => { const s = S(); const r = s.res; return (r && r.items && r.items[key]) || (r && r.alerts && r.alerts.items.find((x) => x.key === key)) || s.hist.items.find((x) => x.key === key) || s.extra[key] || null; };
  const alertKeys = () => new Set((S().res?.alerts?.items || []).map((a) => a.key));
  const inGroups = (r, key) => r && r.groups ? Object.keys(r.groups).filter((g) => r.groups[g].includes(key)) : [];

  // ---------- Cartes ----------
  const actions = (it, extra = '') => `<div class="mb-act"><button class="sm ${it.categories && it.categories.includes('reaction') ? 'pri' : ''}" data-act="mbReply" data-key="${it.key}">↩ Répondre</button><button class="sm" data-act="mbRead" data-key="${it.key}">🔊 Lire</button><button class="sm" data-act="mbShow" data-key="${it.key}">👁 Afficher</button><button class="sm ghost" data-act="mbDone" data-key="${it.key}" title="Retire ce courriel de la liste (rien n'est modifié dans votre boîte)">✓ Traité</button>${extra}${vipBtn(it)}${it.source === 'règles' ? '<span class="mb-ai">analyse simple</span>' : ''}</div>`;
  const vipBtn = (it) => it.vip
    ? `<button class="sm ghost" data-act="mbVipOff" data-key="${it.key}" title="Cet expéditeur est classé urgent (${J.esc(it.vipPattern)})">Retirer des urgents</button>`
    : `<button class="sm ghost" data-act="mbVip" data-key="${it.key}" title="Classer désormais tous les courriels de cet expéditeur comme urgents">⭐ Toujours urgent</button>`;

  function card(it, sec) {
    const e = it.event; const react = it.categories.includes('reaction'); const r = S().res; const follow = alertKeys().has(it.key);
    const also = it.categories.filter((c) => c !== sec && c !== 'info' && c !== 'promo').map((c) => ({ urgent: 'urgent', reaction: 'attente de réaction', event: 'événement', important: 'important' }[c])).filter(Boolean);
    if (follow && sec !== 'alert') also.push('Alerte suivi');
    return `<article class="mb-card" data-cat="${sec}" data-key="${it.key}" aria-label="${J.esc(it.subject)}">
      <div class="mb-h"><b>${J.esc(it.subject)}</b><span class="mb-m">${J.esc(it.fromName || it.from)} · ${J.esc(it.accountLabel)} · ${J.esc(it.date ? J.fmtDate(it.date) : '')}</span></div>
      ${it.summary ? `<div class="mb-s">${J.esc(it.summary)}</div>` : ''}
      ${it.vip ? `<div class="mb-why lv-vip">⭐ Expéditeur urgent${it.vipLabel ? ' : ' + J.esc(it.vipLabel) : ''}</div>` : ''}
      ${react ? `<div class="mb-why">⏳ ${J.esc(it.reason || 'Une réponse ou une action est attendue')}${it.deadline && !/\d/.test(it.reason || '') ? ' · avant le ' + J.esc(dl(it.deadline)) : ''}</div>` : (it.reason && sec !== 'promo' && !it.vip ? `<div class="mb-m">${J.esc(it.reason)}</div>` : '')}
      ${e ? `<div class="mb-ev"><div><div class="t">📅 ${J.esc(e.title)}</div><div class="w">${J.esc(evWhen(e))}${e.location ? ' · ' + J.esc(e.location) : ''}</div></div><button class="pri sm" data-act="mbAddCal" data-key="${it.key}">📅 Ajouter à mon agenda</button></div>` : ''}
      ${also.length ? `<div class="mb-m">Aussi dans : ${also.map(J.esc).join(', ')}</div>` : ''}
      ${actions(it)}</article>`;
  }
  // Carte « Alerte suivi » : dit POURQUOI le courriel est en alerte.
  function alertCard(a, r) {
    const also = inGroups(r, a.key).filter((g) => g !== 'info' && g !== 'promo').map((g) => LABEL[g]);
    const more = (a.reasons || []).slice(1);
    const snooze = `<details class="mb-snz"><summary>⏰ Rappeler plus tard</summary><span class="mb-snzb"><button class="sm" data-act="mbSnooze" data-key="${a.key}" data-days="1">Demain</button><button class="sm" data-act="mbSnooze" data-key="${a.key}" data-days="7">Dans 1 semaine</button></span></details>`;
    return `<article class="mb-card" data-cat="alert" data-level="${a.level}" data-key="${a.key}" aria-label="Alerte de suivi : ${J.esc(a.subject)}">
      <div class="mb-h"><b>${J.esc(a.subject)}</b><span class="mb-m">${J.esc(a.fromName || a.from)} · ${J.esc(a.accountLabel)} · ${J.esc(a.date ? J.fmtDate(a.date) : '')}</span></div>
      <div><span class="mb-why lv-${a.level}">${LEVEL_ICON[a.level] || '🔔'} ${J.esc(a.reason)}</span>${a.vipLabel ? ` <span class="mb-m">${J.esc(a.vipLabel)}</span>` : ''}</div>
      ${more.length ? `<div class="mb-m">Aussi : ${more.map(J.esc).join(' · ')}</div>` : ''}
      ${a.summary ? `<div class="mb-s">${J.esc(a.summary)}</div>` : ''}
      ${also.length ? `<div class="mb-m">Aussi dans : ${also.map(J.esc).join(', ')}</div>` : ''}
      ${actions(a, snooze)}</article>`;
  }
  function alertSection(r, { max = ALERT_MAX, full = false } = {}) {
    const al = r.alerts; if (!al || !al.count) return '';
    const shown = full || S().alertAll ? al.items : al.items.slice(0, max);
    return `<section class="mb-sec" id="mbsec-alert" aria-labelledby="mbal-h"><h3 id="mbal-h"><span>🔔 Alerte suivi (${al.count})</span><span class="mb-sd">Pas encore traités : échéances, expéditeurs urgents, très importants, sans réponse depuis plus de 48 h</span></h3>${shown.map((a) => alertCard(a, r)).join('')}${!full && al.count > max ? `<button class="sm" data-act="mbAlertsMore">${S().alertAll ? 'Réduire la liste' : `Afficher les ${al.count - max} autres alertes`}</button>` : ''}</section>`;
  }
  const histCard = (it) => {
    const st = it.status === 'done' || it.status === 'ignored' ? '<span class="mb-tag done">✓ Traité</span>' : (it.snooze && Date.parse(it.snooze) > Date.now() ? `<span class="mb-tag">⏰ Rappel le ${J.esc(new Date(it.snooze).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' }))}</span>` : '<span class="mb-tag">À traiter</span>');
    const cats = it.categories.map((c) => `<span class="mb-tag ${c === 'urgent' ? 'vip' : ''}">${ICON[c] || ''} ${J.esc(LABEL[c] || c)}</span>`).join('');
    const closed = it.status === 'done' || it.status === 'ignored';
    return `<article class="mb-card" data-cat="${it.category}" data-key="${it.key}" aria-label="${J.esc(it.subject)}">
      <div class="mb-h"><b>${J.esc(it.subject)}</b><span class="mb-m">${J.esc(it.fromName || it.from)} · ${J.esc(it.accountLabel)} · ${J.esc(it.date ? J.fmtDate(it.date) : '')}</span></div>
      <div>${cats}${st}</div>${it.summary ? `<div class="mb-s">${J.esc(it.summary)}</div>` : ''}
      <div class="mb-act"><button class="sm" data-act="mbShow" data-key="${it.key}">👁 Afficher</button><button class="sm" data-act="mbReply" data-key="${it.key}">↩ Répondre</button>${closed ? `<button class="sm" data-act="mbReopen" data-key="${it.key}">↺ Remettre à traiter</button>` : `<button class="sm ghost" data-act="mbDone" data-key="${it.key}">✓ Traité</button>`}${vipBtn(it)}</div></article>`;
  };

  // ---------- Page ----------
  function head(s) {
    const r = s.res;
    return `<div class="mb-top"><div><h2>📬 Boîte intelligente</h2><div class="mb-sub">Jarvis relève vos courriels de tous vos comptes et les range par catégorie. Lecture seule : rien n'est marqué lu.</div></div>
      <div class="row"><button class="pri" data-act="mbRun" ${s.loading ? 'disabled' : ''}>${s.loading ? '<span class="spin"></span> Analyse…' : '✨ Analyser mes mails non lus'}</button>${r && !s.loading && s.view === 'todo' ? '<button class="sm" data-act="mbRerun" title="Relance l\'analyse complète, même pour les courriels déjà classés">Tout reclasser</button>' : ''}</div></div>
      <div class="mb-local"><span aria-hidden="true">🗂️</span><span><b>Classement local.</b> Jarvis range les courriels dans ses propres dossiers (catégories et historique, sur cet ordinateur). Rien n'est déplacé, supprimé ni marqué lu dans votre vraie boîte.</span></div>
      <div class="mb-tabs" role="group" aria-label="Affichage"><button data-act="mbView" data-v="todo" aria-pressed="${s.view === 'todo'}">Non lus à traiter</button><button data-act="mbView" data-v="history" aria-pressed="${s.view === 'history'}">Historique classé</button></div>`;
  }
  function todoBody(s) {
    const r = s.res; let body = '';
    if (s.loading && !r) return '<div class="mb-skel"></div><div class="mb-skel"></div><div class="mb-skel"></div>';
    if (s.err && !r) return `<div class="mb-note ko" role="alert"><span>${J.esc(s.err)}</span><button class="sm" data-act="mbRun">Réessayer</button></div>`;
    if (r && r.noAccount) return '<div class="mb-empty">Ajoutez un compte courriel (IMAP/SMTP ou Google) pour que Jarvis trie votre courrier.</div>';
    if (!r) return '';
    const c = r.counts; const notes = [];
    if (r.consentNeeded) notes.push(`<div class="mb-note"><span><b>Analyse simple (sans IA).</b> Pour une analyse plus fine, Jarvis doit envoyer le contenu de vos courriels non lus à votre moteur IA en ligne.</span><span class="row"><button class="sm pri" data-act="mbAllow">Autoriser cette fois</button><button class="sm" data-act="mbAllowAlways">Toujours autoriser</button></span></div>`);
    else if (!r.aiConfigured) notes.push('<div class="mb-note"><span><b>Analyse simple (sans IA).</b> Configurez un moteur IA dans Réglages pour un classement plus précis.</span><a class="btn sm" href="#reglages">Ouvrir les Réglages</a></div>');
    for (const e of r.errors || []) notes.push(`<div class="mb-note ko" role="alert"><span>${J.esc(e)}</span></div>`);
    for (const n of r.notes || []) notes.push(`<div class="mb-note"><span>L'IA n'a pas pu analyser une partie des courriels (${J.esc(n)}). Ils sont classés par règles simples.</span></div>`);
    const nAl = r.alerts ? r.alerts.count : 0;
    const pills = (nAl ? `<button class="mb-pill ${r.alerts.urgent ? 'red' : 'hot'}" data-act="mbGo" data-sec="alert" aria-label="Alerte suivi : ${nAl}">🔔 Alerte suivi <b>${nAl}</b></button>` : '') + SECTIONS.map(([id, ic, label]) => `<button class="mb-pill ${id === 'urgent' && c[id] ? 'red' : id === 'reaction' && c[id] ? 'hot' : ''}" data-act="mbGo" data-sec="${id}" aria-label="${label} : ${c[id] || 0}">${ic} ${label} <b>${c[id] || 0}</b></button>`).join('');
    body = `${notes.join('')}<div class="mb-pills" role="navigation" aria-label="Catégories">${pills}</div><div class="mb-m" aria-live="polite">${r.total} courriel${r.total > 1 ? 's' : ''} non lu${r.total > 1 ? 's' : ''} analysé${r.total > 1 ? 's' : ''} · ${r.aiUsed ? 'classement par l’IA' : 'classement par règles'} · ${J.esc(J.fmtDate(r.at))}</div>`;
    body += alertSection(r);
    if (!r.total && !nAl) body += '<div class="mb-empty" style="margin-top:12px">🎉 Aucun courriel non lu à traiter.</div>';
    for (const [id, ic, label, desc] of SECTIONS) {
      const keys = r.groups[id] || []; if (!keys.length) continue;
      const cards = keys.map((k) => card(r.items[k], id)).join('');
      if (id === 'info' || id === 'promo') body += `<details class="mb-sec" id="mbsec-${id}"><summary><span>${ic} ${label} (${keys.length})</span><span class="mb-sd">${desc}</span></summary>${cards}</details>`;
      else body += `<section class="mb-sec" id="mbsec-${id}"><h3><span>${ic} ${label} (${keys.length})</span><span class="mb-sd">${desc}</span></h3>${cards}</section>`;
    }
    return body;
  }
  function histBody(s) {
    const h = s.hist; const opt = (v, sel, l) => `<option value="${J.esc(v)}" ${v === sel ? 'selected' : ''}>${J.esc(l)}</option>`;
    const cats = opt('', h.category, 'Toutes les catégories') + SECTIONS.map(([id, ic, l]) => opt(id, h.category, `${ic} ${l}${h.counts && h.counts[id] != null ? ' (' + h.counts[id] + ')' : ''}`)).join('');
    const accs = opt('', h.account, 'Tous les comptes') + (h.accounts || []).map((a) => opt(a.id, h.account, a.label)).join('');
    return `<div class="mb-filt" role="search" aria-label="Filtrer l'historique">
      <div><label class="f" for="mhQ">Recherche</label><input id="mhQ" type="search" placeholder="Expéditeur, objet, texte…" value="${J.esc(h.q)}" autocomplete="off"></div>
      <div><label class="f" for="mhCat">Catégorie</label><select id="mhCat">${cats}</select></div>
      <div><label class="f" for="mhAcc">Compte</label><select id="mhAcc">${accs}</select></div>
      <div><label class="f" for="mhSt">Statut</label><select id="mhSt">${opt('all', h.status, 'Tous')}${opt('open', h.status, 'À traiter')}${opt('done', h.status, 'Traités')}</select></div>
      <div><label class="f" for="mhFrom">Du</label><input id="mhFrom" type="date" value="${J.esc(h.from)}"></div>
      <div><label class="f" for="mhTo">Au</label><input id="mhTo" type="date" value="${J.esc(h.to)}"></div></div>
      <div class="mb-m" role="status" aria-live="polite" id="mhCount"></div><div id="mhList"></div>`;
  }
  function renderHistList() {
    const s = S(); const h = s.hist; const list = document.getElementById('mhList'); if (!list) return;
    const cnt = document.getElementById('mhCount');
    if (cnt) cnt.textContent = h.loading ? 'Recherche…' : h.err ? '' : `${h.total} courriel${h.total > 1 ? 's' : ''} dans l’historique local${h.total > h.items.length ? ` · ${h.items.length} affiché${h.items.length > 1 ? 's' : ''}` : ''}`;
    if (h.err) { list.innerHTML = `<div class="mb-note ko" role="alert"><span>${J.esc(h.err)}</span><button class="sm" data-act="mbHistReload">Réessayer</button></div>`; return; }
    if (h.loading && !h.items.length) { list.innerHTML = '<div class="mb-skel"></div><div class="mb-skel"></div>'; return; }
    list.innerHTML = h.items.length ? h.items.map(histCard).join('') + (h.total > h.items.length ? '<button class="sm" data-act="mbHistMore">Afficher plus</button>' : '') : '<div class="mb-empty">Aucun courriel ne correspond. L’historique se remplit au fil des analyses ; il est conservé sur cet ordinateur.</div>';
  }
  async function loadHist(more) {
    const s = S(); const h = s.hist; const my = (h.seq = (h.seq || 0) + 1); h.loading = true; h.err = ''; if (!more) h.offset = 0; renderHistList();
    try {
      const r = await J.call('mailbox.history', { q: h.q, category: h.category, account: h.account, from: h.from, to: h.to, status: h.status, limit: 50, offset: more ? h.items.length : 0 });
      if (my !== h.seq) return;
      h.items = more ? h.items.concat(r.items) : r.items; h.total = r.total; h.counts = r.counts; h.accounts = r.accounts; h.loaded = true;
      if (!more) { const sel = document.getElementById('mhCat'); if (sel) for (const o of sel.options) if (o.value && r.counts[o.value] != null) o.textContent = `${ICON[o.value] || ''} ${LABEL[o.value]} (${r.counts[o.value]})`; }
    } catch (e) { if (my === h.seq) h.err = e.message || String(e); }
    finally { if (my === h.seq) { h.loading = false; renderHistList(); } }
  }

  function bind(host) {
    if (host.__mb) return; host.__mb = true;
    const deb = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => loadHist(false), 250); }; })();
    host.addEventListener('input', (e) => { if (e.target.id === 'mhQ') { S().hist.q = e.target.value; deb(); } });
    host.addEventListener('change', (e) => {
      const h = S().hist; const map = { mhCat: 'category', mhAcc: 'account', mhSt: 'status', mhFrom: 'from', mhTo: 'to' };
      if (map[e.target.id]) { h[map[e.target.id]] = e.target.value; loadHist(false); }
    });
  }
  function render(host) {
    const s = S(); if (!host) return; bind(host);
    const keepFocus = document.activeElement && host.contains(document.activeElement) ? document.activeElement.id : '';
    host.innerHTML = `<div class="card mb"><style>${CSS}</style>${head(s)}${s.view === 'history' ? histBody(s) : todoBody(s)}</div>`;
    if (s.view === 'history') renderHistList();
    if (keepFocus) document.getElementById(keepFocus)?.focus();
  }

  // Rendu réutilisable (écran Jarvis) : mêmes cartes, mêmes boutons, mêmes actions.
  J.mbSectionsHtml = (r, { sections = ['urgent', 'reaction', 'event', 'important'], max = 5 } = {}) => {
    const s = S(); for (const it of Object.values(r.items || {})) s.extra[it.key] = it; for (const a of (r.alerts?.items || [])) s.extra[a.key] = a;
    const prevRes = s.res; s.res = r; // les cartes consultent cette analyse pour « Aussi dans… »
    try {
      let h = `<style>${CSS}</style><div class="mb">`;
      if (r.alertsOnly) return h + (r.alerts.count ? alertSection(r, { max: 8 }) : '<div class="mb-empty">Aucune alerte de suivi : tout est à jour.</div>') + '</div>';
      h += `<div class="mb-pills">${SECTIONS.map(([id, ic, label]) => `<span class="mb-pill ${id === 'urgent' && r.counts[id] ? 'red' : id === 'reaction' && r.counts[id] ? 'hot' : ''}">${ic} ${label} <b>${r.counts[id] || 0}</b></span>`).join('')}</div>`;
      for (const [id, ic, label, desc] of SECTIONS) {
        if (!sections.includes(id)) continue; const keys = (r.groups[id] || []).slice(0, max); if (!keys.length) continue;
        h += `<section class="mb-sec"><h3><span>${ic} ${label} (${r.counts[id]})</span><span class="mb-sd">${desc}</span></h3>${keys.map((k) => card(r.items[k], id)).join('')}</section>`;
      }
      return h + '</div>';
    } finally { s.res = prevRes; }
  };

  async function run(opts = {}) {
    const s = S(); if (s.loading) return s.runP; s.loading = true; s.err = ''; render(document.getElementById('smartBox'));
    s.runP = (async () => {
      try { s.res = await J.call('mailbox.triage', { allowCloud: opts.allow === true || s.allow === true, force: !!opts.force }); s.at = Date.now(); if (s.res.alerts && J.notify) J.notify.setCounts(s.res.alerts); }
      catch (e) { s.err = e.message || String(e); }
      finally { s.loading = false; render(document.getElementById('smartBox')); }
    })();
    return s.runP;
  }
  J.mountMailbox = (host) => {
    const s = S(); render(host);
    const k = J.state.openMailKey; if (k) { J.state.openMailKey = null; setTimeout(() => J.mbOpenKey(k), 0); return; }
    if (s.view === 'history' && !s.hist.loaded) loadHist(false);
    if (!s.res || Date.now() - s.at > 180000) run();
  };
  J.mbRun = run;
  J.mbSoftRefresh = () => { if (document.getElementById('smartBox') && S().view === 'todo' && !S().loading) run({}); else if (S().view === 'history') loadHist(false); };

  // Ouvre un courriel précis (clic sur une alerte) : défile jusqu'à lui, le met en évidence et l'affiche. S'il n'est plus dans la liste : rechargement.
  J.mbOpenKey = async (key) => {
    const s = S(); const host = document.getElementById('smartBox'); key = String(key || '');
    if (!host) { J.state.openMailKey = key; return; }
    s.view = 'todo';
    if (s.runP && s.loading) await s.runP.catch(() => {});
    const present = () => !!lookup(key) && !!host.querySelector(`.mb-card[data-key="${key}"]`);
    if (!s.res || !(s.res.items[key] || s.res.alerts?.items.some((x) => x.key === key))) await run({}); else render(host);
    const el = present() ? host.querySelector(`.mb-card[data-key="${key}"]`) : null;
    if (el) {
      const sec = el.closest('details'); if (sec) sec.open = true;
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      el.classList.add('mb-hl'); el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); setTimeout(() => el.classList.remove('mb-hl'), 3500);
    }
    await J.act.mbShow({ dataset: { key } });
  };

  // ---------- Actions ----------
  const msgOf = async (key) => { try { return await J.call('mailbox.message', { key }); } catch { const it = lookup(key); return it && it.message ? it.message : null; } };
  J.act.mbRun = () => run({});
  J.act.mbRerun = () => run({ force: true });
  J.act.mbAllow = () => { S().allow = true; run({ allow: true, force: true }); };
  J.act.mbAllowAlways = async () => { await J.call('mailbox.consent', { always: true }); J.S = await J.call('settings.get'); S().allow = true; run({ allow: true, force: true }); };
  J.act.mbGo = (el) => { const t = document.getElementById('mbsec-' + el.dataset.sec); if (!t) return; if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  J.act.mbView = (el) => { const s = S(); s.view = el.dataset.v === 'history' ? 'history' : 'todo'; render(document.getElementById('smartBox')); if (s.view === 'history') loadHist(false); };
  J.act.mbAlertsMore = () => { const s = S(); s.alertAll = !s.alertAll; render(document.getElementById('smartBox')); };
  J.act.mbHistMore = () => loadHist(true);
  J.act.mbHistReload = () => loadHist(false);
  J.act.mbReply = async (el) => { const m = await msgOf(el.dataset.key); if (m) J.mailReply(m); else J.toast("Ce courriel est introuvable : relancez l'analyse.", 'err'); };
  J.act.mbRead = async (el) => { const m = await msgOf(el.dataset.key); if (!m) return J.toast("Ce courriel est introuvable : relancez l'analyse.", 'err'); J.stopReading(); J.readMails([m]); };
  J.act.mbShow = async (el) => {
    const key = el.dataset.key; let m = null;
    try { m = await J.call('mailbox.message', { key }); } catch { const it = lookup(key); m = it && it.message ? it.message : null; }
    if (!m) return J.toast("Ce courriel est introuvable : relancez l'analyse.", 'err');
    J.modal(`<h2>${J.esc(m.subject)}</h2><div class="muted small">${J.esc(m.from)} · ${J.esc(m.date ? J.fmtDate(m.date) : '')}</div><div class="row" style="margin:10px 0"><button class="sm" data-act="mbRead" data-key="${J.esc(key)}">🔊 Lire</button><button class="sm pri" data-act="mbReply" data-key="${J.esc(key)}">↩ Répondre</button><button class="sm" data-act="closeModal">Fermer</button></div>${m.partial ? '<div class="mail-warn" role="note">Seul le début du message est conservé sur cet ordinateur : le courriel complet n’a pas pu être relu depuis votre boîte.</div>' : ''}${J.mailBody(m, 0)}`);
    J.mountMailFrames();
  };
  const dropLocal = (key) => {
    const r = S().res; const h = S().hist;
    if (r) { for (const g of Object.keys(r.groups)) r.groups[g] = r.groups[g].filter((k) => k !== key); delete r.items[key]; r.total = Object.keys(r.items).length; r.counts = Object.fromEntries(Object.entries(r.groups).map(([k, v]) => [k, v.length]));
      if (r.alerts) { r.alerts.items = r.alerts.items.filter((a) => a.key !== key); r.alerts.count = r.alerts.items.length; r.alerts.urgent = r.alerts.items.filter((a) => a.urgent).length; } }
    const hi = h.items.find((x) => x.key === key); if (hi) hi.status = 'done';
  };
  J.act.mbDone = async (el) => {
    const key = el.dataset.key; const card = el.closest('.mb-card');
    try { await J.call('mailbox.status', { key, status: 'done' }); } catch (e) { return J.err(e); }
    if (card) card.classList.add('gone');
    setTimeout(() => { dropLocal(key); if (S().view === 'history') loadHist(false); else render(document.getElementById('smartBox')); if (J.notify) J.notify.refresh(); }, 260);
  };
  J.act.mbReopen = async (el) => {
    try { await J.call('mailbox.status', { key: el.dataset.key, status: 'new' }); } catch (e) { return J.err(e); }
    J.toast('Remis à traiter', 'ok'); loadHist(false); if (J.notify) J.notify.refresh();
  };
  J.act.mbSnooze = async (el) => {
    const key = el.dataset.key; const days = Number(el.dataset.days) || 1;
    try { await J.call('mailbox.snooze', { key, days }); } catch (e) { return J.err(e); }
    const r = S().res; if (r && r.alerts) { r.alerts.items = r.alerts.items.filter((a) => a.key !== key); r.alerts.count = r.alerts.items.length; r.alerts.urgent = r.alerts.items.filter((a) => a.urgent).length; }
    render(document.getElementById('smartBox')); J.toast(days === 1 ? 'Je vous le rappelle demain.' : `Je vous le rappelle dans ${days === 7 ? 'une semaine' : days + ' jours'}.`, 'ok'); if (J.notify) J.notify.refresh();
  };

  // ---------- Expéditeurs urgents ----------
  J.act.mbVip = (el) => {
    const it = lookup(el.dataset.key); if (!it) return J.toast("Ce courriel est introuvable : relancez l'analyse.", 'err');
    const addr = it.senderAddr; if (!addr) return J.toast("Impossible de lire l'adresse de l'expéditeur.", 'err');
    const dom = addr.slice(addr.indexOf('@'));
    J.modal(`<h2>⭐ Toujours urgent</h2><p>Les prochains courriels de cet expéditeur seront classés <b>Urgent</b> (importance maximale, jamais rangés en newsletter) et déclencheront une alerte qui reste affichée. Les courriels déjà reçus et non traités sont reclassés tout de suite. Rien n'est modifié dans votre boîte.</p>
      <label class="chk"><input type="radio" name="vipScope" value="address" checked> Cette adresse : <b>&nbsp;${J.esc(addr)}</b></label>
      <label class="chk"><input type="radio" name="vipScope" value="domain" ${it.senderDomainOk ? '' : 'disabled'}> Tout le domaine : <b>&nbsp;${J.esc(dom)}</b>${it.senderDomainOk ? '' : '&nbsp;(indisponible : fournisseur de messagerie public)'}</label>
      <label class="f" for="vipLabel">Nom (facultatif)</label><input id="vipLabel" value="${J.esc(it.fromName || '')}" maxlength="80">
      <div class="row" style="margin-top:14px"><button class="pri" data-act="mbVipGo" data-key="${J.esc(it.key)}">Confirmer</button><button data-act="closeModal">Annuler</button></div>`, null, { narrow: true });
  };
  J.act.mbVipGo = (el) => J.busy(el, async () => {
    const scope = document.querySelector('input[name=vipScope]:checked')?.value === 'domain' ? 'domain' : 'address';
    const r = await J.call('mailbox.vip.add', { key: el.dataset.key, scope, label: J.val('vipLabel') || '' });
    J.closeModal(); J.toast(`Expéditeur urgent enregistré${r.reclassified ? ' · ' + r.reclassified + ' courriel' + (r.reclassified > 1 ? 's' : '') + ' reclassé' + (r.reclassified > 1 ? 's' : '') : ''}.`, 'ok');
    await afterVipChange();
  }, 'Enregistrement…');
  J.act.mbVipOff = async (el) => {
    const it = lookup(el.dataset.key); if (!it || !it.vipPattern) return;
    if (!(await J.confirm(`Les courriels de « ${it.vipPattern} » ne seront plus classés urgents (les courriels non traités déjà reçus sont reclassés).`, { ok: 'Retirer des urgents', title: 'Retirer des urgents' }))) return;
    try { await J.call('mailbox.vip.remove', { pattern: it.vipPattern }); } catch (e) { return J.err(e); }
    J.toast('Retiré des expéditeurs urgents.', 'ok'); await afterVipChange();
  };
  async function afterVipChange() {
    const s = S(); if (s.view === 'history') await loadHist(false); else await run({});
    if (document.getElementById('mbVip')) mountSettings(document.getElementById('mbSettings'));
    if (J.notify) J.notify.refresh();
  }

  // Panneau « Expéditeurs urgents » + réglages de la surveillance (page Courriels)
  async function mountSettings(host) {
    if (!host) return;
    let vip = { vip: [], max: 200 }; let st = null;
    try { vip = await J.call('mailbox.vip.list'); st = await J.call('mailbox.watch.status'); } catch (e) { host.innerHTML = `<div class="card"><div class="mb-note ko" role="alert"><span>${J.esc(J.errMsg(e))}</span></div></div>`; return; }
    const m = (J.S && J.S.mail) || {}; const sel = (v, cur, l) => `<option value="${v}" ${Number(cur) === v ? 'selected' : ''}>${l}</option>`;
    const last = st.lastRun ? `Dernier passage : ${J.fmtDate(st.lastRun.at)}${st.lastRun.fresh ? ` · ${st.lastRun.fresh} nouveau${st.lastRun.fresh > 1 ? 'x' : ''}` : ''}${st.lastRun.error ? ' · ' + J.esc(st.lastRun.error) : ''}` : 'Pas encore de passage depuis le démarrage.';
    host.innerHTML = `<style>${CSS}</style><div class="card mb-set" id="mbVip"><div class="row sp"><h2 style="margin:0">⭐ Expéditeurs urgents</h2><span class="muted small">${vip.vip.length} / ${vip.max}</span></div>
      <p class="muted small">Tout courriel reçu d'un expéditeur de cette liste est classé <b>Urgent</b> (importance maximale, jamais rangé en newsletter) et déclenche une alerte qui reste affichée. Vous pouvez aussi utiliser « ⭐ Toujours urgent » sur n'importe quelle carte de courriel. L'expéditeur est lu dans l'en-tête « De » du message.</p>
      <div id="mbVipList">${vip.vip.length ? vip.vip.map((e) => `<div class="mb-vip-row"><span><code>${J.esc(e.pattern)}</code> <span class="mb-tag">${e.pattern[0] === '@' ? 'tout le domaine' : 'adresse'}</span> ${e.label ? J.esc(e.label) : ''}</span><button class="sm danger" data-act="mbVipDel" data-p="${J.esc(e.pattern)}" aria-label="Retirer ${J.esc(e.pattern)} des urgents">Retirer</button></div>`).join('') : '<div class="mb-empty">Aucun expéditeur urgent pour l’instant.</div>'}</div>
      <div class="grid g2" style="margin-top:10px"><div><label class="f" for="vipPat">Adresse ou domaine</label><input id="vipPat" placeholder="marie@exemple.be ou @parlement.brussels" autocomplete="off" spellcheck="false" data-enter="mbVipAdd" maxlength="254"></div><div><label class="f" for="vipLab">Nom (facultatif)</label><input id="vipLab" placeholder="Présidente de la commission" maxlength="80" data-enter="mbVipAdd"></div></div>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="mbVipAdd" ${vip.vip.length >= vip.max ? 'disabled' : ''}>+ Ajouter</button><span id="vipErr" class="small" role="alert" style="color:var(--ko)"></span></div></div>
      <div class="card mb-set" id="mbWatch"><h2 style="margin:0 0 6px">🔔 Surveillance et alertes</h2>
      <p class="muted small">Jarvis relève vos nouveaux courriels en arrière-plan, en lecture seule (rien n'est marqué lu, déplacé ni supprimé), classe chaque message sur cet ordinateur et vous prévient. Sans votre accord, aucun contenu n'est envoyé à un moteur IA en ligne : le classement se fait alors par règles simples.</p>
      <div class="mb-set-grid"><label class="chk"><input type="checkbox" id="wOn" ${m.watch !== false ? 'checked' : ''}> Surveiller mes courriels</label>
      <div><label class="f" for="wMin">Vérifier toutes les</label><select id="wMin">${[1, 2, 3, 5, 10, 15, 30, 60].map((n) => sel(n, m.watchMinutes || 3, n + ' minute' + (n > 1 ? 's' : ''))).join('')}</select></div>
      <label class="chk"><input type="checkbox" id="wPrev" ${m.notifyPreview !== false ? 'checked' : ''}> Afficher l'objet dans les notifications</label>
      <div><label class="f" for="wFol">Échéances signalées dans les</label><select id="wFol">${[2, 3, 5, 7, 10, 14, 21, 30].map((n) => sel(n, m.followDays || 7, n + ' jours')).join('')}</select></div></div>
      <div class="row" style="margin-top:12px"><button class="pri" data-act="mbWatchSave">Enregistrer</button><button data-act="mbWatchRun">Vérifier maintenant</button><span class="muted small" id="wStat" role="status" aria-live="polite">${last}</span></div>
      ${(st.accounts || []).filter((a) => a.error).map((a) => `<div class="mb-note ko" role="alert"><span><b>${J.esc(a.label)}</b> : ${J.esc(a.error)}</span></div>`).join('')}</div>`;
  }
  J.mountMailSettings = (host) => mountSettings(host);
  J.act.mbVipAdd = (el) => J.busy(el, async () => {
    const err = document.getElementById('vipErr'); if (err) err.textContent = '';
    try { const r = await J.call('mailbox.vip.add', { pattern: J.val('vipPat'), label: J.val('vipLab') || '' }); J.toast(`Expéditeur urgent ajouté${r.reclassified ? ' · ' + r.reclassified + ' courriel' + (r.reclassified > 1 ? 's' : '') + ' reclassé' + (r.reclassified > 1 ? 's' : '') : ''}.`, 'ok'); }
    catch (e) { if (err) err.textContent = J.errMsg(e); document.getElementById('vipPat')?.focus(); return; }
    await afterVipChange();
  }, 'Ajout…');
  J.act.mbVipDel = async (el) => {
    const p = el.dataset.p; if (!(await J.confirm(`Retirer « ${p} » des expéditeurs urgents ?`, { ok: 'Retirer', title: 'Retirer des urgents', danger: true }))) return;
    try { await J.call('mailbox.vip.remove', { pattern: p }); } catch (e) { return J.err(e); }
    J.toast('Retiré des expéditeurs urgents.', 'ok'); await afterVipChange();
  };
  J.act.mbWatchSave = (el) => J.busy(el, async () => {
    await J.call('mailbox.watch.configure', { watch: !!J.val('wOn'), watchMinutes: Number(J.val('wMin')), notifyPreview: !!J.val('wPrev'), followDays: Number(J.val('wFol')) });
    J.S = await J.call('settings.get'); J.toast('Réglages de la surveillance enregistrés.', 'ok'); if (S().view === 'todo') run({}); if (J.notify) J.notify.refresh();
  }, 'Enregistrement…');
  J.act.mbWatchRun = (el) => J.busy(el, async () => {
    const r = await J.call('mailbox.watch.run');
    const stat = document.getElementById('wStat');
    const msg = r.skipped ? 'Un passage est déjà en cours.' : r.ok === false ? `Échec : ${r.error || 'erreur inconnue'}` : r.fresh ? `${r.fresh} nouveau${r.fresh > 1 ? 'x' : ''} courriel${r.fresh > 1 ? 's' : ''} détecté${r.fresh > 1 ? 's' : ''}.` : 'Rien de nouveau.';
    if (stat) stat.textContent = msg; else J.toast(msg);
    if (!r.skipped) { await mountSettings(document.getElementById('mbSettings')); if (S().view === 'todo') run({}); }
  }, 'Vérification…');

  // ---- Ajouter à mon agenda : l'utilisateur vérifie et corrige, puis choisit Google Agenda ou Agenda (Apple) ----
  J.act.mbAddCal = (el) => {
    const it = lookup(el.dataset.key); if (!it || !it.event) return; const e = it.event; const t = e.allDay ? '' : e.start.slice(11, 16);
    J.modal(`<h2>📅 Ajouter à mon agenda</h2><p class="muted small">Vérifiez les informations trouvées dans le courriel « ${J.esc(it.subject)} ». Rien n'est ajouté tant que vous ne validez pas dans votre agenda.</p>
      <label class="f" for="mcT">Titre</label><input id="mcT" value="${J.esc(e.title)}" maxlength="160">
      <div class="grid g3"><div><label class="f" for="mcD">Jour</label><input id="mcD" type="date" value="${J.esc(e.start.slice(0, 10))}"></div><div><label class="f" for="mcS">Début</label><input id="mcS" type="time" value="${J.esc(t)}" ${e.allDay ? 'disabled' : ''}></div><div><label class="f" for="mcE">Fin</label><input id="mcE" type="time" value="${J.esc(e.end && !e.allDay ? e.end.slice(11, 16) : '')}" ${e.allDay ? 'disabled' : ''}></div></div>
      <label class="chk"><input type="checkbox" id="mcA" ${e.allDay ? 'checked' : ''}> Toute la journée</label>
      <label class="f" for="mcL">Lieu ou lien</label><input id="mcL" value="${J.esc(e.location || '')}" maxlength="200">
      <p class="muted small">Heure de Bruxelles. <b>Google Agenda</b> s'ouvre dans votre navigateur, pré-rempli. <b>Agenda (Apple)</b> ouvre l'application Agenda de votre Mac, qui se synchronise avec vos autres agendas.</p>
      <div class="row" style="margin-top:12px"><button class="pri" data-act="mbCalGo" data-t="google" data-key="${it.key}">Google Agenda</button><button data-act="mbCalGo" data-t="apple" data-key="${it.key}">Agenda (Apple / .ics)</button><button data-act="closeModal">Annuler</button></div>`);
    document.getElementById('mcA').addEventListener('change', (ev) => { document.getElementById('mcS').disabled = document.getElementById('mcE').disabled = ev.target.checked; });
  };
  J.act.mbCalGo = (el) => J.busy(el, async () => {
    const day = J.val('mcD'), all = J.val('mcA'), st = J.val('mcS'), en = J.val('mcE');
    if (!day) return J.toast('Choisissez le jour.', 'err'); if (!all && !st) return J.toast("Indiquez l'heure de début, ou cochez « Toute la journée ».", 'err');
    const ev = { title: J.val('mcT').trim(), start: all ? day : `${day}T${st}`, end: all ? '' : (en ? `${day}T${en}` : ''), location: J.val('mcL').trim() };
    if (!ev.title) return J.toast('Donnez un titre à l’événement.', 'err');
    await J.call('mailbox.event.save', { key: el.dataset.key, event: ev });
    const r = await J.call('mailbox.event.open', { key: el.dataset.key, target: el.dataset.t, event: ev });
    J.closeModal(); J.toast(r.opened === 'google' ? 'Google Agenda est ouvert : cliquez sur Enregistrer.' : 'L’application Agenda est ouverte : validez l’ajout.', 'ok');
    const it = lookup(el.dataset.key); if (it) { it.event = { ...(it.event || {}), ...ev, allDay: !!all }; }
  }, 'Ouverture…');
})();
