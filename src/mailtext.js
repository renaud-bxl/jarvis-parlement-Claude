// Nettoyage des courriels : HTML → texte lisible, HTML assaini, adresses, en-têtes, citation pour une réponse.
// Tout est écrit sans dépendance et en temps linéaire (un courriel hostile ne doit pas pouvoir figer l'application).

// ---------- Entités HTML ----------
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', euro: '€', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sbquo: '‚', bdquo: '„', ndash: '–', mdash: '—', bull: '•', trade: '™', oelig: 'œ', OElig: 'Œ', rarr: '→', larr: '←', check: '✓', zwnj: '', zwj: '', thinsp: ' ', ensp: ' ', emsp: ' ' };
('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml')
  .split(' ').forEach((n, i) => { NAMED[n] = String.fromCharCode(160 + i); });

const decode = (s) => String(s).replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, d, h, n) => {
  if (n) return NAMED[n] ?? NAMED[n.toLowerCase()] ?? m;
  const cp = d ? +d : parseInt(h, 16);
  if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
  return String.fromCodePoint(cp);
});

// ---------- Tokeniseur HTML (linéaire, tolérant) ----------
const SKIP = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'svg', 'math', 'template', 'object', 'applet', 'audio', 'video', 'canvas', 'select', 'datalist']);
const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr', 'meta', 'link', 'input', 'base', 'area', 'embed', 'source', 'track', 'param']);
const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;

function tokenize(src) {
  const s = String(src); const low = s.toLowerCase(); const n = s.length; const out = []; let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out.push({ t: 'text', v: s.slice(i) }); break; }
    if (lt > i) out.push({ t: 'text', v: s.slice(i, lt) });
    i = lt;
    const c = s.charCodeAt(i + 1);
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
    if (c === 33 || c === 63) { const e = s.indexOf('>', i); i = e < 0 ? n : e + 1; continue; } // <!doctype>, <?xml?>, <![endif]>
    if (c === 47) { // </tag>
      const e = s.indexOf('>', i); if (e < 0) break;
      const m = /^[a-zA-Z][^\s/>]*/.exec(s.slice(i + 2, e));
      if (m) out.push({ t: 'close', name: m[0].toLowerCase() });
      i = e + 1; continue;
    }
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) { out.push({ t: 'text', v: '<' }); i++; continue; }
    let j = i + 1; while (j < n && !isWs(s.charCodeAt(j)) && s[j] !== '/' && s[j] !== '>') j++;
    const name = low.slice(i + 1, j); const attrs = []; let closed = false;
    while (j < n) {
      while (j < n && (isWs(s.charCodeAt(j)) || s[j] === '/')) j++;
      if (j >= n) break;
      if (s[j] === '>') { j++; closed = true; break; }
      let k = j; while (k < n && !isWs(s.charCodeAt(k)) && s[k] !== '=' && s[k] !== '>' && s[k] !== '/') k++;
      if (k === j) { j++; continue; }
      const an = low.slice(j, k); j = k;
      while (j < n && isWs(s.charCodeAt(j))) j++;
      let val = '';
      if (s[j] === '=') {
        j++; while (j < n && isWs(s.charCodeAt(j))) j++;
        const q = s[j];
        if (q === '"' || q === "'") { const e = s.indexOf(q, j + 1); if (e < 0) { j = n; break; } val = s.slice(j + 1, e); j = e + 1; }
        else { let e = j; while (e < n && !isWs(s.charCodeAt(e)) && s[e] !== '>') e++; val = s.slice(j, e); j = e; }
      }
      if (attrs.length < 60) attrs.push([an, val]);
    }
    if (!closed) break; // balise incomplète en fin de document : ignorée
    i = j;
    out.push({ t: 'open', name, attrs });
    if (SKIP.has(name)) {
      const close = name === 'plaintext' ? -1 : low.indexOf('</' + name, i);
      if (close < 0) { out.push({ t: 'raw', name, body: s.slice(i) }); i = n; }
      else { const gt = s.indexOf('>', close); out.push({ t: 'raw', name, body: s.slice(i, close) }); i = gt < 0 ? n : gt + 1; }
      out.push({ t: 'close', name });
    }
  }
  return out;
}

