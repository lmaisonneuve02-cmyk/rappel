// Stockage clé/valeur de l'appareil : IndexedDB, avec repli en mémoire
// (navigation privée, IndexedDB bloqué ou en panne). Ne lève jamais d'erreur.

const MAGASIN = 'kv';

// Copie indépendante, comme le ferait IndexedDB.
const copie = v => (v === undefined ? v : typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

// Promesse d'une requête IndexedDB.
function attendre(req) {
  return new Promise((ok, ko) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ko(req.error);
  });
}

function ouvrirBase(idb, nom) {
  return new Promise((ok, ko) => {
    const req = idb.open(nom, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MAGASIN)) req.result.createObjectStore(MAGASIN);
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ko(req.error);
    req.onblocked = () => ko(new Error('base bloquée'));
  });
}

// Lecture ou écriture dans une transaction ; résout quand la transaction est terminée.
function transaction(db, mode, action) {
  return new Promise((ok, ko) => {
    const tx = db.transaction(MAGASIN, mode);
    let resultat;
    Promise.resolve(action(tx.objectStore(MAGASIN))).then(r => { resultat = r; }, ko);
    tx.oncomplete = () => ok(resultat);
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error || new Error('transaction annulée'));
  });
}

// {lire(cle), ecrire(cle, valeur), effacer(cle), tout(), vider()} ; `enMemoire` vaut true sans IndexedDB.
export async function ouvrirStockage(nom = 'rappel2', { indexedDB: idb = globalThis.indexedDB } = {}) {
  // Valeurs gardées en mémoire : tout, sans IndexedDB ; sinon seulement les écritures qui ont échoué.
  const memoire = new Map();
  let db = null;
  if (idb) {
    try {
      db = await ouvrirBase(idb, nom);
      db.onversionchange = () => { try { db.close(); } catch { /* rien */ } db = null; };
    } catch { db = null; }
  }

  return {
    get enMemoire() { return !db; },

    async lire(cle) {
      if (memoire.has(cle) || !db) return copie(memoire.get(cle));
      try { return await transaction(db, 'readonly', s => attendre(s.get(cle))); } catch { return undefined; }
    },

    async ecrire(cle, valeur) {
      if (db) {
        try {
          await transaction(db, 'readwrite', s => attendre(s.put(valeur, cle)));
          memoire.delete(cle);
          return;
        } catch { /* repli en mémoire ci-dessous */ }
      }
      try { memoire.set(cle, copie(valeur)); } catch { /* valeur non copiable : ignorée */ }
    },

    async effacer(cle) {
      memoire.delete(cle);
      if (!db) return;
      try { await transaction(db, 'readwrite', s => attendre(s.delete(cle))); } catch { /* rien */ }
    },

    // Toutes les entrées {cle: valeur}.
    async tout() {
      const sortie = {};
      if (db) {
        try {
          await transaction(db, 'readonly', async s => {
            const [cles, valeurs] = await Promise.all([attendre(s.getAllKeys()), attendre(s.getAll())]);
            cles.forEach((k, i) => { sortie[k] = valeurs[i]; });
          });
        } catch { /* rien */ }
      }
      for (const [k, v] of memoire) sortie[k] = copie(v);
      return sortie;
    },

    // Efface tout (« Effacer les données de cet appareil »).
    async vider() {
      memoire.clear();
      if (!db) return;
      try { await transaction(db, 'readwrite', s => attendre(s.clear())); } catch { /* rien */ }
    },
  };
}
