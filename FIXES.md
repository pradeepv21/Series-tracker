# Series Tracker — local fixes

This package contains local source changes only; the GitHub repository was not modified.

## Changes

- **Automatic online enrichment:** missing show details/posters are checked in the background no more than once per 7 days per browser profile. The manual **Refresh missing details** action remains available and resets that cooldown. Existing 30-day not-found suppression remains in place.
- **Library order:** the default sort is now oldest-added first, using each show's stable ID, so changing a show's watching status does not change its position under the default sort. Other sort modes remain available.
- **Drive sync race protection:** overlapping backup requests are coalesced, and overlapping initial Drive comparisons share one in-flight sync operation. This reduces stale parallel comparisons that can surface unnecessary conflict prompts. On a fresh device with no saved sync baseline and an empty local list, an existing Drive backup is restored rather than treated as a conflict. Real divergent local/Drive edits can still require a choice to avoid losing data.
- **Performance:** background enrichment no longer rewrites the full library to local storage for every unchanged lookup; it persists only when a show actually gains details, and the list redraw is batched at the end of the pass.
- **PWA cache:** bumped the service-worker cache version so deployed clients fetch the updated files.

## Validation

JavaScript syntax checks and archive integrity were run locally. Because this project has no automated browser test suite and Google Drive / TVmaze / TMDB require live account/network access, end-to-end behavior should still be verified in the installed app.
