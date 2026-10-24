"use strict";

/* ---------- add / edit ---------- */
let editingId = null;
const getMyStatus = () => (document.querySelector('input[name="my"]:checked') || {}).value || "Watching";
const setMyStatus = v => { const r = document.querySelector(`input[name="my"][value="${v}"]`); if (r) r.checked = true; };
const showDlg = $("showDlg");
const missingFacts = s => s.language === "Unknown" || s.showStatus === "Unknown" || s.seasons == null || s.episodes == null;
const needsDetails = s => missingFacts(s) || s.poster === "" || !s.synopsis || !s.year || !s.cast.length || !s.genres.length;

const lk = {token: 0, timer: null, pending: null, status: "idle", meta: null, results: [], alts: [], query: "",
  manual: false, dirty: false, onlyMissing: false, warned: false, errorDetail: "", poster: "", synopsis: ""};

function currentFacts() {
  return {language: $("fLang").value.trim() || "Unknown", showStatus: $("fShowStatus").value,
    seasons: intOrNull($("fSeasons").value), episodes: intOrNull($("fEpisodes").value)};
}
function fillFields(m, onlyMissing) {
  const set = (id, v, isEmpty) => { if (!onlyMissing || isEmpty($(id).value)) $(id).value = v ?? ""; };
  set("fLang", m.language, v => !v.trim());
  set("fShowStatus", m.showStatus || "Unknown", v => v === "Unknown");
  set("fSeasons", m.seasons, v => !v);
  set("fEpisodes", m.episodes, v => !v);
}
const srcLabel = m => m && PROVIDERS[m.provider] ? PROVIDERS[m.provider].label : "the built-in list";

function foundCard() {
  const f = currentFacts(), m = lk.meta, saved = lk.status === "saved";
  const title = saved || !m ? $("fName").value.trim() : m.title;
  const year = !saved && m && m.year ? m.year : "";
  const pic = posterHtml({name: title, poster: saved ? lk.poster : (m && m.poster) || ""});
  const cell = (l, v) => `<div><span>${l}</span><b>${esc(v)}</b></div>`;
  const alts = lk.alts.length ? `<div class="alts"><span class="lbl">Not the right show?</span>${lk.alts.map((a, i) =>
    `<button type="button" class="alt" data-alt="${i}">${esc(a.title)}<span>${esc([a.year, a.language].filter(Boolean).join(", "))}</span></button>`).join("")}</div>` : "";
  const plot = (saved ? lk.synopsis : (m && m.synopsis) || "");
  const plotHtml = plot ? `<p class="plot">${esc(plot.length > 240 ? plot.slice(0, 237).trimEnd() + "…" : plot)}</p>` : "";
  const weak = !saved && m && m.score != null && m.score < 0.75 ? `<p class="hint">Closest match. Check that this is the right show.</p>` : "";
  return `<div class="found"><div class="found-top">${pic}<div class="found-main">
    <div class="found-head"><b>${esc(title)}</b>${year ? `<span>${esc(year)}</span>` : ""}</div>
    <div class="facts">${cell("Language", f.language)}${cell("Show status", f.showStatus)}${cell("Seasons", f.seasons ?? "—")}${cell("Episodes", f.episodes ?? "—")}</div></div></div>
    ${plotHtml}<p class="hint">${saved ? "Saved in your library." : "Filled in from " + esc(srcLabel(m)) + "."}</p>${weak}
    <div class="found-actions"><button type="button" class="ghost" data-lk="manual">${lk.manual ? "Hide details editor" : "Edit details"}</button>${
      saved ? `<button type="button" class="ghost" data-lk="refresh">Look up again</button>` : ""}</div>${alts}</div>`;
}
function renderLookup() {
  const q = lk.query, tip = tmdbKey ? "" : " A free TMDB key in Import / Export improves results for Korean and Chinese dramas.";
  $("manualBox").hidden = !lk.manual;
  $("lookup").innerHTML = {
    idle: `<p class="hint">Type a show name. Language, seasons, episodes, and show status are filled in for you.</p>`,
    searching: `<p class="hint"><span class="spin" aria-hidden="true"></span>Looking up details…</p>`,
    none: `<p class="hint">Couldn't find "${esc(q)}" online. Fill in the details below, or save it as is.${tip}</p>`,
    error: `<p class="error">Couldn't look up "${esc(q)}".</p><p class="hint">${esc(lk.errorDetail)}</p><p class="hint">You can fill in the details below, or <button type="button" class="linkbtn" data-lk="retry">try again</button>.</p>`
  }[lk.status] || foundCard();
}
function scheduleLookup() {
  clearTimeout(lk.timer); lk.timer = null; lk.token++; lk.pending = null;
  const q = $("fName").value.trim();
  Object.assign(lk, {query: q, meta: null, alts: [], results: []});
  if (norm(q).length < 2) { lk.status = "idle"; renderLookup(); return; }
  lk.status = "searching"; renderLookup();
  const t = lk.token;
  lk.timer = setTimeout(() => { lk.timer = null; lk.pending = runLookup(q, t); }, 450);
}
function lookupNow() {
  clearTimeout(lk.timer); lk.timer = null;
  const q = $("fName").value.trim(), t = ++lk.token;
  Object.assign(lk, {query: q, dirty: false, onlyMissing: false, meta: null, alts: [], results: [], status: "searching"});
  renderLookup(); lk.pending = runLookup(q, t);
}
function flushLookup() {
  if (lk.timer) { clearTimeout(lk.timer); lk.timer = null; lk.pending = runLookup(lk.query, lk.token); }
  return lk.pending || Promise.resolve();
}
async function runLookup(q, token) {
  try {
    const d = DEMO.find(x => norm(x.name) === norm(q));
    let meta, results = [];
    if (d) meta = {...d, title: d.name, provider: "builtin", score: 1};
    else {
      results = await searchOnline(q);
      if (token !== lk.token) return;
      if (!results.length) { lk.status = "none"; lk.manual = true; renderLookup(); return; }
      const {item, score} = pickBest(results, q);
      meta = {...(await detailsOnline(item)), score};
      if (token !== lk.token) return;
      lk.results = results; lk.alts = results.filter(r => r !== item).slice(0, 4);
    }
    lk.meta = meta; lk.status = "found";
    if (!lk.dirty) fillFields(meta, lk.onlyMissing);
  } catch (e) {
    if (token !== lk.token) return;
    lk.status = "error"; lk.manual = true; lk.errorDetail = explainError(e);
  }
  renderLookup();
  if (lk.status === "found" && lk.meta && lk.meta.provider === "builtin" && !lk.meta.poster && token === lk.token) {
    const m = lk.meta;
    posterFor(q).then(url => { if (url && token === lk.token && lk.meta === m) { m.poster = url; renderLookup(); } });
  }
}
async function chooseAlt(i) {
  const item = lk.alts[i]; if (!item) return;
  const token = ++lk.token; lk.status = "searching"; renderLookup();
  try {
    const meta = {...(await detailsOnline(item)), score: 1};
    if (token !== lk.token) return;
    lk.dirty = false; lk.onlyMissing = false; lk.meta = meta; lk.status = "found";
    lk.alts = lk.results.filter(r => r !== item).slice(0, 4);
    fillFields(meta, false);
  } catch (e) { if (token !== lk.token) return; lk.status = "error"; lk.manual = true; lk.errorDetail = explainError(e); }
  renderLookup();
}

