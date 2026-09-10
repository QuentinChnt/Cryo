/* Suite de régression CryoMap — Playwright, sans cadre de test externe.
   Chaque cas reproduit un bug réellement observé puis vérifie sa correction.
   Lancement :  npm test          (ou  node tests/regression.js)            */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP = 'file://' + path.resolve(__dirname, '..', 'CryoMap-prep-d300e.html');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const CHROME = process.env.CHROMIUM_PATH || undefined;

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
