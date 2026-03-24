const BLOCK_STYLE_ID = "social-block-style";
const EDIT_STYLE_ID = "social-block-edit-style";
const HOVER_STYLE_ID = "social-block-hover-style";

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
  const response = await chrome.runtime.sendMessage({ type: "GET_SITE_SETTINGS", hostname });
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

  const currentPage = normalizedPageUrl(window.location.href);
  const isPageBlocked = safe.blockedPages.includes(currentPage);

  const hideRules = safe.selectors.map((selector) => `${selector} { display: none !important; }`).join("\n");
  const pageRule = isPageBlocked ? "body > * { display: none !important; }" : "";
  blockStyle.textContent = [pageRule, hideRules].filter(Boolean).join("\n");

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

  const roots = [...document.body.children].filter((node) => node.tagName?.toLowerCase() === "div");
  return roots.map((node) => serializeNode(node, 0, 10)).filter(Boolean);
}

function serializeNode(node, depth, maxDepth) {
  if (!(node instanceof Element) || node.tagName.toLowerCase() !== "div") return null;

  const selector = toSelector(node);
  const data = {
    label: nodeLabel(node),
    selector,
    depth,
    children: [],
  };

  if (depth < maxDepth) {
    const children = [...node.children].filter((child) => child.tagName?.toLowerCase() === "div");
    data.children = children.map((child) => serializeNode(child, depth + 1, maxDepth)).filter(Boolean);
  }

  return data;
}

function nodeLabel(node) {
  const idPart = node.id ? `#${node.id}` : "";
  const classNames = [...node.classList].slice(0, 3);
  const classPart = classNames.length ? `.${classNames.join(".")}` : "";
  const aria = node.getAttribute("aria-label");
  return aria || `${node.tagName.toLowerCase()}${idPart}${classPart}`;
}

function toSelector(node) {
  if (!(node instanceof Element)) return null;

  const path = [];
  let current = node;
  while (current && current !== document.documentElement) {
    if (!(current instanceof Element)) break;
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      path.unshift(tag);
      break;
    }
    const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
    const index = siblings.indexOf(current) + 1;
    path.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }
  return path.join(" > ");
}

function similarSelectorFor(element) {
  if (!(element instanceof Element)) return "";
  const tag = element.tagName.toLowerCase();
  const classes = [...element.classList].filter(Boolean).slice(0, 3).map(escapeCss);
  if (classes.length === 0) return tag;
  return `${tag}.${classes.join(".")}`;
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
  while (current && current !== document.body && depth < 8) {
    if (current.tagName.toLowerCase() === "div") {
      ancestors.unshift({ selector: toSelector(current), label: nodeLabel(current) });
    }
    current = current.parentElement;
    depth += 1;
  }

  chrome.runtime.sendMessage({
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

  const color = "#111827";
  const bg = removeMode ? "rgba(17,24,39,0.18)" : "rgba(17,24,39,0.1)";

  styleEl.textContent = `
    [data-social-block-hover="true"] {
      outline: 2px solid ${color} !important;
      outline-offset: 2px !important;
      background-color: ${bg} !important;
      transition: outline 120ms ease;
    }
  `;
}

function clearHoverHighlight() {
  document.querySelector("[data-social-block-hover='true']")?.removeAttribute("data-social-block-hover");
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
    selectors: Array.isArray(safe.selectors)
      ? [...new Set(safe.selectors.map((s) => String(s).trim()).filter(Boolean))]
      : [],
    blockedPages: Array.isArray(safe.blockedPages)
      ? [...new Set(safe.blockedPages.map((s) => String(s).trim()).filter(Boolean))]
      : [],
    edits: safe.edits && typeof safe.edits === "object" ? safe.edits : {},
  };
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

function normalizedPageUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function escapeCss(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
