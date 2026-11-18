# Highlights & Review

An Obsidian plugin for color highlights, inline comments, and tracked edits. Annotations live in the note as Markdown, so they travel with the file.

## Install the beta

Requires Obsidian 1.7.2 or newer.

- **With BRAT.** Add `chuanjin-su/obsidian-highlight-review` as a beta plugin, then enable **Highlights & Review** in Community plugins.
- **Manually.** Download `main.js`, `manifest.json`, and `styles.css` from the [GitHub releases page](https://github.com/chuanjin-su/obsidian-highlight-review/releases). Place all three files in `.obsidian/plugins/highlights-and-review/` in your vault, restart Obsidian, and enable **Highlights & Review**.

## Review a note

- **Highlight text.** Select a single-line passage in Editing view and pick a color from the floating toolbar. Select text within an existing highlight to recolor it or remove it. In **Settings → Highlights & Review → Highlight colors**, change each color’s appearance in notes and the toolbar, or choose which swatches the toolbar shows. Use **Reset** for a single color or **Reset palette** for all colors. Highlight commands are also available in the command palette and editor menu.
- **Leave comments.** Select text and click the toolbar’s comment button, or run **Add CriticMarkup comment** to comment at the cursor. Type into the inline popover and press Enter or click the checkmark. Hover over marked text or a comment icon in Live Preview and Reading view. Click the icon to pin the popover. In Live Preview, use the pencil or trash icon to edit or delete a comment. Deleting a comment keeps the marked text and can be undone.
- **Browse comments.** Open **Show comments sidebar** from the ribbon or command palette. The sidebar lists comments in the current note. Click an entry to open its popover in the editor.
- **Track and review changes.** Click the compare icon beside the Reading/Editing switch or run **Toggle Track changes**. Tracking applies to the current note for the session. Right-click an individual proposal or select a range and use **Accept tracked changes in selection** or **Reject tracked changes in selection**. A single Undo reverses the entire review action.

## Markdown format

| Annotation | Stored as |
| --- | --- |
| Color highlight | `~={red}highlighted text=~` |
| Anchored comment | `{==selected text==}{>>comment<<}` |
| Standalone comment | `{>>comment<<}` |
| Addition | `{++new text++}` |
| Deletion | `{--old text--}` |
| Replacement | `{~~old text~>new text~~}` |

Source mode shows the raw syntax. When Fast Text Color is enabled, it handles color rendering. Annotation tools work on single-line prose. Turn off tracking for structural Markdown edits. Line breaks, code, YAML, and input-method composition are outside the supported tracking scope.

## Development

```sh
npm ci
npm test
npm run build
```

- `src/main.js` registers the plugin, settings, and commands.
- `src/editor/` contains Live Preview decorations, the selection toolbar, and the transaction filter for tracked edits.
- `src/comments/` contains the popover and sidebar.
- `src/markup.js` parses annotations, and `src/reading.js` renders them in Reading view.
- `tests/` covers parsing, tracked edits and undo, review ranges, and Reading view rendering.

The build produces `main.js` at the repository root beside `manifest.json` and `styles.css`. Obsidian loads those three files directly.
