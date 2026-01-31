# Code Review: Activity Mapper

**Scope:** `src/App.jsx` and related structure  
**Date:** 2025-01-31

---

## Summary

The app is a single-page React map that loads individuals (CSV/XLSX), geocodes them, then loads activities and maps them by facilitator. Logic is clear and the recent Individuals parsing (auto header, flexible columns) is well thought out. The main issues are: dead code, duplication, a very large single component, and a few correctness/UX gaps.

---

## Critical / High

### 1. Dead code: `process` in `handleAddressUpload`

**Location:** Lines 317–338

A local `process(results)` is defined inside `handleAddressUpload` but **never called**. The flow is: parse file → `geocodeRows(rows)` → `processResults(allIndividuals)`. The local `process` also uses hardcoded `r['Focus Neighbourhood']` instead of the shared neighborhood lookup.

**Recommendation:** Remove the unused `process` function.

---

### 2. `geocodeRows` and `processResults` scope

**Location:** Lines 392–451

`geocodeRows` is defined at **module level** (no leading indent) but calls `getNameField`, `processResults`, `normalizeName`, and setters — all defined inside the component. In a normal module layout this would cause `ReferenceError` when geocoding runs. If the app works in practice, either:

- `geocodeRows` is actually defined inside the component (e.g. indented and the review view is misleading), or  
- There is a closure/binding that’s not obvious.

**Recommendation:** Move `geocodeRows` (and `processResults` if needed) **inside** the component so the data flow and dependencies are explicit, or pass `processResults` and field helpers as arguments to `geocodeRows(rows, { processResults, getNameField, ... })` so it doesn’t rely on outer scope.

---

### 3. Marker keys: array index as `key`

**Location:** Lines 581, 596

```jsx
{batchedActivityMarkers.map((m, i) => (
  <Marker key={i} ... />
))}
{batchedHomeMarkers.map((p, i) => (
  <Marker key={i} ... />
))}
```

Using `key={i}` is fragile when the list is reordered or filtered and can cause unnecessary re-renders or wrong mapping.

**Recommendation:** Use a stable key, e.g. `key={\`activity-${m.lat}-${m.lng}-${m.facilitator}-${m.activityName}\`}` and `key={\`home-${p.lat}-${p.lng}-${p.firstName}-${p.lastName}\`}` (or a hash), or add a unique `id` when building markers.

---

## Medium

### 4. Duplicate neighborhood logic

Neighborhood normalization (“use value or ‘Other’”) and unique-neighborhoods derivation are implemented in:

- The **dead** `process` (hardcoded `Focus Neighbourhood`)
- **`processResults`** (uses `getField(r, NEIGHBORHOOD_KEYS)`)

So there’s duplication and one place is outdated.

**Recommendation:** Remove dead `process`. If any other code path ever needs “neighborhood or Other” and “unique neighborhoods,” extract a small helper (e.g. `getNeighborhoodForRow(r)`, `deriveUniqueNeighborhoods(results)`) and reuse it.

---

### 5. Activities file: no header detection / skip rows

Individuals support auto header detection and flexible columns; the **Activities** upload still assumes the first row is the header (and uses `sheet_to_json` / Papa with `header: true` with no skip).

**Recommendation:** If activities files can have leading rows or different column names, add the same pattern as Individuals: raw parse → detect header row → parse with that row as header, and optionally support flexible column names for Activity Type, Name, Facilitators.

---

### 6. No geocoding error handling

**Location:** `geocodeRows` (e.g. around 421–424)

If Mapbox returns an error (4xx/5xx) or malformed JSON, `res.json()` or `data.features` can throw or be undefined. Failed geocodes currently result in the row being dropped (no lat/lng) with no user feedback.

**Recommendation:** Check `res.ok` and handle non-OK responses; catch and log or surface a message (e.g. “Some addresses could not be geocoded” and optionally how many). Optionally retry with backoff for 429.

---

