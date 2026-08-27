// L'Art du Jour — moteur de sélection
// Aucune dépendance. Fonctionne dans Node, dans un worker Cloudflare/Vercel, ou dans le navigateur.
//
// Flux : météo brute (Open-Meteo) → profil météo (0-10) → score de chaque œuvre
//        → top N → tirage pondéré déterministe (ville + date) → anti-répétition → œuvre du jour.

// ---------- 1. Profil météo ----------

// Codes WMO utilisés par Open-Meteo → étiquettes météo (les mêmes que dans `meteo_associee` de la base)
const WMO = {
  0: ['soleil', 'clair', 'beau_temps'],
  1: ['soleil', 'beau_temps'],
  2: ['variable', 'nuages'],
  3: ['nuages'],
  45: ['brouillard'], 48: ['brouillard'],
  51: ['bruine', 'pluie'], 53: ['bruine', 'pluie'], 55: ['bruine', 'pluie'],
  56: ['bruine', 'pluie', 'gel'], 57: ['bruine', 'pluie', 'gel'],
  61: ['pluie'], 63: ['pluie'], 65: ['pluie', 'averse'],
  66: ['pluie', 'gel'], 67: ['pluie', 'gel'],
  71: ['neige'], 73: ['neige'], 75: ['neige'], 77: ['neige'],
  80: ['averse', 'pluie'], 81: ['averse', 'pluie'], 82: ['averse', 'pluie', 'orage'],
  85: ['neige', 'averse'], 86: ['neige', 'averse'],
  95: ['orage', 'pluie'], 96: ['orage', 'pluie'], 99: ['orage', 'pluie'],
};

export const WMO_LABELS_EN = {
  0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};
export const WMO_LABELS_FR = {
  0: 'Ciel dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine dense', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante',
  61: 'Pluie légère', 63: 'Pluie', 65: 'Pluie forte', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante',
  71: 'Neige légère', 73: 'Neige', 75: 'Neige forte', 77: 'Grains de neige',
  80: 'Averses légères', 81: 'Averses', 82: 'Averses violentes', 85: 'Averses de neige', 86: 'Averses de neige',
  95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage avec grêle',
};

const clamp = (x, a = 0, b = 10) => Math.max(a, Math.min(b, x));

export function saison(dateISO, latitude = 46) {
  const m = Number(dateISO.slice(5, 7));
  const nord = ['hiver', 'hiver', 'printemps', 'printemps', 'printemps', 'été', 'été', 'été', 'automne', 'automne', 'automne', 'hiver'][m - 1];
  if (latitude >= 0) return nord;
  return { hiver: 'été', été: 'hiver', printemps: 'automne', automne: 'printemps' }[nord];
}

/**
 * Construit le profil météo du jour.
 * @param {object} w  { temp, temp_ressentie, temp_max, temp_min, precip_mm, neige_cm, nuages_pct,
 *                      vent_kmh, humidite_pct, code_wmo, ensoleillement_h, is_day }
 * @param {string} dateISO 'YYYY-MM-DD' (dans le fuseau de la ville)
 * @param {number} latitude
 */
