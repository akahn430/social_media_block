const siteSubtitle = document.getElementById("siteSubtitle");
const pickModeBtn = document.getElementById("pickModeBtn");
const removeModeBtn = document.getElementById("removeModeBtn");
const saveBtn = document.getElementById("saveBtn");
const refreshBtn = document.getElementById("refreshBtn");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const blockPageBtn = document.getElementById("blockPageBtn");
const hideSimilarBtn = document.getElementById("hideSimilarBtn");
const applyEditBtn = document.getElementById("applyEditBtn");
const bgColorInput = document.getElementById("bgColorInput");
const textInput = document.getElementById("textInput");
const widthPreset = document.getElementById("widthPreset");
const heightPreset = document.getElementById("heightPreset");
const layoutPreset = document.getElementById("layoutPreset");
const focusPath = document.getElementById("focusPath");
const treeContainer = document.getElementById("treeContainer");
const statusEl = document.getElementById("status");

const state = {
  tabId: null,
  hostname: null,
  pageUrl: null,
  settings: { selectors: [], blockedPages: [], edits: {} },
  tree: [],
  expanded: new Set(),
  focusedSelector: null,
  focusedLabel: null,
  focusedAncestors: [],
  focusedSimilarSelector: null,
  interactionMode: "off",
  history: [],
  dirty: false,
};

void bootstrap();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "ELEMENT_PICKED_BROADCAST") return;
  if (message.tabId !== state.tabId || message.hostname !== state.hostname) return;
  if (!message.element?.selector) return;

  if (message.interactionMode === "remove") {
    addSelector(message.element.selector, message.element.label || "Clicked element", true);
    state.focusedSimilarSelector = message.element.similarSelector || "";
    state.focusedAncestors = Array.isArray(message.element.ancestors) ? message.element.ancestors : [];
    updateFocusPanel();
    setStatus(`Removed: ${message.element.selector}`);
    return;
  }

  state.focusedSimilarSelector = message.element.similarSelector || "";
  state.focusedAncestors = Array.isArray(message.element.ancestors) ? message.element.ancestors : [];
  focusSelectorInSidebar(message.element.selector, message.element.label || "Clicked element");
  expandAncestors();
  updateFocusPanel();
  setStatus(`Selected: ${message.element.selector}`);
});

pickModeBtn.addEventListener("click", () => {
  setInteractionMode(state.interactionMode === "pick" ? "off" : "pick");
});

removeModeBtn.addEventListener("click", () => {
  setInteractionMode(state.interactionMode === "remove" ? "off" : "remove");
});

saveBtn.addEventListener("click", async () => {
  await persistOnly();
  state.dirty = false;
  saveBtn.classList.toggle("active", false);
  setStatus("Saved.");
});

refreshBtn.addEventListener("click", async () => {
  await loadTree();
  renderTree();
  expandAncestors();
  setStatus("Element tree refreshed.");
});

undoBtn.addEventListener("click", () => {
  const previous = state.history.pop();
  if (!previous) {
    setStatus("Nothing to undo.", true);
    return;
  }

  state.settings = previous;
  markDirty();
  void applyOnly();
  renderTree();
  updateFocusPanel();
  setStatus("Undid last change.");
});

resetBtn.addEventListener("click", () => {
  snapshotHistory();
  state.settings.selectors = [];
  state.settings.edits = {};
  state.focusedSelector = null;
  state.focusedLabel = null;
  state.focusedAncestors = [];
  state.focusedSimilarSelector = null;
  markDirty();
  void applyOnly();
  renderTree();
  updateFocusPanel();
  setStatus("Reset page changes for this site.");
});

blockPageBtn.addEventListener("click", () => {
  if (!state.pageUrl) return;
  snapshotHistory();
  const blocked = state.settings.blockedPages.includes(state.pageUrl);
  if (blocked) {
    state.settings.blockedPages = state.settings.blockedPages.filter((item) => item !== state.pageUrl);
  } else {
    state.settings.blockedPages.push(state.pageUrl);
  }
  markDirty();
  updateBlockPageBtn();
  void applyOnly();
  setStatus(blocked ? "Unblocked this page URL." : "Blocked this page URL.");
});

