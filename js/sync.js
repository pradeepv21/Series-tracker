"use strict";

/* ---------- Google sign-in and Drive backup ---------- */
const ACCT_KEY = "seriesTracker.acct";   // which Google account the list on this device belongs to
let clientId = (GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_KEY) || "").trim();
const g = {
  token: null, expires: 0, user: readJSON(USER_KEY), fileId: null, remoteMod: null,
  auto: localStorage.getItem(AUTO_KEY) !== "0", status: "idle", error: "",
  lastSync: Number(localStorage.getItem(LAST_KEY)) || 0, synced: false
};
if (g.user) g.status = "needs-auth";
const tokenValid = () => !!g.token && Date.now() < g.expires;
const authErr = () => Object.assign(new Error("Session ended. Reconnect to resume backups."), {auth: true});

function msg(text, kind) {
  ["syncMsg", "loginMsg"].forEach(id => { const el = $(id); el.textContent = text || ""; el.className = "msg " + (kind || ""); });
}
function setStatus(s) { g.status = s; if (s !== "error") g.error = ""; refreshSyncUI(); }
function statusText() {
  if (!g.user) return "Not connected to Google Drive.";
  if (g.status === "syncing") return "Backing up…";
  if (g.status === "needs-auth") return "Session ended. Reconnect to resume backups.";
  if (g.status === "error") return "Backup paused: " + g.error;
  return g.lastSync ? `Last backed up ${fmtWhen(g.lastSync)}.` : "Not backed up yet.";
}
function refreshSyncUI() {
  const st = g.user ? g.status : "off", chip = $("syncChip");
  chip.dataset.state = st;
  chip.classList.toggle("has-av", !!g.user);
  if (g.user) {
    const av = $("chipAv"), initial = (g.user.name || "?").trim().charAt(0).toUpperCase();
    if (g.user.picture) {
      if (!av.firstChild || av.firstChild.nodeType !== 1 || av.firstChild.getAttribute("src") !== g.user.picture) {
        av.innerHTML = ""; const im = new Image(); im.alt = ""; im.referrerPolicy = "no-referrer";
        im.onerror = () => { av.textContent = initial; }; im.src = g.user.picture; av.appendChild(im);
      }
    } else av.textContent = initial;
  }
  $("syncChipText").textContent = {off: "Back up", idle: "Back up", ok: "Backed up", syncing: "Backing up…",
    "needs-auth": "Reconnect", error: "Backup paused"}[st];
  if ($("settingsSyncSub")) $("settingsSyncSub").textContent = statusText();
  chip.title = statusText();
  $("syncOut").hidden = !!g.user; $("syncIn").hidden = !g.user;
  if (!g.user) return;
  $("acctName").textContent = g.user.name; $("acctEmail").textContent = g.user.email;
  const av = $("avatar");
  if (g.user.picture) {
    if (!av.firstChild || av.firstChild.getAttribute("src") !== g.user.picture) {
      av.innerHTML = ""; const im = new Image(); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = g.user.picture; av.appendChild(im);
    }
  } else av.textContent = (g.user.name || "?").trim().charAt(0).toUpperCase();
  $("syncStatus").textContent = statusText();
  $("autoBackup").checked = g.auto;
  $("backupNow").disabled = $("restoreNow").disabled = g.status === "syncing";
  $("backupNow").textContent = tokenValid() ? "Back up now" : "Reconnect and back up";
}

