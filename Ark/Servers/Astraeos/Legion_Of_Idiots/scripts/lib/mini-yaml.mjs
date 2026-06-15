// Minimal YAML reader/writer for the mod-reference-site data files.
//
// This is NOT a general YAML implementation. It supports exactly the subset
// used by data/mod-reference.yaml:
//   - nested maps (2-space indentation)
//   - block sequences of scalars ("- value")
//   - block sequences of maps ("- key: value" with aligned following keys)
//   - scalars: plain strings, double/single quoted strings, ints, floats,
//     booleans (true/false) and null (null / ~)
//
// Keeping our authored YAML inside this subset (one value per line, quote any
// string that contains ": ") guarantees a clean round-trip without pulling in
// an external dependency.

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function tokenize(text) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.replace(/^\s*/, '');
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    out.push({ indent: line.length - trimmed.length, content: trimmed });
  }
  return out;
}

// Returns [value, nextIndex]
function parseBlock(lines, start, end, indent) {
  if (start >= end || lines[start].indent < indent) return [null, start];

  if (lines[start].content.startsWith('- ') || lines[start].content === '-') {
    const arr = [];
    let i = start;
    while (i < end && lines[i].indent === indent &&
           (lines[i].content.startsWith('- ') || lines[i].content === '-')) {
      const itemContent = lines[i].content === '-' ? '' : lines[i].content.slice(2);
      if (/^[A-Za-z0-9_]+:(\s|$)/.test(itemContent)) {
        // sequence item that is a map
        const sub = [{ indent: indent + 2, content: itemContent }];
        i++;
        while (i < end && lines[i].indent > indent) { sub.push(lines[i]); i++; }
        arr.push(parseBlock(sub, 0, sub.length, indent + 2)[0]);
      } else if (itemContent === '') {
        // nested block as the item value
        i++;
        if (i < end && lines[i].indent > indent) {
          const childIndent = lines[i].indent;
          const [val, ni] = parseBlock(lines, i, end, childIndent);
          arr.push(val); i = ni;
        } else {
          arr.push(null);
        }
      } else {
        arr.push(parseScalar(itemContent));
        i++;
      }
    }
    return [arr, i];
  }

  // mapping
  const obj = {};
  let i = start;
  while (i < end && lines[i].indent === indent &&
         !(lines[i].content.startsWith('- ') || lines[i].content === '-')) {
    const line = lines[i].content;
    const colon = line.indexOf(':');
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (rest === '') {
      i++;
      if (i < end && lines[i].indent > indent) {
        const childIndent = lines[i].indent;
        const [val, ni] = parseBlock(lines, i, end, childIndent);
        obj[key] = val; i = ni;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }
  return [obj, i];
}

export function parseYaml(text) {
  const lines = tokenize(text);
  if (lines.length === 0) return {};
  return parseBlock(lines, 0, lines.length, lines[0].indent)[0];
}

// ---- serialization ----

function needsQuote(s) {
  if (s === '') return true;
  if (/[:#\[\]{}&*!|>'"%@`]/.test(s)) return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/^[-?]/.test(s)) return true;
  if (/^(true|false|null|~)$/i.test(s)) return true;
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;
  return false;
}

function dumpScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  if (needsQuote(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  }
  return s;
}

function dumpValue(value, indent, out) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) { return; }
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const keys = Object.keys(item);
        keys.forEach((k, idx) => {
          const v = item[k];
          if (idx === 0) {
            if (v !== null && typeof v === 'object') {
              out.push(`${pad}- ${k}:`);
              dumpValue(v, indent + 4, out);
            } else {
              out.push(`${pad}- ${k}: ${dumpScalar(v)}`);
            }
          } else {
            if (v !== null && typeof v === 'object') {
              out.push(`${pad}  ${k}:`);
              dumpValue(v, indent + 4, out);
            } else {
              out.push(`${pad}  ${k}: ${dumpScalar(v)}`);
            }
          }
        });
      } else {
        out.push(`${pad}- ${dumpScalar(item)}`);
      }
    }
  } else if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const v = value[k];
      if (v !== null && typeof v === 'object') {
        if (Array.isArray(v) && v.length === 0) {
          out.push(`${pad}${k}: []`);
        } else {
          out.push(`${pad}${k}:`);
          dumpValue(v, indent + 2, out);
        }
      } else {
        out.push(`${pad}${k}: ${dumpScalar(v)}`);
      }
    }
  }
}

export function dumpYaml(value) {
  const out = [];
  dumpValue(value, 0, out);
  return out.join('\n') + '\n';
}
