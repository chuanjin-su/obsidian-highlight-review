import { ViewPlugin } from "@codemirror/view";
import { setIcon } from "obsidian";
import { placeFloating } from "../dom.js";
import { colors, colorValue } from "../markup.js";
import { editorRect } from "./preview.js";

export function selectionToolbar(plugin) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.document = view.dom.ownerDocument;
      this.window = this.document.defaultView;
      const panel = this.document.createElement("div");
      panel.className = "har-selection-toolbar";
      panel.setAttribute("role", "toolbar");
      panel.setAttribute("aria-label", "Selection actions");
      panel.addEventListener("pointerdown", event => event.preventDefault());
      const button = (parent, label, action, icon) => {
        const el = parent.createEl("button", {cls: "clickable-icon", attr: {type: "button", "aria-label": label, title: label}});
        if (icon) setIcon(el, icon);
        el.addEventListener("click", action);
        return el;
      };
      this.palette = panel.createDiv({cls: "har-highlight-palette", attr: {role: "group", "aria-label": "Highlight colors"}});
      this.swatches = colors.map(color => {
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
      this.startDrag = event => {
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
      this.key = event => { if (event.key === "Escape" && this.panel.isConnected) this.dismiss(); };
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
      const {view, panel} = this;
      const range = view.state.selection.main;
      const {selectionToolbar, toolbarColors} = plugin.settings;
      const options = !this.dragging && !this.dismissed && selectionToolbar &&
        view.hasFocus && !range.empty && plugin.toolbarOptions(view);
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
      const {view} = this;
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
