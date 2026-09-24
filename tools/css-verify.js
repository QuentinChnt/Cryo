/* Compare deux fichiers avec l'oracle de tools/css-oracle.js.
   node tools/css-verify.js <reference.html> <candidat.html>                  */
const { chromium, CHROME, releve } = require('./css-oracle');

(async () => {
  const [A, B] = process.argv.slice(2);
  if (!A || !B) { console.error('usage : node tools/css-verify.js <reference.html> <candidat.html>'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: CHROME });
  const ra = await releve(browser, A, null);
  const rb = await releve(browser, B, ra.props);
  await browser.close();
  const a = ra.empreintes, b = rb.empreintes;
  const ecarts = Object.keys(a).filter(k => a[k] !== b[k]);
  if (!ecarts.length) {
    console.log('IDENTIQUE (' + Object.keys(a).length + ' états, ' + ra.props.length + ' propriétés, boîtes comprises)');
    process.exit(0);
  }
  console.log('ECARTS : ' + ecarts.join(' '));
  process.exit(1);
})();
