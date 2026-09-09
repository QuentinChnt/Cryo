/*
 * CryoMap — 30 s demo capture.
 *
 * Drives the standalone CryoMap page in a visible Chromium at 1280x800 and
 * records it with Playwright's recordVideo. The scenario follows a fixed
 * timeline (see BEATS) so the resulting clip is always exactly 30 seconds and
 * every action lands on the same second from one run to the next.
 *
 * The page keeps its whole dataset in localStorage, so a fresh browser profile
 * would boot an empty freezer. seed.json (built by tools/build-seed.js) is
 * injected before the app's first paint.
 *
 *   xvfb-run -a --server-args="-screen 0 1400x900x24" node record-demo.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/* demo-page.html is CryoMap-prep-d300e.html with its webfonts inlined; see
   tools/build-page.js. Falls back to the original if it has not been built. */
const PAGE = path.resolve(__dirname, 'demo-page.html');
const HTML = fs.existsSync(PAGE) ? PAGE : path.resolve(__dirname, 'CryoMap-prep-d300e.html');
const SEED = path.resolve(__dirname, 'seed.json');
const OUT_DIR = path.resolve(__dirname, 'out');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const W = 1280, H = 800;
const DURATION = 30000;

/* ------------------------------------------------------------------ *
 * A synthetic pointer. Playwright drives real CDP input events but the
 * OS cursor is not composited into the recording, so the page draws its
 * own dot and the script moves the mouse in small steps to make each
 * gesture readable.
 * ------------------------------------------------------------------ */
const CURSOR_JS = `
  (function () {
    function install() {
      if (document.getElementById('__demo_cursor')) return;
      var c = document.createElement('div');
      c.id = '__demo_cursor';
      c.style.cssText = [
        'position:fixed', 'left:0', 'top:0', 'width:22px', 'height:22px',
        'margin:-11px 0 0 -11px', 'border-radius:50%', 'pointer-events:none',
        'z-index:2147483647', 'opacity:0', 'transition:opacity .2s',
        'background:radial-gradient(circle at 35% 35%, rgba(255,255,255,.95), rgba(79,146,119,.55) 60%, rgba(53,63,58,.15) 100%)',
        'box-shadow:0 0 0 1.5px rgba(53,63,58,.55), 0 2px 10px rgba(53,63,58,.35)'
      ].join(';');
      var r = document.createElement('div');
      r.id = '__demo_ring';
      r.style.cssText = [
        'position:fixed', 'left:0', 'top:0', 'width:22px', 'height:22px',
        'margin:-11px 0 0 -11px', 'border-radius:50%', 'pointer-events:none',
        'z-index:2147483646', 'opacity:0',
        'border:2px solid rgba(79,146,119,.9)'
      ].join(';');
      document.body.appendChild(c);
      document.body.appendChild(r);
      addEventListener('mousemove', function (e) {
        c.style.opacity = '1';
        c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
        r.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
      }, true);
      addEventListener('mousedown', function (e) {
        r.style.transition = 'none';
        r.style.opacity = '.9';
        r.style.width = r.style.height = '22px';
        r.style.margin = '-11px 0 0 -11px';
        requestAnimationFrame(function () {
          r.style.transition = 'width .45s ease-out, height .45s ease-out, margin .45s ease-out, opacity .45s ease-out';
          r.style.width = r.style.height = '64px';
          r.style.margin = '-32px 0 0 -32px';
          r.style.opacity = '0';
        });
      }, true);
    }
    if (document.body) install();
    else addEventListener('DOMContentLoaded', install);
  })();
`;