function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    if (!clientId) return reject(new Error("Add your Google client ID first (see Google project settings)."));
    if (!(window.google && google.accounts && google.accounts.oauth2))
      return reject(new Error("Google sign-in didn't load. Check your connection and reload the page."));
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPES, hint: g.user ? g.user.email : undefined,
      callback: r => r.error ? reject(new Error(r.error_description || r.error)) : resolve(r),
      error_callback: e => reject(new Error(
        e.type === "popup_closed" ? "The sign-in window was closed before finishing."
        : e.type === "popup_failed_to_open" ? "Your browser blocked the sign-in window. Allow pop-ups for this page and try again."
        : e.message || "Sign-in failed."))
    });
    tc.requestAccessToken({prompt});
  });
}
async function connect(prompt) {
  const r = await requestToken(prompt);
  if (!google.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE))
    throw new Error("Google Drive access wasn't granted. Sign in again and leave the Drive permission checked.");
  g.token = r.access_token; g.expires = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000;
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {headers: {Authorization: "Bearer " + g.token}});
    const u = await res.json();
    if (u.email) { g.user = {email: u.email, name: u.name || u.email, picture: u.picture || ""}; store(USER_KEY, JSON.stringify(g.user)); }
  } catch (e) {}
  if (!g.user) g.user = {email: "", name: "Google account", picture: ""};
}
// Renew the Google session without a visible prompt. This works while the person is still signed in to Google and has
// already approved this app. It never throws: it returns true on success and false if a real sign-in is needed.
let silentBusy = null;
function silentReconnect() {
  if (silentBusy) return silentBusy;
  if (!g.user || tokenValid() || !clientId || location.protocol === "file:") return Promise.resolve(false);
  silentBusy = (async () => {
    try {
      await Promise.race([connect("none"), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8000))]);
      g.synced = false;   // re-check Drive before uploading, in case another device changed it
      return true;
    } catch (e) { return false; }
    finally { silentBusy = null; }
  })();
  return silentBusy;
}
async function ensureToken(interactive) {
  if (tokenValid()) return;
  if (!interactive) { if (await silentReconnect()) return; throw authErr(); }
  await connect("");
  g.synced = false;
}
async function gfetch(url, opts = {}) {
  if (!tokenValid()) throw authErr();
  const res = await fetch(url, {...opts, headers: {Authorization: "Bearer " + g.token, ...(opts.headers || {})}});
  if (res.ok) return res;
  let m = res.statusText || "Request failed";
  try { m = (await res.json()).error.message || m; } catch (e) {}
  if (res.status === 401) { g.token = null; throw authErr(); }
  throw Object.assign(new Error(m), {status: res.status});
}
async function findBackup() {
  const p = new URLSearchParams({spaces: "appDataFolder", q: `name='${BACKUP_NAME}' and trashed=false`,
    fields: "files(id,modifiedTime)", orderBy: "modifiedTime desc", pageSize: "1"});
  const f = (await (await gfetch(`${API}/files?${p}`)).json()).files || [];
  return f[0] || null;
}
async function remoteMeta() {
  if (!g.fileId) return null;
  try { return await (await gfetch(`${API}/files/${g.fileId}?fields=modifiedTime`)).json(); }
  catch (e) { if (e.status === 404) { g.fileId = null; g.remoteMod = null; return null; } throw e; }
}
async function downloadBackup(id) {
  const p = await (await gfetch(`${API}/files/${id}?alt=media`)).json();
  return sanitizeList(Array.isArray(p) ? p : p.shows);
}
async function uploadBackup() {
  const body = JSON.stringify(payload());
  if (g.fileId) {
    try {
      const r = await gfetch(`${UPLOAD}/files/${g.fileId}?uploadType=media&fields=id,modifiedTime`,
        {method: "PATCH", headers: {"Content-Type": "application/json"}, body});
      g.remoteMod = (await r.json()).modifiedTime; return;
    } catch (e) { if (e.status !== 404) throw e; g.fileId = null; }
  }
  const b = "st" + Math.random().toString(36).slice(2);
  const meta = {name: BACKUP_NAME, parents: ["appDataFolder"], mimeType: "application/json"};
  const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--${b}--`;
  const r = await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`,
    {method: "POST", headers: {"Content-Type": `multipart/related; boundary=${b}`}, body: multipart});
  const j = await r.json(); g.fileId = j.id; g.remoteMod = j.modifiedTime;
}
function markSynced() {
  store(SYNCED_KEY, fingerprint(data)); g.lastSync = Date.now(); store(LAST_KEY, String(g.lastSync));
  if (g.user && g.user.email) store(ACCT_KEY, g.user.email.toLowerCase());   // remember whose list this device holds
  g.synced = true; setStatus("ok");
}

// Compare this device, Drive, and the state at the last successful sync, then pick the safe action.
let syncOnConnectPromise = null;
function syncOnConnect() {
  if (syncOnConnectPromise) return syncOnConnectPromise;
  syncOnConnectPromise = syncOnConnectImpl().finally(() => { syncOnConnectPromise = null; });
  return syncOnConnectPromise;
}
async function syncOnConnectImpl() {
  if (pending) return; // Keep an unresolved conflict visible; do not open duplicate prompts.
  g.synced = false; setStatus("syncing");
  const remote = await findBackup();
  if (!remote) { await uploadBackup(); markSynced(); return notify("Backed up to Google Drive."); }
  g.fileId = remote.id; g.remoteMod = remote.modifiedTime;
  const rlist = await downloadBackup(remote.id);
  const rfp = fingerprint(rlist), lfp = fingerprint(data), last = localStorage.getItem(SYNCED_KEY);
  if (rfp === lfp) { markSynced(); return notify("Your library is up to date with Google Drive."); }
  if (pristine || (!data.length && !last)) { replaceData(rlist, {silent: true}); markSynced(); return notify(`Restored ${rlist.length} shows from Google Drive.`); }
  if (last && rfp === last) { await uploadBackup(); markSynced(); return notify("Backed up to Google Drive."); }
  if (last && lfp === last) {
    const prev = JSON.stringify(data);
    replaceData(rlist, {silent: true}); markSynced();
    return notify(`Updated from Google Drive (${rlist.length} shows).`, {undo: () => restore(prev, {silent: true})});
  }
  openConflict(rlist, remote.modifiedTime);
}

