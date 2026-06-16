import { readFileSync, writeFileSync } from 'node:fs';

export function parseCsvRecords(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length || record.length) {
    record.push(field);
    records.push(record);
  }

  return records;
}

export function readCsv(path) {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const records = parseCsvRecords(text);
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0];
  const rows = records.slice(1)
    .filter((record) => record.some((value) => String(value || '').trim() !== ''))
    .map((record) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = record[index] ?? '';
      });
      return row;
    });
  return { headers, rows };
}

export function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function writeCsv(path, columns, rows) {
  const out = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column] ?? '')).join(',')),
  ].join('\r\n') + '\r\n';
  writeFileSync(path, out, 'utf8');
}
