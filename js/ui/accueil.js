// Premiers pas : un écran par étape (jeton d'accès, clé Gemini facultative, ce qui va se passer).
import { ClientGitHub } from '../github.js';
import { verifierCle } from '../gemini.js';
import { h, vider, bouton, libeller, icone, champSecret, nb } from './commun.js';

const LIEN_JETON = 'https://github.com/settings/personal-access-tokens/new';
const LIEN_GEMINI = 'https://aistudio.google.com/apikey';

function lienExterne(libelle, href) {
  return h('a', { class: 'btn btn--lien-externe', href, target: '_blank', rel: 'noopener noreferrer' },
    h('span', { class: 'btn__texte', text: libelle }), icone('lien'));
}

function points(etape) {
  return h('div', { class: 'etapes' },
    h('p', { class: 'etapes__texte', text: `Étape ${etape} sur 3` }),
    h('div', { class: 'etapes__points', 'aria-hidden': 'true' }, [1, 2, 3].map(i => h('span', { class: ['etapes__point', i <= etape && 'fait'] }))));
}

function messageJeton(e, depot) {
  switch (e?.code) {
    case 'jeton': return 'GitHub refuse ce jeton. Recopie-le en entier : il commence par github_pat_.';
    case 'introuvable': return `Ce jeton ne voit pas le dépôt « ${depot} ». Sur GitHub, ajoute-le dans « Repository access ».`;
    case 'droits': return 'Ce jeton peut lire mais pas enregistrer. Sur GitHub, mets « Contents » sur « Read and write ».';
    case 'reseau': return 'Pas de connexion. Réessaie une fois connecté.';
    default: return e?.message || "La vérification n'a pas abouti. Réessaie dans un instant.";
  }
}

function messageGemini(e) {
  switch (e?.code) {
    case 'cle': return 'Google refuse cette clé. Recopie-la depuis AI Studio, en entier.';
    case 'region': return "Gemini n'est pas ouvert depuis ce pays ou ce réseau (VPN ?). Tu peux continuer sans clé.";
    case 'reseau': return 'Pas de connexion. Réessaie une fois connecté.';
    default: return `${e?.message || 'Gemini ne répond pas.'} Réessaie dans un instant, ou passe cette étape.`;
  }
}

