import assert from "node:assert/strict";
import test from "node:test";
import { ChangeSet, EditorSelection, EditorState } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { JSDOM } from "jsdom";
import { reviewText, scan, trackedInRange } from "../src/markup.js";
import { renderReading } from "../src/reading.js";
import { highlightCellParts, highlightParts, highlightTransaction } from "../src/editor/highlights.js";
import { trackTransaction } from "../src/editor/tracking.js";

const noContext = () => ({block: false, excluded: []});
function editor(doc = "", context = noContext) {
  const notices = [];
  let state = EditorState.create({doc, extensions: [
    history(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.transactionFilter.of(tr => trackTransaction(tr, {context, notify: notice => notices.push(notice)}))
  ]});
  const target = {get state() { return state; }, dispatch(tr) { state = tr.state; }};
  return {target, notices, type(from, to, insert, event = "input.type") {
    const end = from + insert.length;
    state = state.update({changes: {from, to, insert}, selection: {anchor: end}, userEvent: event}).state;
    return this;
  }, get text() { return state.doc.toString(); }, get caret() { return state.selection.main.head; }};
}
function render(html, colors = true, bindComment) {
  const {window} = new JSDOM(html);
  renderReading(window.document.body, colors, bindComment);
  return window.document.body;
}

test("recognizes color and the five CriticMarkup types", () => {
  const line = "~={red}a=~ {++b++}{--c--}{~~old~>new~~}{==d==}{>>e<<}";
  const tokens = scan(line);
  assert.deepEqual(tokens.map(t => t.kind), ["color", "addition", "deletion", "substitution", "anchor", "comment"]);
  assert.equal(tokens[0].color, "red");
  assert.equal(reviewText(line, tokens[1], true), "b");
  assert.equal(reviewText(line, tokens[1], false), "");
  assert.equal(reviewText(line, tokens[2], true), "");
  assert.equal(reviewText(line, tokens[2], false), "c");
  assert.equal(reviewText(line, tokens[3], true), "new");
  assert.equal(reviewText(line, tokens[3], false), "old");
  assert.equal(scan("\\{++literal++} {++real++}")[0].from, 15);
  assert.equal(scan("{~~bad~~} {++valid++}").length, 1);
  assert.equal(scan("{++broken {++valid++}")[0].from, 10);
});

test("typing extends a single addition and backspace can discard it", () => {
  const e = editor("abc");
  e.type(3, 3, "d");
  assert.equal(e.text, "abc{++d++}");
  assert.equal(e.caret, 7);
  e.type(e.caret, e.caret, "e");
  assert.equal(e.text, "abc{++de++}");
  e.type(7, 8, "", "delete.backward").type(6, 7, "", "delete.backward");
  assert.equal(e.text, "abc");
  assert.equal(e.caret, 3);
});

test("deletion direction moves the caret past the marker in the right direction", () => {
  const e = editor("abc");
  e.type(1, 2, "", "delete.forward");
  assert.equal(e.text, "a{--b--}c");
  assert.equal(e.caret, 8);
  e.type(8, 9, "", "delete.forward");
  assert.equal(e.text, "a{--b--}{--c--}");
  assert.equal(e.caret, 15);
  const reverse = editor("abc").type(2, 3, "", "delete.backward");
  assert.equal(reverse.text, "ab{--c--}");
  assert.equal(reverse.caret, 2);
});

test("replacement preserves old text and changing the proposal updates one substitution", () => {
  const e = editor("old").type(0, 3, "new");
  assert.equal(e.text, "{~~old~>new~~}");
  assert.equal(e.caret, 11);
  e.type(8, 11, "latest");
  assert.equal(e.text, "{~~old~>latest~~}");
  e.type(8, 14, "", "delete.backward");
  assert.equal(e.text, "{--old--}");
  assert.equal(e.caret, 0);
});

test("undo and redo restore annotations, without tracking the undo transaction", () => {
  const {target} = editor("old").type(0, 3, "new");
  assert.equal(undo(target), true);
  assert.equal(target.state.doc.toString(), "old");
  assert.equal(redo(target), true);
  assert.equal(target.state.doc.toString(), "{~~old~>new~~}");
});

test("programmatic edits are not tracked; unsupported edits are passed through and announced", () => {
  const e = editor("abc");
  e.type(1, 1, "\n", "input.type");
  e.type(2, 2, "文", "input.type.compose");
  e.target.dispatch(e.target.state.update({changes: {from: 0, to: 1, insert: "A"}}));
  assert.equal(e.text, "A\n文bc");
  assert.equal(e.notices.length, 2);
  const code = editor("code", () => ({block: true, excluded: []})).type(0, 1, "C");
  assert.equal(code.text, "Code");
  assert.equal(code.notices.length, 1);
});

test("rejects partial edits to markup, including newline insertion inside a comment", () => {
  const e = editor("{>>note<<}");
  e.type(1, 2, "").type(5, 5, "\n");
  assert.equal(e.text, "{>>note<<}");
  assert.equal(e.notices.length, 2);
});

test("tracks distinct cursors in one transaction", () => {
  const e = editor("a b");
  const {state} = e.target;
  const changes = ChangeSet.of([{from: 0, insert: "z"}, {from: 2, insert: "y"}], 3);
  e.target.dispatch(state.update({changes, selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)]), userEvent: "input.type"}));
  assert.equal(e.text, "{++z++}a {++y++}b");
  assert.deepEqual(e.target.state.selection.ranges.map(range => range.head), [4, 13]);
});

