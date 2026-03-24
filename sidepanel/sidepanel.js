const siteSubtitle = document.getElementById("siteSubtitle");
const pickModeBtn = document.getElementById("pickModeBtn");
const refreshBtn = document.getElementById("refreshBtn");
const treeContainer = document.getElementById("treeContainer");
const manualSelectorInput = document.getElementById("manualSelector");
const addSelectorBtn = document.getElementById("addSelectorBtn");
const statusEl = document.getElementById("status");

const state = {
  tabId: null,
  hostname: null,
  settings: { selectors: [] },
  tree: [],
  expanded: new Set(),
  pickMode: false,
};

void bootstrap();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "ELEMENT_PICKED_BROADCAST") {
    return;
  }

  if (message.tabId !== state.tabId || message.hostname !== state.hostname) {
    return;
  }

  if (message.element?.selector) {
    addSelector(message.element.selector, message.element.label || "Picked element");
    state.pickMode = false;
    pickModeBtn.classList.remove("active");
    pickModeBtn.textContent = "Activate Click Mode";
    setStatus(`Picked: ${message.element.selector}`);
  }
});

pickModeBtn.addEventListener("click", async () => {
  state.pickMode = !state.pickMode;
  pickModeBtn.classList.toggle("active", state.pickMode);
  pickModeBtn.textContent = state.pickMode ? "Click Mode Active" : "Activate Click Mode";

  await chrome.runtime.sendMessage({
    type: "SIDEPANEL_PICK_MODE",
    tabId: state.tabId,
    enabled: state.pickMode,
  });

  setStatus(state.pickMode ? "Hover page and click any element to add it." : "Click mode off.");
});

refreshBtn.addEventListener("click", async () => {
  await loadTree();
  renderTree();
  setStatus("Element tree refreshed.");
});

addSelectorBtn.addEventListener("click", () => {
  const selector = manualSelectorInput.value.trim();
  if (!selector) {
    setStatus("Enter a selector first.", true);
    return;
  }

  addSelector(selector, "Custom selector");
  manualSelectorInput.value = "";
});

async function bootstrap() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !activeTab.url) {
    setStatus("Open a website tab first.", true);
    return;
  }

  state.tabId = activeTab.id;

  try {
    state.hostname = new URL(activeTab.url).hostname;
  } catch {
    setStatus("This page cannot be configured.", true);
    return;
  }

  siteSubtitle.textContent = state.hostname;

  const settingsResponse = await chrome.runtime.sendMessage({
    type: "GET_SITE_SETTINGS",
    hostname: state.hostname,
  });

  if (!settingsResponse?.ok) {
    setStatus("Could not load settings.", true);
    return;
  }

  state.settings = normalizeSettings(settingsResponse.settings);

  await loadTree();
  renderTree();
}

async function loadTree() {
  try {
    const response = await chrome.tabs.sendMessage(state.tabId, { type: "DISCOVER_TREE" });
    state.tree = Array.isArray(response?.tree) ? response.tree : [];
  } catch {
    state.tree = [];
    setStatus("Unable to inspect this tab.", true);
  }
}

function renderTree() {
  treeContainer.innerHTML = "";

  if (state.tree.length === 0) {
    treeContainer.textContent = "No elements detected.";
    return;
  }

  for (const node of state.tree) {
    treeContainer.appendChild(renderNode(node, 0));
  }
}

function renderNode(node, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.paddingLeft = `${8 + depth * 10}px`;

  const expander = document.createElement("button");
  expander.className = "expander";

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  if (!hasChildren) {
    expander.classList.add("hidden");
    expander.textContent = "·";
  } else {
    const isExpanded = state.expanded.has(node.selector);
    expander.textContent = isExpanded ? "−" : "+";
    expander.addEventListener("click", () => {
      if (state.expanded.has(node.selector)) {
        state.expanded.delete(node.selector);
      } else {
        state.expanded.add(node.selector);
      }
      renderTree();
    });
  }

  const toggle = document.createElement("label");
  toggle.className = "switch";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.settings.selectors.includes(node.selector);
  checkbox.addEventListener("change", () => {
    setSelectorEnabled(node.selector, checkbox.checked);
  });

  const slider = document.createElement("span");
  slider.className = "slider";
  toggle.append(checkbox, slider);

  const text = document.createElement("div");
  text.className = "node-text";

  const label = document.createElement("span");
  label.className = "node-label";
  label.textContent = node.label || node.selector;

  const selector = document.createElement("span");
  selector.className = "node-selector";
  selector.textContent = node.selector;

  text.append(label, selector);

  row.addEventListener("mouseenter", () => hoverSelector(node.selector, true));
  row.addEventListener("mouseleave", () => hoverSelector(node.selector, false));

  row.append(expander, toggle, text);
  wrapper.appendChild(row);

  if (hasChildren) {
    const childrenWrap = document.createElement("div");
    childrenWrap.className = "children";
    if (!state.expanded.has(node.selector)) {
      childrenWrap.classList.add("collapsed");
    }

    for (const child of node.children) {
      childrenWrap.appendChild(renderNode(child, depth + 1));
    }

    wrapper.appendChild(childrenWrap);
  }

  return wrapper;
}

function setSelectorEnabled(selector, enabled) {
  const has = state.settings.selectors.includes(selector);
  if (enabled && !has) {
    state.settings.selectors.push(selector);
  }
  if (!enabled && has) {
    state.settings.selectors = state.settings.selectors.filter((item) => item !== selector);
  }
  void persistAndApply();
}

function addSelector(selector, label = "Selector") {
  if (!state.settings.selectors.includes(selector)) {
    state.settings.selectors.push(selector);
    void persistAndApply();
  }

  if (!state.tree.some((node) => node.selector === selector)) {
    state.tree.unshift({ label, selector, depth: 0, children: [] });
  }

  renderTree();
}

async function persistAndApply() {
  const safeSettings = normalizeSettings(state.settings);

  await chrome.runtime.sendMessage({
    type: "SAVE_SITE_SETTINGS",
    hostname: state.hostname,
    settings: safeSettings,
  });

  await chrome.runtime.sendMessage({
    type: "APPLY_SETTINGS_TO_TAB",
    tabId: state.tabId,
    settings: safeSettings,
  });
}

async function hoverSelector(selector, enabled) {
  await chrome.runtime.sendMessage({
    type: "SIDEPANEL_HIGHLIGHT_SELECTOR",
    tabId: state.tabId,
    selector,
    enabled,
  });
}

function normalizeSettings(settings) {
  return {
    selectors: Array.isArray(settings?.selectors)
      ? [...new Set(settings.selectors.map((s) => String(s).trim()).filter(Boolean))]
      : [],
  };
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
