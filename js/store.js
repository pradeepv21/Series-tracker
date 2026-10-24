"use strict";

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const slug = s => String(s).toLowerCase().replace(/\s+/g, "");
const norm = s => String(s ?? "").toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const unit = (n, word) => n == null ? "" : " " + word + (n === 1 ? "" : "s");
const ADDED_AT_MIGRATION_KEY = "seriesTracker.addedAtMigration";
let idSeed = Date.now();
const newId = () => ++idSeed;

function cleanShow(s) {
  if (!s || typeof s !== "object") return null;
  const name = String(s.name ?? "").trim();
  if (!name) return null;
  const n = v => { const x = Math.round(Number(v)); return Number.isFinite(x) && x > 0 ? x : null; };
  const id = Number(s.id), ep = n(s.episodes);
  const addedAt = Number(s.addedAt);
  let w = Math.round(Number(s.watched)); w = Number.isFinite(w) && w > 0 ? w : 0; if (ep && w > ep) w = ep;
  return {
    id: Number.isFinite(id) && id > 0 ? id : newId(),
    addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : null,
    year: /^\d{4}$/.test(String(s.year || "")) ? String(s.year) : "",
    cast: Array.isArray(s.cast) ? s.cast.slice(0, 12).map(x => ({
      name: String((x && x.name) || "").trim().slice(0, 100),
      character: String((x && x.character) || "").trim().slice(0, 100)
    })).filter(x => x.name) : [],
    genres: Array.isArray(s.genres) ? [...new Set(s.genres.map(x => String(x || "").trim().slice(0, 40)).filter(Boolean))].slice(0, 8) : [],
    network: String(s.network || "").trim().slice(0, 120),
    name,
    language: String(s.language || "").trim() || "Unknown",
    showStatus: SHOW.includes(s.showStatus) ? s.showStatus : "Unknown",
    seasons: n(s.seasons), episodes: ep, watched: w,
    myStatus: MY.includes(s.myStatus) ? s.myStatus : "Watching",
    updatedAt: Number(s.updatedAt) || 0,
    poster: typeof s.poster === "string" && (/^https:\/\//.test(s.poster) || s.poster === "none") ? s.poster : "",
    notes: String(s.notes ?? "").trim().slice(0, 2000),
    synopsis: String(s.synopsis ?? "").replace(/\s+/g, " ").trim().slice(0, 1200),
    synopsisSrc: String(s.synopsisSrc ?? "").trim().slice(0, 40),
    synopsisUrl: typeof s.synopsisUrl === "string" && /^https:\/\//.test(s.synopsisUrl) ? s.synopsisUrl.slice(0, 300) : "",
    droppedAt: (MY.includes(s.myStatus) ? s.myStatus : "Watching") === "Dropped" ? n(s.droppedAt) : null
  };
}
function sanitizeList(arr) {
  const seen = new Set(), out = [];
  (Array.isArray(arr) ? arr : []).forEach((s, index) => {
    const c = cleanShow(s); if (!c) return;
    if (!c.addedAt) c.addedAt = index + 1;
    while (seen.has(c.id)) c.id = newId();
    seen.add(c.id); out.push(c);
  });
  return out;
}
function fingerprint(list) {
  const s = JSON.stringify([...list].sort((a, b) => a.id - b.id));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h + ":" + s.length;
}
function mergeLists(a, b) {
  const map = new Map();
  for (const s of [...a, ...b]) {
    const k = norm(s.name), cur = map.get(k);
    if (!cur || s.updatedAt > cur.updatedAt) map.set(k, s);
  }
  return sanitizeList([...map.values()]);
}
function fmtWhen(ts) {
  const d = new Date(ts), t = d.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
  return d.toDateString() === new Date().toDateString() ? "today at " + t
    : d.toLocaleDateString([], {day: "numeric", month: "short"}) + " at " + t;
}
