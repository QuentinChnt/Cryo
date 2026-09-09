/* Reconstructs a CryoMap dataset matching the layout rendered in the saved
   HTML page (zone names, box sizes, per-box fill counts, compartment
   contents). The saved page keeps only the rendered DOM, not the underlying
   JSON, so the aliquot records themselves are regenerated from the app's own
   drug vocabulary. */
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'CryoMap-prep-d300e.html'), 'utf8');
const zonesDom = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'zones.json'), 'utf8'));

/* deterministic PRNG so the seed - and therefore the video - is reproducible */
let _s = 20240917;
function rnd() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
function pick(a) { return a[Math.floor(rnd() * a.length) % a.length]; }
function uid() { return 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

/* the app's own drug list (DRUGDIL keys) = authentic vocabulary */
const dilBlock = html.slice(html.indexOf('var DRUGDIL={'), html.indexOf('var DRUGALIAS'));
/* the compounds of the seeded D300e run are placed by hand, in exactly one box
   each, so the Tecan pick-list resolves to a single position per product */
const RUN_KEYS = new Set(['dxd', 'sn38', 'sotorasib', 'adagrasib', 'mrtx1133', 'docetaxel',
  'gemcitabine', 'olaparib', 'paclitaxel', '5fu', 'staurosporine', 'doxorubicin']);
const DRUGS = [...dilBlock.matchAll(/"([a-z0-9]+)":"(DMSO|Tween|PBS|Water|H2O|Ethanol|[A-Za-z0-9]+)"/g)]
  .map(m => ({ key: m[1], sol: m[2] }))
  .filter(d => !RUN_KEYS.has(d.key));
const PRETTY = {
  '5fu': '5-FU', 'dxd': 'DXd', 'sn38': 'SN-38', 'mrtx1133': 'MRTX1133', 'rmc6236': 'RMC-6236',
  'rmc6291': 'RMC-6291', 'rmc9805': 'RMC-9805', 'hrs4642': 'HRS-4642', 'tng462': 'TNG462',
  'bi5092': 'BI-5092', 'asp3082': 'ASP3082', 'asp4396': 'ASP4396', 'asp5834': 'ASP5834',
  'bbo10203': 'BBO-10203', 'sgi1027': 'SGI-1027', 'ra70': 'RA-70', 'asym147108': 'ASYM147108',
  'lnmmaacetate': 'L-NMMA acetate', 'mitomycinc': 'Mitomycin C', 'withaferina': 'Withaferin A',
  'staurosporine': 'Staurosporine', 'y27632': 'Y-27632',
  /* the ADC / antibody keys are concatenated words; spell them out so the
     boxes and pick-lists read like a real inventory */
  'adotrastuzumabemtansine': 'Ado-trastuzumab emtansine',
  'cartryfamtrastuzumabderuxtecan': 'Fam-trastuzumab deruxtecan (CAR)',
  'famtrastuzumabderuxtecan': 'Fam-trastuzumab deruxtecan',
  'newfamtrastuzumabderuxtecan': 'Fam-trastuzumab deruxtecan (new)',
  'datopotamabderuxtecan': 'Datopotamab deruxtecan',
  'datopotamabderuxtecanhand': 'Datopotamab deruxtecan (hand)',
  'patritumabderuxtecan': 'Patritumab deruxtecan',
  'patritumabderuxtecanhand': 'Patritumab deruxtecan (hand)',
  'sacituzumabgovitecan': 'Sacituzumab govitecan',
  'sacituzumabisotype': 'Sacituzumab isotype',
  'tusamitamabravtansine': 'Tusamitamab ravtansine',
  'tusamitamabisotypedar4': 'Tusamitamab isotype DAR4',
  'deruxtecanisotypedar4': 'Deruxtecan isotype DAR4',
  'deruxtecanisotypedar4hand': 'Deruxtecan isotype DAR4 (hand)',
  'deruxtecanisotypedar8': 'Deruxtecan isotype DAR8',
  'deruxtecanisotypedar8hand': 'Deruxtecan isotype DAR8 (hand)',
  'asymisotypedar8': 'ASYM isotype DAR8',
  'trifluridinetipiracil': 'Trifluridine/tipiracil',
  'zolbetuximab': 'Zolbetuximab',
  'lnmmaacetate': 'L-NMMA acetate',
};
function pretty(k) { return PRETTY[k] || k.charAt(0).toUpperCase() + k.slice(1); }

const OWNERS = ['RP', 'QC', 'AL', 'MB', 'SD', 'JF'];
const TYPES = ['ADC', 'Chimio', 'TKI', 'Payload', 'Contrôle', 'Anticorps'];
const CONC = ['10 mM', '5 mM', '2 mM', '1 mM', '20 mM', '500 µM'];
const VOLS = ['20 µL', '50 µL', '100 µL', '250 µL', '30 µL'];
function dstr(offsetDays) {
  const d = new Date(2026, 8, 9); d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function lot() { return 'L' + (100000 + Math.floor(rnd() * 899999)); }

/* ---------- freezer + zones, mirroring the saved layout ---------- */
const zoneSpec = [
  { name: 'Rack Up 1',         type: 'rack',        x: 0, y: 0, w: 1, h: 1 },
  { name: 'Rack Up 2',         type: 'rack',        x: 1, y: 0, w: 1, h: 1 },
  { name: 'Compartment Up',    type: 'compartment', x: 2, y: 0, w: 1, h: 1 },
  { name: 'Compartment Down',  type: 'compartment', x: 0, y: 1, w: 2, h: 1 },
  { name: 'Rack down',         type: 'rack',        x: 2, y: 1, w: 1, h: 1 },
];
const fId = uid();
const zones = zoneSpec.map(spec => {
  const dom = zonesDom.find(z => z.name === spec.name);
  const z = { id: uid(), name: spec.name, type: spec.type, x: spec.x, y: spec.y, w: spec.w, h: spec.h };
  if (spec.type === 'rack') {
    z.rackHeight = 6; z.rackDepth = 4; z.gridRows = 9; z.gridCols = 9;
    z.boxes = {};
    dom.cubes.forEach(c => {
      const m = c.title.match(/\((\d+)×(\d+)\)/);
      if (m) z.boxes[`${c.boxRow},${c.boxCol}`] = { gridRows: +m[1], gridCols: +m[2] };
    });
    if (!Object.keys(z.boxes).length) delete z.boxes;
    z._cubes = dom.cubes.map(c => ({
      boxRow: c.boxRow, boxCol: c.boxCol,
      n: +(c.title.match(/—\s*(\d+)\//) || [0, 0])[1],
      rows: +((c.title.match(/\((\d+)×(\d+)\)/) || [0, 9])[1]),
      cols: +((c.title.match(/\((\d+)×(\d+)\)/) || [0, 0, 9])[2]),
    }));
  } else {
    z.gridRows = 4; z.gridCols = 4; z.compBoxes = [];
  }
  return z;
});

/* ---------- aliquots in the racks ---------- */
const reagents = [];
function addRackAliquot(z, boxRow, boxCol, row, col, drug) {
  const name = pretty(drug.key);
  reagents.push({
    id: uid(), name,
    alias: '', code: '', type: pick(TYPES), lot: lot(),
    quantity: pick(VOLS), expiry: dstr(120 + Math.floor(rnd() * 700)),
    aliquotDate: dstr(-30 - Math.floor(rnd() * 500)),
    owner: pick(OWNERS), notes: '', units: null, lowThreshold: null,
    loc: { freezerId: fId, zoneId: z.id, boxRow, boxCol, row, col },
  });
}
zones.filter(z => z.type === 'rack').forEach(z => {
  z._cubes.forEach(cube => {
    const cells = [];
    for (let r = 0; r < cube.rows; r++) for (let c = 0; c < cube.cols; c++) cells.push([r, c]);
    /* a box normally holds a handful of compounds, columns filled in order */
    const palette = [];
    const nDistinct = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < nDistinct; i++) palette.push(pick(DRUGS));
    for (let i = 0; i < cube.n && i < cells.length; i++) {
      addRackAliquot(z, cube.boxRow, cube.boxCol, cells[i][0], cells[i][1],
        palette[Math.floor(i / Math.max(1, Math.ceil(cube.n / nDistinct))) % palette.length]);
    }
  });
  delete z._cubes;
});

/* ---------- Compartment Up : one box + the loose items seen in the DOM ---------- */
const compUp = zones.find(z => z.name === 'Compartment Up');
const mgBox = { id: uid(), name: 'Matrigel U', slotRow: 0, slotCol: 1, gridRows: 9, gridCols: 9 };
compUp.compBoxes.push(mgBox);
for (let i = 0; i < 21; i++) {
  reagents.push({
    id: uid(), name: 'Matrigel U - Cultrex', alias: 'Matrigel U', code: '', type: 'ECM',
    lot: 'BME001-10', quantity: '1 mL', expiry: dstr(200 + i * 3), aliquotDate: dstr(-60),
    owner: 'RP', notes: '', units: null, lowThreshold: null,
    loc: { freezerId: fId, zoneId: compUp.id, compBoxId: mgBox.id, row: Math.floor(i / 9), col: i % 9, shape: 'vial' },
  });
}
[
  { name: 'FBS', qty: '', cellRow: 0, cellCol: 0, shape: 'bottle' },
  { name: 'Y-27632 (Rock inhibitor)', alias: 'Y', qty: '', cellRow: 0, cellCol: 2, shape: 'tube' },
  { name: 'VYLOY/ZOLBETUXIMAB', qty: '250uL', cellRow: 0, cellCol: 3, shape: 'tube' },
  { name: 'ASP 546C', qty: '300 uL', cellRow: 1, cellCol: 0, shape: 'tube' },
  { name: 'Payload 546C', qty: '1 mL', cellRow: 1, cellCol: 1, shape: 'tube' },
  { name: 'Payload 546C', qty: '10 uL', cellRow: 1, cellCol: 2, shape: 'tube' },
].forEach(it => {
  reagents.push({
    id: uid(), name: it.name, alias: it.alias || '', code: '', type: 'ADC', lot: lot(),
    quantity: it.qty, expiry: dstr(300), aliquotDate: dstr(-40), owner: 'RP', notes: '',
    units: null, lowThreshold: null,
    loc: { freezerId: fId, zoneId: compUp.id, cellRow: it.cellRow, cellCol: it.cellCol, shape: it.shape },
  });
});

/* ---------- make sure the compounds the demo shows are present and rich ---------- */
const rackUp2 = zones.find(z => z.name === 'Rack Up 2');
function forceInto(zone, boxRow, boxCol, row, col, rec) {
  const i = reagents.findIndex(r => r.loc.zoneId === zone.id && r.loc.boxRow === boxRow &&
    r.loc.boxCol === boxCol && r.loc.row === row && r.loc.col === col);
  const loc = { freezerId: fId, zoneId: zone.id, boxRow, boxCol, row, col };
  const full = Object.assign({ id: uid(), alias: '', code: '', notes: '', units: null, lowThreshold: null }, rec, { loc });
  if (i >= 0) reagents[i] = full; else reagents.push(full);
  return full;
}
/* DXd — the record the video opens from the search bar */
forceInto(rackUp2, 0, 0, 0, 0, {
  name: 'DXd', alias: 'Deruxtecan payload', code: 'DXD-01', type: 'Payload',
  lot: 'L442071', quantity: '20 µL', expiry: dstr(430), aliquotDate: dstr(-92),
  owner: 'QC', units: 12, lowThreshold: 4,
  notes: 'Charge topo-I d’un ADC (trastuzumab deruxtecan). Mère 10 mM dans DMSO. Sensible à la lumière — décongeler à l’abri, éviter les cycles répétés.',
});
for (let i = 1; i < 9; i++) {
  forceInto(rackUp2, 0, 0, 0, i, {
    name: 'DXd', alias: 'Deruxtecan payload', code: 'DXD-01', type: 'Payload',
    lot: 'L442071', quantity: '20 µL', expiry: dstr(430), aliquotDate: dstr(-92), owner: 'QC',
  });
}
/* the other fluids of the seeded Tecan run, so each one resolves to a position */
const runDrugs = [
  ['SN-38', 'Payload', 'QC'], ['Sotorasib', 'TKI', 'AL'], ['Adagrasib', 'TKI', 'AL'],
  ['MRTX1133', 'TKI', 'MB'], ['Docetaxel', 'Chimio', 'RP'], ['Gemcitabine', 'Chimio', 'RP'],
  ['Olaparib', 'TKI', 'SD'], ['Paclitaxel', 'Chimio', 'RP'], ['5-FU', 'Chimio', 'RP'],
  ['Staurosporine', 'Contrôle', 'QC'], ['Trastuzumab deruxtecan', 'ADC', 'QC'],
  ['Doxorubicin', 'Chimio', 'MB'],
];
runDrugs.forEach((d, i) => {
  const boxCol = 1 + (i % 3), boxRow = Math.floor(i / 3);
  for (let k = 0; k < 6; k++) {
    forceInto(rackUp2, boxRow, boxCol, 0, k, {
      name: d[0], type: d[1], owner: d[2], lot: lot(), quantity: '25 µL',
      expiry: dstr(250 + i * 11), aliquotDate: dstr(-70 - i * 3),
    });
  }
});

/* ---------- history ---------- */
const now = Date.now();
const history = [
  { ts: now - 8 * 60000,             key: 'historyBulkDelete',  vars: { n: 10, s: 's' },                    who: 'RP' },
  { ts: now - 9 * 60000,             key: 'historyAddReagent',  vars: { name: 'Test' },                     who: 'RP' },
  { ts: now - 5 * 3600000,           key: 'historyAddAliquot',  vars: { name: 'Matrigel R' },               who: 'RP' },
  { ts: now - 5 * 3600000 - 60000,   key: 'historyAddAliquot',  vars: { name: 'Matrigel R' },               who: 'RP' },
  { ts: now - 5 * 3600000 - 120000,  key: 'historyAddAliquot',  vars: { name: 'Matrigel R' },               who: 'RP' },
  { ts: now - 26 * 3600000,          key: 'historyAddAliquot',  vars: { name: 'DXd' },                      who: 'QC' },
  { ts: now - 30 * 3600000,          key: 'historyEditReagent', vars: { name: 'Trastuzumab deruxtecan' },   who: 'QC' },
  { ts: now - 52 * 3600000,          key: 'historyImport',      vars: { nF: 1, sF: '', nR: 2539, sR: 's' }, who: 'RP' },
];

const state = {
  freezers: [{ id: fId, name: 'Contract Freezer', temp: '-80°C', cols: 3, rows: 2, zones }],
  reagents, history,
  preferences: { colorByType: false, initials: 'QC' },
};

/* ---------- Tecan / D300e run ---------- */
const srcId = 'src' + Date.now().toString(36);
const F = (drug, dil, load, sol, conc, unit) => ({ drug, dil, load, sol, conc, unit, src: 'ORAKL_PDO_panel_S38.tdd', srcId });
const prep = {
  plates: 3, mode: 'serial', excess: 10, minPrep: 20, maxPrep: 50, minPip: 1, load: 2,
  tubesOv: {}, norm: { fluid: 'DMSO', vol: 8.4 }, excluded: {},
  sources: [{ id: srcId, name: 'ORAKL_PDO_panel_S38.tdd', n: 13 }],
  fluids: [
    F('DXd', '1:100', 6.2, 'DMSO', 10, 'mM'),
    F('SN-38', '1:50', 4.8, 'DMSO', 10, 'mM'),
    F('Trastuzumab deruxtecan', 'mère', 11.4, 'Tween', 5, 'mM'),
    F('Sotorasib', '1:20', 7.1, 'DMSO', 20, 'mM'),
    F('Adagrasib', '1:20', 6.9, 'DMSO', 20, 'mM'),
    F('MRTX1133', '1:10', 9.3, 'DMSO', 10, 'mM'),
    F('Docetaxel', '1:200', 3.6, 'DMSO', 10, 'mM'),
    F('Paclitaxel', '1:200', 3.4, 'DMSO', 10, 'mM'),
    F('Gemcitabine', '1:25', 8.2, 'DMSO', 10, 'mM'),
    F('5-FU', 'mère', 14.7, 'DMSO', 100, 'mM'),
    F('Olaparib', '1:10', 10.1, 'DMSO', 10, 'mM'),
    F('Doxorubicin', '1:40', 5.5, 'DMSO', 10, 'mM'),
    F('Staurosporine', '1:500', 2.2, 'DMSO', 1, 'mM'),
  ],
};

fs.writeFileSync(require('path').join(__dirname, '..', 'seed.json'), JSON.stringify({ state, prep }));
console.log('reagents:', reagents.length);
console.log('per zone:', zones.map(z => z.name + '=' + reagents.filter(r => r.loc.zoneId === z.id).length).join(', '));
console.log('DXd records:', reagents.filter(r => r.name === 'DXd').length);
