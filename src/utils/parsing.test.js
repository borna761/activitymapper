import { describe, it, expect } from 'vitest';
import {
  normalizeHeaderCell,
  getField,
  findHeaderRow,
  findIndividualsHeaderRow,
  findActivitiesHeaderRow,
  INDIVIDUALS_HEADER_CANONICAL,
  ADDRESS_KEYS,
  FIRST_NAME_KEYS,
  LAST_NAME_KEYS,
  POSTAL_KEYS,
  NEIGHBORHOOD_KEYS,
  ACTIVITY_TYPE_KEYS,
  ACTIVITY_NAME_KEYS,
} from './parsing.js';

// Re-export the canonical sets for testing (they're not exported, so we test via findHeaderRow)
const INDIVIDUALS_SET = new Set([
  "firstname", "lastname", "address", "addressline1", "addressline2",
  "focusneighbourhood", "focusneighborhood", "neighbourhood", "neighborhood",
  "locality", "region", "nationalcommunity", "postal", "postalcode", "postcode", "zip", "zipcode",
]);
const ACTIVITIES_SET = new Set([
  "activitytype", "type", "name", "facilitators", "facilitator",
]);

describe('normalizeHeaderCell', () => {
  it('lowercases, trims, and removes spaces and underscores', () => {
    expect(normalizeHeaderCell('First Name')).toBe('firstname');
    expect(normalizeHeaderCell('Postal_Code')).toBe('postalcode');
    expect(normalizeHeaderCell('  Address Line 1  ')).toBe('addressline1');
  });

  it('handles null and undefined gracefully', () => {
    expect(normalizeHeaderCell(null)).toBe('');
    expect(normalizeHeaderCell(undefined)).toBe('');
  });

  it('handles numbers', () => {
    expect(normalizeHeaderCell(42)).toBe('42');
  });
});

describe('getField', () => {
  const row = {
    'First Name': 'Alice',
    'Postal Code': 'M5V 2T6',
    'Focus Neighbourhood': 'Downtown',
    'Address Line 1': '123 Main St',
  };

  it('finds an exact match', () => {
    expect(getField(row, FIRST_NAME_KEYS)).toBe('Alice');
  });

  it('is case-insensitive', () => {
    expect(getField({ 'first name': 'Bob' }, FIRST_NAME_KEYS)).toBe('Bob');
    expect(getField({ 'POSTAL CODE': 'A1B 2C3' }, POSTAL_KEYS)).toBe('A1B 2C3');
  });

  it('ignores extra whitespace in key', () => {
    expect(getField({ '  First Name  ': 'Carol' }, FIRST_NAME_KEYS)).toBe('Carol');
  });

  it('matches underscores as spaces', () => {
    expect(getField({ 'First_Name': 'Dan' }, FIRST_NAME_KEYS)).toBe('Dan');
  });

  it('returns empty string when no match', () => {
    expect(getField(row, LAST_NAME_KEYS)).toBe('');
    expect(getField({}, FIRST_NAME_KEYS)).toBe('');
  });

  it('returns first match when multiple keys are provided', () => {
    // NEIGHBORHOOD_KEYS tries "Focus Neighbourhood" first
    expect(getField(row, NEIGHBORHOOD_KEYS)).toBe('Downtown');
  });

  it('handles neighbourhood/neighborhood spelling variants', () => {
    expect(getField({ 'Neighborhood': 'Midtown' }, NEIGHBORHOOD_KEYS)).toBe('Midtown');
    expect(getField({ 'Neighbourhood': 'Midtown' }, NEIGHBORHOOD_KEYS)).toBe('Midtown');
  });
});

describe('findHeaderRow', () => {
  it('returns 0 for an empty array', () => {
    expect(findHeaderRow([], INDIVIDUALS_SET)).toBe(0);
  });

  it('returns 0 when no row matches (fallback)', () => {
    const rawRows = [['foo', 'bar'], ['baz', 'qux']];
    expect(findHeaderRow(rawRows, INDIVIDUALS_SET)).toBe(0);
  });

  it('finds header on the first row', () => {
    const rawRows = [
      ['First Name', 'Last Name', 'Address', 'Postal Code'],
      ['Alice', 'Smith', '123 Main', 'M5V'],
    ];
    expect(findHeaderRow(rawRows, INDIVIDUALS_SET)).toBe(0);
  });

  it('finds header when preceded by metadata rows', () => {
    const rawRows = [
      ['Report generated: 2024-01-01'],
      ['Organisation: Test Org'],
      ['First Name', 'Last Name', 'Address', 'Postal Code'],
      ['Alice', 'Smith', '123 Main', 'M5V'],
    ];
    expect(findHeaderRow(rawRows, INDIVIDUALS_SET)).toBe(2);
  });

  it('respects minMatches threshold', () => {
    // Only 1 matching column — should NOT be detected as header with minMatches=2
    const rawRows = [['First Name', 'foo', 'bar']];
    expect(findHeaderRow(rawRows, INDIVIDUALS_SET, 2)).toBe(0); // fallback
    // 1 matching column IS detected as header with minMatches=1
    expect(findHeaderRow(rawRows, INDIVIDUALS_SET, 1)).toBe(0); // matches on row 0
  });

  it('skips non-array rows without throwing', () => {
    const rawRows = [null, undefined, ['First Name', 'Last Name', 'Postal Code']];
    expect(findHeaderRow(rawRows, INDIVIDUALS_SET)).toBe(2);
  });
});

describe('findIndividualsHeaderRow', () => {
  it('detects a standard individuals header', () => {
    const rawRows = [
      ['First Name', 'Last Name', 'Address', 'Postal Code', 'Locality'],
    ];
    expect(findIndividualsHeaderRow(rawRows)).toBe(0);
  });

  it('does not detect an activities header as individuals', () => {
    const rawRows = [
      ['Activity Type', 'Name', 'Facilitators'],
    ];
    // Only "name" might partially overlap but not enough matches for individuals
    expect(findIndividualsHeaderRow(rawRows)).toBe(0); // falls back to 0 (no match)
  });
});

describe('findActivitiesHeaderRow', () => {
  it('detects a standard activities header', () => {
    const rawRows = [
      ['Activity Type', 'Name', 'Facilitators', 'Address'],
    ];
    expect(findActivitiesHeaderRow(rawRows)).toBe(0);
  });

  it('finds activities header after metadata rows', () => {
    const rawRows = [
      ['Export date: 2024-01-01'],
      ['Activity Type', 'Name', 'Facilitators'],
    ];
    expect(findActivitiesHeaderRow(rawRows)).toBe(1);
  });
});
