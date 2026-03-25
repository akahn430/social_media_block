const BLOCK_STYLE_ID = "social-block-style";
const EDIT_STYLE_ID = "social-block-edit-style";
const HOVER_STYLE_ID = "social-block-hover-style";
const BLOCK_OVERLAY_ID = "social-block-page-overlay";
const PICK_NAV_CONTAINER_ID = "social-block-pick-nav";
const PICK_PARENT_BUTTON_ID = "social-block-pick-parent-btn";
const PICK_CHILD_BUTTON_ID = "social-block-pick-child-btn";
const PICK_HIDE_BUTTON_ID = "social-block-pick-hide-btn";
const PICK_EDIT_BUTTON_ID = "social-block-pick-edit-btn";
const PICK_EDIT_MODAL_ID = "social-block-pick-edit-modal";
const EXCLUDED_TREE_TAGS = new Set(["script", "noscript"]);

let interactionMode = "off";
let nodeIdCounter = 0;
let pickedElement = null;
let pickNavPositionHandler = null;
let lastHoveredSelector = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "APPLY_BLOCK_RULES") {
    applyRules(message.settings);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "DISCOVER_TREE") {
    sendResponse({ ok: true, tree: discoverTree() });
    return;
  }

  if (message?.type === "SET_INTERACTION_MODE") {
    setInteractionMode(message.mode);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "HIGHLIGHT_SELECTOR") {
    highlightSelector(message.selector, Boolean(message.enabled));
    sendResponse({ ok: true });
    return;
  }
});

void init();

async function init() {
  const hostname = window.location.hostname;
  const response = await safeSendRuntimeMessage({ type: "GET_SITE_SETTINGS", hostname });
  if (response?.ok) applyRules(response.settings);
}

function applyRules(settings) {
  const safe = normalizeSettings(settings);

  let blockStyle = document.getElementById(BLOCK_STYLE_ID);
  if (!blockStyle) {
    blockStyle = document.createElement("style");
    blockStyle.id = BLOCK_STYLE_ID;
    document.documentElement.appendChild(blockStyle);
  }

  const currentPage = normalizePageUrl(window.location.href);
  const isPageBlocked = safe.blockedPages.includes(currentPage);

  const hideRules = safe.selectors.map((selector) => `${selector} { display: none !important; }`).join("\n");
  blockStyle.textContent = hideRules;

  renderBlockOverlay(isPageBlocked);

  let editStyle = document.getElementById(EDIT_STYLE_ID);
  if (!editStyle) {
    editStyle = document.createElement("style");
    editStyle.id = EDIT_STYLE_ID;
    document.documentElement.appendChild(editStyle);
  }

  const editRules = Object.entries(safe.edits)
    .map(([selector, edit]) => {
      const declarations = [];
      if (edit.backgroundColor) declarations.push(`background-color: ${edit.backgroundColor} !important;`);
      declarations.push(widthDeclaration(edit.widthPreset));
      declarations.push(heightDeclaration(edit.heightPreset));
      declarations.push(layoutDeclaration(edit.layoutPreset));
      const clean = declarations.filter(Boolean).join(" ");
      return clean ? `${selector} { ${clean} }` : "";
    })
    .filter(Boolean)
    .join("\n");

  editStyle.textContent = editRules;
  applyTextEdits(safe.edits);
}

function discoverTree() {
  if (!document.body) return [];
  nodeIdCounter = 0;

  const limits = {
    count: 0,
    maxNodes: 1600,
    maxDepth: 12,
    maxChildrenPerNode: 200,
  };

  const roots = [...document.body.children].filter((node) => !isExcludedTag(node));
  return roots.map((node) => serializeNode(node, 0, limits)).filter(Boolean);
}

function serializeNode(node, depth, limits) {
  if (!(node instanceof Element) || isExcludedTag(node)) return null;
  if (limits.count >= limits.maxNodes) return null;

  limits.count += 1;

  const data = {
    label: nodeLabel(node),
    selector: selectorForNode(node),
    depth,
    children: [],
  };

  if (depth >= limits.maxDepth) return data;

  const elementChildren = [...node.children].filter((child) => !isExcludedTag(child));
  for (const child of elementChildren.slice(0, limits.maxChildrenPerNode)) {
    if (limits.count >= limits.maxNodes) break;
    const childNode = serializeNode(child, depth + 1, limits);
    if (childNode) data.children.push(childNode);
  }

  return data;
}

