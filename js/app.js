"use strict";

/* ---------- settings / PWA ---------- */
const settingsPage = $("settingsPage");
const settingsOpen = () => !settingsPage.hidden;
function openSettings() { if (!$('login').hidden) return; settingsPage.hidden=false; document.body.classList.add("settings-open"); appRoot.inert=true; refreshSyncUI(); }
function closeSettings() { settingsPage.hidden=true; document.body.classList.remove("settings-open"); appRoot.inert=false; }
$("settingsBtn").onclick=openSettings; $("settingsBack").onclick=closeSettings;
document.addEventListener("keydown", e => { if(e.key === "Escape" && settingsOpen()) closeSettings(); });
$("installApp").onclick=async()=>{ if(!window.__installPrompt)return; window.__installPrompt.prompt(); await window.__installPrompt.userChoice; window.__installPrompt=null; $("installApp").hidden=true; };
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();window.__installPrompt=e;$("installApp").hidden=false;$("installHint").hidden=true;});
window.addEventListener("appinstalled",()=>{window.__installPrompt=null;$("installApp").hidden=true;$("installHint").textContent="Series Tracker is installed on this device.";$("installHint").hidden=false;});
if("serviceWorker" in navigator && location.protocol !== "file:") window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));


/* ---------- install-only gate ---------- */
const mq = q => !!(window.matchMedia && matchMedia(q).matches);
const isInstalledApp = () => mq("(display-mode: standalone)") || mq("(display-mode: fullscreen)") || mq("(display-mode: minimal-ui)")
  || mq("(display-mode: window-controls-overlay)") || navigator.standalone === true || document.referrer.startsWith("android-app://");
const GATED = INSTALLED_ONLY && !isInstalledApp() && !["localhost", "127.0.0.1"].includes(location.hostname);
function showGate() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const steps = ios
    ? ["Open this page in <b>Safari</b> (installing doesn't work in other in-app browsers).", "Tap the <b>Share</b> button.", "Choose <b>Add to Home Screen</b>, then <b>Add</b>.", "Open <b>Series Tracker</b> from your home screen."]
    : ["Tap the browser menu (<b>⋮</b> or the install icon in the address bar).", "Choose <b>Install app</b> or <b>Add to Home screen</b>.", "Open <b>Series Tracker</b> from your home screen or app list."];
  $("gateSteps").innerHTML = steps.map(t => `<li>${t}</li>`).join("");
  $("gate").hidden = false; document.body.classList.add("locked"); appRoot.inert = true;
  const sync = () => { $("gateInstall").hidden = !window.__installPrompt; $("gateSteps").hidden = !!window.__installPrompt; };
  sync(); window.addEventListener("beforeinstallprompt", () => setTimeout(sync, 0));
  $("gateInstall").onclick = async () => {
    if (!window.__installPrompt) return;
    window.__installPrompt.prompt(); await window.__installPrompt.userChoice; window.__installPrompt = null; sync();
  };
  window.addEventListener("appinstalled", () => { $("gateDone").hidden = false; $("gateInstall").hidden = true; $("gateSteps").hidden = true; });
}

/* ---------- wiring ---------- */
$("addBtn").onclick = () => openShowDialog(null, $("newName").value.trim(), defaultMyStatus());
$("newName").addEventListener("keydown", e => { if (e.key === "Enter") openShowDialog(null, $("newName").value.trim(), defaultMyStatus()); });
["search", "statusFilter", "showFilter", "langFilter", "sortBy"].forEach(id => $(id).addEventListener("input", render));
$("clearFilters").onclick = clearFilters;
$("airing").onclick = () => {
  tab = "library";
  const f = $("showFilter"); f.value = f.value === "Ongoing" ? "" : "Ongoing"; render();
};
$("legend").addEventListener("click", e => {
  const b = e.target.closest("[data-status]"); if (!b) return;
  tab = "library";
  const f = $("statusFilter"); f.value = f.value === b.dataset.status ? "" : b.dataset.status; render();
});
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
document.querySelectorAll('input[name="my"]').forEach(r => r.addEventListener("change", syncDropField));

