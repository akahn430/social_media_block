# Focus Blocks (Chrome Extension)

A minimal Manifest V3 extension for hiding distracting page elements on any site.

## What it does

- Works per-site (settings scoped by hostname).
- Shows a sidebar tree of top-level elements with expandable children.
- Toggle any element with switch controls and apply instantly.
- Hover sidebar entries to highlight matching elements on the page.
- Activate click mode to pick an element directly from the webpage.
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