export function creer(ctx) {
  const racine = h('div', { class: 'page page--accueil' });
  const barre = h('div', { class: 'barre-action' });
  const noeud = h('div', { class: 'accueil' }, racine, barre);
  let etape = 1;
  let infoTrouve = null;
  let sansCle = false;

  function message(zone, texte, type = 'erreur') {
    vider(zone, texte ? h('p', { class: ['message', `message--${type}`], role: type === 'erreur' ? 'alert' : 'status' },
      icone(type === 'ok' ? 'juste' : type === 'erreur' ? 'attention' : 'info'), h('span', { text: texte })) : null);
    if (texte) requestAnimationFrame(() => zone.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  function entete(titre) {
    return [
      h('div', { class: 'accueil__haut' },
        etape > 1 ? h('button', { type: 'button', class: 'btn btn--discret btn--petit', onclick: () => { etape--; afficher(); } }, h('span', { class: 'btn__texte', text: '‹ Retour' })) : h('p', { class: 'marque-grande' }, icone('ecg'), 'Rappel'),
        points(etape)),
      h('h1', { class: 'titre-page', text: titre, tabindex: '-1' }),
    ];
  }

  function etape1() {
    const depot = ctx.cles().depot;
    const { bloc, input } = champSecret({ id: 'jeton', libelle: "Jeton d'accès", valeur: ctx.cles().jeton, placeholder: 'github_pat_…',
      aide: "Il reste sur cet appareil et ne sert qu'à parler à GitHub." });
    const zone = h('div', { class: 'zone-message', 'aria-live': 'polite' });
    infoTrouve = h('p', { class: 'aide', 'aria-live': 'polite' });
    let ok = false;
    const principal = bouton('Vérifier', { principal: true, onClick: verifier });
    input.addEventListener('input', () => { if (ok) { ok = false; libeller(principal, 'Vérifier'); } message(zone, ''); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); principal.click(); } });

    async function verifier() {
      if (ok) { etape = 2; afficher(); return; }
      const jeton = input.value.trim().replace(/\s+/g, '');
      if (!jeton) { message(zone, 'Colle d\'abord le jeton dans le champ.'); input.focus(); return; }
      principal.disabled = true;
      libeller(principal, 'Je vérifie…');
      message(zone, '');
      try {
        const client = new ClientGitHub({ jeton, proprietaire: depot.proprietaire, depot: depot.depot, branche: depot.branche, fetch: ctx.fetch });
        const r = await client.verifier();
        if (r && r.ecriture === false) throw { code: 'droits' };
        ctx.definirCles({ jeton });
        ok = true;
        message(zone, `Jeton accepté : Rappel peut lire et enregistrer dans « ${depot.depot} ».`, 'ok');
        libeller(principal, 'Continuer');
        majTrouve();
      } catch (e) {
        message(zone, messageJeton(e, depot.depot));
        libeller(principal, 'Vérifier');
      } finally {
        principal.disabled = false;
      }
    }

    vider(racine,
      entete('Relier tes cartes'),
      h('p', { class: 'chapeau', text: `Bienvenue. Rappel lit tes cartes et enregistre tes réponses dans ton dépôt GitHub « ${depot.depot} ». Il lui faut un jeton d'accès : un mot de passe limité à ce dépôt, créé une seule fois, le même sur tous tes appareils.` }),
      h('ol', { class: 'marche' },
        h('li', null, 'Touche ', h('strong', { text: 'Créer le jeton sur GitHub' }), ' (connecte-toi si besoin).'),
        h('li', null, h('strong', { text: '« Token name »' }), ' : Rappel. ', h('strong', { text: '« Expiration »' }), ' : la plus longue possible.'),
        h('li', null, h('strong', { text: '« Repository access »' }), ' : « Only select repositories », puis ', h('strong', { text: depot.depot }), '.'),
        h('li', null, h('strong', { text: '« Permissions »' }), ' : « Contents » sur « Read and write ». Puis « Generate token » : copie-le et garde-le (gestionnaire de mots de passe), il resservira sur tes autres appareils.')),
      lienExterne('Créer le jeton sur GitHub', LIEN_JETON),
      bloc, zone, infoTrouve,
      h('p', { class: 'aide', text: 'Déjà créé sur un autre appareil ? Colle ici le même jeton. Perdu ? GitHub ne le remontre jamais : sur GitHub, « Regenerate token », puis colle le nouveau sur chaque appareil.' }));
    vider(barre, principal);
  }

  function majTrouve() {
    if (!infoTrouve) return;
    const d = ctx.donnees();
    const paquets = Object.keys(d.paquets).length;
    const cartes = Object.keys(d.cartes).length;
    infoTrouve.textContent = paquets ? `Trouvé : ${nb(paquets, 'paquet')}, ${nb(cartes, 'carte')}.` : (ctx.cles().jeton ? 'Je récupère tes cartes…' : '');
  }

  function etape2() {
    const { bloc, input } = champSecret({ id: 'cle-gemini', libelle: 'Clé Gemini', valeur: ctx.cles().gemini, placeholder: 'AQ.…',
      aide: "Elle reste sur cet appareil et ne sert qu'à parler à Google." });
    const zone = h('div', { class: 'zone-message', 'aria-live': 'polite' });
    let ok = false;
    const principal = bouton('Vérifier', { principal: true, onClick: verifier });
    const plusTard = bouton('Plus tard', { onClick: () => { sansCle = !ctx.cles().gemini; etape = 3; afficher(); } });
    input.addEventListener('input', () => { if (ok) { ok = false; libeller(principal, 'Vérifier'); } message(zone, ''); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); principal.click(); } });

    async function verifier() {
      if (ok) { sansCle = false; etape = 3; afficher(); return; }
      const cle = input.value.trim();
      if (!cle) { message(zone, 'Colle d\'abord la clé dans le champ, ou touche « Plus tard ».'); input.focus(); return; }
      // Vérifié sur place : un identifiant de projet collé par erreur donnerait un refus peu parlant.
      if (!/^(AQ\.|AIza)/.test(cle)) { message(zone, 'Ce n\'est pas une clé Gemini : elle commence par AQ. Recopie-la depuis AI Studio.'); input.focus(); return; }
      principal.disabled = true;
      libeller(principal, 'Je vérifie…');
      try {
        await verifierCle({ cle, fetch: ctx.fetch });
        ctx.definirCles({ gemini: cle });
        ok = true;
        message(zone, 'Gemini répond : la correction intelligente est prête.', 'ok');
        libeller(principal, 'Continuer');
      } catch (e) {
        if (e?.code === 'quota') {
          ctx.definirCles({ gemini: cle });
          ok = true;
          message(zone, 'Clé valide, mais la limite gratuite est atteinte pour l\'instant. Elle marchera plus tard.', 'info');
          libeller(principal, 'Continuer');
        } else {
          message(zone, messageGemini(e));
          libeller(principal, 'Vérifier');
        }
      } finally {
        principal.disabled = false;
      }
    }

    vider(racine,
      entete('Correction par Gemini'),
      h('p', { class: 'surtitre', text: 'Facultatif' }),
      h('p', { class: 'chapeau', text: "Avec une clé Gemini (gratuite), ta réponse est jugée sur le sens : fautes, abréviations et dictée passent. Sans clé, ton appareil corrige en cherchant les idées clés : c'est moins fin." }),
      h('ol', { class: 'marche' },
        h('li', null, 'Touche ', h('strong', { text: 'Obtenir une clé' }), ' (compte Google).'),
        h('li', null, 'Touche « Create API key ». Si on te demande un projet, choisis d\'en créer un (gratuit, sans carte bancaire).'),
        h('li', null, 'Copie la clé (elle commence par AQ.) et colle-la ici.')),
      lienExterne('Obtenir une clé sur AI Studio', LIEN_GEMINI),
      bloc, zone);
    vider(barre, h('div', { class: 'barre-action__rang' }, plusTard, principal));
  }

  function etape3() {
    vider(racine,
      entete("C'est parti"),
      h('ul', { class: 'liste-etapes' },
        h('li', null, icone('boucle'), h('span', { text: "Chaque jour : tes révisions d'abord, puis tes nouvelles cartes." })),
        h('li', null, icone('fiche'), h('span', { text: 'Avant de nouvelles cartes, tu lis leur micro-fiche (1 min).' })),
        h('li', null, icone('micro'), h('span', { text: 'Tu réponds en écrivant ou en dictant. Réponse dans ta tête ? « Voir la réponse », et tu te notes.' })),
        h('li', null, icone('juste'), h('span', { text: 'Je corrige : Juste, Partiel ou Faux. Pas d\'accord ? « Je conteste ».' })),
        h('li', null, icone('soleil'), h('span', { text: `Objectif : ${ctx.objectif()} nouvelles cartes par jour, et toutes les révisions du jour.` }))),
      sansCle ? h('p', { class: 'aide', text: 'Sans clé Gemini, la correction se fait sur ton appareil. Tu pourras ajouter la clé dans Réglages.' }) : null);
    vider(barre, bouton('Voir ma séance du jour', { principal: true, onClick: () => ctx.aller('aujourdhui') }));
  }

  function afficher() {
    infoTrouve = null;
    if (etape === 1) etape1();
    else if (etape === 2) etape2();
    else etape3();
    racine.querySelector('h1')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  afficher();
  return {
    noeud, titre: 'Premiers pas', plein: true, sansEntete: true,
    surDonnees: majTrouve,
  };
}