hideSimilarBtn.addEventListener("click", () => {
  if (!state.focusedSimilarSelector) {
    setStatus("Pick an element first to hide similar items.", true);
    return;
  }
  addSelector(state.focusedSimilarSelector, `Similar: ${state.focusedSimilarSelector}`, true);
  setStatus(`Hiding similar elements: ${state.focusedSimilarSelector}`);
});

applyEditBtn.addEventListener("click", () => {
  if (!state.focusedSelector) {
    setStatus("Pick or focus an element first.", true);
    return;
  }

  snapshotHistory();
  state.settings.edits[state.focusedSelector] = {
    backgroundColor: bgColorInput.value || "",
    text: textInput.value.trim(),
    widthPreset: widthPreset.value,
    heightPreset: heightPreset.value,
    layoutPreset: layoutPreset.value,
  };

  if (isEmptyEdit(state.settings.edits[state.focusedSelector])) {
    delete state.settings.edits[state.focusedSelector];
  }

  markDirty();
  void applyOnly();
  setStatus("Element edit applied in real time.");
});

async function bootstrap() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !activeTab.url) {
    setStatus("Open a website tab first.", true);
    return;
  }

  state.tabId = activeTab.id;

  try {
    const parsed = new URL(activeTab.url);
    state.hostname = parsed.hostname;
    state.pageUrl = `${parsed.origin}${parsed.pathname}`;
  } catch {
    setStatus("This page cannot be configured.", true);
    return;
  }

  siteSubtitle.textContent = `${state.hostname} • ${state.pageUrl}`;

  const response = await chrome.runtime.sendMessage({
    type: "GET_SITE_SETTINGS",
    hostname: state.hostname,
  });

  if (!response?.ok) {
    setStatus("Could not load settings.", true);
    return;
  }

  state.settings = normalizeSettings(response.settings);
  updateBlockPageBtn();
  await loadTree();
  renderTree();
  updateFocusPanel();
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
  if (state.focusedSelector === node.selector) row.classList.add("focused");
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
    expander.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.expanded.has(node.selector)) state.expanded.delete(node.selector);
      else state.expanded.add(node.selector);
      renderTree();
    });
  }

  const toggle = document.createElement("label");
  toggle.className = "switch";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.settings.selectors.includes(node.selector);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
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
    state.focusedLabel = node.label;
    loadEditForFocused();
    updateFocusPanel();
    renderTree();
  });

  row.append(expander, toggle, text);
  wrapper.appendChild(row);

  if (hasChildren) {
    const childrenWrap = document.createElement("div");
    childrenWrap.className = "children";
    if (!state.expanded.has(node.selector)) childrenWrap.classList.add("collapsed");
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

  if (enabled && !has) state.settings.selectors.push(selector);
  if (!enabled && has) state.settings.selectors = state.settings.selectors.filter((item) => item !== selector);

  markDirty();
  void applyOnly();
}

function addSelector(selector, label = "Selector", shouldHide = false) {
  if (!findNodeBySelector(state.tree, selector)) {
    state.tree.unshift({ label, selector, depth: 0, children: [] });
  }

  focusSelectorInSidebar(selector, label);

  if (shouldHide && !state.settings.selectors.includes(selector)) {
    snapshotHistory();
    state.settings.selectors.push(selector);
    markDirty();
    void applyOnly();
  }

  renderTree();
}

