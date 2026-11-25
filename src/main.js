import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { editorInfoField, FuzzySuggestModal, MarkdownView, Menu, Notice, Plugin, PluginSettingTab, Setting, setIcon, setTooltip } from "obsidian";
import { CommentPopover } from "./comments/popover.js";
import { CommentsView, commentsViewType } from "./comments/sidebar.js";
import { colorPart, highlightCellParts, highlightParts, highlightTransaction } from "./editor/highlights.js";
import { editorLine, editorRect, lineContext, previewExtension } from "./editor/preview.js";
import { selectionToolbar } from "./editor/selection-toolbar.js";
import { selectedCellsRect, selectedTable } from "./editor/table-selection.js";
import { trackTransaction } from "./editor/tracking.js";
import { anchoredComments, canWrap, colors, defaultPaletteColor, isChange, overlaps, paletteProperty, reviewText, trackedInRange } from "./markup.js";
import { renderReading } from "./reading.js";

class ColorPicker extends FuzzySuggestModal {
  constructor(app, apply) {
    super(app);
    this.apply = apply;
    this.setPlaceholder("Choose a highlight color");
  }
  getItems() { return colors; }
  getItemText(color) { return color; }
  onChooseItem(color) { this.apply(color); }
}

function pickerColor(sample, context, color) {
  sample.style.color = defaultPaletteColor(color);
  context.fillStyle = sample.ownerDocument.defaultView.getComputedStyle(sample).color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return "#" + [red, green, blue].map(channel => channel.toString(16).padStart(2, "0")).join("");
}

class ReviewSettings extends PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Floating selection toolbar")
      .setDesc("Show highlight colors and comment actions beside selected text in Editing view.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.selectionToolbar)
        .onChange(selectionToolbar => this.plugin.updateSettings({selectionToolbar})));

    const refreshColors = [];
    let resetPalette;
    new Setting(this.containerEl)
      .setName("Highlight colors")
      .setDesc("Change the color of highlights and their swatches. Use each switch to show that color in the floating selection toolbar.")
      .addButton(button => {
        resetPalette = button.setButtonText("Reset palette").onClick(() => {
          this.plugin.updateSettings({colorOverrides: {}});
          for (const refresh of refreshColors) refresh();
          resetPalette.setDisabled(true);
        });
      });
    const hasOverrides = () => Object.keys(this.plugin.settings.colorOverrides).length > 0;
    resetPalette.setDisabled(!hasOverrides());

    const sample = this.containerEl.createEl("canvas", {attr: {hidden: "", width: "1", height: "1"}});
    const context = sample.getContext("2d", {willReadFrequently: true});
    context.globalCompositeOperation = "copy";
    for (const color of colors) {
      const row = new Setting(this.containerEl).setName(color[0].toUpperCase() + color.slice(1));
      const label = `Change ${color} highlight color`;
      const picker = row.controlEl.createEl("input", {attr: {type: "color", "aria-label": label}});
      setTooltip(picker, label);
      let reset;
      const refresh = () => {
        const value = this.plugin.settings.colorOverrides[color];
        picker.value = value ?? pickerColor(sample, context, color);
        reset.setDisabled(!value);
      };
      const setColor = value => {
        const colorOverrides = {...this.plugin.settings.colorOverrides};
        if (value) colorOverrides[color] = value;
        else delete colorOverrides[color];
        this.plugin.updateSettings({colorOverrides});
        refresh();
        resetPalette.setDisabled(!hasOverrides());
      };
      row.addButton(button => {
        reset = button.setButtonText("Reset").setTooltip(`Reset ${color} to default`).onClick(() => setColor(null));
        reset.buttonEl.setAttribute("aria-label", `Reset ${color} to default`);
      });
      row.addToggle(toggle => {
        const description = `Show ${color} in the floating selection toolbar`;
        toggle.setTooltip(description).setValue(this.plugin.settings.toolbarColors.includes(color))
          .onChange(visible => {
            const selected = this.plugin.settings.toolbarColors;
            const toolbarColors = colors.filter(item => item === color ? visible : selected.includes(item));
            this.plugin.updateSettings({toolbarColors});
          });
        toggle.toggleEl.setAttribute("aria-label", description);
      });
      picker.addEventListener("change", () => setColor(picker.value));
      refreshColors.push(refresh);
      refresh();
    }
  }
}