function nodeLabel(node) {
  const idClass = `${node.id} ${[...node.classList].join(" ")} ${node.getAttribute("role") || ""} ${node.getAttribute("aria-label") || ""}`.toLowerCase();

  if (/(left|sidebar|side-bar|sidenav)/.test(idClass)) return "Left Sidebar";
  if (/(right|sidebar|side-bar)/.test(idClass) && /(right)/.test(idClass)) return "Right Sidebar";
  if (/(post|tweet|status|item)/.test(idClass)) return "Post";
  if (/(feed|timeline|stream)/.test(idClass)) return "Feed";
  if (/(nav|menu|tabs)/.test(idClass)) return "Navigation";
  if (/(chat|message|dm|inbox)/.test(idClass)) return "Messages";
  if (/(notification|alert)/.test(idClass)) return "Notifications";
  if (/(header|topbar)/.test(idClass)) return "Header";
  if (/(footer)/.test(idClass)) return "Footer";
  if (/(content|main)/.test(idClass)) return "Main Content";

  const aria = node.getAttribute("aria-label");
  if (aria) return aria.trim();

  const tag = node.tagName.toLowerCase();
  const text = directTextSnippet(node);

  if (/^h[1-6]$/.test(tag)) {
    const snippet = text.slice(0, 32);
    return `Heading: ${snippet}${text.length > 32 ? "…" : ""}`;
  }

  if (tag === "p") {
    const snippet = text.slice(0, 32);
    return `Paragraph: ${snippet}${text.length > 32 ? "…" : ""}`;
  }

  if (text && text.length >= 3) {
    const snippet = text.slice(0, 28);
    return `${tag.toUpperCase()}: ${snippet}${text.length > 28 ? "…" : ""}`;
  }

  return tag.toUpperCase();
}


function directTextSnippet(node) {
  for (const child of node.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    const value = (child.textContent || "").replace(/\s+/g, " ").trim();
    if (value) return value;
  }

  const aria = node.getAttribute("aria-label");
  if (aria) return aria.trim();

  return "";
}


function selectorForNode(node) {
  const liveId = ensureNodeId(node);
  const structural = toSelector(node);
  return `[data-social-block-node="${liveId}"], ${structural}`;
}

function ensureNodeId(node) {
  const existing = node.getAttribute("data-social-block-node");
  if (existing) return existing;
  const next = String(++nodeIdCounter);
  node.setAttribute("data-social-block-node", next);
  return next;
}

function toSelector(node) {
  if (!(node instanceof Element)) return "";
  const path = [];
  let current = node;
  while (current && current !== document) {
    if (!(current instanceof Element)) break;
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      path.unshift(tag);
      break;
    }
    const sameTagSiblings = [...parent.children].filter((child) => child.tagName === current.tagName);
    const index = sameTagSiblings.indexOf(current) + 1;
    path.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }
  return path.join(" > ");
}

function similarSelectorFor(element) {
  if (!(element instanceof Element)) return "";
  const tag = element.tagName.toLowerCase();
  const classes = [...element.classList].filter(Boolean).slice(0, 3).map(escapeCss);
  return classes.length > 0 ? `${tag}.${classes.join(".")}` : tag;
}

function setInteractionMode(mode) {
  const normalized = mode === "pick" || mode === "remove" ? mode : "off";
  if (normalized === interactionMode) return;
  interactionMode = normalized;

  if (interactionMode === "off") {
    document.removeEventListener("mousemove", onModeMouseMove, true);
    document.removeEventListener("click", onModeClick, true);
    document.body.style.cursor = "";
    clearHoverHighlight();
    clearPickNavigationButtons();
    pickedElement = null;
    lastHoveredSelector = null;
    void safeSendRuntimeMessage({
      type: "ELEMENT_HOVERED",
      hostname: window.location.hostname,
      selector: null,
    });
    return;
  }

  if (interactionMode !== "pick") {
    clearPickNavigationButtons();
    pickedElement = null;
    if (lastHoveredSelector) {
      lastHoveredSelector = null;
      void safeSendRuntimeMessage({
        type: "ELEMENT_HOVERED",
        hostname: window.location.hostname,
        selector: null,
      });
    }
  }

  document.addEventListener("mousemove", onModeMouseMove, true);
  document.addEventListener("click", onModeClick, true);
  document.body.style.cursor = "crosshair";
}

