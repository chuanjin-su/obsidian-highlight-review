import { setIcon } from "obsidian";
import { placeFloating } from "../dom.js";
import { canWrap } from "../markup.js";

export class CommentPopover {
  constructor(document) {
    this.document = document;
    this.window = document.defaultView;
    this.panel = document.createElement("div");
    this.panel.className = "har-comment-popover";
    this.panel.setAttribute("role", "dialog");

    this.heading = this.panel.createDiv({cls: "har-popover-heading"});
    this.title = this.heading.createSpan();
    this.actions = this.heading.createDiv({cls: "har-popover-actions"});
    const action = (icon, label, onClick) => {
      const button = this.actions.createEl("button", {
        cls: "clickable-icon",
        attr: {type: "button", "aria-label": label, title: label}
      });
      setIcon(button, icon);
      button.addEventListener("click", onClick);
      return button;
    };
    this.editButton = action("pencil", "Edit comment", () => this.edit());
    this.deleteButton = action("trash-2", "Delete comment", () => this.remove());
    this.deleteButton.classList.add("har-delete-comment");
    this.submitButton = action("check", "Save comment", () => this.submit());
    this.submitButton.classList.add("har-submit-comment");
    this.closeButton = action("x", "Close comment", () => this.close(true));
    this.input = this.panel.createEl("textarea", {attr: {"aria-label": "Comment", rows: "1"}});
    this.input.placeholder = "Write a comment…";
    this.error = this.panel.createDiv({cls: "har-comment-error", attr: {role: "alert"}});
    this.input.addEventListener("input", () => {
      this.error.hidden = true;
      this.resizeInput();
      this.place();
    });
    this.panel.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing || event.target !== this.input || this.input.readOnly) return;
      event.preventDefault();
      this.submit();
    });
    this.panel.addEventListener("pointerenter", () => this.cancelClose());
    this.panel.addEventListener("pointerleave", () => this.deferClose());

    this.outside = event => {
      if (this.panel.contains(event.target) || this.current?.trigger?.contains(event.target)) return;
      this.close();
    };
    this.escape = event => {
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

  show(details, {pin = false, edit = false} = {}) {
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
    if (edit) this.input.focus({preventScroll: true});
    else if (pin) this.focusAction();
  }

  render(edit) {
    const {text, save, remove} = this.current;
    const title = edit ? (text == null ? "Add comment" : "Edit comment") : "Comment";
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
    (this.editButton.hidden ? this.closeButton : this.editButton).focus({preventScroll: true});
  }

  edit() {
    this.pinned = true;
    this.render(true);
    this.place();
    this.input.focus({preventScroll: true});
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
    const {focus, trigger} = this.current;
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
      else if (trigger?.isConnected) trigger.focus({preventScroll: true});
    }
  }

  destroy() {
    this.close();
    this.destroyed = true;
  }
}
