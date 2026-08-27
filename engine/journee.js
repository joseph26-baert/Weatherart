// Weather Art — calcul déterministe d'une œuvre par ville et par jour, identique pour tous les visiteurs, sans serveur.
// Dépend de engine.js (profilMeteo, choisirOeuvre, phraseEcho).

import { profilMeteo, choisirOeuvre, phraseEcho } from './engine.js';

export const VILLES_DEFAUT = [
  { nom: 'Genève', lat: 46.2044, lon: 6.1432 }, { nom: 'Paris', lat: 48.8566, lon: 2.3522 }, { nom: 'Londres', lat: 51.5072, lon: -0.1276 },
  { nom: 'Rome', lat: 41.9028, lon: 12.4964 }, { nom: 'Tokyo', lat: 35.6762, lon: 139.6503 }, { nom: 'New York', lat: 40.7128, lon: -74.006 }, { nom: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
];
const JOURS_HISTO = 7;

/** Une requête Open-Meteo pour plusieurs villes : 7 jours passés + aujourd'hui, quotidien + horaire. */
export async function meteoVilles(villes, fetchImpl = fetch) {
  const params = new URLSearchParams({
    latitude: villes.map(v => v.lat).join(','), longitude: villes.map(v => v.lon).join(','),
    timezone: 'auto', past_days: String(JOURS_HISTO), forecast_days: '1',
    current: 'temperature_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weather_code,wind_speed_10m_max,sunrise,sunset',
    hourly: 'temperature_2m,apparent_temperature,precipitation,snowfall,weather_code,cloud_cover,wind_speed_10m,relative_humidity_2m,is_day',
  });
  const r = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!r.ok) throw new Error('météo indisponible (' + r.status + ')');
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}

const arr = (a, i) => (a && a[i] != null) ? a[i] : null;
const moy = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const mode = xs => { const c = {}; let best = null; for (const x of xs) { c[x] = (c[x] || 0) + 1; if (best == null || c[x] > c[best]) best = x; } return best == null ? null : Number(best); };
const r1 = x => x == null ? null : Math.round(x);           // arrondi pour la stabilité entre visiteurs
const r5 = x => x == null ? null : Math.round(x * 2) / 2;

/** Bilan météo d'une période (heures locales [h0,h1[) d'un jour donné, au format attendu par profilMeteo. */
function bilan(d, jourIdx, h0, h1, periode) {
  const H = d.hourly; const t = H.time;
  const idx = []; for (let i = 0; i < t.length; i++) { const day = t[i].slice(0, 10), h = Number(t[i].slice(11, 13)); if (day === d.daily.time[jourIdx] && h >= h0 && h < h1) idx.push(i); }
  const pick = k => idx.map(i => H[k][i]).filter(x => x != null);
  const temps = pick('temperature_2m'), ress = pick('apparent_temperature');
  const precip = pick('precipitation').reduce((a, b) => a + b, 0), neige = pick('snowfall').reduce((a, b) => a + b, 0);
  const codes = pick('weather_code');
  // code dominant, mais on garde la pluie/orage/neige si présents une bonne partie du temps
  let code = mode(codes) ?? arr(d.daily.weather_code, jourIdx) ?? 3;
  const grave = codes.filter(c => c >= 51).length;
  if (grave >= Math.max(2, codes.length * 0.3)) code = Math.max(...codes.filter(c => c >= 51));
  return {
    temp: r1(moy(temps)), temp_ressentie: r1(moy(ress)),
    temp_max: r1(periode === 'jour' ? arr(d.daily.temperature_2m_max, jourIdx) : Math.max(...temps)),
    temp_min: r1(periode === 'jour' ? arr(d.daily.temperature_2m_min, jourIdx) : Math.min(...temps)),
    precip_mm: r5(precip), neige_cm: r5(neige),
    nuages_pct: Math.round((moy(pick('cloud_cover')) ?? 50) / 10) * 10,
    vent_kmh: Math.round((moy(pick('wind_speed_10m')) ?? 10) / 5) * 5,
    humidite_pct: Math.round((moy(pick('relative_humidity_2m')) ?? 60) / 10) * 10,
    code_wmo: code, is_day: periode === 'jour' ? 1 : 0,
  };
}

