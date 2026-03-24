# Focus Blocks Merge Conflict Guide (What to Keep)

Use this when resolving merge conflicts for the extension files.

## Goal state to keep
Keep the **new architecture** with:
- no profile system
- click mode (pick element on page)
- expandable element tree
- toggle switches
- hover-to-highlight
- real-time apply (save + apply immediately on toggle)
- white/gray/dark-gray visual design

---

## File-by-file conflict decisions

### `background.js`
**KEEP** blocks/messages for:
- `GET_SITE_SETTINGS`
- `SAVE_SITE_SETTINGS`
- `APPLY_SETTINGS_TO_TAB`
- `SIDEPANEL_PICK_MODE`
- `SIDEPANEL_HIGHLIGHT_SELECTOR`
- `ELEMENT_PICKED` -> `ELEMENT_PICKED_BROADCAST`
- storage shape: `{ selectors: [] }`

**DO NOT KEEP**:
- `activeProfile` / `profiles` storage
- any profile-related message types

---

### `content-script.js`
**KEEP**:
- `APPLY_BLOCK_RULES` handling with selector array
- `DISCOVER_TREE` and nested `serializeNode`
- click mode methods: `setPickMode`, `onPickMove`, `onPickClick`
- hover highlight methods: `highlightSelector`, `showElementOutline`, `clearHoverHighlight`

**DO NOT KEEP**:
- profile-based rule selection (`settings.activeProfile`, `settings.profiles[...]`)
- old flat "detected blocks" model only (without tree)

---

### `sidepanel/sidepanel.js`
**KEEP**:
- state with `{ selectors: [] }` only
- click mode button wiring (`SIDEPANEL_PICK_MODE`)
- runtime listener for `ELEMENT_PICKED_BROADCAST`
- `renderTree` + `renderNode` with expand/collapse
- toggle switch behavior via `setSelectorEnabled`
- `persistAndApply` called on every toggle/manual add
- hover handlers for row mouse enter/leave

**DO NOT KEEP**:
- profile management UI/logic (create/delete/select profile)
- save button flow that waits for manual save only

---

### `sidepanel/sidepanel.html`
**KEEP**:
- buttons: `Activate Click Mode`, `Refresh Elements`
- element tree container (`#treeContainer`)
- manual selector input + add button

**DO NOT KEEP**:
- profile selector/new profile/delete profile controls
- old detected-blocks list section tied to profile logic

---

### `sidepanel/sidepanel.css`
**KEEP**:
- grayscale design tokens (`--bg`, `--card`, `--text`, `--muted`, `--border`, `--dark`)
- `.switch` and `.slider` toggle styles
- tree/expander/children styles

**DO NOT KEEP**:
- previous dark neon/green accent theme

---

### `README.md`
**KEEP** descriptions for:
- click mode
- expandable tree
- real-time toggle behavior

**DO NOT KEEP** outdated profile-related description.

---

## Quick conflict-resolution checklist

1. Run this to find unresolved markers:
   ```bash
   rg -n "^(<<<<<<<|=======|>>>>>>>)" -S .
   ```
2. Resolve each file using the KEEP/DO NOT KEEP notes above.
3. Validate syntax:
   ```bash
   python -m json.tool manifest.json
   node --check background.js
   node --check content-script.js
   node --check sidepanel/sidepanel.js
   ```
4. Reload extension in `chrome://extensions` and test:
   - click mode picks elements
   - hover in sidebar highlights page element
   - toggles hide/show instantly
   - expand/collapse tree works