function focusSelectorInSidebar(selector, fallbackLabel = "Selector") {
  if (!findNodeBySelector(state.tree, selector)) {
    state.tree.unshift({ label: fallbackLabel, selector, depth: 0, children: [] });
  }

  state.focusedSelector = selector;
  state.focusedLabel = fallbackLabel;
  loadEditForFocused();
  renderTree();

  requestAnimationFrame(() => {
    const node = treeContainer.querySelector(`[data-selector="${cssQuote(selector)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function loadEditForFocused() {
  const edit = state.focusedSelector ? state.settings.edits[state.focusedSelector] : null;
  bgColorInput.value = edit?.backgroundColor || "#ffffff";
  textInput.value = edit?.text || "";
  widthPreset.value = edit?.widthPreset || "";
  heightPreset.value = edit?.heightPreset || "";
  layoutPreset.value = edit?.layoutPreset || "";
}

function expandAncestors() {
  for (const ancestor of state.focusedAncestors) {
    if (ancestor?.selector) state.expanded.add(ancestor.selector);
  }
}

function updateFocusPanel() {
  if (!state.focusedSelector) {
    focusPath.textContent = "Select an element to see parent stack.";
    return;
  }

  const stack = [...state.focusedAncestors.map((item) => item.label || item.selector), state.focusedLabel || state.focusedSelector];
  focusPath.textContent = stack.join("  >  ");
}

function updateBlockPageBtn() {
  const blocked = state.settings.blockedPages.includes(state.pageUrl);
  blockPageBtn.textContent = blocked ? "Unblock This Page" : "Block This Page";
}

async function applyOnly() {
  const safeSettings = normalizeSettings(state.settings);
  state.settings = safeSettings;
  await chrome.runtime.sendMessage({
    type: "APPLY_SETTINGS_TO_TAB",
    tabId: state.tabId,
    settings: safeSettings,
  });
}

async function persistOnly() {
  const safeSettings = normalizeSettings(state.settings);
  state.settings = safeSettings;
  await chrome.runtime.sendMessage({
    type: "SAVE_SITE_SETTINGS",
    hostname: state.hostname,
    settings: safeSettings,
  });
}

async function setInteractionMode(mode) {
  state.interactionMode = mode;
  pickModeBtn.classList.toggle("active", mode === "pick");
  removeModeBtn.classList.toggle("active", mode === "remove");

  await chrome.runtime.sendMessage({
    type: "SIDEPANEL_SET_INTERACTION_MODE",
    tabId: state.tabId,
    mode,
  });

  if (mode === "pick") setStatus("Pick mode on: click an element to focus it in the sidebar.");
  else if (mode === "remove") setStatus("Remove mode on: click an element to hide that exact element.");
  else setStatus("Interaction mode off.");
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
  state.history.push(JSON.parse(JSON.stringify(state.settings)));
  if (state.history.length > 40) state.history.shift();
}

function normalizeSettings(settings) {
  const safe = settings ?? {};
  const edits = {};

  if (safe.edits && typeof safe.edits === "object") {
    for (const [selector, edit] of Object.entries(safe.edits)) {
      if (!selector || !edit || typeof edit !== "object") continue;
      edits[selector] = {
        backgroundColor: typeof edit.backgroundColor === "string" ? edit.backgroundColor : "",
        text: typeof edit.text === "string" ? edit.text : "",
        widthPreset: typeof edit.widthPreset === "string" ? edit.widthPreset : "",
        heightPreset: typeof edit.heightPreset === "string" ? edit.heightPreset : "",
        layoutPreset: typeof edit.layoutPreset === "string" ? edit.layoutPreset : "",
      };
      if (isEmptyEdit(edits[selector])) delete edits[selector];
    }
  }

  return {
    selectors: Array.isArray(safe.selectors)
      ? [...new Set(safe.selectors.map((s) => String(s).trim()).filter(Boolean))]
      : [],
    blockedPages: Array.isArray(safe.blockedPages)
      ? [...new Set(safe.blockedPages.map((s) => String(s).trim()).filter(Boolean))]
      : [],
    edits,
  };
}

function markDirty() {
  state.dirty = true;
  saveBtn.classList.toggle("active", true);
}

function isEmptyEdit(edit) {
  return !edit.backgroundColor && !edit.text && !edit.widthPreset && !edit.heightPreset && !edit.layoutPreset;
}

function findNodeBySelector(nodes, selector) {
  for (const node of nodes) {
    if (node.selector === selector) return node;
    if (node.children?.length) {
      const child = findNodeBySelector(node.children, selector);
      if (child) return child;
    }
  }
  return null;
}

function cssQuote(value) {
  return String(value).replaceAll('"', '\\"');
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
