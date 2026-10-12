// Réglages : clés, rythme, QCM, voix, apparence, correction, données, version.
// Tout s'enregistre seul (toast « Réglage enregistré ») ; les clés restent sur l'appareil.
import { ClientGitHub } from '../github.js';
import { verifierCle, corrigerGemini } from '../gemini.js';
import { Parole } from '../voix.js';
import { MODELES_DEFAUT, CLES, DEPOT_DEFAUT } from '../config.js';
import { jourParis, heureParis } from '../temps.js';
import {
  h, vider, bouton, libeller, boutonConfirme, icone, toast, champSecret, nb, lireLocal, ecrireLocal, oublierAides,
} from './commun.js';

// Nombre réglable par − et + (boutons de 48 px).
function reglerNombre({ id, libelle, aide, valeur, min, max, pas = 1, decimales = 0, unite = '', onChange }) {
  let v = valeur;
  const affiche = h('output', { class: 'reglage-nombre__valeur', id: `${id}-valeur`, 'aria-live': 'polite' });
  const montrer = () => { affiche.textContent = `${String(v.toFixed(decimales)).replace('.', ',')}${unite}`; moins.disabled = v <= min; plus.disabled = v >= max; };
  const changer = d => { v = Math.min(max, Math.max(min, Math.round((v + d) * 100) / 100)); montrer(); onChange(v); };
  const moins = h('button', { type: 'button', class: 'btn-icone btn-icone--cadre', 'aria-label': `Moins : ${libelle}`, onclick: () => changer(-pas), text: '−' });
  const plus = h('button', { type: 'button', class: 'btn-icone btn-icone--cadre', 'aria-label': `Plus : ${libelle}`, onclick: () => changer(pas), text: '+' });
  montrer();
  return h('div', { class: 'reglage' },
    h('div', { class: 'reglage__texte' }, h('p', { class: 'reglage__libelle', id: `${id}-libelle`, text: libelle }), aide ? h('p', { class: 'aide', text: aide }) : null),
    h('div', { class: 'reglage-nombre', role: 'group', 'aria-labelledby': `${id}-libelle` }, moins, affiche, plus));
}

function section(id, titre, ...contenu) {
  return h('section', { class: 'section-reglages', id: `reglages-${id}`, 'aria-labelledby': `titre-${id}` },
    h('h2', { class: 'sous-titre', id: `titre-${id}`, text: titre, tabindex: '-1' }), contenu);
}

function message(zone, texte, type = 'erreur') {
  vider(zone, texte ? h('p', { class: ['message', `message--${type}`], role: type === 'erreur' ? 'alert' : 'status' },
    icone(type === 'ok' ? 'juste' : type === 'erreur' ? 'attention' : 'info'), h('span', { text: texte })) : null);
}

