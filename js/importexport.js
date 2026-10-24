"use strict";

/* ---------- import and export (Excel, CSV, Word, text, JSON) ---------- */
const payload = () => ({app: "series-tracker", version: 1, savedAt: new Date().toISOString(), shows: appOrder(data)});
const today = () => new Date().toISOString().slice(0, 10);
function dataMsg(text, kind) { const el = $("dataMsg"); el.textContent = text || ""; el.className = "msg " + (kind || ""); }
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Excel and Word readers are large, so they load only when you first use them.
const LIBS = {
  xlsx: {ready: () => !!window.XLSX, urls: ["https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"]},
  mammoth: {ready: () => !!window.mammoth, urls: ["https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js",
    "https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js"]}
};
const libLoading = {};
function loadLib(key) {
  const L = LIBS[key];
  if (L.ready()) return Promise.resolve();
  if (libLoading[key]) return libLoading[key];
  libLoading[key] = (async () => {
    for (const url of L.urls) {
      try {
        await new Promise((ok, no) => {
          const el = document.createElement("script");
          el.src = url; el.onload = ok; el.onerror = () => { el.remove(); no(); };
          document.head.appendChild(el);
        });
        if (L.ready()) return;
      } catch (e) {}
    }
    libLoading[key] = null;
    throw new Error("Couldn't load the file reader. Check your internet connection and try again.");
  })();
  return libLoading[key];
}

/* export */
const XLSX_COLUMNS = ["Show", "Language", "Show status", "My status", "Seasons", "Episodes", "Episodes watched", "Dropped at episode", "Notes"];
function libraryRows() {
  return appOrder(data).map(s => ({
    "Show": s.name, "Language": s.language, "Show status": s.showStatus, "My status": s.myStatus,
    "Seasons": s.seasons ?? "", "Episodes": s.episodes ?? "", "Episodes watched": watchedNow(s) || "",
    "Dropped at episode": s.droppedAt ?? "", "Notes": s.notes || ""
  }));
}
async function exportXlsx() {
  dataMsg("");
  const rows = libraryRows();
  try { await loadLib("xlsx"); }
  catch (e) { return exportCsv(rows); }
  const ws = XLSX.utils.json_to_sheet(rows, {header: XLSX_COLUMNS});
  ws["!cols"] = [{wch: 34}, {wch: 14}, {wch: 14}, {wch: 16}, {wch: 10}, {wch: 10}, {wch: 17}, {wch: 18}, {wch: 44}];
  ws["!autofilter"] = {ref: XLSX.utils.encode_range({s: {r: 0, c: 0}, e: {r: Math.max(rows.length, 1), c: 8}})};
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Series");
  XLSX.writeFile(wb, `series-tracker-${today()}.xlsx`);
  dataMsg(`Downloaded ${rows.length} ${rows.length === 1 ? "show" : "shows"} as an Excel file.`, "ok");
}
function exportCsv(rows) {
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + [XLSX_COLUMNS, ...rows.map(r => XLSX_COLUMNS.map(c => r[c]))].map(r => r.map(q).join(",")).join("\r\n");
  download(new Blob([csv], {type: "text/csv;charset=utf-8"}), `series-tracker-${today()}.csv`);
  dataMsg("The Excel tools didn't load, so this was saved as a CSV file. Excel can open it.", "ok");
}
function exportJson() {
  download(new Blob([JSON.stringify(payload(), null, 2)], {type: "application/json"}), `series-tracker-backup-${today()}.json`);
  dataMsg("Backup file downloaded.", "ok");
}

/* import: read the file into rows */
const readFile = (file, as) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(r.result); r.onerror = () => no(r.error || new Error("read"));
  as === "text" ? r.readAsText(file) : r.readAsArrayBuffer(file);
});
const cellText = v => String(v ?? "").replace(/\s+/g, " ").trim();
const stripBullet = t => t.replace(/^\s*(?:[-*•▪◦–]|\d+\s*[.)])\s+/, "");
const listImport = lines => ({sheets: [{name: "List", rows: lines.map(l => [l])}], list: true});

