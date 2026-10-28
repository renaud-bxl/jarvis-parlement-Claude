// Lecture des flux RSS / Atom, dates relatives (fuseau Europe/Brussels) et filtrage des articles.
// Aucun paquet externe : analyse XML tolérante et bornée (flux hostile, énorme ou mal formé = jamais de plantage).
// Les contenus des flux sont des DONNÉES non fiables : ils sont nettoyés ici puis isolés dans <donnees_externes> par l'appelant.
const llm = require('./llm');

const TZ = 'Europe/Brussels';
const MAX_FEED_BYTES = 3 * 1024 * 1024;   // taille maximale d'un flux
const MAX_ITEMS_PER_FEED = 300;
const FEED_TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 120;
const FEED_UA = 'Mozilla/5.0 (compatible; JarvisParlement/1.5; lecteur de flux RSS)';

// ---------------------------------------------------------------------------------------------------------------
// Texte : entités, nettoyage, accents
// ---------------------------------------------------------------------------------------------------------------
// Caractères de contrôle, invisibles et de direction (RTL override, zéro-largeur, séparateurs de ligne) : jamais conservés.
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufff9-\ufffb]/g;
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  eacute: '\u00e9', egrave: '\u00e8', ecirc: '\u00ea', euml: '\u00eb', agrave: '\u00e0', acirc: '\u00e2', auml: '\u00e4', aacute: '\u00e1',
  ccedil: '\u00e7', ocirc: '\u00f4', ouml: '\u00f6', oacute: '\u00f3', ucirc: '\u00fb', ugrave: '\u00f9', uuml: '\u00fc', uacute: '\u00fa',
  icirc: '\u00ee', iuml: '\u00ef', iacute: '\u00ed', ntilde: '\u00f1', Eacute: '\u00c9', Egrave: '\u00c8', Agrave: '\u00c0', Ccedil: '\u00c7',
  Ecirc: '\u00ca', Ocirc: '\u00d4', Icirc: '\u00ce', oelig: '\u0153', OElig: '\u0152', laquo: '\u00ab', raquo: '\u00bb',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', sbquo: '\u201a', bdquo: '\u201e', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
  euro: '\u20ac', deg: '\u00b0', copy: '\u00a9', reg: '\u00ae', middot: '\u00b7', bull: '\u2022', times: '\u00d7', eacutes: '\u00e9',
};
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,10});/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(n) || n < 32 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return ' ';
      try { return String.fromCodePoint(n); } catch { return ' '; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
  });
}
const clean = (s) => String(s == null ? '' : s).replace(BAD_CHARS, ' ').replace(/\s+/g, ' ').trim();
// Texte d'une balise : décode les entités, retire le HTML résiduel (description souvent en HTML échappé), borne la taille.
function plain(raw, max = 600) {
  let t = decodeEntities(String(raw == null ? '' : raw).slice(0, max * 8));
  t = t.replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');
  t = decodeEntities(t).replace(/<[^>]*>/g, ' ');
  return clean(t).slice(0, max);
}
const fold = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u02bc`']/g, ' ').replace(/\u0153/g, 'oe').replace(/\u00e6/g, 'ae');

// ---------------------------------------------------------------------------------------------------------------
// Analyse RSS 2.0 / Atom / RDF (RSS 1.0)
// ---------------------------------------------------------------------------------------------------------------
// Contenu d'une balise (premier élément), CDATA compris. Renvoie la chaîne brute (non décodée) ou ''.
function tagInner(block, lower, name) {
  const open = '<' + name; let from = 0;
  for (;;) {
    const i = lower.indexOf(open, from); if (i < 0) return '';
    const c = lower[i + open.length];
    if (c === '>' || c === ' ' || c === '/' || c === '\n' || c === '\t' || c === '\r') {
      const gt = lower.indexOf('>', i); if (gt < 0) return '';
      if (lower[gt - 1] === '/') return '';                       // <balise/> vide
      const end = lower.indexOf('</' + name, gt);
      const inner = block.slice(gt + 1, end < 0 ? Math.min(block.length, gt + 1 + 20000) : end);
      return unCdata(inner);
    }
    from = i + open.length;
  }
}
function unCdata(inner) {
  if (inner.indexOf('<![CDATA[') < 0) return inner;
  let out = '', pos = 0;
  for (;;) {
    const a = inner.indexOf('<![CDATA[', pos);
    if (a < 0) { out += inner.slice(pos); break; }
    out += inner.slice(pos, a);
    const b = inner.indexOf(']]>', a + 9);
    if (b < 0) { out += inner.slice(a + 9); break; }
    out += inner.slice(a + 9, b).replace(/&/g, '&amp;').replace(/</g, '&lt;');   // le contenu CDATA est du texte : on le protège avant le décodage commun
    pos = b + 3;
  }
  return out;
}
// Attribut d'une balise ouvrante ( <link href="..." rel="alternate"/> ).
function attr(tag, name) {
  const m = new RegExp('[\\s]' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? (m[2] !== undefined ? m[2] : m[3]) : '';
}
function atomLink(block, lower) {
  let from = 0, first = '';
  for (let n = 0; n < 12; n++) {
    const i = lower.indexOf('<link', from); if (i < 0) break;
    const gt = lower.indexOf('>', i); if (gt < 0) break;
    const tag = block.slice(i, gt + 1); from = gt + 1;
    const href = decodeEntities(attr(tag, 'href')); if (!href) continue;
    const rel = attr(tag, 'rel').toLowerCase();
    if (!rel || rel === 'alternate') return href;
    if (!first && rel !== 'self' && rel !== 'enclosure' && rel !== 'replies') first = href;
  }
  return first;
}
const ZONES = { UT: 0, UTC: 0, GMT: 0, Z: 0, CET: 60, CEST: 120, EET: 120, EEST: 180, WET: 0, WEST: 60, BST: 60, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
const MONTHS3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Date RFC 822 / ISO 8601 -> Date, ou null.
function parseDate(raw) {
  const s = clean(raw); if (!s) return null;
  let t = Date.parse(s);
  if (!Number.isFinite(t)) {
    const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([A-Za-z]{1,5}|[+-]\d{2}:?\d{2})?/.exec(s);
    if (m) {
      const mon = MONTHS3.indexOf(m[2].toLowerCase()); if (mon < 0) return null;
      let y = Number(m[3]); if (y < 100) y += y < 70 ? 2000 : 1900;
      let off = 0; const z = m[7];
      if (z) { if (/^[+-]/.test(z)) { const zz = z.replace(':', ''); off = (zz[0] === '-' ? -1 : 1) * (Number(zz.slice(1, 3)) * 60 + Number(zz.slice(3, 5))); } else if (Object.prototype.hasOwnProperty.call(ZONES, z.toUpperCase())) off = ZONES[z.toUpperCase()]; }
      t = Date.UTC(y, mon, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)) - off * 60000;
    }
  }
  if (!Number.isFinite(t)) return null;
  const d = new Date(t); const y = d.getUTCFullYear();
  return y < 1990 || y > 2100 ? null : d;
}
function absUrl(href, base) {
  const h = clean(decodeEntities(href)); if (!h || h.length > 2000 || /\s/.test(h)) return '';
  try {
    const u = new URL(h, base || undefined);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.username || u.password) return '';
    u.hash = ''; return u.href;
  } catch { return ''; }
}

const asciiLower = (s) => s.replace(/[A-Z]+/g, (x) => x.toLowerCase());   // conserve la longueur exacte (toLowerCase() peut la modifier)
function positions(lower, needle, cap) { const a = []; let p = 0; while (a.length < cap) { const i = lower.indexOf(needle, p); if (i < 0) break; a.push(i); p = i + needle.length; } return a; }
const DELIM = new Set(['>', ' ', '/', '\n', '\t', '\r']);

/** parseFeed(xml, { base, max }) -> { title, format, items:[{ title, url, date: ISO|null, summary }] }  (ne lève jamais d'exception) */
function parseFeed(xml, { base = '', max = MAX_ITEMS_PER_FEED } = {}) {
  const out = { title: '', items: [], format: '' };
  try {
    let src = String(xml == null ? '' : xml); if (src.length > MAX_FEED_BYTES) src = src.slice(0, MAX_FEED_BYTES);
    src = src.replace(/^\ufeff/, '');
    const head = asciiLower(src.slice(0, 4000));
    const isAtom = /<feed[\s>]/.test(head), isRss = /<rss[\s>]/.test(head) || /<channel[\s>]/.test(head), isRdf = /<rdf:rdf[\s>]/.test(head);
    if (!isAtom && !isRss && !isRdf) return out;
    out.format = isAtom ? 'atom' : isRdf ? 'rdf' : 'rss';
    const lower = asciiLower(src);
    const tag = isAtom ? 'entry' : 'item';
    const cap = max * 4 + 10;
    // Positions des balises ouvrantes / fermantes en un seul passage : coût linéaire même pour un flux hostile (milliers de balises non fermées).
    const opens = positions(lower, '<' + tag, cap).filter((i) => DELIM.has(lower[i + tag.length + 1]));
    const closes = positions(lower, '</' + tag, cap);
    const first = opens.length ? opens[0] : Math.min(src.length, 4000);
    out.title = plain(tagInner(src.slice(0, first), lower.slice(0, first), 'title'), 200);
    let ci = 0;
    for (let k = 0; k < opens.length && out.items.length < max; k++) {
      const i = opens[k]; const nextOpen = k + 1 < opens.length ? opens[k + 1] : -1;
      const gt = lower.indexOf('>', i); if (gt < 0) break;
      while (ci < closes.length && closes[ci] < gt) ci++;
      let end = ci < closes.length ? closes[ci] : -1;
      if (end < 0 || (nextOpen >= 0 && nextOpen < end)) end = nextOpen >= 0 ? nextOpen : Math.min(src.length, gt + 60000);   // élément non fermé : on s'arrête au suivant
      if (end < gt) continue;
      const block = src.slice(gt + 1, end), bl = lower.slice(gt + 1, end);
      const title = plain(tagInner(block, bl, 'title'), 300);
      let link = isAtom ? atomLink(block, bl) : decodeEntities(tagInner(block, bl, 'link')).trim();
      if (!link && !isAtom) { const g = decodeEntities(tagInner(block, bl, 'guid')).trim(); if (/^https?:\/\//i.test(g)) link = g; }
      if (!link && isRdf) link = attr(src.slice(i, gt + 1), 'rdf:about');
      const url = absUrl(link, base);
      const dateRaw = tagInner(block, bl, 'pubdate') || tagInner(block, bl, 'dc:date') || tagInner(block, bl, 'published') || tagInner(block, bl, 'updated') || tagInner(block, bl, 'a10:updated') || tagInner(block, bl, 'date');
      const d = parseDate(decodeEntities(dateRaw));
      const summary = plain(tagInner(block, bl, 'description') || tagInner(block, bl, 'summary') || tagInner(block, bl, 'content:encoded') || tagInner(block, bl, 'content'), 600);
      if (!title && !url) continue;
      out.items.push({ title: title || url, url, date: d ? d.toISOString() : null, summary });
    }
  } catch { /* flux illisible : on renvoie ce qui a été lu */ }
  return out;
}

// Dates dans le futur lointain ou absurdes (flux mal configuré) : ignorées plutôt que crues.
function sanitizeDates(items, now = new Date()) {
  const limit = now.getTime() + 36 * 3600e3;
  for (const it of items) if (it.date && Date.parse(it.date) > limit) it.date = null;
  return items;
}

// ---------------------------------------------------------------------------------------------------------------
// Récupération (couche réseau sûre de llm.js) + cache court
// ---------------------------------------------------------------------------------------------------------------
const cache = new Map();   // url -> { t, items, title, error }
function clearCache() { cache.clear(); }
/**
 * fetchFeed(url, { ttl, trust:Set<hostname>, getter, now }) -> { url, ok, items, title, error, cached }
 * Les hôtes de confiance (catalogue) ne subissent pas la résolution DNS ; tout autre hôte (source ajoutée à la main, redirection)
 * est refusé s'il se résout vers une adresse privée.
 */
async function fetchFeed(url, { ttl = CACHE_TTL_MS, trust, getter, now = new Date() } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < (hit.error ? Math.min(ttl, 30000) : ttl)) return { url, ok: !hit.error, items: hit.items, title: hit.title, error: hit.error, cached: true };
  let rec;
  try {
    const get = getter || llm.safeGet;
    const r = await get(url, { timeoutMs: FEED_TIMEOUT_MS, maxBytes: MAX_FEED_BYTES, userAgent: FEED_UA, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5', dnsCheck: true, trustHosts: trust, full: true });
    const res = typeof r === 'string' ? { body: r, status: 200 } : (r || { body: '', status: 0 });
    if (res.status >= 400) rec = { t: Date.now(), items: [], title: '', error: res.status === 401 || res.status === 403 ? `Accès refusé par le site (${res.status}).` : res.status === 404 ? 'Flux introuvable (404).' : `Erreur du site (${res.status}).` };
    else {
      const p = parseFeed(res.body, { base: res.url || url });
      if (!p.format) rec = { t: Date.now(), items: [], title: '', error: res.body ? 'Format non reconnu (ce n\'est pas un flux RSS ou Atom).' : 'Réponse vide ou non textuelle.' };
      else rec = { t: Date.now(), items: sanitizeDates(p.items, now), title: p.title, error: '' };
    }
  } catch (e) {
    const m = String((e && e.message) || e);
    rec = { t: Date.now(), items: [], title: '', error: /volumineuse/.test(m) ? 'Flux trop volumineux.' : /interne|refus/i.test(m) ? 'Adresse refusée (réseau interne).' : /abort|timeout|d[ée]lai|TimeoutError/i.test(m) ? 'Délai dépassé.' : /redirection/i.test(m) ? 'Trop de redirections.' : 'Injoignable.' };
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(url, rec);
  return { url, ok: !rec.error, items: rec.items, title: rec.title, error: rec.error, cached: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Dates : jours civils de Bruxelles (heure d'été comprise)
// ---------------------------------------------------------------------------------------------------------------
const PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
const DOW3 = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Champs « murs » à Bruxelles : { y, m, d, dow (0 = dimanche), min }. */
function bru(date) {
  const p = {}; for (const x of PARTS.formatToParts(date)) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), dow: DOW3[p.weekday], min: Number(p.hour) * 60 + Number(p.minute) };
}
const tzOffsetMs = (date) => { const p = {}; for (const x of PARTS.formatToParts(date)) p[x.type] = x.value; return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(date.getTime() / 1000) * 1000; };
/** Minuit (heure de Bruxelles) du jour y-m-d, en Date UTC. */
function dayStart(y, m, d) {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let t = guess - tzOffsetMs(new Date(guess));
  t = guess - tzOffsetMs(new Date(t));
  return new Date(t);
}
function addDays({ y, m, d }, n) { const x = new Date(Date.UTC(y, m - 1, d + n)); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; }
const dowOf = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const ymdStr = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const cmpYmd = (a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
const validYmd = ({ y, m, d }) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d; };
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'f\u00e9vrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'ao\u00fbt', 'septembre', 'octobre', 'novembre', 'd\u00e9cembre'];
const MONTH_RE = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const dayLabel = (x) => `${DAYS[dowOf(x)]} ${x.d === 1 ? '1er' : x.d} ${MONTHS[x.m - 1]} ${x.y}`;
function spanLabel(a, b) {
  if (cmpYmd(a, b) === 0) return dayLabel(a);
  if (a.y === b.y && a.m === b.m) return `du ${DAYS[dowOf(a)]} ${a.d} au ${DAYS[dowOf(b)]} ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `du ${dayLabel(a)} au ${dayLabel(b)}`;
}
const endOf = (b) => { const n = addDays(b, 1); return new Date(dayStart(n.y, n.m, n.d).getTime() - 1); };
const mkRange = (a, b, kind) => ({ from: dayStart(a.y, a.m, a.d), to: endOf(b), fromDay: ymdStr(a), toDay: ymdStr(b), label: spanLabel(a, b), kind });

