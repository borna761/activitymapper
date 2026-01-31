# Code Review: Activity Mapper (post-fixes)

**Scope:** `src/App.jsx`, `src/constants.js`, `src/utils/parsing.js`, `src/utils/mapUtils.js`  
**Date:** 2025-01-31 (second pass)

---

## Summary

The earlier review items have been addressed: dead code removed, `geocodeRows` scoped inside the component with explicit dependencies, stable marker keys, geocode error handling and rate limiter, `homeMarkersRef` for stale closure, activities header detection, flexible Locality/Region/National Community, and constants/utils extracted into separate modules. The codebase is in good shape. Below are remaining minor items and optional improvements.

---

## Addressed (from first review)

| Item | Status |
|------|--------|
| Dead `process` in handleAddressUpload | Removed |
| geocodeRows / processResults scope | geocodeRows in component with useCallback; processResults useCallback |
| Unstable marker keys | Stable `m.id` / `p.id` with fallback for legacy home markers |
| Geocoding error handling | res.ok check; setGeocodeError; banner + aria-live |
| Rate limiter | try/catch + single retry after 1s |
| Stale closure (homeMarkers in activities) | homeMarkersRef synced via useEffect; processActivities uses ref |
| Activities file header | findActivitiesHeaderRow; CSV/XLSX both support skip-rows |
| Locality / Region / National Community | LOCALITY_KEYS, REGION_KEYS, NATIONAL_COMMUNITY_KEYS in parsing; used in geocodeRows |
| Magic numbers | constants.js (ACTIVITY_MARKER_RADIUS_DEG, MARKER_BATCH_SIZE, DEBOUNCE_MS) |
| Accessibility | aria-live region (sr-only); geocode error with role="alert" |
| Module split | constants.js, utils/parsing.js, utils/mapUtils.js |

---

## Remaining / optional

### 1. Duplicate key lookup: `getNameField` vs `getField`

**Location:** App.jsx lines 291–300 (`getNameField`) and usage in `geocodeRows` (first/last name).

`getNameField` does the same key-normalization as `getField` in `utils/parsing.js`. Only first/last name still use `getNameField`; everything else uses `getField`.

**Suggestion:** Export `FIRST_NAME_KEYS` and `LAST_NAME_KEYS` from parsing.js, use `getField(r, FIRST_NAME_KEYS)` / `getField(r, LAST_NAME_KEYS)` in `geocodeRows`, and remove `getNameField` to avoid duplication and keep a single place for key logic.

---

### 2. `sortActivities` and list rows still use hardcoded column names

**Location:** App.jsx ~41–54 (`sortActivities`), ~706–711 and ~717–722 (activities no facilitators / facilitator not found lists).

They use `row['Activity Type']`, `row['Name']`, `row['Facilitators']`. After activities header detection, the file can use different column names (e.g. "Activity Type", "type").

**Suggestion:** Use the same key arrays as in `processActivities` (e.g. `getField(row, activityTypeKeys)`, `getField(row, nameKeys)`, `getField(row, facilitatorsKeys)`). You can define `ACTIVITY_TYPE_KEYS`, `ACTIVITY_NAME_KEYS`, `FACILITATORS_KEYS` in parsing.js and reuse them in `sortActivities` and in the two list renderers so display and sort stay consistent with parsing.

---

### 3. Rate limiter retry can loop

**Location:** App.jsx ~266–271.

On `limiter.removeTokens(1)` throw we wait 1s and call `geocodeAddress(addr)` again. If the limiter (or network) keeps failing, this can retry indefinitely.

**Suggestion:** Cap retries (e.g. max 2–3) and then return `null` (or set a user-visible error) so one bad address doesn’t block the rest.

---

### 4. File input not reset after upload

**Location:** File inputs in App.jsx.

After a successful upload, choosing the same file again doesn’t trigger `onChange`, so the user can’t “re-run” the same file without picking another first.

**Suggestion:** In the upload handlers, after you’re done processing (e.g. after `geocodeRows(rows)` or `processActivities(rows)`), set `e.target.value = ''` so the same file can be selected again. Optional, UX-only.

---

### 5. Remove home marker by reference

**Location:** App.jsx ~619.

`setHomeMarkers(prev => prev.filter(h => h !== selectedHome))` uses reference equality. With stable `id` on home markers, `h.id !== selectedHome.id` would be more robust if the same individual ever appeared twice (e.g. duplicate rows).

**Suggestion:** Prefer `filter(h => h.id !== selectedHome.id)` when `id` is present, with a fallback for legacy markers without `id` (e.g. `h !== selectedHome`).

---

### 6. `HEADER_MIN_MATCHES` in constants unused in parsing

**Location:** constants.js exports `HEADER_MIN_MATCHES`; parsing.js `findHeaderRow` uses default `minMatches = 2`.

**Suggestion:** Either import `HEADER_MIN_MATCHES` in parsing.js and pass it into `findHeaderRow` for individuals/activities, or stop exporting it from constants if you’re happy with the literal `2`. Keeps tuning in one place if you use the constant.

---

## What’s working well

- **Structure:** Clear split between constants, parsing, map utils, and the main component; responsibilities are easy to follow.
- **Individuals/Activities parsing:** Header detection and flexible column keys (including address lines, neighborhood, postal, locality, region, national community, activity type, name, facilitators) make the app robust to different spreadsheets and minor naming differences.
- **Geocoding:** Address key deduplication, error counting, and user-facing message; rate limiter with simple retry; `geocodeRows` and `processResults` correctly scoped and memoized.
- **Performance:** Marker batching, memoized filtered lists, debounced neighborhood selection, stable React keys for markers.
- **UX:** Loading states, geocode error banner, aria-live for loading/errors, disabled Activities until Individuals are loaded, and “no facilitators” / “facilitator not found” sections.
- **Accessibility:** sr-only live region, alert role on geocode error, and loading indicators with role="status".

---

## Suggested order of follow-ups

1. (Optional) Use `getField` for first/last name and remove `getNameField`.
2. (Optional) Use shared activity column key arrays in `sortActivities` and in the two activity list sections.
3. (Optional) Add a max-retry limit for `geocodeAddress` rate limiter.
4. (Optional) Reset file input after successful upload; filter by `id` when removing a home marker.

No blocking issues; the app is in good shape for production use.
