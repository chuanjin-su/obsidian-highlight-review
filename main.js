var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.js
var main_exports = {};
__export(main_exports, {
  default: () => HighlightsAndReview
});
module.exports = __toCommonJS(main_exports);
var import_state2 = require("@codemirror/state");
var import_obsidian5 = require("obsidian");

// src/comments/popover.js
var import_obsidian = require("obsidian");

// src/dom.js
function commentMarker(document) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "har-comment-marker har-annotation";
  button.setAttribute("aria-label", "Show comment");
  button.setAttribute("aria-haspopup", "dialog");
  return button;
}
function placeFloating(element, rect, above = false) {
  const { innerWidth, innerHeight } = element.ownerDocument.defaultView;
  const { offsetWidth: width, offsetHeight: height } = element;
  const margin = 8;
  const gap = 6;
  const left = above ? (rect.left + rect.right - width) / 2 : rect.left;
  const before = rect.top - gap - height;
  const after = rect.bottom + gap;
  const top = above ? before >= margin ? before : after : after + height <= innerHeight - margin ? after : before;
  element.style.left = Math.max(margin, Math.min(left, innerWidth - width - margin)) + "px";
  element.style.top = Math.max(margin, Math.min(top, innerHeight - height - margin)) + "px";
}

// src/markup.js
var critic = {
  addition: ["{++", "++}"],
  deletion: ["{--", "--}"],
  substitution: ["{~~", "~~}"],
  comment: ["{>>", "<<}"],
  anchor: ["{==", "==}"]
};
var colors = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
  "magenta",
  "black"
];
var opening = /\{(?:\+\+|--|~~|>>|==)|~=\{([^\s{}]+)\}/g;
var kinds = new Map(Object.entries(critic).map(([kind, [open]]) => [open, kind]));
var reserved = /\{(?:\+\+|--|~~|>>|==)|(?:\+\+|--|~~|<<|==)\}|~>|~=\{|=~/;
var escaped = (text, at) => {
  let count = 0;
  while (at > 0 && text[--at] === "\\") count++;
  return count % 2 !== 0;
};
var intersects = (from, to, ranges) => ranges.some((range) => from < range.to && to > range.from);
function scan(text, excluded = []) {
  const tokens = [];
  const starts = new RegExp(opening);
  const enabled = (at, length) => !intersects(at, at + length, excluded) && !escaped(text, at);
  function find(delimiter, start) {
    for (let pos = text.indexOf(delimiter, start); pos !== -1; pos = text.indexOf(delimiter, pos + 1)) {
      if (enabled(pos, delimiter.length)) return pos;
    }
    return -1;
  }
  for (let start; start = starts.exec(text); ) {
    const from = start.index;
    const bodyFrom = starts.lastIndex;
    if (!enabled(from, bodyFrom - from)) continue;
    const kind = start[1] ? "color" : kinds.get(start[0]);
    const close = kind === "color" ? "=~" : critic[kind][1];
    const bodyTo = find(close, bodyFrom);
    if (bodyTo <= bodyFrom) continue;
    const body = text.slice(bodyFrom, bodyTo);
    if (/[\r\n]/.test(body)) continue;
    const nested = find(start[0], bodyFrom);
    if (nested !== -1 && nested < bodyTo) continue;
    const to = bodyTo + close.length;
    const token = { kind, from, to, bodyFrom, bodyTo };
    if (kind === "color") token.color = start[1];
    if (kind === "substitution") {
      token.split = find("~>", bodyFrom);
      if (token.split <= bodyFrom || token.split + 2 >= bodyTo) continue;
    }
    tokens.push(token);
    starts.lastIndex = to;
  }
  return tokens;
}
var containsMarkup = (text) => reserved.test(text);
var endSafe = (value) => {
  const tail = value.match(/\\+$/);
  return !tail || tail[0].length % 2 === 0;
};
var canWrap = (value) => !/[\r\n]/.test(value) && !containsMarkup(value) && endSafe(value);
function colorValue(name) {
  if (colors.includes(name) && name !== "black" && name !== "magenta") return "var(--color-" + name + ", " + name + ")";
  return /^(?:[a-z]{1,30}|#[\da-f]{3,8})$/i.test(name) ? name : null;
}
function trackMarkup(before, after) {
  if (before && after) return { prefix: "{~~" + before + "~>", suffix: "~~}" };
  if (after) return { prefix: "{++", suffix: "++}" };
  return { prefix: "{--" + before + "--}", suffix: "" };
}
function reviewText(line, token, accept) {
  const { kind, bodyFrom, bodyTo, split } = token;
  if (kind === "substitution") return accept ? line.slice(split + 2, bodyTo) : line.slice(bodyFrom, split);
  if (kind === "addition" && accept || kind === "deletion" && !accept) return line.slice(bodyFrom, bodyTo);
  return "";
}
var isChange = (token) => ["addition", "deletion", "substitution"].includes(token.kind);
var pendingFrom = (token) => token.kind === "substitution" ? token.split + 2 : token.bodyFrom;
function overlaps(token, from, to) {
  return from === to ? token.from < from && from < token.to : from < token.to && to > token.from;
}
function trackedInRange(doc, from, to, context) {
  const matches = [];
  const last = doc.lineAt(to).number;
  for (let number = doc.lineAt(from).number; number <= last; number++) {
    const line = doc.line(number);
    const { block, excluded } = context(line);
    if (block) continue;
    for (const token of scan(line.text, excluded)) {
      if (isChange(token) && overlaps(token, from - line.from, to - line.from)) {
        matches.push({ line, token });
      }
    }
  }
  return matches;
}
function anchoredComments(tokens) {
  const comments = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "comment") return;
    const previous = tokens[index - 1];
    const anchor = previous?.kind === "anchor" && previous.to === token.from ? previous : null;
    comments.push({ token, anchor });
  });
  return comments;
}