export function creer(ctx, params = {}) {
  const page = h('div', { class: 'page page--reglages' });
  let minuterie = null;
  let enCours = null;     // modifications de réglages pas encore enregistrées
  let parole = null;

  // Réglages partagés (dépôt) : l'objet entier, avec la date de modification.
  function enregistrer(changement) {
    enCours = { ...(enCours || {}), ...changement };
    clearTimeout(minuterie);
    minuterie = setTimeout(vidanger, 600);
  }
  function vidanger() {
    clearTimeout(minuterie);
    if (!enCours) return;
    const r = ctx.reglages();
    const reglages = { ...r, ...enCours, maj: ctx.maintenant() };
    enCours = null;
    ctx.sync.ajouter({ type: 'reglages', reglages });
    toast('Réglage enregistré');
  }

  // --- Mes clés ---
  function blocJeton() {
    const cles = ctx.cles();
    const zone = h('div', { class: 'zone-message', 'aria-live': 'polite' });
    const { bloc, input } = champSecret({ id: 'r-jeton', libelle: "Jeton d'accès GitHub",
      placeholder: cles.jeton ? 'Colle un nouveau jeton' : 'github_pat_…' });
    const verifier = bouton('Vérifier', { classe: 'btn--plein', onClick: async () => {
      const jeton = input.value.trim().replace(/\s+/g, '') || ctx.cles().jeton;
      if (!jeton) { message(zone, "Colle d'abord le jeton dans le champ."); return; }
      verifier.disabled = true; libeller(verifier, 'Je vérifie…');
      const depot = ctx.cles().depot;
      try {
        const r = await new ClientGitHub({ jeton, proprietaire: depot.proprietaire, depot: depot.depot, branche: depot.branche, fetch: ctx.fetch }).verifier();
        if (r.ecriture === false) message(zone, 'Ce jeton peut lire mais pas enregistrer. Sur GitHub, mets « Contents » sur « Read and write ».');
        else {
          const nouveau = jeton !== ctx.cles().jeton;
          if (nouveau) ctx.definirCles({ jeton });
          input.value = '';
          message(zone, nouveau ? 'Jeton vérifié et enregistré.' : 'Le jeton marche.', 'ok');
          majEtatCles();
        }
      } catch (e) {
        message(zone, e?.code === 'jeton' ? 'GitHub refuse ce jeton. Recopie-le en entier : il commence par github_pat_.' : e?.message || 'La vérification n\'a pas abouti.');
      } finally { verifier.disabled = false; libeller(verifier, 'Vérifier'); }
    } });
    const retirer = boutonConfirme('Retirer', 'Retirer ? Touche encore', () => {
      ctx.definirCles({ jeton: '' }); message(zone, 'Jeton retiré de cet appareil.', 'info'); majEtatCles();
    }, { discret: true });
    retirer.hidden = !cles.jeton;
    const etat = h('p', { class: 'etat-cle' });
    const majEtatCles = () => {
      const j = !!ctx.cles().jeton;
      etat.textContent = j ? 'Relié à tes données ✓' : 'Aucun jeton : Rappel ne peut pas lire tes cartes.';
      etat.className = ['etat-cle', j ? 'etat-cle--ok' : ''].join(' ');
      retirer.hidden = !j;
    };
    majEtatCles();
    return h('div', { class: 'bloc-cle' }, etat, bloc, h('div', { class: 'rang-boutons' }, retirer, verifier), zone);
  }

  function blocGemini() {
    const cles = ctx.cles();
    const zone = h('div', { class: 'zone-message', 'aria-live': 'polite' });
    const { bloc, input } = champSecret({ id: 'r-gemini', libelle: 'Clé Gemini (facultative)',
      placeholder: cles.gemini ? 'Colle une nouvelle clé' : 'Colle la clé ici' });
    const etat = h('p', { class: 'etat-cle' });
    const retirer = boutonConfirme('Retirer', 'Retirer ? Touche encore', () => {
      ctx.definirCles({ gemini: '' }); message(zone, 'Clé retirée : la correction se fera sur ton appareil.', 'info'); maj();
    }, { discret: true });
    const maj = () => {
      const g = !!ctx.cles().gemini;
      etat.textContent = g ? 'Correction par Gemini ✓' : "Pas de clé : correction sur l'appareil, moins fine.";
      etat.className = ['etat-cle', g ? 'etat-cle--ok' : ''].join(' ');
      retirer.hidden = !g;
    };
    const verifier = bouton('Vérifier', { classe: 'btn--plein', onClick: async () => {
      const cle = input.value.trim() || ctx.cles().gemini;
      if (!cle) { message(zone, "Colle d'abord la clé dans le champ."); return; }
      verifier.disabled = true; libeller(verifier, 'Je vérifie…');
      try {
        await verifierCle({ cle, fetch: ctx.fetch, modele: ctx.reglages().modeles?.correction || undefined });
        ctx.definirCles({ gemini: cle }); input.value = '';
        message(zone, 'Gemini répond : clé enregistrée.', 'ok');
      } catch (e) {
        if (e?.code === 'quota') { ctx.definirCles({ gemini: cle }); input.value = ''; message(zone, 'Clé valide, mais la limite gratuite est atteinte pour l\'instant.', 'info'); }
        else message(zone, e?.code === 'cle' ? 'Google refuse cette clé. Recopie-la depuis AI Studio.' : e?.message || 'Gemini ne répond pas.');
      } finally { verifier.disabled = false; libeller(verifier, 'Vérifier'); maj(); }
    } });
    maj();
    return h('div', { class: 'bloc-cle' }, etat, bloc, h('div', { class: 'rang-boutons' }, retirer, verifier), zone,
      h('p', { class: 'aide' }, 'Pour en obtenir une : ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer', text: 'AI Studio' }), ', « Create API key ».'));
  }

  // --- Ordre des paquets ---
  function blocOrdre() {
    const liste = h('ol', { class: 'ordre-paquets' });
    const dessiner = () => {
      const d = ctx.donnees();
      const ordre = d.ordre;
      vider(liste, ordre.map((id, i) => h('li', { class: 'ordre-paquets__ligne' },
        h('span', { class: 'ordre-paquets__rang', text: String(i + 1) }),
        h('span', { class: 'ordre-paquets__nom', text: d.paquets[id]?.nom || id }),
        h('button', { type: 'button', class: 'btn-icone btn-icone--cadre', 'aria-label': `Monter ${d.paquets[id]?.nom || id}`, disabled: i === 0, onclick: () => deplacer(i, -1) }, icone('haut')),
        h('button', { type: 'button', class: 'btn-icone btn-icone--cadre', 'aria-label': `Descendre ${d.paquets[id]?.nom || id}`, disabled: i === ordre.length - 1, onclick: () => deplacer(i, 1) }, icone('bas')))));
    };
    const deplacer = (i, sens) => {
      const ordre = [...ctx.donnees().ordre];
      const j = i + sens;
      if (j < 0 || j >= ordre.length) return;
      [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
      enCours = { ...(enCours || {}), ordrePaquets: ordre };
      vidanger();
      dessiner();
      liste.querySelectorAll('.ordre-paquets__ligne')[j]?.querySelectorAll('button')[sens < 0 ? 0 : 1]?.focus();
    };
    dessiner();
    return h('div', { class: 'reglage reglage--colonne' },
      h('p', { class: 'reglage__libelle', text: 'Ordre des paquets' }),
      h('p', { class: 'aide', text: 'Les nouvelles cartes viennent d\'abord du premier.' }), liste);
  }

  // --- Voix ---
  function blocVoix() {
    const r = ctx.reglages();
    const voix = r.voix || {};
    const choix = h('select', { id: 'r-voix', class: 'champ-texte' }, h('option', { value: '', text: 'Voix française par défaut' }));
    choix.value = lireLocal(CLES.voixNom, '');
    choix.addEventListener('change', () => { ecrireLocal(CLES.voixNom, choix.value); toast('Réglage enregistré'); });
    try {
      parole = new Parole({ vitesse: voix.vitesse || 1, voixNom: lireLocal(CLES.voixNom, '') });
      if (parole.disponible) parole.voixFrancaises().then(liste => {
        for (const v of liste) choix.append(h('option', { value: v.nom, text: `${v.nom} (${v.lang})` }));
        choix.value = lireLocal(CLES.voixNom, '');
      }).catch(() => {});
    } catch { parole = null; }
    let vitesse = voix.vitesse || 1;
    const ecouter = bouton('Écouter', { icone: 'lecture', classe: 'btn--petit', onClick: async () => {
      try {
        parole?.arreter();
        parole = new Parole({ vitesse, voixNom: choix.value });
        await parole.dire('Bonjour. Je lis les questions à cette vitesse.');
      } catch { toast("La voix n'est pas disponible sur ce navigateur."); }
    } });
    return [
      h('div', { class: 'champ' }, h('label', { for: 'r-voix', class: 'champ__libelle', text: 'Voix (sur cet appareil)' }), choix),
      reglerNombre({ id: 'r-vitesse', libelle: 'Vitesse de lecture', valeur: vitesse, min: 0.5, max: 2, pas: 0.1, decimales: 1, unite: ' ×',
        onChange: v => { vitesse = v; enregistrer({ voix: { ...ctx.reglages().voix, ...(enCours?.voix || {}), vitesse: v } }); } }),
      h('div', { class: 'rang-boutons rang-boutons--gauche' }, ecouter),
      reglerNombre({ id: 'r-silence', libelle: 'Silence avant de corriger', aide: 'Combien de temps j\'attends après ta dernière parole.', valeur: voix.silence || 2.5, min: 1, max: 6, pas: 0.5, decimales: 1, unite: ' s',
        onChange: v => enregistrer({ voix: { ...ctx.reglages().voix, ...(enCours?.voix || {}), silence: v } }) }),
    ];
  }

  // --- Apparence ---
  function blocApparence() {
    const actuel = lireLocal(CLES.theme, 'auto');
    const options = [['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']];
    return h('fieldset', { class: 'segments' }, h('legend', { class: 'reglage__libelle', text: 'Thème (sur cet appareil)' }),
      h('div', { class: 'segments__rang' }, options.map(([v, libelle]) => h('label', { class: 'segment' },
        h('input', { type: 'radio', name: 'theme', value: v, checked: actuel === v, onchange: () => { ecrireLocal(CLES.theme, v === 'auto' ? '' : v); ctx.appliquerTheme(v); } }),
        h('span', { text: libelle })))));
  }

  // --- Correction (§ 9 : essai de la correction) ---
  function blocCorrection() {
    const r = ctx.reglages();
    const modeles = r.modeles || {};
    const champModele = (id, libelle, cle) => {
      const input = h('input', { id, type: 'text', class: 'champ-texte', value: modeles[cle] || '', placeholder: MODELES_DEFAUT[cle], autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      input.addEventListener('change', () => enregistrer({ modeles: { ...ctx.reglages().modeles, ...(enCours?.modeles || {}), [cle]: input.value.trim() } }));
      return h('div', { class: 'champ' }, h('label', { for: id, class: 'champ__libelle', text: libelle }), input);
    };
    const d = ctx.donnees();
    const cas = Array.isArray(d.calibration) ? d.calibration : Array.isArray(d.calibration?.cas) ? d.calibration.cas : null;
    const zone = h('div', { class: 'zone-message', 'aria-live': 'polite' });
    const tester = cas?.length ? bouton('Tester la correction', { classe: 'btn--plein', onClick: () => calibrer(cas, zone, tester) }) : null;
    return [
      h('details', { class: 'details' }, h('summary', null, 'Avancé : modèles Gemini'),
        h('p', { class: 'aide', text: 'Laisse vide pour garder le modèle conseillé.' }),
        champModele('r-modele-correction', 'Modèle de correction', 'correction'),
        champModele('r-modele-contestation', 'Modèle du second avis et des QCM', 'contestation')),
      tester ? h('div', { class: 'reglage reglage--colonne' },
        h('p', { class: 'reglage__libelle', text: 'Essai de la correction' }),
        h('p', { class: 'aide', text: `Je passe ${nb(cas.length, 'réponse')} déjà jugée${cas.length > 1 ? 's' : ''} à Gemini et je compare. Résultat enregistré pour Claude. Clé Gemini requise.` }),
        tester, zone) : null,
    ];
  }

  async function calibrer(cas, zone, btn) {
    const g = ctx.gemini();
    if (!g.cle) { message(zone, 'Ajoute d\'abord ta clé Gemini, plus haut.'); return; }
    if (!ctx.enLigne()) { message(zone, 'Pas de connexion : réessaie une fois connecté.'); return; }
    btn.disabled = true;
    const d = ctx.donnees();
    const modele = d.reglages.modeles?.correction || MODELES_DEFAUT.correction;
    const resultats = [];
    for (const [i, c] of cas.entries()) {
      message(zone, `Je teste ${i + 1} sur ${cas.length}…`, 'info');
      const entree = d.cartes[c.carte];
      if (!entree) { resultats.push({ ...c, obtenu: null, erreur: 'carte introuvable' }); continue; }
      const contexte = { carnetCarte: d.carnet?.cartes?.[c.carte] || null, abreviations: d.carnet?.abreviations || {} };
      let r = null, erreur = null;
      for (let essai = 0; essai < 2 && !r; essai++) {
        try { r = await corrigerGemini(entree.carte, c.reponse, contexte, { cle: g.cle, modele, fetch: g.fetch }); erreur = null; } catch (e) {
          erreur = e?.code || 'inconnue';
          if (e?.code === 'quota' && essai === 0) { message(zone, 'Limite de Gemini : je patiente un peu…', 'info'); await new Promise(ok => setTimeout(ok, Math.min(60000, e.attente || 20000))); }
          else if (e?.code === 'cle') { message(zone, e.message); btn.disabled = false; return; }
          else break;
        }
      }
      resultats.push({ carte: c.carte, paquet: c.paquet, reponse: c.reponse, attendu: c.attendu, obtenu: r?.verdict ?? null, confiance: r?.confiance, explication: r?.explication, erreur: erreur || undefined });
    }
    const jugees = resultats.filter(x => x.obtenu);
    const accords = jugees.filter(x => x.obtenu === x.attendu).length;
    const accord = jugees.length ? Math.round((accords / jugees.length) * 1000) / 1000 : null;
    const jour = jourParis(ctx.maintenant());
    const resultat = { jour, modele, n: cas.length, juges: jugees.length, accord, cas: resultats };
    ctx.sync.ajouter({ type: 'fichier', path: `progres/calibration/${jour}.json`, texte: JSON.stringify(resultat, null, 1) + '\n' });
    const desaccords = jugees.filter(x => x.obtenu !== x.attendu);
    vider(zone,
      h('p', { class: 'message message--ok', role: 'status' }, icone('juste'),
        h('span', { text: accord == null ? 'Gemini n\'a jugé aucune réponse.' : `Accord : ${Math.round(accord * 100)} % (${accords} sur ${jugees.length}). Résultat enregistré.` })),
      desaccords.length ? h('ul', { class: 'liste-simple liste-simple--petite' }, desaccords.map(x =>
        h('li', { text: `${x.carte} : attendu ${x.attendu}, Gemini ${x.obtenu} · « ${String(x.reponse).slice(0, 80)} »` }))) : null);
    btn.disabled = false;
  }

  // --- Données ---
  function blocDonnees() {
    const etatTexte = h('p', { class: 'etat-synchro-detail', 'aria-live': 'polite' });
    const majEtat = () => {
      const s = ctx.sync.etat;
      const derniere = s.derniereSynchro ? `Dernier échange avec le dépôt : ${jourParis(s.derniereSynchro) === jourParis(ctx.maintenant()) ? '' : jourParis(s.derniereSynchro).split('-').reverse().slice(0, 2).join('/') + ' '}${heureParis(s.derniereSynchro)}.` : '';
      vider(etatTexte, h('strong', { text: s.message || '' }), derniere ? h('span', { class: 'aide', text: ' ' + derniere }) : null);
      etatTexte.dataset.mode = s.mode;
    };
    majEtat();
    const synchroniser = bouton('Synchroniser maintenant', { classe: 'btn--plein', onClick: async () => {
      synchroniser.disabled = true;
      try { await ctx.sync.pousser('manuel'); await ctx.sync.rafraichir('manuel'); } finally { synchroniser.disabled = false; majEtat(); }
    } });

    const nom = h('input', { id: 'r-appareil', type: 'text', class: 'champ-texte', value: ctx.appareil, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '24' });
    nom.addEventListener('change', () => { ctx.definirAppareil(nom.value.replace(/[^\w-]/g, '-')); nom.value = ctx.appareil; toast('Réglage enregistré'); });

    const depot = ctx.cles().depot;
    const champ = (id, libelle, valeur) => h('div', { class: 'champ' }, h('label', { for: id, class: 'champ__libelle', text: libelle }),
      h('input', { id, type: 'text', class: 'champ-texte', value: valeur, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }));
    const zoneDepot = h('div', { class: 'zone-message', 'aria-live': 'polite' });
    const blocDepot = h('details', { class: 'details' }, h('summary', null, 'Avancé : dépôt'),
      champ('r-proprietaire', 'Propriétaire', depot.proprietaire), champ('r-depot', 'Dépôt', depot.depot),
      champ('r-branche', 'Branche', depot.branche), champ('r-racine', 'Dossier', depot.racine),
      h('div', { class: 'rang-boutons' },
        bouton('Par défaut', { discret: true, onClick: () => { ctx.definirCles({ depot: null }); message(zoneDepot, 'Dépôt par défaut rétabli.', 'ok'); for (const [k, v] of Object.entries({ 'r-proprietaire': DEPOT_DEFAUT.proprietaire, 'r-depot': DEPOT_DEFAUT.depot, 'r-branche': DEPOT_DEFAUT.branche, 'r-racine': DEPOT_DEFAUT.racine })) { const el = blocDepot.querySelector('#' + k); if (el) el.value = v; } } }),
        bouton('Enregistrer le dépôt', { classe: 'btn--plein', onClick: () => {
          const v = id => blocDepot.querySelector('#' + id).value.trim();
          const nouveau = { proprietaire: v('r-proprietaire'), depot: v('r-depot'), branche: v('r-branche') || 'main', racine: v('r-racine') };
          if (!nouveau.proprietaire || !nouveau.depot) { message(zoneDepot, 'Indique le propriétaire et le nom du dépôt.'); return; }
          ctx.definirCles({ depot: nouveau });
          message(zoneDepot, 'Dépôt enregistré : je recharge tes cartes.', 'ok');
        } })),
      zoneDepot);

    const attente = ctx.sync.etat.attente || 0;
    const effacer = boutonConfirme('Effacer les données de cet appareil',
      attente ? `Effacer ? ${nb(attente, 'réponse')} pas encore envoyée${attente > 1 ? 's' : ''} ser${attente > 1 ? 'ont' : 'a'} perdue${attente > 1 ? 's' : ''}. Touche encore.` : 'Effacer ? Rien ne sera perdu : tout est dans ton dépôt. Touche encore.',
      () => ctx.effacerAppareil(), { classe: 'btn--danger' });

    return {
      noeuds: [
        etatTexte,
        h('div', { class: 'rang-boutons rang-boutons--gauche' }, synchroniser),
        h('div', { class: 'champ' }, h('label', { for: 'r-appareil', class: 'champ__libelle', text: 'Nom de cet appareil' }), nom,
          h('p', { class: 'aide', text: 'Il apparaît dans tes réponses, pour savoir d\'où elles viennent.' })),
        blocDepot,
        h('div', { class: 'reglage reglage--colonne' },
          effacer,
          h('p', { class: 'aide', text: 'Retire les clés, le cache et les réponses en attente de cet appareil. Tes données déjà envoyées restent dans ton dépôt.' })),
      ],
      majEtat,
    };
  }

  // --- Page ---
  let donnees = null;
  let signature = '';
  const signer = () => { const d = ctx.donnees(); return JSON.stringify([d.reglages, d.ordre, !!d.calibration]); };
  function afficher() {
    signature = signer();
    const r = ctx.reglages();
    donnees = blocDonnees();
    vider(page,
      h('h1', { class: 'titre-page', text: 'Réglages' }),
      section('cles', 'Mes clés',
        h('p', { class: 'aide', text: 'Gardées seulement sur cet appareil.' }), blocJeton(), blocGemini()),
      section('rythme', 'Rythme',
        reglerNombre({ id: 'r-nouvelles', libelle: 'Nouvelles cartes par jour', aide: 'Combien de cartes jamais vues te sont proposées.', valeur: r.nouvellesParJour, min: 0, max: 200, pas: 5, onChange: v => enregistrer({ nouvellesParJour: v }) }),
        reglerNombre({ id: 'r-objectif', libelle: 'Objectif du jour', aide: 'Cartes acquises visées.', valeur: r.objectifJour, min: 5, max: 200, pas: 5, onChange: v => enregistrer({ objectifJour: v }) }),
        reglerNombre({ id: 'r-pause', libelle: 'Pause proposée toutes les', aide: '0 : jamais de pause.', valeur: r.pauseToutes, min: 0, max: 100, pas: 5, unite: ' cartes', onChange: v => enregistrer({ pauseToutes: v }) }),
        blocOrdre()),
      section('qcm', 'QCM',
        reglerNombre({ id: 'r-qcm', libelle: 'QCM par série', valeur: r.qcmParSeance, min: 1, max: 30, pas: 1, onChange: v => enregistrer({ qcmParSeance: v }) }),
        h('details', { class: 'details' }, h('summary', null, 'Avancé : barème'),
          h('p', { class: 'aide', text: 'Points pour 0, 1, 2, puis 3 erreurs ou plus.' }),
          h('div', { class: 'bareme' }, (r.baremeQcm || [1, 0.5, 0.2, 0]).map((x, i) => {
            const id = `r-bareme-${i}`;
            const input = h('input', { id, type: 'number', class: 'champ-texte champ-texte--court', value: String(x), min: '0', max: '1', step: '0.1', inputmode: 'decimal' });
            input.addEventListener('change', () => {
              const b = [...(enCours?.baremeQcm || ctx.reglages().baremeQcm || [1, 0.5, 0.2, 0])];
              const v = Math.min(1, Math.max(0, Number(String(input.value).replace(',', '.')) || 0));
              b[i] = v; input.value = String(v);
              enregistrer({ baremeQcm: b });
            });
            return h('div', { class: 'champ' }, h('label', { for: id, class: 'champ__libelle', text: i === 3 ? '3 et +' : `${i} err.` }), input);
          })))),
      section('voix', 'Voix', blocVoix()),
      section('apparence', 'Apparence', blocApparence(),
        h('div', { class: 'reglage reglage--colonne' },
          bouton('Revoir les aides de découverte', { discret: true, onClick: () => { oublierAides(); toast('Les aides réapparaîtront.'); } }))),
      section('correction', 'Correction', blocCorrection()),
      section('donnees', 'Données', donnees.noeuds),
      h('p', { class: 'version', text: `Rappel ${ctx.version} · appareil ${ctx.appareil}` }));
  }

  afficher();
  return {
    noeud: page, titre: 'Réglages',
    apres: () => {
      if (params.section) {
        const s = page.querySelector(`#reglages-${params.section}`);
        if (s) { s.scrollIntoView({ block: 'start' }); s.querySelector('h2')?.focus({ preventScroll: true }); }
      }
    },
    surEtat: () => donnees?.majEtat(),
    // Réglages arrivés d'un autre appareil (ou premier chargement) : on redessine si rien n'est en cours.
    surDonnees: () => {
      if (enCours || signer() === signature) return;
      if (page.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return;
      const y = window.scrollY;
      afficher();
      window.scrollTo(0, y);
    },
    quitter: () => { vidanger(); try { parole?.arreter(); } catch { /* rien */ } },
  };
}
