/* Garde-fou visuel : compare les captures actuelles a l'empreinte de reference
   commitee (tests/shots.sha256). Toute modification du CSS ou du gabarit qui
   change un pixel est signalee, vue par vue.

   Le CSS de CryoMap est volumineux et repose sur beaucoup de `!important` :
   le modifier a l'aveugle est risque. Cette empreinte transforme « risque »
   en « verifiable ».

   node tools/shots-check.js            compare
   node tools/shots-check.js --ecrire   regenere l'empreinte (a commiter)     */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path'), fs = require('fs');

const RACINE = path.resolve(__dirname, '..');
const REF = path.join(RACINE, 'tests', 'shots.sha256');
const DOSSIER = path.join(RACINE, 'out', 'shots');
const ecrire = process.argv.includes('--ecrire');

fs.rmSync(DOSSIER, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(__dirname, 'shots.js'), DOSSIER], { stdio: 'inherit' });

const actuel = {};
for (const f of fs.readdirSync(DOSSIER).sort())
  actuel[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(DOSSIER, f))).digest('hex');

if (ecrire) {
  fs.writeFileSync(REF, Object.entries(actuel).map(([f, h]) => h + '  ' + f).join('\n') + '\n');
  console.log(Object.keys(actuel).length + ' empreintes écrites dans tests/shots.sha256');
  process.exit(0);
}

if (!fs.existsSync(REF)) {
  console.error('Aucune référence : lancez `npm run shots:ref` puis commitez tests/shots.sha256.');
  process.exit(2);
}
const ref = {};
for (const l of fs.readFileSync(REF, 'utf8').split('\n')) {
  const m = l.match(/^([0-9a-f]{64})\s+(.+)$/);
  if (m) ref[m[2]] = m[1];
}

const change = [], nouveau = [], perdu = [];
for (const f of Object.keys(actuel)) {
  if (!(f in ref)) nouveau.push(f);
  else if (ref[f] !== actuel[f]) change.push(f);
}
for (const f of Object.keys(ref)) if (!(f in actuel)) perdu.push(f);

if (!change.length && !nouveau.length && !perdu.length) {
  console.log('\n✓ ' + Object.keys(actuel).length + ' vues identiques à la référence');
  process.exit(0);
}
console.log('\n✗ écarts visuels :');
change.forEach(f => console.log('   modifiée  ' + f + '   (image : out/shots/' + f + ')'));
nouveau.forEach(f => console.log('   nouvelle  ' + f));
perdu.forEach(f => console.log('   manquante ' + f));
console.log('\nSi le changement est voulu : `npm run shots:ref`, vérifiez les images, puis commitez tests/shots.sha256.');
process.exit(1);
