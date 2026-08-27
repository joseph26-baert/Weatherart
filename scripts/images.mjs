// Copie locale des images (domaine public) : téléchargement + réduction, exécuté par GitHub Actions.
import fs from 'node:fs';
import sharp from 'sharp';
const oeuvres = JSON.parse(fs.readFileSync(new URL('../data/oeuvres.json', import.meta.url))).oeuvres;
const dir = new URL('../images/', import.meta.url); fs.mkdirSync(dir, { recursive: true });
const manifestPath = new URL('../images/manifest.json', import.meta.url);
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const UA = 'WeatherArt/1.0 (site culturel non commercial ; images du domaine public)';
let ok = 0, ko = 0;
for (const o of oeuvres) {
  if (manifest[o.id]) continue;
  const cand = [o.image.url, o.image.url_petite].filter(u => u && /^https?:/.test(u) && !/rijksmuseum\.nl\/en\/collection/.test(u));
  let done = false;
  for (const u of cand) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'image/*' }, redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const img = sharp(buf, { failOn: 'none' }).rotate();
      const meta = await img.metadata(); if (!meta.width) throw new Error('image illisible');
      await img.resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(new URL(o.id + '.jpg', dir));
      manifest[o.id] = { source: u, largeur: Math.min(meta.width, 1400), date: new Date().toISOString().slice(0, 10) };
      ok++; done = true; break;
    } catch (e) { console.log('échec', o.id, u.slice(0, 80), '→', e.message); }
    await new Promise(r => setTimeout(r, 300));
  }
  if (!done) ko++;
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`${ok} image(s) copiée(s), ${ko} échec(s), ${Object.keys(manifest).length} au total.`);