/* dropped: ask which episode */
let dropId = null;
function openDropDialog(s) {
  dropId = s.id; $("dropSub").textContent = s.episodes ? `${s.name} has ${s.episodes} episodes.` : s.name;
  $("dropEp").value = s.droppedAt ?? ""; $("dropEp").max = s.episodes || ""; $("dropErr").hidden = true;
  $("dropDlg").showModal();
}
$("dropForm").addEventListener("submit", e => {
  e.preventDefault();
  const s = data.find(x => x.id === dropId); if (!s) return $("dropDlg").close();
  const raw = $("dropEp").value.trim(), v = intOrNull(raw), err = t => { $("dropErr").textContent = t; $("dropErr").hidden = false; };
  if (raw !== "" && !v) return err("Enter a whole number, 1 or more.");
  if (v && s.episodes && v > s.episodes) return err(`This show has ${s.episodes} episodes. Enter a number from 1 to ${s.episodes}.`);
  s.droppedAt = v; s.updatedAt = Date.now(); save(); $("dropDlg").close(); render();
  toast(v ? `Dropped "${s.name}" at episode ${v}` : `Marked "${s.name}" as Dropped`);
});
$("dropSkip").onclick = () => {
  const s = data.find(x => x.id === dropId); $("dropDlg").close(); if (s) toast(`Marked "${s.name}" as Dropped`);
};
// +1 / -1 episode on a show you are watching
function stepEpisode(id, d, row) {
  const s = data.find(x => x.id === id); if (!s || isPlan(s)) return;
  const prev = JSON.stringify(data), was = s.myStatus, n = s.episodes;
  s.watched = Math.max(0, watchedNow(s) + d);
  if (n && s.watched >= n) { s.watched = n; s.myStatus = "Completed"; s.droppedAt = null; }
  else if (d > 0 && s.myStatus === "On Hold") s.myStatus = "Watching";
  s.updatedAt = Date.now(); save();
  if (s.myStatus === was) {
    refreshProg(row, s);
    const again = row.querySelector(`[data-act="${d > 0 ? "inc" : "dec"}"]`); if (again && !again.disabled) again.focus();
    return;
  }
  render();
  toast(s.myStatus === "Completed" ? `Finished "${s.name}". Marked as Completed` : `Now watching "${s.name}"`, {undo: () => restore(prev)});
}
$("tbody").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const row = b.closest("tr[data-id]"), id = row ? Number(row.dataset.id) : null;
  if (b.dataset.act === "edit") openShowDialog(data.find(s => s.id === id));
  else if (b.dataset.act === "delete") deleteShow(id);
  else if (b.dataset.act === "inc" || b.dataset.act === "dec") stepEpisode(id, b.dataset.act === "inc" ? 1 : -1, row);
  else if (b.dataset.act === "clear") clearFilters();
  else if (b.dataset.act === "add") openShowDialog(null, "", defaultMyStatus());
});
$("tbody").addEventListener("change", e => {
  const sel = e.target.closest('select[data-act="status"]'); if (!sel) return;
  const row = sel.closest("tr[data-id]"), s = data.find(x => x.id === Number(row.dataset.id)); if (!s) return;
  const was = s.myStatus;
  if (was === "Dropped" && s.droppedAt) s.watched = Math.max(s.watched || 0, s.droppedAt);   // resuming a dropped show keeps your place
  s.myStatus = sel.value; s.updatedAt = Date.now();
  if (s.myStatus === "Completed" && s.episodes) s.watched = s.episodes;
  if (s.myStatus !== "Dropped") s.droppedAt = null;
  save();
  const f = $("statusFilter").value;
  const stays = (tab === "plan") === isPlan(s) && (!f || f === s.myStatus);
  if (!stays || s.myStatus === "Dropped" || was === "Dropped") render();     // otherwise just refresh the pill and counts, so focus stays put
  else { row.querySelector(".c-my").className = "c-my st-" + slug(s.myStatus); refreshProg(row, s); renderSummary(); renderTabs(); }
  if (s.myStatus === "Dropped") return openDropDialog(s);
  toast((was === PLAN) !== isPlan(s) ? `Moved "${s.name}" to ${isPlan(s) ? "Plan to watch" : "My shows"}` : `Marked "${s.name}" as ${s.myStatus}`);
});
$("showForm").addEventListener("submit", saveShow);
$("fName").addEventListener("input", () => { showError(""); Object.assign(lk, {dirty: false, onlyMissing: false, warned: false}); scheduleLookup(); });
["fLang", "fShowStatus", "fSeasons", "fEpisodes"].forEach(id => $(id).addEventListener("input", () => {
  lk.dirty = true; if (lk.status === "found" || lk.status === "saved") renderLookup();
}));
$("lookup").addEventListener("click", e => {
  const b = e.target.closest("[data-lk],[data-alt]"); if (!b) return;
  if (b.dataset.alt !== undefined) return chooseAlt(Number(b.dataset.alt));
  if (b.dataset.lk === "manual") { lk.manual = !lk.manual; renderLookup(); }
  else lookupNow();
});
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
[showDlg, $("syncDlg"), $("dataDlg"), $("importDlg")].forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));

