/* Retire les `!important` qui ne servent a rien — et le PROUVE.

   Chaque candidat est retire du TEXTE du fichier, puis le rendu est compare a
   la reference par tools/css-oracle.js (boites + styles calcules, 14 états x
   3 largeurs). Une moitie de candidats qui passe est adoptee en bloc ; une
   moitie qui echoue est coupee en deux, jusqu'a isoler les declarations
   reellement utiles. Aucune supposition : ce qui reste a ete mesure.

   Sont exclus d'office :
     - les regles a pseudo-classe (:hover, :focus, :active…) : un balayage
       automatique ne peut pas les exercer ;
     - @media print, jamais actif a l'ecran ;
     - les proprietes qu'une mesure prealable (npm run css:important) montre
       disputees quelque part : les garder d'office evite des heures de
       recherche pour un gain nul.

   node tools/css-bisect.js [--ecrire]                                        */
const { chromium, CHROME, releve } = require('./css-oracle');
const path = require('path'), fs = require('fs');

const FICHIER = path.resolve(__dirname, '..', 'CryoMap-prep-d300e.html');
const RAPPORT = path.resolve(__dirname, '..', 'out', 'important.json');

/* Proprietes jamais disputees d'apres tools/css-important.js. Une propriete
   raccourcie n'est candidate que si TOUTES ses sous-proprietes le sont. Ce
   filtre ne decide rien : il ne fait que reduire l'espace de recherche, et
   chaque candidat retenu est ensuite verifie par l'oracle. */
const INERTES = new Set(fs.existsSync(RAPPORT) ? JSON.parse(fs.readFileSync(RAPPORT, 'utf8')).inertes : []);
const EXPANSION = {
  gap: ['row-gap','column-gap'], flex: ['flex-grow','flex-shrink','flex-basis'],
  'flex-flow': ['flex-direction','flex-wrap'],
  'grid-column': ['grid-column-start','grid-column-end'],
  'grid-row': ['grid-row-start','grid-row-end'],
  overflow: ['overflow-x','overflow-y'],
  'white-space': ['white-space-collapse','text-wrap-mode'],
  'background-position': ['background-position-x','background-position-y'],
  transition: ['transition-property','transition-duration','transition-timing-function',
               'transition-delay','transition-behavior'],
  animation: ['animation-name','animation-duration','animation-timing-function','animation-delay',
              'animation-iteration-count','animation-direction','animation-fill-mode',
              'animation-play-state','animation-timeline','animation-range-start','animation-range-end'],
};
const REFUSES = new Set(['background','border','border-radius','margin','padding','font','outline',
  'border-top','border-bottom','border-left','border-right','border-width','border-color','border-style',
  'inset','place-content','grid-area','grid-template']);
const candidate = prop => {
  const p = String(prop).trim().toLowerCase();
  if (REFUSES.has(p) || p.startsWith('--')) return false;
  return (EXPANSION[p] || [p]).every(x => INERTES.has(x));
};
const TEMP = path.resolve(__dirname, '..', 'out', '_candidat.html');
const ecrire = process.argv.includes('--ecrire');

/* --- Repérage des candidats -------------------------------------------- */
function candidats(src) {
  const blocs = [];
  const re = /<style[^>]*>/g; let m;
  while ((m = re.exec(src))) blocs.push([m.index + m[0].length, src.indexOf('</style>', re.lastIndex)]);

  const out = [];
  for (const [deb, fin] of blocs) {
    const css = src.slice(deb, fin);
    let i = 0; const pile = [];
    while (i < css.length) {
      if (css.startsWith('/*', i)) { i = css.indexOf('*/', i) + 2; continue; }
      let j = i;
      while (j < css.length && css[j] !== '{' && css[j] !== '}') j++;
      if (j >= css.length) break;
      if (css[j] === '{') { pile.push(css.slice(i, j).trim()); i = j + 1; continue; }
      const prelude = pile[pile.length - 1] || '';
      const contexte = pile.join(' ');
      const pseudo = prelude.includes(':');
      const impression = contexte.includes('@media') && contexte.includes('print');
      if (!pseudo && !impression) {
        const corps = css.slice(i, j);
        const rd = /([-a-zA-Z]+)\s*:[^;{}]*?(\s*!\s*important)/g; let d;
        while ((d = rd.exec(corps))) {
          if (!candidate(d[1])) continue;
          const pos = d.index + d[0].length - d[2].length;
          out.push([deb + i + pos, deb + i + pos + d[2].length]);
        }
      }
      pile.pop(); i = j + 1;
    }
  }
  return out;
}

const construire = (src, plages, retirer) => {
  let out = src;
  [...retirer].map(k => plages[k]).sort((a, b) => b[0] - a[0])
    .forEach(([a, b]) => { out = out.slice(0, a) + out.slice(b); });
  return out;
};

(async () => {
  const src = fs.readFileSync(FICHIER, 'utf8');
  const plages = candidats(src);
  console.log(plages.length + ' candidats (hors pseudo-classes, @media print et propriétés disputées)');

  if (process.argv.includes('--compter')) {
    const par = {};
    for (const [a] of plages) {
      const deb = src.lastIndexOf(';', a) + 1, deb2 = Math.max(deb, src.lastIndexOf('{', a) + 1);
      const p = (src.slice(deb2, a).split(':')[0] || '').trim();
      par[p] = (par[p] || 0) + 1;
    }
    Object.entries(par).sort((x, y) => y[1] - x[1]).forEach(([p, n]) => console.log('  ' + p.padEnd(24) + n));
    return;
  }
  fs.mkdirSync(path.dirname(TEMP), { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const ref = await releve(browser, FICHIER, null);
  console.log('référence relevée : ' + Object.keys(ref.empreintes).length + ' états, ' + ref.props.length + ' propriétés');

  let essais = 0;
  const passe = async idx => {
    essais++;
    fs.writeFileSync(TEMP, construire(src, plages, idx));
    const r = await releve(browser, TEMP, ref.props);
    const ok = Object.keys(ref.empreintes).every(k => ref.empreintes[k] === r.empreintes[k]);
    process.stdout.write('  essai ' + String(essais).padStart(3) + ' — ' + String(idx.length).padStart(4) +
                         ' retirés → ' + (ok ? 'identique' : 'ÉCART') + '\n');
    return ok;
  };

  async function chercher(idx) {
    if (!idx.length) return [];
    if (await passe(idx)) return idx;
    if (idx.length === 1) return [];
    const m = idx.length >> 1;
    return (await chercher(idx.slice(0, m))).concat(await chercher(idx.slice(m)));
  }

  const gardables = await chercher(plages.map((_, k) => k));
  await browser.close();

  console.log('\n' + gardables.length + ' / ' + plages.length + ' `!important` retirables sans le moindre écart');
  console.log(essais + ' essais');
  if (ecrire) {
    fs.writeFileSync(FICHIER, construire(src, plages, new Set(gardables)));
    console.log('fichier réécrit — relancez `npm test` et `npm run shots:check`');
  }
  fs.rmSync(TEMP, { force: true });
})();