function onModeMouseMove(event) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) return;
  if (element.closest(`#${PICK_NAV_CONTAINER_ID}`) || element.closest(`#${PICK_EDIT_MODAL_ID}`)) {
    if (pickedElement) showElementOutline(pickedElement, false);
    return;
  }
  const target = preferredTarget(element);
  if (!target) return;
  showElementOutline(target, interactionMode === "remove");

  if (interactionMode !== "pick") return;
  const selector = selectorForNode(target);
  if (selector === lastHoveredSelector) return;
  lastHoveredSelector = selector;
  void safeSendRuntimeMessage({
    type: "ELEMENT_HOVERED",
    hostname: window.location.hostname,
    selector,
  });
}

function onModeClick(event) {
  if (
    event.target instanceof Element
    && (event.target.closest(`#${PICK_NAV_CONTAINER_ID}`) || event.target.closest(`#${PICK_EDIT_MODAL_ID}`))
  ) return;

  const element = event.target instanceof Element ? preferredTarget(event.target) : null;
  if (!element) return;

  event.preventDefault();
  event.stopPropagation();

  pickedElement = element;
  const payload = pickedElementPayload(element);

  void safeSendRuntimeMessage({
    type: "ELEMENT_PICKED",
    hostname: window.location.hostname,
    interactionMode,
    element: payload,
  });

  if (interactionMode === "pick") {
    showElementOutline(pickedElement, false);
    showPickNavigationButtons();
  }
}

function highlightSelector(selector, enabled) {
  if (!enabled || !selector) {
    clearHoverHighlight();
    return;
  }

  const element = document.querySelector(selector);
  if (!element) {
    clearHoverHighlight();
    return;
  }

  showElementOutline(element, false);
}

function showElementOutline(element, removeMode) {
  clearHoverHighlight();
  element.setAttribute("data-social-block-hover", "true");

  let styleEl = document.getElementById(HOVER_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = HOVER_STYLE_ID;
    document.documentElement.appendChild(styleEl);
  }

  const bg = removeMode ? "rgba(17,24,39,0.18)" : "rgba(17,24,39,0.1)";
  styleEl.textContent = `
    [data-social-block-hover="true"] {
      outline: 2px solid #111827 !important;
      outline-offset: 2px !important;
      background-color: ${bg} !important;
    }
  `;
}

function clearHoverHighlight() {
  document.querySelector("[data-social-block-hover='true']")?.removeAttribute("data-social-block-hover");
}

function showPickNavigationButtons() {
  clearPickNavigationButtons();
  if (!pickedElement || !(pickedElement instanceof Element) || !document.body.contains(pickedElement)) return;

  const nav = document.createElement("div");
  nav.id = PICK_NAV_CONTAINER_ID;
  nav.style.position = "fixed";
  nav.style.zIndex = "2147483647";
  nav.style.display = "grid";
  nav.style.gridTemplateRows = "repeat(2, 22px)";
  nav.style.gap = "4px";

  const makeButton = (id, label, aria) => {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", aria);
    button.style.width = "22px";
    button.style.height = "22px";
    button.style.border = "1px solid #111";
    button.style.borderRadius = "6px";
    button.style.background = "#fff";
    button.style.color = "#111";
    button.style.cursor = "pointer";
    button.style.fontSize = "14px";
    button.style.padding = "0";
    button.style.userSelect = "none";
    button.style.webkitUserSelect = "none";
    button.style.outline = "none";
    button.style.display = "flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    return button;
  };

  const parentButton = makeButton(PICK_PARENT_BUTTON_ID, "↑", "Select parent element");
  const childButton = makeButton(PICK_CHILD_BUTTON_ID, "↓", "Select child element");
  const hideButton = makeButton(PICK_HIDE_BUTTON_ID, "✕", "Hide selected element");
  const editButton = makeButton(PICK_EDIT_BUTTON_ID, "✎", "Edit selected element");

  const updatePosition = () => {
    if (!pickedElement || !document.body.contains(pickedElement)) {
      clearPickNavigationButtons();
      return;
    }
    const rect = pickedElement.getBoundingClientRect();
    const top = Math.max(8, rect.top - 26);
    const left = Math.max(8, rect.left);
    nav.style.top = `${top}px`;
    nav.style.left = `${left}px`;
  };
  pickNavPositionHandler = updatePosition;

  parentButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!pickedElement?.parentElement) return;
    pickedElement = pickedElement.parentElement;
    const payload = pickedElementPayload(pickedElement);

    void safeSendRuntimeMessage({
      type: "ELEMENT_PICKED",
      hostname: window.location.hostname,
      interactionMode: "pick",
      element: payload,
    });

    updatePosition();
    showElementOutline(pickedElement, false);
  });

  childButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const child = firstSelectableChild(pickedElement);
    if (!child) return;
    pickedElement = child;
    const payload = pickedElementPayload(pickedElement);

    void safeSendRuntimeMessage({
      type: "ELEMENT_PICKED",
      hostname: window.location.hostname,
      interactionMode: "pick",
      element: payload,
    });

    updatePosition();
    showElementOutline(pickedElement, false);
  });

  hideButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!pickedElement) return;
    const payload = pickedElementPayload(pickedElement);
    void safeSendRuntimeMessage({
      type: "ELEMENT_PICKED",
      hostname: window.location.hostname,
      interactionMode: "remove",
      element: payload,
    });
  });

  editButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!pickedElement) return;
    showQuickEditModal(pickedElement);
  });

  nav.append(parentButton, childButton, hideButton, editButton);
  document.body.appendChild(nav);
  updatePosition();
  window.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition);
}

