// Lecture de documents locaux + index plein-texte (BM25) 100 % hors-ligne.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const EXT = new Set(['.txt', '.md', '.pdf', '.docx', '.eml', '.html', '.htm', '.csv', '.rtf']);

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    const r = await pdf(fs.readFileSync(file));
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
}

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);

function chunk(text, size = 1200, overlap = 200) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const out = [];
  for (let i = 0; i < clean.length; i += size - overlap) { out.push(clean.slice(i, i + size)); if (i + size >= clean.length) break; }
  return out;
}

function walk(dir, acc = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (EXT.has(path.extname(e.name).toLowerCase())) acc.push(p);
  }
  return acc;
}

const load = () => store.read('index', { files: {}, updated: null });

async function build(emit = () => {}) {
  const st = store.settings.get();
  const idx = load();
  const found = new Set(); let added = 0, skipped = 0, errors = [];
  const folders = st.docs.folders.filter((f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });
  const files = folders.flatMap((f) => walk(f));
  let n = 0;
  for (const f of files) {
    found.add(f); n++;
    const stat = fs.statSync(f);
    const prev = idx.files[f];
    if (prev && prev.mtime === stat.mtimeMs && prev.size === stat.size) { skipped++; continue; }
    emit('progress', { label: `Indexation ${n}/${files.length} : ${path.basename(f)}` });
    try {
      const text = await extractText(f);
      idx.files[f] = { mtime: stat.mtimeMs, size: stat.size, chunks: chunk(text) };
      added++;
    } catch (e) { errors.push(`${path.basename(f)} : ${e.message}`); }
  }
  for (const f of Object.keys(idx.files)) if (!found.has(f)) delete idx.files[f];
  idx.updated = store.now();
  store.write('index', idx); cache = null;
  return { files: Object.keys(idx.files).length, added, skipped, errors, folders };
}

let cache = null;
function engine() {
  if (cache) return cache;
  const idx = load(); const docs = []; const df = new Map();
  for (const [file, meta] of Object.entries(idx.files)) {
    meta.chunks.forEach((text, i) => {
      const toks = tokens(text); const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      docs.push({ file, i, text, tf, len: toks.length });
    });
  }
  const avg = docs.reduce((a, d) => a + d.len, 0) / (docs.length || 1);
  cache = { docs, df, avg, N: docs.length, updated: idx.updated };
  return cache;
}

function search(query, k = 8) {
  const e = engine(); const q = [...new Set(tokens(query))];
  if (!e.N || !q.length) return [];
  const k1 = 1.4, b = 0.75;
  const scored = [];
  for (const d of e.docs) {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t); if (!f) continue;
      const idf = Math.log(1 + (e.N - (e.df.get(t) || 0) + 0.5) / ((e.df.get(t) || 0) + 0.5));
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
  const idx = load(); const files = Object.keys(idx.files);
  return { files: files.length, chunks: files.reduce((a, f) => a + idx.files[f].chunks.length, 0), updated: idx.updated };
}

module.exports = { extractText, build, search, stats, EXT: [...EXT] };