// src/comments/popover.js
var CommentPopover = class {
  constructor(document) {
    this.document = document;
    this.window = document.defaultView;
    this.panel = document.createElement("div");
    this.panel.className = "har-comment-popover";
    this.panel.setAttribute("role", "dialog");
    this.heading = this.panel.createDiv({ cls: "har-popover-heading" });
    this.title = this.heading.createSpan();
    this.actions = this.heading.createDiv({ cls: "har-popover-actions" });
    const action = (icon, label, onClick) => {
      const button = this.actions.createEl("button", {
        cls: "clickable-icon",
        attr: { type: "button", "aria-label": label, title: label }
      });
      (0, import_obsidian.setIcon)(button, icon);
      button.addEventListener("click", onClick);
      return button;
    };
    this.editButton = action("pencil", "Edit comment", () => this.edit());
    this.deleteButton = action("trash-2", "Delete comment", () => this.remove());
    this.deleteButton.classList.add("har-delete-comment");
    this.submitButton = action("check", "Save comment", () => this.submit());
    this.submitButton.classList.add("har-submit-comment");
    this.closeButton = action("x", "Close comment", () => this.close(true));
    this.input = this.panel.createEl("textarea", { attr: { "aria-label": "Comment", rows: "1" } });
    this.input.placeholder = "Write a comment\u2026";
    this.error = this.panel.createDiv({ cls: "har-comment-error", attr: { role: "alert" } });
    this.input.addEventListener("input", () => {
      this.error.hidden = true;
      this.resizeInput();
      this.place();
    });
    this.panel.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.target !== this.input || this.input.readOnly) return;
      event.preventDefault();
      this.submit();
    });
    this.panel.addEventListener("pointerenter", () => this.cancelClose());
    this.panel.addEventListener("pointerleave", () => this.deferClose());
    this.outside = (event) => {
      if (this.panel.contains(event.target) || this.current?.trigger?.contains(event.target)) return;
      this.close();
    };
    this.escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.close(this.pinned);
    };
    this.reposition = () => this.place();
    this.resize = () => {
      this.resizeInput();
      this.place();
    };
  }
  show(details, { pin = false, edit = false } = {}) {
    if (this.destroyed) return;
    this.cancelClose();
    if (this.current?.owner === details.owner && this.current.id === details.id && !edit) {
      if (!this.pinned) this.current = details;
      if (pin && !this.pinned) {
        this.pinned = true;
        this.render(false);
        this.focusAction();
      }
      this.place();
      return;
    }
    if (this.pinned && !pin && !edit) return;
    this.close();
    this.current = details;
    this.pinned = pin || edit;
    this.document.body.append(this.panel);
    this.document.addEventListener("pointerdown", this.outside, true);
    this.document.addEventListener("keydown", this.escape, true);
    this.document.addEventListener("scroll", this.reposition, true);
    this.window.addEventListener("resize", this.resize);
    this.render(edit);
    this.place();
    if (edit) this.input.focus({ preventScroll: true });
    else if (pin) this.focusAction();
  }
  render(edit) {
    const { text, save, remove } = this.current;
    const title = edit ? text == null ? "Add comment" : "Edit comment" : "Comment";
    this.panel.setAttribute("aria-label", title);
    this.title.textContent = title;
    this.editButton.hidden = edit || !save;
    this.deleteButton.hidden = edit || !remove;
    this.submitButton.hidden = !edit;
    this.submitButton.setAttribute("aria-label", text == null ? "Add comment" : "Save comment");
    this.submitButton.title = this.submitButton.getAttribute("aria-label");
    this.closeButton.hidden = !this.pinned;
    this.closeButton.setAttribute("aria-label", edit ? "Cancel editing" : "Close comment");
    this.closeButton.title = this.closeButton.getAttribute("aria-label");
    this.input.value = text ?? "";
    this.input.readOnly = !edit;
    this.error.hidden = true;
    this.resizeInput();
  }
  focusAction() {
    (this.editButton.hidden ? this.closeButton : this.editButton).focus({ preventScroll: true });
  }
  edit() {
    this.pinned = true;
    this.render(true);
    this.place();
    this.input.focus({ preventScroll: true });
  }
  remove() {
    this.pinned = true;
    if (this.current.remove()) this.close(true);
    else this.render(false);
  }
  submit() {
    const value = this.input.value.trim();
    if (!value || !canWrap(value)) {
      this.error.textContent = "Enter one line without annotation delimiters or a trailing backslash.";
      this.error.hidden = false;
      this.place();
      this.input.focus();
      return;
    }
    if (this.current.save(value)) this.close(true);
  }
  resizeInput() {
    this.input.style.height = "auto";
    this.input.style.height = this.input.scrollHeight + 2 + "px";
  }
  place() {
    const rect = this.current?.rect();
    if (rect) placeFloating(this.panel, rect);
    else this.close();
  }
  cancelClose() {
    this.window.clearTimeout(this.closeTimer);
  }
  deferClose() {
    if (!this.current || this.pinned) return;
    this.cancelClose();
    this.closeTimer = this.window.setTimeout(() => this.close(), 240);
  }
  close(restoreFocus = false) {
    if (!this.current) return;
    const { focus, trigger } = this.current;
    this.current = null;
    this.pinned = false;
    this.cancelClose();
    this.panel.remove();
    this.document.removeEventListener("pointerdown", this.outside, true);
    this.document.removeEventListener("keydown", this.escape, true);
    this.document.removeEventListener("scroll", this.reposition, true);
    this.window.removeEventListener("resize", this.resize);
    if (restoreFocus) {
      if (focus) focus();
      else if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  }
  destroy() {
    this.close();
    this.destroyed = true;
  }
};

// src/comments/sidebar.js
var import_obsidian3 = require("obsidian");

