import { HEADER_MIN_MATCHES } from "../constants";

/**
 * Get row value by trying multiple key names (case/spacing insensitive).
 */
export function getField(row, keys) {
  for (const key of keys) {
    for (const k in row) {
      if (String(k).trim().replace(/\s|_/g, "").toLowerCase() === String(key).trim().replace(/\s|_/g, "").toLowerCase()) {
        return row[k];
      }
    }
  }
  return "";
}

export const NEIGHBORHOOD_KEYS = ["Focus Neighbourhood", "Focus Neighborhood", "Neighbourhood", "Neighborhood"];
export const POSTAL_KEYS = ["Postal Code", "Postal", "Postcode", "Zip", "ZIP Code", "Zip Code"];
export const LOCALITY_KEYS = ["Locality", "City", "locality", "city"];
export const REGION_KEYS = ["Region", "State", "Province", "region", "state"];
export const NATIONAL_COMMUNITY_KEYS = ["National Community", "Country", "national community", "country"];
export const FIRST_NAME_KEYS = ["First Name", "FirstName", "Firstname", "first_name", "firstname", "First Name(s)"];
export const LAST_NAME_KEYS = ["Last Name", "LastName", "Lastname", "last_name", "lastname", "Family Name"];
export const ACTIVITY_TYPE_KEYS = ["Activity Type", "activity type", "Type", "type"];
export const ACTIVITY_NAME_KEYS = ["Name", "name"];
export const FACILITATORS_KEYS = ["Facilitators", "facilitators"];

const INDIVIDUALS_HEADER_CANONICAL = new Set([
  "firstname", "lastname", "address", "addressline1", "addressline2",
  "focusneighbourhood", "focusneighborhood", "neighbourhood", "neighborhood",
  "locality", "region", "nationalcommunity", "postal", "postalcode", "postcode", "zip", "zipcode",
]);

const ACTIVITIES_HEADER_CANONICAL = new Set([
  "activitytype", "type", "name", "facilitators", "facilitator",
]);

export function normalizeHeaderCell(cell) {
  return String(cell ?? "").trim().replace(/\s|_/g, "").toLowerCase();
}

/**
 * Find the first row that looks like a header (contains at least minMatches expected column names).
 */
export function findHeaderRow(rawRows, canonicalSet, minMatches = HEADER_MIN_MATCHES) {
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row)) continue;
    let matches = 0;
    for (const cell of row) {
      const norm = normalizeHeaderCell(cell);
      if (norm && canonicalSet.has(norm)) matches++;
    }
    if (matches >= minMatches) return i;
  }
  return 0;
}

export function findIndividualsHeaderRow(rawRows) {
  return findHeaderRow(rawRows, INDIVIDUALS_HEADER_CANONICAL);
}

export function findActivitiesHeaderRow(rawRows) {
  return findHeaderRow(rawRows, ACTIVITIES_HEADER_CANONICAL);
}
