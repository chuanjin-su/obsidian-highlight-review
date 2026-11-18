import { ItemView } from "obsidian";
import { editorLine } from "../editor/preview.js";
import { anchoredComments, scan } from "../markup.js";

export const commentsViewType = "har-comments";

export class CommentsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.generation = 0;
  }
  getViewType() { return commentsViewType; }
  getDisplayText() { return "Comments"; }
  getIcon() { return "message-square"; }

  async onOpen() {
    this.contentEl.addClass("har-comments-sidebar");
    this.heading = this.contentEl.createEl("h2");
    this.list = this.contentEl.createDiv({cls: "har-comments-list"});
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
    for (const {number, text, token, anchor} of entries) {
      const button = this.list.createEl("button", {cls: "har-sidebar-comment", attr: {type: "button"}});
      if (anchor) button.createSpan({cls: "har-comment-quote", text: text.slice(anchor.bodyFrom, anchor.bodyTo)});
      button.createSpan({cls: "har-comment-body", text: text.slice(token.bodyFrom, token.bodyTo)});
      button.createSpan({cls: "har-comment-location", text: `Line ${number + 1}`});
      button.addEventListener("click", () => this.plugin.jumpToComment(view, file, {number, text, token, anchor}));
    }
  }

  setMessage(text, view) {
    if (this.lastView === view && this.lastContent === text) return;
    this.lastView = view;
    this.lastContent = text;
    this.list.empty();
    this.list.createEl("p", {cls: "har-comments-empty", text});
  }

  fromEditor(editor) {
    const entries = [];
    for (let number = 0; number < editor.lineCount(); number++) {
      if (!editor.getLine(number).includes("{>>")) continue;
      const {text, tokens} = editorLine(editor, number);
      for (const comment of anchoredComments(tokens)) entries.push({number, text, ...comment});
    }
    return entries;
  }

  async fromFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = this.app.metadataCache.getFileCache(file)?.sections?.filter(section =>
      /^(code|yaml|math)$/.test(section.type)) ?? [];
    const entries = [];
    for (const [number, text] of source.split(/\r?\n/).entries()) {
      if (!text.includes("{>>") || blocks.some(block =>
        block.position.start.line <= number && number <= block.position.end.line)) continue;
      const inlineCode = [...text.matchAll(/(?<!`)(`+)(?!`)(.*?)\1(?!`)/g)];
      const excluded = inlineCode.map(match => ({from: match.index, to: match.index + match[0].length}));
      for (const comment of anchoredComments(scan(text, excluded))) entries.push({number, text, ...comment});
    }
    return entries;
  }

  async onClose() {
    this.generation++;
    this.list = null;
    this.lastContent = null;
    this.lastView = null;
  }
}
