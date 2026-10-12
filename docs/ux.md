# Rappel 2 — choix d'ergonomie

Synthèse de trois maquettes (premier usage ; usage quotidien à une main ; concentration et accessibilité). Base : la maquette « usage quotidien » (zone du pouce, un bouton principal au même endroit), complétée par les meilleures idées des deux autres. En cas de doute, le plus simple a gagné.

## Règles

1. **Un écran, une action principale**, en bas, sous le pouce, toujours au même endroit (Commencer, Corriger, Suivant). Son libellé dit ce qui va se passer (« Commencer · 64 cartes »).
2. **Le clavier ne cache jamais** le champ ni le bouton principal : barre d'action fixée au-dessus du clavier (`interactive-widget=resizes-content`, et `visualViewport` pour iOS).
3. **Dire ce que ça compte** : chaque verdict donne son effet sur le compteur (« +1 acquise : 18/30 », « Ne compte pas encore ») et quand la carte revient.
4. **Ne jamais culpabiliser** : pas de rouge pour un jour sous l'objectif, « Je ne sais pas » donne un bandeau neutre (« Voici la réponse »).
5. **Ce qui manque d'abord** : faux → réponse attendue en premier ; partiel → « Ce qui manquait » en premier ; juste → une ligne, détails repliés.
6. **Jamais la couleur seule** : icône + mot pour chaque verdict, case cochée, onglet actif ; contraste AA dans les deux thèmes.
7. **Ne jamais bloquer la révision** : hors ligne, jeton expiré ou Gemini muet, on révise ; l'envoi se fait plus tard.
8. **Chaque erreur dit quoi faire**, à côté de ce qui a échoué, avec le bouton qui mène où ça se corrige.
9. **L'irréversible en deux appuis** (« Terminer », « Arrêter », « Retirer », « Effacer »), avec ce qui sera perdu.
10. **Pas de geste caché** : tout se fait au toucher ou au clavier (Entrée, Maj+Entrée, Ctrl+Entrée, 1-2-3, A-E, Échap) ; le retour du téléphone recule d'un pas.

## Mots affichés

| On écrit | Sens | Jamais |
|---|---|---|
| carte, paquet | une question ; les cartes d'un cours | flashcard, deck |
| micro-fiche (fiche) | l'essentiel d'un cours | — |
| révision, nouvelle carte | carte déjà vue qui revient ; jamais vue | review, due |
| acquise | dernière réponse du jour juste ou partielle | validée |
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
- **Carte** : un seul bouton principal dont le libellé suit le champ (vide → « Voir la réponse », rempli → « Corriger ») ; « Je ne sais pas » à côté. Entrée corrige aussi (Maj+Entrée : à la ligne) ; Entrée sur un champ vide ne dévoile pas la réponse.
- **Auto-évaluation** (« Voir la réponse ») : la note (Non / En partie / Je l'avais, touches 1-2-3) passe directement à la carte suivante, avec un message bref.
- **Verdict** : ordre selon le verdict ; « Je conteste » à côté du badge du correcteur, seulement pour Partiel ou Faux corrigés par une machine, avec clé et réseau ; objectif atteint signalé dans le verdict, sans fenêtre.
- **Séance** : l'en-tête (compteur, état d'envoi) reste visible ; la barre « Terminer · Carte 3 sur 64 » est dessous. Fin : un seul bouton principal selon la situation (continuer, réviser en avance, QCM, retour).
- **Aujourd'hui** : ligne d'objectif (« encore 13 : cette séance peut suffire ») ; pastilles sous « Un seul paquet ? », seulement si deux paquets ou plus ont des cartes ; sans rien à faire, « Réviser en avance » est le bouton principal tant que l'objectif n'est pas atteint.
- **QCM** : « ils ne comptent pas dans tes cartes acquises » ; liste des cours repliée sous « Choisir un cours » ; série en plein écran ; « Valider » toujours actif (une réponse vide se note par erreurs).
- **État d'envoi** : le message de la synchro est affiché tel quel, avec un point de couleur ; une erreur qui demande d'agir ajoute un bandeau sur Aujourd'hui avec « Ouvrir Réglages ».
- **Réglages** : section « Apparence » (thème de l'appareil) et « Revoir les aides de découverte ».
- **Mains libres** : présentation la première fois ; bouton Pause calme (pas rouge) ; pause automatique quand l'appli passe en arrière-plan.
- **Toasts** : en haut, sous l'en-tête, jamais sur la zone du pouce.
- **Non retenus** (plus simple) : reprise exacte d'une séance après fermeture, minuteur de pause, sons de repère, texte « grand », balayages.
- **Technique** : la seule valeur posée dynamiquement en CSS est `--clavier` (hauteur du clavier, par le CSSOM, autorisé par la CSP) ; les barres de progression sont des `<progress>`.
