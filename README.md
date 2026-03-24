# Focus Blocks (Chrome Extension)

A minimal Manifest V3 extension for hiding distracting page elements on any site.

## What it does

- Works per-site (settings scoped by hostname).
- Shows a sidebar tree of top-level elements with expandable children.
- Toggle any element with switch controls and apply instantly.
- Hover sidebar entries to highlight matching elements on the page.
- Activate click mode to pick an element directly from the webpage.
- Add manual CSS selectors for edge cases.
A minimal Manifest V3 Chrome extension that lets users hide distracting content blocks per website using customizable profiles.

## Features

- Works on any website (`<all_urls>`).
- Side panel UI with:
  - auto-detected major blocks (header/nav/main/feed/sidebar-like containers)
  - toggle checkboxes per block
  - add/remove profiles (for example: X, Instagram, YouTube)
  - add custom CSS selectors
  - save button to persist and apply changes
- Site-specific settings stored in `chrome.storage.sync`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Click the extension action icon to open the Focus Blocks side panel.

## Notes

- Hidden elements are enforced with `display: none !important`.
- Browser-internal pages like `chrome://` cannot be modified by extensions.
