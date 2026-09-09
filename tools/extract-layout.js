/*
 * Reads the freezer layout out of the saved CryoMap page and writes it to
 * tools/zones.json: zone names, grid positions, and for each rack box its
 * dimensions and how full it is. tools/build-seed.js rebuilds a dataset from
 * this so the app redraws the same map it was saved with.
 *
 *   node tools/extract-layout.js
 */

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'CryoMap-prep-d300e.html'), 'utf8');
// isolate the rendered freezerGrid
const gi = html.indexOf('<div class="freezer-grid" id="freezerGrid"');
const grid = html.slice(gi, html.indexOf('<aside class="detail"', gi));
const zoneRe = /<div class="zone (zone-rack|zone-comp)" style="grid-column:(\d+) \/ span (\d+);grid-row:(\d+) \/ span (\d+)" data-zone="([^"]+)">([\s\S]*?)(?=<div class="zone zone-|$)/g;
let m, zones = [];
while ((m = zoneRe.exec(grid))) {
  const [, kind, col, cspan, row, rspan, id, body] = m;
  const name = (body.match(/<span class="zone-name">([^<]*)<\/span>/) || [])[1];
  const badge = (body.match(/<span class="zone-badge[^"]*">([^<]*)<\/span>/) || [])[1];
  const cubes = [];
  const cubeRe = /data-boxrow="(\d+)" data-boxcol="(\d+)"[\s\S]{0,200}?<title>([^<]*)<\/title>/g;
  let c;
  while ((c = cubeRe.exec(body))) cubes.push({ boxRow: +c[1], boxCol: +c[2], title: c[3] });
  zones.push({ kind, col: +col, cspan: +cspan, row: +row, rspan: +rspan, id, name, badge, cubes, bodyLen: body.length });
}
fs.writeFileSync(path.join(__dirname, 'zones.json'), JSON.stringify(zones, null, 2));
console.log('wrote ' + path.join(__dirname, 'zones.json') + ' — ' + zones.length + ' zones');