function sheetsFrom(wb) {
  const sheets = wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], {header: 1, defval: "", blankrows: false, raw: false})
      .map(r => r.map(cellText)).filter(r => r.some(Boolean))
  })).filter(s => s.rows.length);
  if (!sheets.length) throw new Error("That file doesn't have any data in it.");
  return {sheets, list: false};
}
function docToImport(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (table) {
    const rows = [...table.rows].map(tr => [...tr.cells].map(c => cellText(c.textContent))).filter(r => r.some(Boolean));
    if (rows.length) return {sheets: [{name: "Table", rows}], list: false};
  }
  const items = [...doc.body.querySelectorAll("li")];
  const blocks = items.length ? items : [...doc.body.querySelectorAll("p")];
  const lines = [];
  blocks.forEach(el => {
    el.querySelectorAll("br").forEach(b => b.replaceWith("\n"));
    el.textContent.split("\n").forEach(t => { t = cellText(t); if (t) lines.push(t); });
  });
  if (!lines.length) throw new Error("Couldn't find any shows in that document.");
  return listImport(lines);
}
async function parseImportFile(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error("That file is too large to import (15 MB limit).");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (["xlsx", "xlsm", "xlsb", "xls", "ods"].includes(ext)) {
    await loadLib("xlsx");
    return sheetsFrom(XLSX.read(await readFile(file, "buf"), {type: "array"}));
  }
  if (ext === "csv" || ext === "tsv") {
    await loadLib("xlsx");
    return sheetsFrom(XLSX.read(await readFile(file, "text"), {type: "string", raw: true}));
  }
  if (ext === "docx") {
    await loadLib("mammoth");
    return docToImport((await mammoth.convertToHtml({arrayBuffer: await readFile(file, "buf")})).value);
  }
  if (ext === "doc") throw new Error("Old .doc files can't be read. In Word, choose Save As and pick .docx, then try again.");
  if (ext === "json") {
    let p; try { p = JSON.parse(await readFile(file, "text")); } catch (e) { throw new Error("That file isn't valid JSON."); }
    const arr = Array.isArray(p) ? p : p && p.shows;
    if (!Array.isArray(arr) || !arr.length) throw new Error("Couldn't find any shows in that file.");
    if (arr.every(x => typeof x === "string")) return listImport(arr.map(cellText).filter(Boolean));
    const keys = [...new Set(arr.filter(x => x && typeof x === "object").flatMap(Object.keys))];
    return {sheets: [{name: "JSON", rows: [keys.map(k => k === "watched" ? "Episodes watched" : k), ...arr.filter(x => x && typeof x === "object").map(x => keys.map(k =>
      k === "cast" ? JSON.stringify(x[k] || []) : k === "genres" && Array.isArray(x[k]) ? x[k].join(", ") : cellText(x[k])))]}], list: false};
  }
  if (["txt", "md", "text", ""].includes(ext)) {
    const lines = (await readFile(file, "text")).split(/\r?\n/).map(cellText).filter(Boolean);
    if (!lines.length) throw new Error("That file is empty.");
    return listImport(lines);
  }
  throw new Error("That file type isn't supported. Use Excel, CSV, Word (.docx), a text file, or a backup file.");
}

/* import: match columns, clean values, preview */
const FIELDS = [["name", "Show name"], ["language", "Language"], ["showStatus", "Show status"],
  ["myStatus", "My status"], ["seasons", "Seasons"], ["episodes", "Episodes"], ["watched", "Episodes watched"],
  ["droppedAt", "Dropped at episode"], ["notes", "Notes"], ["year", "Release year"], ["genres", "Genres"],
  ["network", "Network"], ["cast", "Cast"]];
