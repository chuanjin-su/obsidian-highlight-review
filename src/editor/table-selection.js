import { EditorView } from "@codemirror/view";

export const selectedTableSelector = ".cm-table-widget.has-selection";

export function selectedTable(view) {
  const element = view?.contentDOM.querySelector(selectedTableSelector);
  if (!element) return null;

  // Obsidian can close the cell editor while keeping its native rectangle selected.
  // The outer editor's block decoration still owns the cells and their source offsets.
  for (const decorations of view.state.facet(EditorView.decorations)) {
    if (typeof decorations === "function") continue;
    let table;
    decorations.between(view.viewport.from, view.viewport.to, (_from, _to, decoration) => {
      const widget = decoration.spec.widget;
      if (widget?.containerEl === element && widget.selectedCells?.length) {
        table = widget;
        return false;
      }
    });
    if (table) return table;
  }
  return null;
}

export function selectedCellsRect(table, view) {
  const first = table.selectedCells[0]?.el.getBoundingClientRect();
  const last = table.selectedCells.at(-1)?.el.getBoundingClientRect();
  if (!first || !last) return null;
  const viewport = view.scrollDOM.getBoundingClientRect();
  const widget = table.containerEl.getBoundingClientRect();
  const left = Math.max(Math.min(first.left, last.left), widget.left, viewport.left);
  const right = Math.min(Math.max(first.right, last.right), widget.right, viewport.right);
  const top = Math.max(first.top, viewport.top);
  const bottom = Math.min(last.bottom, viewport.bottom);
  return left < right && top < bottom ? {left, right, top, bottom} : null;
}
