# Social Block (Chrome Extension)

A minimal Manifest V3 extension for removing distractions and editing page elements on any site.

## What it does

- Works per-site (settings scoped by hostname).
- Displays an expandable tree of page `div` elements.
- Hovering a sidebar card highlights that exact element on the page.
- Toggle switches hide/show elements in real time.
- **Click To Select** mode focuses clicked elements in the sidebar.
- **Click To Remove** mode hides only the exact clicked element.
- **Hide Similar** adds a class-based selector to remove similar elements.
- **Block This Page** stores URL-specific page blocking (origin + pathname).
- Edit focused elements with:
  - background color,
  - text replacement,
  - width presets,
  - height presets,
  - layout presets.
- Undo, Reset Page, and Save buttons.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Click the extension action icon to open the Social Block side panel.

## Notes

- Browser-internal pages like `chrome://` cannot be modified by extensions.
- Save persists changes to sync storage; live changes apply instantly before save.
