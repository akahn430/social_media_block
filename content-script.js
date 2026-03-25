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
const DIRECT_STYLE_ID = "social-block-direct-style";
const DIRECT_ATTR = "data-social-block-direct-candidate";
const AUTO_STYLE_ID = "social-block-auto-style";
const AUTO_ATTR = "data-social-block-auto-candidate";
const AUTO_LAYER_ID = "social-block-auto-layer";

let interactionMode = "off";
let nodeIdCounter = 0;
let pickedElement = null;
let pickNavPositionHandler = null;
let lastHoveredSelector = null;
let autoSelectPositionHandler = null;
let autoSelectScopeRoot = null;

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
  const filterEnabled = safe.filterEnabled !== false;

  let blockStyle = document.getElementById(BLOCK_STYLE_ID);
  if (!blockStyle) {
    blockStyle = document.createElement("style");
    blockStyle.id = BLOCK_STYLE_ID;
    document.documentElement.appendChild(blockStyle);
  }

  const currentPage = normalizePageUrl(window.location.href);
  const isPageBlocked = filterEnabled && safe.blockedPages.includes(currentPage);

  const hideRules = filterEnabled
    ? safe.selectors.map((selector) => `${selector} { display: none !important; }`).join("\n")
    : "";
  blockStyle.textContent = hideRules;

  renderBlockOverlay(isPageBlocked);

  let editStyle = document.getElementById(EDIT_STYLE_ID);
  if (!editStyle) {
    editStyle = document.createElement("style");
    editStyle.id = EDIT_STYLE_ID;
    document.documentElement.appendChild(editStyle);
  }

  const editRules = (filterEnabled ? Object.entries(safe.edits) : [])
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
  applyTextEdits(filterEnabled ? safe.edits : {});
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
  const normalized = ["pick", "remove", "direct-remove", "auto-select", "auto-select-scope"].includes(mode) ? mode : "off";
  if (normalized === interactionMode) return;
  interactionMode = normalized;

  document.removeEventListener("mousemove", onModeMouseMove, true);
  document.removeEventListener("click", onModeClick, true);

  if (interactionMode === "off") {
    document.body.style.cursor = "";
    clearHoverHighlight();
    clearPickNavigationButtons();
    clearDirectEditMode();
    clearAutoSelectMode();
    autoSelectScopeRoot = null;
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

  if (interactionMode === "direct-remove") {
    enableDirectEditMode();
  } else {
    clearDirectEditMode();
  }

  if (interactionMode === "auto-select") {
    enableAutoSelectMode(autoSelectScopeRoot);
    document.body.style.cursor = "";
    return;
  }

  if (interactionMode === "auto-select-scope") {
    clearAutoSelectMode();
    document.addEventListener("mousemove", onModeMouseMove, true);
    document.addEventListener("click", onModeClick, true);
    document.body.style.cursor = "crosshair";
    return;
  }

  autoSelectScopeRoot = null;
  clearAutoSelectMode();

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
  if (interactionMode === "auto-select-scope") {
    const scopeTarget = chooseChunkTarget(element) || preferredTarget(element);
    if (scopeTarget) showElementOutline(scopeTarget, false);
    return;
  }
  const target = preferredTarget(element);
  if (!target) return;
  const displayTarget = interactionMode === "direct-remove" ? directCandidateFor(target) : target;
  if (!displayTarget) return;
  showElementOutline(displayTarget, interactionMode === "remove" || interactionMode === "direct-remove");

  if (interactionMode !== "pick") return;
  const selector = selectorForNode(displayTarget);
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

  const rawTarget = event.target instanceof Element ? preferredTarget(event.target) : null;
  if (interactionMode === "auto-select-scope") {
    const scopeTarget = chooseChunkTarget(rawTarget) || rawTarget;
    if (scopeTarget) {
      autoSelectScopeRoot = scopeTarget;
      setInteractionMode("auto-select");
    }
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const element = interactionMode === "direct-remove" ? directCandidateFor(rawTarget) : rawTarget;
  if (!element) return;

  event.preventDefault();
  event.stopPropagation();

  pickedElement = element;
  const payload = pickedElementPayload(element);

  void safeSendRuntimeMessage({
    type: "ELEMENT_PICKED",
    hostname: window.location.hostname,
    interactionMode: interactionMode === "direct-remove" ? "remove" : interactionMode,
    element: payload,
  });

  if (interactionMode === "pick") {
    showElementOutline(pickedElement, false);
    showPickNavigationButtons();
  }
}

function enableDirectEditMode() {
  const styleEl = ensureDirectModeStyle();
  if (!styleEl) return;
  const candidates = collectDirectCandidates();
  document.querySelectorAll(`[${DIRECT_ATTR}="1"]`).forEach((node) => node.removeAttribute(DIRECT_ATTR));
  for (const node of candidates) node.setAttribute(DIRECT_ATTR, "1");
}

function clearDirectEditMode() {
  document.querySelectorAll(`[${DIRECT_ATTR}="1"]`).forEach((node) => node.removeAttribute(DIRECT_ATTR));
  document.getElementById(DIRECT_STYLE_ID)?.remove();
}

function ensureDirectModeStyle() {
  let styleEl = document.getElementById(DIRECT_STYLE_ID);
  if (styleEl) return styleEl;
  styleEl = document.createElement("style");
  styleEl.id = DIRECT_STYLE_ID;
  styleEl.textContent = `
    [${DIRECT_ATTR}="1"] {
      outline: 1.5px solid rgba(220, 38, 38, 0.6) !important;
      outline-offset: 1px !important;
      transition: outline-color 120ms ease, background-color 120ms ease;
    }
    [${DIRECT_ATTR}="1"]:hover {
      outline-color: rgba(185, 28, 28, 0.95) !important;
      background-color: rgba(220, 38, 38, 0.08) !important;
    }
  `;
  document.documentElement.appendChild(styleEl);
  return styleEl;
}

function directCandidateFor(element) {
  if (!(element instanceof Element)) return null;
  if (element.closest(`#${PICK_NAV_CONTAINER_ID}`) || element.closest(`#${PICK_EDIT_MODAL_ID}`)) return null;
  return element.closest(`[${DIRECT_ATTR}="1"]`) || chooseChunkTarget(element);
}

function collectDirectCandidates() {
  if (!document.body) return [];
  const seen = new Set();
  const selected = [];
  const containers = document.body.querySelectorAll("div,section,article,aside,main,nav,li");
  let count = 0;
  for (const node of containers) {
    if (!(node instanceof Element)) continue;
    if (count > 1400) break;
    const candidate = chooseChunkTarget(node);
    if (!candidate || !isChunkLike(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    selected.push(candidate);
    count += 1;
  }
  return selected;
}

function enableAutoSelectMode(scopeRoot = null) {
  const styleEl = ensureAutoSelectStyle();
  if (!styleEl || !document.body) return;

  const chunks = collectImportantChunks(scopeRoot || document.body);
  clearAutoSelectMode(false);
  for (const chunk of chunks) {
    chunk.setAttribute(AUTO_ATTR, "1");
  }

  let layer = document.getElementById(AUTO_LAYER_ID);
  if (!layer) {
    layer = document.createElement("div");
    layer.id = AUTO_LAYER_ID;
    layer.style.position = "fixed";
    layer.style.inset = "0";
    layer.style.zIndex = "2147483647";
    layer.style.pointerEvents = "none";
    document.documentElement.appendChild(layer);
  }

  const placeButtons = () => {
    if (!layer) return;
    layer.innerHTML = "";
    const candidates = document.querySelectorAll(`[${AUTO_ATTR}="1"]`);
    for (const node of candidates) {
      if (!(node instanceof Element)) continue;
      if (node.getBoundingClientRect().width < 20 || node.getBoundingClientRect().height < 20) continue;
      const rect = node.getBoundingClientRect();
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "×";
      button.setAttribute("aria-label", "Remove this section");
      button.style.position = "fixed";
      button.style.top = `${Math.max(4, rect.top + 4)}px`;
      button.style.left = `${Math.max(4, rect.right - 22)}px`;
      button.style.width = "18px";
      button.style.height = "18px";
      button.style.borderRadius = "999px";
      button.style.border = "1px solid #b91c1c";
      button.style.background = "#fff";
      button.style.color = "#b91c1c";
      button.style.fontSize = "13px";
      button.style.lineHeight = "1";
      button.style.padding = "0";
      button.style.cursor = "pointer";
      button.style.pointerEvents = "auto";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const payload = pickedElementPayload(node);
        void safeSendRuntimeMessage({
          type: "ELEMENT_PICKED",
          hostname: window.location.hostname,
          interactionMode: "remove",
          element: payload,
        });
      });
      layer.appendChild(button);
    }
  };

  autoSelectPositionHandler = placeButtons;
  placeButtons();
  window.addEventListener("scroll", placeButtons, true);
  window.addEventListener("resize", placeButtons);
}

function clearAutoSelectMode(removeStyle = true) {
  document.querySelectorAll(`[${AUTO_ATTR}="1"]`).forEach((node) => node.removeAttribute(AUTO_ATTR));
  const layer = document.getElementById(AUTO_LAYER_ID);
  if (autoSelectPositionHandler) {
    window.removeEventListener("scroll", autoSelectPositionHandler, true);
    window.removeEventListener("resize", autoSelectPositionHandler);
    autoSelectPositionHandler = null;
  }
  layer?.remove();
  if (removeStyle) document.getElementById(AUTO_STYLE_ID)?.remove();
}

function ensureAutoSelectStyle() {
  let styleEl = document.getElementById(AUTO_STYLE_ID);
  if (styleEl) return styleEl;
  styleEl = document.createElement("style");
  styleEl.id = AUTO_STYLE_ID;
  styleEl.textContent = `
    [${AUTO_ATTR}="1"] {
      outline: 2px solid rgba(185, 28, 28, 0.75) !important;
      outline-offset: 2px !important;
      background-color: rgba(239, 68, 68, 0.08) !important;
    }
    [${AUTO_ATTR}="1"]:hover {
      outline-color: rgba(127, 29, 29, 0.95) !important;
      background-color: rgba(239, 68, 68, 0.14) !important;
    }
  `;
  document.documentElement.appendChild(styleEl);
  return styleEl;
}

function collectImportantChunks(root) {
  const scored = collectScoredCandidates(root)
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  for (const item of scored) {
    if (!isValidCandidate(item.node)) continue;
    if (hasHeavyOverlap(item.node, picked)) continue;
    picked.push(item.node);
    if (picked.length >= 80) break;
  }
  return picked;
}

function collectScoredCandidates(root) {
  if (!(root instanceof Element)) return [];
  const seen = new Set();
  const items = [];

  const containers = root.querySelectorAll("div,section,article,aside,main,nav,li");
  for (const node of containers) {
    if (!(node instanceof Element)) continue;
    const candidate = chooseChunkTarget(node);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    items.push({ node: candidate, score: chunkImportanceScore(candidate) });
  }

  const controls = root.querySelectorAll("button,a,[role='button'],input[type='button'],input[type='submit']");
  for (const control of controls) {
    if (!(control instanceof Element)) continue;
    if (seen.has(control)) continue;
    seen.add(control);
    items.push({ node: control, score: chunkImportanceScore(control) + 5 });
  }

  return items;
}

function isValidCandidate(node) {
  return node instanceof Element && isChunkLike(node);
}

function hasHeavyOverlap(candidate, acceptedNodes) {
  const rectA = candidate.getBoundingClientRect();
  const areaA = Math.max(1, rectA.width * rectA.height);

  for (const node of acceptedNodes) {
    if (!(node instanceof Element)) continue;
    const rectB = node.getBoundingClientRect();
    const areaB = Math.max(1, rectB.width * rectB.height);
    const overlapArea = intersectionArea(rectA, rectB);
    if (!overlapArea) continue;
    const overlapRatio = overlapArea / Math.min(areaA, areaB);
    if (node.contains(candidate) || candidate.contains(node)) {
      if (overlapRatio > 0.62) return true;
      continue;
    }
    if (overlapRatio > 0.68) return true;
  }

  return false;
}

function intersectionArea(a, b) {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}

function chunkImportanceScore(element) {
  if (!(element instanceof Element)) return 0;
  const rect = element.getBoundingClientRect();
  const area = rect.width * rect.height;
  if (area < 1200) return 0;

  const tag = element.tagName.toLowerCase();
  const hints = `${element.id} ${element.className} ${element.getAttribute("role") || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();
  let score = Math.min(area / 22000, 8);
  if (tag === "button" || tag === "a" || element.getAttribute("role") === "button") score += 10;
  if (/(feed|timeline|content|post|tweet|card|sidebar|trend|recommend|video|reel|story|comment|thread|toolbar|menu|actions)/.test(hints)) score += 8;
  if (element.children.length >= 2) score += 2;
  if (element.children.length >= 6) score += 3;
  if (isVisualContainer(element)) score += 3;
  if (directTextSnippet(element).length > 0 && element.children.length === 0 && tag !== "button" && tag !== "a") score -= 8;
  return score;
}

function chooseChunkTarget(start) {
  if (!(start instanceof Element)) return null;
  let candidate = start;
  let current = start;
  for (let depth = 0; depth < 4; depth += 1) {
    const parent = current.parentElement;
    if (!parent || parent === document.body) break;
    if (!isChunkContainer(parent)) break;
    if (isVisualContainer(current)) break;
    if (isVisualContainer(parent)) {
      candidate = parent;
      break;
    }
    candidate = parent;
    current = parent;
  }
  return candidate;
}

function isChunkContainer(element) {
  const tag = element.tagName.toLowerCase();
  return ["div", "section", "article", "aside", "main", "nav", "li"].includes(tag);
}

function isChunkLike(element) {
  if (!(element instanceof Element)) return false;
  if (isExcludedTag(element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 18) return false;
  if (element.children.length === 0 && directTextSnippet(element).length > 0) return false;
  return true;
}

function isVisualContainer(element) {
  if (!(element instanceof Element)) return false;
  if (element.id || element.classList.length > 0) return true;
  const role = element.getAttribute("role");
  if (role) return true;
  const style = window.getComputedStyle(element);
  return Boolean(
    (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)")
    || style.backgroundImage !== "none"
    || style.borderStyle !== "none"
    || style.boxShadow !== "none"
    || style.display === "flex"
    || style.display === "grid"
    || style.position === "sticky"
    || style.position === "fixed"
  );
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
    filterEnabled: safe.filterEnabled !== false,
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
