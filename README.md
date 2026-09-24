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
| `tests/regression.js` | 100 cas de régression |
| `tests/fake-firestore.js` | Firestore en mémoire, avec écoute temps réel |
| `tests/shots.sha256` | empreintes des 27 captures de référence |
| `tools/shots.js` | les captures |
| `tools/shots-check.js` | comparaison aux empreintes |
| `tools/css-oracle.js` | « ces deux fichiers rendent-ils la même chose ? » |
| `tools/css-important.js` | quelles propriétés `!important` sont disputées |
| `tools/css-bisect.js` | retrait vérifié des `!important` inutiles |

---

# CryoMap — synchronisation d'équipe et stockage

## Donner accès à un collègue

L'app est un fichier HTML autonome. Un collègue y accède en ouvrant le même
fichier (ou la même URL si tu l'héberges), puis en saisissant dans
**Préférences → Synchronisation** la *même configuration Firebase* et le
*même nom de salle* que toi. À partir de là, tout est partagé et se met à
jour en direct : stock, emplacements, plan du congélateur, journal.

## ⚠️ Règles Firestore à mettre à jour

La synchro n'écrit plus un document unique mais **un document par entité**
(voir plus bas). Les règles doivent donc couvrir les **sous-collections** :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /cryomap/{room}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

L'ancienne forme `match /cryomap/{room}` ne suffit plus : elle ne s'applique
qu'au document de tête, pas aux sous-collections. Sans cette mise à jour la
synchro s'arrête sur un « Accès refusé » — l'app affiche alors le message
avec la règle à poser.

L'authentification anonyme doit rester activée
(*Firebase → Authentication → Sign-in method → Anonymous*).

## Modèle de données synchronisé

```
cryomap/{salle}                    schéma, horodatage
cryomap/{salle}/reagents/{id}      un aliquot
cryomap/{salle}/inventory/{id}     un consommable
cryomap/{salle}/history/{id}       une ligne de journal
cryomap/{salle}/meta/freezers      le plan des congélateurs
cryomap/{salle}/meta/preferences   les préférences partagées
cryomap/{salle}/meta/prep          la prépa D300e partagée
```

Pourquoi ce découpage, mesuré à 2 563 aliquots :

| | avant (document unique) | après (un par entité) |
|---|---|---|
| taille du plus gros document | 871 531 o — **83 % de la limite de 1 MiB** | 3 007 o |
| plafond de fonctionnement | ~3 100 aliquots, puis panne | aucun |
| déplacer un aliquot écrit | 848 Ko | 340 o |
| deux personnes en même temps | la seconde **écrase tout** le travail de la première | chacune garde le sien |

La migration depuis l'ancien format est automatique : au premier lancement
connecté, l'app réécrit l'état en sous-collections, marque `schema: 2` et
retire l'ancien champ. Rien à faire à la main.

### Coût en lectures

Le quota gratuit de Firestore est de **50 000 documents lus par jour**, tous
postes confondus. L'app ouvrait la salle en deux temps : quatre `.get()`
complets, puis quatre `onSnapshot` qui relisaient chacun sa collection
entière. Chaque ouverture d'onglet coûtait donc **deux fois** le contenu de
la salle — environ 5 000 lectures à 2 563 aliquots, soit dix ouvertures par
jour avant épuisement du quota (et l'arrêt de la synchro jusqu'à minuit UTC).

Le premier message d'un `onSnapshot` porte déjà tous les documents : `fbBootstrap()`
amorce l'état avec lui et garde l'écoute. Coût divisé par deux, comportement
identique. Un cas de régression le verrouille : ouvrir l'app ne doit déclencher
**aucune** lecture de collection entière.

## Stockage local

`IndexedDB` est le magasin de référence ; `localStorage` n'est qu'un miroir,
pour la lecture synchrone au démarrage et pour la détection multi-onglets.

C'était nécessaire : `localStorage` plafonne à ~5 Mo par origine et l'état
plus ses sauvegardes atteignaient 3,8 Mo à 2 563 aliquots. Au-delà,
l'écriture échouait, un toast passait trois secondes, et l'application
continuait avec des données jamais enregistrées — un rechargement perdait
tout. Aujourd'hui : IndexedDB n'a pas ce plafond, un état plus récent y est
repris automatiquement au démarrage si le miroir a saturé, et si les *deux*
magasins échouent un **bandeau rouge permanent** le dit au lieu d'un toast.

Les sauvegardes automatiques y vivent aussi : 10 points de retour au lieu de
3, sélectionnables dans « Restaurer une sauvegarde ».

**Avant un écrasement forcé**, le contenu du cloud est déposé dans cette même
liste (« Cloud avant écrasement »). La fenêtre de confirmation chiffre ce qui
va disparaître — *cloud : 2 563 aliquots · ce poste : 12* — et avertit
explicitement quand ce poste en a moins que le cloud. Auparavant le bouton
remplaçait la salle en un clic, sans rien annoncer et sans retour possible.

**L'annulation survit au rechargement.** La pile de `Ctrl+Z` ne vivait qu'en
mémoire, alors que les points de retour correspondants étaient déjà dans
IndexedDB. Elle est réamorcée avec eux au démarrage, sans un octet de
stockage supplémentaire (les chaînes sont partagées).

## Stockage de la préparation D300e

Les protocoles `.tdd` mémorisés (`cryomap-tdd-files-v1`) et le run en cours
(`cryomap-prep-run-v2`) ne vivaient que dans `localStorage`, dont le quota est
partagé avec l'inventaire complet : l'écriture pouvait être refusée en
silence, et la bibliothèque de protocoles disparaissait sans un mot. Même
modèle que l'état principal désormais : IndexedDB en magasin de référence,
`localStorage` en miroir synchrone pour l'affichage immédiat, reprise
automatique de la version la plus récente au démarrage.

Le run en cours n'est repris que si rien n'a été saisi entre-temps : une
version de secours ne doit jamais écraser un travail en cours.

La bibliothèque `.tdd` voyage aussi avec l'export JSON — sans jamais entrer
dans l'état synchronisé, car elle est locale au poste.

## Tests

```bash
npm install
npm test                 # 100 cas de régression, Playwright
```

Chaque cas reproduit un bug réellement observé avant de vérifier sa
correction. La synchro est testée contre `tests/fake-firestore.js`, un
Firestore en mémoire qui permet de simuler un collègue écrivant en même
temps — donc de vérifier la fusion et le temps réel sans réseau.

Sur une machine sans Chromium par défaut :
`CHROMIUM_PATH=/chemin/vers/chromium npm test`

`APP_FILE=autre.html npm test` fait tourner la même suite sur une autre
variante du fichier, sans toucher au harnais.

### Garde-fou visuel

```bash
npm run shots         # 27 captures (9 vues x 3 largeurs) dans out/shots
npm run shots:check   # les compare aux empreintes de tests/shots.sha256
npm run shots:ref     # régénère les empreintes, après vérification à l'œil
```

Le CSS pèse ~4 800 lignes et repose sur beaucoup de `!important` : le modifier
à l'aveugle était risqué. Ces empreintes transforment « risqué » en
« vérifiable » — toute règle qui déplace un pixel, dans l'une des neuf vues et
à l'une des trois largeurs (1440 / 880 / 420 px, choisies de part et d'autre
des points de rupture), est signalée nommément.

