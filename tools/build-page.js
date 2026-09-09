/*
 * Builds demo-page.html: the CryoMap page with its webfonts inlined.
 *
 * The original page pulls Inter / Newsreader / JetBrains Mono from Google
 * Fonts and the Firebase SDK from gstatic. During a capture there is no direct
 * egress, so every one of those requests has to time out before `load` fires —
 * about 13 s of dead air, and the app renders in fallback faces meanwhile.
 * Inlining the fonts as data: URIs (and dropping the Firebase tags, which the
 * app only uses once a sync config is entered) makes the capture start fast and
 * look like the real thing.
 *
 *   node tools/build-page.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const SRC = path.join(__dirname, '..', 'CryoMap-prep-d300e.html');
const OUT = path.join(__dirname, '..', 'demo-page.html');

/* Only the subsets the app's French UI actually needs. */
const KEEP_SUBSETS = ['latin', 'latin-ext'];
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
           'Chrome/124.0.0.0 Safari/537.36';

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
const ca = fs.existsSync('/root/.ccr/ca-bundle.crt')
  ? fs.readFileSync('/root/.ccr/ca-bundle.crt') : undefined;

function get(url, binary) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent, ca, headers: { 'User-Agent': UA } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, binary));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(url + ' -> ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

(async () => {
  let html = fs.readFileSync(SRC, 'utf8');

  const linkRe = /<link href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)" rel="stylesheet">/;
  const m = html.match(linkRe);
  if (!m) throw new Error('Google Fonts <link> not found — has the page changed?');
  const cssUrl = m[1].replace(/&amp;/g, '&');

  console.log('fetching ' + cssUrl);
  let css = await get(cssUrl, false);

  /* Drop the @font-face blocks for subsets we do not need, then inline the rest. */
  const blocks = css.split(/(?=\/\* [a-z0-9-]+ \*\/)/).filter(Boolean);
  const kept = blocks.filter(b => {
    const s = (b.match(/^\/\* ([a-z0-9-]+) \*\//) || [])[1];
    return !s || KEEP_SUBSETS.includes(s);
  });
  css = kept.join('');

  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(x => x[1]))];
  console.log('inlining ' + urls.length + ' font files');
  let bytes = 0;
  for (const u of urls) {
    const buf = await get(u, true);
    bytes += buf.length;
    const mime = u.endsWith('.woff2') ? 'font/woff2' : u.endsWith('.woff') ? 'font/woff' : 'font/ttf';
    css = css.split(u).join('data:' + mime + ';base64,' + buf.toString('base64'));
  }
  console.log('font payload: ' + (bytes / 1024).toFixed(0) + ' kB');

  html = html.replace(linkRe, '<style>\n/* webfonts inlined by tools/build-page.js */\n' + css + '\n</style>');
  html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '');
  /* Firebase only comes alive once a sync config is pasted in Settings, so the
     capture does not need it; the tags would just stall the load. */
  html = html.replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>\s*/g, '');

  const left = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(x => x[1]);
  if (left.length) console.log('remaining remote refs: ' + [...new Set(left)].join(', '));

  fs.writeFileSync(OUT, html);
  console.log('wrote ' + OUT + ' (' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + ' MB)');
})();
