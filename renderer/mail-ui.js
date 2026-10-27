// Courriels : affichage visuel (HTML nettoyé dans un cadre isolé), lecture à voix haute, réponse.
(() => {
  J.nameOf = (s) => { const t = String(s || '').replace(/<[^>]*>/, '').replace(/^["'\s]+|["'\s]+$/g, '').trim(); return t || String(s || '').replace(/[<>]/g, ''); };

  // ---- Affichage ----
  // Le HTML reçu est nettoyé (aucun script, formulaire, cadre ni lien javascript) puis affiché dans un cadre sans scripts.
  // Les images distantes sont bloquées par la politique de sécurité de l'app : pas de pisteur, pas de fuite d'adresse IP.
  const clean = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,frame,frameset,object,embed,link,meta,base,form,input,button,textarea,select,audio,video,svg,noscript').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
        if (n.startsWith('on') || n === 'srcset' || ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'background') && /^(javascript|vbscript|data:text\/html)/.test(v))) el.removeAttribute(a.name);
      }
    });
    doc.querySelectorAll('style').forEach((s) => { s.textContent = s.textContent.replace(/@import[^;]+;/gi, ''); });
    return doc.body ? doc.body.innerHTML : '';
  };
  const BASE = '<style>html,body{margin:0}body{font:14px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#1b2333;background:#fff;padding:14px 16px;word-break:break-word}img{max-width:100%;height:auto}img[src^="http"]{display:none}a{color:#0b5cad}table{max-width:100%}blockquote{margin:8px 0;padding-left:10px;border-left:3px solid #d6dbe6;color:#566}</style>';
  J.mailBody = (m, i) => (m.html ? `<iframe class="mailframe" data-i="${i}" sandbox="allow-same-origin" srcdoc="${J.esc(BASE + clean(m.html))}"></iframe>` : `<pre class="mailtext">${J.esc(m.text || '')}</pre>`);
  J.mountMailFrames = (root = document) => J.$$('iframe.mailframe', root).forEach((f) => {
    const fit = () => {
      try {
        const d = f.contentDocument; f.style.height = Math.min(520, d.documentElement.scrollHeight + 4) + 'px';
        d.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (!a) return; e.preventDefault(); const h = a.getAttribute('href') || ''; if (/^https?:\/\//i.test(h)) J.call('app.openExternal', { url: h }).catch(J.err); });
      } catch { /* cadre inaccessible */ }
    };
    f.addEventListener('load', fit); if (f.contentDocument && f.contentDocument.readyState === 'complete') fit();
  });

  // ---- Lecture à voix haute ----
  J.speakable = (text, max = 700) => {
    const t = String(text || '').split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join('\n').replace(/https?:\/\/\S+/g, '').replace(/\S+@\S+\.\S+/g, 'une adresse e-mail').replace(/[-_=*~]{3,}/g, ' ').replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return { text: t, cut: false };
    const cut = t.slice(0, max); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return { text: (i > max * 0.5 ? cut.slice(0, i + 1) : cut).trim(), cut: true };
  };
  // Chaque mail est annoncé comme un nouveau mail.
  J.mailSpeech = (m) => { const b = J.speakable(m.text); return `Nouveau mail. De ${J.nameOf(m.from)}. Objet : ${m.subject}. ${b.text || 'Le message est vide.'} ${b.cut ? 'Le message est plus long : ouvrez-le pour lire la suite.' : 'Fin du message.'}`; };
  J.readToken = 0;
  J.readMails = async (msgs, onItem) => {
    const my = ++J.readToken;
    for (let i = 0; i < msgs.length; i++) {
      if (my !== J.readToken) return false; if (onItem) onItem(i);
      await J.speak(J.mailSpeech(msgs[i])); if (my !== J.readToken) return false;
      await new Promise((r) => setTimeout(r, 700));
    }
    return true;
  };
  J.stopReading = () => { J.readToken++; J.stopSpeak(); };

  // ---- Répondre ----
  J.mailReply = async (m, instruction = '') => {
    const [accs, pre] = await Promise.all([J.call('mail.accounts'), J.call('mail.reply.prefill', { message: m })]);
    const smtp = accs.filter((a) => a.type === 'imap'); J.state.reply = { m, pre };
    J.modal(`<h2>↩ Répondre à ${J.esc(J.nameOf(m.from))}</h2>
      <div class="muted small" style="margin-bottom:8px">Message d'origine : ${J.esc(m.subject)}</div>
      ${smtp.length ? '' : '<div class="banner">Aucun compte d\'envoi (SMTP) : prépare la réponse puis copie-la, ou ajoute un compte dans la page Courriels.</div>'}
      <div class="grid g2"><div><label class="f">Envoyer depuis</label><select id="rAcc">${smtp.map((a) => `<option value="${a.id}" data-email="${J.esc(a.email)}" ${a.id === pre.sendAccount ? 'selected' : ''}>${J.esc(a.label)} (${J.esc(a.email)})</option>`).join('')}</select></div><div><label class="f">À</label><input id="rTo" value="${J.esc(pre.to)}"></div></div>
      <div class="grid g2"><div><label class="f">Cc</label><input id="rCc"></div><div><label class="f">Objet</label><input id="rSub" value="${J.esc(pre.subject)}"></div></div>
      <label class="f">Ce que vous voulez répondre — Jarvis rédige (facultatif)</label>
      <div class="row"><input id="rIns" class="grow" value="${J.esc(instruction)}" placeholder="Ex. : Merci, je confirme ma présence et je demande l'ordre du jour"><button class="sm" data-act="mic" data-target="rIns">🎤</button><button class="sm pri" data-act="rDraft">✨ Proposer une réponse</button></div>
      ${J.S._env.local ? '' : '<label class="chk"><input type="checkbox" id="rCloud"> J\'autorise l\'envoi de ce courriel au moteur IA cloud pour proposer la réponse</label>'}
      <label class="f">Réponse</label><textarea id="rBody" style="min-height:220px">\n\n${J.esc(pre.quote)}</textarea>
      <div class="row" style="margin-top:12px"><button class="pri" data-act="rSend">Vérifier et envoyer…</button><button data-act="rCopy">Copier</button><button data-act="closeModal">Annuler</button></div>
      <p class="muted small">Une fenêtre de confirmation affiche le compte, les destinataires et le texte avant tout envoi.</p>`);
    if (instruction) J.act.rDraft(J.$('[data-act=rDraft]'));
  };
  J.act.rDraft = (el) => J.busy(el, async () => {
    const { m, pre } = J.state.reply;
    const r = await J.call('mail.reply.draft', { message: m, instruction: J.val('rIns'), allowCloud: J.S._env.local ? true : J.val('rCloud') });
    document.getElementById('rBody').value = r.text.trim() + '\n\n' + pre.quote;
  }, 'Rédaction…');
  J.act.rCopy = () => J.copy(J.val('rBody'));
  J.act.rSend = (el) => J.busy(el, async () => {
    const { pre } = J.state.reply; const sel = document.getElementById('rAcc');
    if (!sel || !sel.value) return J.toast("Aucun compte d'envoi : copie la réponse ou ajoute un compte SMTP.", 'err');
    const raw = await J.call('mail.compose', { from: sel.selectedOptions[0].dataset.email, to: J.val('rTo'), cc: J.val('rCc'), subject: J.val('rSub'), body: J.val('rBody'), inReplyTo: pre.inReplyTo, references: pre.references });
    const r = await J.call('mail.send', { id: sel.value, raw });
    if (r.sent) { J.toast('Réponse acceptée par le serveur SMTP', 'ok'); J.closeModal(); } else J.toast('Envoi annulé');
  }, 'Vérification…');
})();