const DAY_ALIAS = { // français + quelques formes néerlandaises et anglaises
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const PAST_CUE = /\b(a eu|ont eu|avait|avaient|etait|etaient|ete|s est|se sont|a ete|ont ete|y a eu|il y a eu|eu lieu|a-t-il eu|a t il eu|passe|derniere?s?|dernier|hier|precedent)\b/;
const FUTURE_CUE = /\b(va[ -]t[ -]il|va se|vont se|se passera|passera|aura|auront|sera|seront|va y avoir|vont|prevu|prevue|prevus|programme|a venir|prochaine?s?|demain|apres[ -]demain|aurait lieu|se tiendra|se tiendront|annonce pour)\b/;

/**
 * resolveRange(texte, maintenant) -> { from, to, fromDay, toDay, label, kind } | null
 * Comprend : aujourd'hui, hier, avant-hier, demain, « ce dimanche », « dimanche dernier / prochain », « cette semaine », « la semaine dernière »,
 * « ce week-end », « ce mois-ci », « le mois dernier », « ces 3 derniers jours », « depuis lundi », « le 25 octobre (2026) », « 25/10 », « 2026-10-25 ».
 * Tous les jours sont des jours civils de Bruxelles (heure d'été comprise).
 */
function resolveRange(text, nowDate = new Date()) {
  const raw = String(text == null ? '' : text).slice(0, 3000);
  const t = ' ' + fold(raw).replace(/[^a-z0-9/\-\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const now = bru(nowDate); const today = { y: now.y, m: now.m, d: now.d };
  const future = FUTURE_CUE.test(t) && !/\bhier\b/.test(t);
  let m;

  // Dates explicites
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) { const x = { y: +m[1], m: +m[2], d: +m[3] }; if (validYmd(x) && x.y >= 1990) return mkRange(x, x, 'date'); }
  if ((m = /\b(?:le\s+|du\s+)?(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?\b/.exec(t))) {
    let x = { y: m[3] ? +m[3] : today.y, m: MONTH_RE[m[2]], d: +m[1] };
    if (validYmd(x)) { if (!m[3]) { if (!future && cmpYmd(x, today) > 0) x.y -= 1; else if (future && cmpYmd(x, today) < 0) x.y += 1; } if (validYmd(x)) return mkRange(x, x, 'date'); }
  }
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t))) {
    let y = m[3] ? +m[3] : today.y; if (m[3] && y < 100) y += 2000;
    const x = { y, m: +m[2], d: +m[1] };
    if (validYmd(x)) { if (!m[3]) { if (!future && cmpYmd(x, today) > 0) x.y -= 1; else if (future && cmpYmd(x, today) < 0) x.y += 1; } if (validYmd(x)) return mkRange(x, x, 'date'); }
  }

  // Périodes glissantes
  if ((m = /\b(?:ces|les|depuis|sur les|durant les)\s+(\d{1,3})\s+(?:derniers?|dernieres?)\s+(jours?|semaines?|mois)\b/.exec(t)) || (m = /\bdepuis\s+(\d{1,3})\s+(jours?|semaines?|mois)\b/.exec(t))) {
    const n = Math.min(+m[1], 366); if (n >= 1) { const u = m[2][0] === 's' ? 7 : m[2][0] === 'm' ? 30 : 1; const a = addDays(today, -(n * u - 1)); return mkRange(a, today, 'recent'); }
  }
  if (/\b(?:dernieres?\s+24\s*h(?:eures?)?|24\s*(?:dernieres?\s+)?heures?|24h)\b/.test(t)) { const to = nowDate, from = new Date(nowDate.getTime() - 24 * 3600e3); return { from, to, fromDay: ymdStr(bru(from)), toDay: ymdStr(today), label: 'les dernières 24 heures', kind: 'recent' }; }
  if (/\b(?:ces|les)\s+derniers?\s+jours\b|\bces derniers temps\b/.test(t)) return mkRange(addDays(today, -2), today, 'recent');
  if (/\bdepuis\s+(?:hier)\b/.test(t)) return mkRange(addDays(today, -1), today, 'since');

  // Jours relatifs
  if (/\bavant[ -]hier\b/.test(t)) { const x = addDays(today, -2); return mkRange(x, x, 'relative'); }
  if (/\bapres[ -]demain\b/.test(t)) { const x = addDays(today, 2); return mkRange(x, x, 'relative'); }
  if (/\bhier\b|\byesterday\b|\bgisteren\b/.test(t)) { const x = addDays(today, -1); return mkRange(x, x, 'relative'); }
  if (/\bdemain\b|\btomorrow\b|\bmorgen\b/.test(t)) { const x = addDays(today, 1); return mkRange(x, x, 'relative'); }
  if (/\baujourd hui\b|\bce jour\b|\bce matin\b|\bcet apres[ -]midi\b|\bce soir\b|\bcette nuit\b|\bcette journee\b|\bto?day\b|\bvandaag\b/.test(t)) return mkRange(today, today, 'relative');

  // Semaine / week-end / mois
  const monday = (x) => addDays(x, -((dowOf(x) + 6) % 7));
  if (/\b(?:la\s+)?semaine\s+(?:derniere|passee|precedente)\b/.test(t)) { const a = addDays(monday(today), -7); return mkRange(a, addDays(a, 6), 'week'); }
  if (/\b(?:la\s+)?semaine\s+prochaine\b/.test(t)) { const a = addDays(monday(today), 7); return mkRange(a, addDays(a, 6), 'week'); }
  if (/\bcette semaine\b|\bcette sem\b|\bthis week\b/.test(t)) { const a = monday(today); return mkRange(a, addDays(a, 6), 'week'); }
  if (/\b(?:le\s+)?week ?-? ?end\b|\bweekend\b/.test(t)) {
    const dow = dowOf(today); const sat = (x) => addDays(x, -((dowOf(x) + 1) % 7));   // samedi de la semaine civile du jour x
    let a;
    if (/\b(?:dernier|passe|precedent)\b/.test(t)) a = dow === 6 ? addDays(today, -7) : dow === 0 ? addDays(today, -8) : sat(today);
    else if (/\bprochain\b/.test(t) || future) a = dow === 6 ? today : dow === 0 ? addDays(today, -1) : addDays(today, (6 - dow + 7) % 7);
    else a = dow === 0 ? addDays(today, -1) : dow === 6 ? today : sat(today);
    return mkRange(a, addDays(a, 1), 'weekend');
  }
  if (/\bmois\s+(?:dernier|passe|precedent)\b/.test(t)) { const a = { y: today.m === 1 ? today.y - 1 : today.y, m: today.m === 1 ? 12 : today.m - 1, d: 1 }; const last = addDays({ y: today.y, m: today.m, d: 1 }, -1); return mkRange(a, last, 'month'); }
  if (/\bce mois(?:\s*-?\s*ci)?\b/.test(t)) { const a = { y: today.y, m: today.m, d: 1 }; const next = today.m === 12 ? { y: today.y + 1, m: 1, d: 1 } : { y: today.y, m: today.m + 1, d: 1 }; return mkRange(a, addDays(next, -1), 'month'); }

  // Jour de la semaine : « ce dimanche », « dimanche dernier », « dimanche prochain », « depuis lundi »
  const dw = /\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi|zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (dw) {
    const target = DAY_ALIAS[dw[1]]; const dow = now.dow;
    const after = t.slice(dw.index + dw[0].length, dw.index + dw[0].length + 14);
    const strictPast = /^\s*(?:dernier|passe|precedent)/.test(after) || /\b(?:dernier|passe)\s*$/.test(t.slice(Math.max(0, dw.index - 12), dw.index));
    const strictNext = /^\s*prochain/.test(after);
    const back = (dow - target + 7) % 7, ahead = (target - dow + 7) % 7;
    let off;
    if (strictPast) off = -(back || 7);
    else if (strictNext) off = ahead || 7;
    else if (future && !PAST_CUE.test(t.replace(/\bprochaine?s?\b/g, ''))) off = ahead;
    else off = -back;
    const x = addDays(today, off);
    if (/\bdepuis\b/.test(t.slice(Math.max(0, dw.index - 10), dw.index))) return mkRange(x, today, 'since');
    return mkRange(x, x, 'weekday');
  }
  // « en octobre », « au mois de mars »
  if ((m = /\b(?:en|durant|pendant|au mois de|mois d)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?\b/.exec(t))) {
    const mo = MONTH_RE[m[1]]; let y = m[2] ? +m[2] : today.y; if (!m[2] && mo > today.m && !future) y -= 1;
    const a = { y, m: mo, d: 1 }; const next = mo === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: mo + 1, d: 1 }; return mkRange(a, addDays(next, -1), 'month');
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Mots-clés, pertinence, doublons, domaines
// ---------------------------------------------------------------------------------------------------------------
const STOP = new Set(('le la les un une des de du d l et ou a au aux en dans sur sous pour par avec sans ce cet cette ces se sa son ses leur leurs il elle ils elles on y que qui quoi dont ou est sont etait etaient ete etre ai as avons avez ont avait eu fait faire fais fait ' +
  'je tu nous vous me te moi toi mon ma mes ton ta tes notre nos votre vos jarvis dis dit peux peut pouvez pourrais pourriez veux voudrais voudrait cherche chercher recherche rechercher trouve trouver donne donner montre montrer parle parler raconte ' +
  'quel quelle quels quelles quoi comment combien pourquoi quand est ce qu il ya t-il avoir plus moins tres aussi tout tous toute toutes autre autres meme encore deja pas ne ni mais donc car si alors puis ' +
  'infos info information informations actualite actualites actu nouvelles nouvelle news derniere dernieres dernier derniers sujet question reponse dossier ' +
  'aujourd hui hier demain avant apres matin soir midi nuit jour jours semaine semaines mois annee an ans week end weekend cette ce ces depuis pendant durant lundi mardi mercredi jeudi vendredi samedi dimanche prochain prochaine passe passee ' +
  'belgique belge belges').split(/\s+/));
const SYN = [ // familles de mots : une requête sur l'un retrouve les autres
  ['manifest', 'rassemb', 'cortege', 'defile', 'mobilisation', 'blocage', 'greve', 'grevist', 'piquet', 'syndica'],
  ['greve', 'grevist', 'preavis', 'syndica', 'arret de travail', 'action'],
  ['accident', 'collision', 'carambolage', 'blesse'],
  ['inond', 'crue', 'tempete', 'intemperie'],
];
const stem = (w) => { let s = w.replace(/(?:s|x)$/, ''); if (s.length >= 8) s = s.slice(0, 7); else if (s.length >= 6) s = s.slice(0, 6); return s; };
/** keywordsOf(texte) -> [ { w, forms:[radicaux] } ] */
function keywordsOf(text) {
  const words = fold(text).replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const seen = new Set(), out = [];
  for (const w of words) {
    const s = stem(w); if (seen.has(s)) continue; seen.add(s);
    const forms = new Set([s]);
    for (const fam of SYN) if (fam.some((f) => s.startsWith(f.slice(0, 5)) || f.startsWith(s.slice(0, 5)))) fam.forEach((f) => forms.add(f));
    out.push({ w, forms: [...forms] });
  }
  return out.slice(0, 12);
}
function scoreItem(it, kws) {
  if (!kws.length) return 0;
  const title = fold(it.title), sum = fold(it.summary || ''); let sc = 0;
  for (const k of kws) { if (k.forms.some((f) => title.includes(f))) sc += 2; else if (k.forms.some((f) => sum.includes(f))) sc += 1; }
  return sc;
}
// URL canonique (pour ne jamais compter deux fois le même article) : sans www, sans paramètres de suivi, sans ancre, sans « / » final.
const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|source$|xtor|at_|cmp|ocid|_ga|igshid|share)/i;
function canonUrl(u) {
  try {
    const x = new URL(String(u)); if (x.protocol !== 'https:' && x.protocol !== 'http:') return '';
    x.hash = ''; x.hostname = x.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
    x.searchParams.sort();
    let p = x.pathname.replace(/\/+$/, ''); if (!p) p = '';
    return 'web:' + x.hostname + p + (x.search || '');
  } catch { return ''; }
}
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const inDomains = (url, domains) => { const h = hostOf(url); return !!h && (domains || []).some((d) => h === d || h.endsWith('.' + d)); };
function dedupe(items, known) {
  const seen = new Set(known || []), titles = new Set(), out = [];
  for (const it of items) {
    const k = it.url ? canonUrl(it.url) : ''; const tk = 't:' + fold(it.title).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
    if (k && seen.has(k)) continue; if (titles.has(tk) && tk.length > 8) continue;
    if (k) seen.add(k); titles.add(tk); out.push(it);
  }
  return out;
}

module.exports = {
  TZ, FEED_UA, parseFeed, parseDate, fetchFeed, clearCache, sanitizeDates, decodeEntities, plain, clean, fold, BAD_CHARS,
  resolveRange, bru, dayStart, keywordsOf, scoreItem, canonUrl, hostOf, inDomains, dedupe, ymdStr, addDays,
  __test: { cache },
};