// src/editor/preview.js
var import_language = require("@codemirror/language");
var import_view = require("@codemirror/view");
var import_obsidian2 = require("obsidian");
function lineContext(state, line) {
  if (!state?.doc || state.doc.line(line.number).text !== line.text) return { block: false, excluded: [] };
  let block = false;
  const excluded = [];
  const add = (from, to) => {
    from = Math.max(0, from - line.from);
    to = Math.min(line.length, to - line.from);
    if (from < to) excluded.push({ from, to });
  };
  (0, import_language.syntaxTree)(state).iterate({
    from: line.from,
    to: line.to,
    enter({ name, from, to }) {
      if (/hmd[-_]?(?:codeblock|frontmatter|indented-code)|hypermd[-_]?(?:codeblock|math)|^(?:FencedCode|CodeBlock|Frontmatter)$/i.test(name)) {
        block = true;
        return false;
      }
      if (/inline-code|math-inline|^InlineCode$/i.test(name)) add(from, to);
    }
  });
  return { block, excluded };
}
function editorLine(editor, number) {
  const text = editor.getLine(number);
  const from = editor.posToOffset({ line: number, ch: 0 });
  const ctx = lineContext(editor.cm?.state, { number: number + 1, from, to: from + text.length, length: text.length, text });
  return { text, ctx, tokens: ctx.block ? [] : scan(text, ctx.excluded) };
}
function editorRect(view, from, to = from) {
  if (to > view.state.doc.length) return null;
  const start = view.coordsAtPos(from, 1);
  if (!start) return null;
  const bounds = view.scrollDOM.getBoundingClientRect();
  if (start.bottom <= bounds.top || start.top >= bounds.bottom) return null;
  const end = view.coordsAtPos(to, -1);
  if (!end || Math.abs(start.top - end.top) > 2) return start;
  return { top: start.top, bottom: start.bottom, left: Math.min(start.left, end.left), right: Math.max(start.right, end.right) };
}
var CommentWidget = class extends import_view.WidgetType {
  constructor(position, setIcon4) {
    super();
    this.position = position;
    this.setIcon = setIcon4;
  }
  eq(other) {
    return this.position === other.position;
  }
  toDOM(view) {
    const marker = commentMarker(view.dom.ownerDocument);
    marker.dataset.harComment = this.position;
    this.setIcon(marker);
    return marker;
  }
};
function previewExtension(plugin, drawIcon) {
  const fastColorsActive = () => plugin.fastColorsActive();
  const hidden = import_view.Decoration.replace({});
  const marks = /* @__PURE__ */ new Map();
  function mark(role, value) {
    if (value) return import_view.Decoration.mark({ class: "har-color", attributes: { style: `--har-color: ${value}` } });
    if (!marks.has(role)) marks.set(role, import_view.Decoration.mark({ class: "har-" + role }));
    return marks.get(role);
  }
  return import_view.ViewPlugin.fromClass(class {
    constructor(view) {
      this.rebuild(view);
      this.view = view;
      this.over = (event) => {
        if (event.buttons) return;
        const trigger = event.target.closest?.("[data-har-comment]");
        if (trigger && !trigger.contains(event.relatedTarget)) plugin.showEditorComment(view, trigger);
      };
      this.out = (event) => {
        const trigger = event.target.closest?.("[data-har-comment]");
        if (trigger && !trigger.contains(event.relatedTarget)) plugin.deferCommentClose(view);
      };
      this.click = (event) => {
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
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.startState.field(import_obsidian2.editorLivePreviewField, false) !== update.state.field(import_obsidian2.editorLivePreviewField, false) || (0, import_language.syntaxTree)(update.startState) !== (0, import_language.syntaxTree)(update.state) || this.delegated !== fastColorsActive()) {
        this.rebuild(update.view);
      }
    }
    rebuild(view) {
      const { state } = view;
      this.delegated = fastColorsActive();
      const decorations = [];
      if (state.field(import_obsidian2.editorLivePreviewField, false)) {
        let lastLine = 0;
        for (const visible of view.visibleRanges) {
          for (let number = Math.max(lastLine + 1, state.doc.lineAt(visible.from).number); number <= state.doc.lineAt(visible.to).number; number++) {
            lastLine = number;
            const line = state.doc.line(number);
            if (!/[{~]/.test(line.text)) continue;
            const ctx = lineContext(state, line);
            if (ctx.block) continue;
            const tokens = scan(line.text, ctx.excluded);
            const anchors = new Map(anchoredComments(tokens).filter(({ anchor }) => anchor).map(({ anchor, token }) => [anchor, line.from + token.from]));
            for (const token of tokens) {
              const { kind, from, to, bodyFrom, bodyTo, split } = token;
              const value = kind === "color" ? colorValue(token.color) : null;
              if (kind === "color" && (this.delegated || !value)) continue;
              const reveal = kind !== "color" && state.selection.ranges.some((range) => range.from <= line.from + to && range.to >= line.from + from);
              const add = (deco, start, end) => decorations.push(deco.range(line.from + start, line.from + end));
              if (kind === "comment") {
                add(import_view.Decoration.replace({ widget: new CommentWidget(line.from + from, drawIcon) }), from, to);
                continue;
              }
              if (anchors.has(token)) {
                add(hidden, from, bodyFrom);
                add(hidden, bodyTo, to);
                add(import_view.Decoration.mark({ class: "har-anchor har-comment-anchor", attributes: {
                  "data-har-comment": String(anchors.get(token))
                } }), bodyFrom, bodyTo);
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
      this.decorations = import_view.Decoration.set(decorations, true);
    }
    destroy() {
      const { view } = this;
      view.dom.removeEventListener("pointerover", this.over);
      view.dom.removeEventListener("pointerout", this.out);
      view.dom.removeEventListener("click", this.click);
      plugin.editorCommentChanged(view);
    }
  }, { decorations: (instance) => instance.decorations });
}

// src/comments/sidebar.js
var commentsViewType = "har-comments";
var CommentsView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.generation = 0;
  }
  getViewType() {
    return commentsViewType;
  }
  getDisplayText() {
    return "Comments";
  }
  getIcon() {
    return "message-square";
  }
  async onOpen() {
    this.contentEl.addClass("har-comments-sidebar");
    this.heading = this.contentEl.createEl("h2");
    this.list = this.contentEl.createDiv({ cls: "har-comments-list" });
    await this.refresh();
  }
  async refresh() {
    if (!this.list) return;
    const generation = ++this.generation;
    const view = this.plugin.reviewView;
    const file = view?.file;
    const editor = view?.getMode() === "source" ? view.editor : null;
    this.heading.setText(file?.basename ?? "Comments");
    let entries = [];
    if (file) {
      try {
        entries = editor ? this.fromEditor(editor) : await this.fromFile(file);
      } catch {
        if (generation === this.generation) this.setMessage("The note could not be read.");
        return;
      }
    }
    if (generation !== this.generation) return;
    if (!entries.length) {
      this.setMessage(file ? "No comments in this note." : "Open a note to see its comments.", view);
      return;
    }
    const content = JSON.stringify([file.path, entries]);
    if (this.lastView === view && this.lastContent === content) return;
    this.lastView = view;
    this.lastContent = content;
    this.list.empty();
    for (const { number, text, token, anchor } of entries) {
      const button = this.list.createEl("button", { cls: "har-sidebar-comment", attr: { type: "button" } });
      if (anchor) button.createSpan({ cls: "har-comment-quote", text: text.slice(anchor.bodyFrom, anchor.bodyTo) });
      button.createSpan({ cls: "har-comment-body", text: text.slice(token.bodyFrom, token.bodyTo) });
      button.createSpan({ cls: "har-comment-location", text: `Line ${number + 1}` });
      button.addEventListener("click", () => this.plugin.jumpToComment(view, file, { number, text, token, anchor }));
    }
  }
  setMessage(text, view) {
    if (this.lastView === view && this.lastContent === text) return;
    this.lastView = view;
    this.lastContent = text;
    this.list.empty();
    this.list.createEl("p", { cls: "har-comments-empty", text });
  }
  fromEditor(editor) {
    const entries = [];
    for (let number = 0; number < editor.lineCount(); number++) {
      if (!editor.getLine(number).includes("{>>")) continue;
      const { text, tokens } = editorLine(editor, number);
      for (const comment of anchoredComments(tokens)) entries.push({ number, text, ...comment });
    }
    return entries;
  }
  async fromFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = this.app.metadataCache.getFileCache(file)?.sections?.filter((section) => /^(code|yaml|math)$/.test(section.type)) ?? [];
    const entries = [];
    for (const [number, text] of source.split(/\r?\n/).entries()) {
      if (!text.includes("{>>") || blocks.some((block) => block.position.start.line <= number && number <= block.position.end.line)) continue;
      const inlineCode = [...text.matchAll(/(?<!`)(`+)(?!`)(.*?)\1(?!`)/g)];
      const excluded = inlineCode.map((match) => ({ from: match.index, to: match.index + match[0].length }));
      for (const comment of anchoredComments(scan(text, excluded))) entries.push({ number, text, ...comment });
    }
    return entries;
  }
  async onClose() {
    this.generation++;
    this.list = null;
    this.lastContent = null;
    this.lastView = null;
  }
};

// src/editor/selection-toolbar.js
var import_view2 = require("@codemirror/view");
var import_obsidian4 = require("obsidian");
function selectionToolbar(plugin) {
  return import_view2.ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.document = view.dom.ownerDocument;
      this.window = this.document.defaultView;
      const panel = this.document.createElement("div");
      panel.className = "har-selection-toolbar";
      panel.setAttribute("role", "toolbar");
      panel.setAttribute("aria-label", "Selection actions");
      panel.addEventListener("pointerdown", (event) => event.preventDefault());
      const button = (parent, label, action, icon) => {
        const el = parent.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, title: label } });
        if (icon) (0, import_obsidian4.setIcon)(el, icon);
        el.addEventListener("click", action);
        return el;
      };
      this.palette = panel.createDiv({ cls: "har-highlight-palette", attr: { role: "group", "aria-label": "Highlight colors" } });
      this.swatches = colors.map((color) => {
        const swatch = button(this.palette, `Highlight ${color}`, () => this.options?.applyColor?.(color));
        swatch.classList.add("har-color-swatch");
        swatch.style.setProperty("--har-swatch", colorValue(color));
        return swatch;
      });
      this.remove = button(panel, "Remove highlight", () => this.options?.removeColor?.(), "eraser");
      this.comment = button(panel, "Add comment", () => this.options?.comment?.(), "message-square-plus");
      this.panel = panel;
      this.schedule = () => {
        if (this.frame) return;
        this.frame = this.window.requestAnimationFrame(() => {
          this.frame = null;
          this.refresh();
        });
      };
      this.stopDrag = () => {
        this.dragging = false;
        this.document.removeEventListener("pointerup", this.stopDrag, true);
        this.document.removeEventListener("pointercancel", this.stopDrag, true);
        this.schedule();
      };
      this.startDrag = (event) => {
        if (event.button !== 0) return;
        this.dragging = true;
        this.dismissed = false;
        this.panel.remove();
        this.document.addEventListener("pointerup", this.stopDrag, true);
        this.document.addEventListener("pointercancel", this.stopDrag, true);
      };
      this.dismiss = () => {
        this.dismissed = true;
        this.panel.remove();
      };
      this.key = (event) => {
        if (event.key === "Escape" && this.panel.isConnected) this.dismiss();
      };
      view.dom.addEventListener("pointerdown", this.startDrag);
      view.dom.addEventListener("contextmenu", this.dismiss);
      view.dom.addEventListener("keydown", this.key);
      view.scrollDOM.addEventListener("scroll", this.schedule);
      this.window.addEventListener("resize", this.schedule);
    }
    update(update) {
      if (update.selectionSet || update.docChanged) this.dismissed = false;
      if (update.selectionSet || update.docChanged || update.geometryChanged || update.viewportChanged || update.focusChanged) this.schedule();
    }
    refresh() {
      const { view, panel } = this;
      const range = view.state.selection.main;
      const { selectionToolbar: selectionToolbar2, toolbarColors } = plugin.settings;
      const options = !this.dragging && !this.dismissed && selectionToolbar2 && view.hasFocus && !range.empty && plugin.toolbarOptions(view);
      const showPalette = options?.applyColor && toolbarColors.length > 0;
      const rect = (showPalette || options?.removeColor || options?.comment) && editorRect(view, range.from, range.to);
      if (!rect) {
        panel.remove();
        return;
      }
      this.options = options;
      this.palette.hidden = !showPalette;
      this.swatches.forEach((button, index) => {
        const color = colors[index];
        button.hidden = !toolbarColors.includes(color);
        button.setAttribute("aria-pressed", String(color === options.color));
      });
      this.remove.hidden = !options.removeColor;
      this.comment.hidden = !options.comment;
      if (!panel.isConnected) this.document.body.append(panel);
      placeFloating(panel, rect, true);
    }
    destroy() {
      const { view } = this;
      this.stopDrag();
      this.window.cancelAnimationFrame(this.frame);
      this.window.removeEventListener("resize", this.schedule);
      view.dom.removeEventListener("pointerdown", this.startDrag);
      view.dom.removeEventListener("contextmenu", this.dismiss);
      view.dom.removeEventListener("keydown", this.key);
      view.scrollDOM.removeEventListener("scroll", this.schedule);
      this.panel.remove();
    }
  });
}

