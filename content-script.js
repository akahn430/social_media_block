const BLOCK_STYLE_ID = "focus-blocks-style";
const HOVER_STYLE_ID = "focus-blocks-hover-style";

let interactionMode = "off"; // off | pick | remove

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
  const maxTopLevel = 40;
  const topNodes = [...document.body.children]
    .filter((node) => node.tagName.toLowerCase() === "div")
    .slice(0, maxTopLevel);

  return topNodes.map((node) => serializeNode(node, 0, 2)).filter(Boolean);
}

function serializeNode(node, depth, maxDepth) {
  if (!(node instanceof Element) || node.tagName.toLowerCase() !== "div") {
    return null;
  }

  const selector = toSelector(node, false);
  const data = {
    label: nodeLabel(node),
    selector,
    depth,
    children: [],
  };

  if (depth < maxDepth) {
    const children = [...node.children]
      .filter((child) => child.tagName.toLowerCase() === "div")
      .slice(0, 30);

    data.children = children
      .map((child) => serializeNode(child, depth + 1, maxDepth))
      .filter(Boolean);
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

function toSelector(node, precise = false) {
  if (!(node instanceof Element)) {
    return null;
  }

  if (!precise && node.id) {
    return `#${escapeCss(node.id)}`;
  }

  if (!precise) {
    const classList = [...node.classList].slice(0, 3).map(escapeCss);
    if (classList.length > 0) {
      return `${node.tagName.toLowerCase()}.${classList.join(".")}`;
    }
  }

  const path = [];
  let current = node;
  while (current && current !== document.documentElement) {
    if (!(current instanceof Element)) {
      break;
    }
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      path.unshift(tag);
      break;
    }
    const index = [...parent.children].indexOf(current) + 1;
    path.unshift(`${tag}:nth-child(${index})`);
    current = parent;
  }

  return path.join(" > ");
}

function setInteractionMode(mode) {
  const normalized = mode === "pick" || mode === "remove" ? mode : "off";
  if (normalized === interactionMode) {
    return;
  }

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
  document.body.style.cursor = interactionMode === "remove" ? "not-allowed" : "crosshair";
}

function onModeMouseMove(event) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) {
    return;
  }
  showElementOutline(element, interactionMode === "remove");
}

function onModeClick(event) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const selector = toSelector(element, interactionMode === "remove");

  chrome.runtime.sendMessage({
    type: "ELEMENT_PICKED",
    hostname: window.location.hostname,
    interactionMode,
    element: {
      label: nodeLabel(element),
      selector,
      depth: 0,
      children: [],
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

function showElementOutline(element, isRemoveMode) {
  clearHoverHighlight();
  element.setAttribute("data-focus-blocks-hover", "true");

  let styleEl = document.getElementById(HOVER_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = HOVER_STYLE_ID;
    document.documentElement.appendChild(styleEl);
  }

  const color = isRemoveMode ? "#dc2626" : "#374151";
  const bg = isRemoveMode ? "rgba(220, 38, 38, 0.15)" : "rgba(55, 65, 81, 0.15)";

  styleEl.textContent = `
    [data-focus-blocks-hover="true"] {
      outline: 2px solid ${color} !important;
      outline-offset: 2px !important;
      background-color: ${bg} !important;
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
