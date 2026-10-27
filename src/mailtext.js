// Nettoyage des courriels : HTML → texte lisible, adresses, citation pour une réponse.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', euro: '€', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', copy: '©', middot: '·', bull: '•' };
const decode = (s) => s.replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
  .replace(/&#x([0-9a-f]+);/gi, (_m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } })
  .replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m);

function htmlToText(html) {
  const t = String(html || '')
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');
  return decode(t).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const looksHtml = (s) => /^\s*(<!doctype html|<html|<head|<body|<table|<div|<meta|<style)/i.test(s || '') || (/<(p|div|table|span|br)\b/i.test(s || '') && /<\/(p|div|table|span|a)>/i.test(s || ''));

// Complète un message { text, html } : jamais de HTML brut dans `text`.
function normalize(m) {
  let { text = '', html = '' } = m;
  if (looksHtml(text)) { if (!html) html = text; text = htmlToText(text); }
  if (!text && html) text = htmlToText(html);
  return { ...m, text: text.slice(0, 20000), html: String(html || '').slice(0, 400000) };
}

const addrOf = (s) => ((String(s || '').match(/<([^>]+)>/) || [null, s])[1] || '').trim();
const nameOf = (s) => { const t = String(s || '').replace(/<[^>]*>/, '').replace(/^["'\s]+|["'\s]+$/g, '').trim(); return t || addrOf(s); };

// Texte adapté à la lecture à voix haute : sans liens, sans citations, borné.
function speakable(text, max = 700) {
  let t = String(text || '').split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join('\n')
    .replace(/https?:\/\/\S+/g, '').replace(/\S+@\S+\.\S+/g, 'une adresse e-mail').replace(/[-_=*~]{3,}/g, ' ')
    .replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return { text: t, cut: false };
  const cut = t.slice(0, max); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return { text: (i > max * 0.5 ? cut.slice(0, i + 1) : cut).trim(), cut: true };
}

function replyPrefill(m, ownEmail) {
  const to = addrOf(m.replyTo || m.from);
  const subject = /^\s*(re|réf|ref)\s*:/i.test(m.subject || '') ? m.subject : 'Re : ' + (m.subject || '');
  const when = m.date ? new Date(m.date).toLocaleString('fr-BE', { dateStyle: 'long', timeStyle: 'short' }) : '';
  const quote = `Le ${when}, ${nameOf(m.from)} a écrit :\n` + String(m.text || '').split(/\r?\n/).slice(0, 60).map((l) => '> ' + l).join('\n');
  return { to, subject, quote, inReplyTo: m.messageId || '', references: [m.references, m.messageId].filter(Boolean).join(' ').trim(), account: m.account, ownEmail: ownEmail || '' };
}

module.exports = { htmlToText, looksHtml, normalize, addrOf, nameOf, speakable, replyPrefill };