let pending = null;
function openConflict(rlist, modified) {
  pending = {remote: rlist};
  $("cLocal").textContent = data.length; $("cLocalSub").textContent = data.length === 1 ? "show" : "shows";
  $("cRemote").textContent = rlist.length; $("cRemoteSub").textContent = (rlist.length === 1 ? "show" : "shows") + ", saved " + fmtWhen(modified);
  setStatus("error"); g.error = "choose which copy to keep."; refreshSyncUI();
  if ($("syncDlg").open) $("syncDlg").close();
  $("conflictDlg").showModal();
}
async function resolveConflict(choice) {
  const remote = pending.remote; pending = null; $("conflictDlg").close();
  const prev = JSON.stringify(data);
  try {
    setStatus("syncing");
    if (choice === "drive") {
      replaceData(remote, {silent: true}); markSynced();
      toast(`Using the Drive copy (${remote.length} shows)`, {undo: () => restore(prev, {silent: true})});
    } else if (choice === "device") {
      await uploadBackup(); markSynced(); toast("Drive updated with this device's copy");
    } else {
      const merged = mergeLists(data, remote);
      replaceData(merged, {silent: true}); await uploadBackup(); markSynced();
      toast(`Merged into ${merged.length} shows`, {undo: () => restore(prev, {silent: true})});
    }
  } catch (e) { reportSyncError(e); }
}

let backupPromise = null;
function runBackup(interactive) {
  if (backupPromise) return backupPromise;
  backupPromise = runBackupImpl(interactive).finally(() => { backupPromise = null; });
  return backupPromise;
}
async function runBackupImpl(interactive) {
  clearTimeout(backupTimer);
  try {
    await ensureToken(interactive);
    if (!g.synced) return await syncOnConnect();
    setStatus("syncing");
    const meta = await remoteMeta();
    if (meta && g.remoteMod && meta.modifiedTime !== g.remoteMod) return await syncOnConnect();
    await uploadBackup(); markSynced();
    if (interactive) msg("Backed up to Google Drive.", "ok");
  } catch (e) { reportSyncError(e); }
}
let backupTimer;
function scheduleBackup() {
  if (!g.user || !g.auto || !g.synced) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => runBackup(false), 2500);
}
function reportSyncError(e) {
  const m = e.auth ? e.message
    : e instanceof TypeError ? "Can't reach Google right now. Your library is still saved on this device."
    : e.message || "Something went wrong.";
  g.status = e.auth ? "needs-auth" : "error"; g.error = m;
  refreshSyncUI(); msg(m, "error");
}

