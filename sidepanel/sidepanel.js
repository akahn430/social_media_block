const siteSubtitle = document.getElementById("siteSubtitle");
const pickModeBtn = document.getElementById("pickModeBtn");
const removeModeBtn = document.getElementById("removeModeBtn");
const refreshBtn = document.getElementById("refreshBtn");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
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
  focusedSelector: null,
  interactionMode: "off", // off | pick | remove
  history: [],
};

void bootstrap();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "ELEMENT_PICKED_BROADCAST") {
    return;
  }

  if (message.tabId !== state.tabId || message.hostname !== state.hostname) {
    return;
  }

  if (!message.element?.selector) {
    return;
  }

  if (message.interactionMode === "remove") {
    addSelector(message.element.selector, message.element.label || "Clicked element", true);
    setStatus(`Removed: ${message.element.selector}`);
    return;
  }

  focusSelectorInSidebar(message.element.selector, message.element.label || "Clicked element");
  setStatus(`Selected: ${message.element.selector}`);
});

pickModeBtn.addEventListener("click", () => {
  setInteractionMode(state.interactionMode === "pick" ? "off" : "pick");
});

removeModeBtn.addEventListener("click", () => {
  setInteractionMode(state.interactionMode === "remove" ? "off" : "remove");
});

refreshBtn.addEventListener("click", async () => {
  await loadTree();
  renderTree();
  setStatus("Element tree refreshed.");
});

undoBtn.addEventListener("click", () => {
  const previous = state.history.pop();
  if (!previous) {
    setStatus("Nothing to undo.", true);
    return;
  }

  state.settings = { selectors: [...previous] };
  void persistAndApply();
  renderTree();
  setStatus("Undid last change.");
});

resetBtn.addEventListener("click", () => {
  snapshotHistory();
  state.settings.selectors = [];
  state.focusedSelector = null;
  void persistAndApply();
  renderTree();
  setStatus("Reset: all blocks shown for this page.");
});

addSelectorBtn.addEventListener("click", () => {
  const selector = manualSelectorInput.value.trim();
  if (!selector) {
    setStatus("Enter a selector first.", true);
    return;
  }

  addSelector(selector, "Custom selector", true);
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
    treeContainer.textContent = "No div elements detected.";
    return;
  }

  for (const node of state.tree) {
    treeContainer.appendChild(renderNode(node, 0));
  }
}

function renderNode(node, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";
  wrapper.dataset.selector = node.selector;

  const row = document.createElement("div");
  row.className = "tree-row";
  if (state.focusedSelector === node.selector) {
    row.classList.add("focused");
  }
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
  row.addEventListener("click", () => {
    state.focusedSelector = node.selector;
    renderTree();
  });

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
  snapshotHistory();

  if (enabled && !has) {
    state.settings.selectors.push(selector);
  }
  if (!enabled && has) {
    state.settings.selectors = state.settings.selectors.filter((item) => item !== selector);
  }

  void persistAndApply();
}

function addSelector(selector, label = "Selector", shouldHide = false) {
  if (!state.tree.some((node) => node.selector === selector)) {
    state.tree.unshift({ label, selector, depth: 0, children: [] });
  }

  focusSelectorInSidebar(selector, label);

  if (shouldHide && !state.settings.selectors.includes(selector)) {
    snapshotHistory();
    state.settings.selectors.push(selector);
    void persistAndApply();
  }

  renderTree();
}

function focusSelectorInSidebar(selector, fallbackLabel = "Selector") {
  if (!state.tree.some((node) => node.selector === selector)) {
    state.tree.unshift({ label: fallbackLabel, selector, depth: 0, children: [] });
  }

  state.focusedSelector = selector;
  renderTree();

  requestAnimationFrame(() => {
    const node = treeContainer.querySelector(`[data-selector="${cssQuote(selector)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

async function persistAndApply() {
  const safeSettings = normalizeSettings(state.settings);
  state.settings = safeSettings;

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

async function setInteractionMode(mode) {
  state.interactionMode = mode;
  pickModeBtn.classList.toggle("active", mode === "pick");
  removeModeBtn.classList.toggle("active", mode === "remove");

  pickModeBtn.textContent = mode === "pick" ? "Select Mode Active" : "Click to Select";
  removeModeBtn.textContent = mode === "remove" ? "Remove Mode Active" : "Click to Remove";

  await chrome.runtime.sendMessage({
    type: "SIDEPANEL_SET_INTERACTION_MODE",
    tabId: state.tabId,
    mode,
  });

  if (mode === "pick") {
    setStatus("Pick mode: click an element to focus it in sidebar.");
  } else if (mode === "remove") {
    setStatus("Remove mode: click an element to hide that exact element.");
  } else {
    setStatus("Interaction mode off.");
  }
}

async function hoverSelector(selector, enabled) {
  await chrome.runtime.sendMessage({
    type: "SIDEPANEL_HIGHLIGHT_SELECTOR",
    tabId: state.tabId,
    selector,
    enabled,
  });
}

function snapshotHistory() {
  state.history.push([...state.settings.selectors]);
  if (state.history.length > 30) {
    state.history.shift();
  }
}

function normalizeSettings(settings) {
  return {
    selectors: Array.isArray(settings?.selectors)
      ? [...new Set(settings.selectors.map((s) => String(s).trim()).filter(Boolean))]
      : [],
  };
}

function cssQuote(value) {
  return String(value).replaceAll('"', '\\"');
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