test("Reading view preserves marked text and supplies comment text to its marker and anchor", () => {
  const comments = [];
  const root = render('<p>{<mark><strong>selected</strong> text</mark>}{&gt;&gt;note with <a href="/link">link</a>&lt;&lt;} ~={red}<em>red</em> text=~</p>',
    true, (marker, anchor, text) => comments.push({marker, anchor, text}));
  assert.equal(root.querySelector(".har-anchor").textContent, "selected text");
  assert.equal(root.querySelector(".har-anchor strong").textContent, "selected");
  assert.equal(comments[0].marker.getAttribute("aria-label"), "Show comment");
  assert.equal(comments[0].anchor, root.querySelector(".har-anchor"));
  assert.equal(comments[0].text, "note with link");
  assert.equal(root.querySelector(".har-color").textContent, "red text");
  assert.equal(root.querySelector(".har-color em").textContent, "red");
  assert.equal(root.querySelector("p").textContent, "selected text red text");
  const initial = root.innerHTML;
  renderReading(root, true);
  assert.equal(root.innerHTML, initial);
});

test("Reading view keeps standalone and neighboring comment markers distinct", () => {
  const comments = [];
  const root = render("<p>{&gt;&gt;first&lt;&lt;} {==two==}{&gt;&gt;second&lt;&lt;}{&gt;&gt;third&lt;&lt;}</p>", true,
    (marker, anchor, text) => {
      marker.dataset.testComment = text;
      comments.push({anchor, text});
    });
  assert.deepEqual([...root.querySelectorAll("button")].map(button => button.dataset.testComment), ["first", "second", "third"]);
  assert.deepEqual(comments.map(comment => [comment.text, comment.anchor?.textContent]), [
    ["first", undefined], ["second", "two"], ["third", undefined]
  ]);
});

test("Reading view uses palette overrides only for the named palette colors", () => {
  const root = render("<p>~={red}themed=~ ~={magenta}literal default=~ ~={#123456}explicit=~</p>");
  const colors = [...root.querySelectorAll(".har-color")].map(span => span.style.getPropertyValue("--har-color"));
  assert.deepEqual(colors, [
    "var(--har-palette-red, var(--color-red, red))",
    "var(--har-palette-magenta, magenta)",
    "#123456"
  ]);
});

test("review ranges include partial changes across lines and skip code and adjacent changes", () => {
  const {doc} = EditorState.create({doc: [
    "{++before++}{--one--} {>>leave me<<}",
    "{++code++}",
    "{~~two~>second~~} `{++code++}`",
    "{++three++}{++after++}"
  ].join("\n")});
  const from = doc.line(1).text.indexOf("one") + 1;
  const to = doc.line(4).from + doc.line(4).text.indexOf("after") - 3;
  const matches = trackedInRange(doc, from, to, line => ({
    block: line.number === 2,
    excluded: line.number === 3 ? [{from: line.text.indexOf("`"), to: line.length}] : []
  }));
  assert.deepEqual(matches.map(({line, token}) => [line.number, token.kind, reviewText(line.text, token, true),
    reviewText(line.text, token, false)]), [
    [1, "deletion", "", "one"], [3, "substitution", "second", "two"], [4, "addition", "three", ""]
  ]);
});

test("Reading view recovers substitutions consumed by native strikethrough", () => {
  const root = render("<p>{<del><strong>old</strong>~&gt;<em>new</em></del>} Native <del>strike</del>.</p>");
  assert.equal(root.querySelector("strong del.har-deletion").textContent, "old");
  assert.equal(root.querySelector("em ins.har-addition").textContent, "new");
  assert.equal(root.querySelector("del:not(.har-deletion)").textContent, "strike");
  assert.equal(root.querySelector("p").textContent, "oldnew Native strike.");
});

test("Reading view handles adjacent edits and excludes code, while delegating colors", () => {
  const root = render('<p>{++add++}{--delete--}{~~old~&gt;new~~} ~={red}a=~ <code>{++literal++}</code></p><pre><code>{--literal--}</code></pre>', false);
  assert.deepEqual([...root.querySelectorAll("ins, del")].map(n => n.textContent), ["add", "delete", "old", "new"]);
  assert.equal(root.querySelector("p").textContent, "adddeleteoldnew ~={red}a=~ {++literal++}");
  assert.equal(root.querySelector("pre").textContent, "{--literal--}");
});

