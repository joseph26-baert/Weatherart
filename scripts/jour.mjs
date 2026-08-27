// Fixe l'œuvre du jour de chaque ville (mémoire partagée), exécuté par GitHub Actions toutes les heures.
import fs from 'node:fs';
import { meteoVilles, calculerToutes, VILLES_DEFAUT } from '../engine/journee.js';

const oeuvres = JSON.parse(fs.readFileSync(new URL('../data/oeuvres.json', import.meta.url))).oeuvres;
const path = new URL('../data/jour.json', import.meta.url);
const jour = JSON.parse(fs.readFileSync(path, 'utf8') || '{}');

const donnees = await meteoVilles(VILLES_DEFAUT);
const R = calculerToutes(oeuvres, VILLES_DEFAUT, donnees, jour);
let ajouts = 0;
for (const v of VILLES_DEFAUT) {
  const r = R.get(v.nom); if (!r) continue;
  const k = `${v.nom.toUpperCase()}+${r.dateISO}`;
  if (!jour[k]) { jour[k] = { id: r.jour.oeuvre.id, artiste: r.jour.oeuvre.artiste, categorie: r.jour.oeuvre.categorie, echo: r.jour.echo, meteo: r.jour.meteo, fixe_le: new Date().toISOString() }; ajouts++; }
}
// on garde 60 jours d'historique
const limite = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
for (const k of Object.keys(jour)) if (k.slice(-10) < limite) delete jour[k];
fs.writeFileSync(path, JSON.stringify(jour, null, 1));
console.log(`${ajouts} œuvre(s) fixée(s) ; ${Object.keys(jour).length} entrées.`);
