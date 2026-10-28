// Boîte intelligente : courriels non lus de tous les comptes, classés (attente de réaction, événements, importants, à lire, newsletters).
(() => {
  const SECTIONS = [
    ['reaction', '⏳', 'Attente de réaction', 'Importants, et l’expéditeur attend quelque chose de vous'],
    ['event', '📅', 'Événements', 'Une date est annoncée : ajoutez-la à votre agenda'],
    ['important', '⭐', 'Importants', 'À lire en priorité'],
    ['info', 'ℹ️', 'À lire', 'Informations courantes'],
    ['promo', '🏷️', 'Newsletters et promotions', 'Envois en masse et notifications automatiques'],
  ];
  const CSS = `.mb .mb-top{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.mb h2{margin:0}.mb .mb-sub{color:var(--mute);font-size:13px;margin:2px 0 0}
.mb-pills{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}
.mb-pill{display:inline-flex;gap:7px;align-items:center;padding:6px 12px;border-radius:99px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:13px;font-weight:600;cursor:pointer}
.mb-pill b{background:var(--soft);border-radius:99px;padding:0 8px;min-width:22px;text-align:center}.mb-pill:hover{border-color:var(--acc)}
.mb-pill.hot{border-color:var(--acc2);box-shadow:0 0 0 2px color-mix(in srgb,var(--acc2) 22%,transparent)}.mb-pill.hot b{background:var(--acc2);color:#0a1f3f}
.mb-note{border:1px solid color-mix(in srgb,var(--acc2) 55%,var(--line));background:color-mix(in srgb,var(--acc2) 12%,var(--card));border-radius:var(--r);padding:10px 14px;margin:10px 0;font-size:13px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.mb-note.ko{border-color:color-mix(in srgb,var(--ko) 55%,var(--line));background:color-mix(in srgb,var(--ko) 10%,var(--card))}
.mb-sec{margin-top:18px}.mb-sec>summary,.mb-sec>h3{list-style:none;cursor:default;display:flex;gap:10px;align-items:baseline;margin:0 0 8px;font-size:15px;font-weight:700}
.mb-sec>summary{cursor:pointer}.mb-sec>summary::-webkit-details-marker{display:none}.mb-sec .mb-sd{font-weight:400;color:var(--mute);font-size:12.5px}
.mb-card{display:grid;gap:6px;padding:12px 14px;border:1px solid var(--line);border-left:4px solid var(--c,var(--acc));border-radius:12px;background:var(--card);margin-bottom:8px;transition:opacity .25s,transform .25s}
.mb-card.gone{opacity:0;transform:translateX(12px)}
.mb-card[data-cat=reaction]{--c:#ff9f1c}.mb-card[data-cat=event]{--c:#4f8ff0}.mb-card[data-cat=important]{--c:#ffd21f}.mb-card[data-cat=promo]{--c:var(--line)}
.mb-h{display:flex;gap:10px;justify-content:space-between;align-items:baseline;flex-wrap:wrap}.mb-h b{overflow-wrap:anywhere}
.mb-m{color:var(--mute);font-size:12.5px}.mb-s{font-size:13.5px}
.mb-why{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;font-weight:600;color:var(--ink);background:color-mix(in srgb,#ff9f1c 18%,var(--card));border:1px solid color-mix(in srgb,#ff9f1c 50%,var(--line));border-radius:99px;padding:2px 10px;width:fit-content}
.mb-ev{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,var(--acc) 10%,var(--card));border:1px solid color-mix(in srgb,var(--acc) 35%,var(--line))}
.mb-ev .t{font-weight:700}.mb-ev .w{color:var(--mute);font-size:12.5px}
.mb-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.mb-ai{font-size:11.5px;color:var(--mute)}
.mb-empty{padding:22px;text-align:center;color:var(--mute);border:1px dashed var(--line);border-radius:var(--r)}
.mb-skel{height:64px;border-radius:12px;background:linear-gradient(90deg,var(--soft),var(--card),var(--soft));background-size:200% 100%;animation:mbsk 1.2s linear infinite;margin-bottom:8px}@keyframes mbsk{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.mb-skel{animation:none}.mb-card{transition:none}}
.mb :focus-visible{outline:2px solid var(--acc);outline-offset:2px}`;
  const S = () => (J.state.mbx ||= { res: null, at: 0, loading: false, err: '' });
  const dayFmt = (iso) => { try { return new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return iso; } };
  const evWhen = (e) => { if (!e) return ''; const d = dayFmt(e.start.slice(0, 10)); if (e.allDay) return d + (e.end ? ' → ' + dayFmt(e.end) : ' · toute la journée'); return `${d}, ${e.start.slice(11, 16)}${e.end ? '–' + e.end.slice(11, 16) : ''}`; };
  const dl = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' }) : '';

  function card(it, sec) {
    const e = it.event; const react = it.categories.includes('reaction');
    const also = it.categories.filter((c) => c !== sec && c !== 'info' && c !== 'promo').map((c) => ({ reaction: 'attente de réaction', event: 'événement', important: 'important' }[c])).filter(Boolean);
    return `<article class="mb-card" data-cat="${sec}" data-key="${it.key}" aria-label="${J.esc(it.subject)}">
      <div class="mb-h"><b>${J.esc(it.subject)}</b><span class="mb-m">${J.esc(it.fromName || it.from)} · ${J.esc(it.accountLabel)} · ${J.esc(it.date ? J.fmtDate(it.date) : '')}</span></div>
      ${it.summary ? `<div class="mb-s">${J.esc(it.summary)}</div>` : ''}
      ${react ? `<div class="mb-why">⏳ ${J.esc(it.reason || 'Une réponse ou une action est attendue')}${it.deadline && !/\d/.test(it.reason || '') ? ' · avant le ' + J.esc(dl(it.deadline)) : ''}</div>` : (it.reason && sec !== 'promo' ? `<div class="mb-m">${J.esc(it.reason)}</div>` : '')}
      ${e ? `<div class="mb-ev"><div><div class="t">📅 ${J.esc(e.title)}</div><div class="w">${J.esc(evWhen(e))}${e.location ? ' · ' + J.esc(e.location) : ''}</div></div><button class="pri sm" data-act="mbAddCal" data-key="${it.key}">📅 Ajouter à mon agenda</button></div>` : ''}
      ${also.length ? `<div class="mb-m">Aussi : ${also.join(', ')}</div>` : ''}
      <div class="mb-act"><button class="sm ${react ? 'pri' : ''}" data-act="mbReply" data-key="${it.key}">↩ Répondre</button><button class="sm" data-act="mbRead" data-key="${it.key}">🔊 Lire</button><button class="sm" data-act="mbShow" data-key="${it.key}">👁 Afficher</button><button class="sm ghost" data-act="mbDone" data-key="${it.key}" title="Retire ce courriel de la liste (rien n'est modifié dans votre boîte)">✓ Traité</button>${it.source === 'règles' ? '<span class="mb-ai">analyse simple</span>' : ''}</div></article>`;
  }

  function render(host) {
    const s = S(); if (!host) return;
    const r = s.res;
    const head = `<div class="mb-top"><div><h2>📬 Boîte intelligente</h2><div class="mb-sub">Jarvis lit vos courriels non lus, tous comptes confondus, et les range par catégorie. Lecture seule : rien n'est marqué lu.</div></div>
      <div class="row"><button class="pri" data-act="mbRun" ${s.loading ? 'disabled' : ''}>${s.loading ? '<span class="spin"></span> Analyse…' : '✨ Analyser mes mails non lus'}</button>${r && !s.loading ? '<button class="sm" data-act="mbRerun" title="Relance l\'analyse complète, même pour les courriels déjà classés">Tout reclasser</button>' : ''}</div></div>`;
    let body = '';
    if (s.loading && !r) body = '<div class="mb-skel"></div><div class="mb-skel"></div><div class="mb-skel"></div>';
    else if (s.err && !r) body = `<div class="mb-note ko" role="alert"><span>${J.esc(s.err)}</span><button class="sm" data-act="mbRun">Réessayer</button></div>`;
    else if (r && r.noAccount) body = '<div class="mb-empty">Ajoutez un compte courriel (IMAP/SMTP ou Google) pour que Jarvis trie votre courrier.</div>';
    else if (r) {
      const c = r.counts; const notes = [];
      if (r.consentNeeded) notes.push(`<div class="mb-note"><span><b>Analyse simple (sans IA).</b> Pour une analyse plus fine, Jarvis doit envoyer le contenu de vos courriels non lus à votre moteur IA en ligne.</span><span class="row"><button class="sm pri" data-act="mbAllow">Autoriser cette fois</button><button class="sm" data-act="mbAllowAlways">Toujours autoriser</button></span></div>`);
      else if (!r.aiConfigured) notes.push('<div class="mb-note"><span><b>Analyse simple (sans IA).</b> Configurez un moteur IA dans Réglages pour un classement plus précis.</span><a class="btn sm" href="#reglages">Ouvrir les Réglages</a></div>');
      for (const e of r.errors || []) notes.push(`<div class="mb-note ko" role="alert"><span>${J.esc(e)}</span></div>`);
      for (const n of r.notes || []) notes.push(`<div class="mb-note"><span>L'IA n'a pas pu analyser une partie des courriels (${J.esc(n)}). Ils sont classés par règles simples.</span></div>`);
      const pills = SECTIONS.map(([id, ic, label]) => `<button class="mb-pill ${id === 'reaction' && c[id] ? 'hot' : ''}" data-act="mbGo" data-sec="${id}" aria-label="${label} : ${c[id]}">${ic} ${label} <b>${c[id]}</b></button>`).join('');
      body = `${notes.join('')}<div class="mb-pills" role="navigation" aria-label="Catégories">${pills}</div><div class="mb-m" aria-live="polite">${r.total} courriel${r.total > 1 ? 's' : ''} non lu${r.total > 1 ? 's' : ''} analysé${r.total > 1 ? 's' : ''} · ${r.aiUsed ? 'classement par l’IA' : 'classement par règles'} · ${J.esc(J.fmtDate(r.at))}</div>`;
      if (!r.total) body += '<div class="mb-empty" style="margin-top:12px">🎉 Aucun courriel non lu à traiter.</div>';
      for (const [id, ic, label, desc] of SECTIONS) {
        const keys = r.groups[id] || []; if (!keys.length) continue;
        const cards = keys.map((k) => card(r.items[k], id)).join('');
        if (id === 'info' || id === 'promo') body += `<details class="mb-sec" id="mbsec-${id}"><summary><span>${ic} ${label} (${keys.length})</span><span class="mb-sd">${desc}</span></summary>${cards}</details>`;
        else body += `<section class="mb-sec" id="mbsec-${id}"><h3><span>${ic} ${label} (${keys.length})</span><span class="mb-sd">${desc}</span></h3>${cards}</section>`;
      }
    }
    host.innerHTML = `<div class="card mb"><style>${CSS}</style>${head}${body}</div>`;
  }

  // Rendu réutilisable (écran Jarvis) : mêmes cartes, mêmes boutons, mêmes actions.
  J.mbSectionsHtml = (r, { sections = ['reaction', 'event', 'important'], max = 5 } = {}) => {
    J.state.mbx = Object.assign(S(), { res: r }); let h = `<style>${CSS}</style><div class="mb">`;
    h += `<div class="mb-pills">${SECTIONS.map(([id, ic, label]) => `<span class="mb-pill ${id === 'reaction' && r.counts[id] ? 'hot' : ''}">${ic} ${label} <b>${r.counts[id]}</b></span>`).join('')}</div>`;
    for (const [id, ic, label, desc] of SECTIONS) {
      if (!sections.includes(id)) continue; const keys = (r.groups[id] || []).slice(0, max); if (!keys.length) continue;
      h += `<section class="mb-sec"><h3><span>${ic} ${label} (${r.counts[id]})</span><span class="mb-sd">${desc}</span></h3>${keys.map((k) => card(r.items[k], id)).join('')}</section>`;
    }
    return h + '</div>';
  };

  async function run(opts = {}) {
    const s = S(); if (s.loading) return; s.loading = true; s.err = ''; render(document.getElementById('smartBox'));
    try { s.res = await J.call('mailbox.triage', { allowCloud: opts.allow === true || s.allow === true, force: !!opts.force }); s.at = Date.now(); }
    catch (e) { s.err = e.message || String(e); }
    finally { s.loading = false; render(document.getElementById('smartBox')); }
  }
  J.mountMailbox = (host) => { const s = S(); render(host); if (!s.res || Date.now() - s.at > 180000) run(); };
  J.mbRun = run;

  const item = (el) => (S().res?.items || {})[el.dataset.key];
  J.act.mbRun = () => run({});
  J.act.mbRerun = () => run({ force: true });
  J.act.mbAllow = () => { S().allow = true; run({ allow: true, force: true }); };
  J.act.mbAllowAlways = async () => { await J.call('mailbox.consent', { always: true }); J.S = await J.call('settings.get'); S().allow = true; run({ allow: true, force: true }); };
  J.act.mbGo = (el) => { const t = document.getElementById('mbsec-' + el.dataset.sec); if (!t) return; if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  J.act.mbReply = (el) => { const it = item(el); if (it) J.mailReply(it.message); };
  J.act.mbRead = (el) => { const it = item(el); if (!it) return; J.stopReading(); J.readMails([it.message]); };
  J.act.mbShow = async (el) => {
    const it = item(el); if (!it) return;
    let m = it.message; try { m = await J.call('mailbox.message', { key: it.key }); } catch { /* repli : texte seul */ }
    J.modal(`<h2>${J.esc(m.subject)}</h2><div class="muted small">${J.esc(m.from)} · ${J.esc(m.date ? J.fmtDate(m.date) : '')}</div><div class="row" style="margin:10px 0"><button class="sm" data-act="mbRead" data-key="${it.key}">🔊 Lire</button><button class="sm pri" data-act="mbReply" data-key="${it.key}">↩ Répondre</button><button class="sm" data-act="closeModal">Fermer</button></div>${J.mailBody(m, 0)}`);
    J.mountMailFrames();
  };
  J.act.mbDone = async (el) => {
    const it = item(el); if (!it) return; const card = el.closest('.mb-card');
    try { await J.call('mailbox.status', { key: it.key, status: 'done' }); } catch (e) { return J.err(e); }
    card.classList.add('gone'); const r = S().res;
    setTimeout(() => { if (r) { for (const g of Object.keys(r.groups)) r.groups[g] = r.groups[g].filter((k) => k !== it.key); delete r.items[it.key]; r.total = Object.keys(r.items).length; r.counts = Object.fromEntries(Object.entries(r.groups).map(([k, v]) => [k, v.length])); } render(document.getElementById('smartBox')); }, 260);
  };

  // ---- Ajouter à mon agenda : l'utilisateur vérifie et corrige, puis choisit Google Agenda ou Agenda (Apple) ----
  J.act.mbAddCal = (el) => {
    const it = item(el); if (!it || !it.event) return; const e = it.event; const t = e.allDay ? '' : e.start.slice(11, 16);
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
    const it = (S().res?.items || {})[el.dataset.key]; if (it) { it.event = { ...(it.event || {}), ...ev, allDay: !!all }; }
  }, 'Ouverture…');
})();