function selectionLine(editor) {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  if (from.line !== to.line) return null;
  const line = editorLine(editor, from.line);
  if (line.ctx.block) return null;
  return {from, to, ...line};
}

function commentAt(line) {
  if (!line) return null;
  const found = annotationAt(line, token => token.kind === "comment" || token.kind === "anchor");
  if (!found) return null;
  return anchoredComments(line.tokens).find(({token, anchor}) => token === found || anchor === found);
}

function annotationAt(line, predicate) {
  if (!line) return null;
  const {tokens, from, to} = line;
  return tokens.find(token => predicate(token) && overlaps(token, from.ch, to.ch)) ||
    tokens.find(token => predicate(token) && (token.from === from.ch || token.to === from.ch));
}

function replaceToken(editor, line, token, replacement, from = token.from) {
  editor.replaceRange(replacement, {line: line.from.line, ch: from}, {line: line.from.line, ch: token.to});
  editor.setCursor({line: line.from.line, ch: from + replacement.length});
}

export default class HighlightsAndReview extends Plugin {
  tracking = new Set();
  buttons = new Map();
  popovers = new Map();
  paletteDocuments = new Set();

  async onload() {
    const saved = await this.loadData();
    const enabled = saved?.toolbarColors;
    const colorOverrides = {};
    for (const color of colors) {
      const value = saved?.colorOverrides?.[color];
      if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) colorOverrides[color] = value.toLowerCase();
    }
    this.settings = {
      selectionToolbar: saved?.selectionToolbar ?? true,
      toolbarColors: Array.isArray(enabled) ? colors.filter(color => enabled.includes(color)) : [...colors],
      colorOverrides
    };
    this.paletteDocuments.add(document);
    this.applyPalette(document);
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => {
      this.paletteDocuments.add(win.document);
      this.applyPalette(win.document);
    }));
    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, win) => this.paletteDocuments.delete(win.document)));
    this.addSettingTab(new ReviewSettings(this));
    this.registerView(commentsViewType, leaf => new CommentsView(leaf, this));
    this.addRibbonIcon("message-square", "Show comments", () => this.openComments());
    this.addCommand({id: "show-comments", name: "Show comments sidebar", callback: () => this.openComments()});
    this.registerEditorExtension(previewExtension(this, marker => setIcon(marker, "message-square")));
    this.registerEditorExtension(selectionToolbar(this));
    this.registerEditorExtension(EditorState.transactionFilter.of(tr => {
      const file = tr.startState.field(editorInfoField, false)?.file;
      if (!this.tracking.has(file)) return tr;
      return trackTransaction(tr, {context: lineContext, notify: message => this.trackingNotice(message)});
    }));
    this.registerMarkdownPostProcessor(el => renderReading(el, !this.fastColorsActive(),
      (marker, anchor, body) => this.bindReadingComment(marker, anchor, body)), -900);
    const refreshViews = () => {
      this.refreshButtons();
      this.refreshCommentsView();
    };
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves(leaf => {
        const doc = leaf.view.containerEl.ownerDocument;
        this.paletteDocuments.add(doc);
        this.applyPalette(doc);
      });
      refreshViews();
    });
    for (const event of ["layout-change", "active-leaf-change", "file-open"]) {
      this.registerEvent(this.app.workspace.on(event, refreshViews));
    }
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => this.refreshCommentsFor(info.file)));
    this.registerEvent(this.app.metadataCache.on("changed", file => this.refreshCommentsFor(file)));
    this.registerEvent(this.app.vault.on("rename", file => this.refreshCommentsFor(file)));
    this.registerEvent(this.app.vault.on("delete", file => this.tracking.delete(file)));

    this.addCommand({id: "toggle-track-changes", name: "Toggle Track changes", checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return false;
      if (!checking) this.toggle(view.file);
      return true;
    }});
    this.addCommand({id: "add-comment", name: "Add CriticMarkup comment", editorCallback: (editor, info) => this.addComment(editor, info)});
    this.addCommand({id: "highlight", name: "Highlight selection…", editorCheckCallback: (checking, editor, info) => {
      const table = selectedTable(editor.cm);
      const parts = this.highlightSelection(editor, table);
      if (!parts.length) return false;
      if (!checking) this.highlight(editor, info, parts, table);
      return true;
    }});
    this.reviewCommand("accept-change", "Accept tracked change", true);
    this.reviewCommand("reject-change", "Reject tracked change", false);
    this.commentCommand("edit-comment", "Edit CriticMarkup comment",
      (editor, info, line, comment) => this.editComment(editor, info, line.from.line, line.text, comment));
    this.commentCommand("remove-comment", "Remove CriticMarkup comment",
      (editor, _info, line, comment) => this.removeComment(editor, line, comment));
    this.addCommand({id: "remove-highlight", name: "Remove color highlight", editorCheckCallback: (checking, editor) => {
      const table = selectedTable(editor.cm);
      const parts = this.removableHighlights(editor, this.highlightSelection(editor, table), table);
      if (!parts.length) return false;
      if (!checking) this.setHighlight(editor, parts, null, false, table);
      return true;
    }});

    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      const add = (label, icon, callback) => menu.addItem(item => item.setTitle(label).setIcon(icon).onClick(callback));
      const line = selectionLine(editor);
      const changes = this.selectedChanges(editor);
      const comment = commentAt(line);
      const snapshot = this.snapshot(editor, info);
      // The table cell's context menu supplies a cell-local editor.
      const highlightEditor = info.editor ?? editor;
      const table = selectedTable(highlightEditor.cm);
      if (changes.length) {
        const label = editor.somethingSelected() ? "tracked changes in selection" : "tracked change";
        add(`Accept ${label}`, "check", () => snapshot(() => this.applyReview(editor, changes, true)));
        add(`Reject ${label}`, "x", () => snapshot(() => this.applyReview(editor, changes, false)));
      }
      if (comment) {
        add("Edit CriticMarkup comment", "message-square", () => snapshot(() =>
          this.editComment(editor, info, line.from.line, line.text, comment)));
        add("Remove CriticMarkup comment", "trash-2", () => snapshot(() => this.removeComment(editor, line, comment)));
      }
      const hasHighlight = this.addHighlightMenuItems(menu, highlightEditor, info, table);
      if (line && !changes.length && !comment && !hasHighlight) {
        add("Add CriticMarkup comment", "message-square-plus", () => this.addComment(editor, info));
      }
    }));
  }

  updateSettings(patch) {
    const settings = this.settings = {...this.settings, ...patch};
    if (patch.colorOverrides) {
      for (const doc of this.paletteDocuments) this.applyPalette(doc);
    }
    this.settingsWrite = (this.settingsWrite ?? Promise.resolve()).then(() => this.saveData(settings)).catch(() => {
      new Notice("Highlights & Review preferences could not be saved.");
    });
    return this.settingsWrite;
  }

  applyPalette(doc, overrides = this.settings.colorOverrides) {
    for (const color of colors) {
      doc.documentElement.style.setProperty(paletteProperty(color), overrides[color] ?? "");
    }
  }

  selectedChanges(editor) {
    if (!editor.somethingSelected()) {
      const line = selectionLine(editor);
      const token = annotationAt(line, isChange);
      return token ? [{number: line.from.line + 1, text: line.text, token}] : [];
    }
    const state = editor.cm?.state;
    if (!state) return [];
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    return trackedInRange(state.doc, from, to, line => lineContext(state, line))
      .map(({line, token}) => ({number: line.number, text: line.text, token}));
  }

  applyReview(editor, matches, accept) {
    editor.transaction({changes: matches.map(({number, text, token}) => ({
      from: {line: number - 1, ch: token.from},
      to: {line: number - 1, ch: token.to},
      text: reviewText(text, token, accept)
    }))});
  }

  reviewCommand(id, name, accept) {
    this.addCommand({id, name, editorCheckCallback: (checking, editor) => {
      const matches = this.selectedChanges(editor);
      if (!matches.length) return false;
      if (!checking) this.applyReview(editor, matches, accept);
      return true;
    }});
  }

  commentCommand(id, name, action) {
    this.addCommand({id, name, editorCheckCallback: (checking, editor, info) => {
      const line = selectionLine(editor);
      const comment = commentAt(line);
      if (!comment) return false;
      if (!checking) action(editor, info, line, comment);
      return true;
    }});
  }

  fastColorsActive() {
    // Obsidian has no public API to query another community plugin. When available,
    // defer to Fast Text Color so themes work and we don't double-hide its syntax.
    return Boolean(this.app.plugins?.getPlugin?.("fast-text-color"));
  }

  snapshot(editor, info) {
    const file = info.file;
    const read = () => editor.cm?.state.doc ?? editor.getValue();
    const original = read();
    return action => {
      if (this.unloaded || info.file !== file || read() !== original ||
          (info instanceof MarkdownView && info.getMode() !== "source")) {
        new Notice("The note or editor changed. Try again.");
        return false;
      }
      action();
      return true;
    };
  }

  selectedText(editor, line = selectionLine(editor)) {
    if (line && editor.listSelections().length === 1) {
      const {from, to, text, ctx, tokens} = line;
      const value = text.slice(from.ch, to.ch);
      const escaped = /(?:^|[^\\])(?:\\\\)*\\$/.test(text.slice(0, from.ch));
      if (!escaped && canWrap(value) && !tokens.some(token => overlaps(token, from.ch, to.ch)) &&
          !ctx.excluded.some(range => overlaps(range, from.ch, to.ch))) {
        return {from, to, value};
      }
    }
    return null;
  }

  highlightSelection(editor, table) {
    const state = editor.cm?.state;
    if (!state || state.readOnly) return [];
    if (table) {
      const tree = ensureSyntaxTree(state, table.end);
      return tree ? highlightCellParts(state.doc, table.selectedCells, line => lineContext(state, line, tree)) : [];
    }
    const {main, ranges} = state.selection;
    if (ranges.length !== 1 || main.empty) return [];
    const tree = ensureSyntaxTree(state, main.to);
    return (tree && highlightParts(state.doc, main.from, main.to, line => lineContext(state, line, tree))) ?? [];
  }

  removableHighlights(editor, parts, table) {
    if (editor.cm?.state.readOnly) return [];
    if (table || editor.somethingSelected()) return parts.every(part => part.color) ? parts : [];
    const line = selectionLine(editor);
    const token = annotationAt(line, token => token.kind === "color");
    return token ? [colorPart(line.from.line, line.text, token)] : [];
  }

  highlight(editor, info, parts, table) {
    const apply = this.snapshot(editor, info);
    new ColorPicker(this.app, color => apply(() => this.setHighlight(editor, parts, color, false, table))).open();
  }

  setHighlight(editor, parts, color, select, table) {
    const transaction = highlightTransaction(parts, color, select);
    if (table) transaction.selection = undefined;
    if (transaction.changes.length) editor.transaction(transaction);
  }

  addHighlightMenuItems(menu, editor, info, table) {
    const parts = this.highlightSelection(editor, table);
    const removable = this.removableHighlights(editor, parts, table);
    if (!parts.length && !removable.length) return false;
    const apply = this.snapshot(editor, info);
    if (removable.length) menu.addItem(item => item.setTitle("Remove color highlight").setIcon("eraser")
      .onClick(() => apply(() => this.setHighlight(editor, removable, null, false, table))));
    if (parts.length) menu.addItem(item => item.setTitle(removable.length ? "Change highlight color…" : "Highlight selection…")
      .setIcon("highlighter").onClick(() => apply(() => this.highlight(editor, info, parts, table))));
    return removable.length > 0;
  }

  tableHighlightMenu(view, event) {
    const info = view.state.field(editorInfoField, false);
    const editor = info?.editor;
    if (editor?.cm !== view) return;
    const cell = event.target.closest?.("td.is-selected, th.is-selected");
    if (!cell) return;
    const table = selectedTable(view);
    if (table?.selectedCells.some(item => item.el === cell)) {
      const menu = Menu.forEvent?.(event);
      if (menu) this.addHighlightMenuItems(menu, editor, info, table);
    }
  }

  toolbarOptions(view) {
    const info = view.state.field(editorInfoField, false);
    const editor = info?.editor;
    if (!info?.file || !editor || (info instanceof MarkdownView && info.getMode() !== "source")) return null;
    const table = selectedTable(editor.cm);
    const active = editor.activeCM ?? editor.cm;
    if (table) {
      const {ownerDocument} = view.dom;
      if (view !== editor.cm || (!active.hasFocus && !view.hasFocus &&
          (ownerDocument.activeElement !== ownerDocument.body || this.app.workspace.activeEditor !== info))) return null;
    } else if (view !== active || !view.hasFocus || view.state.selection.main.empty) return null;
    const parts = this.highlightSelection(editor, table);
    const selection = !table && editor.cm === view ? this.selectedText(editor) : null;
    if (!parts.length && !selection?.value.trim()) return null;
    const firstColor = parts[0]?.color;
    const currentColor = parts.every(part => part.color === firstColor) ? firstColor : undefined;
    const apply = this.snapshot(editor, info);
    return {
      color: currentColor,
      rect: table && (() => selectedCellsRect(table, view)),
      applyColor: parts.length > 0 && (color => {
        if (color !== currentColor) apply(() => this.setHighlight(editor, parts, color, true, table));
      }),
      removeColor: parts.length > 0 && parts.every(part => part.color) &&
        (() => apply(() => this.setHighlight(editor, parts, null, true, table))),
      comment: selection?.value.trim() && (() => this.addComment(editor, info, selection))
    };
  }

  addComment(editor, info, selection = this.selectedText(editor)) {
    if (!selection) {
      new Notice("Use a single-line prose selection or cursor outside existing annotations and code.");
      return;
    }
    const {from, to, value} = selection;
    const apply = this.snapshot(editor, info);
    const anchor = value ? `{==${value}==}` : "";
    const save = text => apply(() => {
      editor.replaceRange(`${anchor}{>>${text}<<}`, from, to);
      editor.setCursor({...from, ch: from.ch + anchor.length + text.length + 6});
    });
    const details = this.editorCommentDetails(editor, from, to, {save});
    this.popover(details.owner.dom.ownerDocument).show(details, {edit: true});
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
    const {token, anchor} = comment;
    const apply = this.snapshot(editor, info);
    const from = {line: number, ch: anchor?.bodyFrom ?? token.from};
    const to = {line: number, ch: anchor?.bodyTo ?? token.from};
    return this.editorCommentDetails(editor, from, to, {
      id: editor.posToOffset({line: number, ch: token.from}),
      text: text.slice(token.bodyFrom, token.bodyTo),
      save: value => apply(() => replaceToken(editor, {from}, token, `{>>${value}<<}`)),
      remove: () => apply(() => this.removeComment(editor, {from, text}, comment))
    });
  }

  editComment(editor, info, number, text, comment) {
    const details = this.existingCommentDetails(editor, info, number, text, comment);
    this.popover(details.owner.dom.ownerDocument).show(details, {edit: true});
  }

  removeComment(editor, line, {token, anchor}) {
    replaceToken(editor, line, token, anchor ? line.text.slice(anchor.bodyFrom, anchor.bodyTo) : "", anchor?.from ?? token.from);
  }

  popover(document) {
    if (!this.popovers.has(document)) this.popovers.set(document, new CommentPopover(document));
    return this.popovers.get(document);
  }

  showEditorComment(view, trigger, pin = false) {
    const info = view.state.field(editorInfoField, false);
    if (this.unloaded || !info?.editor || info.editor.cm !== view) return;
    const position = Number(trigger.dataset.harComment);
    const {number, from, text} = view.state.doc.lineAt(position);
    const {tokens} = editorLine(info.editor, number - 1);
    const comment = anchoredComments(tokens).find(({token}) => from + token.from === position);
    if (!comment) return;
    const details = this.existingCommentDetails(info.editor, info, number - 1, text, comment);
    this.popover(trigger.ownerDocument).show({...details, trigger,
      rect: () => trigger.isConnected ? trigger.getBoundingClientRect() : details.rect()
    }, {pin});
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
    setIcon(marker, "message-square");
    anchor?.classList.add("har-comment-anchor");
    const show = (trigger, pin = false) => {
      if (this.unloaded) return;
      this.popover(marker.ownerDocument).show({
        owner: marker,
        id: marker,
        text,
        trigger,
        rect: () => trigger.isConnected ? trigger.getBoundingClientRect() : null
      }, {pin});
    };
    for (const trigger of [marker, anchor].filter(Boolean)) {
      trigger.addEventListener("pointerenter", event => { if (!event.buttons) show(trigger); });
      trigger.addEventListener("pointerleave", () => {
        const popover = this.popovers.get(marker.ownerDocument);
        if (popover?.current?.owner === marker) popover.deferClose();
      });
    }
    marker.addEventListener("click", () => show(marker, true));
  }

  openComments() {
    this.refreshCommentsView();
    return this.app.workspace.ensureSideLeaf(commentsViewType, "right", {active: false});
  }

  refreshCommentsView() {
    if (this.unloaded) return;
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) this.reviewView = active;
    if (!this.reviewView?.containerEl.isConnected) this.reviewView = null;
    for (const {view} of this.app.workspace.getLeavesOfType(commentsViewType)) view.refresh?.();
  }

  refreshCommentsFor(file) {
    if (file !== this.reviewView?.file) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshCommentsView(), 140);
  }

  async jumpToComment(view, file, {number, text, token, anchor}) {
    const leaf = view.leaf;
    if (view.file !== file || !view.containerEl.isConnected) return;
    if (view.getMode() !== "source") {
      const state = leaf.getViewState();
      await leaf.setViewState({...state, state: {...state.state, mode: "source"}});
    }
    const target = leaf.view;
    const editor = target.editor;
    if (this.unloaded || target.file !== file || !editor) return;
    if (number >= editor.lineCount() || editor.getLine(number) !== text) {
      this.refreshCommentsView();
      new Notice("The note changed. Select the comment again.");
      return;
    }
    const start = {line: number, ch: anchor?.bodyFrom ?? token.from};
    editor.setCursor(start);
    editor.scrollIntoView({from: start, to: start}, true);
    this.app.workspace.setActiveLeaf(leaf, {focus: true});
    const details = this.existingCommentDetails(editor, target, number, text, {token, anchor});
    const window = details.owner.dom.ownerDocument.defaultView;
    window.requestAnimationFrame(() => {
      if (!this.unloaded && target.file === file && editor.getLine(number) === text) {
        this.popover(window.document).show(details, {pin: true});
      }
    });
  }
  toggle(file) {
    if (this.tracking.has(file)) this.tracking.delete(file);
    else this.tracking.add(file);
    this.refreshButtons();
    new Notice(`Track changes ${this.tracking.has(file) ? "on" : "off"} for ${file.basename}.`);
  }

  refreshButtons() {
    if (this.unloaded) return;
    const current = new Set();
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      current.add(view);
      let button = this.buttons.get(view);
      if (!button) {
        button = view.addAction("git-compare", "Track changes", () => { if (view.file) this.toggle(view.file); });
        this.buttons.set(view, button);
        button.classList.add("har-track-button");
      }
      // addAction normally prepends right beside the mode switch. Keep them
      // adjacent if the host exposes its mode button (optional private handle).
      const mode = view.modeButtonEl;
      if (mode?.parentElement === button.parentElement && button.nextElementSibling !== mode) mode.before(button);
      const active = this.tracking.has(view.file);
      button.hidden = !view.file;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      setTooltip(button, active ? "Track changes (on)" : "Track changes (off)");
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
    this.lastNotice = {message, time: now};
    queueMicrotask(() => { if (!this.unloaded) new Notice(message); });
  }

  onunload() {
    this.unloaded = true;
    for (const doc of this.paletteDocuments) this.applyPalette(doc, {});
    clearTimeout(this.refreshTimer);
    for (const popover of this.popovers.values()) popover.destroy();
    this.popovers.clear();
    for (const button of this.buttons.values()) button.remove();
    this.buttons.clear();
    this.tracking.clear();
  }
}