// ---------- HTML → texte ----------
const BLOCK = new Set(['p', 'div', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote', 'ul', 'ol', 'section', 'article', 'header', 'footer', 'pre', 'dl', 'dt', 'dd', 'center', 'address', 'figure', 'aside', 'nav', 'main', 'caption', 'hr', 'br']);
const HIDDEN_RX = /display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|font-size\s*:\s*0(?:px|pt|em)?\s*(?:;|$)|max-height\s*:\s*0(?:px)?\s*(?:;|$)|opacity\s*:\s*0\s*(?:;|$)/i;
const ZERO_WIDTH = /[\u200b-\u200f\u2060\u00ad\ufeff\u034f\u2028\u2029]/g;

function htmlToText(html) {
  const toks = tokenize(String(html || '').slice(0, 700000));
  let out = ''; let hidden = null; let hd = 0;
  for (const t of toks) {
    if (t.t === 'raw') continue;
    if (t.t === 'text') { if (!hidden) out += decode(t.v); continue; }
    if (t.t === 'open') {
      if (hidden) { if (t.name === hidden && !VOID.has(t.name)) hd++; continue; }
      if (!VOID.has(t.name) && t.attrs.some(([k, v]) => k === 'hidden' || (k === 'style' && HIDDEN_RX.test(v)))) { hidden = t.name; hd = 1; continue; }
      if (t.name === 'li') { if (out && !out.endsWith('\n')) out += '\n'; out += '- '; } else if (BLOCK.has(t.name)) out += '\n';
      continue;
    }
    if (hidden) { if (t.name === hidden && --hd <= 0) hidden = null; continue; }
    if (t.name === 'li') { if (out && !out.endsWith('\n')) out += '\n'; } else if (BLOCK.has(t.name)) out += '\n'; else if (t.name === 'td' || t.name === 'th') out += ' ';
  }
  return out.replace(ZERO_WIDTH, '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const looksHtml = (s) => /^\s*(<!doctype html|<html|<head|<body|<table|<div|<meta|<style)/i.test(s || '') || (/<(p|div|table|span|br)\b/i.test(s || '') && /<\/(p|div|table|span|a)>/i.test(s || ''));

// ---------- HTML assaini (liste blanche, sortie canonique) ----------
// Le HTML d'un courriel est une donnée hostile : on ne le « nettoie » pas, on le RECONSTRUIT à partir d'éléments et d'attributs autorisés.
// Aucun script, cadre, formulaire, svg/math (mXSS), lien non http(s)/mailto/tel, image distante ni @import ne peut survivre.
const ALLOW = new Set('a abbr acronym address article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q s samp section small span strike strong sub sup table tbody td tfoot th thead time tr tt u ul var wbr'.split(' '));
const ATTR_OK = new Set(['class', 'id', 'style', 'dir', 'lang', 'title', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'nowrap', 'face', 'size', 'span', 'start', 'type', 'scope']);
const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripCtl = (v) => String(v).replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
const MAX_DATA_IMG = 250000;

function cleanCss(css) {
  let c = String(css);
  for (let g = 0; g < 400; g++) { const a = c.indexOf('/*'); if (a < 0) break; const b = c.indexOf('*/', a + 2); c = b < 0 ? c.slice(0, a) : c.slice(0, a) + c.slice(b + 2); }
  c = c.replace(/\\/g, '').replace(/</g, '');
  c = c.replace(/@(?:import|charset|namespace)\b[^;{}]{0,2000};?/gi, '').replace(/@font-face\s*\{[^}]{0,4000}\}/gi, '');
  c = c.replace(/url\s*\([^)]{0,3000}\)/gi, 'none').replace(/image-set\s*\([^)]{0,3000}\)/gi, 'none');
  c = c.replace(/expression\s*\(|behaviou?r\s*:|-moz-binding|javascript\s*:|vbscript\s*:|-webkit-user-modify/gi, 'x-').replace(/position\s*:\s*fixed/gi, 'position:static');
  return c.trim();
}

function safeUrl(v, kinds) {
  const u = stripCtl(decode(v));
  if (!u) return '';
  if (kinds.hash && u[0] === '#') return u.length < 200 ? u : '';
  if (kinds.link && /^(https?:|mailto:|tel:)/i.test(u) && u.length < 4000) return u;
  return '';
}

function sanitizeHtml(html, opts = {}) {
  const cid = opts.cid || {}; const maxOut = opts.max || 300000;
  const toks = tokenize(String(html || '').slice(0, 700000));
  let out = ''; let blocked = 0; let truncated = false; let styleBytes = 0;
  for (const t of toks) {
    if (out.length > maxOut) { truncated = true; break; }
    if (t.t === 'text') { out += t.v.replace(/</g, '&lt;'); continue; }
    if (t.t === 'raw') {
      if (t.name === 'style') { const css = cleanCss(t.body); if (css && styleBytes + css.length < 60000) { styleBytes += css.length; out += '<style>' + css + '</style>'; } }
      continue;
    }
    if (!ALLOW.has(t.name)) continue;
    if (t.t === 'close') { if (!VOID.has(t.name)) out += '</' + t.name + '>'; continue; }
    let attrs = ''; let alt = ''; let src = null;
    for (const [k, raw] of t.attrs) {
      const v = decode(raw);
      if (k === 'alt' && t.name === 'img') { alt = v.slice(0, 200); continue; }
      if (k === 'href' && t.name === 'a') { const u = safeUrl(raw, { link: true, hash: true }); if (u) attrs += ` href="${escAttr(u)}" rel="noopener noreferrer" title="${escAttr(u.slice(0, 300))}"`; continue; }
      if (k === 'src' && t.name === 'img') { src = stripCtl(v); continue; }
      if (k === 'style') { const css = cleanCss(v); if (css && css.length < 6000) attrs += ` style="${escAttr(css)}"`; continue; }
      if (k === 'class' || k === 'id') { const cl = v.replace(/[^\w\- ]/g, '').slice(0, 200); if (cl) attrs += ` ${k}="${cl}"`; continue; }
      if (k === 'title' && t.name === 'a') continue;
      if (!ATTR_OK.has(k)) continue;
      if (/^(width|height|border|cellpadding|cellspacing|colspan|rowspan|size|span|start)$/.test(k) && !/^[\d.]+%?$/.test(v.trim())) continue;
      attrs += ` ${k}="${escAttr(v.slice(0, 200))}"`;
    }
    if (t.name === 'img') {
      let ok = '';
      if (src && /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(src) && src.length <= MAX_DATA_IMG) ok = src;
      else if (src && /^cid:/i.test(src)) ok = cid[src.slice(4).replace(/^<|>$/g, '').toLowerCase()] || '';
      if (ok) out += `<img src="${escAttr(ok)}"${attrs}${alt ? ` alt="${escAttr(alt)}"` : ''}>`;
      else { if (src) blocked++; if (alt.trim()) out += `<span class="img-blocked">${escAttr(alt)}</span>`; }
      continue;
    }
    out += `<${t.name}${attrs}>`;
  }
  if (truncated) { const k = out.lastIndexOf('>'); out = k > 0 ? out.slice(0, k + 1) : out; }
  return { html: out.trim() ? '<body>' + out + '</body>' : '', blocked, truncated };
}

// ---------- Normalisation d'un courriel ----------
const unquoteLines = (text) => String(text || '').split('\n').filter((l) => !/^\s*>/.test(l));
function makeSnippet(text) {
  const t = unquoteLines(cutSignature(String(text || ''))).join(' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 200 ? t.slice(0, 200).replace(/\s+\S*$/, '') + '…' : t;
}

// Complète un message { text, html } : jamais de HTML brut dans `text`, HTML toujours assaini.
function normalize(m) {
  const { cid, ...rest } = m || {};
  let text = String(rest.text || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, ''); let html = String(rest.html || '');
  if (looksHtml(text)) { if (!html) html = text; text = htmlToText(text); }
  if (!text.trim() && html) text = htmlToText(html);
  let imagesBlocked = 0, htmlTruncated = false;
  if (html) { const s = sanitizeHtml(html, { cid }); html = s.html; imagesBlocked = s.blocked; htmlTruncated = s.truncated; }
  const textTruncated = text.length > 20000;
  return { ...rest, text: text.slice(0, 20000), html, imagesBlocked, textTruncated: textTruncated || htmlTruncated || !!rest.sourceTruncated, snippet: makeSnippet(text.slice(0, 4000)) };
}

// ---------- En-têtes : mots encodés (RFC 2047) ----------
function decodeWords(s) {
  const str = String(s || '').replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?)/g, '$1');
  return str.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (m, cs, enc, data) => {
    try {
      const bytes = enc.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9a-fA-F]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return new TextDecoder(cs.replace(/\*.*$/, '').toLowerCase()).decode(bytes);
    } catch { return m; }
  });
}
// Encode un texte pour un en-tête (mots encodés ≤ 75 caractères, repliés) ; ASCII imprimable inchangé.
function encodeWord(s) {
  const str = String(s || '').replace(/[\r\n\u2028\u2029]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  const words = []; let cur = '';
  for (const ch of str) { if (Buffer.byteLength(cur + ch, 'utf8') > 45) { words.push(cur); cur = ''; } cur += ch; }
  if (cur) words.push(cur);
  return words.map((w) => '=?UTF-8?B?' + Buffer.from(w, 'utf8').toString('base64') + '?=').join('\r\n ');
}

// ---------- Adresses ----------
function splitTop(s) {
  const parts = []; let cur = ''; let q = false, ang = 0, par = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === '\\' && i + 1 < s.length) cur += s[++i]; else if (ch === '"') q = false; continue; }
    if (ch === '"') { q = true; cur += ch; continue; }
    if (ch === '(') par++; else if (ch === ')' && par) par--;
    else if (!par) { if (ch === '<') ang++; else if (ch === '>' && ang) ang--; else if ((ch === ',' || ch === ';') && !ang) { parts.push(cur); cur = ''; continue; } }
    cur += ch;
  }
  parts.push(cur); return parts.map((p) => p.trim()).filter(Boolean);
}
const ADDR_RX = /^[^\s@<>()[\]\\,;:"\x00-\x1f\x7f]+@[A-Za-z0-9\u00a1-\uffff](?:[A-Za-z0-9\u00a1-\uffff.-]*[A-Za-z0-9\u00a1-\uffff])?\.[A-Za-z0-9\u00a1-\uffff-]{2,}$/;
const validAddress = (a) => typeof a === 'string' && a.length <= 254 && !a.includes('..') && ADDR_RX.test(a);

// Analyse une liste d'adresses « Nom <a@b>, "Dupont, Marie" <m@x>, c@d » → { valid: [{name, address}], invalid: [texte] }
function parseAddresses(input) {
  const valid = [], invalid = [];
  for (let seg of splitTop(String(input || ''))) {
    if (/^[^@<>"]*:$/.test(seg)) continue; // « Undisclosed-recipients: »
    if (!/^"/.test(seg)) { const g = /^([^<>"@,]*):\s*(.+)$/.exec(seg); if (g && !/[<@]/.test(g[1])) seg = g[2]; } // « Groupe: a@b »
    seg = seg.replace(/\([^)]*\)/g, ' ').trim();
    let name = '', address = seg;
    const m = /^([\s\S]*)<([^<>]*)>\s*$/.exec(seg);
    if (m) { name = m[1].trim(); address = m[2].trim(); }
    if (/^".*"$/s.test(name)) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
    name = decodeWords(name).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (validAddress(address)) valid.push({ name, address }); else invalid.push(seg);
  }
  return { valid, invalid };
}
function formatAddress({ name, address }, encoded = false) {
  if (!name || name === address) return address;
  if (encoded && !/^[\x20-\x7e]*$/.test(name)) return `${encodeWord(name)} <${address}>`;
  return /[()<>[\]:;@\\,."]/.test(name) ? `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>` : `${name} <${address}>`;
}
const addrOf = (s) => { const p = parseAddresses(s).valid[0]; return p ? p.address : ((String(s || '').match(/<([^>]+)>/) || [null, s])[1] || '').trim(); };
const nameOf = (s) => { const p = parseAddresses(s).valid[0]; if (p) return p.name || p.address; const t = String(s || '').replace(/<[^>]*>/, '').replace(/^["'\s]+|["'\s]+$/g, '').trim(); return t || addrOf(s); };

// ---------- Corps encodés (envoi) ----------
function qpEncode(text) {
  return String(text || '').replace(/\r\n?|\n/g, '\n').split('\n').map((line) => {
    const buf = Buffer.from(line, 'utf8'); let enc = '', cur = '';
    for (let k = 0; k < buf.length; k++) {
      const b = buf[k];
      const t = (b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && k < buf.length - 1) ? String.fromCharCode(b) : '=' + b.toString(16).toUpperCase().padStart(2, '0');
      if (cur.length + t.length > 75) { enc += cur + '=\r\n'; cur = ''; }
      cur += t;
    }
    return enc + cur;
  }).join('\r\n');
}
function cteDecode(body, cte, charset) {
  let bytes;
  const e = String(cte || '').trim().toLowerCase();
  if (e === 'base64') bytes = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  else if (e === 'quoted-printable') bytes = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  else bytes = Buffer.from(body, 'utf8');
  try { return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(bytes); } catch { return bytes.toString('utf8'); }
}

// ---------- Lecture d'un .eml (en-têtes + corps texte décodé) ----------
function splitMessage(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw; const body = m ? raw.slice(m.index + m[0].length) : '';
  const list = [];
  for (const l of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) { const i = l.indexOf(':'); if (i > 0) list.push([l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]); }
  return { list, body };
}
const hget = (list, k) => (list.find((x) => x[0] === k) || [])[1] || '';
const ctParam = (ct, p) => { const m = new RegExp(p + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i').exec(ct || ''); return m ? (m[1] ?? m[2]) : ''; };

function bodyText(list, body, depth = 0) {
  const ct = hget(list, 'content-type') || 'text/plain'; const type = ct.split(';')[0].trim().toLowerCase();
  if (type.startsWith('multipart/') && depth < 5) {
    const b = ctParam(ct, 'boundary'); if (!b) return '';
    const parts = body.split('--' + b).slice(1).filter((p) => !p.startsWith('--')).map((p) => splitMessage(p.replace(/^\r?\n/, '')));
    let html = '';
    for (const p of parts) { const pt = (hget(p.list, 'content-type') || 'text/plain').split(';')[0].trim().toLowerCase(); if (/^attachment/i.test(hget(p.list, 'content-disposition'))) continue; const t = bodyText(p.list, p.body, depth + 1); if (pt === 'text/plain' && t) return t; if (t && !html) html = t; }
    return html;
  }
  const text = cteDecode(body, hget(list, 'content-transfer-encoding'), ctParam(ct, 'charset'));
  return type === 'text/html' ? htmlToText(text) : text;
}
function parseEml(raw) {
  const { list, body } = splitMessage(String(raw || ''));
  const h = {}; for (const [k, v] of list) (h[k] ||= []).push(v);
  return { list, headers: h, subject: decodeWords(h.subject?.[0] || ''), body: bodyText(list, body) };
}

// ---------- Voix : texte adapté à la lecture ----------
function cutSignature(text) {
  const lines = String(text || '').split('\n');
  const i = lines.findIndex((l, k) => k > 0 && /^\s*(--\s*|_{5,}|-{5,}\s*(Original Message|Message d.origine|Message transf[ée]r[ée]|Forwarded message)[^-]*-{0,5}|Le .{5,140} a [ée]crit\s*:|On .{5,140} wrote:|Envoy[ée] de mon (iPhone|iPad|Android|t[ée]l[ée]phone)|Sent from my .*)\s*$/i.test(l));
  return (i > 0 ? lines.slice(0, i) : lines).join('\n');
}
function speakable(text, max = 700) {
  let t = unquoteLines(cutSignature(String(text || '').replace(/\r\n?/g, '\n'))).join('\n')
    .replace(/https?:\/\/\S+/g, '').replace(/[^\s@<>]{1,64}@[^\s@<>]{1,255}\.[^\s@<>]{1,63}/g, 'une adresse e-mail').replace(/[-_=*~]{3,}/g, ' ')
    .replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return { text: t, cut: false };
  const cut = t.slice(0, max); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return { text: (i > max * 0.5 ? cut.slice(0, i + 1) : cut).trim(), cut: true };
}

// ---------- Réponse ----------
const REPLY_PREFIX = /^(?:\s*(?:re|aw|sv|antw|r[eé]p)(?:\[\d+\])?\s*:\s*)+/i;
function replySubject(subject) {
  const s = String(subject || '').replace(/[\r\n]+/g, ' ').trim();
  const base = (s === '(sans objet)' ? '' : s.replace(REPLY_PREFIX, '')).trim();
  return base ? 'Re : ' + base : 'Re :';
}
const NOREPLY_RX = /(?:^|[._-])(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|ne[-_.]?pas[-_.]?repondre|noreply|mailer-daemon|postmaster)(?:[._+-]|@)/i;
const formatWhen = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toLocaleString('fr-BE', { dateStyle: 'long', timeStyle: 'short' }) : ''; };

function replyPrefill(m, ownEmail) {
  m = m || {};
  const own = new Set([].concat(ownEmail || []).map((x) => String(x).toLowerCase()).filter(Boolean));
  const from = parseAddresses(m.from).valid[0]; const rt = parseAddresses(m.replyTo).valid[0];
  const target = rt || from;
  const to = target ? formatAddress(target) : addrOf(m.replyTo || m.from);
  const seen = new Set([target?.address.toLowerCase(), ...own]);
  const others = [];
  for (const a of [...(rt && from && rt.address.toLowerCase() !== from.address.toLowerCase() ? [from] : []), ...parseAddresses(m.to).valid, ...parseAddresses(m.cc).valid]) { const k = a.address.toLowerCase(); if (!seen.has(k)) { seen.add(k); others.push(a); } }
  const when = formatWhen(m.date); const who = nameOf(m.from) || 'L\'expéditeur';
  const body = unquoteLines(cutSignature(String(m.text || '').replace(/\r\n?/g, '\n'))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const quote = `${when ? `Le ${when}, ` : ''}${who} a écrit :\n` + body.split('\n').slice(0, 60).map((l) => '> ' + l).join('\n');
  const warn = [];
  if (rt && from && rt.address.toLowerCase() !== from.address.toLowerCase()) warn.push(`La réponse sera adressée à ${rt.address} (champ « Répondre à » du message), et non à ${from.address}.`);
  if (m.listId) warn.push('Ce message vient d\'une liste de diffusion : votre réponse peut être envoyée à tous les abonnés.');
  if (target && NOREPLY_RX.test(target.address)) warn.push('Cette adresse semble être une adresse « ne pas répondre » : votre réponse ne sera probablement lue par personne.');
  return { to, cc: '', ccAll: others.map((a) => formatAddress(a)).join(', '), hasOthers: others.length > 0, subject: replySubject(m.subject), quote, inReplyTo: m.messageId || '', references: [m.references, m.messageId].filter(Boolean).join(' ').trim(), account: m.account, ownEmail: [...own][0] || '', warn };
}

// Tri par date décroissante, fiable : dates invalides ou lointaines dans le futur → date de réception.
function sortMails(list) {
  const now = Date.now() + 864e5;
  const ts = (m) => { const d = Date.parse(m.date); if (!isNaN(d) && d <= now) return d; const r = Date.parse(m.received); return isNaN(r) ? (isNaN(d) ? 0 : d) : r; };
  return list.map((m) => [ts(m), m]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

module.exports = { htmlToText, looksHtml, normalize, addrOf, nameOf, speakable, replyPrefill, replySubject, sanitizeHtml, cleanCss, tokenize, decode, decodeWords, encodeWord, qpEncode, parseAddresses, formatAddress, validAddress, parseEml, splitMessage, sortMails, makeSnippet, cutSignature };
