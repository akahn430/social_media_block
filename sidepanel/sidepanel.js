const siteSubtitle = document.getElementById("siteSubtitle");
const pickModeBtn = document.getElementById("pickModeBtn");
const removeModeBtn = document.getElementById("removeModeBtn");
const saveBtn = document.getElementById("saveBtn");
const refreshBtn = document.getElementById("refreshBtn");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const blockPageBtn = document.getElementById("blockPageBtn");
const hideSimilarBtn = document.getElementById("hideSimilarBtn");
const editPanel = document.getElementById("editPanel");
const editTitle = document.getElementById("editTitle");
const closeEditBtn = document.getElementById("closeEditBtn");
const bgColorInput = document.getElementById("bgColorInput");
const textInput = document.getElementById("textInput");
const widthPreset = document.getElementById("widthPreset");
const heightPreset = document.getElementById("heightPreset");
const layoutPreset = document.getElementById("layoutPreset");
const focusPath = document.getElementById("focusPath");
const treeTitle = document.getElementById("treeTitle");
const treeContainer = document.getElementById("treeContainer");
const statusEl = document.getElementById("status");

const state = {
  tabId: null,
  hostname: null,
  pageUrl: null,
  settings: { selectors: [], blockedPages: [], edits: {} },
  tree: [],
  expanded: new Set(["html"]),
  focusedSelector: null,
  focusedLabel: null,
  focusedAncestors: [],
  focusedSimilarSelector: null,
  editingSelector: null,
  interactionMode: "off",
  history: [],
};

void bootstrap();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "ELEMENT_PICKED_BROADCAST") return;
  if (message.tabId !== state.tabId || message.hostname !== state.hostname) return;
  if (!message.element?.selector) return;

  state.focusedSimilarSelector = message.element.similarSelector || "";
  state.focusedAncestors = Array.isArray(message.element.ancestors) ? message.element.ancestors : [];

  if (message.interactionMode === "remove") {
    addSelector(message.element.selector, message.element.label || "Clicked element", true);
    setStatus(`Removed: ${message.element.selector}`);
  } else {
    focusSelectorInSidebar(message.element.selector, message.element.label || "Clicked element", false);
    setStatus("");
  }

  expandAncestors();
  updateFocusPanel();
  renderTree();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== state.tabId || !changeInfo.url || !tab.url) return;
  await initializeTabContext(tab.url);
  await loadTree();
  renderTree();
});

pickModeBtn.addEventListener("click", () => {
  setInteractionMode(state.interactionMode === "pick" ? "off" : "pick");
});

removeModeBtn.addEventListener("click", () => {
  setInteractionMode(state.interactionMode === "remove" ? "off" : "remove");
});

saveBtn.addEventListener("click", async () => {
  await persistOnly();
  saveBtn.classList.remove("active");
  setStatus("Saved.");
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
  state.settings = previous;
  markDirty();
  updateBlockPageBtn();
  void applyOnly();
  renderTree();
  setStatus("Undid last change.");
});

resetBtn.addEventListener("click", () => {
  snapshotHistory();
  state.settings.selectors = [];
  state.settings.edits = {};
  markDirty();
  hideEditPanel();
  void applyOnly();
  renderTree();
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

closeEditBtn.addEventListener("click", hideEditPanel);

for (const control of [bgColorInput, textInput, widthPreset, heightPreset, layoutPreset]) {
  control.addEventListener("input", onEditControlChange);
  control.addEventListener("change", onEditControlChange);
}

async function bootstrap() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !activeTab.url) {
    setStatus("Open a website tab first.", true);
    return;
  }

  state.tabId = activeTab.id;
  await initializeTabContext(activeTab.url);
  await loadTree();
  renderTree();
}