export function profilMeteo(w, dateISO, latitude) {
  const labels = new Set(WMO[w.code_wmo] ?? ['variable']);
  const t = w.temp_ressentie ?? w.temp;
  const tmax = w.temp_max ?? w.temp;

  if (tmax >= 32) labels.add('canicule').add('chaleur');
  else if (tmax >= 26) labels.add('chaleur');
  else if (t >= 15 && t <= 25 && w.precip_mm < 0.5) labels.add('douceur');
  if (t <= 8) labels.add('froid');
  if (t <= 0 || (w.temp_min ?? 99) <= -1) labels.add('gel');
  if (w.vent_kmh >= 30) labels.add('vent');
  if (w.humidite_pct >= 85 && w.precip_mm > 0) labels.add('humide');
  if (w.vent_kmh < 12 && w.precip_mm < 0.2 && (w.code_wmo ?? 0) <= 3) labels.add('calme');
  if (w.is_day === 0 || w.is_day === false) labels.add('nuit');
  labels.add(saison(dateISO, latitude));

  const pluie = clamp(w.precip_mm >= 10 ? 10 : w.precip_mm * 1.6 + (labels.has('pluie') ? 3 : 0));
  const neige = clamp((w.neige_cm ?? 0) * 3 + (labels.has('neige') ? 5 : 0));
  const nuages = clamp(w.nuages_pct / 10);
  const luminosite = clamp(10 - nuages * 0.6 - pluie * 0.25 - neige * 0.1 - (labels.has('brouillard') ? 3 : 0));
  const chaleur = clamp((t - 5) / 3);          // 5°C → 0 ; 35°C → 10
  const froid = clamp((20 - t) / 2.5);         // 20°C → 0 ; -5°C → 10
  const vent = clamp(w.vent_kmh / 6);
  const humidite = clamp(w.humidite_pct / 10);
  const orage = labels.has('orage') ? 9 : 0;
  const calme = clamp(10 - vent - orage - pluie * 0.4);
  // ambiance perçue : joie ≈ lumière + douceur ; mélancolie ≈ gris + pluie + froid
  const joie = clamp(luminosite * 0.6 + (t >= 12 && t <= 28 ? 4 : 0) - pluie * 0.3);
  const melancolie = clamp(nuages * 0.4 + pluie * 0.4 + froid * 0.3 + (labels.has('brouillard') ? 2 : 0));

  return { labels: [...labels], pluie, neige, nuages, luminosite, chaleur, froid, vent, humidite, orage, calme, joie, melancolie, temp: t, saison: saison(dateISO, latitude) };
}

// ---------- 2. Scoring ----------

const sim = (a, b) => 1 - Math.abs(a - b) / 10;   // similarité 0..1 entre deux valeurs 0..10

export const POIDS = { meteo: 0.35, temperature: 0.20, couleur: 0.15, saison: 0.10, ambiance: 0.10, diversite: 0.10 };

/**
 * Score détaillé d'une œuvre pour un profil donné (chaque composante 0..1).
 * @param {object} o  œuvre de la base
 * @param {object} p  profil météo
 * @param {object[]} historique  entrées récentes de la ville, du plus récent au plus ancien : [{id, artiste, categorie, jours}]
 */