function clearPickNavigationButtons() {
  const existing = document.getElementById(PICK_NAV_CONTAINER_ID);
  document.getElementById(PICK_EDIT_MODAL_ID)?.remove();
  if (pickNavPositionHandler) {
    window.removeEventListener("scroll", pickNavPositionHandler, true);
    window.removeEventListener("resize", pickNavPositionHandler);
    pickNavPositionHandler = null;
  }
  existing?.remove();
}

function pickedElementPayload(element) {
  const selector = selectorForNode(element);
  const ancestors = [];
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 16) {
    ancestors.unshift({ selector: selectorForNode(current), label: nodeLabel(current) });
    current = current.parentElement;
    depth += 1;
  }

  return {
    label: nodeLabel(element),
    selector,
    similarSelector: similarSelectorFor(element),
    ancestors,
  };
}

function firstSelectableChild(element) {
  if (!(element instanceof Element)) return null;
  return [...element.children].find((child) => !isExcludedTag(child)) || null;
}

function preferredTarget(element) {
  if (!(element instanceof Element) || isExcludedTag(element)) return null;

  // Keep selection close to what the user clicked.
  // Only step up when the clicked target is likely a tiny leaf (icon/text node wrapper).
  let candidate = element;
  let current = element;

  for (let depth = 0; depth < 2; depth += 1) {
    const parent = current.parentElement;
    if (!parent || parent === document.body || isExcludedTag(parent)) break;
    if (!isSelectableContainer(parent)) break;
    if (!shouldPreferParent(current, parent)) break;
    candidate = parent;
    current = parent;
  }

  return candidate;
}

function isSelectableContainer(element) {
  const tag = element.tagName.toLowerCase();
  return ["div", "section", "article", "main", "aside", "nav"].includes(tag);
}

function shouldPreferParent(child, parent) {
  const childRect = child.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const childArea = Math.max(1, childRect.width * childRect.height);
  const parentArea = Math.max(1, parentRect.width * parentRect.height);
  const childText = directTextSnippet(child);
  const tinyLeaf = childArea < 2200 || childText.length <= 2;
  const parentNotHuge = parentArea <= childArea * 8;
  return tinyLeaf && parentNotHuge;
}

function isExcludedTag(node) {
  return EXCLUDED_TREE_TAGS.has(node?.tagName?.toLowerCase?.() || "");
}