function showError(text) { const e = $("formError"); e.textContent = text || ""; e.hidden = !text; }
function syncDropField() {
  const st = getMyStatus();
  $("dropField").hidden = st !== "Dropped"; $("watchField").hidden = !(st === "Watching" || st === "On Hold");
}
function openShowDialog(show, preset = "", status = "Watching") {
  editingId = show ? show.id : null; showError("");
  clearTimeout(lk.timer); lk.timer = null; lk.token++; lk.pending = null;
  Object.assign(lk, {status: "idle", meta: null, results: [], alts: [], query: "", manual: false, dirty: false, onlyMissing: false, warned: false, poster: "", synopsis: ""});
  $("showTitle").textContent = show ? "Edit show" : "Add show";
  $("fName").value = show ? show.name : preset;
  $("fLang").value = show && show.language !== "Unknown" ? show.language : "";
  $("fShowStatus").value = show ? show.showStatus : "Unknown";
  $("fSeasons").value = show?.seasons ?? ""; $("fEpisodes").value = show?.episodes ?? "";
  setMyStatus(show ? show.myStatus : status);
  $("fDroppedAt").value = show?.droppedAt ?? ""; $("fNotes").value = show?.notes ?? "";
  $("fWatched").value = (!show || show.myStatus === "Completed" || isPlan(show) ? "" : show.myStatus === "Dropped"
    ? Math.max(show.watched || 0, show.droppedAt || 0) : show.watched) || "";
  syncDropField();
  if (show) {
    lk.status = "saved"; lk.query = show.name;
    lk.poster = show.poster || ""; lk.synopsis = show.synopsis || "";
    if (missingFacts(show)) { lk.onlyMissing = true; scheduleLookup(); }
  } else if (preset.trim()) scheduleLookup();
  renderLookup();
  showDlg.showModal();
}
async function saveShow(e) {
  e.preventDefault();
  const typed = $("fName").value.trim();
  if (!typed) return showError("Enter a show name.");
  const dupOf = n => data.find(s => s.id !== editingId && norm(s.name) === norm(n));
  if (dupOf(typed)) return showError(`"${dupOf(typed).name}" is already in your library.`);
  const btn = $("saveShowBtn");
  if (lk.status === "searching" || lk.timer) {          // give a running lookup a moment, but never hold the save hostage
    btn.disabled = true; btn.textContent = "Saving…";
    await Promise.race([flushLookup(), sleep(2500)]);
    btn.disabled = false; btn.textContent = "Save show";
    if (!showDlg.open) return;
  }
  const f = currentFacts();
  const status = getMyStatus();
  const droppedAt = status === "Dropped" ? intOrNull($("fDroppedAt").value) : null;
  if (droppedAt && f.episodes && droppedAt > f.episodes) return showError(`This show has ${f.episodes} episodes. Enter an episode from 1 to ${f.episodes}.`);
  const prior0 = editingId !== null ? data.find(x => x.id === editingId) : null;
  let watched = prior0 ? Math.max(prior0.watched || 0, prior0.myStatus === "Dropped" ? prior0.droppedAt || 0 : 0) : 0;
  if (status === "Watching" || status === "On Hold") {
    const raw = $("fWatched").value.trim();
    if (raw !== "" && raw !== "0" && !intOrNull(raw)) return showError("Enter the number of episodes you have watched, or leave it empty.");
    watched = intOrNull(raw) || 0;
    if (f.episodes && watched > f.episodes) return showError(`This show has ${f.episodes} episodes. Enter a number from 0 to ${f.episodes}.`);
  } else if (status === "Completed") watched = f.episodes || watched;
  else if (status === "Dropped") watched = droppedAt || watched;
  const autoDone = (status === "Watching" || status === "On Hold") && f.episodes && watched >= f.episodes;
  let name = typed;
  if (lk.status === "found" && !lk.onlyMissing && lk.meta && lk.meta.title && titleScore(typed, lk.meta.title) >= 0.5) name = lk.meta.title;
  if (dupOf(name)) return showError(`"${dupOf(name).name}" is already in your library.`);
  const isEdit = editingId !== null, prior = isEdit ? data.find(x => x.id === editingId) : null, oldName = prior ? prior.name : "";
  const found = lk.status === "found" && lk.meta ? lk.meta.poster || "" : "";
  const poster = found && (!lk.onlyMissing || !posterUrl(prior)) ? found : (prior ? prior.poster : "");
  const fm = lk.status === "found" && lk.meta && lk.meta.synopsis && (!lk.onlyMissing || !(prior && prior.synopsis)) ? lk.meta : null;
  const syn = fm ? {synopsis: fm.synopsis, synopsisSrc: fm.synopsisSrc || "", synopsisUrl: fm.synopsisUrl || ""}
    : {synopsis: prior ? prior.synopsis : "", synopsisSrc: prior ? prior.synopsisSrc : "", synopsisUrl: prior ? prior.synopsisUrl : ""};
  const meta = lk.status === "found" && lk.meta ? lk.meta : null;
  const extra = {
    year: meta && meta.year || prior && prior.year || "",
    cast: meta && meta.cast && meta.cast.length ? meta.cast : prior && prior.cast || [],
    genres: meta && meta.genres && meta.genres.length ? meta.genres : prior && prior.genres || [],
    network: meta && meta.network || prior && prior.network || ""
  };
  const rec = {name, ...f, myStatus: autoDone ? "Completed" : status, watched, updatedAt: Date.now(), poster, ...syn, ...extra, notes: $("fNotes").value.trim().slice(0, 2000), droppedAt};
  if (isEdit) Object.assign(data.find(s => s.id === editingId), rec);
  else data.push({id: newId(), addedAt: Date.now(), ...rec});
  const shown = isEdit ? prior : data[data.length - 1];
  save(); $("newName").value = ""; showDlg.close();
  const home = isPlan(shown) ? "plan" : "library";              // show the person where the show now lives
  if (tab !== home) { tab = home; if (home === "plan") $("statusFilter").value = ""; }
  render();
  if (!visible().some(x => x.id === shown.id)) clearFilters();   // a search or filter would otherwise hide it
  toast((isEdit ? "Changes saved" : `Added "${name}"`) + (autoDone ? ". All episodes watched, so it is now Completed" : "") + (missingFacts(shown) ? ". Its details will fill in automatically if they can be found." : ""));
  clearMiss(oldName); clearMiss(name);          // a new or renamed show deserves a fresh search
  if (needsDetails(shown)) enrichMissing([shown], {silent: true});
}

