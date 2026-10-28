'use strict';
// Lecture / écriture de fichiers Word (.docx = archive ZIP + XML « WordprocessingML ») sans aucune dépendance externe.
// - ZIP : lecture bornée (zip bombs, chemins « .. », fichiers chiffrés refusés), écriture valide que Word ouvre sans réparation.
// - XML : petits utilitaires de précision (paragraphes, runs, contrôles de contenu) qui ne touchent QUE le texte à remplacer :
//   styles, en-têtes, pieds de page, logos, marges et le reste de l'archive sont recopiés tels quels.
const zlib = require('zlib');

class DocxError extends Error { constructor(code, message) { super(message); this.code = code; } }

const LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,       // taille maximale du .docx
  maxEntries: 3000,                      // nombre d'entrées de l'archive
  maxEntryBytes: 80 * 1024 * 1024,       // taille décompressée d'une entrée
  maxTotalBytes: 250 * 1024 * 1024,      // taille décompressée totale
  maxXmlBytes: 16 * 1024 * 1024,         // taille d'une partie XML analysée
  maxRatio: 1000,                        // taux de compression suspect (entrées > 1 Mo)
};

// ---------------------------------------------------------------- CRC-32
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

// ---------------------------------------------------------------- ZIP : lecture
const badName = (n) => !n || n.length > 300 || /[\u0000-\u001f\\]/.test(n) || n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.split('/').some((s) => s === '..');

function readZip(buf) {
  if (!Buffer.isBuffer(buf)) throw new DocxError('FORMAT', 'Fichier illisible.');
  if (buf.length > LIMITS.maxFileBytes) throw new DocxError('TAILLE', `Fichier trop volumineux (${Math.round(buf.length / 1048576)} Mo, maximum ${LIMITS.maxFileBytes / 1048576} Mo).`);
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xD0CF11E0) throw new DocxError('OLE', "Ce fichier est au format Word ancien (.doc) ou chiffré par un mot de passe. Ouvre-le dans Word, retire le mot de passe puis « Enregistrer sous… » au format Document Word (.docx).");
  if (buf.length < 22) throw new DocxError('FORMAT', "Ce fichier n'est pas un document Word (.docx) valide.");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new DocxError('FORMAT', "Ce fichier n'est pas un document Word (.docx) valide ou il est endommagé.");
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) throw new DocxError('FORMAT', 'Archive ZIP64 non prise en charge.');
  if (count > LIMITS.maxEntries) throw new DocxError('BOMBE', "Archive suspecte (trop d'éléments).");
  if (cdOff + cdSize > buf.length) throw new DocxError('FORMAT', 'Document endommagé (répertoire central).');
  const entries = []; const seen = new Set(); let p = cdOff; let total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new DocxError('FORMAT', 'Document endommagé (répertoire central).');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), time = buf.readUInt16LE(p + 12), date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    if (p + 46 + nl > buf.length) throw new DocxError('FORMAT', 'Document endommagé.');
    const name = buf.toString((flags & 0x800) ? 'utf8' : 'latin1', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (badName(name)) throw new DocxError('CHEMIN', `Archive refusée : chemin interne dangereux (« ${name.slice(0, 60).replace(/[^\x20-\x7e]/g, '?')} »).`);
    if (seen.has(name)) throw new DocxError('FORMAT', 'Archive refusée : entrées en double.');
    seen.add(name);
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new DocxError('CHIFFRE', 'Ce document est protégé par un mot de passe. Retire la protection dans Word puis enregistre-le à nouveau en .docx.');
    if (method !== 0 && method !== 8) throw new DocxError('FORMAT', 'Compression non prise en charge dans ce document.');
    if (usize > LIMITS.maxEntryBytes) throw new DocxError('BOMBE', 'Archive suspecte (élément trop volumineux).');
    total += usize; if (total > LIMITS.maxTotalBytes) throw new DocxError('BOMBE', 'Archive suspecte (taille décompressée excessive).');
    if (usize > 1048576 && csize > 0 && usize / csize > LIMITS.maxRatio) throw new DocxError('BOMBE', 'Archive suspecte (taux de compression anormal).');
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw new DocxError('FORMAT', 'Document endommagé (en-tête local).');
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    if (start + csize > buf.length) throw new DocxError('FORMAT', 'Document tronqué ou endommagé.');
    entries.push({ name, method, flags: flags & 0x800, time, date, crc, csize, usize, raw: buf.subarray(start, start + csize) });
  }
  return { entries, map: new Map(entries.map((e) => [e.name, e])) };
}