function showQuickEditModal(element) {
  const existing = document.getElementById(PICK_EDIT_MODAL_ID);
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = PICK_EDIT_MODAL_ID;
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.background = "rgba(0,0,0,0.25)";
  modal.style.zIndex = "2147483647";
  modal.style.display = "flex";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";

  const panel = document.createElement("div");
  panel.style.width = "280px";
  panel.style.background = "#fff";
  panel.style.borderRadius = "10px";
  panel.style.padding = "12px";
  panel.style.display = "grid";
  panel.style.gap = "8px";
  panel.innerHTML = `
    <strong style="font-size:13px;">Edit selected element</strong>
    <label style="font-size:12px;">Background <input id="sb-edit-bg" type="color" value="#ffffff"></label>
    <label style="font-size:12px;">Text <input id="sb-edit-text" type="text" placeholder="Replace text"></label>
    <label style="font-size:12px;">Width
      <select id="sb-edit-width">
        <option value="">Default</option><option value="full">Full Width</option><option value="half">Half Width</option><option value="fit">Fit Content</option>
      </select>
    </label>
    <label style="font-size:12px;">Height
      <select id="sb-edit-height">
        <option value="">Default</option><option value="auto">Auto</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="screen">Full Screen</option>
      </select>
    </label>
    <label style="font-size:12px;">Layout
      <select id="sb-edit-layout">
        <option value="">Default</option><option value="block">Block</option><option value="inline">Inline Block</option><option value="flex">Flex</option><option value="grid">Grid</option>
      </select>
    </label>
    <div style="display:flex; gap:6px; justify-content:flex-end;">
      <button id="sb-edit-cancel" type="button">Cancel</button>
      <button id="sb-edit-apply" type="button">Apply</button>
    </div>
  `;

  modal.appendChild(panel);
  document.body.appendChild(modal);
  panel.addEventListener("click", (event) => event.stopPropagation());
  modal.addEventListener("click", () => modal.remove());

  panel.querySelector("#sb-edit-cancel")?.addEventListener("click", () => modal.remove());
  panel.querySelector("#sb-edit-apply")?.addEventListener("click", () => {
    const selector = selectorForNode(element);
    const edit = {
      backgroundColor: panel.querySelector("#sb-edit-bg")?.value || "",
      text: panel.querySelector("#sb-edit-text")?.value?.trim() || "",
      widthPreset: panel.querySelector("#sb-edit-width")?.value || "",
      heightPreset: panel.querySelector("#sb-edit-height")?.value || "",
      layoutPreset: panel.querySelector("#sb-edit-layout")?.value || "",
    };
    void safeSendRuntimeMessage({
      type: "APPLY_QUICK_EDIT",
      hostname: window.location.hostname,
      selector,
      edit,
    });
    modal.remove();
  });
}

function renderBlockOverlay(enabled) {
  const existing = document.getElementById(BLOCK_OVERLAY_ID);
  if (!enabled) {
    existing?.remove();
    document.documentElement.style.overflow = "";
    return;
  }

  if (existing) return;

  const overlay = document.createElement("div");
  overlay.id = BLOCK_OVERLAY_ID;
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 2147483647",
    "background: #fff",
    "display: flex",
    "align-items: center",
    "justify-content: center",
    "font-family: Inter, sans-serif",
    "color: #111",
    "font-size: 16px",
    "font-weight: 600",
  ].join(";");
  overlay.textContent = "This page is blocked by Social Block";
  document.documentElement.appendChild(overlay);
  document.documentElement.style.overflow = "hidden";
}

function applyTextEdits(edits) {
  document.querySelectorAll("[data-social-block-text-edited='1']").forEach((node) => {
    const original = node.getAttribute("data-social-block-original-text");
    if (original !== null) node.textContent = original;
    node.removeAttribute("data-social-block-text-edited");
    node.removeAttribute("data-social-block-original-text");
  });

  for (const [selector, edit] of Object.entries(edits)) {
    if (!edit.text) continue;
    document.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.getAttribute("data-social-block-text-edited") !== "1") {
        node.setAttribute("data-social-block-original-text", node.textContent ?? "");
      }
      node.setAttribute("data-social-block-text-edited", "1");
      node.textContent = edit.text;
    });
  }
}

function normalizeSettings(settings) {
  const safe = settings ?? {};
  return {
    selectors: Array.isArray(safe.selectors) ? [...new Set(safe.selectors.map((s) => String(s).trim()).filter(Boolean))] : [],
    blockedPages: Array.isArray(safe.blockedPages)
      ? [...new Set(safe.blockedPages.map((s) => normalizePageUrl(String(s))).filter(Boolean))]
      : [],
    edits: safe.edits && typeof safe.edits === "object" ? safe.edits : {},
  };
}

function normalizePageUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
    return `${parsed.origin}${path}`;
  } catch {
    return url;
  }
}

function widthDeclaration(preset) {
  if (preset === "full") return "width: 100% !important; max-width: 100% !important;";
  if (preset === "half") return "width: 50% !important;";
  if (preset === "fit") return "width: fit-content !important;";
  return "";
}

function heightDeclaration(preset) {
  if (preset === "auto") return "height: auto !important;";
  if (preset === "small") return "height: 120px !important;";
  if (preset === "medium") return "height: 240px !important;";
  if (preset === "large") return "height: 420px !important;";
  if (preset === "screen") return "height: 100vh !important;";
  return "";
}

function layoutDeclaration(preset) {
  if (preset === "block") return "display: block !important;";
  if (preset === "inline") return "display: inline-block !important;";
  if (preset === "flex") return "display: flex !important;";
  if (preset === "grid") return "display: grid !important;";
  return "";
}


async function safeSendRuntimeMessage(message) {
  try {
    if (!chrome?.runtime?.id) return null;
    return await chrome.runtime.sendMessage(message);
  } catch {
    return null;
  }
}

function escapeCss(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
