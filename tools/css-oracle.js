/* Oracle fidele : deux fichiers rendent-ils EXACTEMENT la meme chose ?

   Pour chaque etat de l'application et chaque largeur, on releve, sur chaque
   element : sa boite (position et taille) et la valeur calculee de toutes les
   proprietes que le CSS declare quelque part en `!important`. Le tout est
   condense en une empreinte par etat.

   Contrairement a une bascule `!important` faite via le CSSOM, ce releve voit
   exactement ce que voit le navigateur apres une modification du TEXTE du
   fichier — c'est la seule facon fiable de valider un remaniement CSS. Une
   bascule CSSOM avait declare inoffensive une modification qui decalait la
   grille de l'apercu de 4 px.                                                */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

/* Sans le try/catch, l'absence de /opt/pw-browsers faisait planter l'outil au
   lieu de laisser Playwright utiliser son navigateur par défaut. */
const CHROME = process.env.CHROMIUM_PATH || (() => {
  const root = '/opt/pw-browsers';
  try {
    for (const d of fs.readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse()) {
      const p = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
  return undefined;
})();

const SH = fs.readFileSync(path.join(__dirname, 'shots.js'), 'utf8');
const bloc = (debut, fin) => SH.slice(SH.indexOf(debut) + debut.length, SH.indexOf(fin)).trim().replace(/;$/, '');
const SEED = new Function('return ' + bloc('const SEED = ', '\nconst VUES'))();

/* Les memes etats que l'outil de mesure, plus larges que les seules captures. */
const ETATS = {
  apercu:        () => { view.tab='map'; view.level='overview'; view.zoneId=null; view.selectedReagentId=null;
                         view.selectMode=false; view.selectedIds=new Set(); render(); },
  rack:          () => { view.tab='map'; view.zoneId='ZR'; view.level='rack'; render(); },
  boite:         () => { view.tab='map'; view.zoneId='ZR'; view.level='box'; view.boxRow=0; view.boxCol=0; render(); },
  compartiment:  () => { view.tab='map'; view.zoneId='ZC'; view.level='compartment'; render(); },
  fiche:         () => { view.zoneId='ZR'; view.level='box'; view.selectedReagentId='r0'; render(); },
  selection:     () => { view.selectedReagentId=null; view.selectMode=true; view.selectedIds=new Set(['r0','r1']); render(); },
  inventaire:    () => { view.selectMode=false; view.selectedIds=new Set(); view.tab='inventory'; render(); },
  inventaireVide:() => { const g=state.inventory; state.inventory=[]; render(); state.inventory=g; },
  prepa:         () => { view.tab='prep'; render(); },
  recherche:     () => { view.tab='map'; view.level='overview'; render(); doSearch('tax'); },
  preferences:   () => { document.getElementById('searchResults').classList.remove('show');
                         document.getElementById('btnConfig').click(); },
  aide:          () => { document.querySelectorAll('.modal-backdrop.show').forEach(m=>m.classList.remove('show'));
                         document.getElementById('btnHelp').click(); },
  palette:       () => { document.querySelectorAll('.modal-backdrop.show').forEach(m=>m.classList.remove('show'));
                         cmPalette('a'); },
  toasts:        () => { const v=document.getElementById('cmkVeil'); if(v) v.click();
                         toast('message','success',60000); toast('alerte','danger',60000); },

  /* L'onglet Prépa VIDE ne rend ni les cartes « À sortir », ni la section
     « Préparer les dilutions » : ces états-là n'étaient donc jamais mesurés.
     C'est exactement par là qu'une régression est passée. */
  prepaChargee:  () => { document.querySelectorAll('.modal-backdrop.show').forEach(m=>m.classList.remove('show'));
                         view.tab='prep'; render();
                         window.__prepRestore({ plates:2, mode:'serial', excess:10, minPrep:20, maxPrep:50,
                           minPip:1, load:2, tubesOv:{}, norm:{dmso:{disp:120,load:99},tween:{disp:20,load:14},plates:2},
                           sources:[], checks:{}, excluded:{}, spotChoice:{}, linkChoice:{},
                           fluids:[{drug:'Docetaxel',dil:'mère',load:50},
                                   {drug:'Docetaxel',dil:'1:4',load:50},
                                   {drug:'Docetaxel',dil:'1:16',load:50},
                                   {drug:'Docetaxel',dil:'1:64',load:50},
                                   {drug:'Paclitaxel',dil:'mère',load:30},
                                   {drug:'Paclitaxel',dil:'1:10',load:30},
                                   {drug:'Olaparib',dil:'mère',load:20}] });
                         renderPrepTab(document.getElementById('canvas')); },

  /* Un nom rapproché par approximation : badge « ≈ », bouton de confirmation
     et bandeau de validation bloqué. */
  prepaApproche: () => { window.__prepRestore({ plates:1, mode:'serial', excess:10, minPrep:20, maxPrep:50,
                           minPip:1, load:2, tubesOv:{}, norm:null, sources:[], checks:{}, excluded:{},
                           spotChoice:{}, linkChoice:{},
                           fluids:[{drug:'Docetaxol',dil:'mère',load:50}] });
                         renderPrepTab(document.getElementById('canvas')); },

  /* Stock insuffisant + cases cochées : les variantes d'état des cartes. */
  /* La cle d'une carte est « g-<nom en minuscules> », pas un index : avec
     'g-0' la variante cochee n'etait jamais rendue, et l'etat ne couvrait rien. */
  prepaCochee:   () => { window.__prepRestore({ plates:9, mode:'serial', excess:10, minPrep:20, maxPrep:50,
                           minPip:1, load:2, tubesOv:{}, norm:null, sources:[],
                           checks:{'g-docetaxel':true}, excluded:{},
                           spotChoice:{}, linkChoice:{},
                           fluids:[{drug:'Docetaxel',dil:'mère',load:400},
                                   {drug:'Paclitaxel',dil:'1:4',load:400}] });
                         renderPrepTab(document.getElementById('canvas')); },
};
const LARGEURS = [1440, 880, 420];

/* La liste des proprietes doit etre la MEME pour les deux fichiers : si on la
   recalculait a partir de chacun, retirer un `!important` retrecirait la liste
   et toutes les empreintes differeraient pour cette seule raison. */
const OUTILS = (fixe) => {
  window.__props = fixe || (() => {
    const s = new Set();
    for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch (e) { continue; }
      const walk = l => { for (const r of l) {
        if (r.style) for (let i = 0; i < r.style.length; i++)
          if (r.style.getPropertyPriority(r.style[i]) === 'important') s.add(r.style[i]);
        if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      } };
      walk(rs); }
    return [...s].sort();
  })();
  /* Empreinte d'un etat : boite + valeurs calculees, element par element. */
  window.__empreinte = () => {
    const els = document.querySelectorAll('*'), props = window.__props;
    let h1 = 0x811c9dc5, h2 = 0x01000193, n = 0;
    const avale = s => { for (let k = 0; k < s.length; k++) {
      h1 = ((h1 ^ s.charCodeAt(k)) * 16777619) >>> 0;
      h2 = ((h2 + s.charCodeAt(k)) * 33) >>> 0; } };
    for (const el of els) {
      const r = el.getBoundingClientRect();
      avale(el.tagName + '|' + Math.round(r.x) + ',' + Math.round(r.y) + ',' +
            Math.round(r.width) + ',' + Math.round(r.height) + '|');
      const cs = getComputedStyle(el);
      for (const p of props) avale(cs.getPropertyValue(p));
      n++;
    }
    return n + ':' + h1.toString(16) + h2.toString(16);
  };
};

async function releve(browser, fichier, props) {
  const out = {};
  for (const w of LARGEURS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('file://' + path.resolve(fichier), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof render === 'function', null, { timeout: 20000 });
    await page.waitForTimeout(700);
    await page.evaluate(SEED);
    await page.evaluate(OUTILS, props);
    if (!props) props = await page.evaluate(() => window.__props);
    for (const [nom, fn] of Object.entries(ETATS)) {
      await page.evaluate(fn);
      await page.waitForTimeout(nom.startsWith('prepa') ? 700 : 260);
      out[nom + '@' + w] = await page.evaluate(() => window.__empreinte());
    }
    await ctx.close();
  }
  return { empreintes: out, props };
}


module.exports = { chromium, CHROME, SEED, OUTILS, ETATS, LARGEURS, releve };