export function scoreOeuvre(o, p, historique = []) {
  const t = o.tags;

  // --- météo (35 %) : moitié dimensions, moitié étiquettes
  const dims = [
    [sim(p.pluie, t.eau_pluie), 1 + p.pluie / 5],
    [sim(p.neige, t.neige), 1 + p.neige / 3],
    [sim(p.vent + p.orage * 0.5, t.mouvement), 0.8],
    [sim(p.calme, t.calme), 0.8],
    [sim(p.nuages, 10 - t.ciel * 0.5 - t.luminosite * 0.5), 0.6],
  ];
  const dimScore = dims.reduce((s, [v, w]) => s + v * w, 0) / dims.reduce((s, [, w]) => s + w, 0);
  const communs = o.meteo_associee.filter(l => p.labels.includes(l)).length;
  const labelScore = communs === 0 ? 0.15 : Math.min(1, 0.55 + 0.25 * communs);
  const meteo = 0.5 * dimScore + 0.5 * labelScore;

  // --- température (20 %)
  const [tmin, tmax] = o.temperature;
  const dist = p.temp < tmin ? tmin - p.temp : p.temp > tmax ? p.temp - tmax : 0;
  const plage = Math.max(0, 1 - dist / 12);
  const temperature = 0.6 * plage + 0.4 * sim(p.chaleur, t.chaleur_visuelle);

  // --- couleurs / luminosité (15 %)
  // ciel gris → légère préférence pour tons froids/sombres, mais pas une règle absolue (cahier des charges §13-14)
  const froideur = p.froid * 0.5 + p.nuages * 0.3 + p.pluie * 0.2;
  const couleur = 0.55 * sim(p.luminosite, t.luminosite) + 0.45 * sim(froideur, t.couleurs_froides);

  // --- saison (10 %) : influence, pas obligation
  const saisonScore = o.saison_ideale.includes(p.saison) ? 1 : 0.45;

  // --- ambiance (10 %)
  const mauvaisTemps = (p.pluie + p.froid + p.nuages) / 30;   // 0..1
  const interieurBonus = mauvaisTemps > 0.5 ? (t.interieur / 10) * 0.5 : 0;
  const ambiance = Math.min(1, 0.45 * sim(p.joie, t.joie) + 0.45 * sim(p.melancolie, t.melancolie) + interieurBonus);

  // --- diversité (10 %) : mêmes artistes / même catégorie ces derniers jours
  let diversite = 1;
  for (const h of historique) {
    if (h.artiste === o.artiste && h.jours <= 7) diversite -= 0.5;
    if (h.jours === 1 && h.categorie === o.categorie) diversite -= 0.15;
    if (h.id === o.id && h.jours > 7) diversite -= 0.3;   // déjà vue ces deux derniers mois → on favorise les œuvres jamais montrées
  }
  diversite = Math.max(0, diversite);

  const base = POIDS.meteo * meteo + POIDS.temperature * temperature + POIDS.couleur * couleur
    + POIDS.saison * saisonScore + POIDS.ambiance * ambiance + POIDS.diversite * diversite;

  // --- anti-répétition (cahier des charges §11) : pénalité multiplicative selon la dernière apparition
  const derniere = historique.find(h => h.id === o.id);
  let penalite = 0;
  if (derniere) penalite = derniere.jours <= 1 ? 1 : derniere.jours === 2 ? 0.7 : derniere.jours === 3 ? 0.5 : derniere.jours <= 7 ? 0.25 : 0;

  return {
    id: o.id, score: base * (1 - penalite), base, penalite,
    detail: { meteo, temperature, couleur, saison: saisonScore, ambiance, diversite },
  };
}

// ---------- 3. Tirage déterministe ----------