/** Heure locale de la ville (Open-Meteo renvoie current.time en heure locale). */
function periodeActuelle(d) {
  const now = d.current.time;                                   // 'YYYY-MM-DDTHH:MM' local
  const today = now.slice(0, 10); const i = d.daily.time.indexOf(today);
  const sunset = arr(d.daily.sunset, i);                        // 'YYYY-MM-DDTHH:MM'
  const soir = sunset ? now >= sunset : Number(now.slice(11, 13)) >= 19;
  return { dateISO: today, jourIdx: i, periode: soir ? 'soir' : 'jour', sunset };
}

/**
 * Calcule, pour une liste de villes (les 7 par défaut d'abord, puis éventuellement une ville libre),
 * l'œuvre du jour et du soir de chaque ville pour aujourd'hui, de façon déterministe.
 * @returns {Map<nomVille, {jour, soir, actuelle, meteo, dateISO}>}
 */
export function calculerToutes(oeuvres, villes, donnees, fixes = {}) {
  // fixes : { 'VILLE+YYYY-MM-DD': {id, artiste, categorie, echo?} } — œuvres déjà fixées (mémoire partagée), prioritaires sur le calcul
  const byId = Object.fromEntries(oeuvres.map(o => [o.id, o]));
  const resultats = new Map();
  // journal partagé : clé VILLE+DATE+PERIODE → {id, artiste, categorie}
  const journal = new Map();
  const cle = (v, d, p) => `${v.toUpperCase()}+${d}+${p}`;

  // on avance jour par jour (du plus ancien à aujourd'hui), ville par ville, période jour puis soir
  const nbJours = donnees[0].daily.time.length;
  for (let j = 0; j < nbJours; j++) {
    for (const p of ['jour']) {
      villes.forEach((v, vi) => {
        const d = donnees[vi]; const dateISO = d.daily.time[j];
        const m = bilan(d, j, 6, 22, 'jour');
        if (m.temp == null) return;
        const profil = profilMeteo(m, dateISO, v.lat);
        const fixe = fixes[`${v.nom.toUpperCase()}+${dateISO}`];
        if (fixe && byId[fixe.id]) {
          journal.set(cle(v.nom, dateISO, p), { id: fixe.id, artiste: fixe.artiste, categorie: fixe.categorie });
          if (j === nbJours - 1) { const o = byId[fixe.id]; resultats.set(v.nom, { dateISO, jour: { oeuvre: o, profil, meteo: m, echo: fixe.echo || phraseEcho(o, profil, v.nom), niveau: 1, fixe: true } }); }
          return;
        }
        // historique de cette ville : périodes précédentes, 7 jours
        const historique = [];
        for (let k = 1; k <= JOURS_HISTO; k++) {
          const dk = new Date(new Date(dateISO + 'T00:00:00Z').getTime() - k * 86400000).toISOString().slice(0, 10);
          const e = journal.get(cle(v.nom, dk, 'jour')); if (e) historique.push({ ...e, jours: k });
        }
        // œuvres déjà attribuées aux autres villes ce jour (les deux périodes) et la veille
        const deja = [];
        for (const [k, e] of journal) { const [vv, dd] = k.split('+'); if (vv !== v.nom.toUpperCase() && (dd === dateISO)) deja.push(e.id); }
        const res = choisirOeuvre(oeuvres, profil, { ville: v.nom, dateISO, latitude: v.lat, historique, dejaAujourdhui: deja });
        journal.set(cle(v.nom, dateISO, p), { id: res.oeuvre.id, artiste: res.oeuvre.artiste, categorie: res.oeuvre.categorie });
        if (j === nbJours - 1) {
          const r = resultats.get(v.nom) ?? { dateISO };
          r[p] = { oeuvre: res.oeuvre, profil, meteo: m, echo: phraseEcho(res.oeuvre, profil, v.nom), niveau: res.niveau };
          resultats.set(v.nom, r);
        }
      });
    }
  }
  villes.forEach((v, vi) => { const r = resultats.get(v.nom); if (r) { r.periode = 'jour'; r.current = donnees[vi].current; r.actuelle = r.jour; } });
  return resultats;
}