function applyHighlight(target, parts, color) {
  const {state} = target;
  const {changes, selection} = highlightTransaction(parts, color, true);
  const offset = (doc, {line, ch}) => doc.line(line + 1).from + ch;
  const patch = state.changes(changes.map(({from, to, text}) => ({
    from: offset(state.doc, from), to: offset(state.doc, to), insert: text
  })));
  const doc = patch.apply(state.doc);
  target.dispatch(state.update({changes: patch, selection: {
    anchor: offset(doc, selection.from), head: offset(doc, selection.to)
  }}));
}

test("multiline highlighting preserves Markdown line structure and can be undone together", () => {
  const text = "Unselected first  \n\n- second line\n- last outside";
  const {target} = editor(text);
  const parts = highlightParts(target.state.doc, 11, text.indexOf(" outside"), line => ({
    ...noContext(), contentFrom: line.text.startsWith("- ") ? 2 : 0
  }));
  applyHighlight(target, parts, "red");
  assert.equal(target.state.doc.toString(), "Unselected ~={red}first=~  \n\n- ~={red}second line=~\n- ~={red}last=~ outside");
  const {doc, selection} = target.state;
  assert.equal(doc.sliceString(selection.main.from, selection.main.to), "first=~  \n\n- ~={red}second line=~\n- ~={red}last");
  assert.equal(undo(target), true);
  assert.equal(target.state.doc.toString(), text);
});

test("table highlights preserve cell separators, alignment rows, escaped pipes, and cell breaks", () => {
  const text = "Before\n\n| One | Two |\n| --- | :---: |\n| a\\|b<br>second | last |\n\nAfter";
  const {target} = editor(text);
  const context = line => ({
    ...noContext(), table: line.text.startsWith("|"), structural: line.number === 4
  });
  assert.equal(highlightParts(target.state.doc, 2, text.indexOf("second"), context), null);
  assert.equal(highlightParts(target.state.doc, text.indexOf("second"), text.length, context), null);
  const parts = highlightParts(target.state.doc, text.indexOf("One"), text.indexOf("last") + 4, context);
  assert.deepEqual(parts.map(part => part.value), ["One", "Two", "a\\|b", "second", "last"]);
  applyHighlight(target, parts, "blue");
  assert.equal(target.state.doc.toString(),
    "Before\n\n| ~={blue}One=~ | ~={blue}Two=~ |\n| --- | :---: |\n| ~={blue}a\\|b=~<br>~={blue}second=~ | ~={blue}last=~ |\n\nAfter");
  const root = render("<table><tr><td>~={blue}a|b=~<br>~={blue}second=~</td><td>~={blue}last=~</td></tr></table>");
  assert.deepEqual([...root.querySelectorAll(".har-color")].map(span => span.textContent), ["a|b", "second", "last"]);
});

test("multiline highlights can be recolored or removed without nesting markers", () => {
  const {target} = editor("~={red}first=~\n~={green}second=~");
  const parts = highlightParts(target.state.doc, 9, target.state.doc.length - 3, noContext);
  applyHighlight(target, parts, "red");
  assert.equal(target.state.doc.toString(), "~={red}first=~\n~={red}second=~");
  const {doc, selection} = target.state;
  const selected = highlightParts(doc, selection.main.from, selection.main.to, noContext);
  applyHighlight(target, selected, null);
  assert.equal(target.state.doc.toString(), "first\nsecond");
  assert.deepEqual([target.state.selection.main.from, target.state.selection.main.to], [0, 12]);
});

test("a rectangular selection highlights only the chosen cells in a single transaction", () => {
  const text = "| A | B | C |\n| --- | --- | --- |\n| 1 | first<br>second | 3 |\n| 4 | | 6 |";
  const {target} = editor(text);
  const cellAt = (value, textStart) => ({
    text: value, getAbsoluteOffsets: () => ({textStart, textEnd: textStart + value.length})
  });
  const cells = [cellAt("B", text.indexOf("B")), cellAt("first<br>second", text.indexOf("first")), cellAt("", -1)];
  const context = () => ({...noContext(), table: true});
  const parts = highlightCellParts(target.state.doc, cells, context);
  assert.deepEqual(parts.map(part => part.value), ["B", "first", "second"]);
  applyHighlight(target, parts, "green");
  assert.equal(target.state.doc.toString(),
    "| A | ~={green}B=~ | C |\n| --- | --- | --- |\n| 1 | ~={green}first=~<br>~={green}second=~ | 3 |\n| 4 | | 6 |");
  assert.deepEqual(highlightCellParts(target.state.doc, cells, context), []);
  assert.equal(undo(target), true);
  assert.equal(target.state.doc.toString(), text);
});
