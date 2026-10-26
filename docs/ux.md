# Rappel 2 — choix d'ergonomie

Synthèse de trois maquettes (premier usage ; usage quotidien à une main ; concentration et accessibilité). Base : la maquette « usage quotidien » (zone du pouce, un bouton principal au même endroit), complétée par les meilleures idées des deux autres. En cas de doute, le plus simple a gagné.

## Règles

1. **Un écran, une action principale**, en bas, sous le pouce, toujours au même endroit (Commencer, Corriger, Suivant). Son libellé dit ce qui va se passer (« Commencer · 64 cartes »).
2. **Le clavier ne cache jamais** le champ ni le bouton principal : barre d'action fixée au-dessus du clavier (`interactive-widget=resizes-content`, et `visualViewport` pour iOS).
3. **Dire ce que ça compte** : chaque verdict donne son effet sur le compteur (« +1 carte : 18/60 », « Déjà comptée aujourd'hui : 18/60 ») et quand la carte revient.
4. **Ne jamais culpabiliser** : pas de rouge pour un jour sous l'objectif, « Je ne sais pas » donne un bandeau neutre (« Voici la réponse »).
5. **Ce qui manque d'abord** : faux → réponse attendue en premier ; partiel → « Ce qui manquait » en premier ; juste → une ligne, détails repliés.
6. **Jamais la couleur seule** : icône + mot pour chaque verdict, case cochée, onglet actif ; contraste AA dans les deux thèmes.
7. **Ne jamais bloquer la révision** : hors ligne, jeton expiré ou Gemini muet, on révise ; l'envoi se fait plus tard.
8. **Chaque erreur dit quoi faire**, à côté de ce qui a échoué, avec le bouton qui mène où ça se corrige.
9. **L'irréversible en deux appuis** (« Terminer », « Arrêter », « Retirer », « Effacer »), avec ce qui sera perdu.
10. **Pas de geste caché** : tout se fait au toucher ou au clavier (Entrée, Maj+Entrée, Ctrl+Entrée, 1-2-3, A-E, Échap) ; le retour du téléphone recule d'un pas.

## Objectif du jour (règle du 16 oct. 2026)

Décision explicite de l'utilisateur ; elle remplace la règle du 15 oct. (« N nouvelles cartes et toutes les révisions du jour, nouvelles cartes d'abord »). Détail : `conception.md`, § 0.

- **Objectif : 60 cartes par jour** (réglage `objectifJour` ; 80 après un contrôle du mercredi sous 15/20 : l'appli lit le réglage), révisions d'abord, puis des nouvelles pour compléter.
- Une carte compte une fois, même si elle revient après une erreur ; les révisions en avance comptent ; les QCM et les contestations ne comptent pas ; le compte repart à zéro à minuit (heure de Paris).
- Atteint quand il y a assez de cartes **et** assez de révisions (autant que l'objectif, ou toutes celles du jour s'il y en a moins), ou quand il ne reste plus rien à proposer.
- Jamais plus exigé : au-delà, rien n'est demandé ; « Nouvelles cartes par jour » est un plafond. Le 16 oct., jour du changement, seul le total compte (règle notée par l'utilisateur).
- En-tête : « Cartes : 53/60 · Révisions : 61 » (révisions restantes, omises à 0), ✓ après les cartes quand c'est atteint ; sur téléphone, « Révisions : 61 » passe sous les cartes (sinon le compteur recouvre « Rappel ») ; touché, il ouvre « Comment on compte ».

## Mots affichés

| On écrit | Sens | Jamais |
|---|---|---|
| carte, paquet | une question ; les cartes d'un cours | flashcard, deck |
| micro-fiche (fiche) | l'essentiel d'un cours | — |
| révision, nouvelle carte | carte déjà vue qui revient ; jamais vue | review, due |
| cartes du jour | cartes distinctes répondues aujourd'hui, nouvelles et révisions (une carte compte une fois) | acquises, validées |
| séance | — | session |
| texte à trous, blanc | — | cloze |
| Juste / Partiel / Faux | verdict | — |
| revient dans… | prochaine révision | intervalle, échéance |
| jeton d'accès (GitHub), clé Gemini | les deux codes à coller | token, API |
| enregistré, en attente d'envoi | état de l'envoi | synchro, commit, push |
| corrigé sur l'appareil, second avis, « Je conteste » | correction locale ; contestation | — |
| erreur (QCM) | case cochée à tort ou oubliée | discordance |

Tutoiement, phrases courtes, verbes d'action sur les boutons. Aucun de : FSRS, SRS, cloze, token, API, JSON.

## Écarts avec la conception (§ 4)

- **Premiers pas** : un écran par étape (« Étape 1 sur 3 »), pas trois blocs empilés.
- **Carte** : toujours répondre avant de voir la correction (décision du 26 oct. 2026). Bouton principal « Corriger » ; champ vide : il rappelle d'écrire ou de toucher « Je ne sais pas » (faux, la carte revient). « Indice » sous le champ : première idée réduite à l'initiale de chaque mot ; la réponse vaut alors au mieux « partiel » (ligne du journal marquée `indice: true`, contestation impossible sur ce partiel). Entrée corrige aussi (Maj+Entrée : à la ligne). Plus d'auto-évaluation (« Voir la réponse » et « Je l'avais » supprimés).
- **Verdict** : ordre selon le verdict ; « Je conteste » à côté du badge du correcteur, seulement pour Partiel ou Faux corrigés par une machine, avec clé et réseau ; objectif atteint signalé dans le verdict, sans fenêtre.
- **Séance** : l'en-tête (compteur, état d'envoi) reste visible ; la barre « Terminer · Carte 3 sur 64 » est dessous. Fin : un seul bouton principal selon la situation (continuer, « Continuer · Tout (N) » après un seul paquet, réviser en avance, QCM, retour).
- **Aujourd'hui** : ligne d'objectif (« Objectif : encore 13 cartes (dont 5 révisions). Cette séance peut suffire. ») ; « révisions d'abord » sous les chiffres ; cartes ratées qui reviennent à part (« 4 ratées à revoir », déjà comptées) ; pastilles sous « Un seul paquet ? », seulement si deux paquets ou plus ont des cartes ; un paquet qui ne peut pas apporter ce qui manque : « Ce paquet ne suffit pas : choisis « Tout ». » et « Commencer · Tout (N) » en principal ; sans rien à faire, « Réviser en avance » est le bouton principal tant que l'objectif n'est pas atteint (les révisions en avance comptent ; jamais une carte déjà répondue aujourd'hui).
- **QCM** : « ils ne comptent pas dans tes cartes du jour » ; liste des cours repliée sous « Choisir un cours » ; série en plein écran ; « Valider » toujours actif (une réponse vide se note par erreurs).
- **État d'envoi** : le message de la synchro est affiché tel quel, avec un point de couleur ; une erreur qui demande d'agir ajoute un bandeau sur Aujourd'hui avec « Ouvrir Réglages ».
- **Réglages** : section « Apparence » (thème de l'appareil) et « Revoir les aides de découverte ».
- **Mains libres** : présentation la première fois ; bouton Pause calme (pas rouge) ; pause automatique quand l'appli passe en arrière-plan.
- **Toasts** : en haut, sous l'en-tête, jamais sur la zone du pouce.
- **Non retenus** (plus simple) : reprise exacte d'une séance après fermeture, minuteur de pause, sons de repère, texte « grand », balayages.
- **Technique** : la seule valeur posée dynamiquement en CSS est `--clavier` (hauteur du clavier, par le CSSOM, autorisé par la CSP) ; les barres de progression sont des `<progress>`.
