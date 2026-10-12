// Heure de Paris : toutes les notions de « jour » de l'appli, quel que soit le fuseau de l'appareil.
export const MIN = 6e4, HEURE = 36e5, JOUR = 864e5;

const FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function parties(ms) {
  const p = {};
  for (const { type, value } of FMT.formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

// Décalage de Paris par rapport à UTC à l'instant ms, en ms (+1 h ou +2 h).
function decalage(ms) {
  const p = parties(ms);
  const local = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return local - Math.floor(ms / 1000) * 1000;
}

// Instant UTC correspondant à une heure murale de Paris.
function depuisMurale(y, m, d, h = 0, mi = 0) {
  const naif = Date.UTC(y, m - 1, d, h, mi);
  let ms = naif - decalage(naif);
  ms = naif - decalage(ms);
  return ms;
}

const deux = n => String(n).padStart(2, '0');

export function jourParis(ms) {
  const p = parties(ms);
  return `${p.y}-${deux(p.m)}-${deux(p.d)}`;
}

export function moisParis(ms) {
  return jourParis(ms).slice(0, 7);
}

export function debutJourParis(ms) {
  const p = parties(ms);
  return depuisMurale(p.y, p.m, p.d);
}

export function finJourParis(ms) {
  const p = parties(ms);
  const suivant = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return depuisMurale(suivant.getUTCFullYear(), suivant.getUTCMonth() + 1, suivant.getUTCDate());
}

export function decalerJour(jour, n) {
  const [y, m, d] = jour.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${deux(t.getUTCMonth() + 1)}-${deux(t.getUTCDate())}`;
}

export function isoParis(ms) {
  const p = parties(ms);
  const dec = Math.round(decalage(ms) / MIN);
  const signe = dec >= 0 ? '+' : '-';
  const a = Math.abs(dec);
  return `${p.y}-${deux(p.m)}-${deux(p.d)}T${deux(p.h)}:${deux(p.mi)}:${deux(p.s)}${signe}${deux(Math.floor(a / 60))}:${deux(a % 60)}`;
}

export function heureParis(ms) {
  const p = parties(ms);
  return `${deux(p.h)}:${deux(p.mi)}`;
}
