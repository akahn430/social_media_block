# Social Block (Chrome Extension)

A minimal Manifest V3 extension for removing distractions and editing page elements on any site.

## What it does

- Works per-site (settings scoped by hostname).
- Renders a deep nested tree of page elements (scripts excluded) with smart labels and text-aware names for headings/paragraphs.
- Hovering a tree row highlights that element on the page.
- Compact checkboxes hide/show elements in real time.
- Global filter toggle lets you temporarily disable all hiding/editing to view the original page.
- **Click To Select** focuses clicked elements in the tree.
- **Click To Remove** hides only the exact clicked element.
- **Direct Edit More** outlines likely removable content chunks in red and hides a chunk when clicked.
- **Auto-Select** highlights likely key content sections on-page and adds `×` buttons so you can remove chunks quickly.
- **Auto-Select Inside** lets you click a region first, then auto-select important items within that region (great for rows of buttons).
- Select mode includes on-page controls for parent/child navigation, hide, and edit.
- **Block This Page** blocks the exact URL (`origin + pathname`) with a full-page overlay.
- Per-element edit controls (background/text/width/height/layout) apply instantly.
- Template presets let you create and switch named setups per site.
- Undo, Reset Page, Refresh, and Save controls.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Click the extension action icon to open the Social Block side panel.

## Notes

- Browser-internal pages like `chrome://` cannot be modified by extensions.
- Save persists changes to sync storage; live changes apply instantly before save.
