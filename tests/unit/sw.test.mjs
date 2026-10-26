// Hors ligne : chaque module de l'appli doit être dans la liste du service worker (sinon l'appli ne s'ouvre plus sans réseau).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('sw.js garde tous les modules de js/ et js/ui/', () => {
  const sw = readFileSync(join(RACINE, 'sw.js'), 'utf8');
  const listes = new Set([...sw.matchAll(/'(js\/[^']+\.js)'/g)].map(m => m[1]));
  const modules = [
    ...readdirSync(join(RACINE, 'js')).filter(f => f.endsWith('.js')).map(f => `js/${f}`),
    ...readdirSync(join(RACINE, 'js/ui')).filter(f => f.endsWith('.js')).map(f => `js/ui/${f}`),
  ];
  assert.deepEqual(modules.filter(m => !listes.has(m)), []);
});
