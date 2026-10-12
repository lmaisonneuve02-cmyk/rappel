// FSRS-4.5, repris à l'identique de Rappel v1 (poids, formules, arrondis).
import { MIN, HEURE, JOUR, finJourParis, jourParis } from './temps.js';

const DAY = JOUR;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
export const DECAY = -0.5, FACTOR = 19 / 81, RET = 0.9;

const retr = (t, s) => Math.pow(1 + FACTOR * t / s, DECAY);
const ivl = s => clamp(Math.round(s / FACTOR * (Math.pow(RET, 1 / DECAY) - 1)), 1, 365);
const d0 = g => clamp(W[4] - W[5] * (g - 3), 1, 10);

export function review(st, g, now) {
  let s, d;
  if (!st || !st.reps) { s = W[g - 1]; d = d0(g); }
  else {
    const t = Math.max(0, (now - (st.last || now)) / DAY), r = retr(t, st.s);
    d = clamp(W[7] * d0(4) + (1 - W[7]) * (st.d - W[6] * (g - 3)), 1, 10);
    if (g === 1) s = Math.min(st.s, W[11] * Math.pow(st.d, -W[12]) * (Math.pow(st.s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
    else s = st.s * (1 + Math.exp(W[8]) * (11 - st.d) * Math.pow(st.s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
  }
  s = Math.max(0.1, s);
  return { s: +s.toFixed(3), d: +d.toFixed(3), due: g === 1 ? now + 10 * MIN : now + ivl(s) * DAY, last: now, reps: (st && st.reps || 0) + 1, lapses: (st && st.lapses || 0) + (g === 1 && st && st.reps ? 1 : 0) };
}

export function apercu(st, g, now) {
  if (g === 1) return '10 min';
  const n = Math.round((review(st, g, now).due - now) / DAY);
  return n < 30 ? n + ' j' : n < 365 ? Math.round(n / 30) + ' mois' : '1 an';
}

export const NOTES = { juste: 3, partiel: 2, faux: 1 };
export const noteDe = verdict => NOTES[verdict] ?? 1;

// Révision proposable maintenant : « dû dès minuit » (heure de Paris),
// sauf le retour à +10 min après une erreur, qui reste à l'heure près.
export function estDisponible(st, now) {
  if (!st) return false;
  if (st.due - st.last <= HEURE) return now >= st.due;
  return st.due < finJourParis(now);
}

// Règle de déblocage : dernière réponse du jour juste ou partielle.
export function estAcquise(st, jour) {
  return !!st && jourParis(st.last) === jour && st.due - st.last > HEURE;
}

export function delaiTexte(st, now) {
  if (!st) return '';
  const ms = st.due - now;
  if (ms <= HEURE) return `revient dans ${Math.max(1, Math.round(ms / MIN))} min`;
  const jours = Math.round((st.due - st.last) / DAY);
  if (jours <= 1) return 'revient demain';
  if (jours < 30) return `revient dans ${jours} jours`;
  if (jours < 365) return `revient dans ${Math.round(jours / 30)} mois`;
  return 'revient dans un an';
}
