// Lecture de documents locaux + index plein-texte (BM25) 100 % hors-ligne.
// Garde-fous : liens symboliques ignorés, dossiers cachés / node_modules ignorés, taille et nombre de fichiers bornés,
// délai maximal par fichier, annulation, une seule indexation à la fois.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const EXT = new Set(['.txt', '.md', '.pdf', '.docx', '.eml', '.html', '.htm', '.csv', '.rtf']);
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_DEPTH = 12;
const MAX_CHUNKS_PER_FILE = 600;
const MAX_TOTAL_CHUNKS = 60000;
const FILE_TIMEOUT_MS = 90000;
const SKIP_DIRS = new Set(['node_modules', '__macosx', '.git', '.trash', 'venv', 'site-packages']);

const withTimeout = (p, ms, msg) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(msg)), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

function friendlyReadError(file, e) {
  const m = String((e && e.message) || e);
  if (/password|encrypted|chiffr/i.test(m) || (e && e.name === 'PasswordException')) return 'document protégé par mot de passe (non lisible)';
  if (/EACCES|EPERM/.test(m) || (e && (e.code === 'EACCES' || e.code === 'EPERM'))) return 'accès refusé (fichier verrouillé ou droits insuffisants)';
  if (/ENOENT/.test(m)) return 'fichier disparu pendant la lecture';
  if (/Invalid PDF|bad XRef|FormatError|InvalidPDF/i.test(m)) return 'PDF endommagé ou illisible';
  if (/zip|central directory|corrupt/i.test(m)) return 'fichier endommagé ou illisible';
  return m.slice(0, 160);
}

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (!EXT.has(ext)) throw new Error('Type de fichier non pris en charge.');
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error("Ce chemin n'est pas un fichier.");
  if (st.size > MAX_FILE_BYTES) throw new Error(`Fichier trop volumineux (${Math.round(st.size / 1048576)} Mo, maximum ${MAX_FILE_BYTES / 1048576} Mo).`);
  const job = (async () => {
    if (ext === '.pdf') {
      const pdf = require('pdf-parse/lib/pdf-parse.js');
      const r = await pdf(fs.readFileSync(file), { max: 400 }); // 400 pages maximum
      return r.text || '';
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      return (await mammoth.extractRawText({ path: file })).value || '';
    }
    if (ext === '.eml') {
      const { simpleParser } = require('mailparser');
      const m = await simpleParser(fs.readFileSync(file));
      return `De: ${m.from?.text || ''}\nÀ: ${m.to?.text || ''}\nObjet: ${m.subject || ''}\nDate: ${m.date || ''}\n\n${m.text || ''}`;
    }
    const raw = fs.readFileSync(file, 'utf8');
    if (ext === '.html' || ext === '.htm') return raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (ext === '.rtf') return raw.replace(/\\par[d]?/g, '\n').replace(/\{[^}]*\}|\\[a-z]+-?\d* ?/g, '');
    return raw;
  })();
  return withTimeout(job, FILE_TIMEOUT_MS, 'lecture trop longue (plus de 90 s)');
}

// ---- Texte → mots ----
const STOP = new Set(('le la les un une des du de d l au aux et ou ni mais donc or car que qui quoi dont ou ce cet cette ces se sa son ses leur leurs mon ma mes ton ta tes notre nos votre vos ' +
  'je tu il elle on nous vous ils elles me te lui en y ne pas plus par pour sur sous dans avec sans vers chez entre est sont etre ete suis es sommes etes ai as avons avez ont fait faire ' +
  'the of and to in for on with is are was were a an it as at by be this that').split(/\s+/));
const fold = (s) => String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
// Racinisation très légère (pluriels) : « budgets » ~ « budget », « travaux » ~ « travau ».
const stem = (w) => (w.length > 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w);
function tokens(s, { keepStop = false } = {}) {
  const all = fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const kept = keepStop ? all : all.filter((w) => !STOP.has(w));
  return kept.map(stem);
}

function chunk(text, size = 1200, overlap = 200) {
  const clean = String(text).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const out = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    out.push(clean.slice(i, i + size));
    if (i + size >= clean.length || out.length >= MAX_CHUNKS_PER_FILE) break;
  }
  return out;
}

// Parcours : ni liens symboliques, ni dossiers cachés, ni node_modules ; profondeur et nombre de fichiers bornés.
function walk(dir, acc = [], depth = 0, state = { truncated: false }) {
  if (depth > MAX_DEPTH) return acc;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (acc.length >= MAX_FILES) { state.truncated = true; break; }
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue; // cachés, verrous Office
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) walk(p, acc, depth + 1, state); }
    else if (e.isFile() && EXT.has(path.extname(e.name).toLowerCase())) acc.push(p);
  }
  return acc;
}

const loadRaw = () => {
  const i = store.read('index', { files: {}, updated: null });
  if (!i.files || typeof i.files !== 'object' || Array.isArray(i.files)) i.files = {};
  for (const [k, v] of Object.entries(i.files)) if (!v || !Array.isArray(v.chunks)) delete i.files[k];
  return i;
};

let building = false, cancelRequested = false;
const cancel = () => { cancelRequested = true; return building; };
const isBuilding = () => building;