async function initializeTabContext(url) {
  try {
    const parsed = new URL(url);
    state.hostname = parsed.hostname;
    state.pageUrl = normalizePageUrl(url);
  } catch {
    setStatus("This page cannot be configured.", true);
    return;
  }

  state.focusedSelector = null;
  state.focusedAncestors = [];
  state.focusedLabel = null;
  state.focusedSimilarSelector = null;
  hideEditPanel();

  siteSubtitle.textContent = state.hostname;
  treeTitle.textContent = formatPageTitle(state.pageUrl);

  const response = await chrome.runtime.sendMessage({ type: "GET_SITE_SETTINGS", hostname: state.hostname });
  if (!response?.ok) {
    setStatus("Could not load settings.", true);
    return;
  }

  state.settings = normalizeSettings(response.settings);
  updateBlockPageBtn();
}

async function loadTree() {
  state.tree = [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(state.tabId, { type: "DISCOVER_TREE" });
      state.tree = Array.isArray(response?.tree) ? response.tree : [];
      if (state.tree.length > 0) {
        setStatus("");
      }
      return;
    } catch {
      await delay(180 * (attempt + 1));
    }
  }

  setStatus("Unable to inspect this tab. Refresh the page and click Refresh Elements.", true);
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
  wrapper.dataset.selector = node.selector;

  const row = document.createElement("div");
  row.className = "tree-row";
  if (state.focusedSelector === node.selector) row.classList.add("focused");
  row.style.paddingLeft = `${8 + Math.min(depth * 10, 120)}px`;

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  const toggle = document.createElement("label");
  toggle.className = "switch";
  toggle.addEventListener("click", (event) => event.stopPropagation());
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !state.settings.selectors.includes(node.selector);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => {
    setSelectorEnabled(node.selector, !checkbox.checked);
    checkbox.checked = !state.settings.selectors.includes(node.selector);
    renderTree();
  });
  const slider = document.createElement("span");
  slider.className = "slider";
  slider.addEventListener("click", (event) => event.stopPropagation());
  toggle.append(checkbox, slider);

  const text = document.createElement("div");
  text.className = "node-text";
  const label = document.createElement("span");
  label.className = "node-label";
  const childCount = Array.isArray(node.children) ? node.children.length : 0;
  label.textContent = `${node.label || "Div"} (${childCount})`;
  text.append(label);

  const editTrigger = document.createElement("button");
  editTrigger.className = "edit-trigger";
  editTrigger.title = "Edit element";
  editTrigger.textContent = "✎";
  editTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    openEditPanel(node.selector, node.label || node.selector);
  });

  row.addEventListener("mouseenter", () => hoverSelector(node.selector, true));
  row.addEventListener("mouseleave", () => hoverSelector(node.selector, false));
  row.addEventListener("click", () => {
    state.focusedSelector = node.selector;
    state.focusedLabel = node.label;
    if (hasChildren) {
      if (state.expanded.has(node.selector)) state.expanded.delete(node.selector);
      else state.expanded.add(node.selector);
    }
    updateFocusPanel();
    renderTree();
  });

  row.append(toggle, text, editTrigger);
  wrapper.appendChild(row);

  if (hasChildren) {
    const childrenWrap = document.createElement("div");
    childrenWrap.className = "children";
    if (!state.expanded.has(node.selector)) childrenWrap.classList.add("collapsed");
    for (const child of node.children) childrenWrap.appendChild(renderNode(child, depth + 1));
    wrapper.appendChild(childrenWrap);
  }

  return wrapper;
}

function setSelectorEnabled(selector, enabled) {
  const has = state.settings.selectors.includes(selector);
  if (enabled === has) return;

  snapshotHistory();
  if (enabled) state.settings.selectors.push(selector);
  else state.settings.selectors = state.settings.selectors.filter((item) => item !== selector);

  markDirty();
  void applyOnly();
}

function addSelector(selector, label = "Selector", shouldHide = false) {
  if (!findNodeBySelector(state.tree, selector)) {
    state.tree.unshift({ label, selector, depth: 0, children: [] });
  }

  focusSelectorInSidebar(selector, label, true);

  if (shouldHide && !state.settings.selectors.includes(selector)) {
    snapshotHistory();
    state.settings.selectors.push(selector);
    markDirty();
    void applyOnly();
  }
}