async function signIn() {
  msg("");
  if (location.protocol === "file:") { $("setup").open = true; return msg("Open this page over http or host it first. Google sign-in doesn't work from a file.", "error"); }
  if (!clientId) { $("setup").open = true; return msg("Add your Google client ID first. The steps are below.", "error"); }
  try {
    await connect("select_account");
    const prev = localStorage.getItem(ACCT_KEY), now = (g.user.email || "").toLowerCase();
    if (prev && now && prev !== now && data.length) {      // the list on this device belongs to a different Google account
      const unsaved = fingerprint(data) !== localStorage.getItem(SYNCED_KEY);
      const ok = confirm(`This device still holds a list from another Google account (${prev}).\n\nTo keep the two accounts apart, that list will be removed from this device and replaced with the backup from ${g.user.email}.`
        + (unsaved ? "\n\nSome of its latest changes were never backed up, so they would be lost." : "") + "\n\nContinue?");
      if (!ok) { endSession(); showLogin(); return msg("Sign-in cancelled. The list on this device was not changed.", "ok"); }
      wipeLocalList();
    }
    enterApp(); await syncOnConnect();
  } catch (e) { reportSyncError(e); }
}
function endSession() {
  clearTimeout(backupTimer);
  const oldToken = g.token;
  g.token = null; g.user = null; g.fileId = null; g.remoteMod = null; g.synced = false; g.status = "idle";
  if (oldToken && window.google?.accounts?.oauth2?.revoke) { try { google.accounts.oauth2.revoke(oldToken, () => {}); } catch (e) {} }
  try { localStorage.removeItem(USER_KEY); } catch (e) {}
  try { localStorage.removeItem(GUEST_KEY); } catch (e) {}
  refreshSyncUI();
}
// Remove this device's copy of the list and everything that ties it to an account. The backup in Drive is not touched.
function wipeLocalList() {
  [KEY, SYNCED_KEY, LAST_KEY, ACCT_KEY].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  data = []; pristine = true; g.lastSync = 0; render();
}
const unsavedChanges = () => data.length > 0 && fingerprint(data) !== localStorage.getItem(SYNCED_KEY);
function openSignOut() {
  $("soSub").textContent = unsavedChanges()
    ? "Some recent changes are not in Google Drive yet. If you remove the list from this device, we will try to back it up first."
    : "Your list is safe in Google Drive. Removing it from this device too is a good idea on a shared phone or computer.";
  $("syncDlg").close(); $("signOutDlg").showModal();
}
function signOutKeep() {
  $("signOutDlg").close(); endSession(); showLogin();
  msg("Signed out. Your list is still saved on this device, and your backup stays in Google Drive.", "ok");
}
async function signOutAndClear() {
  const btn = $("soClear"); btn.disabled = true;
  try {
    if (unsavedChanges()) await runBackup(false);
    if (pending) return $("signOutDlg").close();            // a backup conflict needs an answer first
    if (unsavedChanges() && !confirm("Your latest changes could not be backed up to Google Drive, so removing the list from this device would lose them. Remove it anyway?")) return;
    $("signOutDlg").close(); endSession(); wipeLocalList(); showLogin();
    msg("Signed out. The list was removed from this device, and your backup stays in Google Drive.", "ok");
  } finally { btn.disabled = false; }
}

/* login page */
const GUEST_KEY = "seriesTracker.guest";
const appRoot = document.querySelector(".wrap");
function showLogin() {
  if ($("syncDlg").open) $("syncDlg").close();
  $("loginSetupHost").appendChild($("setup"));
  $("login").hidden = false; document.body.classList.add("locked"); appRoot.inert = true;
}
function enterApp() {
  $("login").hidden = true; document.body.classList.remove("locked"); appRoot.inert = false;
  $("syncOut").appendChild($("setup"));
  startAuto();
}
// Quiet background lookup is rate-limited across app launches, not just within one visit.
// The existing “Refresh missing details” button remains available for an immediate manual check.
let autoRan = false;
function startAuto() {
  setTimeout(() => {
    if (autoRan || !$("login").hidden || enriching || navigator.onLine === false) return;
    const last = Number(localStorage.getItem(AUTO_LOOKUP_KEY)) || 0;
    if (last && Date.now() - last < AUTO_LOOKUP_INTERVAL) return;
    const todo = data.filter(x => needsDetails(x) && !recentMiss(x));
    if (!todo.length) return;
    autoRan = true;
    // Persist before starting so repeated launches/re-entry cannot queue duplicate background checks.
    store(AUTO_LOOKUP_KEY, String(Date.now()));
    enrichMissing(todo, {silent: true, skipMisses: true});
  }, 1500);
}
async function restoreNow() {
  msg("");
  try {
    await ensureToken(true);
    const f = await findBackup();
    if (!f) return msg("No backup in Google Drive yet. Use Back up now first.", "error");
    const list = await downloadBackup(f.id), prev = JSON.stringify(data);
    g.fileId = f.id; g.remoteMod = f.modifiedTime;
    $("syncDlg").close(); replaceData(list, {silent: true}); markSynced();
    toast(`Restored ${list.length} ${list.length === 1 ? "show" : "shows"} from Google Drive`, {undo: () => restore(prev, {silent: true})});
  } catch (e) { reportSyncError(e); }
}
function openSync() {
  $("clientIdInput").value = clientId; $("setup").open = !clientId && !g.user;
  $("fileWarn").hidden = location.protocol !== "file:";
  $("origin").textContent = location.protocol === "file:" ? "(serve this page over http first)" : location.origin;
  msg(""); refreshSyncUI(); $("syncDlg").showModal();
}

