const BLOCK_STYLE_ID = "focus-blocks-style";
const HOVER_STYLE_ID = "focus-blocks-hover-style";

let pickModeActive = false;
let pickHoverElement = null;

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

  if (message?.type === "SET_PICK_MODE") {
    setPickMode(Boolean(message.enabled));
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
  if (response?.ok) {
    applyRules(response.settings);
  }
}

function applyRules(settings) {
  const selectors = Array.isArray(settings?.selectors)
    ? settings.selectors.map((selector) => String(selector).trim()).filter(Boolean)
    : [];

  let styleEl = document.getElementById(BLOCK_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = BLOCK_STYLE_ID;
    document.documentElement.appendChild(styleEl);
  }

  styleEl.textContent = selectors
    .map((selector) => `${selector} { display: none !important; }`)
    .join("\n");
}

function discoverTree() {
  const maxTopLevel = 24;
  const topNodes = [...document.body.children].slice(0, maxTopLevel);
  return topNodes.map((node) => serializeNode(node, 0, 2));
}

function serializeNode(node, depth, maxDepth) {
  const selector = toStableSelector(node);
  const data = {
    label: nodeLabel(node),
    selector,
    depth,
    children: [],
  };

  if (depth < maxDepth) {
    const children = [...node.children].slice(0, 20);
    data.children = children.map((child) => serializeNode(child, depth + 1, maxDepth));
  }

  return data;
}

function nodeLabel(node) {
  const idPart = node.id ? `#${node.id}` : "";
  const classNames = [...node.classList].slice(0, 2);
  const classPart = classNames.length ? `.${classNames.join(".")}` : "";
  const aria = node.getAttribute("aria-label");
  return aria || `${node.tagName.toLowerCase()}${idPart}${classPart}`;
}

function toStableSelector(node) {
  if (!(node instanceof Element)) {
    return null;
  }

  if (node.id) {
    return `#${escapeCss(node.id)}`;
  }

  const classList = [...node.classList].slice(0, 3).map(escapeCss);
  if (classList.length > 0) {
    return `${node.tagName.toLowerCase()}.${classList.join(".")}`;
  }

  const path = [];
  let current = node;
  let hops = 0;
  while (current && current !== document.body && hops < 4) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      break;
    }
    const index = [...parent.children].indexOf(current) + 1;
    path.unshift(`${tag}:nth-child(${index})`);
    current = parent;
    hops += 1;
  }

  return path.length ? `body > ${path.join(" > ")}` : node.tagName.toLowerCase();
}

function setPickMode(enabled) {
  if (enabled === pickModeActive) {
    return;
  }

  pickModeActive = enabled;

  if (enabled) {
    document.addEventListener("mousemove", onPickMove, true);
    document.addEventListener("click", onPickClick, true);
    document.body.style.cursor = "crosshair";
  } else {
    document.removeEventListener("mousemove", onPickMove, true);
    document.removeEventListener("click", onPickClick, true);
    document.body.style.cursor = "";
    clearHoverHighlight();
  }
}

function onPickMove(event) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) {
    return;
  }

  pickHoverElement = element;
  showElementOutline(element);
}

function onPickClick(event) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const selector = toStableSelector(element);
  chrome.runtime.sendMessage({
    type: "ELEMENT_PICKED",
    hostname: window.location.hostname,
    element: {
      label: nodeLabel(element),
      selector,
      depth: 0,
      children: [],
    },
  });

  setPickMode(false);
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

  showElementOutline(element);
}

function showElementOutline(element) {
  clearHoverHighlight();
  element.setAttribute("data-focus-blocks-hover", "true");

  let styleEl = document.getElementById(HOVER_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = HOVER_STYLE_ID;
    document.documentElement.appendChild(styleEl);
  }

  styleEl.textContent = `
    [data-focus-blocks-hover="true"] {
      outline: 2px solid #4f46e5 !important;
      outline-offset: 2px !important;
      background-color: rgba(79, 70, 229, 0.12) !important;
      transition: outline 120ms ease;
    }
  `;
}

function clearHoverHighlight() {
  document.querySelector("[data-focus-blocks-hover='true']")?.removeAttribute("data-focus-blocks-hover");
}

function escapeCss(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