Les captures sont déterministes : même jeu de données figé, mêmes dates, aucun
identifiant aléatoire. Deux exécutions successives donnent des fichiers
identiques au pixel près.

### Nettoyage du CSS, mesuré

```bash
npm run css:important   # quelles propriétés !important sont disputées ?
node tools/css-bisect.js [--ecrire]
```

`tools/css-oracle.js` répond à une seule question : **deux versions du fichier
rendent-elles exactement la même chose ?** Il relève, pour chaque élément de
chaque état à chaque largeur, sa boîte et la valeur calculée de toutes les
propriétés concernées. `css-bisect` s'en sert pour retirer les `!important`
un lot à la fois : un lot qui passe est adopté en bloc, un lot qui échoue est
coupé en deux jusqu'à isoler les déclarations réellement utiles.

Résultat mesuré : **155 des 1 002 `!important` retirés** en 75 essais, sans le
moindre écart ; 12 candidats conservés parce qu'ils changent vraiment quelque
chose — dont `.freezer-grid { gap: 14px !important }`, sans lequel la grille
de l'aperçu se décale de 4 px. S'y ajoutent **50 règles mortes supprimées** et
18 listes de sélecteurs élaguées (31 classes citées par le CSS n'existent nulle
part ailleurs dans le fichier), soit 5,9 Ko.

Les 847 `!important` restants ne sont pas du bruit : ils portent en majorité
sur `background`, `color`, `padding`, `border`, `width` et `font-size`, où des
règles concurrentes se disputent réellement le même élément. Les retirer
demanderait de restructurer la cascade — une refonte, pas un nettoyage.

> Une première tentative avait basculé les `!important` via le CSSOM plutôt que
> dans le texte du fichier. Cette méthode déclarait inoffensives des
> modifications qui ne l'étaient pas : c'est la comparaison de captures qui a
> rattrapé l'erreur. D'où l'oracle actuel, qui mesure toujours le rendu réel
> d'un fichier réellement modifié.

### Compatibilité navigateurs

Seul Chromium est installé dans le conteneur de test : les contrôles se font
donc sur la **source**, et empêchent la réapparition des constructions qui ne
marchent que sur un moteur.

| Contrôle | Pourquoi |
|---|---|
| `backdrop-filter` toujours doublé de `-webkit-backdrop-filter` | Safari n'accepte la forme sans préfixe qu'à partir de la 18 ; sans lui les panneaux perdent leur flou |
| `user-select` toujours doublé de `-webkit-user-select` | idem depuis Safari 17 ; sans lui les libellés redeviennent sélectionnables en plein glisser-déposer |
| aucun sélecteur `:has()` | absent de Firefox avant la 121 |
| aucune expression régulière à rétro-assertion | absente de Safari avant la 16.4 |
| aucune API JS trop récente pour Safari 15 | `structuredClone`, `requestIdleCallback`, `crypto.randomUUID`, `Object.hasOwn`, `findLast`, `toSorted`, `AbortSignal.timeout` |
| l'API fichier locale reste détectée avant usage | `showSaveFilePicker` n'existe que sur Chromium |

L'audit initial a trouvé trois `backdrop-filter` et trois `user-select` sans
préfixe, et un `:has()` remplacé par le sélecteur d'identifiant équivalent.

### Le moteur D300e

`tests/fixtures/run-demo.tdd` est un protocole complet (2 plaques, 8 fluides
DMSO et aqueux, dose-réponse 8 points, normalisation par backfill). La suite
l'importe par le vrai chemin de l'interface et compare les charges obtenues à
des valeurs **recalculées indépendamment** depuis la spécification écrite dans
le code : 2 / 2 / 2 / 2 / 2,8 / 2,8 / 4 / 4 µL, véhicules DMSO 99 µL et
Tween 14 µL.

Portée exacte de cette vérification : elle valide *l'implémentation contre sa
spécification*. Elle ne valide pas *la spécification contre le vrai
dispenseur* — cela demanderait un rapport D300eControl réel à comparer, fluide
par fluide.