function focusSelectorInSidebar(selector, fallbackLabel = "Selector", allowInsert = false) {
  if (!findNodeBySelector(state.tree, selector) && allowInsert) {
    state.tree.unshift({ label: fallbackLabel, selector, depth: 0, children: [] });
  }
  state.focusedSelector = selector;
  state.focusedLabel = fallbackLabel;
  updateFocusPanel();

  requestAnimationFrame(() => {
    const node = treeContainer.querySelector(`[data-selector="${cssQuote(selector)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function openEditPanel(selector, label) {
  state.editingSelector = selector;
  editTitle.textContent = `Edit ${label}`;
  editPanel.classList.remove("collapsed");
  const edit = state.settings.edits[selector] || {};
  bgColorInput.value = edit.backgroundColor || "#ffffff";
  textInput.value = edit.text || "";
  widthPreset.value = edit.widthPreset || "";
  heightPreset.value = edit.heightPreset || "";
  layoutPreset.value = edit.layoutPreset || "";
}

function hideEditPanel() {
  state.editingSelector = null;
  editPanel.classList.add("collapsed");
}

function onEditControlChange() {
  if (!state.editingSelector) return;
  snapshotHistory();
  state.settings.edits[state.editingSelector] = {
    backgroundColor: bgColorInput.value || "",
    text: textInput.value.trim(),
    widthPreset: widthPreset.value,
    heightPreset: heightPreset.value,
    layoutPreset: layoutPreset.value,
  };
  if (isEmptyEdit(state.settings.edits[state.editingSelector])) {
    delete state.settings.edits[state.editingSelector];
  }
  markDirty();
  void applyOnly();
}

function expandAncestors() {
  for (const ancestor of state.focusedAncestors) {
    if (ancestor?.selector) state.expanded.add(ancestor.selector);
  }
}

function updateFocusPanel() {
  if (!state.focusedSelector) {
    focusPath.textContent = "Select an element to see stack.";
    return;
  }
  const stack = [...state.focusedAncestors.map((item) => item.label || item.selector), state.focusedLabel || state.focusedSelector];
  focusPath.textContent = stack.join(" > ");
}

function updateBlockPageBtn() {
  const blocked = state.settings.blockedPages.includes(state.pageUrl);
  blockPageBtn.textContent = blocked ? "Unblock This Page" : "Block This Page";
}

async function applyOnly() {
  const safeSettings = normalizeSettings(state.settings);
  state.settings = safeSettings;
  await chrome.runtime.sendMessage({ type: "APPLY_SETTINGS_TO_TAB", tabId: state.tabId, settings: safeSettings });
}

async function persistOnly() {
  const safeSettings = normalizeSettings(state.settings);
  state.settings = safeSettings;
  await chrome.runtime.sendMessage({ type: "SAVE_SITE_SETTINGS", hostname: state.hostname, settings: safeSettings });
}

async function setInteractionMode(mode) {
  state.interactionMode = mode;
  pickModeBtn.classList.toggle("active", mode === "pick");
  removeModeBtn.classList.toggle("active", mode === "remove");

  await chrome.runtime.sendMessage({ type: "SIDEPANEL_SET_INTERACTION_MODE", tabId: state.tabId, mode });

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
      ? [...new Set(safe.blockedPages.map((s) => normalizePageUrl(String(s))).filter(Boolean))]
      : [],
    edits,
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



function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPageTitle(pageUrl) {
  try {
    const parsed = new URL(pageUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    const brand = host.split(".")[0];
    const segment = parsed.pathname.split("/").filter(Boolean)[0] || "Home";
    return `${capitalize(brand)} ${capitalize(segment)}`;
  } catch {
    return "Page Element Tree";
  }
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function markDirty() {
  saveBtn.classList.add("active");
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
