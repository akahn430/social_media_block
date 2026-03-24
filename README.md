# Focus Blocks (Chrome Extension)

A minimal Manifest V3 extension for hiding distracting page elements on any site.

## What it does

- Works per-site (settings scoped by hostname).
- Sidebar tree of **div elements** with expandable children.
- Hovering a sidebar card highlights that element on the page.
- Toggle switches hide/show elements in real time.
- **Click to Select** mode: click an element on page and focus it in the sidebar (no auto-hide).
- **Click to Remove** mode: click an element and hide that exact clicked element.
- Undo last change and Reset page buttons.
- Add manual CSS selectors for edge cases.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Click the extension action icon to open the Focus Blocks side panel.

## Notes

- Hidden elements are enforced with `display: none !important`.
- Browser-internal pages like `chrome://` cannot be modified by extensions.