(async () => {
  if (!fs.existsSync(SEED)) throw new Error('missing ' + SEED + ' — run: node tools/build-seed.js');
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROME,
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars'],
  });

  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: W, height: H } },
  });

  await context.addInitScript(o => {
    localStorage.setItem('cryomap-v3', o.state);
    localStorage.setItem('cryomap-prep-run-v2', o.prep);
    localStorage.setItem('cryomap-v4-seen', '1');   // skip the first-run welcome modal
    localStorage.setItem('cryomap-lang', 'fr');
  }, { state: JSON.stringify(seed.state), prep: JSON.stringify(seed.prep) });
  await context.addInitScript(CURSOR_JS);

  /* Nothing should reach the network: a stalled request would hold up `load`
     and push the whole capture back. */
  await context.route('http://**', r => r.abort());
  await context.route('https://**', r => r.abort());

  const videoStart = Date.now();          // recording begins with the page
  const page = await context.newPage();
  page.on('pageerror', e => console.warn('page error:', e.message));

  console.log('page: ' + HTML);
  await page.goto('file://' + HTML);
  await page.waitForSelector('.freezer-grid .zone[data-zone]', { timeout: 30000 });
  await page.waitForTimeout(1500);            // let fonts and the first paint settle

  /* ---------------- timeline helpers ---------------- */
  let t0 = 0;
  const now = () => Date.now() - t0;
  const at = async ms => {                     // wait until an absolute mark
    const d = ms - now();
    if (d > 0) await page.waitForTimeout(d);
  };
  const log = m => console.log(String(now()).padStart(6) + ' ms  ' + m);

  let mx = W / 2, my = H - 60;

  const ease = p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);   // easeInOutQuad

  /* Glide the pointer instead of teleporting it, so the viewer can follow.
     Driven by the wall clock rather than a step count: each CDP round-trip
     costs more than a frame, so a fixed loop would overrun its budget and
     push the whole timeline out of shape. */
  async function moveTo(x, y, ms = 420) {
    const sx = mx, sy = my, start = Date.now();
    for (;;) {
      const p = Math.min(1, (Date.now() - start) / ms);
      const e = ease(p);
      await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      if (p >= 1) break;
    }
    mx = x; my = y;
  }

  /* Click through the synthetic pointer. The target's box is re-read after the
     travel: modals and lists animate, and a stale box turns a click into a
     miss — which, on a modal, lands on the backdrop and closes it instead. */
  async function clickEl(locator, { travel = 420, settle = 120 } = {}) {
    const el = locator.first();
    await el.waitFor({ state: 'visible', timeout: 8000 });
    let b = await el.boundingBox();
    if (!b) throw new Error('no bounding box for ' + locator);
    await moveTo(b.x + b.width / 2, b.y + b.height / 2, travel);
    b = await el.boundingBox();
    if (b && (Math.abs(b.x + b.width / 2 - mx) > 3 || Math.abs(b.y + b.height / 2 - my) > 3)) {
      await moveTo(b.x + b.width / 2, b.y + b.height / 2, 90);
    }
    await page.waitForTimeout(settle);
    await page.mouse.down();
    await page.waitForTimeout(70);
    await page.mouse.up();
  }

  /* A click that has to take effect. Anything driven by the synthetic pointer
     can be swallowed (an overlay still fading, a re-render between the box
     read and the press), so confirm the expected state and, if it did not
     happen, fall back to a direct dispatch rather than losing the beat. */
  async function clickUntil(locator, check, label, opts = {}) {
    await clickEl(locator, opts);
    try {
      await page.waitForFunction(check, undefined, { timeout: 1200 });
      return;
    } catch (_) { /* fall through */ }
    console.warn('  ! ' + label + ': pointer click did not take, retrying');
    await locator.first().click({ timeout: 4000, force: true });
    await page.waitForFunction(check, undefined, { timeout: 4000 });
  }

  /* Scroll to an absolute offset over a fixed wall-clock duration. */
  async function scrollTo(target, ms = 900) {
    const from = await page.evaluate(() => window.scrollY);
    const start = Date.now();
    for (;;) {
      const p = Math.min(1, (Date.now() - start) / ms);
      await page.evaluate(v => window.scrollTo(0, v), from + (target - from) * ease(p));
      if (p >= 1) break;
    }
  }

  /* =================== the 30 s scenario =================== */
  t0 = Date.now();
  await page.mouse.move(mx, my);

  /* a — 0-4 s : the freezer map, untouched. */
  log('a · carte — plan du congélateur');
  await moveTo(880, 300, 1400);                // a slow drift; no click
  await at(4000);

  /* b — 4-8 s : rack -> box -> aliquot record. */
  const MODAL_OPEN = () => !!document.querySelector('#reagentModal.show');
  const MODAL_SHUT = () => !document.querySelector('#reagentModal.show');

  log('b · rack');
  await clickUntil(page.locator('.zone[data-zone] .zone-header'),
    () => typeof view !== 'undefined' && view.level === 'rack', 'rack', { travel: 500 });
  await at(5300);
  log('b · boîte (Niv. 5 · Prof. 1)');
  await clickUntil(page.locator('.rack-grid-cell[data-boxrow="1"][data-boxcol="0"]'),
    () => typeof view !== 'undefined' && view.level === 'box', 'boîte', { travel: 500 });
  await at(6600);
  log('b · aliquot');
  await clickUntil(page.locator('.grid-cell.filled').first(), MODAL_OPEN, 'aliquot', { travel: 450 });
  await at(8000);

  /* c — 8-11 s : close, search "DXd", open its record. */
  log('c · fermeture de la fiche');
  await clickUntil(page.locator('#reagentModal .modal-close'), MODAL_SHUT, 'fermeture', { travel: 300 });
  await at(8300);
  log('c · recherche');
  await clickEl(page.locator('#searchInput'), { travel: 340, settle: 40 });
  await page.type('#searchInput', 'DXd', { delay: 90 });
  await page.waitForSelector('#searchResults .search-tree-leaf', { timeout: 5000 });
  await at(9150);
  await clickUntil(page.locator('#searchResults .search-tree-leaf'),
    () => typeof view !== 'undefined' && view.level === 'box' && view.boxRow === 0 && view.boxCol === 0,
    'résultat de recherche', { travel: 260, settle: 60 });
  await at(9700);
  log('c · fiche DXd');
  await clickUntil(page.locator('.grid-cell.filled[data-row="0"][data-col="0"]'),
    MODAL_OPEN, 'fiche DXd', { travel: 300, settle: 60 });
  await at(11200);   /* hold on the record long enough to read it */

  /* d — 11-15 s : the Tecan tab. */
  log('d · onglet Tecan');
  await clickUntil(page.locator('#reagentModal .modal-close'), MODAL_SHUT, 'fermeture DXd', { travel: 240 });
  await at(11650);
  await clickUntil(page.locator('#tabPrep'),
    () => typeof view !== 'undefined' && view.tab === 'prep' && !!document.querySelector('.p-pullhead'),
    'onglet Tecan', { travel: 420 });
  await at(15000);

  /* e — 15-21 s : the "à sortir" pick list. */
  const anchor = async (selector, re, pad, what) => {
    const y = await page.evaluate(({ selector, re, pad }) => {
      const el = [...document.querySelectorAll(selector)]
        .find(e => new RegExp(re, 'i').test(e.textContent || ''));
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) - pad : null;
    }, { selector, re, pad });
    if (y == null) throw new Error('anchor not found: ' + what + ' (' + selector + ')');
    return y;
  };

  const pullTop = await anchor('#canvas .p-pullhead', 'sortir', 90, 'liste à sortir');
  log('e · liste « à sortir » (ancre ' + pullTop + ')');
  await moveTo(640, 430, 400);
  await scrollTo(pullTop, 800);
  await at(16600);
  await scrollTo(pullTop + 620, 1500);
  await at(18800);
  await scrollTo(pullTop + 1280, 1500);
  await at(21000);

  /* f — 21-25 s : the dilution recipes. */
  const dilTop = await anchor('#canvas .p-sec', 'dilution', 40, 'recettes de dilution');
  log('f · recettes de dilution (ancre ' + dilTop + ')');
  await scrollTo(dilTop, 1400);
  await at(23200);
  await scrollTo(dilTop + 560, 1300);
  await at(25000);

  /* g — 25-30 s : back to the top. */
  log('g · retour en haut');
  await scrollTo(0, 1800);
  await moveTo(640, 300, 700);
  await at(DURATION);

  log('fin');
  /* The encoder trails the page by a few frames, so hold still past the mark:
     the conversion cuts at exactly DURATION and this keeps the tail from
     being short. */
  await page.waitForTimeout(1500);
  await page.close();
  await context.close();
  await browser.close();

  /* Recording starts when the page is created, so the raw file also holds the
     page load and the settle pause. Report that lead-in; the ffmpeg step trims
     it so the clip opens on the freezer map. */
  const leadIn = (t0 - videoStart) / 1000;

  /* Playwright names the file after the page's guid; expose the newest one. */
  const webm = fs.readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.webm') && f !== 'cryomap-demo.webm')
    .map(f => ({ f, m: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0];
  const final = path.join(OUT_DIR, 'cryomap-demo.webm');
  fs.renameSync(path.join(OUT_DIR, webm.f), final);
  fs.writeFileSync(path.join(OUT_DIR, 'capture.json'),
    JSON.stringify({ video: final, leadIn, duration: DURATION / 1000 }, null, 2));
  console.log('video:   ' + final);
  console.log('lead-in: ' + leadIn.toFixed(3) + ' s (trim this off the front)');
})();
