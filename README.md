# Social Block (Chrome Extension)

A minimal Manifest V3 extension for removing distractions and editing page elements on any site.

## What it does

- Works per-site (settings scoped by hostname).
- Renders a deep nested tree of page elements (scripts excluded) with smart labels and text-aware names for headings/paragraphs.
- Hovering a tree row highlights that element on the page.
- Toggle switches hide/show elements in real time.
- **Click To Select** focuses clicked elements in the tree.
- **Click To Remove** hides only the exact clicked element.
- **Hide Similar** adds a class-based selector to remove similar elements.
- **Block This Page** blocks the exact URL (`origin + pathname`) with a full-page overlay.
- Per-element edit controls (background/text/width/height/layout) open from a hover edit icon and apply instantly.
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
