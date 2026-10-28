// Événements d'agenda à partir d'un courriel : fichier .ics (Agenda d'Apple et tout autre agenda) et lien de pré-remplissage Google Agenda.
// Rien n'est créé automatiquement : l'utilisateur valide dans son application d'agenda (aucune écriture chez Google, scopes en lecture seule).
const crypto = require('crypto');
const TZ = 'Europe/Brussels';

const pad = (n, l = 2) => String(n).padStart(l, '0');
const RX_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const RX_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// Décalage (minutes) de Bruxelles par rapport à UTC à un instant donné.
function offsetMin(utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs) / 60000);
}
// Heure locale de Bruxelles (y, m, d, h, mi) → instant UTC en ms (gère l'heure d'été).
function brusselsToUtc(y, m, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - offsetMin(guess) * 60000;
  utc = guess - offsetMin(utc) * 60000;
  return utc;
}
const validDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

// Normalise et valide { title, start, end, allDay, location, description } ; start/end : « AAAA-MM-JJ » ou « AAAA-MM-JJThh:mm » (heure de Bruxelles).
function normalize(ev) {
  if (!ev || typeof ev !== 'object') throw new Error("Aucun événement à ajouter.");
  const title = String(ev.title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!title) throw new Error("L'événement n'a pas de titre.");
  const start = String(ev.start || '').trim(); let end = String(ev.end || '').trim();
  const ms = RX_DT.exec(start), md = RX_DAY.exec(start);
  if (!ms && !md) throw new Error("La date de début est invalide (attendu : jour et heure).");
  const allDay = !ms;
  const [y, m, d] = (ms || md).slice(1, 4).map(Number); if (!validDay(y, m, d)) throw new Error("Cette date n'existe pas.");
  if (ms && (+ms[4] > 23 || +ms[5] > 59)) throw new Error("L'heure de début est invalide.");
  let endMs;
  if (allDay) {
    const e = RX_DAY.exec(end); // fin INCLUSIVE saisie par l'utilisateur ; stockée exclusive
    const last = e && validDay(+e[1], +e[2], +e[3]) ? Date.UTC(+e[1], +e[2] - 1, +e[3]) : Date.UTC(y, m - 1, d);
    const first = Date.UTC(y, m - 1, d);
    endMs = Math.max(last, first) + 86400000;
    return { title, allDay, startMs: first, endMs, startDay: start, endDay: new Date(endMs).toISOString().slice(0, 10), location: String(ev.location || '').slice(0, 300), description: String(ev.description || '').slice(0, 4000) };
  }
  const startMs = brusselsToUtc(y, m, d, +ms[4], +ms[5]);
  const me = RX_DT.exec(end);
  if (me && validDay(+me[1], +me[2], +me[3]) && +me[4] <= 23 && +me[5] <= 59) endMs = brusselsToUtc(+me[1], +me[2], +me[3], +me[4], +me[5]);
  if (!endMs || endMs <= startMs) endMs = startMs + 3600000; // durée par défaut : 1 h
  return { title, allDay, startMs, endMs, startLocal: start, endLocal: localOf(endMs), location: String(ev.location || '').slice(0, 300), description: String(ev.description || '').slice(0, 4000) };
}
function localOf(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const utcStamp = (ms) => { const t = new Date(ms); return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`; };
const dayStamp = (iso) => iso.replace(/-/g, '');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Pliage des lignes à 75 octets maximum (RFC 5545), sans couper un caractère multi-octets.
function fold(line) {
  const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) { const b = Buffer.byteLength(ch); if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; } cur += ch; bytes += b; }
  out.push(cur); return out.join('\r\n ');
}

function toIcs(input, { uidSeed = '' } = {}) {
  const ev = normalize(input);
  const uid = crypto.createHash('sha1').update(uidSeed + ev.title + (ev.startLocal || ev.startDay)).digest('hex') + '@jarvis-parlement';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jarvis Parlement//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utcStamp(Date.now())}`];
  if (ev.allDay) lines.push(`DTSTART;VALUE=DATE:${dayStamp(ev.startDay)}`, `DTEND;VALUE=DATE:${dayStamp(ev.endDay)}`);
  else lines.push(`DTSTART:${utcStamp(ev.startMs)}`, `DTEND:${utcStamp(ev.endMs)}`);
  lines.push(`SUMMARY:${esc(ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
  if (!ev.allDay) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Rappel', 'TRIGGER:-PT30M', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Lien « Ajouter à Google Agenda » : s'ouvre dans le navigateur, pré-rempli ; l'utilisateur clique sur Enregistrer.
function googleUrl(input) {
  const ev = normalize(input); const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title });
  if (ev.allDay) q.set('dates', `${dayStamp(ev.startDay)}/${dayStamp(ev.endDay)}`);
  else { q.set('dates', `${ev.startLocal.replace(/[-:]/g, '')}00/${ev.endLocal.replace(/[-:]/g, '')}00`); q.set('ctz', TZ); }
  if (ev.location) q.set('location', ev.location);
  if (ev.description) q.set('details', ev.description.slice(0, 1500));
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

module.exports = { TZ, brusselsToUtc, normalize, toIcs, googleUrl, localOf };
