/* Suite de régression CryoMap — Playwright, sans cadre de test externe.
   Chaque cas reproduit un bug réellement observé puis vérifie sa correction.
   Lancement :  npm test          (ou  node tests/regression.js)            */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// APP_FILE permet de faire tourner la meme suite sur un autre fichier
// (ex. une variante livree par l'utilisateur) sans toucher au harnais.
const APP_FILE = process.env.APP_FILE || 'CryoMap-prep-d300e.html';
const APP = 'file://' + path.resolve(__dirname, '..', APP_FILE);
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const TDD = fs.readFileSync(path.join(__dirname, 'fixtures', 'run-demo.tdd'), 'utf8');
/* Le Chromium du conteneur n'a pas forcement le numero de build attendu par la
   version de Playwright installee : on le localise au lieu de le supposer. */
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

let pass = 0, fail = 0;
let expectErrors = false;      // levé par les cas qui provoquent une panne exprès
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push(['ok  ', name, '']); }
  else { fail++; results.push(['FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail)]); }
}

async function newPage(browser, withFirebase) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (withFirebase) await page.addInitScript(FAKE);
  page.on('pageerror', e => { if (!expectErrors) { fail++; results.push(['FAIL', 'erreur JS de page', e.message]); } });
  page.on('console', m => {
    if (expectErrors) return;
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONNECTION|Failed to load resource/.test(m.text()))
      { fail++; results.push(['FAIL', 'erreur console', m.text()]); }
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof render === 'function' && typeof state === 'object', null, { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => { localStorage.clear(); });
  return page;
}

/* Petit jeu de données déterministe, indépendant de loadSampleData. */
const SEED = `(() => {
  const f = { id:'F1', name:'Congélateur test', temp:'-80°C', cols:3, rows:2, zones:[
    { id:'Z_COMP', name:'Compartiment haut', type:'compartment', x:0, y:0, w:2, h:1, gridRows:4, gridCols:6, compBoxes:[] },
    { id:'Z_RACK', name:'Rack haut', type:'rack', x:2, y:0, w:1, h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }
  ]};
  state.freezers = [f];
  state.reagents = [];
  for (let i = 0; i < 6; i++) state.reagents.push({ id:'R'+i, name:'Réactif '+i, type:'Anticorps',
    lot:'L'+i, quantity:'250 µL', expiry:'2030-01-01', units:4, addedAt:'2025-01-01',
    loc:{ freezerId:'F1', zoneId:'Z_RACK', boxRow:0, boxCol:0, row:0, col:i } });
  state.history = []; state.inventory = state.inventory || [];
  view.tab = 'map'; view.freezerId = 'F1'; view.zoneId = null; view.level = 'overview';
  saveState(); flushPersist(); render();
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });

  /* ============ 1. Fenêtres de dialogue ============ */
  {
    const page = await newPage(browser);
    await page.evaluate(SEED);
    const r = await page.evaluate(async () => {
      const out = {};
      let a = 'en suspens';
      customConfirm('T', 'C', 'OK').then(v => { a = 'resolu:' + v; });
      await new Promise(r => setTimeout(r, 120));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 220));
      out.echap = a;
      let b = 'en suspens';
      customConfirm('T', 'C', 'OK').then(v => { b = 'resolu:' + v; });
      await new Promise(r => setTimeout(r, 120));
      document.getElementById('confirmModal').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise(r => setTimeout(r, 220));
      out.fond = b;
      // une confirmation abandonnée ne doit pas se déclencher plus tard
      promptDeleteReagent('R0');
      await new Promise(r => setTimeout(r, 180));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 220));
      promptDeleteReagent('R1');
      await new Promise(r => setTimeout(r, 180));
      document.getElementById('confirmOk').click();
      await new Promise(r => setTimeout(r, 320));
      out.restants = state.reagents.map(x => x.id);
      // saisies
      out.texteOk = await (async () => { const p = customTextPrompt('T','C','abc');
        await new Promise(r=>setTimeout(r,140)); document.getElementById('confirmOk').click(); return p; })();
      out.texteEchap = await (async () => { const p = customTextPrompt('T','C','abc');
        await new Promise(r=>setTimeout(r,140));
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return p; })();
      out.aria = ['confirmModal','reagentModal','invModal'].every(id => {
        const e = document.getElementById(id);
        return e.getAttribute('role')==='dialog' && e.getAttribute('aria-modal')==='true' && !!e.getAttribute('aria-labelledby');
      });
      return out;
    });
    check('Échap résout la confirmation', r.echap === 'resolu:false', r.echap);
    check('clic sur le fond résout la confirmation', r.fond === 'resolu:false', r.fond);
    check('une confirmation abandonnée ne supprime rien plus tard',
      r.restants.includes('R0') && !r.restants.includes('R1'), r.restants);
    check('saisie texte : OK renvoie la valeur', r.texteOk === 'abc', r.texteOk);
    check('saisie texte : Échap renvoie null', r.texteEchap === null, r.texteEchap);
    check('modales : role, aria-modal et libellé', r.aria === true, r.aria);
    await page.context().close();
  }

  /* ============ 2. Historique, onglets, menus ============ */
  {
    const page = await newPage(browser);
    await page.evaluate(SEED);
    const r = await page.evaluate(async () => {
      const out = {};
      state.history = []; undoStack = [];
      logAction('historyAddReagent', { name: 'ANCIENNE' });
      logAction('historyAddReagent', { name: 'MILIEU' });
      pushUndo('t');
      logAction('historyAddReagent', { name: 'RECENTE' });
      undo();
      out.histoire = state.history.map(h => h.vars.name);
      view.tab = 'map'; render();
      document.querySelector('#freezerList .freezer-item').click();
      out.onglet = { tab: view.tab, classe: document.body.classList.contains('tab-map'),
                     reorg: getComputedStyle(document.getElementById('btnReorganize')).display };
      // menu de congélateur : doit se refermer à chaque fois
      const f2 = JSON.parse(JSON.stringify(state.freezers[0]));
      f2.id = 'F2'; f2.name = 'Congélateur 2'; f2.zones.forEach((z,i) => z.id = 'F2Z'+i);
      state.freezers.push(f2); saveState(); view.level = 'overview'; render();
      const menu = document.getElementById('fzMenu');
      const cycle = () => { document.getElementById('fzCurrent').click();
        const o = menu.classList.contains('open'); document.body.click();
        return o && !menu.classList.contains('open'); };
      out.menu = [cycle(), cycle(), cycle()];
      return out;
    });
    check('undo retire l’entrée d’historique la plus récente',
      JSON.stringify(r.histoire) === JSON.stringify(['MILIEU','ANCIENNE']), r.histoire);
    check('choisir un congélateur conserve l’onglet Carte',
      r.onglet.tab === 'map' && r.onglet.classe && r.onglet.reorg !== 'none', r.onglet);
    check('le menu de congélateur se referme à chaque ouverture',
      r.menu.every(Boolean), r.menu);
    await page.context().close();
  }

  /* ============ 3. Compartiments : rien d’invisible ============ */
  {
    const page = await newPage(browser);
    await page.evaluate(SEED);
    const r = await page.evaluate(async () => {
      const out = {};
      const z = state.freezers[0].zones.find(x => x.type === 'compartment');
      z.gridRows = 2; z.gridCols = 2; z.compBoxes = [];
      state.reagents = [];
      for (let i = 0; i < 4; i++) z.compBoxes.push({ id:'B'+i, label:'Boîte '+i, slotRow:i>>1, slotCol:i&1, gridRows:9, gridCols:9 });
      for (let i = 0; i < 4; i++) state.reagents.push({ id:'C'+i, name:'Objet '+i, loc:{ freezerId:'F1', zoneId:z.id, cellRow:i>>1, cellCol:i&1 } });
      saveState();
      view.zoneId = z.id; view.level = 'compartment'; render();
      await new Promise(r => setTimeout(r, 150));
      out.rendus = document.querySelectorAll('#compGrid .cg-card[data-boxid], #compGrid .cg-card[data-rid]').length;
      out.attendus = 8;
      // refus d'un redimensionnement trop petit (boîtes ET objets comptés)
      const avant = z.gridRows + 'x' + z.gridCols;
      openCompGridResizeModal('F1', z.id);
      await new Promise(r => setTimeout(r, 150));
      document.getElementById('customPromptInput').value = '1x2';
      document.getElementById('confirmOk').click();
      await new Promise(r => setTimeout(r, 300));
      out.redimRefuse = (z.gridRows + 'x' + z.gridCols) === avant;
      // saisie en lot bornée à la capacité réelle
      state.reagents = []; z.compBoxes = []; z.gridRows = 2; z.gridCols = 2;
      state.freezers[0].zones = [z]; z.x=0; z.y=0; z.w=1; z.h=1;
      state.freezers[0].cols = 1; state.freezers[0].rows = 1;
      state.freezers.length = 1;
      saveState(); view.level='overview'; view.zoneId=null; render();
      document.getElementById('cmdText').value = '10 tubes de Trastuzumab dans le compartiment';
      analyzeBulkCommand();
      out.avertit = /Seulement 4/.test(document.getElementById('cmdPreview').textContent);
      applyBulkCommand();
      view.zoneId = z.id; view.level = 'compartment'; render();
      await new Promise(r => setTimeout(r, 150));
      out.lotCrees = state.reagents.length;
      out.lotVisibles = document.querySelectorAll('#compGrid .cg-card[data-rid]').length;
      return out;
    });
    check('compartiment saturé : tout reste visible', r.rendus === r.attendus, r);
    check('redimensionnement trop petit refusé (boîtes + objets)', r.redimRefuse, r);
    check('saisie en lot bornée à la capacité', r.lotCrees === 4 && r.lotVisibles === 4 && r.avertit, r);
    await page.context().close();
  }

  /* ============ 4. Éditeur de plan : confirmation et replacement ============ */
  {
    const page = await newPage(browser);
    await page.evaluate(SEED);
    const r = await page.evaluate(async () => {
      const out = {};
      state.reagents = state.freezers[0].zones.map((z,i) => ({ id:'P'+i, name:'Dans '+z.name, loc:{ freezerId:'F1', zoneId:z.id } }));
      saveState();
      openLayoutEditor('F1');
      document.getElementById('layoutCols').value = 1;
      document.getElementById('layoutRows').value = 1;
      updateLayoutGrid();
      saveLayout();
      await new Promise(r => setTimeout(r, 220));
      out.demandeConfirmation = document.getElementById('confirmModal').classList.contains('show');
      out.texte = document.getElementById('confirmBody').textContent.slice(0, 60);
      document.getElementById('confirmCancel').click();
      await new Promise(r => setTimeout(r, 250));
      out.rienPerduSiRefus = state.reagents.length === 2 && state.freezers[0].zones.length === 2;
      // rack rétréci : pas de collision
      state.reagents = [
        { id:'K1', name:'A', loc:{ freezerId:'F1', zoneId:'Z_RACK', boxRow:0, boxCol:0, row:8, col:8 } },
        { id:'K2', name:'B', loc:{ freezerId:'F1', zoneId:'Z_RACK', boxRow:0, boxCol:0, row:7, col:8 } }];
      saveState();
      openLayoutEditor('F1');
      const ez = editingFreezer.zones.find(z => z.id === 'Z_RACK');
      ez.gridRows = 2; ez.gridCols = 2;
      saveLayout();
      await new Promise(r => setTimeout(r, 250));
      if (document.getElementById('confirmModal').classList.contains('show')) document.getElementById('confirmOk').click();
      await new Promise(r => setTimeout(r, 250));
      const kept = state.reagents.filter(x => x.loc.zoneId === 'Z_RACK');
      const cells = kept.map(x => x.loc.row + ',' + x.loc.col);
      out.replacement = { gardes: kept.length, cases: cells, distinctes: new Set(cells).size,
                          dansLesBornes: kept.every(x => x.loc.row < 2 && x.loc.col < 2) };
      return out;
    });
    check('éditeur de plan : confirmation avant suppression', r.demandeConfirmation, r.texte);
    check('éditeur de plan : refuser ne perd rien', r.rienPerduSiRefus, r);
    check('rack rétréci : aucune collision de positions',
      r.replacement.gardes === 2 && r.replacement.distinctes === 2 && r.replacement.dansLesBornes, r.replacement);
    await page.context().close();
  }

  /* ============ 5. Affichage, journal, exports, config ============ */
  {
    const page = await newPage(browser);
    await page.evaluate(SEED);
    const r = await page.evaluate(async () => {
      const out = {};
      const z = state.freezers[0].zones.find(x => x.type === 'compartment');
      z.compBoxes = [{ id:'BX', label:'Tubes A&B <2024>', slotRow:0, slotCol:0, gridRows:9, gridCols:9 }];
      state.reagents = [{ id:'Q1', name:'Anti-CD3', loc:{ freezerId:'F1', zoneId:z.id, compBoxId:'BX', row:0, col:0 } }];
      saveState(); view.selectedReagentId = 'Q1'; view.level = 'overview'; render();
      out.libelle = Array.from(document.querySelectorAll('#detailPanel .detail-value'))
        .map(e => e.textContent).find(t => t.includes('Tubes'));
      // journal : aucune ligne perdue pendant une écriture lente
      let written = [];
      _logHandle = { faux: true };
      eval("_logWrite = async function(t){ written.push(t); await new Promise(r=>setTimeout(r,60)); return true; }");
      _logQueue = [];
      const p1 = appendLog('ligne-1'); await new Promise(r=>setTimeout(r,10));
      const p2 = appendLog('ligne-2'); await new Promise(r=>setTimeout(r,10));
      const p3 = appendLog('ligne-3');
      await p1; await p2; await p3; await new Promise(r=>setTimeout(r,300));
      _logHandle = null;
      const joint = written.join('');
      out.journal = ['ligne-1','ligne-2','ligne-3'].filter(l => joint.includes(l)).length;
      out.fileVide = _logQueue.length === 0;
      // exports : révocation différée
      out.exports = /setTimeout/.test(exportData.toString().split('a.click()')[1] || '')
                 && /setTimeout/.test(downloadText.toString().split('a.click()')[1] || '');
      // config Firebase : convertie, pas évaluée
      let cfg = null, rejete = false;
      const src = ['const c = {', "  apiKey: 'k',", '  projectId: "demo",', '  n: 42,', '  ok: true,', '};'].join('\n');
      try { cfg = parseFirebaseConfig(src); } catch(e) {}
      try { parseFirebaseConfig('{ a: (window.__pwned = 1) }'); } catch(e) { rejete = true; }
      out.config = { lue: cfg && cfg.projectId === 'demo' && cfg.n === 42, rejete, codeExecute: !!window.__pwned };
      // seuil de péremption configurable et stable dans la journée
      const dans20 = new Date(Date.now() + 20*86400000).toISOString().slice(0,10);
      state.preferences.expirySoonDays = 30; out.seuil30 = expiryStatus(dans20);
      state.preferences.expirySoonDays = 10; out.seuil10 = expiryStatus(dans20);
      return out;
    });
    check('libellé de boîte non doublement échappé',
      r.libelle && r.libelle.includes('Tubes A&B <2024>'), r.libelle);
    check('journal fichier : aucune ligne perdue', r.journal === 3 && r.fileVide, r);
    check('exports : URL du blob révoquée en différé', r.exports, r.exports);
    check('config Firebase convertie en JSON, jamais évaluée',
      r.config.lue && r.config.rejete && !r.config.codeExecute, r.config);
    check('seuil « bientôt périmé » configurable',
      r.seuil30 === 'expiring' && r.seuil10 === 'ok', r);
    await page.context().close();
  }

  /* ============ 6. Inventaire ============ */
  {
    const page = await newPage(browser);
    await page.evaluate(SEED);
    const r = await page.evaluate(async () => {
      state.inventory = [{ id:'CI', name:'Article', category:'macategorie', qty:3, lowThreshold:null, reference:'', supplier:'', notes:'' }];
      saveState();
      openInvModal('CI');
      const affichee = document.getElementById('invCategory').value;
      saveInvItem();
      await new Promise(r=>setTimeout(r,150));
      const apres = state.inventory.find(x => x.id === 'CI').category;
      // pas d'agrandissement au survol
      view.tab = 'inventory'; render();
      await new Promise(r=>setTimeout(r,200));
      const row = document.querySelector('.inv-row');
      const h0 = row.getBoundingClientRect().height;
      row.classList.add('__hoverprobe');
      return { affichee, apres, hauteurRepos: h0,
               minHeightSurvol: getComputedStyle(row).minHeight };
    });
    check('catégorie libre préservée à l’édition', r.affichee === 'macategorie' && r.apres === 'macategorie', r);
    check('ligne d’inventaire : hauteur de 70 px conservée', Math.round(r.hauteurRepos) === 70, r);
    // le survol réel, mesuré par le navigateur
    const hov = await (async () => {
      const p2 = await newPage(browser);
      await p2.evaluate(SEED);
      await p2.evaluate(() => { view.tab='inventory'; render(); });
      await p2.waitForTimeout(300);
      const before = await p2.evaluate(() => document.querySelector('.inv-row').getBoundingClientRect().height);
      await p2.hover('.inv-row');
      await p2.waitForTimeout(300);
      const after = await p2.evaluate(() => document.querySelector('.inv-row').getBoundingClientRect().height);
      await p2.context().close();
      return { before, after };
    })();
    check('aucun agrandissement au survol de l’inventaire', Math.abs(hov.after - hov.before) < 0.5, hov);
    await page.context().close();
  }

  /* ============ 7. Persistance ============ */
  {
    const page = await newPage(browser);
    await page.evaluate(SEED);
    const r = await page.evaluate(async () => {
      const out = {};
      // regroupement des écritures
      let ecritures = 0;
      const vrai = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k){ if (k === 'cryomap-v3') ecritures++; return vrai.apply(this, arguments); };
      for (let i = 0; i < 10; i++) { state.reagents[0].owner = 'O' + i; saveState(); }
      await new Promise(r => setTimeout(r, 600));
      Storage.prototype.setItem = vrai;
      out.ecrituresPour10Actions = ecritures;
      // Quota saturé : IndexedDB prend le relais.
      // On travaille à l'échelle réelle (~2 500 aliquots, ~850 Ko) : avec un
      // état minuscule, remplacer la clé par une valeur de taille voisine ne
      // demande aucune place au navigateur et l'écriture passe malgré le lest.
      state.reagents = [];
      for (let n = 0; n < 2500; n++) state.reagents.push({ id:'B'+n, name:'Aliquot de charge '+n,
        type:'Anticorps', lot:'LOT'+n, quantity:'250 µL', expiry:'2030-01-01', aliquotDate:'2025-01-01',
        owner:'AB', notes:'remplissage pour atteindre la taille reelle', units:4, lowThreshold:null,
        loc:{ freezerId:'F1', zoneId:'Z_RACK', boxRow:n % 6, boxCol:(n >> 3) % 4, row:n % 9, col:(n >> 4) % 9 } });
      saveState(); flushPersist();
      await new Promise(r => setTimeout(r, 500));
      out.tailleEtatKo = Math.round(JSON.stringify(state).length / 1024);
      const gros = 'x'.repeat(256 * 1024); let i = 0;
      try { for (;;) { localStorage.setItem('lest' + (i++), gros); if (i > 60) break; } } catch (e) {}
      // Le mode de panne réel n'est pas la réécriture à taille égale (le
      // navigateur ne réclame alors aucune place neuve) mais la CROISSANCE de
      // l'inventaire sur un stockage déjà plein — ce qui arrive au fil des
      // ajouts d'aliquots. On modélise donc un ajout massif.
      state.reagents.push({ id:'CRITIQUE', name:'Aliquot critique', loc:{ freezerId:'F1', zoneId:'Z_RACK', boxRow:1, boxCol:1, row:0, col:0 } });
      for (let n = 0; n < 1500; n++) state.reagents.push({ id:'G'+n, name:'Nouvel aliquot '+n,
        type:'Anticorps', lot:'LOT'+n, quantity:'250 µL', expiry:'2030-01-01', owner:'AB',
        notes:'croissance de l inventaire sur un stockage plein', units:4,
        loc:{ freezerId:'F1', zoneId:'Z_RACK', boxRow:n % 6, boxCol:(n >> 3) % 4, row:n % 9, col:(n >> 4) % 9 } });
      saveState(); flushPersist();
      await new Promise(r => setTimeout(r, 1200));
      out.miroirSature = !(localStorage.getItem('cryomap-v3') || '').includes('CRITIQUE');
      for (let k = 0; k < i; k++) localStorage.removeItem('lest' + k);
      return out;
    });
    check('10 actions ⇒ une seule écriture', r.ecrituresPour10Actions === 1, r);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof render === 'function', null, { timeout: 20000 });
    await page.waitForTimeout(2200);
    const after = await page.evaluate(() => ({
      retrouve: !!state.reagents.find(r => r.id === 'CRITIQUE'),
      venuDuMiroir: (localStorage.getItem('cryomap-v3') || '').includes('CRITIQUE')
    }));
    check('quota localStorage réellement atteint (préalable du cas suivant)',
      r.miroirSature === true, r);
    check('quota saturé : les données survivent au rechargement (IndexedDB)',
      after.retrouve && !after.venuDuMiroir, { ...r, ...after });
    // panne totale : bandeau permanent (les traces console sont attendues ici)
    expectErrors = true;
    const ban = await page.evaluate(async () => {
      eval("kvSet = function(){ return Promise.reject(new Error('idb hs')); }");
      const vrai = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k){ if (String(k).startsWith('cryomap-v3')) throw new Error('QuotaExceededError'); return vrai.apply(this, arguments); };
      state.reagents.push({ id:'Z', name:'Z', loc:{ freezerId:'F1', zoneId:'Z_RACK', boxRow:2, boxCol:2, row:0, col:0 } });
      saveState(); flushPersist();
      await new Promise(r => setTimeout(r, 500));
      const b = document.getElementById('persistBanner');
      const visible = !!(b && b.style.display !== 'none');
      Storage.prototype.setItem = vrai;
      eval("kvSet = function(){ return Promise.resolve(true); }");
      saveState(); flushPersist();
      await new Promise(r => setTimeout(r, 500));
      return { visible, retiree: !(b && b.style.display !== 'none') };
    });
    expectErrors = false;
    check('panne totale d’enregistrement : bandeau permanent', ban.visible && ban.retiree, ban);
    await page.context().close();
  }

  /* ============ 8. Synchronisation d’équipe ============ */
  {
    const page = await newPage(browser, true);
    await page.evaluate(SEED);
    const r = await page.evaluate(async () => {
      const out = {};
      __fs.reset();
      const ok = await fbConnect(JSON.stringify({ projectId:'demo', apiKey:'k' }), 'salle', true);
      await new Promise(r => setTimeout(r, 1500));
      out.connecte = ok;
      out.docsReactifs = __fs.count('cryomap/salle/reagents/');
      out.aliquots = state.reagents.length;
      out.plusGrosDoc = __fs.biggestDocBytes();
      // écriture différentielle
      const w0 = __fs.stats.writes;
      state.reagents[0].loc.row = 3; saveState();
      await new Promise(r => setTimeout(r, 1400));
      out.ecrituresPourUnDeplacement = __fs.stats.writes - w0;
      // fusion concurrente
      const a = state.reagents[0], b = state.reagents[1];
      const objB = JSON.parse(__fs.get('cryomap/salle/reagents/' + b.id).d);
      objB.owner = 'COLLEGUE';
      __fs.remoteSet('cryomap/salle/reagents/' + b.id, { d: JSON.stringify(objB), by:'autre', at: Date.now() });
      a.owner = 'MOI'; saveState();
      await new Promise(r => setTimeout(r, 1600));
      const la = state.reagents.find(x => x.id === a.id), lb = state.reagents.find(x => x.id === b.id);
      out.fusion = la.owner === 'MOI' && lb.owner === 'COLLEGUE'
        && JSON.parse(__fs.get('cryomap/salle/reagents/' + a.id).d).owner === 'MOI'
        && JSON.parse(__fs.get('cryomap/salle/reagents/' + b.id).d).owner === 'COLLEGUE';
      // stock en temps réel
      const s = state.reagents[2];
      view.selectedReagentId = s.id; view.tab = 'map'; render();
      const d = JSON.parse(__fs.get('cryomap/salle/reagents/' + s.id).d);
      d.units = 1;
      __fs.remoteSet('cryomap/salle/reagents/' + s.id, { d: JSON.stringify(d), by:'autre', at: Date.now() });
      await new Promise(r => setTimeout(r, 800));
      out.stockTempsReel = state.reagents.find(x => x.id === s.id).units === 1
        && (document.querySelector('#detailPanel .units-count') || {}).textContent === '1';
      // suppression distante
      const n0 = state.reagents.length;
      __fs.remoteDelete('cryomap/salle/reagents/' + state.reagents[3].id);
      await new Promise(r => setTimeout(r, 700));
      out.suppressionDistante = state.reagents.length === n0 - 1;
      return out;
    });
    check('synchro : un document par aliquot', r.docsReactifs === r.aliquots && r.docsReactifs > 0, r);
    check('synchro : aucun document proche de la limite de 1 MiB', r.plusGrosDoc < 20000, r.plusGrosDoc);
    check('synchro : un déplacement n’écrit que le nécessaire', r.ecrituresPourUnDeplacement <= 3, r);
    check('synchro : deux personnes en même temps, rien d’écrasé', r.fusion, r);
    check('synchro : le stock se met à jour en temps réel', r.stockTempsReel, r);
    check('synchro : une suppression distante se propage', r.suppressionDistante, r);

    // migration depuis l'ancien document unique
    const mig = await page.evaluate(async () => {
      __fs.reset(); fbDisconnect(); localStorage.clear();
      const ancien = { freezers: state.freezers, reagents: state.reagents.slice(0, 5),
        inventory: [{ id:'i1', name:'FBS', category:'supplement', qty:3, lowThreshold:1 }],
        history: [], preferences: { initials:'AB', colorByType:false } };
      __fs.seedLegacy('salle2', ancien);
      state.reagents = [];
      const ok = await fbConnect(JSON.stringify({ projectId:'demo', apiKey:'k' }), 'salle2', true);
      await new Promise(r => setTimeout(r, 1800));
      const head = __fs.get('cryomap/salle2');
      return { ok, aliquots: state.reagents.length, inventaire: (state.inventory||[]).length,
               initiales: state.preferences && state.preferences.initials,
               docs: __fs.count('cryomap/salle2/reagents/'),
               schema: head && head.schema, ancienChampRetire: !(head && head.state) };
    });
    check('synchro : migration depuis l’ancien document unique',
      mig.ok && mig.aliquots === 5 && mig.docs === 5 && mig.schema === 2 && mig.ancienChampRetire && mig.initiales === 'AB', mig);

    // Règles Firestore pas encore à jour : la migration doit échouer SANS
    // toucher à l'ancien champ, seule copie partagée de l'équipe.
    expectErrors = true;
    const refus = await page.evaluate(async () => {
      __fs.reset(); fbDisconnect(); localStorage.clear();
      const ancien = { freezers: state.freezers, reagents: state.reagents.slice(0, 3),
        inventory: [], history: [], preferences: { initials:'CD', colorByType:false } };
      __fs.seedLegacy('salle3', ancien);
      // on refuse toute écriture, comme le feraient des règles non mises à jour
      const vraiBatch = firebase.firestore().batch;
      firebase.firestore().batch = function () {
        return { set(){}, delete(){}, commit: async () => { const e = new Error('refuse'); e.code = 'permission-denied'; throw e; } };
      };
      const ok = await fbConnect(JSON.stringify({ projectId:'demo', apiKey:'k' }), 'salle3', true);
      await new Promise(r => setTimeout(r, 1500));
      firebase.firestore().batch = vraiBatch;
      const head = __fs.get('cryomap/salle3');
      return { connecte: ok, ancienChampIntact: !!(head && head.state),
               aucunDocEcrit: __fs.count('cryomap/salle3/reagents/') === 0,
               messageRegles: Array.from(document.querySelectorAll('#toastContainer .toast'))
                 .some(t => /cryomap\/\{room\}/.test(t.textContent)) };
    });
    expectErrors = false;
    check('synchro : règles non à jour ⇒ ancien champ préservé et message actionnable',
      !refus.connecte && refus.ancienChampIntact && refus.aucunDocEcrit && refus.messageRegles, refus);
    await page.context().close();
  }

  /* ============ 8 bis. Identification des produits dans la prépa D300e ============
     L'appariement approché acceptait deux substitutions de caractères pour un
     nom de 8 caractères et plus : « DAR4 » et « DAR8 » ne diffèrent que d'un
     caractère, donc demander du DAR8 renvoyait le stock ET L'EMPLACEMENT du
     DAR4, sous le nom DAR8. Ces cas verrouillent la règle des chiffres. */
  {
    const page = await newPage(browser);
    const essai = async (inventaire, nomFluide) => page.evaluate(async ([inv, fluide]) => {
      state.freezers = [{ id:'F1', name:'Congélateur', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z_RACK', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      state.reagents = [];
      inv.forEach((x, b) => { for (let i = 0; i < x.n; i++) state.reagents.push({
        id: x.nom.replace(/\W/g,'') + i, name: x.nom, type:'Anticorps', lot:'L1', quantity:'30 µL', units:null,
        loc:{ freezerId:'F1', zoneId:'Z_RACK', boxRow:b, boxCol:0, row:i % 9, col:(i/9)|0 } }); });
      state.history = []; saveState();
      view.tab = 'prep'; render();
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('p-clear').click();
      await new Promise(r => setTimeout(r, 200));
      document.getElementById('p-addfluid').click();
      const i2 = document.querySelector('#p-fluidBody tr').querySelectorAll('input');
      i2[0].value = fluide; i2[0].dispatchEvent(new Event('input', { bubbles:true }));
      i2[1].value = 'mère'; i2[1].dispatchEvent(new Event('input', { bubbles:true }));
      i2[2].value = '100';  i2[2].dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 550));
      const carte = document.querySelector('#p-grab .p-grab');
      const txt = e => e ? e.textContent.trim() : null;
      return {
        stock: carte ? txt(carte.querySelector('.stk')) : null,
        position: carte ? txt(carte.querySelector('.p-posbig')) : null,
        approx: carte ? txt(carte.querySelector('.p-approx')) : null,
        aLocaliser: !!document.querySelector('#p-grab .p-locate'),
        choix: Array.from(document.querySelectorAll('#p-grab .p-linksel option')).map(o => o.textContent)
      };
    }, [inventaire, nomFluide]);

    const DAR4 = { nom:'Deruxtecan isotype DAR4', n:13 };
    const DAR8 = { nom:'Deruxtecan isotype DAR8', n:25 };
    const DAR8H = { nom:'Deruxtecan isotype DAR8 hand', n:25 };

    const a = await essai([DAR4, DAR8], 'Deruxtecan isotype DAR8');
    check('prépa : nom exact ⇒ bon stock et bonne boîte',
      /25/.test(a.stock || '') && a.position === 'Niv. 5 · Prof. 1' && !a.approx, a);

    const b = await essai([DAR4, DAR8H], 'Deruxtecan isotype DAR8');
    check('prépa : DAR8 ne se rabat jamais sur DAR4 (chiffres différents)',
      /25/.test(b.stock || '') && b.position === 'Niv. 5 · Prof. 1', b);
    check('prépa : un rapprochement approché est signalé à l’écran',
      /DAR8 hand/.test(b.approx || ''), b);

    const c = await essai([DAR4], 'Deruxtecan isotype DAR8');
    check('prépa : produit absent ⇒ à localiser, jamais de substitution muette',
      c.stock === null && c.aLocaliser && c.choix.some(x => /DAR4/.test(x)), c);

    const d = await essai([{ nom:'Docetaxel', n:7 }], 'Docetaxe');
    check('prépa : une vraie faute de frappe est toujours rattrapée',
      /7/.test(d.stock || '') && /Docetaxel/.test(d.approx || ''), d);

    const e = await essai([{ nom:'ASP3082', n:4 }, { nom:'ASP4396', n:9 }], 'ASP3082');
    check('prépa : deux références numérotées proches restent distinctes',
      /4 /.test((e.stock || '') + ' ') && !/9/.test(e.stock || ''), e);

    // Alias ambigu : deux produits revendiquant « (DAR8) » ne doivent pas
    // faire pointer « dar8 » vers l'un des deux au hasard.
    const f = await essai([{ nom:'Isotype A (DAR8)', n:3 }, { nom:'Isotype B (DAR8)', n:8 }], 'DAR8');
    check('prépa : un alias revendiqué par deux produits est abandonné',
      f.stock === null && f.aLocaliser, f);

    await page.context().close();
  }

  /* ============ 8 ter. Prépa D300e : plus aucune hypothèse muette ============
     Même classe de bug que DAR4/DAR8 : l'app déduisait une quantité, un
     diluant, un volume ou un emplacement sans le dire. */
  {
    const page = await newPage(browser);
    const prep = async (recs, nomFluide, dil) => page.evaluate(async ([rs, fluide, d]) => {
      state.freezers = [{ id:'F1', name:'Congélateur', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      state.reagents = rs; state.history = []; saveState();
      view.tab = 'prep'; render(); await new Promise(r => setTimeout(r, 300));
      document.getElementById('p-clear').click(); await new Promise(r => setTimeout(r, 200));
      document.getElementById('p-addfluid').click();
      const i = document.querySelector('#p-fluidBody tr').querySelectorAll('input');
      i[0].value = fluide; i[0].dispatchEvent(new Event('input', { bubbles:true }));
      i[1].value = d || 'mère'; i[1].dispatchEvent(new Event('input', { bubbles:true }));
      i[2].value = '100'; i[2].dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 600));
      const c = document.querySelector('#p-grab .p-grab');
      const T = e => e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
      return { stock: c && T(c.querySelector('.stk')),
               sub: c && T(c.querySelector('.p-gsub')),
               tubes: c && T(c.querySelector('.p-ntube')),
               dilTube: T(document.querySelector('#p-recipes .p3-tu.dil .p3-tag')),
               warnsRecette: Array.from(document.querySelectorAll('#p-recipes .p-rwarn')).map(T),
               warnsCarte: c ? Array.from(c.querySelectorAll('.p-expwarn')).map(T) : [] };
    }, [recs, nomFluide, dil]);

    const at = (id, nom, q, units, br, bc, col) => ({ id, name:nom, quantity:q, units,
      loc:{ freezerId:'F1', zoneId:'Z', boxRow:br, boxCol:bc, row:0, col:col||0 } });

    // B. une fiche épuisée (units:0) ne compte plus pour un aliquot
    const b = await prep([at('a','Paclitaxel','30 µL',4,0,0,0),
                          at('b','Paclitaxel','30 µL',0,0,0,1),
                          at('c','Paclitaxel','30 µL',0,0,0,2)], 'Paclitaxel');
    check('prépa : une fiche épuisée ne gonfle plus le stock',
      /\b4\b/.test(b.stock || '') && !/\b6\b/.test(b.stock || ''), b);

    // C. volumes différents au même emplacement : le plus petit, et c'est dit
    const c = await prep([at('v1','Olaparib','200 µL',null,0,0,0),
                          at('v2','Olaparib','30 µL',null,0,0,1)], 'Olaparib');
    check('prépa : volumes mélangés ⇒ le plus petit est retenu et signalé',
      /30 µL/.test(c.sub || '') && c.warnsCarte.some(x => /Volumes différents/.test(x) && /30 \/ 200/.test(x)), c);

    // A. diluant inconnu : la valeur par défaut est annoncée comme hypothèse
    const a1 = await prep([at('d1','Docetaxel','30 µL',5,0,0,0)], 'Docetaxel', '1:10');
    const a2 = await prep([at('d2','Cetuximab','30 µL',5,0,0,0)], 'Cetuximab', '1:10');
    const a3 = await prep([at('d3','Molécule maison XYZ-42','30 µL',5,0,0,0)], 'Molécule maison XYZ-42', '1:10');
    check('prépa : diluant connu ⇒ pas d’avertissement',
      a1.dilTube === 'DMSO' && a2.dilTube === 'Tween'
      && !a1.warnsRecette.some(x => /inconnu/.test(x)) && !a2.warnsRecette.some(x => /inconnu/.test(x)),
      { a1, a2 });
    check('prépa : diluant inconnu ⇒ hypothèse annoncée',
      a3.warnsRecette.some(x => /Diluant inconnu/.test(x) && /DMSO/.test(x)), a3);

    // D. le retrait ne sort jamais de l'emplacement choisi
    const d = await page.evaluate(async () => {
      state.freezers = [{ id:'F1', name:'Congélateur', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      state.reagents = [
        { id:'s1', name:'Gemcitabine', quantity:'30 µL', units:null, loc:{freezerId:'F1',zoneId:'Z',boxRow:0,boxCol:0,row:0,col:0} },
        { id:'s2', name:'Gemcitabine', quantity:'30 µL', units:null, loc:{freezerId:'F1',zoneId:'Z',boxRow:3,boxCol:1,row:0,col:0} },
        { id:'s3', name:'Gemcitabine', quantity:'30 µL', units:null, loc:{freezerId:'F1',zoneId:'Z',boxRow:3,boxCol:1,row:0,col:1} }];
      state.history = []; saveState();
      view.tab = 'prep'; render(); await new Promise(r => setTimeout(r, 300));
      document.getElementById('p-clear').click(); await new Promise(r => setTimeout(r, 200));
      document.getElementById('p-addfluid').click();
      const i = document.querySelector('#p-fluidBody tr').querySelectorAll('input');
      i[0].value = 'Gemcitabine'; i[0].dispatchEvent(new Event('input', { bubbles:true }));
      i[1].value = 'mère'; i[1].dispatchEvent(new Event('input', { bubbles:true }));
      i[2].value = '2000'; i[2].dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 600));
      const sel = document.querySelector('#p-grab .p-spotsel');
      const opt = sel && Array.from(sel.options).find(o => /N6/.test(o.textContent));
      if (!sel || !opt) return { erreur: 'sélecteur d’emplacement absent' };
      sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise(r => setTimeout(r, 600));
      const vb = document.getElementById('p-btnValidate');
      if (vb) { vb.click(); await new Promise(r => setTimeout(r, 400));
                const ok = document.getElementById('confirmOk'); if (ok) ok.click(); }
      await new Promise(r => setTimeout(r, 700));
      return { restants: state.reagents.map(r => r.id),
               alerteManque: Array.from(document.querySelectorAll('#toastContainer .toast'))
                 .some(t => /autre bo/i.test(t.textContent)) };
    });
    check('prépa : le retrait ne touche pas une boîte non choisie',
      JSON.stringify(d.restants) === JSON.stringify(['s2','s3']), d);
    check('prépa : le manque à l’emplacement retenu est annoncé', d.alerteManque === true, d);

    await page.context().close();
  }

  /* ============ 8 quater. Cohérence du décompte des aliquots ============
     Pour une même boîte, la carte de groupe annonçait « 5 aliquots » (elle
     comptait les FICHES) et la prépa « 7 en stock » (les vrais aliquots).
     Même forme de confusion que le 13 contre 25 signalé sur le terrain. */
  {
    const page = await newPage(browser);
    const r = await page.evaluate(async () => {
      state.freezers = [{ id:'F1', name:'Congélateur', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      // 3 fiches non suivies + 1 fiche de 4 aliquots + 1 fiche épuisée = 7 aliquots sur 5 positions
      state.reagents = [0,1,2].map(i => ({ id:'u'+i, name:'Sotorasib', lot:'L1', type:'Inh', quantity:'30 µL',
        units:null, loc:{freezerId:'F1',zoneId:'Z',boxRow:0,boxCol:0,row:0,col:i} }));
      state.reagents.push({ id:'u4', name:'Sotorasib', lot:'L1', type:'Inh', quantity:'30 µL', units:4,
        loc:{freezerId:'F1',zoneId:'Z',boxRow:0,boxCol:0,row:0,col:3} });
      state.reagents.push({ id:'u5', name:'Sotorasib', lot:'L1', type:'Inh', quantity:'30 µL', units:0,
        loc:{freezerId:'F1',zoneId:'Z',boxRow:0,boxCol:0,row:0,col:4} });
      state.history = []; saveState();
      view.tab='map'; view.freezerId='F1'; view.zoneId='Z'; view.level='box'; view.boxRow=0; view.boxCol=0;
      render(); await new Promise(r => setTimeout(r, 250));
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      const carte = T(document.querySelector('#boxContents .aliq-count'));
      const stats = T(document.querySelector('#statsPanel .stat-row .val'));
      const volume = T(document.querySelector('#boxContents .aliq-total-line'));
      view.tab='prep'; render(); await new Promise(r => setTimeout(r, 300));
      document.getElementById('p-clear').click(); await new Promise(r => setTimeout(r, 200));
      document.getElementById('p-addfluid').click();
      const i = document.querySelector('#p-fluidBody tr').querySelectorAll('input');
      i[0].value='Sotorasib'; i[0].dispatchEvent(new Event('input',{bubbles:true}));
      i[1].value='mère'; i[1].dispatchEvent(new Event('input',{bubbles:true}));
      i[2].value='100'; i[2].dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r => setTimeout(r, 550));
      const prepa = T(document.querySelector('#p-grab .stk'));
      return { carte, stats, prepa, volume };
    });
    check('décompte : la carte de boîte annonce les aliquots, pas les fiches',
      /^7 aliquots/.test(r.carte || '') && /5 pos/.test(r.carte || ''), r);
    check('décompte : statistiques et prépa donnent le même nombre',
      r.stats === '7' && /\b7\b/.test(r.prepa || ''), r);
    check('décompte : le volume total tient compte des fiches multi-aliquots',
      /210/.test(r.volume || ''), r);
    await page.context().close();
  }

  /* ============ 8 quinquies. Redimensionnement groupé de boîtes ============ */
  {
    const page = await newPage(browser);
    const r = await page.evaluate(async () => {
      state.freezers = [{ id:'F1', name:'Congélateur', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      // 6 fiches dans une boîte, dont 3 hors bornes après passage en 2×2
      state.reagents = [];
      [[0,0],[0,1],[1,0],[8,8],[7,7],[6,6]].forEach((rc, i) => state.reagents.push({
        id:'b'+i, name:'Aliquot '+i, quantity:'30 µL', units:null,
        loc:{ freezerId:'F1', zoneId:'Z', boxRow:0, boxCol:0, row:rc[0], col:rc[1] } }));
      state.history = []; saveState();
      view.tab='map'; view.freezerId='F1'; view.zoneId='Z'; view.level='rack';
      view.selectedBoxes = new Set(['0,0']); render();
      await new Promise(r => setTimeout(r, 200));
      openBulkResizeModal('F1', 'Z');
      document.getElementById('bulkResizeRows').value = 2;
      document.getElementById('bulkResizeCols').value = 2;
      document.getElementById('bulkResizeRows').dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise(r => setTimeout(r, 200));
      const avertissement = (document.getElementById('bulkResizeOrphansWarn')||{}).textContent;
      document.getElementById('btnBulkResizeApply').click();
      await new Promise(r => setTimeout(r, 300));
      const demande = document.getElementById('confirmModal').classList.contains('show');
      const texte = document.getElementById('confirmBody').textContent;
      document.getElementById('confirmCancel').click();
      await new Promise(r => setTimeout(r, 250));
      const intact = state.reagents.length;
      return { avertissement, demande, texte: (texte||'').slice(0,120), intactApresRefus: intact };
    });
    check('redim. groupé : l’avertissement chiffre déplacements ET suppressions',
      /déplacés/.test(r.avertissement || '') && /SUPPRIMÉS/.test(r.avertissement || ''), r);
    check('redim. groupé : confirmation demandée avant de supprimer', r.demande === true, r);
    check('redim. groupé : refuser ne perd aucune fiche', r.intactApresRefus === 6, r);
    await page.context().close();
  }

  /* ============ 8 sexies. Import .tdd de bout en bout ============
     Le moteur D300e (charges par tête, normalisation par backfill) est ici
     verrouillé sur des valeurs recalculées indépendamment, à la main, depuis
     la spécification écrite dans le code. Cela vérifie l'implémentation
     contre sa spécification — pas la spécification contre le vrai dispenseur,
     ce qui demanderait un rapport D300eControl réel. */
  {
    const page = await newPage(browser);
    const NOMS = ['Docetaxel','Gemcitabine','Sotorasib','Olaparib','SN-38',
                  'Staurosporine','Trastuzumab deruxtecan','Datopotamab deruxtecan'];
    await page.evaluate(noms => {
      state.freezers = [{ id:'F1', name:'Congélateur', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      state.reagents = [];
      noms.forEach((n, i) => { for (let k = 0; k < 3; k++) state.reagents.push({ id:'r'+i+k, name:n,
        type:'Composé', lot:'L'+i, quantity:'30 µL', units:null, expiry:'2030-01-01',
        loc:{ freezerId:'F1', zoneId:'Z', boxRow:i % 6, boxCol:(i/6)|0, row:k, col:0 } }); });
      state.history = []; saveState(); view.tab = 'prep'; render();
    }, NOMS);
    await page.waitForTimeout(400);
    await page.setInputFiles('#p-tddfile', { name:'run-demo.tdd', mimeType:'text/xml', buffer: Buffer.from(TDD) });
    await page.waitForTimeout(2200);
    const imp = await page.evaluate(() => {
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      return {
        note: T(document.getElementById('p-parsenote')),
        pastilles: Array.from(document.querySelectorAll('#p-runsrcs .prs-name')).map(T),
        charges: Array.from(document.querySelectorAll('#p-fluidBody tr'))
          .map(tr => parseFloat(tr.querySelectorAll('input')[2].value)),
        vehicules: Array.from(document.querySelectorAll('.p-grab-veh'))
          .map(v => [T(v.querySelector('.p-gname')), T(v.querySelector('.p-ntube'))]),
        cartes: Array.from(document.querySelectorAll('#p-grab .p-grab:not(.p-grab-veh)'))
          .map(c => [T(c.querySelector('.p-gname')), T(c.querySelector('.p-approx'))]),
        aLocaliser: document.querySelectorAll('#p-grab .p-locrow').length
      };
    });
    check('.tdd : les 8 fluides sont importés', imp.charges.length === 8, imp.charges);
    check('.tdd : charges D300e conformes au calcul indépendant',
      JSON.stringify(imp.charges) === JSON.stringify([2,2,2,2,2.8,2.8,4,4]), imp.charges);
    check('.tdd : véhicules de normalisation conformes (DMSO 99 µL, Tween 14 µL)',
      imp.vehicules.length === 2 && imp.vehicules[0][1] === '99' && imp.vehicules[1][1] === '14', imp.vehicules);
    check('.tdd : les 8 produits sont appariés exactement, rien à localiser',
      imp.cartes.length === 8 && imp.cartes.every(c => c[1] === null) && imp.aLocaliser === 0, imp.cartes);
    check('.tdd : le compte-rendu d’import reste affiché', /8 fluides/.test(imp.note || ''), imp.note);
    // le nom affiché est débarrassé de son extension
    check('.tdd : le protocole importé est étiqueté (donc retirable)',
      imp.pastilles.length === 1 && /run-demo/.test(imp.pastilles[0]), imp.pastilles);

    // Valider le run, puis annuler : inventaire ET protocole doivent revenir
    const cycle = await page.evaluate(async () => {
      const avant = state.reagents.length;
      document.getElementById('p-btnValidate').click();
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('confirmOk').click();
      await new Promise(r => setTimeout(r, 900));
      const apresRun = state.reagents.length;
      const fluidesApresRun = document.querySelectorAll('#p-fluidBody tr').length;
      undo();
      await new Promise(r => setTimeout(r, 700));
      view.tab = 'prep'; render();
      await new Promise(r => setTimeout(r, 400));
      return { avant, apresRun, fluidesApresRun,
               apresAnnulation: state.reagents.length,
               fluidesApresAnnulation: document.querySelectorAll('#p-fluidBody tr').length,
               chargesApresAnnulation: Array.from(document.querySelectorAll('#p-fluidBody tr'))
                 .map(tr => parseFloat(tr.querySelectorAll('input')[2].value)) };
    });
    check('run : la validation retire un tube par produit',
      cycle.apresRun === cycle.avant - 8 && cycle.fluidesApresRun === 0, cycle);
    check('run : l’annulation rend les aliquots ET le protocole',
      cycle.apresAnnulation === cycle.avant && cycle.fluidesApresAnnulation === 8
      && JSON.stringify(cycle.chargesApresAnnulation) === JSON.stringify([2,2,2,2,2.8,2.8,4,4]), cycle);
    await page.context().close();
  }

  /* ============ 8 septies. Protocoles multiples et re-dilutions ============
     Fonctions ajoutées après coup : plusieurs .tdd dans un même run avec un
     nombre d'exemplaires par protocole, mémoire des protocoles importés, et
     recettes de re-dilution manuelle avant le Tecan. */
  {
    const page = await newPage(browser);
    const NOMS = ['Docetaxel','Gemcitabine','Sotorasib','Olaparib','SN-38',
                  'Staurosporine','Trastuzumab deruxtecan','Datopotamab deruxtecan'];
    const seed = () => page.evaluate(noms => {
      state.freezers = [{ id:'F1', name:'Congélateur', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      state.reagents = [];
      noms.forEach((n, i) => { for (let k = 0; k < 9; k++) state.reagents.push({ id:'r'+i+k, name:n,
        quantity:'30 µL', units:null, loc:{ freezerId:'F1', zoneId:'Z', boxRow:i % 6, boxCol:(i/6)|0, row:k, col:0 } }); });
      state.history = []; saveState(); view.tab = 'prep'; render();
    }, NOMS);
    const charger = async (nom, mode) => {
      await page.evaluate(m => { document.getElementById('p-tddfile').setAttribute('data-mode', m); }, mode);
      await page.setInputFiles('#p-tddfile', { name:nom, mimeType:'text/xml', buffer: Buffer.from(TDD) });
      await page.waitForTimeout(2000);
    };
    const T2 = () => page.evaluate(() => {
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      return { protocoles: document.querySelectorAll('#p-runsrcs .prs-card').length,
               exemplaires: Array.from(document.querySelectorAll('#p-runsrcs .prs-copies b')).map(T),
               vehicules: Array.from(document.querySelectorAll('.p-grab-veh')).map(v => [T(v.querySelector('.p-gname')), T(v.querySelector('.p-ntube'))]) };
    });

    await seed(); await page.waitForTimeout(300);
    await charger('proto-A.tdd', 'replace');
    const un = await T2();
    check('protocoles : un seul .tdd donne la normalisation de référence',
      un.protocoles === 1 && un.vehicules[0][1] === '99' && un.vehicules[1][1] === '14', un);

    await charger('proto-B.tdd', 'add');
    const deux = await T2();
    check('protocoles : deux .tdd cumulent la normalisation',
      deux.protocoles === 2 && deux.vehicules[0][1] === '198' && deux.vehicules[1][1] === '28', deux);

    const trois = await page.evaluate(async () => {
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      for (let k = 0; k < 2; k++) { document.querySelectorAll('[data-srcinc]')[1].click(); await new Promise(r => setTimeout(r, 450)); }
      return { exemplaires: Array.from(document.querySelectorAll('#p-runsrcs .prs-copies b')).map(T),
               vehicules: Array.from(document.querySelectorAll('.p-grab-veh')).map(v => [T(v.querySelector('.p-gname')), T(v.querySelector('.p-ntube'))]) };
    });
    check('protocoles : les exemplaires d’un protocole ne multiplient que le sien',
      JSON.stringify(trois.exemplaires) === JSON.stringify(['×1','×3'])
      && trois.vehicules[0][1] === '396' && trois.vehicules[1][1] === '56', trois);

    // mémoire des protocoles
    const mem = await page.evaluate(async () => {
      const b = document.getElementById('p-tddmem'); if (!b) return { bouton:false };
      b.click(); await new Promise(r => setTimeout(r, 400));
      const m = document.getElementById('sidePanelModal');
      const noms = Array.from(m.querySelectorAll('.tm-name')).map(e => e.textContent);
      const dansLeRun = m.querySelectorAll('.tm-in').length;
      m.classList.remove('show');
      return { bouton:true, noms, dansLeRun };
    });
    check('protocoles : les .tdd importés sont mémorisés et marqués « dans le run »',
      mem.bouton && mem.noms.length === 2 && mem.dansLeRun === 2, mem);

    // retirer le dernier protocole ne doit pas emporter un fluide manuel
    const retrait = await page.evaluate(async () => {
      document.getElementById('p-clear').click();
      await new Promise(r => setTimeout(r, 300));
      return true;
    });
    await charger('proto-A.tdd', 'replace');
    const survie = await page.evaluate(async () => {
      document.getElementById('p-addfluid').click();
      await new Promise(r => setTimeout(r, 200));
      const trs = document.querySelectorAll('#p-fluidBody tr');
      const i = trs[trs.length-1].querySelectorAll('input');
      i[0].value = 'Produit manuel'; i[0].dispatchEvent(new Event('input', { bubbles:true }));
      i[2].value = '50'; i[2].dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 500));
      const avant = Array.from(document.querySelectorAll('#p-fluidBody tr')).map(tr => tr.querySelectorAll('input')[0].value);
      document.querySelector('[data-srcrm]').click();
      await new Promise(r => setTimeout(r, 800));
      return { avant, apres: Array.from(document.querySelectorAll('#p-fluidBody tr')).map(tr => tr.querySelectorAll('input')[0].value) };
    });
    check('protocoles : retirer le dernier .tdd garde les fluides saisis à la main',
      survie.avant.length === 9 && JSON.stringify(survie.apres) === JSON.stringify(['Produit manuel']), survie);
    await page.context().close();
  }

  /* ============ 8 octies. Re-dilution manuelle avant le Tecan ============ */
  {
    const page = await newPage(browser);
    const graine = await page.evaluate(async () => {
      localStorage.removeItem('cryomap_redil_seeded');
      state.preferences = state.preferences || {}; delete state.preferences.redilRecipes;
      state.freezers = [{ id:'F1', name:'C', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      state.reagents = [];
      for (let k = 0; k < 9; k++) state.reagents.push({ id:'d'+k, name:'Docetaxel', quantity:'30 µL',
        units:null, loc:{ freezerId:'F1', zoneId:'Z', boxRow:0, boxCol:0, row:k, col:0 } });
      state.history = []; saveState();
      const avant = Object.keys((state.preferences||{}).redilRecipes || {}).length;
      view.tab = 'prep'; render();
      await new Promise(r => setTimeout(r, 700));
      return { avant, apres: Object.keys((state.preferences||{}).redilRecipes || {}) };
    });
    check('re-dilutions : les recettes pré-réglées sont bien créées',
      graine.avant === 0 && graine.apres.length === 5 && graine.apres.includes('zolbetuximab'), graine);

    const calc = await page.evaluate(async () => {
      // 10 µL de stock + 70 µL de diluant = 80 µL de solution de travail
      state.preferences.redilRecipes = { docetaxel: { displayName:'Docetaxel', stockConc:20, stockUnit:'mg/mL',
        drawVol:10, pbs:67.6, pbsTween:2.4, finalVol:80, finalConc:2.5, finalUnit:'mg/mL' } };
      saveState();
      document.getElementById('p-clear').click();
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('p-addfluid').click();
      const i = document.querySelector('#p-fluidBody tr').querySelectorAll('input');
      i[0].value = 'Docetaxel'; i[0].dispatchEvent(new Event('input', { bubbles:true }));
      i[1].value = 'mère';      i[1].dispatchEvent(new Event('input', { bubbles:true }));
      // 200 µL de solution de travail demandés ⇒ 3 lots de 80 µL ⇒ 30 µL de stock ⇒ 1 tube
      i[2].value = '200';       i[2].dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 700));
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      const c = document.querySelector('#p-grab .p-grab:not(.p-grab-veh)');
      return { badge: T(c && c.querySelector('.p-redil-badge')),
               totaux: T(c && c.querySelector('.p-redil-tot')),
               court: T(c && c.querySelector('.p-redil-short')),
               tubes: T(c && c.querySelector('.p-ntube')),
               ligneRecette: !!document.querySelector('#p-recipes .p3-step.redil'),
               basVide: /Aucune dilution|No dilution/.test(T(document.getElementById('p-recipes')) || '') };
    });
    // La pre-dilution fabrique la solution de DEPART : ce n'est pas une dilution
    // demandee par le Tecan, elle n'a donc rien a faire dans la liste du bas.
    check('re-dilutions : la pré-dilution ne figure plus dans la liste des dilutions',
      calc.ligneRecette === false && calc.basVide === true, calc);
    // La pré-dilution se prépare autant de fois que le run est lancé : ici une
    // seule fois, donc la recette telle quelle — et surtout pas un multiplicateur
    // déduit du volume à couvrir, qui donnait des ×3 ou ×7 imprévisibles.
    check('re-dilutions : un seul exemplaire affiche la recette telle quelle',
      /10 µL stock/.test(calc.totaux || '') && /70 µL diluant/.test(calc.totaux || '')
      && /80 µL/.test(calc.totaux || '') && !/×/.test(calc.badge || ''), calc);
    // 200 µL demandés par le Tecan, un exemplaire n'en prépare que 80 : on le
    // signale au lieu de gonfler le compte dans le dos de l'opérateur. Le
    // chiffre annoncé est le besoin STRICT (200), pas le besoin majoré de la
    // marge de confort (220) — sinon l'alerte se déclenche pour rien.
    check('re-dilutions : un volume insuffisant est signalé, pas compensé en silence',
      /il en faut 200 µL/.test(calc.court || ''), calc);
    // Les tubes restent comptés sur le STOCK consommé (10 µL), pas sur les 80 µL
    // de solution finale : un seul aliquot de 30 µL suffit.
    check('re-dilutions : les tubes sont comptés sur le stock consommé, pas sur le volume final',
      calc.tubes === '1', calc);

    /* Doubler le protocole doit doubler la pre-dilution. Avant, la carte
       affichait « ×2 » a cote de la recette d'UN lot : l'operateur preparait
       80 µL au lieu de 160. */
    const dbl = await page.evaluate(async () => {
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      const lire = async copies => {
        window.__prepRestore({ plates:1, mode:'serial', excess:10, minPrep:20, maxPrep:50, minPip:1,
          load:2, tubesOv:{}, norm:null, checks:{}, excluded:{}, spotChoice:{}, linkChoice:{},
          sources:[{ id:'s1', name:'astellas.tdd', n:1, copies:copies, norm:null }],
          fluids:[{ drug:'Docetaxel', dil:'mère', load:50, src:'astellas.tdd', srcId:'s1' }] });
        renderPrepTab(document.getElementById('canvas'));
        await new Promise(r => setTimeout(r, 700));
        const c = document.querySelector('#p-grab .p-grab:not(.p-grab-veh)');
        return T(c && c.querySelector('.p-redil-tot'));
      };
      return { un: await lire(1), deux: await lire(2) };
    });
    check('re-dilutions : doubler le protocole double la pré-dilution',
      /10 µL stock/.test(dbl.un || '') && /70 µL diluant/.test(dbl.un || '') && /80 µL/.test(dbl.un || '')
      && /20 µL stock/.test(dbl.deux || '') && /140 µL diluant/.test(dbl.deux || '') && /160 µL/.test(dbl.deux || ''),
      dbl);

    /* La fenêtre « Re-dilutions » édite une recette d'UN lot. Elle doit dire, à
       côté, ce que le run réclame vraiment — nombre de lots et volumes totaux,
       exemplaires compris. */
    const panneau = await page.evaluate(async () => {
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      const lire = async copies => {
        window.__prepRestore({ plates:1, mode:'serial', excess:10, minPrep:20, maxPrep:50, minPip:1,
          load:2, tubesOv:{}, norm:null, checks:{}, excluded:{}, spotChoice:{}, linkChoice:{},
          sources:[{ id:'s1', name:'astellas.tdd', n:1, copies:copies, norm:null }],
          fluids:[{ drug:'Docetaxel', dil:'mère', load:50, src:'astellas.tdd', srcId:'s1' }] });
        renderPrepTab(document.getElementById('canvas'));
        await new Promise(r => setTimeout(r, 700));
        const b = document.querySelector('#p-grab .p-redil-badge'); if (b) b.click();
        await new Promise(r => setTimeout(r, 500));
        const lignes = Array.from(document.querySelectorAll('#sidePanelModal .rd-row'))
          .map(r => ({ nom:(r.querySelector('.rd-name')||{}).value, run:T(r.querySelector('.rd-run')) }))
          .filter(x => x.run);
        document.querySelectorAll('#sidePanelModal').forEach(m => m.classList.remove('show'));
        return lignes;
      };
      return { un: await lire(1), deux: await lire(2) };
    });
    check('re-dilutions : la fenêtre ne montre le run que pour les produits chargés',
      panneau.un.length === 1 && panneau.un[0].nom === 'Docetaxel', panneau);
    // Recette d'un lot : 10 / 67.6 / 2.4 -> 80 µL. Doubler le protocole doit
    // afficher, sous chaque colonne, exactement le double.
    check('re-dilutions : la fenêtre chiffre le run sous chaque colonne, exemplaires compris',
      (panneau.un[0].run || '') === '×1 exemplaire—10 µL67.6 µL2.4 µL80 µL'
      && ((panneau.deux[0]||{}).run || '') === '×2 exemplaires—20 µL135.2 µL4.8 µL160 µL',
      panneau);

    /* Une ligne rouge doit dire POURQUOI sur place : sans le chiffre qui
       manque, l'opérateur ne peut que survoler et deviner. */
    const manque = await page.evaluate(async () => {
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      window.__prepRestore({ plates:1, mode:'serial', excess:10, minPrep:20, maxPrep:50, minPip:1,
        load:2, tubesOv:{}, norm:null, checks:{}, excluded:{}, spotChoice:{}, linkChoice:{},
        sources:[{ id:'s1', name:'a.tdd', n:1, copies:1, norm:null }],
        fluids:[{ drug:'Docetaxel', dil:'mère', load:200, src:'a.tdd', srcId:'s1' }] });
      renderPrepTab(document.getElementById('canvas'));
      await new Promise(r => setTimeout(r, 700));
      const b = document.querySelector('#p-grab .p-redil-badge'); if (b) b.click();
      await new Promise(r => setTimeout(r, 500));
      const ligne = document.querySelector('#sidePanelModal .rd-run.court');
      const out = { rouge: !!ligne, message: T(ligne && ligne.querySelector('.rd-run-msg')) };
      document.querySelectorAll('#sidePanelModal').forEach(m => m.classList.remove('show'));
      return out;
    });
    check('re-dilutions : une ligne rouge écrit le volume qui manque',
      manque.rouge === true && /200 µL/.test(manque.message || '')
      && /80 µL/.test(manque.message || ''), manque);

    /* Le cas signalé par l'utilisateur : le Tecan demande 75,9 µL, un lot en
       fait 80. Il y a de quoi — l'alerte ne doit PAS se déclencher. Elle le
       faisait parce qu'elle comparait à 83,5 µL, soit 75,9 majorés de la marge
       de confort du run. */
    const suffit = await page.evaluate(async () => {
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      window.__prepRestore({ plates:1, mode:'serial', excess:10, minPrep:20, maxPrep:50, minPip:1,
        load:2, tubesOv:{}, norm:null, checks:{}, excluded:{}, spotChoice:{}, linkChoice:{},
        sources:[{ id:'s1', name:'a.tdd', n:1, copies:1, norm:null }],
        fluids:[{ drug:'Docetaxel', dil:'mère', load:75.9, src:'a.tdd', srcId:'s1' }] });
      renderPrepTab(document.getElementById('canvas'));
      await new Promise(r => setTimeout(r, 700));
      const c = document.querySelector('#p-grab .p-grab:not(.p-veh)');
      const alerteCarte = T(c && c.querySelector('.p-redil-short'));
      const b = document.querySelector('#p-grab .p-redil-badge'); if (b) b.click();
      await new Promise(r => setTimeout(r, 500));
      const row = document.querySelector('#sidePanelModal .rd-run');
      const out = { alerteCarte, rouge: !!document.querySelector('#sidePanelModal .rd-run.court'),
                    note: T(row && row.querySelector('.rd-run-note')) };
      document.querySelectorAll('#sidePanelModal').forEach(m => m.classList.remove('show'));
      return out;
    });
    // Rien du tout : ni rouge, ni note. Le volume final d'une recette porte déjà
    // la marge choisie par l'opérateur ; la comparer à celle du run la compterait
    // deux fois.
    check('re-dilutions : 75,9 µL demandés et 80 µL préparés ne disent rien',
      suffit.rouge === false && suffit.alerteCarte === null && suffit.note === null, suffit);

    /* Le changement ne concerne QUE les pré-dilutions : sur un run sans aucune
       recette, la marge du run continue de gouverner dilutions, véhicules,
       tubes et restes. Ces valeurs ont été relevées sur la version d'avant les
       changements (c019210) et sont identiques après. */
    const reste = await page.evaluate(async () => {
      const T = e => e ? e.textContent.replace(/\s+/g,' ').trim() : null;
      state.preferences.redilRecipes = {};             // aucune pré-dilution
      state.reagents = [];
      ['Docetaxel','Paclitaxel','Olaparib'].forEach((n, j) => { for (let i = 0; i < 9; i++)
        state.reagents.push({ id:'x'+j+i, name:n, quantity:'30 µL', units:3,
          loc:{ freezerId:'F1', zoneId:'Z', boxRow:0, boxCol:0, row:i, col:j } }); });
      saveState();
      window.__prepRestore({ plates:1, mode:'serial', excess:10, minPrep:20, maxPrep:50, minPip:1,
        load:2, tubesOv:{}, checks:{}, excluded:{}, spotChoice:{}, linkChoice:{},
        norm:{ dmso:{disp:60,load:50}, tween:{disp:10,load:7}, plates:1 },
        sources:[{ id:'s1', name:'a.tdd', n:6, copies:2,
                   norm:{ dmso:{disp:60,load:50}, tween:{disp:10,load:7}, plates:1 } }],
        fluids:[{ drug:'Docetaxel', dil:'mère', load:40, src:'a.tdd', srcId:'s1' },
                { drug:'Docetaxel', dil:'1:4',  load:40, src:'a.tdd', srcId:'s1' },
                { drug:'Docetaxel', dil:'1:16', load:40, src:'a.tdd', srcId:'s1' },
                { drug:'Paclitaxel', dil:'mère', load:25, src:'a.tdd', srcId:'s1' },
                { drug:'Paclitaxel', dil:'1:10', load:25, src:'a.tdd', srcId:'s1' },
                { drug:'Olaparib', dil:'mère', load:15, src:'a.tdd', srcId:'s1' }] });
      renderPrepTab(document.getElementById('canvas'));
      await new Promise(r => setTimeout(r, 900));
      return {
        dilutions: Array.from(document.querySelectorAll('#p-recipes .p3-step')).map(e =>
          Array.from(e.querySelectorAll('.p3-vol')).map(T).join('|')),
        vehicules: Array.from(document.querySelectorAll('.p-vehs > *')).map(T),
        tubes: Array.from(document.querySelectorAll('#p-grab .p-ntube')).map(T),
        restes: Array.from(document.querySelectorAll('#p-grab .p-gsub')).map(T) };
    });
    check('hors pré-dilutions : dilutions, véhicules, tubes et restes inchangés',
      JSON.stringify(reste.dilutions) === JSON.stringify(['28.1µL|84.2µL|112.2µL','22µL|66µL|88µL','5.5µL|49.5µL|55µL'])
      && JSON.stringify(reste.vehicules) === JSON.stringify(['DMSObackfill 100 µL · dilutions 199.7 µL299.7µL','Tampon + Tweenbackfill 14 µL · dilutions 0 µL14µL'])
      && JSON.stringify(reste.tubes) === JSON.stringify(['4','2','3'])
      && JSON.stringify(reste.restes) === JSON.stringify(['aliquots 30 µL · reste 4 µL','aliquots 30 µL · reste 27 µL','aliquots 30 µL · reste 29.5 µL']),
      reste);
    await page.context().close();
  }

  /* ============ 9. Un deuxième poste rejoint la salle ============ */
  {
    const page = await newPage(browser, true);
    const r = await page.evaluate(async () => {
      __fs.reset(); localStorage.clear();
      __fs.remoteSet('cryomap/equipe', { schema: 2, updatedAt: Date.now() });
      __fs.remoteSet('cryomap/equipe/meta/freezers', { d: JSON.stringify([{ id:'FA', name:'Congélateur A', temp:'-80°C', cols:1, rows:1,
        zones:[{ id:'ZA', name:'Rack', type:'rack', x:0, y:0, w:1, h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }] }]), by:'autre', at: Date.now() });
      for (let i = 0; i < 5; i++) __fs.remoteSet('cryomap/equipe/reagents/r' + i,
        { d: JSON.stringify({ name:'Aliquot '+i, units:i, loc:{ freezerId:'FA', zoneId:'ZA', boxRow:0, boxCol:0, row:0, col:i } }), by:'autre', at: Date.now() });
      const ok = await fbConnect(JSON.stringify({ projectId:'demo', apiKey:'k' }), 'equipe', true);
      await new Promise(r => setTimeout(r, 1600));
      return { ok, aliquots: state.reagents.length, congelateur: state.freezers[0] && state.freezers[0].name,
               stocks: state.reagents.map(x => x.units).sort((a,b)=>a-b) };
    });
    check('un collègue qui rejoint la salle voit tout',
      r.ok && r.aliquots === 5 && r.congelateur === 'Congélateur A'
      && JSON.stringify(r.stocks) === JSON.stringify([0,1,2,3,4]), r);
    await page.context().close();
  }

  /* ---- Cout en lectures Firestore a l'ouverture ----
     Le quota gratuit est de 50 000 documents lus par jour. L'ancienne sequence
     (quatre .get() complets PUIS quatre onSnapshot qui relisaient tout) faisait
     payer deux fois le contenu de la salle a chaque ouverture d'onglet. */
  {
    const page = await newPage(browser, true);
    const r = await page.evaluate(async () => {
      __fs.reset(); localStorage.clear();
      __fs.remoteSet('cryomap/equipe', { schema: 2, updatedAt: Date.now() });
      __fs.remoteSet('cryomap/equipe/meta/freezers', { d: JSON.stringify([{ id:'FA', name:'A', temp:'-80°C', cols:1, rows:1,
        zones:[{ id:'ZA', name:'Rack', type:'rack', x:0, y:0, w:1, h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }] }]), by:'autre', at: Date.now() });
      for (let i = 0; i < 20; i++) __fs.remoteSet('cryomap/equipe/reagents/r' + i,
        { d: JSON.stringify({ name:'Aliquot '+i, units:1, loc:{ freezerId:'FA', zoneId:'ZA', boxRow:0, boxCol:0, row:0, col:i } }), by:'autre', at: Date.now() });
      const nDocs = __fs.count('cryomap/equipe');
      __fs.stats.docReads = 0; __fs.stats.colGets = 0;
      await fbConnect(JSON.stringify({ projectId:'demo', apiKey:'k' }), 'equipe', true);
      await new Promise(r => setTimeout(r, 1600));
      return { nDocs, colGets: __fs.stats.colGets, aliquots: state.reagents.length };
    });
    // Le premier payload de chaque onSnapshot porte deja toute la collection :
    // aucune lecture de collection ne doit plus la precede.
    check('ouvrir l’app ne relit pas les collections en plus des écoutes',
      r.aliquots === 20 && r.colGets === 0, r);
    await page.context().close();
  }

  /* ---- L'ecrasement force laisse un point de retour ---- */
  {
    const page = await newPage(browser, true);
    const r = await page.evaluate(async () => {
      __fs.reset(); localStorage.clear();
      __fs.remoteSet('cryomap/equipe', { schema: 2, updatedAt: Date.now() });
      __fs.remoteSet('cryomap/equipe/meta/freezers', { d: JSON.stringify([{ id:'FA', name:'A', temp:'-80°C', cols:1, rows:1,
        zones:[{ id:'ZA', name:'Rack', type:'rack', x:0, y:0, w:1, h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }] }]), by:'autre', at: Date.now() });
      for (let i = 0; i < 20; i++) __fs.remoteSet('cryomap/equipe/reagents/r' + i,
        { d: JSON.stringify({ name:'Aliquot '+i, units:1, loc:{ freezerId:'FA', zoneId:'ZA', boxRow:0, boxCol:0, row:0, col:i } }), by:'autre', at: Date.now() });
      await fbConnect(JSON.stringify({ projectId:'demo', apiKey:'k' }), 'equipe', true);
      await new Promise(r => setTimeout(r, 1200));

      // Ce poste est EN RETARD : il ne connait que 3 aliquots sur les 20.
      // On modifie l'etat SANS saveState() : sinon la synchro normale
      // propagerait deja la suppression, et il n'y aurait plus rien a forcer.
      state.reagents = state.reagents.slice(0, 3);
      render();

      const p = fbForcePush();
      await new Promise(r => setTimeout(r, 600));
      const texte = document.getElementById('confirmBody').textContent.replace(/\s+/g, ' ');
      document.getElementById('confirmCancel').click();
      await p;
      await new Promise(r => setTimeout(r, 300));

      const bk = listAutoBackups().find(b => /avant écrasement|before overwrite/i.test(b.label || ''));
      let dansLePoint = null;
      try { dansLePoint = JSON.parse(bk.state).reagents.length; } catch (e) {}
      return { texte, cloudEncore: __fs.count('cryomap/equipe/reagents'), dansLePoint,
               local: state.reagents.length };
    });
    check('écrasement forcé : la fenêtre chiffre ce qui sera perdu',
      /20/.test(r.texte) && /\b3\b/.test(r.texte) && /17 aliquot\(s\) seront supprimés/.test(r.texte), r);
    check('écrasement forcé : annuler ne touche à rien',
      r.cloudEncore === 20 && r.local === 3, r);
    check('écrasement forcé : le cloud d’avant est gardé comme point de retour',
      r.dansLePoint === 20, r);
    await page.context().close();
  }

  /* ---- Ctrl+Z survit a un rechargement de l'onglet ---- */
  {
    const page = await newPage(browser);
    await page.evaluate(async () => {
      localStorage.clear();
      state.freezers = [{ id:'F1', name:'C', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      state.reagents = [{ id:'a1', name:'Avant', quantity:'30 µL', units:1,
        loc:{ freezerId:'F1', zoneId:'Z', boxRow:0, boxCol:0, row:0, col:0 } }];
      state.history = []; saveState(); flushPersist();
      await new Promise(r => setTimeout(r, 400));
      pushUndo('Suppression');                   // ecrit aussi le point de retour
      state.reagents = [];
      saveState(); flushPersist();
      await new Promise(r => setTimeout(r, 400));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof render === 'function' && typeof state === 'object', null, { timeout: 20000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(async () => {
      const avant = { pile: undoStack.length, n: state.reagents.length };
      undo();
      await new Promise(r => setTimeout(r, 300));
      return { avant, apres: state.reagents.map(x => x.name) };
    });
    check('l’annulation survit au rechargement de l’onglet',
      r.avant.pile > 0 && r.avant.n === 0 && JSON.stringify(r.apres) === JSON.stringify(['Avant']), r);
    await page.context().close();
  }

  /* ---- Un nom rapproche par approximation ne retire pas de stock tout seul ---- */
  {
    const page = await newPage(browser);
    const r = await page.evaluate(async () => {
      localStorage.clear();
      state.preferences = state.preferences || {};
      state.freezers = [{ id:'F1', name:'C', temp:'-80°C', cols:1, rows:1, zones:[
        { id:'Z', name:'Rack', type:'rack', x:0,y:0,w:1,h:1, rackHeight:6, rackDepth:4, gridRows:9, gridCols:9 }]}];
      state.reagents = [];
      for (let k = 0; k < 6; k++) state.reagents.push({ id:'d'+k, name:'Docetaxel', quantity:'30 µL',
        units:null, loc:{ freezerId:'F1', zoneId:'Z', boxRow:0, boxCol:0, row:k, col:0 } });
      state.history = []; saveState();
      view.tab = 'prep'; render();
      await new Promise(r => setTimeout(r, 700));
      document.getElementById('p-clear').click();
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('p-addfluid').click();
      const i = document.querySelector('#p-fluidBody tr').querySelectorAll('input');
      // « Docetaxol » : une lettre d'ecart, memes chiffres -> rapprochement approche
      i[0].value = 'Docetaxol'; i[0].dispatchEvent(new Event('input', { bubbles:true }));
      i[1].value = 'mère';      i[1].dispatchEvent(new Event('input', { bubbles:true }));
      i[2].value = '50';        i[2].dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 800));

      const badge   = !!document.querySelector('#p-grab .p-approx');
      const bouton  = document.querySelector('#p-grab .p-approx-ok');
      const btn1    = document.getElementById('p-btnValidate');
      const bloque  = !!(btn1 && btn1.disabled);
      const message = (document.querySelector('.p-vbar') || {}).textContent || '';

      if (bouton) bouton.click();
      await new Promise(r => setTimeout(r, 800));
      const btn2 = document.getElementById('p-btnValidate');
      return { badge, bouton: !!bouton, bloque, message: message.replace(/\s+/g,' '),
               debloque: !!(btn2 && !btn2.disabled),
               badgeApres: !!document.querySelector('#p-grab .p-approx') };
    });
    check('un nom rapproché par approximation bloque la validation',
      r.badge && r.bouton && r.bloque && /approximation/.test(r.message), r);
    check('confirmer le rapprochement débloque la validation',
      r.debloque && r.badgeApres === false, r);
    await page.context().close();
  }

  /* ---- La bibliotheque .tdd ne depend plus du seul localStorage ---- */
  {
    const page = await newPage(browser);
    await page.evaluate(async () => {
      localStorage.clear();
      window.__prepLibrary.load([{ id:'t1', name:'protocole-A.tdd',
        fluids:[{ drug:'Docetaxel', dil:'mère', load:2 }], norm:null, savedAt: Date.now() }]);
      await new Promise(r => setTimeout(r, 600));
      // Le miroir disparait : quota atteint, ou nettoyage partiel du navigateur.
      localStorage.removeItem('cryomap-tdd-files-v1');
      localStorage.removeItem('cryomap-tdd-files-v1-rev');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof render === 'function' && typeof state === 'object', null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({
      lib: window.__prepLibrary.dump().map(x => x.name),
      miroirRetabli: localStorage.getItem('cryomap-tdd-files-v1') != null
    }));
    check('les protocoles .tdd survivent à la perte du miroir localStorage',
      JSON.stringify(r.lib) === JSON.stringify(['protocole-A.tdd']) && r.miroirRetabli, r);
    await page.context().close();
  }

  /* ---- La bibliotheque .tdd voyage avec la sauvegarde JSON ---- */
  {
    const page = await newPage(browser);
    const r = await page.evaluate(async () => {
      localStorage.clear();
      window.__prepLibrary.load([{ id:'t9', name:'protocole-B.tdd',
        fluids:[{ drug:'Docetaxel', dil:'mère', load:2 }], norm:null, savedAt: Date.now() }]);
      await new Promise(r => setTimeout(r, 400));

      // Capture du contenu exporte, sans passer par un telechargement reel
      let blob = null;
      const vrai = URL.createObjectURL;
      URL.createObjectURL = b => { blob = b; return vrai.call(URL, b); };
      const vraiRevoke = URL.revokeObjectURL; URL.revokeObjectURL = () => {};
      exportData();
      URL.createObjectURL = vrai; URL.revokeObjectURL = vraiRevoke;
      const dump = JSON.parse(await blob.text());

      // La bibliotheque est dans l'export mais JAMAIS dans state (donc jamais
      // dans la synchro d'equipe).
      const dansState = Object.prototype.hasOwnProperty.call(state, '_prepLibrary');

      // Reimport sur un poste vierge de toute bibliotheque
      window.__prepLibrary.load([]);
      localStorage.removeItem('cryomap-tdd-files-v1');
      localStorage.removeItem('cryomap-tdd-files-v1-rev');
      if (typeof kvSet === 'function') await kvSet('prep:cryomap-tdd-files-v1', { rev: 0, json: '[]' });
      const vide = window.__prepLibrary.dump().length;

      const p = importData(new File([JSON.stringify(dump)], 'bk.json', { type:'application/json' }));
      await new Promise(r => setTimeout(r, 500));
      document.getElementById('confirmOk').click();
      await new Promise(r => setTimeout(r, 800));

      return { exporte: (dump._prepLibrary || []).map(x => x.name), dansState, vide,
               apres: window.__prepLibrary.dump().map(x => x.name),
               etatPropre: !Object.prototype.hasOwnProperty.call(state, '_prepLibrary') };
    });
    check('la bibliothèque .tdd est dans l’export sans polluer l’état synchronisé',
      JSON.stringify(r.exporte) === JSON.stringify(['protocole-B.tdd']) && r.dansState === false, r);
    check('réimporter une sauvegarde restaure les protocoles .tdd',
      r.vide === 0 && JSON.stringify(r.apres) === JSON.stringify(['protocole-B.tdd']) && r.etatPropre, r);
    await page.context().close();
  }

  /* ============ 10. Hygiène CSS ============ */
  {
    const page = await newPage(browser);
    const r = await page.evaluate(() => {
      const sels = [];
      for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch (e) { continue; }
        const walk = l => { for (const x of l) { if (x.cssRules && !x.selectorText) walk(x.cssRules); else if (x.selectorText) sels.push(x.selectorText + '{' + x.style.cssText + '}'); } };
        walk(rs); }
      return { total: sels.length,
               spotsel: sels.some(s => /^\.p-spotsel, \.p-spotsel-warn\{.*max-width/.test(s)),
               vrwrap: sels.some(s => /^\.vr-wrap\{font-size/.test(s)),
               vides: sels.filter(s => /\{\}$/.test(s)).length };
    });
    check('règles avalées par les blocs orphelins de nouveau appliquées',
      r.spotsel && r.vrwrap, r);
    check('aucune règle CSS vide', r.vides === 0, r.vides);
    await page.context().close();
  }

  /* ============ 10 bis. Compatibilité navigateurs ============
     Seul Chromium est installé dans ce conteneur : ces contrôles se font donc
     sur la SOURCE, pas à l'exécution. Ils empêchent la réapparition des
     constructions qui ne marchent que sur un moteur. */
  {
    const src = fs.readFileSync(path.resolve(__dirname, '..', APP_FILE), 'utf8');
    const css = src.split('</style>').slice(0, -1).map(b => b.slice(b.indexOf('<style') >= 0 ? b.indexOf('>', b.indexOf('<style')) + 1 : 0)).join('\n')
                   .replace(/\/\*[\s\S]*?\*\//g, '');   // sans les commentaires

    // Une regle est le texte entre deux accolades : on y cherche la paire.
    const sansPrefixe = prop => {
      const manquants = [];
      const re = new RegExp('(?<!-webkit-)(?<!-moz-)' + prop + '\\s*:', 'g');
      let m;
      while ((m = re.exec(css))) {
        const debut = css.lastIndexOf('{', m.index), fin = css.indexOf('}', m.index);
        const regle = css.slice(debut < 0 ? 0 : debut, fin < 0 ? css.length : fin);
        if (regle.indexOf('-webkit-' + prop) === -1) manquants.push(css.slice(m.index - 40, m.index + 40));
      }
      return manquants;
    };

    // Safari n'a `backdrop-filter` sans prefixe qu'a partir de la 18, et
    // `user-select` qu'a partir de la 17 : sans la version -webkit-, les
    // panneaux perdent leur flou et les libelles redeviennent selectionnables
    // en plein glisser-deposer.
    check('backdrop-filter : la variante -webkit- est toujours présente',
      sansPrefixe('backdrop-filter').length === 0, sansPrefixe('backdrop-filter'));
    check('user-select : la variante -webkit- est toujours présente',
      sansPrefixe('user-select').length === 0, sansPrefixe('user-select'));

    // :has() n'existe pas dans Firefox avant la 121.
    check('aucun sélecteur :has() dans le CSS', css.indexOf(':has(') === -1,
      css.slice(Math.max(0, css.indexOf(':has(') - 60), css.indexOf(':has(') + 60));

    // API trop recentes pour Safari 15/16, encore courant sur les Mac du labo.
    const recentes = ['structuredClone', 'requestIdleCallback', 'crypto.randomUUID',
                      'Object.hasOwn', '.findLast(', '.toSorted(', '.toReversed(',
                      'AbortSignal.timeout', 'Array.fromAsync'];
    const vues = recentes.filter(n => src.indexOf(n) !== -1);
    check('aucune API JS trop récente pour Safari 15', vues.length === 0, vues);

    // Les expressions regulieres a retro-assertion ne marchent pas sur Safari < 16.4.
    check('aucune expression régulière à rétro-assertion', /\(\?<[=!]/.test(src) === false);

    // L'API fichier n'existe que sur Chromium : elle doit rester detectee.
    check('l’API fichier locale reste détectée avant usage',
      /typeof window\.showSaveFilePicker === 'function'/.test(src));
  }

  /* ============ 11. Parcours de fumée ============ */
  {
    const page = await newPage(browser);
    const r = await page.evaluate(async () => {
      loadSampleData();
      await new Promise(r => setTimeout(r, 250));
      const m = document.getElementById('confirmModal');
      if (m.classList.contains('show')) document.getElementById('confirmOk').click();
      await new Promise(r => setTimeout(r, 350));
      const etapes = {};
      const go = (nom, fn) => { try { etapes[nom] = fn(); } catch (e) { etapes[nom] = 'ERREUR: ' + e.message; } };
      go('apercu', () => { view.tab='map'; view.level='overview'; render(); return document.querySelectorAll('#freezerGrid .zone').length > 0; });
      go('rack', () => { view.zoneId = activeFreezer().zones.find(z=>z.type==='rack').id; view.level='rack'; render(); return document.querySelectorAll('.rack-grid-cell').length > 0; });
      go('boite', () => { view.level='box'; view.boxRow=0; view.boxCol=0; render(); return document.querySelectorAll('#positionGrid .grid-cell').length > 0; });
      go('compartiment', () => { view.zoneId = activeFreezer().zones.find(z=>z.type==='compartment').id; view.level='compartment'; render(); return true; });
      go('inventaire', () => { view.tab='inventory'; render(); return document.querySelectorAll('.inv-row').length > 0; });
      go('prepa', () => { view.tab='prep'; render(); return !!document.getElementById('p-grab'); });
      go('recherche', () => { view.tab='map'; view.level='overview'; render(); doSearch('anti'); return document.querySelectorAll('#searchResults .search-result, #searchResults .search-group').length > 0; });
      go('exports', () => { exportData(); exportReagentsCSV(); exportInventoryCSV(); exportLogCsv(); return true; });
      go('palette', () => { cmPalette('anti'); const n = document.querySelectorAll('#cmkList .cmk-row').length; document.getElementById('cmkVeil').click(); return n > 0; });
      go('vue incoherente recalee', () => { view.freezerId = 'inexistant'; view.zoneId = 'inexistant'; view.level = 'box'; render(); return !!activeFreezer(); });
      return etapes;
    });
    Object.entries(r).forEach(([k, v]) => check('parcours : ' + k, v === true, v));
    await page.context().close();
  }

  await browser.close();

  const w = Math.max(...results.map(x => x[1].length));
  results.forEach(([s, n, d]) => console.log(`${s}  ${n.padEnd(w)}${d ? '  ' + d : ''}`));
  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})();