### 7. Stale closure in `handleLatLonUpload`

**Location:** Lines 155–161

`processActivities` uses `homeMarkers` from the closure. If the user uploads Individuals, then immediately uploads Activities before state has updated, `homeMarkers` can still be the previous value (or empty).

**Recommendation:** Either document that “Individuals must be loaded and visible before loading Activities,” or pass the current individuals/home list into the upload handler (e.g. from a ref that’s updated when individuals load) so Activities always use the latest data.

---

## Low / Nice-to-have

### 8. File size and structure

`App.jsx` is ~746 lines and handles: config, helpers, map math, file parsing (Individuals + Activities), geocoding, batching, filtering, and all UI. This makes reuse and testing harder.

**Recommendation:** Split into modules, e.g.:

- `constants.js` (icons, labels, config)
- `mapUtils.js` (e.g. `getPixelPosition`)
- `individualsParser.js` (header detection, `getField`, `NEIGHBORHOOD_KEYS`, `POSTAL_KEYS`, building rows from CSV/XLSX)
- `geocoding.js` (e.g. `geocodeAddress`, `geocodeRows` taking explicit callbacks)
- `ActivityMapper.jsx` (state, effects, handlers, map + sidebar UI)

---

### 9. Magic numbers

Examples: `radius = 0.0005` (degrees), `batchSize = 200`, debounce `200` ms, `matches >= 2` for header detection.

**Recommendation:** Name them (e.g. `ACTIVITY_MARKER_OFFSET_RADIUS_DEG`, `MARKER_BATCH_SIZE`, `HEADER_MIN_MATCHING_COLUMNS`) at the top of the file or in a small config so intent is clear and tuning is in one place.

---

### 10. Accessibility

- File inputs don’t have visible labels in some layouts (label is present but styling may hide it on small screens).
- “Loading” is only a spinner; screen readers might benefit from `aria-live` and a short message (“Loading individuals…” / “Geocoding…”).
- Neighborhood checkboxes and buttons are focusable; ensure focus order and visible focus ring for keyboard users.

---

### 11. Rate limiter usage

**Location:** Line 263

`await limiter.removeTokens(1)` is used but the return value isn’t checked. If the limiter rejects (e.g. too many requests), the code still proceeds to `fetch`.

**Recommendation:** If the limiter can throw or return a “denied” state, handle it (e.g. wait and retry, or show “Too many requests, please wait”).

---

### 12. Locality / Region / National Community

**Location:** `geocodeRows` (e.g. 410–412, 422–424)

These are read with a single key: `r['Locality']`, `r['Region']`, `r['National Community']`. If the file uses different headers (e.g. “City,” “State,” “Country”), they won’t be used.

**Recommendation:** Optionally add flexible keys (like `NEIGHBORHOOD_KEYS` / `POSTAL_KEYS`) for Locality, Region, National Community and use `getField` so minor naming differences are supported.

---

## What’s working well

- **Individuals parsing:** Auto header detection and flexible column names (address lines, neighborhood, postal) are implemented consistently and make the app robust to different spreadsheets.
- **Deduplication:** Geocoding by address key avoids duplicate API calls for the same address.
- **Batching:** Marker batching (e.g. 200 at a time) keeps the map responsive with large datasets.
- **Filtering:** Neighborhood filter with Select All / None and memoized filtered lists is clear and efficient.
- **UX:** Loading spinners, disabled state for Activities until Individuals are loaded, and “Activities with no facilitators” / “Facilitator not found” sections give useful feedback.

---

## Suggested order of changes

1. Remove dead `process` in `handleAddressUpload`.
2. Fix or clarify `geocodeRows` / `processResults` scope (move inside component or pass deps explicitly).
3. Replace array index with stable keys for map markers.
4. Add basic geocoding error handling and user feedback.
5. Optionally: add header detection / skip rows for Activities; extract shared helpers and constants; improve a11y and rate limiter handling.
