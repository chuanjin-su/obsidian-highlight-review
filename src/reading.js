import { commentMarker } from "./dom.js";
import { anchoredComments, colorValue, scan } from "./markup.js";

const blockTags = new Set(("ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DETAILS DIV DL DT FIGCAPTION FIGURE FOOTER " +
  "H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P SECTION SUMMARY TABLE TBODY TD TH THEAD TR UL").split(" "));
const skippedTags = new Set(["PRE", "SCRIPT", "STYLE", "TEXTAREA", "SVG", "MATH"]);

// Obsidian can consume == and ~~ before post-processors see the markup.
function recoverDelimiters(root) {
  for (const element of root.querySelectorAll("mark, del, s")) {
    if (element.closest("pre, code, .har-annotation")) continue;
    const delimiter = element.tagName === "MARK" ? "==" : "~~";
    if (delimiter === "~~" && !element.textContent.includes("~>")) continue;
    const left = element.previousSibling;
    const right = element.nextSibling;
    if (left?.nodeType !== 3 || !left.data.endsWith("{") || right?.nodeType !== 3 || !right.data.startsWith("}")) continue;
    left.appendData(delimiter);
    right.insertData(0, delimiter);
    element.replaceWith(...element.childNodes);
  }
}

function collectRuns(root) {
  const runs = [];
  let nodes = [], excluded = [], text = "";
  function flush() {
    if (text) runs.push({nodes, excluded, text});
    nodes = [];
    excluded = [];
    text = "";
  }
  function visit(node, code = false) {
    if (node.nodeType === 3 && node.data.length) {
      const from = text.length;
      text += node.data;
      nodes.push({node, from, to: text.length});
      if (code) excluded.push({from, to: text.length});
    } else if (node.nodeType === 1) {
      if (skippedTags.has(node.tagName.toUpperCase()) || node.classList.contains("har-annotation") || node.tagName === "BR") {
        flush();
        return;
      }
      const block = blockTags.has(node.tagName);
      if (block) flush();
      for (const child of node.childNodes) visit(child, code || node.tagName === "CODE");
      if (block) flush();
    }
  }
  visit(root);
  flush();
  return runs;
}

function spanFor(document, role, color) {
  const tag = {addition: "ins", deletion: "del", anchor: "mark"}[role] || "span";
  const span = document.createElement(tag);
  span.className = `har-annotation har-${role}`;
  if (color) span.style.setProperty("--har-color", color);
  return span;
}

// Work from right to left, so DOM edits don't invalidate earlier source offsets.
// Ranges preserve existing inline Markdown elements (links, emphasis, code, etc.).
function applyRun(document, {nodes, excluded, text}, renderColors, bindComment) {
  const tokens = scan(text, excluded);
  const comments = anchoredComments(tokens);
  const markers = new Map();
  const anchors = new Map();
  function boundary(pos, end) {
    let low = 0, high = nodes.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (pos < nodes[mid].to || (end && pos === nodes[mid].to)) high = mid;
      else low = mid + 1;
    }
    return [nodes[low].node, pos - nodes[low].from];
  }
  function rangeFor(from, to) {
    const range = document.createRange();
    range.setStart(...boundary(from, false));
    range.setEnd(...boundary(to, true));
    return range;
  }
  function remove(from, to) {
    rangeFor(from, to).deleteContents();
  }
  function wrap(from, to, role, color) {
    const range = rangeFor(from, to);
    const span = spanFor(document, role, color);
    span.append(range.extractContents());
    range.insertNode(span);
    return span;
  }
  for (const token of tokens.reverse()) {
    const {kind, from, to, bodyFrom, bodyTo, split} = token;
    const color = kind === "color" ? colorValue(token.color) : null;
    if (kind === "color" && (!renderColors || !color)) continue;
    if (kind === "comment") {
      const marker = commentMarker(document);
      const range = rangeFor(from, to);
      range.deleteContents();
      range.insertNode(marker);
      markers.set(token, marker);
      continue;
    }
    remove(bodyTo, to);
    if (kind === "substitution") {
      wrap(split + 2, bodyTo, "addition");
      remove(split, split + 2);
      wrap(bodyFrom, split, "deletion");
    } else {
      const span = wrap(bodyFrom, bodyTo, kind, color);
      if (kind === "anchor") anchors.set(token, span);
    }
    remove(from, bodyFrom);
  }
  for (const {token, anchor} of comments) {
    bindComment?.(markers.get(token), anchors.get(anchor), text.slice(token.bodyFrom, token.bodyTo));
  }
}

export function renderReading(root, renderColors, bindComment) {
  if (root.closest("pre, code, .har-annotation") || !/\{|~=/.test(root.textContent)) return;
  recoverDelimiters(root);
  for (const run of collectRuns(root)) applyRun(root.ownerDocument, run, renderColors, bindComment);
}