function hash32(str) {           // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(seed) {             // mulberry32
  let a = hash32(seed);
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/**
 * Choisit l'œuvre du jour.
 * @param {object[]} oeuvres      base d'œuvres
 * @param {object|null} profil    profil météo (null si l'API météo est indisponible → niveau 2/3)
 * @param {object} ctx            { ville, dateISO, latitude, historique: [{id, artiste, categorie, jours}], topN }
 */
export function choisirOeuvre(oeuvres, profil, ctx) {
  // une œuvre n'est éligible que si son image est une vraie URL d'image (pas une page de musée à convertir plus tard)
  const imageOK = u => /\.(jpe?g|png|webp)(\?|$)|\/download\/|default\.(jpg|webp)/i.test(u || '');
  const valides = oeuvres.filter(o => o.tags && imageOK(o.image?.url) && o.titre && o.artiste && o.annee && o.texte);
  // top 5 pour une petite base, top 8 dès que la base dépasse 40 œuvres (cahier des charges §10 : 5 à 10)
  const topN = ctx.topN ?? (valides.length > 40 ? 8 : 5);
  let niveau = 1;
  let p = profil;

  if (!p) {                        // Niveau 2 : pas de météo → profil saisonnier neutre
    niveau = 2;
    p = profilSaisonnier(ctx.dateISO, ctx.latitude);
  }

  const dejaAilleurs = new Set(ctx.dejaAujourdhui ?? []);   // œuvres déjà attribuées à d'autres villes le même jour
  let scores = valides.map(o => {
    const r = scoreOeuvre(o, p, ctx.historique ?? []);
    if (dejaAilleurs.has(o.id)) r.score *= 0.35;
    return r;
  }).sort((a, b) => b.score - a.score);
  let candidats = scores.slice(0, topN).filter(s => s.score > 0);

  if (candidats.length === 0) {    // Niveau 3 : aléatoire contrôlé parmi les œuvres compatibles avec la saison
    niveau = 3;
    const s = saison(ctx.dateISO, ctx.latitude);
    const compat = valides.filter(o => o.saison_ideale.includes(s));
    candidats = (compat.length ? compat : valides).map(o => ({ id: o.id, score: 1, base: 1, penalite: 0, detail: {} }));
  }

  // tirage pondéré : score^3 pour favoriser nettement les mieux classés tout en gardant de l'imprévu
  const r = rng(`${ctx.ville.toUpperCase()}+${ctx.dateISO}`)();
  const poids = candidats.map(c => Math.pow(c.score, 3));
  const total = poids.reduce((a, b) => a + b, 0);
  let acc = 0, choisi = candidats[candidats.length - 1];
  for (let i = 0; i < candidats.length; i++) { acc += poids[i] / total; if (r <= acc) { choisi = candidats[i]; break; } }

  const oeuvre = valides.find(o => o.id === choisi.id);
  return { oeuvre, niveau, profil: p, candidats, classement: scores, seed: `${ctx.ville.toUpperCase()}+${ctx.dateISO}` };
}

export function profilSaisonnier(dateISO, latitude) {
  const s = saison(dateISO, latitude);
  const base = { labels: [s], pluie: 2, neige: 0, nuages: 5, luminosite: 6, chaleur: 5, froid: 4, vent: 2, humidite: 6, orage: 0, calme: 7, joie: 5, melancolie: 4, temp: 14, saison: s };
  if (s === 'hiver') Object.assign(base, { neige: 3, froid: 8, chaleur: 1, luminosite: 4, temp: 3, melancolie: 6, joie: 3 });
  if (s === 'été') Object.assign(base, { chaleur: 8, froid: 0, luminosite: 9, temp: 26, joie: 8, melancolie: 2, nuages: 3 });
  if (s === 'printemps') Object.assign(base, { luminosite: 7, temp: 15, joie: 7, pluie: 3 });
  if (s === 'automne') Object.assign(base, { pluie: 4, nuages: 6, luminosite: 5, temp: 11, melancolie: 6 });
  return base;
}

// ---------- 4. Phrase d'écho météo (5e phrase) ----------

const ECHOS_GENERIQUES = {
  pluie: v => `Aujourd'hui, sous la pluie de ${v}, ce tableau prend une lumière différente.`,
  neige: v => `Avec la neige sur ${v}, cette œuvre semble avoir été choisie pour la journée.`,
  soleil: v => `Sous le soleil de ${v} aujourd'hui, ses couleurs paraissent plus vives.`,
  nuages: v => `Le ciel couvert de ${v} donne aujourd'hui à cette œuvre une tonalité plus feutrée.`,
  vent: v => `Le vent qui souffle sur ${v} fait écho à ce qui bouge dans cette image.`,
  froid: v => `Par ce froid sur ${v}, l'œuvre se regarde autrement.`,
  chaleur: v => `Avec la chaleur d'aujourd'hui à ${v}, cette image trouve un air de saison.`,
  brouillard: v => `Dans le brouillard de ${v}, ce tableau paraît plus proche que jamais.`,
  orage: v => `Sous le ciel d'orage de ${v}, cette œuvre a quelque chose d'électrique.`,
};
const ECHOS_GENERIQUES_EN = {
  pluie: v => `Today, under the rain over ${v}, this work takes on a different light.`,
  neige: v => `With snow falling on ${v}, this work feels chosen for the day.`,
  soleil: v => `In today's sunshine over ${v}, its colours seem brighter.`,
  nuages: v => `The overcast sky above ${v} lends this work a softer tone today.`,
  vent: v => `The wind blowing through ${v} echoes what stirs within this image.`,
  froid: v => `In this cold over ${v}, the work reads differently.`,
  chaleur: v => `In today's heat in ${v}, this image feels in season.`,
  brouillard: v => `In the fog over ${v}, this work feels closer than ever.`,
  orage: v => `Under the stormy sky of ${v}, there is something electric about this work.`,
};
const PRIORITE = ['orage', 'neige', 'canicule', 'brouillard', 'pluie', 'averse', 'bruine', 'gel', 'vent', 'chaleur', 'froid', 'coucher_soleil', 'nuit', 'humide', 'douceur', 'soleil', 'beau_temps', 'clair', 'nuages', 'variable', 'calme', 'printemps', 'été', 'automne', 'hiver'];

export function phraseEcho(oeuvre, profil, ville, lang = 'fr') {
  const src = lang === 'en' ? (oeuvre.echos_meteo_en ?? oeuvre.echos_meteo) : oeuvre.echos_meteo;
  const GEN = lang === 'en' ? ECHOS_GENERIQUES_EN : ECHOS_GENERIQUES;
  const ordre = PRIORITE.filter(l => profil.labels.includes(l));
  for (const l of ordre) if (src?.[l]) return src[l];
  for (const l of ordre) if (GEN[l]) return GEN[l](ville);
  return lang === 'en' ? `Today in ${ville}, this work was waiting for you.` : `Aujourd'hui à ${ville}, cette œuvre vous attendait.`;
}

// ---------- 5. Mémoire ville + date ----------

/**
 * Retourne l'œuvre du jour, en la calculant une seule fois par (ville, date).
 * `store` = { get(cle) → enregistrement|null, set(cle, enregistrement), historique(ville, dateISO, n) → [{id, artiste, categorie, jours}] }
 */
export async function oeuvreDuJour({ oeuvres, ville, dateISO, latitude, meteo, store, topN }) {
  const cle = `${ville.toUpperCase()}+${dateISO}`;
  const existant = await store.get(cle);
  // on réutilise l'enregistrement du jour, sauf s'il avait été calculé en mode secours (sans météo) et que la météo est maintenant disponible
  if (existant && !(existant.niveau > 1 && meteo)) return { ...existant, cache: true };

  const profil = meteo ? profilMeteo(meteo, dateISO, latitude) : null;
  const historique = await store.historique(ville, dateISO, 60);
  const dejaAujourdhui = store.dejaAujourdhui ? await store.dejaAujourdhui(ville, dateISO) : [];
  const res = choisirOeuvre(oeuvres, profil, { ville, dateISO, latitude, historique, topN, dejaAujourdhui });
  const enregistrement = {
    cle, ville, dateISO, oeuvre_id: res.oeuvre.id, artiste: res.oeuvre.artiste, categorie: res.oeuvre.categorie,
    niveau: res.niveau, profil: res.profil, meteo_brute: meteo ?? null,
    echo: phraseEcho(res.oeuvre, res.profil, ville),
    candidats: res.candidats.map(c => ({ id: c.id, score: +c.score.toFixed(3) })),
  };
  await store.set(cle, enregistrement);
  return { ...enregistrement, cache: false };
}

/** Store en mémoire (tests) ; en production : KV Cloudflare, Vercel KV, ou un simple fichier JSON. */
export function storeMemoire(initial = {}) {
  const data = { ...initial };
  return {
    async get(k) { return data[k] ?? null; },
    async set(k, v) { data[k] = v; },
    async historique(ville, dateISO, n) {
      const out = [];
      const d0 = new Date(dateISO + 'T00:00:00Z');
      for (let j = 1; j <= n; j++) {
        const d = new Date(d0.getTime() - j * 86400000).toISOString().slice(0, 10);
        const e = data[`${ville.toUpperCase()}+${d}`];
        if (e) out.push({ id: e.oeuvre_id, artiste: e.artiste, categorie: e.categorie, jours: j });
      }
      return out;
    },
    async dejaAujourdhui(ville, dateISO) {   // œuvres des autres villes à J-1, J, J+1 (fuseaux horaires)
      const d0 = new Date(dateISO + 'T00:00:00Z'); const out = [];
      for (const j of [-1, 0, 1]) { const d = new Date(d0.getTime() + j * 86400000).toISOString().slice(0, 10);
        for (const [k, e] of Object.entries(data)) if (k.endsWith('+' + d) && !k.startsWith(ville.toUpperCase() + '+')) out.push(e.oeuvre_id); }
      return out;
    },
    dump() { return data; },
  };
}
