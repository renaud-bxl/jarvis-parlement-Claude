// Courriels : affichage visuel (HTML assaini dans un cadre isolé), lecture à voix haute, réponse, page « Courriels ».
(() => {
  J.nameOf = (s) => { const t = String(s || '').replace(/<[^>]*>/, '').replace(/^["'\s]+|["'\s]+$/g, '').trim(); return t || String(s || '').replace(/[<>]/g, ''); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }, del(k) { try { localStorage.removeItem(k); } catch { /* ignoré */ } } };

  // ---- Styles propres à la page Courriels (variables de l'app : thèmes clair et sombre) ----
  if (!document.getElementById('mail-css')) {
    const st = document.createElement('style'); st.id = 'mail-css';
    st.textContent = `.mail-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mail-bar{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center;margin:2px 0 12px}.mail-bar input[type=search]{max-width:260px}.mail-bar .chk{margin:0}
.mail-count{font-weight:700}
.mail-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin-bottom:8px;overflow:hidden;box-shadow:var(--shadow)}
.mail-card.unread{border-left:4px solid var(--acc2)}
.mail-head{display:flex;gap:8px 10px;align-items:flex-start;padding:9px 12px;flex-wrap:wrap}
.mail-toggle{box-sizing:border-box;flex:1 1 380px;min-width:0;cursor:pointer;display:grid;grid-template-columns:minmax(110px,190px) minmax(0,1fr) auto;gap:2px 14px;align-items:baseline;text-align:left;border:0;background:transparent;border-radius:8px;padding:3px 6px;font-weight:400;color:var(--ink)}
.mail-toggle:focus-visible,.mail-card button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.mail-from{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mail-main{min-width:0}
.mail-subj{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mail-snip{display:block;color:var(--mute);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mail-card.unread .mail-from,.mail-card.unread .mail-subj{font-weight:700}
.mail-date{color:var(--mute);font-size:12px;white-space:nowrap}.mail-btns{display:flex;gap:6px;flex:none;flex-wrap:wrap}
.mail-body{border-top:1px solid var(--line);padding:12px 14px}.mail-meta{font-size:12.5px;color:var(--mute);line-height:1.65;margin-bottom:8px;word-break:break-word}.mail-meta b{color:var(--ink);font-weight:600}
.mail-warn{background:#fbf1d9;border:1px solid #ecd49a;color:#6b4e10;border-radius:8px;padding:6px 10px;font-size:12.5px;margin:6px 0}
.mail-err{border:1px solid var(--ko);border-left-width:4px;border-radius:var(--r);padding:12px 14px;margin-bottom:10px;background:var(--card)}.mail-err p{margin:4px 0 8px}
.mail-acc{padding:6px 0;border-bottom:1px solid var(--line)}.mail-acc:last-child{border:0}.mail-test{font-size:12.5px;margin:2px 0 0 26px}.mail-test.ok{color:var(--ok)}.mail-test.ko{color:var(--ko)}
.mail-load{display:flex;gap:10px;align-items:center;color:var(--mute);padding:6px 2px}
.mail-act button[aria-pressed=true]{background:var(--soft);border-color:var(--acc)}
@media (prefers-color-scheme:dark){.mail-warn{background:#3a2f12;border-color:#6b5420;color:#f3deaa}}
@media (max-width:900px){.mail-toggle{grid-template-columns:1fr auto}.mail-main{grid-column:1/-1;grid-row:2}}`;
    document.head.appendChild(st);
  }

  // ---- Affichage ----
  // Défense en profondeur : le serveur reconstruit déjà le HTML (liste blanche) ; ici il est reconstruit une seconde fois,
  // élément par élément, avant d'entrer dans un cadre sans scripts, sans réseau (CSP du document) et sans formulaire.
  const TAGS = new Set('a abbr acronym address article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q s samp section small span strike strong sub sup table tbody td tfoot th thead time tr tt u ul var wbr'.split(' '));
  const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'audio', 'video', 'canvas', 'svg', 'math', 'noscript', 'template', 'title', 'head', 'xmp', 'noembed', 'noframes', 'plaintext']);
  const ATTRS = new Set(['class', 'dir', 'lang', 'title', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'nowrap', 'face', 'size', 'span', 'start', 'type', 'scope', 'alt']);
  const cleanCss = (css) => {
    let c = String(css || '');
    for (let g = 0; g < 400; g++) { const a = c.indexOf('/*'); if (a < 0) break; const b = c.indexOf('*/', a + 2); c = b < 0 ? c.slice(0, a) : c.slice(0, a) + c.slice(b + 2); }
    return c.replace(/\\/g, '').replace(/</g, '').replace(/@(?:import|charset|namespace)\b[^;{}]{0,2000};?/gi, '').replace(/@font-face\s*\{[^}]{0,4000}\}/gi, '')
      .replace(/url\s*\([^)]{0,3000}\)/gi, 'none').replace(/image-set\s*\([^)]{0,3000}\)/gi, 'none')
      .replace(/expression\s*\(|behaviou?r\s*:|-moz-binding|javascript\s*:|vbscript\s*:/gi, 'x-').replace(/position\s*:\s*fixed/gi, 'position:static').trim();
  };
  const safeHref = (v) => { const u = String(v || '').replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ''); return /^(https?:|mailto:|tel:|#)/i.test(u) ? u : ''; };
  const rebuild = (src, dst, doc) => {
    for (const n of [...src.childNodes]) {
      if (n.nodeType === 3) { dst.appendChild(doc.createTextNode(n.data)); continue; }
      if (n.nodeType !== 1 || n.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
      const tag = n.localName;
      if (tag === 'style') { const css = cleanCss(n.textContent); if (css) { const s = doc.createElement('style'); s.textContent = css; dst.appendChild(s); } continue; }
      if (DROP.has(tag)) continue;
      if (!TAGS.has(tag)) { rebuild(n, dst, doc); continue; }
      if (tag === 'img') { const s = n.getAttribute('src') || ''; if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(s) && s.length < 260000) { const im = doc.createElement('img'); im.setAttribute('src', s); if (n.alt) im.setAttribute('alt', n.alt); dst.appendChild(im); } continue; }
      const e = doc.createElement(tag);
      for (const a of [...n.attributes]) {
        const k = a.name.toLowerCase();
        if (k === 'href' && tag === 'a') { const h = safeHref(a.value); if (h) { e.setAttribute('href', h); e.setAttribute('rel', 'noopener noreferrer'); e.setAttribute('title', h.slice(0, 300)); } }
        else if (k === 'style') { const c = cleanCss(a.value); if (c) e.setAttribute('style', c); }
        else if (k === 'id') { const v = a.value.replace(/[^\w-]/g, ''); if (v) e.setAttribute('id', v); }
        else if (ATTRS.has(k) && k !== 'alt') e.setAttribute(k, k === 'class' ? a.value.replace(/[^\w\- ]/g, '') : a.value.slice(0, 200));
      }
      rebuild(n, e, doc); dst.appendChild(e);
    }
  };
  const clean = (html) => {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = document.implementation.createHTMLDocument(''); const box = out.createElement('div');
    if (doc.head) rebuild(doc.head, box, out); // les <style> de l'en-tête
    if (doc.body) rebuild(doc.body, box, out);
    return box.innerHTML;
  };
  J.cleanMailHtml = clean;
  const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  const BASE = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="color-scheme" content="light"><style>html,body{margin:0}body{font:14px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#1b2333;background:#fff;padding:14px 16px;word-break:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#0b5cad}table{max-width:100%}blockquote{margin:8px 0;padding-left:10px;border-left:3px solid #d6dbe6;color:#566}.img-blocked{color:#667;font-style:italic}</style>`;
  J.mailBody = (m, i) => (m.html ? `<iframe class="mailframe" data-i="${i}" title="Contenu du message : ${J.esc(m.subject || '')}" sandbox="allow-same-origin" referrerpolicy="no-referrer" srcdoc="${J.esc(BASE + clean(m.html))}"></iframe>` : `<pre class="mailtext" tabindex="0">${J.esc(m.text || '')}</pre>`);

  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
  const openLink = async (a) => {
    const h = a.getAttribute('href') || '';
    if (/^mailto:/i.test(h)) { const u = new URL(h); J.state.composePrefill = { to: decodeURIComponent(u.pathname || ''), subject: u.searchParams.get('subject') || '', body: u.searchParams.get('body') || '' }; if (location.hash === '#courriels') J.render(); else J.go('courriels'); return; }
    if (!/^https?:\/\//i.test(h)) return;
    const shown = (a.textContent || '').trim(); const looksUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(shown);
    if (looksUrl && hostOf(/^https?:/i.test(shown) ? shown : 'https://' + shown) !== hostOf(h)) {
      const ok = J.confirm ? await J.confirm(`Ce lien affiche « ${shown.slice(0, 80)} » mais mène vers « ${hostOf(h)} ». C'est une technique courante d'hameçonnage. Ouvrir quand même ?`, { ok: 'Ouvrir quand même', danger: true, title: 'Lien suspect' }) : confirm('Lien suspect : ouvrir quand même ?');
      if (!ok) return;
    }
    J.call('app.openExternal', { url: h }).catch(J.err);
  };
  J.mountMailFrames = (root = document) => J.$$('iframe.mailframe', root).forEach((f) => {
    if (f.dataset.mounted) return; f.dataset.mounted = '1';
    const fit = () => {
      try {
        const d = f.contentDocument; if (!d || !d.documentElement) return;
        const h = () => { f.style.height = Math.max(60, Math.min(700, d.documentElement.scrollHeight + 4)) + 'px'; };
        h(); if (window.ResizeObserver) new ResizeObserver(h).observe(d.documentElement);
        d.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (!a) return; e.preventDefault(); openLink(a); });
      } catch { /* cadre inaccessible */ }
    };
    f.addEventListener('load', fit); if (f.contentDocument && f.contentDocument.readyState === 'complete') fit();
  });

  // ---- Lecture à voix haute ----
  J.speakable = (text, max = 700) => {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const cutAt = lines.findIndex((l, k) => k > 0 && /^\s*(--\s*|_{5,}|-{5,}\s*(Original Message|Message d.origine|Message transf[ée]r[ée]|Forwarded message)[^-]*-{0,5}|Le .{5,140} a [ée]crit\s*:|On .{5,140} wrote:|Envoy[ée] de mon (iPhone|iPad|Android|t[ée]l[ée]phone)|Sent from my .*)\s*$/i.test(l));
    const t = (cutAt > 0 ? lines.slice(0, cutAt) : lines).filter((l) => !/^\s*>/.test(l)).join('\n').replace(/https?:\/\/\S+/g, '').replace(/[^\s@<>]{1,64}@[^\s@<>]{1,255}\.[^\s@<>]{1,63}/g, 'une adresse e-mail').replace(/[-_=*~]{3,}/g, ' ').replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return { text: t, cut: false };
    const cut = t.slice(0, max); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return { text: (i > max * 0.5 ? cut.slice(0, i + 1) : cut).trim(), cut: true };
  };
  // Chaque mail est annoncé comme un nouveau mail.
  J.mailSpeech = (m) => {
    const b = J.speakable(m.text); const n = (m.attachments || []).length;
    return `Nouveau mail. De ${J.nameOf(m.from)}. Objet : ${m.subject}. ${b.text || 'Le message est vide.'} ${b.cut ? 'Le message est plus long : ouvrez-le pour lire la suite.' : 'Fin du message.'}${n ? ` ${n} pièce${n > 1 ? 's' : ''} jointe${n > 1 ? 's' : ''}.` : ''}`;
  };
  J.readToken = 0;
  // Lit les messages l'un après l'autre. Une nouvelle lecture (ou « Arrêter ») interrompt proprement la précédente : jamais deux voix en même temps.
  J.readMails = async (msgs, onItem, onEnd) => {
    const my = ++J.readToken; J.stopSpeak();
    await sleep(150); // laisse la synthèse vocale se vider avant de reparler
    const live = () => my === J.readToken;
    const guard = async (txt) => { let iv; const stopped = new Promise((r) => { iv = setInterval(() => { if (!live()) r(); }, 120); }); try { await Promise.race([J.speak(txt), stopped]); } finally { clearInterval(iv); } };
    try {
      for (let i = 0; i < msgs.length; i++) {
        if (!live()) return false;
        if (onItem) onItem(i);
        await guard(J.mailSpeech(msgs[i]));
        if (!live()) return false;
        await sleep(700);
      }
      return live();
    } catch (e) { if (live()) J.err(e); return false; }
    finally { if (live() && onEnd) onEnd(); }
  };
  J.stopReading = () => { J.readToken++; J.stopSpeak(); };

  // ---- Utilitaires de liste ----
  const msgTs = (m) => { const d = Date.parse(m.date); if (!isNaN(d) && d <= Date.now() + 864e5) return d; const r = Date.parse(m.received); return isNaN(r) ? (isNaN(d) ? 0 : d) : r; };
  J.mailSort = (list) => list.map((m) => [msgTs(m), m]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  J.mailDedupe = (list) => { const seen = new Map(); const out = []; for (const m of list) { const k = (m.messageId || '').trim().toLowerCase(); if (!k) { out.push(m); continue; } const p = seen.get(k); if (p === undefined) { seen.set(k, out.length); out.push(m); } else if (m.unread && !out[p].unread) out[p] = m; } return out; };
  const shortDate = (iso) => {
    const t = Date.parse(iso); if (isNaN(t)) return '';
    const d = new Date(t), n = new Date();
    if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    if (n - d < 6 * 864e5 && n > d) return d.toLocaleDateString('fr-BE', { weekday: 'short', hour: undefined }) + ' ' + d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
  };
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' Mo' : n >= 1024 ? Math.round(n / 1024) + ' Ko' : n ? n + ' o' : '');
  const mkey = (m) => (m.account || '') + '|' + (m.id || m.messageId || '');

  // ---- Brouillons (stockés sur cet ordinateur, jamais envoyés ; supprimés après 30 jours) ----
  J.mailDraft = {
    get(key) { try { const d = JSON.parse(store.get('jv.mail.draft.' + key) || 'null'); return d && Date.now() - d.t < 30 * 864e5 ? d : null; } catch { return null; } },
    set(key, data) { store.set('jv.mail.draft.' + key, JSON.stringify({ ...data, t: Date.now() })); },
    del(key) { store.del('jv.mail.draft.' + key); },
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---- Lecture d'un .eml (repli côté interface : l'API ne renvoie que le texte brut) ----
  const b64bytes = (s) => { try { const b = atob(s.replace(/[^A-Za-z0-9+/=]/g, '')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); } catch { return new Uint8Array(); } };
  const qpBytes = (s) => { const t = s.replace(/=\n/g, ''); const out = []; for (let i = 0; i < t.length; i++) { if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.substr(i + 1, 2))) { out.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; } else out.push(t.charCodeAt(i) & 255); } return Uint8Array.from(out); };
  const dec = (bytes, cs) => { try { return new TextDecoder((cs || 'utf-8').toLowerCase()).decode(bytes); } catch { return new TextDecoder().decode(bytes); } };
  const words = (s) => String(s || '').replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?)/g, '$1').replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (m, cs, e, d) => dec(e.toLowerCase() === 'b' ? b64bytes(d) : qpBytes(d.replace(/_/g, ' ')), cs.replace(/\*.*$/, '')));
  const splitMsg = (raw) => { const m = /\n\n/.exec(raw); const head = m ? raw.slice(0, m.index) : raw; const body = m ? raw.slice(m.index + 2) : ''; const h = {}; for (const l of head.replace(/\n[ \t]+/g, ' ').split('\n')) { const i = l.indexOf(':'); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = l.slice(i + 1).trim(); } } return { h, body }; };
  const textOf = (h, body, depth = 0) => {
    const ct = h['content-type'] || 'text/plain'; const type = ct.split(';')[0].trim().toLowerCase();
    if (type.startsWith('multipart/') && depth < 4) {
      const b = (/boundary\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(ct) || [])[1] || (/boundary\s*=\s*([^;\s]+)/i.exec(ct) || [])[1]; if (!b) return '';
      let html = ''; for (const p of body.split('--' + b).slice(1)) { if (p.startsWith('--')) continue; const s = splitMsg(p.replace(/^\n/, '')); if (/^attachment/i.test(s.h['content-disposition'] || '')) continue; const t = textOf(s.h, s.body, depth + 1); const pt = (s.h['content-type'] || 'text/plain').split(';')[0].trim().toLowerCase(); if (pt === 'text/plain' && t) return t; if (t && !html) html = t; } return html;
    }
    const cs = (/charset\s*=\s*"?([^";\s]+)/i.exec(ct) || [])[1]; const cte = (h['content-transfer-encoding'] || '').toLowerCase();
    const t = dec(cte === 'base64' ? b64bytes(body) : cte === 'quoted-printable' ? qpBytes(body) : new TextEncoder().encode(body), cs);
    return type === 'text/html' ? (new DOMParser().parseFromString(t, 'text/html').body.textContent || '').trim() : t;
  };
  J.parseEml = (raw) => { const { h, body } = splitMsg(String(raw || '').replace(/\r\n?/g, '\n')); return { to: words(h.to), cc: words(h.cc), bcc: words(h.bcc), subject: words(h.subject), inReplyTo: h['in-reply-to'] || '', references: h.references || '', body: textOf(h, body).replace(/\n$/, '') }; };

  // ---- Répondre ----
  const replyKey = (m) => 'reply:' + (m.account || '') + ':' + (m.messageId || m.id || '');
  J.mailReply = async (m, instruction = '', opts = {}) => {
    J.stopReading();
    const [accs, pre] = await Promise.all([J.call('mail.accounts'), J.call('mail.reply.prefill', { message: m })]);
    const smtp = accs.filter((a) => a.type === 'imap'); J.state.reply = { m, pre };
    const key = replyKey(m); const draft = J.mailDraft.get(key);
    J.modal(`<h2>↩ Répondre à ${J.esc(J.nameOf(m.from))}</h2>
      <div class="muted small" style="margin-bottom:8px">Message d'origine : ${J.esc(m.subject)}</div>
      ${draft ? '<div class="mail-warn" role="status" id="rDraftNote">Brouillon retrouvé (enregistré sur cet ordinateur). <button class="sm" data-act="rDiscardDraft">Repartir de zéro</button></div>' : ''}
      ${smtp.length ? '' : '<div class="banner">Aucun compte d\'envoi (SMTP) : prépare la réponse puis copie-la, ou ajoute un compte dans la page Courriels.</div>'}
      ${(pre.warn || []).map((w) => `<div class="mail-warn" role="note">${J.esc(w)}</div>`).join('')}
      <div class="grid g2"><div><label class="f" for="rAcc">Envoyer depuis</label><select id="rAcc">${smtp.map((a) => `<option value="${J.esc(a.id)}" data-email="${J.esc(a.email)}" ${a.id === pre.sendAccount ? 'selected' : ''}>${J.esc(a.label)} (${J.esc(a.email)})</option>`).join('')}</select></div><div><label class="f" for="rTo">À</label><input id="rTo" value="${J.esc(pre.to)}" autocomplete="off" spellcheck="false"></div></div>
      <div class="grid g2"><div><label class="f" for="rCc">Cc</label><input id="rCc" value="${J.esc(pre.cc || '')}" autocomplete="off" spellcheck="false"></div><div><label class="f" for="rSub">Objet</label><input id="rSub" value="${J.esc(pre.subject)}"></div></div>
      ${pre.hasOthers ? `<label class="chk"><input type="checkbox" id="rAll" data-act="rAllToggle" ${opts.all ? 'checked' : ''}> Répondre à tous (${J.esc(pre.ccAll)})</label>` : ''}
      <label class="f" for="rIns">Ce que vous voulez répondre — Jarvis rédige (facultatif)</label>
      <div class="row"><input id="rIns" class="grow" value="${J.esc(instruction)}" placeholder="Ex. : Merci, je confirme ma présence et je demande l'ordre du jour"><button class="sm" data-act="mic" data-target="rIns" aria-label="Dicter la consigne">🎤</button><button class="sm pri" data-act="rDraft">✨ Proposer une réponse</button></div>
      ${J.S._env.local ? '' : '<label class="chk"><input type="checkbox" id="rCloud"> J\'autorise l\'envoi de ce courriel au moteur IA cloud pour proposer la réponse</label>'}
      <label class="f" for="rBody">Réponse</label><textarea id="rBody" style="min-height:220px">\n\n${J.esc(pre.quote)}</textarea>
      <div class="row" style="margin-top:12px"><button class="pri" data-act="rSend">Vérifier et envoyer…</button><button data-act="rSaveDraft">Enregistrer le brouillon</button><button data-act="rCopy">Copier</button><button data-act="closeModal">Annuler</button><span class="muted small" id="rDraftState" role="status" aria-live="polite"></span></div>
      <p class="muted small">Une fenêtre de confirmation affiche le compte, les destinataires et le texte avant tout envoi. Rien ne part sans votre accord.</p>`);
    const body = document.getElementById('rBody');
    const fill = (d) => { if (!d) return; for (const [id, k] of [['rTo', 'to'], ['rCc', 'cc'], ['rSub', 'subject'], ['rBody', 'body']]) if (d[k] != null) document.getElementById(id).value = d[k]; const acc = document.getElementById('rAcc'); if (d.account && acc && [...acc.options].some((o) => o.value === d.account)) acc.value = d.account; const all = document.getElementById('rAll'); if (all) all.checked = !!d.all; };
    if (draft) fill(draft); body.setSelectionRange(0, 0); body.focus();
    const initial = body.value;
    const snap = () => ({ to: J.val('rTo'), cc: J.val('rCc'), subject: J.val('rSub'), body: J.val('rBody'), account: J.val('rAcc'), all: !!J.val('rAll') });
    const save = debounce(() => { if (!document.getElementById('rBody') || J.val('rBody') === initial) return; J.mailDraft.set(key, snap()); const s = document.getElementById('rDraftState'); if (s) s.textContent = 'Brouillon enregistré ' + new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }); }, 700);
    const modal = document.querySelector('#modal-root .modal'); if (modal) modal.addEventListener('input', save);
    J.state.replyCtx = { key, snap, initial, quote: pre.quote };
    if (opts.all) J.act.rAllToggle();
    if (instruction) J.act.rDraft(J.$('[data-act=rDraft]'));
  };
  J.act.rAllToggle = () => { const cc = document.getElementById('rCc'); const { pre } = J.state.reply; const on = J.val('rAll'); const cur = (cc.value || '').trim();
    if (on) cc.value = [cur, pre.ccAll].filter(Boolean).join(', '); else cc.value = cur === pre.ccAll ? '' : cur.replace(pre.ccAll, '').replace(/^[,\s]+|[,\s]+$/g, ''); };
  J.act.rDiscardDraft = () => { const { m, pre } = J.state.reply; J.mailDraft.del(replyKey(m)); document.getElementById('rTo').value = pre.to; document.getElementById('rCc').value = pre.cc || ''; document.getElementById('rSub').value = pre.subject; document.getElementById('rBody').value = '\n\n' + pre.quote; const all = document.getElementById('rAll'); if (all) all.checked = false; document.getElementById('rDraftNote')?.remove(); J.toast('Brouillon supprimé'); };
  J.act.rSaveDraft = () => { const c = J.state.replyCtx; J.mailDraft.set(c.key, c.snap()); J.toast('Brouillon enregistré sur cet ordinateur', 'ok'); };
  J.act.rDraft = (el) => J.busy(el, async () => {
    const { m, pre } = J.state.reply;
    const r = await J.call('mail.reply.draft', { message: m, instruction: J.val('rIns'), allowCloud: J.S._env.local ? true : J.val('rCloud') });
    document.getElementById('rBody').value = r.text.trim() + '\n\n' + pre.quote; J.toast('Proposition prête : relisez-la avant d\'envoyer', 'ok');
  }, 'Rédaction…');
  J.act.rCopy = () => J.copy(J.val('rBody'));
  J.act.rSend = (el) => J.busy(el, async () => {
    const { pre } = J.state.reply; const sel = document.getElementById('rAcc');
    if (!sel || !sel.value) return J.toast("Aucun compte d'envoi : copie la réponse ou ajoute un compte SMTP.", 'err');
    if (!String(J.val('rTo') || '').trim()) { document.getElementById('rTo').focus(); return J.toast('Indique au moins un destinataire dans « À ».', 'err'); }
    const raw = await J.call('mail.compose', { from: sel.selectedOptions[0].dataset.email, to: J.val('rTo'), cc: J.val('rCc'), subject: J.val('rSub'), body: J.val('rBody'), inReplyTo: pre.inReplyTo, references: pre.references });
    const r = await J.call('mail.send', { id: sel.value, raw });
    if (r.sent) { J.mailDraft.del(J.state.replyCtx.key); sentToast(r, 'Réponse'); J.closeModal(); } else J.toast('Envoi annulé');
  }, 'Vérification…');
  const sentToast = (r, what) => {
    const rej = r.rejected || [];
    if (rej.length) J.toast(`${what} envoyée, mais refusée pour : ${rej.join(', ')}. Vérifie ces adresses.`, 'err'); else J.toast(`${what} acceptée par le serveur d'envoi${r.accepted?.length ? ' (' + r.accepted.join(', ') + ')' : ''}`, 'ok');
  };

  // =====================================================================================
  // Page « Courriels »
  // =====================================================================================
  const S = () => (J.state.mail ||= { sel: store.get('jv.mail.sel') || '', n: Number(store.get('jv.mail.n')) || 10, msgs: [], errors: [], loadedAt: 0, loadedFor: '', onlyUnread: false, unreadFirst: true, q: '', open: new Set(), reading: null, seq: 0, summary: '', state: 'idle' });
  const accLabel = (id) => (J.state.mailAccs || []).find((a) => a.id === id)?.label || id;
  const visible = () => {
    const s = S(); let l = s.msgs.slice(); const q = s.q.trim().toLowerCase();
    if (s.onlyUnread) l = l.filter((m) => m.unread);
    if (q) l = l.filter((m) => `${m.subject} ${m.from} ${m.snippet || ''}`.toLowerCase().includes(q));
    if (s.unreadFirst) l = [...l.filter((m) => m.unread), ...l.filter((m) => !m.unread)];
    return l;
  };

  const detail = (m, i) => {
    const n = (m.attachmentInfo || []).length ? m.attachmentInfo : (m.attachments || []).map((x) => ({ name: x, size: 0 }));
    return `<div class="mail-meta"><div><b>De :</b> ${J.esc(m.from)}</div>${m.to ? `<div><b>À :</b> ${J.esc(m.to)}</div>` : ''}${m.cc ? `<div><b>Cc :</b> ${J.esc(m.cc)}</div>` : ''}<div><b>Date :</b> ${J.esc(m.date ? J.fmtDate(m.date) : (m.received ? J.fmtDate(m.received) + ' (réception)' : 'inconnue'))}${(J.state.mailAccs || []).length > 1 ? ` · <b>Compte :</b> ${J.esc(accLabel(m.account))}` : ''}</div>
      ${n.length ? `<div><b>Pièces jointes :</b> ${n.map((a) => `📎 ${J.esc(a.name)}${a.size ? ' (' + fmtSize(a.size) + ')' : ''}`).join(' · ')} <span class="muted">— non téléchargées par Jarvis</span></div>` : ''}</div>
      ${m.listId ? '<div class="mail-warn" role="note">Message d\'une liste de diffusion.</div>' : ''}${m.imagesBlocked ? `<div class="mail-warn" role="note">${m.imagesBlocked} image${m.imagesBlocked > 1 ? 's' : ''} distante${m.imagesBlocked > 1 ? 's' : ''} bloquée${m.imagesBlocked > 1 ? 's' : ''} (protège votre vie privée : aucun pisteur ne peut vous repérer).</div>` : ''}${m.textTruncated ? '<div class="mail-warn" role="note">Message très long : seul le début est affiché.</div>' : ''}
      ${J.mailBody(m, i)}`;
  };
  const cardHtml = (m, i) => {
    const open = S().open.has(mkey(m)); const n = (m.attachments || []).length; const multi = (J.state.mailAccs || []).length > 1;
    return `<article class="mail-card mailcard${m.unread ? ' unread' : ''}" id="mc${i}" aria-label="${J.esc((m.unread ? 'Non lu. ' : '') + J.nameOf(m.from) + ' : ' + m.subject)}">
      <div class="mail-head"><button class="mail-toggle" data-act="mailToggle" data-i="${i}" aria-expanded="${open}" aria-controls="mb${i}"><span class="mail-from">${m.unread ? '<span class="mail-sr">Non lu. </span>' : ''}${J.esc(J.nameOf(m.from) || '(expéditeur inconnu)')}</span><span class="mail-main"><span class="mail-subj">${J.esc(m.subject)}${n ? ` <span title="${n} pièce${n > 1 ? 's' : ''} jointe${n > 1 ? 's' : ''}" aria-label="${n} pièce${n > 1 ? 's' : ''} jointe${n > 1 ? 's' : ''}">📎</span>` : ''}</span><span class="mail-snip">${J.esc(m.snippet || '')}</span></span><span class="mail-date">${J.esc(shortDate(m.date || m.received))}${multi ? ' · ' + J.esc(accLabel(m.account)) : ''}</span></button>
      <span class="mail-btns mail-act"><button class="sm" data-act="mailRead" data-i="${i}" aria-pressed="false">🔊 Lire</button><button class="sm pri" data-act="mailReply" data-i="${i}">↩ Répondre</button>${(String(m.to || '') + ',' + String(m.cc || '')).split('@').length > 3 ? `<button class="sm" data-act="mailReplyAll" data-i="${i}">↩ À tous</button>` : ''}</span></div>
      <div class="mail-body" id="mb${i}" ${open ? '' : 'hidden'}>${open ? detail(m, i) : ''}</div></article>`;
  };

  const syncReadButtons = () => {
    const r = S().reading;
    J.$$('[data-act=mailRead]').forEach((b) => { const on = r === Number(b.dataset.i); b.setAttribute('aria-pressed', on); b.innerHTML = on ? '⏹ Arrêter' : '🔊 Lire'; });
    const st = document.querySelector('[data-act=mailStop]'); if (st) { st.disabled = r == null; st.setAttribute('aria-disabled', r == null); }
    const all = document.querySelector('[data-act=mailReadAll]'); if (all) all.setAttribute('aria-pressed', r === 'all');
    J.$$('.mailcard').forEach((c) => c.classList.toggle('reading', S().readingIdx != null && c.id === 'mc' + S().readingIdx));
  };

  const renderList = () => {
    const s = S(); const box = document.getElementById('mList'); if (!box) return;
    const l = visible(); J.state.mails = l;
    const unread = s.msgs.filter((m) => m.unread).length;
    const cnt = document.getElementById('mCount');
    if (cnt) cnt.textContent = `${s.msgs.length} message${s.msgs.length > 1 ? 's' : ''} · ${unread} non lu${unread > 1 ? 's' : ''}${l.length !== s.msgs.length ? ` · ${l.length} affiché${l.length > 1 ? 's' : ''}` : ''}`;
    box.innerHTML = l.length ? l.map(cardHtml).join('') : `<div class="empty">${s.msgs.length ? 'Aucun message ne correspond au filtre.' : 'Boîte de réception vide.'}</div>`;
    J.mountMailFrames(box); syncReadButtons();
  };

  const showErrors = (errs) => {
    const box = document.getElementById('mErr'); if (!box) return;
    box.innerHTML = errs.map((e) => `<div class="mail-err" role="alert"><b>${J.esc(e.label)}</b><p>${J.esc(e.error)}</p><div class="row"><button class="sm pri" data-act="readMail">Réessayer</button>${e.account.startsWith('google:') ? '' : `<button class="sm" data-act="testMail" data-id="${J.esc(e.account)}">Tester la connexion</button>`}</div></div>`).join('');
  };

  const renderResults = () => {
    const s = S(); const out = document.getElementById('mOut'); if (!out) return;
    if (s.state === 'loading') return;
    out.innerHTML = `${s.summary ? `<div class="card" style="background:var(--soft)" id="mSum"><div class="row sp"><h2 style="margin:0">Résumé</h2><button class="sm ghost" data-act="mailSumClose" aria-label="Fermer le résumé">✕</button></div>${J.md(s.summary)}</div>` : ''}
      <div id="mErr"></div>
      ${s.state === 'done' ? `<div class="mail-bar" role="toolbar" aria-label="Filtres et lecture">
        <span class="mail-count" id="mCount" role="status" aria-live="polite"></span>
        <input type="search" id="mQ" class="grow" placeholder="Filtrer (expéditeur, objet…)" aria-label="Filtrer les messages" value="${J.esc(s.q)}">
        <label class="chk"><input type="checkbox" id="mUnreadOnly" ${s.onlyUnread ? 'checked' : ''}> Non lus seulement</label>
        <label class="chk"><input type="checkbox" id="mUnreadFirst" ${s.unreadFirst ? 'checked' : ''}> Non lus d'abord</label>
        <span class="row mail-act"><button class="sm" data-act="mailReadAll" aria-pressed="false">🔊 Lire tous</button><button class="sm" data-act="mailStop" disabled aria-disabled="true">⏹ Arrêter</button></span></div>` : ''}
      <div id="mList"></div>`;
    showErrors(s.errors); renderList();
  };

  const loading = (msg) => {
    const out = document.getElementById('mOut'); if (!out) return;
    out.innerHTML = `<div class="mail-load" role="status" aria-live="polite" aria-busy="true"><span class="spin" aria-hidden="true"></span><span id="mLoadMsg">${J.esc(msg)}</span></div>${J.skeleton ? J.skeleton(3) : ''}`;
  };

  // Charge les courriels du compte choisi (ou de tous, en parallèle). `force` contourne le cache court du serveur.
  const load = async ({ force = false, summarize = false } = {}) => {
    const s = S(); const accs = J.state.mailAccs || []; if (!accs.length) return;
    const sel = document.getElementById('mAcc')?.value || s.sel; s.sel = sel; s.n = Number(J.val('mN')) || s.n; store.set('jv.mail.sel', sel); store.set('jv.mail.n', String(s.n));
    const ids = sel === '*' ? accs.map((a) => a.id) : [sel]; const my = ++s.seq; s.state = 'loading'; S().reading = null; J.stopReading();
    loading(summarize ? 'Lecture et résumé en cours…' : `Lecture de ${ids.length > 1 ? 'vos boîtes' : 'la boîte'} de réception…`);
    const slow = setTimeout(() => { const el = document.getElementById('mLoadMsg'); if (el && my === s.seq) el.textContent = 'Le serveur met du temps à répondre… (au plus une minute)'; }, 8000);
    const limit = force ? { n: s.n, force: true } : s.n; const errors = []; let msgs = []; let summaries = [];
    try {
      const cloud = J.S._env.local ? true : J.val('mCloud');
      const res = await Promise.allSettled(ids.map((id) => (summarize ? J.call('mail.summarize', { id, limit, allowCloud: cloud }) : J.call('mail.read', { id, limit }))));
      res.forEach((r, k) => {
        if (r.status === 'rejected') { errors.push({ account: ids[k], label: accLabel(ids[k]), error: J.errMsg ? J.errMsg(r.reason) : String(r.reason?.message || r.reason) }); return; }
        const list = summarize ? r.value.messages : r.value; msgs.push(...list.map((m) => ({ ...m, account: m.account || ids[k] })));
        if (summarize && r.value.summary) summaries.push(ids.length > 1 ? `## ${accLabel(ids[k])}\n\n${r.value.summary}` : r.value.summary);
      });
    } finally { clearTimeout(slow); }
    if (my !== s.seq) return; // une lecture plus récente a pris le relais
    s.msgs = J.mailSort(J.mailDedupe(msgs)); s.errors = errors; s.loadedAt = Date.now(); s.loadedFor = sel + '|' + s.n; s.state = 'done'; s.summary = summaries.join('\n\n');
    if (errors.length && !s.msgs.length) s.state = 'error';
    renderResults();
    if (errors.length && !s.msgs.length) J.toast(errors[0].error, 'err');
  };

  J.act.readMail = (el) => J.busy(el, () => load({ force: true }), 'Lecture…');
  J.act.sumMail = (el) => J.busy(el, () => load({ force: true, summarize: true }), 'Lecture et résumé…');
  J.act.mailSumClose = () => { S().summary = ''; document.getElementById('mSum')?.remove(); };

  J.act.mailToggle = (el) => {
    const i = Number(el.dataset.i); const m = J.state.mails[i]; if (!m) return; const s = S(); const k = mkey(m); const body = document.getElementById('mb' + i);
    const open = !s.open.has(k); open ? s.open.add(k) : s.open.delete(k);
    el.setAttribute('aria-expanded', open); body.hidden = !open; body.innerHTML = open ? detail(m, i) : ''; if (open) J.mountMailFrames(body);
  };

  const startReading = (msgs, idx, firstIdx) => {
    const s = S(); s.reading = idx === 'all' ? 'all' : firstIdx; s.readingIdx = idx === 'all' ? null : firstIdx; syncReadButtons();
    s.pageReading = true;
    return J.readMails(msgs, (k) => {
      if (idx === 'all') { s.readingIdx = k; syncReadButtons(); const c = document.getElementById('mc' + k); if (c) c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth', block: 'center' }); }
    }, () => { s.reading = null; s.readingIdx = null; syncReadButtons(); });
  };
  J.act.mailRead = (el) => {
    const i = Number(el.dataset.i); const m = J.state.mails[i]; if (!m) return;
    if (S().reading === i) return J.act.mailStop();
    startReading([m], i, i);
  };
  J.act.mailReadAll = () => { if (S().reading === 'all') return J.act.mailStop(); if (!J.state.mails.length) return J.toast('Aucun message à lire.'); startReading(J.state.mails, 'all', 0); };
  J.act.mailStop = () => { J.stopReading(); const s = S(); s.reading = null; s.readingIdx = null; syncReadButtons(); };
  J.act.mailReply = (el) => J.mailReply(J.state.mails[Number(el.dataset.i)]);
  J.act.mailReplyAll = (el) => J.mailReply(J.state.mails[Number(el.dataset.i)], '', { all: true });

  // Comptes
  const PRESETS = { gmail: ['imap.gmail.com', 993, 'smtp.gmail.com', 587], outlook: ['outlook.office365.com', 993, 'smtp.office365.com', 587], icloud: ['imap.mail.me.com', 993, 'smtp.mail.me.com', 587], yahoo: ['imap.mail.yahoo.com', 993, 'smtp.mail.yahoo.com', 587] };
  J.act.addMail = () => J.modal(`<h2>Ajouter un compte IMAP / SMTP</h2><p class="muted small">Paramètres fournis par ton hébergeur ou l'administrateur du parlement. Les mots de passe sont stockés dans le trousseau chiffré de macOS, jamais en clair.</p>
  <label class="f" for="mPreset">Modèle</label><select id="mPreset" data-act="mailPreset"><option value="">Autre / parlement (saisie manuelle)</option><option value="gmail">Gmail (mot de passe d'application requis)</option><option value="outlook">Outlook / Microsoft 365</option><option value="icloud">iCloud</option><option value="yahoo">Yahoo</option></select>
  <div class="mail-warn" id="mPresetHint" role="note" hidden></div>
  <div class="grid g2"><div><label class="f" for="mLab">Nom du compte</label><input id="mLab" placeholder="Parlement"></div><div><label class="f" for="mEm">Adresse e-mail</label><input id="mEm" type="email" autocomplete="off" placeholder="prenom.nom@exemple.be"></div>
  <div><label class="f" for="mIh">Serveur IMAP</label><input id="mIh" placeholder="imap.exemple.be"></div><div><label class="f" for="mIp">Port IMAP (993 conseillé)</label><input id="mIp" value="993" inputmode="numeric"></div>
  <div><label class="f" for="mSh">Serveur SMTP</label><input id="mSh" placeholder="smtp.exemple.be"></div><div><label class="f" for="mSp">Port SMTP (587 ou 465)</label><input id="mSp" value="587" inputmode="numeric"></div>
  <div><label class="f" for="mUs">Identifiant (si différent de l'adresse)</label><input id="mUs" autocomplete="off"></div><div><label class="f" for="mPw">Mot de passe / mot de passe d'application</label><input id="mPw" type="password" autocomplete="off"></div></div>
  <div class="row" style="margin-top:14px"><button class="pri" data-act="saveMail">Ajouter et tester</button><button data-act="closeModal">Annuler</button></div>`);
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'mPreset') return; const p = PRESETS[e.target.value]; const hint = document.getElementById('mPresetHint');
    if (p) { document.getElementById('mIh').value = p[0]; document.getElementById('mIp').value = p[1]; document.getElementById('mSh').value = p[2]; document.getElementById('mSp').value = p[3]; }
    const msg = { gmail: 'Gmail : active IMAP (Paramètres → Transfert et POP/IMAP) et crée un « mot de passe d\'application » (compte Google → Sécurité → Validation en 2 étapes). Ton mot de passe habituel sera refusé.', outlook: 'Microsoft 365 : si la connexion est refusée, ton administrateur doit autoriser IMAP/SMTP, ou il faut un mot de passe d\'application.', icloud: 'iCloud : utilise un « mot de passe pour app » créé sur appleid.apple.com.', yahoo: 'Yahoo : crée un « mot de passe d\'application » dans la sécurité du compte.' }[e.target.value];
    hint.hidden = !msg; hint.textContent = msg || '';
  });
  J.act.mailPreset = () => {};
  J.act.saveMail = (el) => J.busy(el, async () => {
    const email = String(J.val('mEm') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { document.getElementById('mEm').focus(); throw new Error('Indique une adresse e-mail valide (prenom.nom@exemple.be).'); }
    if (!String(J.val('mIh') || '').trim() || !String(J.val('mSh') || '').trim()) throw new Error('Renseigne les serveurs IMAP et SMTP (ou choisis un modèle).');
    if (!J.val('mPw')) { document.getElementById('mPw').focus(); throw new Error('Saisis le mot de passe (ou le mot de passe d\'application).'); }
    const acc = await J.call('mail.add', { label: J.val('mLab'), email, imapHost: J.val('mIh'), imapPort: J.val('mIp'), smtpHost: J.val('mSh'), smtpPort: J.val('mSp'), imapUser: J.val('mUs'), imapPass: J.val('mPw') });
    J.closeModal(); await J.render();
    try { const r = await J.call('mail.test', { id: acc.id }); J.toast('Compte ajouté. ' + r.detail, 'ok'); } catch (e) { J.toast('Compte ajouté, mais la connexion échoue : ' + J.errMsg(e), 'err'); }
  }, 'Ajout…');
  J.act.rmMail = async (el) => { if (!(J.confirm ? await J.confirm("Retirer ce compte ? Ses mots de passe seront effacés de cet ordinateur ; tes courriels restent chez ton hébergeur.", { ok: 'Retirer', danger: true, title: 'Retirer le compte' }) : confirm('Retirer ce compte ?'))) return; await J.call('mail.remove', { id: el.dataset.id }); S().msgs = []; S().sel = ''; J.render(); };
  J.act.testMail = (el) => J.busy(el, async () => {
    const out = document.getElementById('t_' + el.dataset.id.replace(/[^\w-]/g, '_'));
    if (out) { out.className = 'mail-test'; out.textContent = 'Test de connexion…'; }
    try { const r = await J.call('mail.test', { id: el.dataset.id }); if (out) { out.className = 'mail-test ok'; out.textContent = '✓ ' + r.detail; } J.toast(r.detail, 'ok'); }
    catch (e) { if (out) { out.className = 'mail-test ko'; out.textContent = '✗ ' + J.errMsg(e); } throw e; }
  }, 'Test…');

  // Composer
  const composeKey = 'compose';
  const rawFromForm = () => { const sel = document.getElementById('cAcc'); return J.call('mail.compose', { from: sel.selectedOptions[0].dataset.email, to: J.val('cTo'), cc: J.val('cCc'), bcc: J.val('cBcc'), subject: J.val('cSub'), body: J.val('cBody'), inReplyTo: J.state.composeMeta?.inReplyTo, references: J.state.composeMeta?.references }); };
  const formSnap = () => ({ to: J.val('cTo'), cc: J.val('cCc'), bcc: J.val('cBcc'), subject: J.val('cSub'), body: J.val('cBody'), account: J.val('cAcc') });
  const hasContent = (d) => d && (d.to || d.cc || d.bcc || d.subject || (d.body && d.body.trim()));
  J.act.clearCompose = () => { for (const id of ['cTo', 'cCc', 'cBcc', 'cSub', 'cBody']) { const e = document.getElementById(id); if (e) e.value = ''; } J.state.composeMeta = null; J.mailDraft.del(composeKey); const s = document.getElementById('cDraftState'); if (s) s.textContent = ''; };
  J.act.saveDraftMail = () => { J.mailDraft.set(composeKey, formSnap()); J.toast('Brouillon enregistré sur cet ordinateur', 'ok'); };
  J.act.sendCompose = (el) => J.busy(el, async () => {
    if (!String(J.val('cTo') || '').trim()) { document.getElementById('cTo').focus(); throw new Error('Indique au moins un destinataire dans « À ».'); }
    const raw = await rawFromForm(); const r = await J.call('mail.send', { id: J.val('cAcc'), raw });
    if (r.sent) { sentToast(r, 'Message'); J.act.clearCompose(); } else J.toast('Envoi annulé');
  });
  J.act.loadEml = async () => {
    const r = await J.call('mail.pickEml'); if (!r) return; const p = J.parseEml(r.raw);
    document.getElementById('cTo').value = p.to; document.getElementById('cCc').value = p.cc; document.getElementById('cBcc').value = p.bcc; document.getElementById('cSub').value = p.subject; document.getElementById('cBody').value = p.body;
    J.state.composeMeta = { inReplyTo: p.inReplyTo, references: p.references };
    J.toast('.eml ouvert : vérifie le texte, tu peux le modifier avant l\'envoi (les pièces jointes ne sont pas reprises).', 'ok');
  };
  J.act.saveEml = async () => { const raw = await rawFromForm(); const p = await J.call('mail.saveEml', { raw }); if (p) J.toast('Enregistré : ' + p, 'ok'); };

  J.mailPage = async (root) => {
    const accs = await J.call('mail.accounts'); J.state.mailAccs = accs;
    const pre = J.state.composePrefill || {}; J.state.composePrefill = null;
    const smtp = accs.filter((a) => a.type === 'imap'); const s = S();
    if (!accs.some((a) => a.id === s.sel) && s.sel !== '*') s.sel = accs.length > 1 ? '*' : (accs[0]?.id || '');
    const draft = !pre.to && !pre.subject && !pre.body ? J.mailDraft.get(composeKey) : null; const showDraft = hasContent(draft) ? draft : null;
    root.innerHTML = `<div id="mailRoot"><h1>Courriels</h1><p class="sub">Lecture seule (rien n'est marqué comme lu), résumé à la demande, envoi uniquement après ta validation explicite.</p>
    <div id="smartBox"></div>
    <div id="mbSettings"></div>
    <div class="card"><div class="row sp"><h2>Comptes</h2><span class="row"><button data-act="addMail">+ Compte IMAP/SMTP</button><a class="btn" href="#agenda" style="text-decoration:none">+ Compte Google</a></span></div>
    ${accs.map((a) => `<div class="mail-acc"><div class="row sp"><span>${a.type === 'google' ? '🟢' : '✉️'} <b>${J.esc(a.label)}</b> <span class="muted small">${J.esc(a.email)}</span>${a.type === 'imap' && a.hasPassword === false ? ' <span class="pill warn">mot de passe manquant</span>' : ''}</span><span class="row"><button class="sm" data-act="testMail" data-id="${J.esc(a.id)}">Tester</button><button class="sm danger" data-act="rmMail" data-id="${J.esc(a.id)}">Retirer</button></span></div><div class="mail-test" id="t_${J.esc(a.id.replace(/[^\w-]/g, '_'))}" role="status" aria-live="polite"></div></div>`).join('') || '<div class="empty">Aucun compte pour l\'instant.<p class="muted small" style="margin:6px 0 0">Ajoute un compte IMAP (parlement, Gmail avec mot de passe d\'application…) ou connecte Google pour lire tes courriels.</p></div>'}</div>
    <div class="card"><h2>Boîte de réception</h2>${accs.length ? `<div class="row"><label class="mail-sr" for="mAcc">Compte</label><select id="mAcc" class="grow">${accs.length > 1 ? `<option value="*" ${s.sel === '*' ? 'selected' : ''}>Tous les comptes</option>` : ''}${accs.map((a) => `<option value="${J.esc(a.id)}" ${a.id === s.sel ? 'selected' : ''}>${J.esc(a.label)}</option>`).join('')}</select><label class="mail-sr" for="mN">Nombre de messages</label><select id="mN" style="width:96px">${[5, 10, 20, 50].map((n) => `<option ${n === s.n ? 'selected' : ''}>${n}</option>`).join('')}</select><button data-act="readMail">Actualiser</button><button class="pri" data-act="sumMail">Lire et résumer</button></div>
      ${J.S._env.local ? '' : '<label class="chk"><input type="checkbox" id="mCloud"> J\'autorise l\'envoi du contenu de ces courriels au moteur IA cloud (pour le résumé)</label>'}<div id="mOut" style="margin-top:12px" aria-live="polite"></div>` : '<p class="muted">Ajoute un compte ci-dessus pour afficher ta boîte de réception.</p>'}</div>
    <div class="card" id="cCard"><h2>Envoyer un message</h2>
      ${smtp.length ? `${showDraft ? '<div class="mail-warn" role="status" id="cDraftNote">Brouillon retrouvé (enregistré sur cet ordinateur). <button class="sm" data-act="clearCompose">Repartir de zéro</button></div>' : ''}<div class="grid g2"><div><label class="f" for="cAcc">Compte d'envoi</label><select id="cAcc">${smtp.map((a) => `<option value="${J.esc(a.id)}" data-email="${J.esc(a.email)}">${J.esc(a.label)}</option>`).join('')}</select></div><div><label class="f" for="cTo">À</label><input id="cTo" value="${J.esc(pre.to || '')}" placeholder="destinataire@exemple.be" autocomplete="off" spellcheck="false"></div></div>
      <div class="grid g2"><div><label class="f" for="cCc">Cc</label><input id="cCc" autocomplete="off" spellcheck="false"></div><div><label class="f" for="cBcc">Cci (copie cachée)</label><input id="cBcc" autocomplete="off" spellcheck="false"></div></div>
      <label class="f" for="cSub">Objet</label><input id="cSub" value="${J.esc(pre.subject || '')}">
      <label class="f" for="cBody">Message</label><textarea id="cBody" style="min-height:220px">${J.esc(pre.body || '')}</textarea>
      <div class="row" style="margin-top:10px"><button class="pri" data-act="sendCompose">Vérifier et envoyer…</button><button data-act="saveDraftMail">Enregistrer le brouillon</button><button data-act="loadEml">Ouvrir un .eml</button><button data-act="saveEml">Enregistrer en .eml</button><span class="muted small" id="cDraftState" role="status" aria-live="polite"></span></div>
      <p class="muted small">Une fenêtre de confirmation affiche le compte, tous les destinataires et le texte. Texte brut, sans pièce jointe.</p>` : '<p class="muted">Ajoute un compte IMAP/SMTP pour pouvoir envoyer (les comptes Google sont en lecture seule).</p>'}</div></div>`;

    const rootEl = document.getElementById('mailRoot');
    if (showDraft && smtp.length) { for (const [id, k] of [['cTo', 'to'], ['cCc', 'cc'], ['cBcc', 'bcc'], ['cSub', 'subject'], ['cBody', 'body']]) { const e = document.getElementById(id); if (e && showDraft[k] != null) e.value = showDraft[k]; } const a = document.getElementById('cAcc'); if (a && showDraft.account && [...a.options].some((o) => o.value === showDraft.account)) a.value = showDraft.account; }
    const saveCompose = debounce(() => { const d = formSnap(); if (!hasContent(d)) return J.mailDraft.del(composeKey); J.mailDraft.set(composeKey, d); const st = document.getElementById('cDraftState'); if (st) st.textContent = 'Brouillon enregistré ' + new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }); }, 800);
    document.getElementById('cCard')?.addEventListener('input', saveCompose);
    const stopIfReading = () => { if (S().reading != null) J.act.mailStop(); };
    const filt = debounce(() => { stopIfReading(); S().q = document.getElementById('mQ')?.value || ''; renderList(); }, 120);
    rootEl.addEventListener('input', (e) => { if (e.target.id === 'mQ') filt(); });
    rootEl.addEventListener('change', (e) => {
      if (e.target.id === 'mUnreadOnly') { stopIfReading(); S().onlyUnread = e.target.checked; renderList(); }
      else if (e.target.id === 'mUnreadFirst') { stopIfReading(); S().unreadFirst = e.target.checked; renderList(); }
      else if (e.target.id === 'mAcc' || e.target.id === 'mN') { S().summary = ''; load({}); }
    });
    rootEl.addEventListener('keydown', (e) => { // navigation au clavier entre les messages
      const t = e.target.closest && e.target.closest('.mail-toggle'); if (!t) return;
      const all = J.$$('.mail-toggle', rootEl); const k = all.indexOf(t); let n = null;
      if (e.key === 'ArrowDown') n = all[k + 1]; else if (e.key === 'ArrowUp') n = all[k - 1]; else if (e.key === 'Home') n = all[0]; else if (e.key === 'End') n = all[all.length - 1];
      if (n) { e.preventDefault(); n.focus(); }
    });

    if (J.mountMailbox) J.mountMailbox(document.getElementById('smartBox'));
    if (J.mountMailSettings) J.mountMailSettings(document.getElementById('mbSettings')); // expéditeurs urgents + réglages de la surveillance
    if (!accs.length) return;
    // Affichage immédiat des derniers messages connus (retour sur la page), sinon lecture automatique : c'est une lecture seule locale.
    const fresh = s.msgs.length && s.loadedFor === s.sel + '|' + s.n && Date.now() - s.loadedAt < 60000;
    if (fresh) { s.state = 'done'; renderResults(); } else load({});
  };
  // Quitter la page arrête toute lecture à voix haute lancée depuis elle ; Échap l'arrête aussi.
  window.addEventListener('hashchange', () => { const s = J.state.mail; if (s && s.pageReading && !location.hash.startsWith('#courriels')) { J.stopReading(); s.reading = null; s.readingIdx = null; s.pageReading = false; } });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const s = J.state.mail; if (s && s.reading != null && !document.querySelector('#modal-root .modal')) J.act.mailStop(); });
})();
