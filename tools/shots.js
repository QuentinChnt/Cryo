/* Captures de reference : rend les memes vues, toujours dans le meme etat, et
   ecrit un PNG par (vue, largeur). Sert a prouver qu'un remaniement CSS ne
   change RIEN a l'ecran.
   Usage :  node tools/shots.js <dossier> [fichier.html]                     */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

const OUT = path.resolve(process.argv[2] || 'out/shots');
const APP_FILE = process.argv[3] || 'CryoMap-prep-d300e.html';
const APP = 'file://' + path.resolve(__dirname, '..', APP_FILE);
const CHROME = process.env.CHROMIUM_PATH || (() => {
  const root = '/opt/pw-browsers';
  try {
    for (const d of fs.readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse()) {
      const p = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
})();

/* Trois largeurs, choisies pour tomber de part et d'autre des points de
   rupture du CSS (600/700/760/820/860/900/940/1100/1320/1500 px). */
const TAILLES = [{ n: 'large', width: 1440, height: 900 },
                 { n: 'moyen', width: 880,  height: 900 },
                 { n: 'etroit', width: 420, height: 880 }];

/* Etat fige : aucune date « aujourd'hui », aucun identifiant aleatoire, sinon
   deux captures du meme code differeraient. */
const SEED = () => {
  localStorage.clear();
  state.preferences = { colorByType: false, initials: 'QC', expirySoonDays: 30 };
  state.freezers = [{ id:'F1', name:'Congélateur A', temp:'-80°C', cols:2, rows:2, zones:[
    { id:'ZR', name:'Rack 1', type:'rack', x:0, y:0, w:1, h:1, rackHeight:4, rackDepth:3, gridRows:9, gridCols:9 },
    { id:'ZC', name:'Compartiment', type:'compartment', x:1, y:0, w:1, h:1, compRows:3, compCols:3 }]}];
  state.reagents = [];
  const noms = ['Docetaxel','Trastuzumab deruxtecan','Paclitaxel','Cisplatine','Gemcitabine','Olaparib'];
  for (let i = 0; i < 24; i++) state.reagents.push({
    id: 'r' + i, name: noms[i % noms.length], code: 'C' + (100 + i), quantity: '30 µL',
    units: (i % 4) + 1, lot: 'L' + i, owner: 'QC', type: 'reagent',
    expiry: (2027 + (i % 3)) + '-0' + ((i % 9) + 1) + '-15', addedAt: '2025-01-0' + ((i % 9) + 1),
    loc: { freezerId:'F1', zoneId:'ZR', boxRow: i % 4, boxCol: i % 3, row: i % 9, col: (i * 2) % 9 } });
  state.inventory = [{ id:'i1', name:'DMEM', category:'culture', qty:4, unit:'flacon', threshold:2 },
                     { id:'i2', name:'PBS', category:'reagent', qty:1, unit:'flacon', threshold:3 }];
  state.history = [];
  view.tab = 'map'; view.level = 'overview'; view.freezerId = 'F1'; view.zoneId = null;
};

const VUES = {
  apercu:       () => { view.tab='map'; view.level='overview'; view.zoneId=null; render(); },
  rack:         () => { view.tab='map'; view.zoneId='ZR'; view.level='rack'; render(); },
  boite:        () => { view.tab='map'; view.zoneId='ZR'; view.level='box'; view.boxRow=0; view.boxCol=0; render(); },
  compartiment: () => { view.tab='map'; view.zoneId='ZC'; view.level='compartment'; render(); },
  inventaire:   () => { view.tab='inventory'; render(); },
  prepa:        () => { view.tab='prep'; render(); },
  fiche:        () => { view.tab='map'; view.level='box'; view.zoneId='ZR'; view.boxRow=0; view.boxCol=0;
                        view.selectedReagentId='r0'; render(); },
  recherche:    () => { view.tab='map'; view.level='overview'; view.selectedReagentId=null; render(); doSearch('tax'); },
  preferences:  () => { view.tab='map'; view.level='overview'; render();
                        document.getElementById('searchResults').classList.remove('show');
                        document.getElementById('btnConfig').click(); },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  for (const t of TAILLES) {
    const ctx = await browser.newContext({ viewport: { width: t.width, height: t.height },
                                           deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof render === 'function' && typeof state === 'object', null, { timeout: 20000 });
    await page.waitForTimeout(800);
    await page.evaluate(SEED);
    for (const [nom, fn] of Object.entries(VUES)) {
      await page.evaluate(fn);
      await page.waitForTimeout(450);
      await page.screenshot({ path: path.join(OUT, nom + '-' + t.n + '.png'), fullPage: true });
      // on referme ce qui a pu s'ouvrir, pour que la vue suivante parte propre
      await page.evaluate(() => { document.querySelectorAll('.modal-backdrop.show')
        .forEach(m => m.classList.remove('show')); });
    }
    await ctx.close();
  }
  await browser.close();
  console.log('captures écrites dans ' + OUT);
})();
