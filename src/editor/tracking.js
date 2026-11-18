import { ChangeSet, EditorSelection } from "@codemirror/state";
import { canWrap, overlaps, pendingFrom, scan, trackMarkup } from "../markup.js";

const protectedEdit = "Turn off Track changes to edit annotation markup, or accept/reject the change first.";
const unsupportedEdit = "Track changes skipped a line break, code, YAML, or composition edit.";

// Add a second, sequential set of changes to CodeMirror's original transaction. This
// keeps the user's input, annotations (including undo history), and cursor mapping intact.
export function trackTransaction(tr, {context, notify}) {
  if (!tr.docChanged || !["input", "delete", "move"].some(type => tr.isUserEvent(type))) return tr;
  if (tr.isUserEvent("input.type.compose")) {
    notify(unsupportedEdit);
    return tr;
  }

  const patches = [];
  const cursorBias = new Map();
  const pendingEdits = new Map();
  const oldDoc = tr.startState.doc;
  let skipped = false;
  let blocked = false;
  tr.changes.iterChanges((from, to, fromB, toB, inserted) => {
    if (blocked) return;
    const line = oldDoc.lineAt(from);
    const start = from - line.from;
    const end = to - line.from;
    const after = inserted.toString();
    const lineContext = context(tr.startState, line);
    if (to > line.to || inserted.lines > 1) {
      // Do not let a newline silently split an existing annotation in half.
      for (let n = line.number; n <= oldDoc.lineAt(to).number; n++) {
        const edge = oldDoc.line(n);
        const ctx = n === line.number ? lineContext : context(tr.startState, edge);
        if (!ctx.block && scan(edge.text, ctx.excluded).some(token => overlaps(token, from - edge.from, to - edge.from))) {
          blocked = true;
          return;
        }
      }
      skipped = true;
      return;
    }
    if (lineContext.block || lineContext.excluded.some(range =>
      start === end ? range.from < start && start < range.to : start < range.to && end > range.from)) {
      skipped = true;
      return;
    }
    const tokens = scan(line.text, lineContext.excluded);
    const existing = tokens.find(token => overlaps(token, start, end));
    if (existing) {
      if (!["addition", "substitution"].includes(existing.kind) || start < pendingFrom(existing) || end > existing.bodyTo) {
        blocked = true;
        return;
      }
      const key = line.from + existing.from;
      if (!pendingEdits.has(key)) pendingEdits.set(key, {line, token: existing, edits: []});
      pendingEdits.get(key).edits.push({start, end, after});
      return;
    }
    const before = line.text.slice(start, end);
    const escapedOpen = /(?:^|[^\\])(?:\\\\)*\\$/.test(line.text.slice(0, start));
    if (!canWrap(before) || !canWrap(after) || escapedOpen) {
      blocked = true;
      return;
    }
    const {prefix, suffix} = trackMarkup(before, after);
    patches.push({from: fromB, insert: prefix});
    if (suffix) patches.push({from: toB, insert: suffix});
    if (!after) cursorBias.set(fromB, tr.isUserEvent("delete.forward") ? 1 : -1);
  });

  for (const {line, token, edits} of pendingEdits.values()) {
    let value = line.text.slice(pendingFrom(token), token.bodyTo);
    for (const {start, end, after} of edits.reverse()) {
      value = value.slice(0, start - pendingFrom(token)) + after + value.slice(end - pendingFrom(token));
    }
    if (!canWrap(value)) blocked = true;
    if (value) continue;
    const from = tr.changes.mapPos(line.from + token.from, 1);
    const to = tr.changes.mapPos(line.from + token.to, -1);
    const insert = token.kind === "substitution"
      ? trackMarkup(line.text.slice(token.bodyFrom, token.split), "").prefix : "";
    patches.push({from, to, insert});
  }
  if (blocked) {
    notify(protectedEdit);
    return [];
  }
  if (skipped) notify(unsupportedEdit);
  if (!patches.length) return tr;
  const changes = ChangeSet.of(patches, tr.newDoc.length);
  const selection = EditorSelection.create(tr.newSelection.ranges.map(range => range.empty
    ? EditorSelection.cursor(changes.mapPos(range.head, cursorBias.get(range.head) ?? -1), range.assoc)
    : range.map(changes)), tr.newSelection.mainIndex);
  return [tr, {changes, selection, sequential: true}];
}
