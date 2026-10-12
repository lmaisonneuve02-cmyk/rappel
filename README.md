# Rappel

Cartes de révision pour les études de médecine : rappel actif, espacement (FSRS), correction des réponses par Gemini qui apprend de chaque cas, micro et mode mains libres, QCM au format de la fac.

Appli web statique, sans compilation : `index.html` et des modules ES dans `js/`. Elle s'installe sur l'écran d'accueil et marche hors ligne.

- Les cartes et la progression vivent dans un dépôt privé séparé, lu et écrit par l'API GitHub avec un jeton à accès fin que l'on colle dans l'appli.
- La clé Gemini et le jeton restent sur l'appareil (stockage local du navigateur) et ne partent que vers leur service.
- Ce dépôt ne contient que le code : aucune clé, aucune donnée personnelle.

Conception : `docs/conception.md`. Ergonomie : `docs/ux.md`.

## Tests

```
npm install            # Playwright, pour les tests de bout en bout
npm test               # tests unitaires (node --test)
npm run test:e2e       # parcours complets dans Chromium, services simulés
node outils/verifier-donnees.mjs <dossier rappel/ des données> --exiger-baremes
```