function inflate(e) {
  let data;
  if (e.method === 0) data = Buffer.from(e.raw);
  else {
    try { data = zlib.inflateRawSync(e.raw, { maxOutputLength: Math.max(e.usize, 1) }); }
    catch (err) { throw new DocxError(/too large|maxOutputLength|ERR_BUFFER_TOO_LARGE/i.test(String(err.code || err.message)) ? 'BOMBE' : 'FORMAT', /too large|maxOutputLength|ERR_BUFFER_TOO_LARGE/i.test(String(err.code || err.message)) ? 'Archive suspecte (taille décompressée incohérente).' : `Élément « ${e.name} » endommagé.`); }
  }
  if (data.length !== e.usize) throw new DocxError('FORMAT', `Élément « ${e.name} » endommagé (taille).`);
  if (crc32(data) !== e.crc) throw new DocxError('FORMAT', `Élément « ${e.name} » endommagé (somme de contrôle).`);
  return data;
}

// ---------------------------------------------------------------- ZIP : écriture
function dosDateTime(d = new Date()) {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
/** items : [{ name, data:Buffer }] (nouveau contenu, compressé ici) ou [{ name, entry }] (entrée recopiée telle quelle) */
function writeZip(items) {
  const parts = []; const central = []; let off = 0; const stamp = dosDateTime();
  for (const it of items) {
    const name = Buffer.from(it.name, 'utf8'); const utf = /[^\x20-\x7e]/.test(it.name) ? 0x800 : 0;
    let method, crc, csize, usize, body, time = stamp.time, date = stamp.date;
    if (it.entry) { method = it.entry.method; crc = it.entry.crc; csize = it.entry.csize; usize = it.entry.usize; body = it.entry.raw; time = it.entry.time; date = it.entry.date; }
    else {
      const data = Buffer.isBuffer(it.data) ? it.data : Buffer.from(String(it.data), 'utf8');
      usize = data.length; crc = crc32(data);
      const def = data.length >= 64 ? zlib.deflateRawSync(data, { level: 6 }) : null;
      if (def && def.length < data.length) { method = 8; body = def; } else { method = 0; body = data; }
      csize = body.length;
    }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(utf, 6); lh.writeUInt16LE(method, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(csize, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(utf, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(csize, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, body); central.push(ch, name); off += 30 + name.length + body.length;
    if (off > 0xFFFFFFF0) throw new DocxError('TAILLE', 'Document trop volumineux.');
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------------------------------------------------------------- XML : échappement
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const cleanText = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').replace(ILLEGAL, '');
const xmlEsc = (s) => cleanText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrEsc = (s) => xmlEsc(s).replace(/"/g, '&quot;');
function xmlUnesc(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>'; if (g === 'quot') return '"'; if (g === 'apos') return "'";
    const cp = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 32 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF) && cp !== 0xFFFE && cp !== 0xFFFF))) return '';
    return String.fromCodePoint(cp);
  });
}

/** Contenu d'un run pour un texte : retours à la ligne -> <w:br/>, tabulations -> <w:tab/>. */
function runContent(text) {
  const lines = cleanText(text).split('\n'); const out = [];
  lines.forEach((ln, i) => {
    if (i) out.push('<w:br/>');
    ln.split('\t').forEach((seg, j) => { if (j) out.push('<w:tab/>'); if (seg) out.push(`<w:t xml:space="preserve">${xmlEsc(seg)}</w:t>`); });
  });
  return out.join('') || '<w:t xml:space="preserve"></w:t>';
}

// ---------------------------------------------------------------- XML : contrôle de forme (bien formé, sans DTD/entités)
function checkXml(xml, label = 'XML') {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new DocxError('XML', `${label} refusé : déclaration DTD/entités non autorisée.`);
  const tok = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  const stack = []; let i = 0; let roots = 0;
  const badAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = lt < 0 ? xml.slice(i) : xml.slice(i, lt);
    if (text) { if (badAmp.test(text)) throw new DocxError('XML', `${label} mal formé (entité).`); if (!stack.length && text.trim()) throw new DocxError('XML', `${label} mal formé (texte hors racine).`); }
    if (lt < 0) break;
    tok.lastIndex = lt; const m = tok.exec(xml);
    if (!m) throw new DocxError('XML', `${label} mal formé (balise invalide près de la position ${lt}).`);
    if (m[1]) { const top = stack.pop(); if (top !== m[1]) throw new DocxError('XML', `${label} mal formé (balise « ${m[1]} » fermée au mauvais endroit).`); }
    else if (m[2]) {
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/.test(m[3] || '')) throw new DocxError('XML', `${label} mal formé (entité dans un attribut).`);
      if (!stack.length) { roots++; if (roots > 1) throw new DocxError('XML', `${label} mal formé (plusieurs racines).`); }
      if (!m[4]) stack.push(m[2]);
    }
    i = tok.lastIndex;
  }
  if (stack.length) throw new DocxError('XML', `${label} mal formé (balise « ${stack[stack.length - 1]} » non fermée).`);
  if (!roots) throw new DocxError('XML', `${label} vide.`);
  return true;
}

