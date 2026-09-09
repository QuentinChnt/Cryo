# CryoMap — vidéo de démonstration (30 s)

Capture automatisée de l'app autonome `CryoMap-prep-d300e.html`, via Playwright
(Chromium visible, 1280×800), convertie en MP4.

Résultat : **`out/cryomap-demo.mp4`** — 1280×800, 30 fps, 30,000 s, H.264/yuv420p.

## Lancer la chaîne complète

```bash
npm install
node tools/build-page.js     # demo-page.html : polices intégrées en data: URI
node tools/build-seed.js     # seed.json : le jeu de données du congélateur
xvfb-run -a --server-args="-screen 0 1400x900x24" node record-demo.js
./tools/convert.sh           # out/cryomap-demo.webm -> out/cryomap-demo.mp4
```

`xvfb-run` n'est nécessaire que sur une machine sans écran ; `record-demo.js`
lance Chromium en `headless: false`, il lui faut donc un serveur X.

## Le scénario

| Temps | Beat |
|---|---|
| 0–4 s | onglet Carte, le plan du congélateur, sans interaction |
| 4–8 s | un rack → une boîte → un aliquot, sa fiche s'ouvre |
| 8–11 s | fermeture, recherche « DXd », ouverture de sa fiche détaillée |
| 11–15 s | onglet Tecan (préparation D300e) |
| 15–21 s | défilement de la liste « À sortir & à préparer » |
| 21–25 s | défilement jusqu'aux recettes de dilution |
| 25–30 s | retour en haut de page |

Le minutage est piloté par une horloge absolue (`at(ms)`), donc chaque action
tombe à la même seconde d'une exécution à l'autre.

## Pourquoi les deux étapes de préparation

**`tools/build-seed.js` — le jeu de données.** CryoMap garde tout son état dans
`localStorage` (`cryomap-v3` pour l'inventaire, `cryomap-prep-run-v2` pour la
prépa Tecan). Le fichier HTML fourni est une page *enregistrée* : il contient le
DOM déjà rendu, mais pas le JSON sous-jacent. Dans un profil de navigateur neuf,
l'app repart donc d'un congélateur vide — il n'y aurait rien à filmer.

Le script reconstruit un jeu de données injecté avant le premier rendu. La
**structure** est reprise telle quelle de la page enregistrée
(`tools/extract-layout.js` → `tools/zones.json`) : les 5 zones, leurs noms et
positions, la géométrie des racks, la taille de chaque boîte et son taux de
remplissage. L'app réaffiche donc exactement le même plan — mêmes compteurs par
boîte, mêmes 2539 items, même contenu du compartiment.

Les **fiches d'aliquots**, elles, ne figurent nulle part dans la page
enregistrée : elles sont regénérées, à partir du vocabulaire de molécules de
l'app elle-même (la table `DRUGDIL`). Les lots, dates, opérateurs et la
préparation D300e de démonstration sont donc **fictifs**. Le tirage est
déterministe (PRNG à graine fixe), la vidéo est reproductible.

**`tools/build-page.js` — les polices.** La page charge Inter, Newsreader et
JetBrains Mono depuis Google Fonts, plus le SDK Firebase depuis gstatic. Sans
accès direct au réseau pendant la capture, chacune de ces requêtes doit expirer
avant que `load` se déclenche (~13 s de temps mort), et l'app s'affiche entre
temps avec des polices de repli. Le script récupère les fontes une fois pour
toutes et les intègre en `data:` URI dans `demo-page.html` ; les balises
Firebase sont retirées (l'app ne s'en sert qu'une fois une config de synchro
saisie dans les Préférences).

## Notes d'implémentation

- **Curseur** : Playwright émet de vrais événements CDP, mais le curseur système
  n'est pas dans l'enregistrement. La page dessine donc le sien
  (`CURSOR_JS`), et les déplacements sont interpolés pour rester lisibles.
- **Horloge** : les gestes sont pilotés au temps réel, pas à un nombre d'étapes —
  un aller-retour CDP coûte plus qu'une frame, une boucle à pas fixe dériverait.
- **Clics vérifiés** : `clickUntil()` confirme l'effet attendu et retombe sur un
  clic direct si le clic pointeur a été avalé (recouvrement en cours de
  disparition, re-rendu entre la lecture de la boîte et l'appui).
- **Amorce** : l'enregistrement démarre à la création de la page, donc avant le
  scénario. `record-demo.js` écrit cette avance dans `out/capture.json` et
  `tools/convert.sh` la coupe.

## Fichiers

| | |
|---|---|
| `CryoMap-prep-d300e.html` | l'app fournie, inchangée |
| `record-demo.js` | la capture |
| `tools/build-page.js` | polices intégrées → `demo-page.html` |
| `tools/build-seed.js` | jeu de données → `seed.json` |
| `tools/extract-layout.js` | plan du congélateur lu dans la page → `tools/zones.json` |
| `tools/convert.sh` | `.webm` → `.mp4` |
| `out/cryomap-demo.mp4` | la vidéo |
