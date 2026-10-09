"use strict";

/* ---------- online show details (TVmaze, plus TMDB when a key is added) ---------- */
const TMDB_STORE = "seriesTracker.tmdbKey";
let tmdbKey = (localStorage.getItem(TMDB_STORE) || "").trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const intOrNull = v => { const x = Math.round(Number(v)); return String(v ?? "").trim() !== "" && x > 0 ? x : null; };

let cspBlocked = false;
document.addEventListener("securitypolicyviolation", e => { if (/tvmaze|themoviedb/.test(e.blockedURI || "")) cspBlocked = true; });
async function getJSON(url, opts = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
    try {
      let res;
      try { res = await fetch(url, {...opts, signal: ctl.signal}); }
      catch (err) {
        await sleep(0);                                  // lets a blocked-by-policy report arrive first
        const kind = cspBlocked ? "blocked" : err && err.name === "AbortError" ? "timeout" : "network";
        throw Object.assign(new Error(kind), {kind});
      }
      if (res.status === 429 && attempt === 0) { await sleep(1300); continue; }
      if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), {status: res.status});
      return await res.json();
    } finally { clearTimeout(t); }
  }
  throw Object.assign(new Error("Too many requests"), {status: 429});
}
function explainError(e) {
  if (e && e.kind === "blocked") return "This page is open somewhere that blocks connections to other websites, such as a preview inside an app. Open the file in Chrome or Safari, or host it online, and try again.";
  if (e && e.kind === "timeout") return "The request timed out. Check your connection and try again.";
  if (e && e.kind === "network") return "The request didn't go through. You may be offline, or an ad blocker, VPN, or in-app preview is getting in the way. Try opening the file in Chrome or Safari.";
  if (e && e.status === 429) return "The show database is busy. Wait a few seconds and try again.";
  if (e && (e.status === 401 || e.status === 403)) return "The show database rejected the request. If you added a TMDB key, check that it's correct.";
  if (e && e.status >= 500) return "The show database isn't responding right now. Try again in a little while.";
  return "Something went wrong while looking up the show.";
}
function langName(code) {
  const c = String(code || "").toLowerCase(); if (!c) return null;
  if (c === "cn") return "Cantonese";
  try { const n = new Intl.DisplayNames(["en"], {type: "language"}).of(c); return n && n.toLowerCase() !== c ? n : null; } catch (e) { return null; }
}
const tvStatus = st => st === "Running" ? "Ongoing" : st === "Ended" ? "Ended" : null;
const tmdbStatus = st => ({"Returning Series": "Ongoing", "In Production": "Ongoing", "Ended": "Ended", "Canceled": "Cancelled"})[st] || null;
const tmdbReq = (path, params = {}) => {
  const bearer = tmdbKey.length > 40, u = new URL("https://api.themoviedb.org/3" + path);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  if (!bearer) u.searchParams.set("api_key", tmdbKey);
  return getJSON(u.toString(), bearer ? {headers: {Authorization: "Bearer " + tmdbKey}} : {});
};
const PROVIDERS = {
  tvmaze: {
    label: "TVmaze",
    async search(q) {
      const r = await getJSON("https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(q));
      return (Array.isArray(r) ? r : []).map(x => x && x.show).filter(Boolean).slice(0, 5).map(x => ({
        provider: "tvmaze", id: x.id, title: x.name, year: (x.premiered || "").slice(0, 4),
        language: x.language === "Mandarin" ? "Chinese" : x.language || null, showStatus: tvStatus(x.status),
        poster: x.image && x.image.medium ? String(x.image.medium).replace(/^http:/, "https:") : ""}));
    },
    async details(it) {
      let eps = [];
      try { eps = await getJSON(`https://api.tvmaze.com/shows/${it.id}/episodes`); } catch (e) { if (e.status !== 404) throw e; }
      const reg = (Array.isArray(eps) ? eps : []).filter(e => !e.type || e.type === "regular");
      return {...it, seasons: new Set(reg.map(e => e.season)).size || null, episodes: reg.length || null};
    }
  },
  tmdb: {
    label: "TMDB",
    async search(q) {
      const r = await tmdbReq("/search/tv", {query: q, include_adult: "false"});
      return ((r && r.results) || []).slice(0, 5).map(x => ({
        provider: "tmdb", id: x.id, title: x.name, year: (x.first_air_date || "").slice(0, 4), language: langName(x.original_language), showStatus: null,
        poster: x.poster_path ? "https://image.tmdb.org/t/p/w185" + x.poster_path : ""}));
    },
    async details(it) {
      const d = await tmdbReq("/tv/" + it.id);
      const real = (d.seasons || []).filter(x => x.season_number > 0);
      return {...it, language: langName(d.original_language) || it.language, showStatus: tmdbStatus(d.status) || it.showStatus,
        seasons: real.length || d.number_of_seasons || null,
        episodes: real.reduce((a, x) => a + (x.episode_count || 0), 0) || d.number_of_episodes || null};
    }
  }
};
const searchCache = new Map(), detailCache = new Map();
async function searchOnline(q) {
  const key = norm(q) + "|" + (tmdbKey ? 1 : 0);
  if (searchCache.has(key)) return searchCache.get(key);
  const names = tmdbKey ? ["tmdb", "tvmaze"] : ["tvmaze"];
  const settled = await Promise.allSettled(names.map(n => PROVIDERS[n].search(q)));
  if (settled.every(x => x.status === "rejected")) throw settled[0].reason;
  const seen = new Set(), out = [];
  settled.forEach(x => x.status === "fulfilled" && x.value.forEach(it => {
    const k = norm(it.title) + "|" + it.year;
    if (!seen.has(k)) { seen.add(k); out.push(it); }
  }));
  searchCache.set(key, out);
  return out;
}
async function detailsOnline(it) {
  const k = it.provider + ":" + it.id;
  if (!detailCache.has(k)) detailCache.set(k, await PROVIDERS[it.provider].details(it));
  return detailCache.get(k);
}
function titleScore(q, t) {
  const a = norm(q), b = norm(t); if (!a || !b) return 0; if (a === b) return 1;
  const A = a.split(" "), B = new Set(b.split(" "));
  return A.filter(w => B.has(w)).length / Math.max(A.length, B.size);
}
function pickBest(results, q) {
  let best = null, top = -1;
  results.forEach(r => { const sc = titleScore(q, r.title); if (sc > top) { top = sc; best = r; } });
  return {item: best, score: top};
}
// Best single match for a name. With strict on, weak matches are ignored (used for bulk fills).
async function posterFor(q) {
  try {
    const {item, score} = pickBest(await searchOnline(q), q);
    return item && score >= 0.75 ? item.poster || "" : "";
  } catch (e) { return ""; }
}
async function lookupBest(q, strict, skipBuiltin) {
  const d = skipBuiltin ? null : DEMO.find(x => norm(x.name) === norm(q));
  if (d) return {...d, title: d.name, provider: "builtin", score: 1};
  const results = await searchOnline(q);
  if (!results.length) return null;
  const {item, score} = pickBest(results, q);
  if (strict && score < 0.75) return null;
  return {...(await detailsOnline(item)), score};
}

