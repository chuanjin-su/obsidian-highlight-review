import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { commentMarker } from "../dom.js";
import { anchoredComments, colorValue, scan } from "../markup.js";

export function lineContext(state, line, tree) {
  if (!state?.doc || state.doc.line(line.number).text !== line.text) return {block: false, excluded: []};
  let block = false, table = false, structural = false;
  let contentFrom = 0, contentTo = line.length;
  const excluded = [];
  const add = (from, to) => {
    from = Math.max(0, from - line.from);
    to = Math.min(line.length, to - line.from);
    if (from < to) excluded.push({from, to});
  };
  (tree ?? syntaxTree(state)).iterate({
    from: line.from, to: line.to,
    enter({name, from, to}) {
      if (to <= line.from || from >= line.to) return;
      if (/hmd[-_]?(?:codeblock|frontmatter|indented-code)|hypermd[-_]?(?:codeblock|math)|^(?:FencedCode|CodeBlock|Frontmatter)$/i.test(name)) {
        block = true;
        return false;
      }
      if (/inline-code|math-inline|^InlineCode$/i.test(name)) add(from, to);
      if (/HyperMD-table-row|^(?:Table|TableHeader|TableRow|TableDelimiter)$/i.test(name)) table = true;
      if (/HyperMD-(?:table-row-1|header-line)(?:_|$)|(?:^|_)hr(?:_|$)|^(?:TableDelimiter|HorizontalRule)$/i.test(name)) structural = true;
      if (/hmd-(?:list-indent|callout)|formatting-(?:quote|list|task|header)/.test(name)) {
        const start = Math.max(0, from - line.from);
        const end = Math.min(line.length, to - line.from);
        if (/formatting-header/.test(name) && line.text.slice(contentFrom, start).trim()) contentTo = start;
        else contentFrom = end;
      }
      if (/(?:^|_)blockid(?:_|$)/.test(name)) contentTo = Math.min(contentTo, from - line.from);
    }
  });
  return {block, excluded, table, structural, contentFrom, contentTo};
}

export function editorLine(editor, number) {
  const text = editor.getLine(number);
  const from = editor.posToOffset({line: number, ch: 0});
  const ctx = lineContext(editor.cm?.state, {number: number + 1, from, to: from + text.length, length: text.length, text});
  return {text, ctx, tokens: ctx.block ? [] : scan(text, ctx.excluded)};
}

export function editorRect(view, from, to = from) {
  if (to > view.state.doc.length) return null;
  const start = view.coordsAtPos(from, 1);
  const bounds = view.scrollDOM.getBoundingClientRect();
  const end = view.coordsAtPos(to, -1);
  const visible = rect => rect && rect.bottom > bounds.top && rect.top < bounds.bottom;
  if (!visible(start)) return visible(end) ? end : null;
  if (!visible(end) || Math.abs(start.top - end.top) > 2) return start;
  return {top: start.top, bottom: start.bottom, left: Math.min(start.left, end.left), right: Math.max(start.right, end.right)};
}

class CommentWidget extends WidgetType {
  constructor(position, setIcon) {
    super();
    this.position = position;
    this.setIcon = setIcon;
  }
  eq(other) { return this.position === other.position; }
  toDOM(view) {
    const marker = commentMarker(view.dom.ownerDocument);
    marker.dataset.harComment = this.position;
    this.setIcon(marker);
    return marker;
  }
}

export function previewExtension(plugin, drawIcon) {
  const fastColorsActive = () => plugin.fastColorsActive();
  const hidden = Decoration.replace({});
  const marks = new Map();
  function mark(role, value) {
    // Color identifiers can be supplied by notes. Don't keep them in a long-lived cache.
    if (value) return Decoration.mark({class: "har-color", attributes: {style: `--har-color: ${value}`}});
    if (!marks.has(role)) marks.set(role, Decoration.mark({class: "har-" + role}));
    return marks.get(role);
  }
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.rebuild(view);
      this.view = view;
      this.over = event => {
        if (event.buttons) return;
        const trigger = event.target.closest?.("[data-har-comment]");
        if (trigger && !trigger.contains(event.relatedTarget)) plugin.showEditorComment(view, trigger);
      };
      this.out = event => {
        const trigger = event.target.closest?.("[data-har-comment]");
        if (trigger && !trigger.contains(event.relatedTarget)) plugin.deferCommentClose(view);
      };
      this.click = event => {
        const trigger = event.target.closest?.(".har-comment-marker[data-har-comment]");
        if (!trigger) return;
        event.preventDefault();
        plugin.showEditorComment(view, trigger, true);
      };
      view.dom.addEventListener("pointerover", this.over);
      view.dom.addEventListener("pointerout", this.out);
      view.dom.addEventListener("click", this.click);
    }
    update(update) {
      if (update.docChanged) plugin.editorCommentChanged(update.view);
      if (update.docChanged || update.viewportChanged || update.selectionSet ||
          update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false) ||
          syntaxTree(update.startState) !== syntaxTree(update.state) || this.delegated !== fastColorsActive()) {
        this.rebuild(update.view);
      }
    }
    rebuild(view) {
      const {state} = view;
      this.delegated = fastColorsActive();
      const decorations = [];
      if (state.field(editorLivePreviewField, false)) {
        let lastLine = 0;
        for (const visible of view.visibleRanges) {
          for (let number = Math.max(lastLine + 1, state.doc.lineAt(visible.from).number);
               number <= state.doc.lineAt(visible.to).number; number++) {
            lastLine = number;
            const line = state.doc.line(number);
            if (!/[{~]/.test(line.text)) continue;
            const ctx = lineContext(state, line);
            if (ctx.block) continue;
            const tokens = scan(line.text, ctx.excluded);
            const anchors = new Map(anchoredComments(tokens)
              .filter(({anchor}) => anchor).map(({anchor, token}) => [anchor, line.from + token.from]));
            for (const token of tokens) {
              const {kind, from, to, bodyFrom, bodyTo, split} = token;
              const value = kind === "color" ? colorValue(token.color) : null;
              if (kind === "color" && (this.delegated || !value)) continue;
              const reveal = kind !== "color" && state.selection.ranges.some(range =>
                range.from <= line.from + to && range.to >= line.from + from);
              const add = (deco, start, end) => decorations.push(deco.range(line.from + start, line.from + end));
              if (kind === "comment") {
                add(Decoration.replace({widget: new CommentWidget(line.from + from, drawIcon)}), from, to);
                continue;
              }
              if (anchors.has(token)) {
                add(hidden, from, bodyFrom);
                add(hidden, bodyTo, to);
                add(Decoration.mark({class: "har-anchor har-comment-anchor", attributes: {
                  "data-har-comment": String(anchors.get(token))
                }}), bodyFrom, bodyTo);
                continue;
              }
              if (!reveal) {
                add(hidden, from, bodyFrom);
                add(hidden, bodyTo, to);
              }
              if (kind === "substitution") {
                add(mark("deletion"), bodyFrom, split);
                add(mark("addition"), split + 2, bodyTo);
                if (!reveal) add(hidden, split, split + 2);
              } else {
                add(mark(kind, value), bodyFrom, bodyTo);
              }
            }
          }
        }
      }
      this.decorations = Decoration.set(decorations, true);
    }
    destroy() {
      const {view} = this;
      view.dom.removeEventListener("pointerover", this.over);
      view.dom.removeEventListener("pointerout", this.out);
      view.dom.removeEventListener("click", this.click);
      plugin.editorCommentChanged(view);
    }
  }, {decorations: instance => instance.decorations});
}
