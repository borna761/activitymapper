import { describe, it, expect, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { parseFile } from './parseFile.js';
import { findIndividualsHeaderRow, findActivitiesHeaderRow } from './parsing.js';

// FileReader is a browser API — stub it for the Node test environment.
class MockFileReader {
  readAsText(file) {
    Promise.resolve().then(() => {
      if (file.__readerError) this.onerror?.();
      else this.onload?.({ target: { result: file.__text ?? '' } });
    });
  }
  readAsArrayBuffer(file) {
    Promise.resolve().then(() => {
      if (file.__readerError) this.onerror?.();
      else this.onload?.({ target: { result: file.__buffer } });
    });
  }
}
vi.stubGlobal('FileReader', MockFileReader);

// ── Helpers ────────────────────────────────────────────────────────────────

function csvFile(content, name = 'test.csv') {
  return { name, __text: content };
}

function xlsxFile(rows, name = 'test.xlsx') {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  // @e965/xlsx write returns a plain number[] with type:'array', so wrap it into an ArrayBuffer
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const buffer = new Uint8Array(arr).buffer;
  return { name, __buffer: buffer };
}

function readerErrorFile(name = 'test.csv') {
  return { name, __readerError: true };
}

// findHeaderRow that always treats row 0 as the header
const headerAtRow0 = () => 0;

// ── CSV tests ──────────────────────────────────────────────────────────────

describe('parseFile — CSV', () => {
  it('returns row objects keyed by header names', async () => {
    const file = csvFile('First Name,Last Name,Postal Code\nAlice,Smith,M5V\nBob,Jones,K1A');
    const rows = await parseFile(file, headerAtRow0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ 'First Name': 'Alice', 'Last Name': 'Smith', 'Postal Code': 'M5V' });
    expect(rows[1]).toEqual({ 'First Name': 'Bob', 'Last Name': 'Jones', 'Postal Code': 'K1A' });
  });

  it('skips metadata rows and finds the real header', async () => {
    const content = [
      'Report Date,2024-01-01',
      'Organisation,Test Org',
      'First Name,Last Name,Postal Code',
      'Alice,Smith,M5V',
    ].join('\n');
    const rows = await parseFile(csvFile(content), findIndividualsHeaderRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]['First Name']).toBe('Alice');
    expect(rows[0]['Postal Code']).toBe('M5V');
  });

  it('filters out empty rows', async () => {
    const file = csvFile('First Name,Last Name\nAlice,Smith\n,\nBob,Jones');
    const rows = await parseFile(file, headerAtRow0);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r['First Name'])).toEqual(['Alice', 'Bob']);
  });

  it('uses fallback column names for blank headers', async () => {
    const file = csvFile(',Last Name\nAlice,Smith');
    const rows = await parseFile(file, headerAtRow0);
    expect(rows[0]['Column0']).toBe('Alice');
    expect(rows[0]['Last Name']).toBe('Smith');
  });

  it('handles an activities CSV with the activities header finder', async () => {
    const content = 'Activity Type,Name,Facilitators\nCC,Community Café,Alice Smith';
    const rows = await parseFile(csvFile(content), findActivitiesHeaderRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]['Activity Type']).toBe('CC');
    expect(rows[0]['Facilitators']).toBe('Alice Smith');
  });

  it('rejects with a friendly message when FileReader errors', async () => {
    await expect(parseFile(readerErrorFile('test.csv'), headerAtRow0))
      .rejects.toThrow('Failed to read file.');
  });
});

// ── XLSX tests ─────────────────────────────────────────────────────────────

describe('parseFile — XLSX', () => {
  it('returns row objects keyed by header names', async () => {
    const file = xlsxFile([
      ['First Name', 'Last Name', 'Postal Code'],
      ['Alice', 'Smith', 'M5V'],
      ['Bob', 'Jones', 'K1A'],
    ]);
    const rows = await parseFile(file, headerAtRow0);
    expect(rows).toHaveLength(2);
    expect(rows[0]['First Name']).toBe('Alice');
    expect(rows[1]['Postal Code']).toBe('K1A');
  });

  it('skips metadata rows and finds the real header', async () => {
    const file = xlsxFile([
      ['Report Date', '2024-01-01'],
      ['Organisation', 'Test Org'],
      ['First Name', 'Last Name', 'Postal Code'],
      ['Alice', 'Smith', 'M5V'],
    ]);
    const rows = await parseFile(file, findIndividualsHeaderRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]['First Name']).toBe('Alice');
  });

  it('handles an activities XLSX with the activities header finder', async () => {
    const file = xlsxFile([
      ['Activity Type', 'Name', 'Facilitators'],
      ['CC', 'Community Café', 'Alice Smith'],
    ]);
    const rows = await parseFile(file, findActivitiesHeaderRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]['Activity Type']).toBe('CC');
  });

  it('rejects with a friendly message when FileReader errors', async () => {
    await expect(parseFile(readerErrorFile('test.xlsx'), headerAtRow0))
      .rejects.toThrow('Failed to read file.');
  });
});
