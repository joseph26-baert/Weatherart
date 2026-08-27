// Copie locale des images (domaine public) : téléchargement + réduction, exécuté par GitHub Actions.
import fs from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const oeuvres = JSON.parse(fs.readFileSync(new URL('../data/oeuvres.json', import.meta.url))).oeuvres;
const dir = new URL('../images/', import.meta.url); fs.mkdirSync(dir, { recursive: true });
const manifestPath = new URL('../images/manifest.json', import.meta.url);
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const UA = 'WeatherArtBot/1.0 (https://joseph26-baert.github.io/Weatherart/ ; images du domaine public)';
const UA_NAV = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const rapport = [];
const dodo = ms => new Promise(r => setTimeout(r, ms));
async function telecharger(u) {
  const wikimedia = /wikimedia\.org/.test(u); const artic = /artic\.edu/.test(u);
  for (let essai = 1; essai <= 3; essai++) {
    const r = await fetch(u, { headers: { 'User-Agent': artic ? UA_NAV : UA, 'Accept': 'image/*,*/*' }, redirect: 'follow' }).catch(e => ({ ok: false, status: 'réseau: ' + e.message }));
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status === 429) { await dodo(20000 * essai); continue; }
    if (essai < 2) { await dodo(4000); continue; }
    throw new Error('HTTP ' + r.status);
  }
  throw new Error('HTTP 429 (persistant)');
}
let ok = 0, ko = 0;
for (const o of oeuvres) {
  if (manifest[o.id]) continue;
  const cand = [o.image.url, o.image.url_petite].filter(u => u && /^https?:/.test(u) && !/rijksmuseum\.nl\/en\/collection/.test(u));
  let done = false;
  for (const u of cand) {
    try {
      const buf = await telecharger(u);
      const img = sharp(buf, { failOn: 'none' }).rotate();
      const meta = await img.metadata(); if (!meta.width) throw new Error('image illisible');
      await img.resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(fileURLToPath(new URL(o.id + '.jpg', dir)));
      manifest[o.id] = { source: u, largeur: Math.min(meta.width, 1400), date: new Date().toISOString().slice(0, 10) };
      ok++; done = true; break;
    } catch (e) { const msg = 'échec ' + o.id + ' ' + u.slice(0, 90) + ' → ' + (e && e.message); console.log(msg); rapport.push(msg); }
    await dodo(400);
  }
  if (!done) ko++; else await dodo(/wikimedia/.test(manifest[o.id]?.source||'') ? 1500 : 400);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
rapport.push(`bilan: ${ok} ok, ${ko} échecs, ${Object.keys(manifest).length} total`);
fs.writeFileSync(new URL('../images/rapport.txt', import.meta.url), rapport.join('\n'));
console.log(`${ok} image(s) copiée(s), ${ko} échec(s), ${Object.keys(manifest).length} au total.`);
