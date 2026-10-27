// Voix. PARLER : Piper (open source, gratuit, 100 % hors-ligne, voix françaises féminines et masculines), téléchargé à la demande.
// ÉCOUTER : transcription Whisper via une API compatible OpenAI (OpenAI, ou serveur local open source type whisper.cpp).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const store = require('./store');

const PIPER_VERSION = '2023.11.14-2';
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR';
const VOICES = [
  { id: 'siwis', label: 'Siwis', gender: 'femme', path: 'siwis/medium/fr_FR-siwis-medium', mb: 63 },
  { id: 'tom', label: 'Tom', gender: 'homme', path: 'tom/medium/fr_FR-tom-medium', mb: 64 },
  { id: 'gilles', label: 'Gilles (léger)', gender: 'homme', path: 'gilles/low/fr_FR-gilles-low', mb: 63 },
];
const vdir = () => path.join(store.DIR, 'voice');
const piperDir = () => path.join(vdir(), 'piper');
const piperBin = () => path.join(piperDir(), 'piper');
const modelPath = (v) => path.join(vdir(), 'models', path.basename(v.path) + '.onnx');

function status() {
  return {
    engineInstalled: fs.existsSync(piperBin()),
    arch: process.arch,
    voices: VOICES.map((v) => ({ ...v, installed: fs.existsSync(modelPath(v)) && fs.existsSync(modelPath(v) + '.json') })),
  };
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  const total = Number(res.headers.get('content-length')) || 0; let got = 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part'; const out = fs.createWriteStream(tmp);
  for await (const chunk of res.body) { out.write(chunk); got += chunk.length; if (onProgress && total) onProgress(got / total); }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, dest);
}

const run = (cmd, args, opts) => new Promise((res, rej) => execFile(cmd, args, opts, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));

// Installe le moteur Piper (≈ 19 Mo) si absent, puis la voix choisie.
async function install(voiceId, emit = () => {}) {
  const v = VOICES.find((x) => x.id === voiceId); if (!v) throw new Error('Voix inconnue.');
  if (!fs.existsSync(piperBin())) {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const tgz = path.join(vdir(), 'piper.tar.gz');
    emit('progress', { label: 'Téléchargement du moteur vocal Piper…' });
    await download(`https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_macos_${arch}.tar.gz`, tgz, (p) => emit('progress', { label: `Moteur vocal : ${Math.round(p * 100)} %` }));
    await run('tar', ['-xzf', tgz, '-C', vdir()]);
    fs.rmSync(tgz, { force: true });
    if (!fs.existsSync(piperBin())) throw new Error('Moteur Piper introuvable après extraction.');
    fs.chmodSync(piperBin(), 0o755);
  }
  const m = modelPath(v);
  if (!fs.existsSync(m)) {
    await download(`${HF}/${v.path}.onnx.json`, m + '.json');
    await download(`${HF}/${v.path}.onnx`, m, (p) => emit('progress', { label: `Voix ${v.label} : ${Math.round(p * 100)} %` }));
  }
  store.settings.set({ voice: { engine: 'piper', piperVoice: v.id } });
  return status();
}

function removeVoice(voiceId) {
  const v = VOICES.find((x) => x.id === voiceId); if (!v) return status();
  fs.rmSync(modelPath(v), { force: true }); fs.rmSync(modelPath(v) + '.json', { force: true }); return status();
}

// Synthétise un court texte → WAV (base64). Le moteur est lancé sans shell, le texte passe par stdin.
function synth(text) {
  const cfg = store.settings.get().voice; const v = VOICES.find((x) => x.id === cfg.piperVoice) || VOICES[0];
  if (!fs.existsSync(piperBin()) || !fs.existsSync(modelPath(v))) return Promise.reject(new Error('Voix Piper non installée (Réglages › Voix).'));
  const out = path.join(os.tmpdir(), `jarvis-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`);
  const rate = Math.min(1.5, Math.max(0.6, Number(cfg.ttsRate) || 1));
  return new Promise((resolve, reject) => {
    const p = spawn(piperBin(), ['--model', modelPath(v), '--output_file', out, '--length_scale', String(1 / rate)], { cwd: piperDir(), env: { ...process.env, DYLD_LIBRARY_PATH: piperDir() }, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { p.kill(); reject(new Error('Synthèse vocale trop longue.')); }, 60000);
    p.on('error', (e) => { clearTimeout(timer); reject(new Error('Piper : ' + e.message)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      try { if (code !== 0 || !fs.existsSync(out)) throw new Error('Piper a échoué : ' + err.slice(-200)); const b = fs.readFileSync(out).toString('base64'); fs.rmSync(out, { force: true }); resolve(b); }
      catch (e) { fs.rmSync(out, { force: true }); reject(e); }
    });
    p.stdin.end(String(text).slice(0, 1500) + '\n');
  });
}

// ---- Écoute (transcription) ----
function sttConfigured() {
  const v = store.settings.get().voice;
  if (!v.sttUrl) return false;
  try { const h = new URL(v.sttUrl).hostname; if (['localhost', '127.0.0.1', '::1'].includes(h)) return true; } catch { return false; }
  return store.hasSecret('stt_key');
}
const configured = sttConfigured;

async function transcribe({ audio, mime }) {
  const v = store.settings.get().voice; const st = store.settings.get();
  if (!sttConfigured()) throw new Error("Transcription vocale non configurée (Réglages › Voix). En attendant, utilise la dictée macOS : appuie deux fois sur Fn dans n'importe quel champ.");
  const buf = Buffer.from(audio, 'base64');
  if (buf.length < 1500) throw new Error('Enregistrement trop court.');
  const ext = /mp4|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime || 'audio/webm' }), `voix.${ext}`);
  form.append('model', v.sttModel || 'whisper-1'); form.append('language', st.profile.langue || 'fr'); form.append('response_format', 'json');
  const key = store.getSecret('stt_key'); let res;
  try { res = await fetch(v.sttUrl.replace(/\/$/, '') + '/audio/transcriptions', { method: 'POST', headers: key ? { authorization: 'Bearer ' + key } : {}, body: form }); }
  catch (e) { throw new Error('Serveur de transcription injoignable : ' + (e.cause?.code || e.message)); }
  const txt = await res.text(); let j = null; try { j = JSON.parse(txt); } catch { /* brut */ }
  if (!res.ok) throw new Error(`Transcription refusée (${res.status}) : ${j?.error?.message || txt.slice(0, 200)}`);
  return { text: (j?.text ?? txt).trim() };
}

module.exports = { VOICES, status, install, removeVoice, synth, configured, transcribe };
