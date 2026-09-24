/* Mesure empirique : quels `!important` changent REELLEMENT quelque chose ?

   Methode, en deux passes seulement (donc rapide) :
     1. on releve la valeur calculee de chaque propriete concernee, sur CHAQUE
        element de la page, dans chaque etat de l'application ;
     2. on retire toutes les priorites `!important`, on releve a nouveau, on
        compare.
   Une propriete dont AUCUNE valeur calculee ne bouge, dans aucun etat, n'a
   jamais eu besoin de `!important` : ses declarations peuvent perdre le mot
   sans rien changer a l'ecran. Une propriete qui bouge ne serait-ce qu'une
   fois est declaree contestee, et on n'y touche pas — grain grossier, mais
   aucune supposition.
   Usage :  node tools/css-important.js [fichier.html]                        */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

const APP_FILE = process.argv[2] || 'CryoMap-prep-d300e.html';
const APP = 'file://' + path.resolve(__dirname, '..', APP_FILE);
const CHROME = process.env.CHROMIUM_PATH || (() => {
  const root = '/opt/pw-browsers';
  for (const d of fs.readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
})();

const SEED = () => {
  localStorage.clear();
  state.preferences = { colorByType: false, initials: 'QC', expirySoonDays: 30 };
  state.freezers = [{ id:'F1', name:'Congélateur A', temp:'-80°C', cols:2, rows:2, zones:[
    { id:'ZR', name:'Rack 1', type:'rack', x:0, y:0, w:1, h:1, rackHeight:4, rackDepth:3, gridRows:9, gridCols:9 },
    { id:'ZC', name:'Compartiment', type:'compartment', x:1, y:0, w:1, h:1, compRows:3, compCols:3 }]}];
  state.reagents = [];
  const noms = ['Docetaxel','Trastuzumab deruxtecan','Paclitaxel','Cisplatine','Gemcitabine','Olaparib'];
  for (let i = 0; i < 24; i++) state.reagents.push({ id:'r'+i, name:noms[i%noms.length], code:'C'+(100+i),
    quantity:'30 µL', units:(i%4)+1, lot:'L'+i, owner:'QC', type:'reagent',
    expiry:(2027+(i%3))+'-0'+((i%9)+1)+'-15', addedAt:'2025-01-0'+((i%9)+1),
    loc:{ freezerId:'F1', zoneId:'ZR', boxRow:i%4, boxCol:i%3, row:i%9, col:(i*2)%9 } });
  state.inventory = [{ id:'i1', name:'DMEM', category:'culture', qty:4, unit:'flacon', threshold:2 },
                     { id:'i2', name:'PBS', category:'reagent', qty:1, unit:'flacon', threshold:3 }];
  state.history = [];
  view.tab='map'; view.level='overview'; view.freezerId='F1'; view.zoneId=null;
};

/* Un balayage large : chaque etat ajoute des elements que les autres n'ont pas. */
const ETATS = {
  apercu:        () => { view.tab='map'; view.level='overview'; view.zoneId=null; view.selectedReagentId=null; render(); },
  rack:          () => { view.tab='map'; view.zoneId='ZR'; view.level='rack'; render(); },
  boite:         () => { view.tab='map'; view.zoneId='ZR'; view.level='box'; view.boxRow=0; view.boxCol=0; render(); },
  compartiment:  () => { view.tab='map'; view.zoneId='ZC'; view.level='compartment'; render(); },
  fiche:         () => { view.selectedReagentId='r0'; render(); },
  selection:     () => { view.selectedReagentId=null; view.selectMode=true;
                         view.selectedIds=new Set(['r0','r1']); render(); },
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
  toasts:        () => { document.getElementById('cmkVeil') && document.getElementById('cmkVeil').click();
                         toast('message','success',60000); toast('alerte','danger',60000); toast('note','warn',60000); },
};

const OUTILS = () => {
  /* Toutes les declarations !important du document, par propriete. */
  window.__imp = (() => {
    const parRegle = [];
    const props = new Set();
    for (const sh of document.styleSheets) {
      let rs; try { rs = sh.cssRules; } catch (e) { continue; }
      /* Depuis l'imbrication CSS, une CSSStyleRule expose AUSSI `cssRules`
         (vide). Tester `cssRules` en premier faisait donc sauter la lecture
         des declarations de toutes les regles ordinaires. */
      const walk = l => { for (const r of l) {
        if (r.style) {
          for (let i = 0; i < r.style.length; i++) {
            const p = r.style[i];
            if (r.style.getPropertyPriority(p) === 'important') {
              parRegle.push({ r, p, v: r.style.getPropertyValue(p) });
              props.add(p);
            }
          }
        }
        if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      } };
      walk(rs);
    }
    return { parRegle, props: [...props] };
  })();

  window.__releve = () => {
    const els = document.querySelectorAll('*');
    const props = window.__imp.props;
    const out = new Array(els.length);
    for (let i = 0; i < els.length; i++) {
      const cs = getComputedStyle(els[i]);
      const row = new Array(props.length);
      for (let j = 0; j < props.length; j++) row[j] = cs.getPropertyValue(props[j]);
      out[i] = row;
    }
    return out;
  };
  window.__sansImportant = () => window.__imp.parRegle.forEach(d => {
    try { d.r.style.setProperty(d.p, d.v, ''); } catch (e) {} });
  window.__avecImportant = () => window.__imp.parRegle.forEach(d => {
    try { d.r.style.setProperty(d.p, d.v, 'important'); } catch (e) {} });
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof render === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(SEED);
  await page.evaluate(OUTILS);

  const info = await page.evaluate(() => ({ n: window.__imp.parRegle.length, props: window.__imp.props }));
  const contestees = new Set();

  for (const [nom, fn] of Object.entries(ETATS)) {
    await page.evaluate(fn);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const avant = window.__releve();
      window.__sansImportant();
      const apres = window.__releve();
      window.__avecImportant();
      const props = window.__imp.props, touchees = new Set();
      for (let i = 0; i < avant.length; i++)
        for (let j = 0; j < props.length; j++)
          if (avant[i][j] !== apres[i][j]) touchees.add(props[j]);
      return { elements: avant.length, touchees: [...touchees] };
    });
    r.touchees.forEach(p => contestees.add(p));
    console.log(`  ${nom.padEnd(15)} ${String(r.elements).padStart(5)} éléments — ${r.touchees.length} propriété(s) contestée(s)`);
  }
  await browser.close();

  const inertes = info.props.filter(p => !contestees.has(p));
  console.log(`\n${info.n} déclarations !important, ${info.props.length} propriétés distinctes`);
  console.log(`contestées : ${contestees.size}  ·  jamais utiles : ${inertes.length}`);
  fs.mkdirSync(path.resolve(__dirname, '..', 'out'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '..', 'out', 'important.json'),
    JSON.stringify({ contestees: [...contestees].sort(), inertes: inertes.sort() }, null, 1));
  console.log('rapport : out/important.json');
})();