// src/editor/tracking.js
var import_state = require("@codemirror/state");
var protectedEdit = "Turn off Track changes to edit annotation markup, or accept/reject the change first.";
var unsupportedEdit = "Track changes skipped a line break, code, YAML, or composition edit.";
function trackTransaction(tr, { context, notify }) {
  if (!tr.docChanged || !["input", "delete", "move"].some((type) => tr.isUserEvent(type))) return tr;
  if (tr.isUserEvent("input.type.compose")) {
    notify(unsupportedEdit);
    return tr;
  }
  const patches = [];
  const cursorBias = /* @__PURE__ */ new Map();
  const pendingEdits = /* @__PURE__ */ new Map();
  const oldDoc = tr.startState.doc;
  let skipped = false;
  let blocked = false;
  tr.changes.iterChanges((from, to, fromB, toB, inserted) => {
    if (blocked) return;
    const line = oldDoc.lineAt(from);
    const start = from - line.from;
    const end = to - line.from;
    const after = inserted.toString();
    const lineContext2 = context(tr.startState, line);
    if (to > line.to || inserted.lines > 1) {
      for (let n = line.number; n <= oldDoc.lineAt(to).number; n++) {
        const edge = oldDoc.line(n);
        const ctx = n === line.number ? lineContext2 : context(tr.startState, edge);
        if (!ctx.block && scan(edge.text, ctx.excluded).some((token) => overlaps(token, from - edge.from, to - edge.from))) {
          blocked = true;
          return;
        }
      }
      skipped = true;
      return;
    }
    if (lineContext2.block || lineContext2.excluded.some((range) => start === end ? range.from < start && start < range.to : start < range.to && end > range.from)) {
      skipped = true;
      return;
    }
    const tokens = scan(line.text, lineContext2.excluded);
    const existing = tokens.find((token) => overlaps(token, start, end));
    if (existing) {
      if (!["addition", "substitution"].includes(existing.kind) || start < pendingFrom(existing) || end > existing.bodyTo) {
        blocked = true;
        return;
      }
      const key = line.from + existing.from;
      if (!pendingEdits.has(key)) pendingEdits.set(key, { line, token: existing, edits: [] });
      pendingEdits.get(key).edits.push({ start, end, after });
      return;
    }
    const before = line.text.slice(start, end);
    const escapedOpen = /(?:^|[^\\])(?:\\\\)*\\$/.test(line.text.slice(0, start));
    if (!canWrap(before) || !canWrap(after) || escapedOpen) {
      blocked = true;
      return;
    }
    const { prefix, suffix } = trackMarkup(before, after);
    patches.push({ from: fromB, insert: prefix });
    if (suffix) patches.push({ from: toB, insert: suffix });
    if (!after) cursorBias.set(fromB, tr.isUserEvent("delete.forward") ? 1 : -1);
  });
  for (const { line, token, edits } of pendingEdits.values()) {
    let value = line.text.slice(pendingFrom(token), token.bodyTo);
    for (const { start, end, after } of edits.reverse()) {
      value = value.slice(0, start - pendingFrom(token)) + after + value.slice(end - pendingFrom(token));
    }
    if (!canWrap(value)) blocked = true;
    if (value) continue;
    const from = tr.changes.mapPos(line.from + token.from, 1);
    const to = tr.changes.mapPos(line.from + token.to, -1);
    const insert = token.kind === "substitution" ? trackMarkup(line.text.slice(token.bodyFrom, token.split), "").prefix : "";
    patches.push({ from, to, insert });
  }
  if (blocked) {
    notify(protectedEdit);
    return [];
  }
  if (skipped) notify(unsupportedEdit);
  if (!patches.length) return tr;
  const changes = import_state.ChangeSet.of(patches, tr.newDoc.length);
  const selection = import_state.EditorSelection.create(tr.newSelection.ranges.map((range) => range.empty ? import_state.EditorSelection.cursor(changes.mapPos(range.head, cursorBias.get(range.head) ?? -1), range.assoc) : range.map(changes)), tr.newSelection.mainIndex);
  return [tr, { changes, selection, sequential: true }];
}

