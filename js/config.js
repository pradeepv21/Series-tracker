"use strict";

/* ---------- config ---------- */
// Paste your Google OAuth client ID here for a published app. When set, the "Google project settings" panel is hidden from users.
// (A client ID is public by design. It is not a secret.) Leave empty while testing to enter it inside the app instead.
const GOOGLE_CLIENT_ID = "444123098530-7e8qu4po0ui0jiq5m5219g7es9ac2lsu.apps.googleusercontent.com";

// true = the app only opens once installed (home screen / desktop app). In a normal browser tab it shows an install page instead.
// It still opens in a tab on localhost so you can test. This is a front-end gate, not a security lock.
const INSTALLED_ONLY = true;

const KEY = "seriesTracker";
const AUTO_LOOKUP_KEY = "seriesTracker.lastAutoLookup";
const AUTO_LOOKUP_INTERVAL = 7 * 24 * 60 * 60 * 1000;
const USER_KEY = "seriesTracker.user", CLIENT_KEY = "seriesTracker.clientId", AUTO_KEY = "seriesTracker.auto";
const SYNCED_KEY = "seriesTracker.synced", LAST_KEY = "seriesTracker.lastSync";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SCOPES = "openid email profile " + DRIVE_SCOPE;
const BACKUP_NAME = "series-tracker-backup.json";
const API = "https://www.googleapis.com/drive/v3", UPLOAD = "https://www.googleapis.com/upload/drive/v3";

const PLAN = "Plan to Watch";
const MY = ["Watching", "Completed", "On Hold", "Dropped", PLAN];
const LIB = MY.filter(k => k !== PLAN);
const isPlan = s => s.myStatus === PLAN;
let tab = "library";
const SHOW = ["Ongoing", "Ended", "Cancelled", "Unknown"];
const DEFAULT_LANGS = ["Chinese", "Korean", "Turkish", "Japanese", "Thai", "Hindi", "English"];

const DEMO = [
  {name: "Love for You", language: "Chinese", showStatus: "Ended", seasons: 1, episodes: 36},
  {name: "My Demon", language: "Korean", showStatus: "Ended", seasons: 1, episodes: 16},
  {name: "The Heirs", language: "Korean", showStatus: "Ended", seasons: 1, episodes: 20},
  {name: "Destined with You", language: "Korean", showStatus: "Ended", seasons: 1, episodes: 16},
  {name: "Aşk Laftan Anlamaz", language: "Turkish", showStatus: "Ended", seasons: 1, episodes: 31},
  {name: "Kiralık Aşk", language: "Turkish", showStatus: "Ended", seasons: 2, episodes: 69},
  {name: "Shine on Me", language: "Chinese", showStatus: "Ended", seasons: 1, episodes: 36}
];