const ALIASES = {
  name: ["name", "show", "shows", "showname", "title", "series", "seriesname", "drama", "dramas", "dramaname", "tvshow", "titles"],
  language: ["language", "lang", "languages"],
  showStatus: ["showstatus", "airingstatus", "airing", "seriesstatus", "broadcaststatus"],
  myStatus: ["mystatus", "mywatchingstatus", "watchstatus", "watchingstatus", "status", "progress", "watched"],
  seasons: ["seasons", "season", "noofseasons", "numberofseasons", "s"],
  episodes: ["episodes", "episode", "eps", "noofepisodes", "numberofepisodes", "totalepisodes", "ep"],
  watched: ["episodeswatched", "watchedepisodes", "epswatched", "watchedeps", "currentepisode", "lastwatched", "lastepisodewatched", "episodeprogress"],
  droppedAt: ["droppedatepisode", "droppedat", "droppedepisode", "stoppedat", "stoppedatepisode", "episodedropped"],
  notes: ["notes", "note", "comments", "comment", "remarks"],
  year: ["releaseyear", "year", "firstairdate", "premiered"],
  genres: ["genres", "genre", "category", "categories"],
  network: ["network", "channel", "broadcaster"],
  cast: ["cast", "actors", "starring"]
};
const hnorm = v => String(v ?? "").toLowerCase().replace(/[^a-z]/g, "");
const colLabel = i => { let s = "", n = i; do { s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const looksLikeHeader = row => (row || []).some(c => { const h = hnorm(c); return h && Object.values(ALIASES).some(a => a.includes(h)); });

function autoMap(hdr, hasHeader, ncol) {
  const map = {name: -1, language: -1, showStatus: -1, myStatus: -1, seasons: -1, episodes: -1, watched: -1, droppedAt: -1, notes: -1}, used = new Set();
  if (hasHeader) {
    const hs = hdr.map(hnorm);
    for (const [f] of FIELDS) {
      const i = hs.findIndex((h, ix) => !used.has(ix) && ALIASES[f].includes(h));
      if (i > -1) { map[f] = i; used.add(i); }
    }
    for (const [f] of FIELDS) {
      if (map[f] > -1) continue;
      const i = hs.findIndex((h, ix) => !used.has(ix) && h && ALIASES[f].some(a => a.length >= 4 && h.includes(a)));
      if (i > -1) { map[f] = i; used.add(i); }
    }
  }
  if (map.name < 0) { let i = 0; while (i < ncol - 1 && used.has(i)) i++; map.name = i; }
  return map;
}
function parseMyStatus(v) {
  const t = norm(v); if (!t) return null;
  if (/complet|finish|done|watched|\bseen\b/.test(t)) return "Completed";
  if (/drop|abandon|quit|\bstop/.test(t)) return "Dropped";
  if (/plan|queue|backlog|want|watchlist|to watch|later|upcoming|wishlist/.test(t)) return PLAN;
  if (/hold|paus|wait/.test(t)) return "On Hold";
  if (/watch|ongoing|current|progress|running|\bnow\b/.test(t)) return "Watching";
  return null;
}
function parseShowStatus(v) {
  const t = norm(v); if (!t) return null;
  if (/ongoing|airing|running|current|releasing/.test(t)) return "Ongoing";
  if (/cancel|discontinu/.test(t)) return "Cancelled";
  if (/\bend|finish|complet|over|conclu/.test(t)) return "Ended";
  return null;
}
const parseNum = v => { const m = String(v ?? "").match(/\d+/); const n = m ? Number(m[0]) : 0; return n > 0 ? n : null; };
const titleCase = v => v.toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());

let imp = null;
const impCol = f => Number($("impCol_" + f).value);

function importRecords() {
  const sh = imp.sheets[imp.sheet], header = $("impHeader").checked, rows = header ? sh.rows.slice(1) : sh.rows;
  const existing = new Map(data.map(s => [norm(s.name), s]));
  const seen = new Set(), recs = []; let ignored = 0;
  for (const r of rows) {
    const get = f => { const c = impCol(f); return c >= 0 ? cellText(r[c]) : ""; };
    let name = get("name"); if (imp.list) name = stripBullet(name);
    const key = norm(name);
    if (!key || seen.has(key)) { ignored++; continue; }
    seen.add(key);
    let cast = [];
    const castText = get("cast");
    if (castText) {
      try {
        const parsed = JSON.parse(castText);
        if (Array.isArray(parsed)) cast = parsed;
      } catch (e) {
        cast = castText.split(/[,;]\s*/).filter(Boolean).map(person => ({name: person, character: ""}));
      }
    }
    const rec = {name, language: get("language") ? titleCase(get("language")) : null, showStatus: parseShowStatus(get("showStatus")),
      myStatus: parseMyStatus(get("myStatus")), seasons: parseNum(get("seasons")), episodes: parseNum(get("episodes")),
      droppedAt: parseNum(get("droppedAt")), watched: parseNum(get("watched")), notes: get("notes") || null,
      year: /^\d{4}$/.test(get("year")) ? get("year") : "",
      genres: get("genres").split(/[,;]\s*/).filter(Boolean), network: get("network"), cast};
    const d = DEMO.find(x => norm(x.name) === key);
    if (d) {
      rec.name = d.name;
      if (rec.language == null) rec.language = d.language;
      if (rec.showStatus == null) rec.showStatus = d.showStatus;
      if (rec.seasons == null) rec.seasons = d.seasons;
      if (rec.episodes == null) rec.episodes = d.episodes;
    }
    rec.existing = existing.get(key) || null;
    recs.push(rec);
  }
  return {recs, ignored};
}
function rebuildImportMap() {
  const sh = imp.sheets[imp.sheet], has = $("impHeader").checked, hdr = has ? sh.rows[0] : [];
  const ncol = Math.max(1, ...sh.rows.map(r => r.length));
  const labels = Array.from({length: ncol}, (_, i) => hdr[i] ? `${colLabel(i)}: ${hdr[i]}` : `Column ${colLabel(i)}`);
  const map = autoMap(hdr, has, ncol);
  $("impMap").innerHTML = FIELDS.map(([f, l]) => `<div class="field"><label for="impCol_${f}">${l}</label>
    <select id="impCol_${f}">${f === "name" ? "" : '<option value="-1">Not in the file</option>'}${labels.map((t, i) =>
      `<option value="${i}"${map[f] === i ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`).join("");
  previewImport();
}
function previewImport() {
  const {recs, ignored} = importRecords(), upd = $("impUpdate").checked;
  const fresh = recs.filter(r => !r.existing).length, dup = recs.length - fresh;
  const parts = [`${fresh} new`];
  if (dup) parts.push(`${dup} already in your library (${upd ? "will be updated" : "will be skipped"})`);
  if (ignored) parts.push(`${ignored} blank or repeated ${ignored === 1 ? "row" : "rows"} ignored`);
  $("impPreview").innerHTML = recs.length
    ? `<strong>${esc(parts.join(", "))}</strong><ul>${recs.slice(0, 6).map(r =>
        `<li><b>${esc(r.name)}</b><span>${esc([r.language, r.myStatus].filter(Boolean).join(", ") || (r.existing ? "in library" : "new"))}</span></li>`).join("")}</ul>` +
      (recs.length > 6 ? `<p class="hint" style="margin-top:8px">and ${recs.length - 6} more</p>` : "")
    : `<strong>No shows found</strong><p class="hint">Check that "Show name" points at the column with the titles.</p>`;
  const todo = fresh + (upd ? dup : 0);
  $("impGo").disabled = !todo;
  $("impGo").textContent = todo ? `Import ${fresh ? fresh + (fresh === 1 ? " show" : " shows") : ""}${fresh && upd && dup ? " and " : ""}${upd && dup ? "update " + dup : ""}`.trim() : "Nothing to import";
}
function openImport(parsed, fileName) {
  imp = {...parsed, sheet: 0};
  $("impFile").textContent = fileName;
  const multi = imp.sheets.length > 1;
  $("impSheetField").hidden = !multi;
  $("impSheet").innerHTML = imp.sheets.map((s, i) => `<option value="${i}">${esc(s.name)} (${s.rows.length} rows)</option>`).join("");
  $("impHeader").checked = looksLikeHeader(imp.sheets[0].rows[0]);
  $("impUpdate").checked = false; $("impLookup").checked = true; $("impDefault").value = "Watching";
  rebuildImportMap();
  $("dataDlg").close(); $("importDlg").showModal();
}
function applyImport() {
  const {recs} = importRecords(), upd = $("impUpdate").checked, def = $("impDefault").value;
  const prev = JSON.stringify(data), now = Date.now();
  let added = 0, updated = 0; const touched = [];
  for (const r of [...recs].reverse()) {          // reversed so the first row ends up first under "Newest first"
    if (r.existing) {
      if (!upd) continue;
      const s = r.existing;
      if (r.language) s.language = r.language;
      if (r.showStatus) s.showStatus = r.showStatus;
      if (r.myStatus) s.myStatus = r.myStatus;
      if (r.seasons) s.seasons = r.seasons;
      if (r.episodes) s.episodes = r.episodes;
      if (r.notes) s.notes = r.notes;
      if (r.year) s.year = r.year;
      if (r.genres.length) s.genres = r.genres;
      if (r.network) s.network = r.network;
      if (r.cast.length) s.cast = r.cast;
      if (r.watched) s.watched = s.episodes ? Math.min(r.watched, s.episodes) : r.watched;
      if (r.droppedAt) s.droppedAt = r.droppedAt;
      if (s.myStatus !== "Dropped") s.droppedAt = null;
      s.updatedAt = now; updated++; touched.push(s);
    } else {
      const ns = cleanShow({id: newId(), addedAt: now, name: r.name, language: r.language || "Unknown", showStatus: r.showStatus || "Unknown",
        seasons: r.seasons, episodes: r.episodes, myStatus: r.myStatus || def, updatedAt: now, notes: r.notes || "", droppedAt: r.droppedAt, watched: r.watched,
        year: r.year, genres: r.genres, network: r.network, cast: r.cast});
      data.push(ns); touched.push(ns);
      added++;
    }
  }
  save(); render(); $("importDlg").close();
  const bits = [];
  if (added) bits.push(`Imported ${added} ${added === 1 ? "show" : "shows"}`);
  if (updated) bits.push(`${added ? "updated" : "Updated"} ${updated}`);
  toast(bits.join(", "), {undo: () => restore(prev)});
  if ($("impLookup").checked && touched.some(needsDetails)) enrichMissing(touched);
}
