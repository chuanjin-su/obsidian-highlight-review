import { canWrap, overlaps, scan } from "../markup.js";

function splitAt(text, from, to, separators) {
  const ranges = [];
  for (const match of text.matchAll(separators)) {
    const [separator, pipe] = match;
    const end = match.index + separator.length;
    const index = pipe ? end - 1 : match.index;
    if (index >= to) break;
    if (end <= from) continue;
    if (from < index) ranges.push({from, to: index});
    from = end;
  }
  if (from < to) ranges.push({from, to});
  return ranges;
}

const breaks = /<br\s*\/?>/gi;
// An odd number of backslashes escapes a pipe inside a Markdown cell.
const cellSeparators = /(?<!\\)(?:\\\\)*(\|)|<br\s*\/?>/gi;

export function highlightParts(doc, from, to, context) {
  if (from >= to) return [];
  const parts = [];
  let inTable;
  const last = doc.lineAt(to).number;
  for (let number = doc.lineAt(from).number; number <= last; number++) {
    const line = doc.line(number);
    const start = Math.max(0, from - line.from);
    const end = Math.min(line.length, to - line.from);
    if (!line.text.slice(start, end).trim()) continue;
    const {block, excluded, table, structural, contentFrom = 0, contentTo = line.length} = context(line);
    if (block || (inTable !== undefined && inTable !== table)) return null;
    inTable = table;
    if (structural) continue;
    const ranges = splitAt(line.text, contentFrom, contentTo, table ? cellSeparators : breaks);
    const tokens = scan(line.text, excluded);
    for (const range of ranges) {
      const from = Math.max(start, range.from);
      const to = Math.min(end, range.to);
      if (from >= to) continue;
      if (excluded.some(part => overlaps(part, from, to))) return null;
      let next = from;
      const addText = end => {
        const raw = line.text.slice(next, end);
        const value = raw.trim();
        if (!value) return true;
        const from = next + raw.length - raw.trimStart().length;
        if (!canWrap(value) || /(?:^|[^\\])(?:\\\\)*\\$/.test(line.text.slice(0, from))) return false;
        parts.push({line: number - 1, from, to: from + value.length, value});
        return true;
      };
      for (const token of tokens) {
        if (!overlaps(token, from, to)) continue;
        if (token.kind !== "color" || token.from < range.from || token.to > range.to ||
            !addText(Math.max(next, token.from))) return null;
        parts.push(colorPart(number - 1, line.text, token));
        next = token.to;
      }
      if (!addText(Math.max(next, to))) return null;
    }
  }
  return parts;
}

export function highlightCellParts(doc, cells, context) {
  const parts = [];
  for (const cell of cells) {
    if (!cell.text.trim()) continue;
    const {textStart, textEnd} = cell.getAbsoluteOffsets();
    if (textStart < 0 || textEnd > doc.length || doc.sliceString(textStart, textEnd) !== cell.text) return [];
    const selected = highlightParts(doc, textStart, textEnd, context);
    if (!selected) return [];
    parts.push(...selected);
  }
  return parts;
}

export function colorPart(line, text, token) {
  return {line, from: token.from, to: token.to, value: text.slice(token.bodyFrom, token.bodyTo), color: token.color};
}

export function highlightTransaction(parts, color, select) {
  const prefix = color ? "~={" + color + "}" : "";
  const suffix = color ? "=~" : "";
  const changes = [];
  let from, to, delta = 0;
  for (const part of parts) {
    const start = {line: part.line, ch: part.from};
    const end = {line: part.line, ch: part.to};
    if (to?.line !== part.line) delta = 0;
    from ??= {line: part.line, ch: part.from + prefix.length};
    to = {line: part.line, ch: part.from + delta + prefix.length + part.value.length};
    if (part.color !== color) {
      const text = prefix + part.value + suffix;
      changes.push({from: start, to: end, text});
      delta += text.length - (part.to - part.from);
    }
  }
  const selection = select ? {from, to} : color ? undefined : {from: to};
  return {changes, selection};
}