/* fill in missing details for shows already in the library */
let enriching = false;
function setEnrich(text) { $("enrich").innerHTML = text ? `<span class="spin" aria-hidden="true"></span>${esc(text)}` : ""; }
function refreshDataInfo() {
  const n = data.filter(needsDetails).length;
  $("missingCount").textContent = n ? `${n} ${n === 1 ? "show is" : "shows are"} missing details, a poster or a synopsis.` : "Every show has its details, poster and synopsis.";
  $("fillBtn").disabled = !n || enriching;
  $("tmdbKey").value = tmdbKey;
}
function renderNote() {
  $("note").textContent = "Language, seasons, episodes, show status, and posters are looked up automatically when you add a show, using TVmaze" +
    (tmdbKey ? " and TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB." : ".");
}
// Fill whatever is missing on one show. Returns what changed so the caller can report it.
async function fillShow(s) {
  const factsMissing = missingFacts(s);
  let gotFacts = false, gotPoster = false;
  const m = await lookupBest(s.name, true, !factsMissing);
  if (m) {
    if (s.language === "Unknown" && m.language) { s.language = m.language; gotFacts = true; }
    if (s.showStatus === "Unknown" && m.showStatus) { s.showStatus = m.showStatus; gotFacts = true; }
    if (s.seasons == null && m.seasons) { s.seasons = m.seasons; gotFacts = true; }
    if (s.episodes == null && m.episodes) { s.episodes = m.episodes; gotFacts = true; }
    if (s.poster === "" && m.poster) { s.poster = m.poster; gotPoster = true; }
    if (!s.synopsis && m.synopsis) { s.synopsis = m.synopsis; s.synopsisSrc = m.synopsisSrc || ""; s.synopsisUrl = m.synopsisUrl || ""; gotFacts = true; }
    if (!s.year && m.year) { s.year = m.year; gotFacts = true; }
    if (!s.cast.length && m.cast && m.cast.length) { s.cast = m.cast; gotFacts = true; }
    if (!s.genres.length && m.genres && m.genres.length) { s.genres = m.genres; gotFacts = true; }
    if (!s.network && m.network) { s.network = m.network; gotFacts = true; }
  }
  if (s.poster === "") {
    if (m && m.provider === "builtin") { const u = await posterFor(s.name); s.poster = u || "none"; gotPoster = !!u; }
    else if (m || !factsMissing) s.poster = "none";        // looked online and there is no poster to be had
  }
  if (needsDetails(s)) noteMiss(s); else clearMiss(s.name);   // whatever is still missing will not be searched again for a while
  return {found: !!m, factsMissing, changed: gotFacts || gotPoster};
}
async function enrichMissing(list, opts = {}) {
  if (enriching) return opts.silent ? undefined : dataMsg("Already looking up details in the background. Try again in a moment.");
  const ids = (list || data).filter(s => needsDetails(s) && !(opts.skipMisses && recentMiss(s))).map(s => s.id);
  if (!ids.length) return opts.silent ? undefined : dataMsg("Every show already has its details.", "ok");
  enriching = true; refreshDataInfo();
  let checked = 0, filled = 0, notFound = 0, offline = false, why = "";
  const prev = JSON.stringify(data);
  for (const id of ids) {
    const s = data.find(x => x.id === id);
    checked++;
    if (!s || !needsDetails(s)) continue;
    setEnrich(`${opts.silent ? "Looking up posters" : "Looking up details"}, ${checked} of ${ids.length}`);
    try {
      const beforeShow = JSON.stringify(s);
      const r = await fillShow(s);
      if (r.changed) filled++;
      if (JSON.stringify(s) !== beforeShow) save();
      else if (!r.found && r.factsMissing) notFound++;
    } catch (e) { offline = true; why = explainError(e); break; }
    await sleep(500);
  }
  enriching = false; setEnrich(""); refreshDataInfo(); render();
  if (opts.silent && (offline || !filled)) return;      // background run: stay quiet unless something was added
  const text = offline ? `Stopped after filling in ${filled}. ${why}`
    : opts.silent ? `Added posters and details for ${filled} ${filled === 1 ? "show" : "shows"}.`
    : `Filled in details for ${filled} ${filled === 1 ? "show" : "shows"}${notFound ? `, ${notFound} not found online` : ""}.`;
  if ($("dataDlg").open) dataMsg(text, offline ? "error" : "ok");
  else toast(text, filled ? {undo: () => restore(prev)} : {});
}

function deleteShow(id) {
  const s = data.find(x => x.id === id); if (!s) return;
  const prev = JSON.stringify(data);
  data = data.filter(x => x.id !== id); save(); render();
  toast(`Deleted "${s.name}"`, {undo: () => restore(prev)});
}
