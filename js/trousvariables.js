// Trous variables (5 nov. 2026, demande de l'utilisateur) : à la révision d'un texte à trous qui compte au moins
// 3 trous, on n'en garde que 2 à n au hasard ; les autres s'affichent en clair. Le barème suit (t1…tk renumérotés).
// Une carte jamais vue garde tous ses trous. Les cartes de moins de 3 trous ne changent pas.
import { clozeParts } from './texte.js';

export const TROUS_MIN = 3;

export function varianteTrous(carte, rnd = Math.random) {
  if (!carte || carte.type !== 'cloze' || typeof carte.q !== 'string') return carte;
  const parts = clozeParts(carte.q);
  const n = parts.filter(p => typeof p !== 'string').length;
  if (n < TROUS_MIN) return carte;
  const k = 2 + Math.floor(rnd() * (n - 1));          // 2 à n trous gardés
  if (k >= n) return carte;
  const ordre = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ordre[i], ordre[j]] = [ordre[j], ordre[i]]; }
  const gardes = ordre.slice(0, k).sort((a, b) => a - b);
  let m = -1;
  const q = parts.map(p => {
    if (typeof p === 'string') return p;
    m++;
    return gardes.includes(m) ? `{{${p.ans}}}` : p.ans;
  }).join('');
  const b = carte.bareme && typeof carte.bareme === 'object' ? carte.bareme : null;
  const idees = b && Array.isArray(b.idees) ? b.idees.filter(i => i && typeof i === 'object') : [];
  const parId = idees.some(i => /^t\d+$/.test(String(i.id)));
  const nouvelles = [];
  gardes.forEach((orig, nouveau) => {
    const i = parId ? idees.find(x => String(x.id) === `t${orig + 1}`) : idees[orig];
    if (i) nouvelles.push({ ...i, id: `t${nouveau + 1}` });
  });
  return { ...carte, q, bareme: b ? { ...b, idees: nouvelles } : carte.bareme, variante: true };
}