$("syncChip").onclick = openSync;
$("googleSignIn").onclick = signIn;
$("loginGoogle").onclick = signIn;
$("loginGuest").onclick = () => { store(GUEST_KEY, "1"); msg(""); enterApp(); };
function syncThemeButtons() {
  const dark = document.documentElement.dataset.mode === "dark", t = dark ? "Switch to light mode" : "Switch to dark mode";
  document.querySelectorAll("[data-theme-toggle]").forEach(b => { b.setAttribute("aria-label", t); b.title = t; });
}
document.querySelectorAll("[data-theme-toggle]").forEach(b => b.addEventListener("click", () => {
  window.__setTheme(document.documentElement.dataset.mode === "dark" ? "light" : "dark"); syncThemeButtons();
}));
new MutationObserver(syncThemeButtons).observe(document.documentElement, {attributes: true, attributeFilter: ["data-mode"]});
$("tbody").addEventListener("error", e => {
  const im = e.target; if (!(im instanceof HTMLImageElement)) return;
  const row = im.closest("tr[data-id]"), s = row && data.find(x => x.id === Number(row.dataset.id));
  im.outerHTML = posterHtml({name: s ? s.name : "?", poster: ""});
}, true);
$("saveClientId").onclick = () => {
  const v = $("clientIdInput").value.trim();
  if (!/\.apps\.googleusercontent\.com$/.test(v)) return msg("That doesn't look like a client ID. It ends in .apps.googleusercontent.com.", "error");
  clientId = v; store(CLIENT_KEY, v); msg("Client ID saved. You can sign in now.", "ok");
};
$("backupNow").onclick = () => { msg(""); runBackup(true); };
$("restoreNow").onclick = restoreNow;
$("signOut").onclick = openSignOut;
$("soCancel").onclick = () => $("signOutDlg").close();
$("soKeep").onclick = signOutKeep;
$("soClear").onclick = signOutAndClear;
$("autoBackup").onchange = e => { g.auto = e.target.checked; store(AUTO_KEY, g.auto ? "1" : "0"); if (g.auto) scheduleBackup(); };
$("dataBtn").onclick = () => { dataMsg(""); refreshDataInfo(); $("dataDlg").showModal(); };
$("fillBtn").onclick = () => { dataMsg(""); enrichMissing(); };
$("testConn").onclick = async () => {
  dataMsg("Testing the connection…"); cspBlocked = false;
  try {
    const r = await getJSON("https://api.tvmaze.com/search/shows?q=" + encodeURIComponent("crash landing on you"));
    let text = `Connected to TVmaze (${Array.isArray(r) ? r.length : 0} results for a test search).`;
    if (tmdbKey) { await tmdbReq("/configuration"); text += " TMDB key works too."; }
    dataMsg(text, "ok");
  } catch (e) { dataMsg(explainError(e), "error"); }
};
$("saveTmdb").onclick = async () => {
  const v = $("tmdbKey").value.trim(), old = tmdbKey;
  if (!v) { tmdbKey = ""; store(TMDB_STORE, ""); searchCache.clear(); renderNote(); return dataMsg("TMDB key removed. Lookups use TVmaze only.", "ok"); }
  tmdbKey = v; dataMsg("Checking key…");
  try { await tmdbReq("/configuration"); store(TMDB_STORE, v); searchCache.clear(); renderNote(); dataMsg("TMDB key saved. Lookups now search TMDB as well.", "ok"); }
  catch (e) { tmdbKey = old; dataMsg(e.status === 401 ? "TMDB rejected that key. Copy the API Key (v3) from your TMDB account settings." : "Couldn't check the key. Check your connection and try again.", "error"); }
};
$("exportXlsx").onclick = exportXlsx;
$("exportJson").onclick = exportJson;
$("pickFile").onclick = () => $("importFile").click();
$("importFile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  dataMsg(`Reading ${f.name}…`);
  try { openImport(await parseImportFile(f), f.name); }
  catch (err) { dataMsg(err.message || "Couldn't read that file.", "error"); }
};
$("impSheet").onchange = e => { imp.sheet = Number(e.target.value); $("impHeader").checked = looksLikeHeader(imp.sheets[imp.sheet].rows[0]); rebuildImportMap(); };
$("impHeader").onchange = rebuildImportMap;
$("impMap").addEventListener("change", previewImport);
$("impUpdate").onchange = previewImport;
$("impGo").onclick = applyImport;
$("cMerge").onclick = () => resolveConflict("merge");
$("cDrive").onclick = () => resolveConflict("drive");
$("cDevice").onclick = () => resolveConflict("device");
$("conflictDlg").addEventListener("close", () => {
  if (pending) { g.status = "error"; g.error = "choose which copy to keep."; refreshSyncUI(); }
});

render();
renderNote();
if (!store("seriesTracker.probe", "1")) $("storageWarn").hidden = false;
refreshSyncUI();
syncThemeButtons();
if (GATED) showGate();
else if (!g.user && localStorage.getItem(GUEST_KEY) !== "1") showLogin(); else enterApp();

/* quiet Google renewal: on open, and again on a tap if the browser blocked the first try (at most once every 5 minutes) */
if (GOOGLE_CLIENT_ID) $("setup").hidden = true;
if (g.user && !GATED) silentReconnect().then(ok => { if (ok) runBackup(false); });
let lastTapTry = 0;
document.addEventListener("pointerdown", e => {
  if (GATED || !g.user || tokenValid() || silentBusy || g.status === "syncing" || g.status === "error") return;
  if (e.target.closest && e.target.closest("dialog, #login, #settingsPage, #syncChip")) return;
  if (Date.now() - lastTapTry < 300000) return;
  lastTapTry = Date.now();
  silentReconnect().then(ok => { if (ok) runBackup(false); });
}, {passive: true});