async function build(emit = () => {}) {
  if (building) throw new Error('Une indexation est déjà en cours.');
  building = true; cancelRequested = false;
  try {
    const st = store.settings.get();
    const idx = loadRaw();
    const found = new Set(); let added = 0, skipped = 0, empty = 0; const errors = []; let cancelled = false;
    const folders = st.docs.folders.filter((f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });
    const state = { truncated: false };
    const files = [...new Set(folders.flatMap((f) => walk(f, [], 0, state)))];
    if (state.truncated) errors.push(`Plus de ${MAX_FILES} fichiers : l'indexation est limitée aux ${MAX_FILES} premiers.`);
    let totalChunks = Object.values(idx.files).reduce((a, m) => a + m.chunks.length, 0);
    let n = 0;
    for (const f of files) {
      if (cancelRequested) { cancelled = true; break; }
      found.add(f); n++;
      let stat; try { stat = fs.statSync(f); } catch (e) { errors.push(`${path.basename(f)} : ${friendlyReadError(f, e)}`); continue; }
      const prev = idx.files[f];
      if (prev && prev.mtime === stat.mtimeMs && prev.size === stat.size) { skipped++; continue; }
      if (stat.size > MAX_FILE_BYTES) { errors.push(`${path.basename(f)} : fichier trop volumineux (> ${MAX_FILE_BYTES / 1048576} Mo), ignoré`); continue; }
      emit('progress', { label: `Indexation ${n}/${files.length} : ${path.basename(f)}` });
      await new Promise((r) => setImmediate(r)); // laisse respirer l'interface
      try {
        const chunks = chunk(await extractText(f));
        if (totalChunks + chunks.length - (prev ? prev.chunks.length : 0) > MAX_TOTAL_CHUNKS) { errors.push(`${path.basename(f)} : index plein (${MAX_TOTAL_CHUNKS} extraits), ignoré`); continue; }
        totalChunks += chunks.length - (prev ? prev.chunks.length : 0);
        idx.files[f] = { mtime: stat.mtimeMs, size: stat.size, chunks };
        if (!chunks.length) { empty++; errors.push(`${path.basename(f)} : aucun texte lisible (PDF scanné ? un OCR serait nécessaire)`); } else added++;
      } catch (e) { errors.push(`${path.basename(f)} : ${friendlyReadError(f, e)}`); }
    }
    if (!cancelled) for (const f of Object.keys(idx.files)) if (!found.has(f)) delete idx.files[f];
    idx.updated = store.now();
    store.write('index', idx); cache = null;
    return { files: Object.keys(idx.files).length, added, skipped, empty, errors: errors.slice(0, 200), folders, cancelled, truncated: state.truncated };
  } finally { building = false; cancelRequested = false; }
}

let cache = null;
function engine() {
  if (cache) return cache;
  const idx = loadRaw(); const docs = []; const df = new Map();
  for (const [file, meta] of Object.entries(idx.files)) {
    meta.chunks.forEach((text, i) => {
      const toks = tokens(text); const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      docs.push({ file, i, text, tf, len: toks.length });
    });
  }
  const avg = docs.reduce((a, d) => a + d.len, 0) / (docs.length || 1) || 1;
  cache = { docs, df, avg, N: docs.length, updated: idx.updated };
  return cache;
}

function search(query, k = 8) {
  k = Math.min(Math.max(parseInt(k, 10) || 8, 1), 30);
  query = String(query == null ? '' : query).slice(0, 2000);
  const e = engine();
  let q = [...new Set(tokens(query))];
  if (!q.length) q = [...new Set(tokens(query, { keepStop: true }))]; // requête composée uniquement de mots vides
  if (!e.N || !q.length) return [];
  const k1 = 1.4, b = 0.75;
  const scored = [];
  for (const d of e.docs) {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t); if (!f) continue;
      const n = e.df.get(t) || 0;
      const idf = Math.log(1 + (e.N - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / e.avg));
    }
    if (s > 0) scored.push({ s, d });
  }
  scored.sort((a, c) => c.s - a.s);
  const seen = new Map(); const out = [];
  for (const { s, d } of scored) {
    if ((seen.get(d.file) || 0) >= 2) continue; seen.set(d.file, (seen.get(d.file) || 0) + 1);
    out.push({ file: d.file, name: path.basename(d.file), score: Math.round(s * 100) / 100, chunk: d.i, text: d.text });
    if (out.length >= k) break;
  }
  return out;
}

function stats() {
  const idx = loadRaw(); const files = Object.keys(idx.files);
  return { files: files.length, chunks: files.reduce((a, f) => a + idx.files[f].chunks.length, 0), updated: idx.updated, building };
}

// Un chemin est-il dans un des dossiers de documents autorisés ? (résolution des liens symboliques incluse)
function isInside(file, folders) {
  let real; try { real = fs.realpathSync(file); } catch { return false; }
  return folders.some((f) => { try { const r = fs.realpathSync(f); const rel = path.relative(r, real); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); } catch { return false; } });
}

module.exports = { extractText, build, cancel, isBuilding, search, stats, tokens, chunk, walk, isInside, EXT: [...EXT], MAX_FILE_BYTES };
