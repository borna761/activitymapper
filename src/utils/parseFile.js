import Papa from "papaparse";
import * as XLSX from "xlsx";

function buildRowsFromRaw(rawRows, findHeaderRow) {
  const headerRowIndex = findHeaderRow(rawRows);
  const headers = rawRows[headerRowIndex] || [];
  return rawRows
    .slice(headerRowIndex + 1)
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[String(h ?? '').trim() || `Column${i}`] = row[i] ?? '';
      });
      return obj;
    })
    .filter((obj) => Object.keys(obj).some((k) => obj[k] !== '' && obj[k] != null));
}

/**
 * Parse a CSV or XLSX file into an array of row objects.
 * Returns a Promise that resolves with the rows or rejects with a user-facing error.
 */
export function parseFile(file, findHeaderRow) {
  return new Promise((resolve, reject) => {
    if (file.name.endsWith('.xlsx')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          const headerRowIndex = findHeaderRow(rawRows);
          resolve(XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex }));
        } catch {
          reject(new Error('Could not read the XLSX file. Make sure it is a valid Excel file.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        Papa.parse(ev.target.result || '', {
          header: false,
          skipEmptyLines: true,
          complete: ({ data: rawRows }) => resolve(buildRowsFromRaw(rawRows, findHeaderRow)),
          error: (err) => reject(new Error(`Could not parse CSV: ${err.message}`)),
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsText(file);
    }
  });
}
