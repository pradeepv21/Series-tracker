"use strict";

/* ---------- library state ---------- */
let pristine = false;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) { const p = JSON.parse(raw); return sanitizeList(Array.isArray(p) ? p : p.shows); }
  } catch (e) {}
  pristine = true;
  return [];
}
let data = load();
if (!pristine && (localStorage.getItem(KEY) || "").includes('"rating"')) store(KEY, JSON.stringify(data));

function save(opts = {}) {
  if (!store(KEY, JSON.stringify(data))) $("storageWarn").hidden = false;
  pristine = false;
  if (!opts.silent) scheduleBackup();
}
function replaceData(list, opts) { data = list; save(opts); render(); }
function restore(prev, opts) { replaceData(sanitizeList(JSON.parse(prev)), opts); }

/* ---------- toast ---------- */
let toastTimer;
function toast(text, opts = {}) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(text)}</span>` + (opts.undo ? `<button type="button" id="toastUndo">Undo</button>` : "");
  t.classList.add("show");
  if (opts.undo) $("toastUndo").onclick = () => { t.classList.remove("show"); opts.undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), opts.undo ? 7000 : 3500);
}
function notify(text, opts = {}) {
  if ($("syncDlg").open && !opts.undo) return msg(text, "ok");
  if ($("syncDlg").open) $("syncDlg").close();
  toast(text, opts);
}

/* ---------- rendering ---------- */
const SORTS = {
  new: (a, b) => b.id - a.id,
  title: (a, b) => a.name.localeCompare(b.name),
  status: (a, b) => MY.indexOf(a.myStatus) - MY.indexOf(b.myStatus) || a.name.localeCompare(b.name)
};
const isFiltered = () => !!($("search").value.trim() || $("statusFilter").value || $("showFilter").value || $("langFilter").value);

function visible() {
  const q = norm($("search").value), my = $("statusFilter").value, sh = $("showFilter").value, lg = $("langFilter").value;
  return data.filter(s => (tab === "plan") === isPlan(s) && (!q || norm(s.name).includes(q)) && (!my || s.myStatus === my) &&
    (!sh || s.showStatus === sh) && (!lg || s.language === lg)).sort(SORTS[$("sortBy").value]);
}
const hue = name => { let h = 0; for (const ch of norm(name)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
const initials = name => {
  const w = String(name).trim().split(/\s+/).filter(Boolean);
  return ((w[0] ? Array.from(w[0])[0] : "?") + (w[1] ? Array.from(w[1])[0] : "")).toUpperCase();
};
const posterUrl = s => /^https:\/\//.test((s && s.poster) || "") ? s.poster : "";
function posterHtml(s) {
  const url = posterUrl(s);
  return url ? `<img class="poster" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="poster mono" style="--h:${hue(s.name)}" aria-hidden="true">${esc(initials(s.name))}</span>`;
}
const dropTag = s => s.myStatus === "Dropped" && s.droppedAt
  ? `<span class="drop-tag">Dropped at episode ${s.droppedAt}${s.episodes ? " of " + s.episodes : ""}</span>` : "";
function rowHtml(s) {
  return `<tr data-id="${s.id}">
    <td class="c-name"><div class="nm-wrap">${posterHtml(s)}<div class="nm"><span class="title">${esc(s.name)}</span>${dropTag(s)}${s.notes ? `<span class="note-line" title="${esc(s.notes)}">${esc(s.notes)}</span>` : ""}</div></div></td>
    <td class="c-lang">${esc(s.language)}</td>
    <td class="c-show st-${slug(s.showStatus)}"><span class="dot">${esc(s.showStatus)}</span></td>
    <td class="c-my st-${slug(s.myStatus)}"><span class="status-wrap"><select class="status-select" data-act="status" aria-label="My status for ${esc(s.name)}">${MY.map(k => `<option${k === s.myStatus ? " selected" : ""}>${k}</option>`).join("")}</select></span></td>
    <td class="c-num" data-unit="${unit(s.seasons, "season")}">${s.seasons ?? "—"}</td>
    <td class="c-num" data-unit="${unit(s.episodes, "episode")}">${s.episodes ?? "—"}</td>
    <td class="c-act"><button type="button" data-act="edit" aria-label="Edit ${esc(s.name)}">Edit</button><button type="button" class="danger" data-act="delete" aria-label="Delete ${esc(s.name)}">Delete</button></td>
  </tr>`;
}
function emptyRow() {
  const inTab = data.filter(x => (tab === "plan") === isPlan(x)).length;
  const box = (t, msg, btn) => `<tr class="empty-row"><td class="empty" colspan="7"><div class="empty-inner"><strong>${t}</strong><span>${msg}</span>${btn}</div></td></tr>`;
  if (inTab) return box("No shows match", "Try a different search, or clear the filters.", `<button type="button" data-act="clear">Clear filters</button>`);
  return tab === "plan"
    ? box("Nothing planned yet", "Add shows you want to watch later and they will wait for you here.", `<button type="button" class="primary" data-act="add">Add to plan to watch</button>`)
    : box("Your library is empty", "Add the first show you're watching or have finished.", `<button type="button" class="primary" data-act="add">Add a show</button>`);
}
function renderSummary() {
  const lib = data.filter(x => !isPlan(x));
  const counts = Object.fromEntries(LIB.map(k => [k, 0]));
  lib.forEach(x => counts[x.myStatus]++);
  $("total").textContent = lib.length;
  $("totalLabel").textContent = lib.length === 1 ? "show" : "shows";
  $("bar").innerHTML = lib.length
    ? LIB.filter(k => counts[k]).map(k => `<span class="seg st-${slug(k)}" style="flex-grow:${counts[k]}"></span>`).join("")
    : `<span class="bar-empty"></span>`;
  $("bar").setAttribute("aria-label", lib.length ? LIB.map(k => `${k} ${counts[k]}`).join(", ") : "No shows yet");
  const active = $("statusFilter").value;
  $("legend").innerHTML = LIB.map(k =>
    `<button type="button" class="chip st-${slug(k)}" data-status="${k}" aria-pressed="${active === k}"><i></i>${k} <b>${counts[k]}</b></button>`).join("");
  const airing = lib.filter(x => x.showStatus === "Ongoing").length;
  $("airing").textContent = airing ? `${airing} still airing` : "";
}
function renderTabs() {
  const plan = data.filter(isPlan).length;
  $("cntLib").textContent = data.length - plan; $("cntPlan").textContent = plan;
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  $("ctlStatus").hidden = tab === "plan";
}
function setTab(t) {
  tab = t; if (t === "plan") $("statusFilter").value = "";
  render();
}
const defaultMyStatus = () => tab === "plan" ? PLAN : "Watching";
function renderLangs() {
  const langs = [...new Set(data.map(s => s.language).filter(l => l && l !== "Unknown"))].sort();
  const lf = $("langFilter"), old = lf.value;
  lf.innerHTML = '<option value="">All</option>' + langs.map(l => `<option>${esc(l)}</option>`).join("");
  lf.value = langs.includes(old) ? old : "";
  $("langList").innerHTML = [...new Set([...DEFAULT_LANGS, ...langs])].map(l => `<option value="${esc(l)}">`).join("");
}
function render() {
  renderLangs(); renderSummary(); renderTabs();
  const rows = visible();
  $("tbody").innerHTML = rows.length ? rows.map(rowHtml).join("") : emptyRow();
  const f = isFiltered();
  const inTab = data.filter(x => (tab === "plan") === isPlan(x)).length;
  $("count").textContent = f && inTab ? `Showing ${rows.length} of ${inTab}` : "";
  $("clearFilters").hidden = !f;
}
function clearFilters() {
  $("search").value = ""; $("statusFilter").value = ""; $("showFilter").value = ""; $("langFilter").value = "";
  render();
}