// ---------------------------------------------------------------- WordprocessingML : paragraphes
/** Paragraphes « feuilles » (sans paragraphe imbriqué, par ex. sans zone de texte), dans l'ordre du document : [{ s, e }] */
function scanParagraphs(xml) {
  const re = /<w:p(?=[\s>\/])[^>]*>|<\/w:p>/g; const out = []; const stack = []; let m;
  while ((m = re.exec(xml))) {
    const tok = m[0];
    if (tok === '</w:p>') { const fr = stack.pop(); if (fr && !fr.nested) out.push({ s: fr.s, e: m.index + tok.length }); }
    else {
      if (stack.length) stack[stack.length - 1].nested = true;
      if (tok.endsWith('/>')) out.push({ s: m.index, e: m.index + tok.length });
      else stack.push({ s: m.index, nested: false });
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

const NODE_RE = /<w:t(?:\s[^>]*)?(?<!\/)>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\s*\/>|<w:noBreakHyphen\s*\/>/g;
/** Découpe un paragraphe en nœuds de texte modifiables (<w:t>) et séparateurs (tab, saut de ligne). */
function parseNodes(pxml) {
  const nodes = []; let chars = ''; let m;
  NODE_RE.lastIndex = 0;
  while ((m = NODE_RE.exec(pxml))) {
    const tag = m[0];
    if (tag.startsWith('<w:t') && !tag.startsWith('<w:tab')) {
      const text = m[1] === undefined ? '' : xmlUnesc(m[1]);
      nodes.push({ type: 't', s: m.index, e: m.index + tag.length, text, cs: chars.length, ce: chars.length + text.length }); chars += text;
    } else {
      const ch = tag.startsWith('<w:tab') ? '\t' : (tag.startsWith('<w:noBreakHyphen') ? '-' : '\n');
      nodes.push({ type: 'sep', ch, cs: chars.length, ce: chars.length + 1 }); chars += ch;
    }
  }
  return { nodes, chars };
}
const paragraphText = (pxml) => parseNodes(pxml).chars;

/** Remplace des plages de caractères [{ start, end, text }] (triées, sans chevauchement) dans le texte du paragraphe. */
function applyRanges(pxml, parsed, ranges) {
  if (!ranges.length) return pxml;
  const { nodes, chars } = parsed; const edits = [];
  for (const n of nodes) {
    if (n.type !== 't') continue;
    let text = ''; let cur = n.cs; let touched = false;
    for (const r of ranges) {
      if (n.ce === n.cs) continue; // nœud vide : jamais modifié
      if (r.end <= n.cs || r.start >= n.ce) continue;
      touched = true;
      if (r.start >= n.cs) text += chars.slice(cur, r.start) + r.text;
      cur = Math.max(cur, Math.min(r.end, n.ce));
    }
    if (!touched) continue;
    text += chars.slice(cur, n.ce);
    edits.push({ s: n.s, e: n.e, xml: runContent(text).replace(/^<w:t xml:space="preserve"><\/w:t>$/, '<w:t xml:space="preserve"></w:t>') });
  }
  let out = pxml;
  for (const ed of edits.sort((a, b) => b.s - a.s)) out = out.slice(0, ed.s) + ed.xml + out.slice(ed.e);
  return out;
}

const PLACEHOLDER_STYLE = /<w:rStyle\s+w:val="PlaceholderText"\s*\/>/g;
/** Réécrit un paragraphe avec un nouveau texte, en conservant ses propriétés (pPr) et la mise en forme de son premier run. */
function rebuildParagraph(pxml, text, { stripNum = false } = {}) {
  let src = pxml.replace(/<w:pPrChange[\s\S]*?<\/w:pPrChange>/g, '').replace(/<w:rPrChange[\s\S]*?<\/w:rPrChange>/g, '');
  const startTag = (src.match(/^<w:p(?=[\s>\/])[^>]*>/) || ['<w:p>'])[0].replace(/\/>$/, '>');
  let pPr = (src.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  if (stripNum) pPr = pPr.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, '');
  let rPr = '';
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g; let m;
  while ((m = runRe.exec(src))) {
    if (!/<w:t[\s>\/]/.test(m[1])) continue;
    const rp = m[1].match(/^\s*<w:rPr>[\s\S]*?<\/w:rPr>/); rPr = rp ? rp[0].trim() : ''; break;
  }
  if (!rPr && pPr) { const mark = pPr.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/); if (mark) rPr = '<w:rPr>' + mark[1].replace(/<w:(?:ins|del|moveFrom|moveTo)\b[^>]*\/>/g, '') + '</w:rPr>'; }
  rPr = rPr.replace(PLACEHOLDER_STYLE, '');
  if (pPr) pPr = pPr.replace(/<w:rPr>[\s\S]*?<\/w:rPr>(?=<\/w:pPr>)/, (r) => r.replace(/<w:(?:ins|del|moveFrom|moveTo)\b[^>]*\/>/g, ''));
  return `${startTag}${pPr}<w:r>${rPr}${runContent(text)}</w:r></w:p>`;
}

// ---------------------------------------------------------------- WordprocessingML : contrôles de contenu (w:sdt)
/** Contrôles de contenu de niveau supérieur : [{ s, e, tag, alias }] */
function scanSdts(xml) {
  const re = /<w:sdt(?=[\s>])[^>]*>|<\/w:sdt>/g; const out = []; const stack = []; let m;
  while ((m = re.exec(xml))) {
    if (m[0] === '</w:sdt>') {
      const fr = stack.pop(); if (!fr) continue;
      if (!stack.length) {
        const inner = xml.slice(fr.s, m.index + 8);
        const pr = (inner.match(/<w:sdtPr>[\s\S]*?<\/w:sdtPr>/) || [''])[0];
        const tag = (pr.match(/<w:tag\s+w:val="([^"]*)"/) || [])[1]; const alias = (pr.match(/<w:alias\s+w:val="([^"]*)"/) || [])[1];
        out.push({ s: fr.s, e: m.index + 8, tag: tag ? xmlUnesc(tag) : '', alias: alias ? xmlUnesc(alias) : '', special: /<w:docPartObj|<w:bibliography|<w:citation|<w:equation/.test(pr) });
      }
    } else stack.push({ s: m.index });
  }
  return out;
}
/** Remplace le contenu d'un contrôle de contenu par un texte (le contrôle lui-même est conservé). */
function fillSdt(sdtXml, value) {
  const open = sdtXml.match(/^<w:sdt(?=[\s>])[^>]*>/)[0];
  let pr = (sdtXml.match(/<w:sdtPr>[\s\S]*?<\/w:sdtPr>/) || [''])[0].replace(/<w:showingPlcHdr\s*\/>/g, '');
  const endPr = (sdtXml.match(/<w:sdtEndPr>[\s\S]*?<\/w:sdtEndPr>|<w:sdtEndPr\s*\/>/) || [''])[0];
  const cm = sdtXml.match(/<w:sdtContent>([\s\S]*)<\/w:sdtContent>/);
  if (!cm) return sdtXml;
  const content = cm[1]; let newContent;
  const paras = scanParagraphs(content);
  if (paras.length) {
    const lines = cleanText(value).split('\n').map((x) => x.trim()).filter(Boolean);
    const first = content.slice(paras[0].s, paras[0].e);
    newContent = (lines.length ? lines : ['']).map((ln, k) => rebuildParagraph(k ? stripBookmarks(first) : first, ln)).join('');
  } else {
    const run = content.match(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/); const rp = run && run[1].match(/^\s*<w:rPr>[\s\S]*?<\/w:rPr>/);
    newContent = `<w:r>${rp ? rp[0].trim().replace(PLACEHOLDER_STYLE, '') : ''}${runContent(value)}</w:r>`;
  }
  return `${open}${pr}${endPr}<w:sdtContent>${newContent}</w:sdtContent></w:sdt>`;
}
const stripBookmarks = (x) => x.replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g, '');

module.exports = { DocxError, LIMITS, crc32, readZip, inflate, writeZip, cleanText, xmlEsc, attrEsc, xmlUnesc, runContent, checkXml, scanParagraphs, parseNodes, paragraphText, applyRanges, rebuildParagraph, scanSdts, fillSdt, stripBookmarks };
