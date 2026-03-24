const STYLE_ELEMENT_ID = "focus-blocks-style";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "APPLY_BLOCK_RULES") {
    applyRules(message.settings);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "DISCOVER_BLOCKS") {
    const blocks = discoverBlocks();
    sendResponse({ ok: true, blocks });
    return;
  }
});

(async function init() {
  const hostname = window.location.hostname;
  chrome.runtime.sendMessage(
    { type: "GET_SITE_SETTINGS", hostname },
    (response) => {
      if (!response?.ok) {
        return;
      }
      applyRules(response.settings);
    }
  );
})();

function applyRules(settings) {
  const profileName = settings?.activeProfile;
  const selectors = settings?.profiles?.[profileName]?.selectors ?? [];
  const validSelectors = selectors
    .map((selector) => String(selector).trim())
    .filter(Boolean);

  let styleEl = document.getElementById(STYLE_ELEMENT_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ELEMENT_ID;
    document.documentElement.appendChild(styleEl);
  }

  if (validSelectors.length === 0) {
    styleEl.textContent = "";
    return;
  }

  const cssBody = validSelectors
    .map((selector) => `${selector} { display: none !important; }`)
    .join("\n");

  styleEl.textContent = cssBody;
}

function discoverBlocks() {
  const candidates = [];
  const seen = new Set();

  const semanticSelectors = [
    "header",
    "nav",
    "main",
    "aside",
    "footer",
    "[role='feed']",
    "[role='complementary']",
    "[aria-label*='feed' i]",
    "[aria-label*='timeline' i]",
    "[aria-label*='reels' i]",
    "[aria-label*='shorts' i]",
    "[aria-label*='recommend' i]",
    "[class*='feed' i]",
    "[class*='timeline' i]",
    "[class*='reel' i]",
    "[class*='short' i]",
    "[class*='sidebar' i]",
    "[class*='recommend' i]",
    "[id*='feed' i]",
    "[id*='timeline' i]",
    "[id*='reel' i]",
    "[id*='short' i]",
    "[id*='sidebar' i]",
  ];

  for (const selector of semanticSelectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const cssSelector = toStableSelector(node);
      if (!cssSelector || seen.has(cssSelector)) {
        continue;
      }
      seen.add(cssSelector);
      candidates.push({
        selector: cssSelector,
        label: makeLabel(node, selector),
      });
      if (candidates.length >= 40) {
        return candidates;
      }
    }
  }

  return candidates;
}

function makeLabel(node, sourceSelector) {
  const aria = node.getAttribute("aria-label");
  const id = node.id ? `#${node.id}` : "";
  const className = node.className && typeof node.className === "string"
    ? `.${node.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")}`
    : "";

  return aria || `${node.tagName.toLowerCase()}${id}${className}` || sourceSelector;
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

  return node.tagName.toLowerCase();
}

function escapeCss(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