// src/reading.js
var blockTags = new Set("ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DETAILS DIV DL DT FIGCAPTION FIGURE FOOTER H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P SECTION SUMMARY TABLE TBODY TD TH THEAD TR UL".split(" "));
var skippedTags = /* @__PURE__ */ new Set(["PRE", "SCRIPT", "STYLE", "TEXTAREA", "SVG", "MATH"]);
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
    if (text) runs.push({ nodes, excluded, text });
    nodes = [];
    excluded = [];
    text = "";
  }
  function visit(node, code = false) {
    if (node.nodeType === 3 && node.data.length) {
      const from = text.length;
      text += node.data;
      nodes.push({ node, from, to: text.length });
      if (code) excluded.push({ from, to: text.length });
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
  const tag = { addition: "ins", deletion: "del", anchor: "mark" }[role] || "span";
  const span = document.createElement(tag);
  span.className = `har-annotation har-${role}`;
  if (color) span.style.setProperty("--har-color", color);
  return span;
}
function applyRun(document, { nodes, excluded, text }, renderColors, bindComment) {
  const tokens = scan(text, excluded);
  const comments = anchoredComments(tokens);
  const markers = /* @__PURE__ */ new Map();
  const anchors = /* @__PURE__ */ new Map();
  function boundary(pos, end) {
    let low = 0, high = nodes.length - 1;
    while (low < high) {
      const mid = low + high >>> 1;
      if (pos < nodes[mid].to || end && pos === nodes[mid].to) high = mid;
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
    const { kind, from, to, bodyFrom, bodyTo, split } = token;
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
  for (const { token, anchor } of comments) {
    bindComment?.(markers.get(token), anchors.get(anchor), text.slice(token.bodyFrom, token.bodyTo));
  }
}
function renderReading(root, renderColors, bindComment) {
  if (root.closest("pre, code, .har-annotation") || !/\{|~=/.test(root.textContent)) return;
  recoverDelimiters(root);
  for (const run of collectRuns(root)) applyRun(root.ownerDocument, run, renderColors, bindComment);
}

// src/main.js
var ColorPicker = class extends import_obsidian5.FuzzySuggestModal {
  constructor(app, apply) {
    super(app);
    this.apply = apply;
    this.setPlaceholder("Choose a highlight color");
  }
  getItems() {
    return colors;
  }
  getItemText(color) {
    return color;
  }
  onChooseItem(color) {
    this.apply(color);
  }
};
var ReviewSettings = class extends import_obsidian5.PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    new import_obsidian5.Setting(this.containerEl).setName("Floating selection toolbar").setDesc("Show highlight colors and comment actions beside selected text in Editing view.").addToggle((toggle) => toggle.setValue(this.plugin.settings.selectionToolbar).onChange((selectionToolbar2) => this.plugin.updateSettings({ selectionToolbar: selectionToolbar2 })));
    new import_obsidian5.Setting(this.containerEl).setName("Toolbar colors").setDesc("Choose which highlight colors appear when you select text.");
    const palette = this.containerEl.createDiv({ cls: "har-color-settings", attr: { role: "group", "aria-label": "Toolbar colors" } });
    for (const color of colors) {
      const choice = palette.createEl("label", { cls: "har-color-choice" });
      const input = choice.createEl("input", { attr: { type: "checkbox" } });
      input.checked = this.plugin.settings.toolbarColors.includes(color);
      const swatch = choice.createSpan({ cls: "har-color-dot", attr: { "aria-hidden": "true" } });
      swatch.style.setProperty("--har-swatch", colorValue(color));
      choice.createSpan({ text: color[0].toUpperCase() + color.slice(1) });
      input.addEventListener("change", () => {
        const selected = this.plugin.settings.toolbarColors;
        const toolbarColors = colors.filter((item) => item === color ? input.checked : selected.includes(item));
        this.plugin.updateSettings({ toolbarColors });
      });
    }
  }
};
function selectionLine(editor) {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  if (from.line !== to.line) return null;
  const line = editorLine(editor, from.line);
  if (line.ctx.block) return null;
  return { from, to, ...line };
}
function commentAt(line) {
  if (!line) return null;
  const found = annotationAt(line, (token) => token.kind === "comment" || token.kind === "anchor");
  if (!found) return null;
  return anchoredComments(line.tokens).find(({ token, anchor }) => token === found || anchor === found);
}
function annotationAt(line, predicate) {
  if (!line) return null;
  const { tokens, from, to } = line;
  return tokens.find((token) => predicate(token) && overlaps(token, from.ch, to.ch)) || tokens.find((token) => predicate(token) && (token.from === from.ch || token.to === from.ch));
}
function replaceToken(editor, line, token, replacement, from = token.from) {
  editor.replaceRange(replacement, { line: line.from.line, ch: from }, { line: line.from.line, ch: token.to });
  editor.setCursor({ line: line.from.line, ch: from + replacement.length });
}
var HighlightsAndReview = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "tracking", /* @__PURE__ */ new Set());
    __publicField(this, "buttons", /* @__PURE__ */ new Map());
    __publicField(this, "popovers", /* @__PURE__ */ new Map());
  }
  async onload() {
    const saved = await this.loadData();
    const enabled = saved?.toolbarColors;
    this.settings = {
      selectionToolbar: saved?.selectionToolbar ?? true,
      toolbarColors: Array.isArray(enabled) ? colors.filter((color) => enabled.includes(color)) : [...colors]
    };
    this.addSettingTab(new ReviewSettings(this));
    this.registerView(commentsViewType, (leaf) => new CommentsView(leaf, this));
    this.addRibbonIcon("message-square", "Show comments", () => this.openComments());
    this.addCommand({ id: "show-comments", name: "Show comments sidebar", callback: () => this.openComments() });
    this.registerEditorExtension(previewExtension(this, (marker) => (0, import_obsidian5.setIcon)(marker, "message-square")));
    this.registerEditorExtension(selectionToolbar(this));
    this.registerEditorExtension(import_state2.EditorState.transactionFilter.of((tr) => {
      const file = tr.startState.field(import_obsidian5.editorInfoField, false)?.file;
      if (!this.tracking.has(file)) return tr;
      return trackTransaction(tr, { context: lineContext, notify: (message) => this.trackingNotice(message) });
    }));
    this.registerMarkdownPostProcessor((el) => renderReading(
      el,
      !this.fastColorsActive(),
      (marker, anchor, body) => this.bindReadingComment(marker, anchor, body)
    ), -900);
    const refreshViews = () => {
      this.refreshButtons();
      this.refreshCommentsView();
    };
    this.app.workspace.onLayoutReady(refreshViews);
    for (const event of ["layout-change", "active-leaf-change", "file-open"]) {
      this.registerEvent(this.app.workspace.on(event, refreshViews));
    }
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => this.refreshCommentsFor(info.file)));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.refreshCommentsFor(file)));
    this.registerEvent(this.app.vault.on("rename", (file) => this.refreshCommentsFor(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.tracking.delete(file)));
    this.addCommand({ id: "toggle-track-changes", name: "Toggle Track changes", checkCallback: (checking) => {
      const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
      if (!view?.file) return false;
      if (!checking) this.toggle(view.file);
      return true;
    } });
    this.addCommand({ id: "add-comment", name: "Add CriticMarkup comment", editorCallback: (editor, info) => this.addComment(editor, info) });
    this.addCommand({ id: "highlight", name: "Highlight selection\u2026", editorCheckCallback: (checking, editor, info) => {
      if (!editor.somethingSelected()) return false;
      if (!checking) this.highlight(editor, info);
      return true;
    } });
    this.reviewCommand("accept-change", "Accept tracked change", true);
    this.reviewCommand("reject-change", "Reject tracked change", false);
    this.commentCommand(
      "edit-comment",
      "Edit CriticMarkup comment",
      (editor, info, line, comment) => this.editComment(editor, info, line.from.line, line.text, comment)
    );
    this.commentCommand(
      "remove-comment",
      "Remove CriticMarkup comment",
      (editor, _info, line, comment) => this.removeComment(editor, line, comment)
    );
    this.annotationCommand(
      "remove-highlight",
      "Remove color highlight",
      (token) => token.kind === "color",
      (editor, line, token) => replaceToken(editor, line, token, line.text.slice(token.bodyFrom, token.bodyTo))
    );
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      const add = (label, icon, callback) => menu.addItem((item) => item.setTitle(label).setIcon(icon).onClick(callback));
      const line = selectionLine(editor);
      const changes = this.selectedChanges(editor);
      const comment = commentAt(line);
      const color = annotationAt(line, (token) => token.kind === "color");
      const snapshot = this.snapshot(editor, info);
      if (changes.length) {
        const label = editor.somethingSelected() ? "tracked changes in selection" : "tracked change";
        add(`Accept ${label}`, "check", () => snapshot(() => this.applyReview(editor, changes, true)));
        add(`Reject ${label}`, "x", () => snapshot(() => this.applyReview(editor, changes, false)));
      }
      if (comment) {
        add("Edit CriticMarkup comment", "message-square", () => snapshot(() => this.editComment(editor, info, line.from.line, line.text, comment)));
        add("Remove CriticMarkup comment", "trash-2", () => snapshot(() => this.removeComment(editor, line, comment)));
      }
      if (color) add("Remove color highlight", "eraser", () => snapshot(() => replaceToken(editor, line, color, line.text.slice(color.bodyFrom, color.bodyTo))));
      if (line && !changes.length && !comment && !color) {
        add("Add CriticMarkup comment", "message-square-plus", () => this.addComment(editor, info));
      }
      if (this.highlightSelection(editor, line)) add(
        color ? "Change highlight color\u2026" : "Highlight selection\u2026",
        "highlighter",
        () => this.highlight(editor, info)
      );
    }));
  }
  updateSettings(patch) {
    const settings = this.settings = { ...this.settings, ...patch };
    this.settingsWrite = (this.settingsWrite ?? Promise.resolve()).then(() => this.saveData(settings)).catch(() => {
      new import_obsidian5.Notice("Highlights & Review preferences could not be saved.");
    });
    return this.settingsWrite;
  }
  selectedChanges(editor) {
    if (!editor.somethingSelected()) {
      const line = selectionLine(editor);
      const token = annotationAt(line, isChange);
      return token ? [{ number: line.from.line + 1, text: line.text, token }] : [];
    }
    const state = editor.cm?.state;
    if (!state) return [];
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    return trackedInRange(state.doc, from, to, (line) => lineContext(state, line)).map(({ line, token }) => ({ number: line.number, text: line.text, token }));
  }
  applyReview(editor, matches, accept) {
    editor.transaction({ changes: matches.map(({ number, text, token }) => ({
      from: { line: number - 1, ch: token.from },
      to: { line: number - 1, ch: token.to },
      text: reviewText(text, token, accept)
    })) });
  }
  reviewCommand(id, name, accept) {
    this.addCommand({ id, name, editorCheckCallback: (checking, editor) => {
      const matches = this.selectedChanges(editor);
      if (!matches.length) return false;
      if (!checking) this.applyReview(editor, matches, accept);
      return true;
    } });
  }
  commentCommand(id, name, action) {
    this.addCommand({ id, name, editorCheckCallback: (checking, editor, info) => {
      const line = selectionLine(editor);
      const comment = commentAt(line);
      if (!comment) return false;
      if (!checking) action(editor, info, line, comment);
      return true;
    } });
  }
  fastColorsActive() {
    return Boolean(this.app.plugins?.getPlugin?.("fast-text-color"));
  }
  annotationCommand(id, name, predicate, action) {
    this.addCommand({ id, name, editorCheckCallback: (checking, editor, info) => {
      const line = selectionLine(editor);
      const token = annotationAt(line, predicate);
      if (!token) return false;
      if (!checking) action(editor, line, token, info);
      return true;
    } });
  }
  snapshot(editor, info) {
    const file = info.file;
    const read = () => editor.cm?.state.doc ?? editor.getValue();
    const original = read();
    return (action) => {
      if (this.unloaded || info.file !== file || read() !== original || info instanceof import_obsidian5.MarkdownView && info.getMode() !== "source") {
        new import_obsidian5.Notice("The note or editor changed. Try again.");
        return false;
      }
      action();
      return true;
    };
  }
  selectedText(editor, line = selectionLine(editor)) {
    if (line && editor.listSelections().length === 1) {
      const { from, to, text, ctx, tokens } = line;
      const value = text.slice(from.ch, to.ch);
      const escaped2 = /(?:^|[^\\])(?:\\\\)*\\$/.test(text.slice(0, from.ch));
      if (!escaped2 && canWrap(value) && !tokens.some((token) => overlaps(token, from.ch, to.ch)) && !ctx.excluded.some((range) => overlaps(range, from.ch, to.ch))) {
        return { from, to, value };
      }
    }
    return null;
  }
  highlightSelection(editor, line = selectionLine(editor)) {
    if (!line || !editor.somethingSelected() || editor.listSelections().length !== 1) return null;
    const { from, to, text, tokens } = line;
    const token = tokens.find((token2) => token2.kind === "color" && token2.from <= from.ch && token2.to >= to.ch);
    if (token) return {
      from: { ...from, ch: token.from },
      to: { ...to, ch: token.to },
      value: text.slice(token.bodyFrom, token.bodyTo),
      color: token.color
    };
    const selection = this.selectedText(editor, line);
    return selection?.value.trim() ? selection : null;
  }
  highlight(editor, info) {
    const selection = this.highlightSelection(editor);
    if (!selection) {
      new import_obsidian5.Notice("Select single-line prose or an existing color highlight.");
      return;
    }
    const apply = this.snapshot(editor, info);
    new ColorPicker(this.app, (color) => apply(() => this.setHighlight(editor, selection, color))).open();
  }
  setHighlight(editor, { from, to, value }, color, select = false) {
    const prefix = color ? `~={${color}}` : "";
    const suffix = color ? "=~" : "";
    editor.replaceRange(prefix + value + suffix, from, to);
    if (select) {
      const ch = from.ch + prefix.length;
      editor.setSelection({ ...from, ch }, { ...from, ch: ch + value.length });
    }
  }
  toolbarOptions(view) {
    const info = view.state.field(import_obsidian5.editorInfoField, false);
    const editor = info?.editor;
    if (!info?.file || !editor || editor.cm !== view) return null;
    const line = selectionLine(editor);
    if (!line) return null;
    const highlight = this.highlightSelection(editor, line);
    const selection = this.selectedText(editor, line);
    if (!highlight && !selection?.value.trim()) return null;
    const apply = this.snapshot(editor, info);
    return {
      color: highlight?.color,
      applyColor: highlight && ((color) => {
        if (color !== highlight.color) apply(() => this.setHighlight(editor, highlight, color, true));
      }),
      removeColor: highlight?.color && (() => apply(() => this.setHighlight(editor, highlight, null, true))),
      comment: selection?.value.trim() && (() => this.addComment(editor, info, selection))
    };
  }
  addComment(editor, info, selection = this.selectedText(editor)) {
    if (!selection) {
      new import_obsidian5.Notice("Use a single-line prose selection or cursor outside existing annotations and code.");
      return;
    }
    const { from, to, value } = selection;
    const apply = this.snapshot(editor, info);
    const anchor = value ? `{==${value}==}` : "";
    const save = (text) => apply(() => {
      editor.replaceRange(`${anchor}{>>${text}<<}`, from, to);
      editor.setCursor({ ...from, ch: from.ch + anchor.length + text.length + 6 });
    });
    const details = this.editorCommentDetails(editor, from, to, { save });
    this.popover(details.owner.dom.ownerDocument).show(details, { edit: true });
  }
  editorCommentDetails(editor, from, to, details) {
    const view = editor.cm;
    const start = editor.posToOffset(from);
    const end = editor.posToOffset(to);
    return {
      owner: view,
      focus: () => editor.focus(),
      rect: () => editorRect(view, start, end) ?? view.dom.getBoundingClientRect(),
      ...details
    };
  }
  existingCommentDetails(editor, info, number, text, comment) {
    const { token, anchor } = comment;
    const apply = this.snapshot(editor, info);
    const from = { line: number, ch: anchor?.bodyFrom ?? token.from };
    const to = { line: number, ch: anchor?.bodyTo ?? token.from };
    return this.editorCommentDetails(editor, from, to, {
      id: editor.posToOffset({ line: number, ch: token.from }),
      text: text.slice(token.bodyFrom, token.bodyTo),
      save: (value) => apply(() => replaceToken(editor, { from }, token, `{>>${value}<<}`)),
      remove: () => apply(() => this.removeComment(editor, { from, text }, comment))
    });
  }
  editComment(editor, info, number, text, comment) {
    const details = this.existingCommentDetails(editor, info, number, text, comment);
    this.popover(details.owner.dom.ownerDocument).show(details, { edit: true });
  }
  removeComment(editor, line, { token, anchor }) {
    replaceToken(editor, line, token, anchor ? line.text.slice(anchor.bodyFrom, anchor.bodyTo) : "", anchor?.from ?? token.from);
  }
  popover(document) {
    if (!this.popovers.has(document)) this.popovers.set(document, new CommentPopover(document));
    return this.popovers.get(document);
  }
  showEditorComment(view, trigger, pin = false) {
    const info = view.state.field(import_obsidian5.editorInfoField, false);
    if (this.unloaded || !info?.editor || info.editor.cm !== view) return;
    const position = Number(trigger.dataset.harComment);
    const { number, from, text } = view.state.doc.lineAt(position);
    const { tokens } = editorLine(info.editor, number - 1);
    const comment = anchoredComments(tokens).find(({ token }) => from + token.from === position);
    if (!comment) return;
    const details = this.existingCommentDetails(info.editor, info, number - 1, text, comment);
    this.popover(trigger.ownerDocument).show({
      ...details,
      trigger,
      rect: () => trigger.isConnected ? trigger.getBoundingClientRect() : details.rect()
    }, { pin });
  }
  deferCommentClose(view) {
    const popover = this.popovers.get(view.dom.ownerDocument);
    if (popover?.current?.owner === view) popover.deferClose();
  }
  editorCommentChanged(view) {
    const popover = this.popovers.get(view.dom.ownerDocument);
    if (popover?.current?.owner === view && !popover.pinned) popover.close();
  }
  bindReadingComment(marker, anchor, text) {
    (0, import_obsidian5.setIcon)(marker, "message-square");
    anchor?.classList.add("har-comment-anchor");
    const show = (trigger, pin = false) => {
      if (this.unloaded) return;
      this.popover(marker.ownerDocument).show({
        owner: marker,
        id: marker,
        text,
        trigger,
        rect: () => trigger.isConnected ? trigger.getBoundingClientRect() : null
      }, { pin });
    };
    for (const trigger of [marker, anchor].filter(Boolean)) {
      trigger.addEventListener("pointerenter", (event) => {
        if (!event.buttons) show(trigger);
      });
      trigger.addEventListener("pointerleave", () => {
        const popover = this.popovers.get(marker.ownerDocument);
        if (popover?.current?.owner === marker) popover.deferClose();
      });
    }
    marker.addEventListener("click", () => show(marker, true));
  }
  openComments() {
    this.refreshCommentsView();
    return this.app.workspace.ensureSideLeaf(commentsViewType, "right", { active: false });
  }
  refreshCommentsView() {
    if (this.unloaded) return;
    const active = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (active) this.reviewView = active;
    if (!this.reviewView?.containerEl.isConnected) this.reviewView = null;
    for (const { view } of this.app.workspace.getLeavesOfType(commentsViewType)) view.refresh?.();
  }
  refreshCommentsFor(file) {
    if (file !== this.reviewView?.file) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshCommentsView(), 140);
  }
  async jumpToComment(view, file, { number, text, token, anchor }) {
    const leaf = view.leaf;
    if (view.file !== file || !view.containerEl.isConnected) return;
    if (view.getMode() !== "source") {
      const state = leaf.getViewState();
      await leaf.setViewState({ ...state, state: { ...state.state, mode: "source" } });
    }
    const target = leaf.view;
    const editor = target.editor;
    if (this.unloaded || target.file !== file || !editor) return;
    if (number >= editor.lineCount() || editor.getLine(number) !== text) {
      this.refreshCommentsView();
      new import_obsidian5.Notice("The note changed. Select the comment again.");
      return;
    }
    const start = { line: number, ch: anchor?.bodyFrom ?? token.from };
    editor.setCursor(start);
    editor.scrollIntoView({ from: start, to: start }, true);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const details = this.existingCommentDetails(editor, target, number, text, { token, anchor });
    const window = details.owner.dom.ownerDocument.defaultView;
    window.requestAnimationFrame(() => {
      if (!this.unloaded && target.file === file && editor.getLine(number) === text) {
        this.popover(window.document).show(details, { pin: true });
      }
    });
  }
  toggle(file) {
    if (this.tracking.has(file)) this.tracking.delete(file);
    else this.tracking.add(file);
    this.refreshButtons();
    new import_obsidian5.Notice(`Track changes ${this.tracking.has(file) ? "on" : "off"} for ${file.basename}.`);
  }
  refreshButtons() {
    if (this.unloaded) return;
    const current = /* @__PURE__ */ new Set();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof import_obsidian5.MarkdownView)) return;
      current.add(view);
      let button = this.buttons.get(view);
      if (!button) {
        button = view.addAction("git-compare", "Track changes", () => {
          if (view.file) this.toggle(view.file);
        });
        this.buttons.set(view, button);
        button.classList.add("har-track-button");
      }
      const mode = view.modeButtonEl;
      if (mode?.parentElement === button.parentElement && button.nextElementSibling !== mode) mode.before(button);
      const active = this.tracking.has(view.file);
      button.hidden = !view.file;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      (0, import_obsidian5.setTooltip)(button, active ? "Track changes (on)" : "Track changes (off)");
    });
    for (const [view, button] of this.buttons) {
      if (!current.has(view)) {
        button.remove();
        this.buttons.delete(view);
      }
    }
  }
  trackingNotice(message) {
    const now = Date.now();
    if (this.lastNotice?.message === message && now - this.lastNotice.time < 2500) return;
    this.lastNotice = { message, time: now };
    queueMicrotask(() => {
      if (!this.unloaded) new import_obsidian5.Notice(message);
    });
  }
  onunload() {
    this.unloaded = true;
    clearTimeout(this.refreshTimer);
    for (const popover of this.popovers.values()) popover.destroy();
    this.popovers.clear();
    for (const button of this.buttons.values()) button.remove();
    this.buttons.clear();
    this.tracking.clear();
  }
};
