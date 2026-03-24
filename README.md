# Focus Blocks (Chrome Extension)

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
4. Select this folder (`social_media_block`).
5. Open any website and click the extension action icon to open the side panel.

## Notes

- Rules are applied by injecting a style tag that sets `display: none !important` on selected selectors.
- Some browser-internal pages (e.g., `chrome://`) cannot be modified by extensions.
