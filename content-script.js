const BLOCK_STYLE_ID = "social-block-style";
const EDIT_STYLE_ID = "social-block-edit-style";
const HOVER_STYLE_ID = "social-block-hover-style";
const BLOCK_OVERLAY_ID = "social-block-page-overlay";

let interactionMode = "off";

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

  const limits = {
    count: 0,
    maxNodes: 1600,
    maxDepth: 12,
    maxChildrenPerNode: 80,
  };

  const roots = [...document.body.children].filter((node) => node.tagName?.toLowerCase() !== "script");
  return roots.map((node) => serializeNode(node, 0, limits)).filter(Boolean);
}

function serializeNode(node, depth, limits) {
  if (!(node instanceof Element) || node.tagName.toLowerCase() === "script") return null;
  if (limits.count >= limits.maxNodes) return null;

  limits.count += 1;

  const data = {
    label: nodeLabel(node),
    selector: toSelector(node),
    depth,
    children: [],
  };

  if (depth >= limits.maxDepth) return data;

  const elementChildren = [...node.children].filter((child) => child.tagName?.toLowerCase() !== "script");
  for (const child of elementChildren.slice(0, limits.maxChildrenPerNode)) {
    if (limits.count >= limits.maxNodes) break;
    const childNode = serializeNode(child, depth + 1, limits);
    if (childNode) data.children.push(childNode);
  }

  if (elementChildren.length > limits.maxChildrenPerNode) {
    data.children.push({
      label: `More (${elementChildren.length - limits.maxChildrenPerNode})`,
      selector: data.selector,
      depth: depth + 1,
      children: [],
    });
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
    return;
  }

  document.addEventListener("mousemove", onModeMouseMove, true);
  document.addEventListener("click", onModeClick, true);
  document.body.style.cursor = "crosshair";
}

function onModeMouseMove(event) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) return;
  showElementOutline(element, interactionMode === "remove");
}

function onModeClick(event) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) return;

  event.preventDefault();
  event.stopPropagation();

  const selector = toSelector(element);
  const ancestors = [];
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 16) {
    ancestors.unshift({ selector: toSelector(current), label: nodeLabel(current) });
    current = current.parentElement;
    depth += 1;
  }

  void safeSendRuntimeMessage({
    type: "ELEMENT_PICKED",
    hostname: window.location.hostname,
    interactionMode,
    element: {
      label: nodeLabel(element),
      selector,
      similarSelector: similarSelectorFor(element),
      ancestors,
    },
  });
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
