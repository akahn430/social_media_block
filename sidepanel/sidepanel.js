const pickModeBtn = document.getElementById("pickModeBtn");
const removeModeBtn = document.getElementById("removeModeBtn");
const directRemoveModeBtn = document.getElementById("directRemoveModeBtn");
const modeOffBtn = document.getElementById("modeOffBtn");
const saveBtn = document.getElementById("saveBtn");
const refreshBtn = document.getElementById("refreshBtn");
const autoSelectBtn = document.getElementById("autoSelectBtn");
const autoSelectScopeBtn = document.getElementById("autoSelectScopeBtn");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const filterToggleBtn = document.getElementById("filterToggleBtn");
const blockPageBtn = document.getElementById("blockPageBtn");
const editPanel = document.getElementById("editPanel");
const editTitle = document.getElementById("editTitle");
const closeEditBtn = document.getElementById("closeEditBtn");
const bgColorInput = document.getElementById("bgColorInput");
const textInput = document.getElementById("textInput");
const widthPreset = document.getElementById("widthPreset");
const heightPreset = document.getElementById("heightPreset");
const layoutPreset = document.getElementById("layoutPreset");
const treeTitle = document.getElementById("treeTitle");
const treeContainer = document.getElementById("treeContainer");
const templateSelect = document.getElementById("templateSelect");
const newTemplateBtn = document.getElementById("newTemplateBtn");
const renameTemplateBtn = document.getElementById("renameTemplateBtn");
const deleteTemplateBtn = document.getElementById("deleteTemplateBtn");
const selectedElementCard = document.getElementById("selectedElementCard");
const selectedElementLabel = document.getElementById("selectedElementLabel");
const showInTreeBtn = document.getElementById("showInTreeBtn");
const hideSelectedBtn = document.getElementById("hideSelectedBtn");
const editSelectedBtn = document.getElementById("editSelectedBtn");
const statusEl = document.getElementById("status");

const state = {
  tabId: null,
  hostname: null,
  pageUrl: null,
  settings: { selectors: [], blockedPages: [], edits: {}, filterEnabled: true },
  tree: [],
  treeIndex: new Map(),
  expanded: new Set(["html"]),
  focusedSelector: null,
  focusedLabel: null,
  focusedAncestors: [],
  selectedSelector: null,
  selectedLabel: null,
  selectedAncestors: [],
  editingSelector: null,
  interactionMode: "off",
  history: [],
  treeScrollTop: 0,
  selectedPreviewSelector: null,
  hoveredSelector: null,
};

void bootstrap();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ELEMENT_HOVERED_BROADCAST") {
    if (message.tabId !== state.tabId || message.hostname !== state.hostname) return;
    state.hoveredSelector = message.selector || null;
    applyHoveredRowHighlight();
    return;
  }

  if (message?.type !== "ELEMENT_PICKED_BROADCAST") return;
  if (message.tabId !== state.tabId || message.hostname !== state.hostname) return;
  if (!message.element?.selector) return;

  state.selectedSelector = message.element.selector;
  state.selectedLabel = message.element.label || "Selected Element";
  state.selectedAncestors = Array.isArray(message.element.ancestors) ? message.element.ancestors : [];
  renderSelectedElementCard();

  if (message.interactionMode === "remove") {
    addSelector(message.element.selector, message.element.label || "Clicked element", true);
    setStatus("");
  } else if (message.interactionMode === "edit") {
    openEditPanel(message.element.selector, message.element.label || "Clicked element");
    setStatus("");
  } else {
    state.focusedSelector = message.element.selector;
    state.focusedLabel = message.element.label || "Clicked element";
    selectOnPage(message.element.selector);
    setStatus("");
  }

  renderTree();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== state.tabId || !changeInfo.url || !tab.url) return;
  await initializeTabContext(tab.url);
  await loadTree();
  renderTree();
});

pickModeBtn.addEventListener("click", () => {
  setInteractionMode("pick");
});

removeModeBtn.addEventListener("click", () => {
  setInteractionMode("remove");
});

directRemoveModeBtn.addEventListener("click", () => {
  setInteractionMode("direct-remove");
});

modeOffBtn.addEventListener("click", () => {
  setInteractionMode("off");
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

autoSelectBtn.addEventListener("click", async () => {
  const nextMode = state.interactionMode === "auto-select" ? "off" : "auto-select";
  await setInteractionMode(nextMode);
  setStatus(nextMode === "auto-select" ? "Auto-select enabled. Click × on page chunks to remove." : "Auto-select disabled.");
});

autoSelectScopeBtn.addEventListener("click", async () => {
  await setInteractionMode("auto-select-scope");
  setStatus("Click an area on the page to run auto-select inside it.");
});

filterToggleBtn.addEventListener("click", () => {
  snapshotHistory();
  state.settings.filterEnabled = !state.settings.filterEnabled;
  markDirty();
  updateFilterToggleBtn();
  void applyOnly();
  setStatus(state.settings.filterEnabled ? "Filter enabled." : "Filter disabled.");
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
  syncEditPanelWithState();
  renderTree();
  setStatus("");
});

resetBtn.addEventListener("click", () => {
  snapshotHistory();
  state.settings.selectors = [];
  state.settings.edits = {};
  markDirty();
  hideEditPanel();
  void applyOnly();
  syncEditPanelWithState();
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

closeEditBtn.addEventListener("click", hideEditPanel);
showInTreeBtn.addEventListener("click", () => {
  if (!state.selectedSelector) return;
  state.focusedSelector = state.selectedSelector;
  state.focusedLabel = state.selectedLabel;
  state.focusedAncestors = state.selectedAncestors;
  state.hoveredSelector = state.selectedSelector;
  expandAncestors();
  renderTree();
  selectOnPage(state.selectedSelector);
  requestAnimationFrame(() => {
    const node = treeContainer.querySelector(`[data-selector="${cssQuote(state.selectedSelector)}"]`);
    if (node) {
      treeContainer.scrollTop = node.offsetTop;
      applyHoveredRowHighlight();
    }
  });
});

hideSelectedBtn.addEventListener("click", () => {
  if (!state.selectedSelector) return;
  addSelector(state.selectedSelector, state.selectedLabel || "Selected element", true);
});

editSelectedBtn.addEventListener("click", () => {
  if (!state.selectedSelector) return;
  openEditPanel(state.selectedSelector, state.selectedLabel || "Selected element");
});

for (const control of [bgColorInput, textInput, widthPreset, heightPreset, layoutPreset]) {
  control.addEventListener("input", onEditControlChange);
  control.addEventListener("change", onEditControlChange);
}

templateSelect.addEventListener("change", async () => {
  const nextId = templateSelect.value;
  const template = state.settings.templates.find((item) => item.id === nextId);
  if (!template) return;
  snapshotHistory();
  state.settings.activeTemplateId = nextId;
  loadTemplateIntoTopLevel(template);
  renderTemplateSelect();
  updateBlockPageBtn();
  renderTree();
  await applyOnly();
  setStatus("Template selected.");
});

newTemplateBtn.addEventListener("click", async () => {
  const name = prompt("Template name", "New Template");
  if (!name) return;
  snapshotHistory();
  const template = makeTemplate(name.trim(), state.settings);
  state.settings.templates.push(template);
  state.settings.activeTemplateId = template.id;
  loadTemplateIntoTopLevel(template);
  renderTemplateSelect();
  renderTree();
  await applyOnly();
  setStatus("Template created.");
});

renameTemplateBtn.addEventListener("click", async () => {
  const active = getActiveTemplate();
  if (!active) return;
  const name = prompt("Rename template", active.name);
  if (!name) return;
  snapshotHistory();
  active.name = name.trim() || active.name;
  renderTemplateSelect();
  await applyOnly();
  setStatus("Template renamed.");
});

deleteTemplateBtn.addEventListener("click", async () => {
  if (state.settings.templates.length <= 1) {
    setStatus("At least one template is required.", true);
    return;
  }
  const active = getActiveTemplate();
  if (!active) return;
  snapshotHistory();
  state.settings.templates = state.settings.templates.filter((item) => item.id !== active.id);
  state.settings.activeTemplateId = state.settings.templates[0].id;
  loadTemplateIntoTopLevel(state.settings.templates[0]);
  renderTemplateSelect();
  renderTree();
  await applyOnly();
  setStatus("Template deleted.");
});

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
  state.selectedSelector = null;
  state.selectedLabel = null;
  state.selectedAncestors = [];
  state.selectedPreviewSelector = null;
  state.hoveredSelector = null;
  state.treeScrollTop = 0;
  hideEditPanel();
  renderSelectedElementCard();

  treeTitle.textContent = formatPageTitle(state.pageUrl);

  const response = await chrome.runtime.sendMessage({ type: "GET_SITE_SETTINGS", hostname: state.hostname });
  if (!response?.ok) {
    setStatus("Could not load settings.", true);
    return;
  }

  state.settings = normalizeSettings(response.settings);
  renderTemplateSelect();
  updateFilterToggleBtn();
  updateBlockPageBtn();
}

async function loadTree() {
  state.tree = [];
  state.treeIndex = new Map();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(state.tabId, { type: "DISCOVER_TREE" });
      state.tree = Array.isArray(response?.tree) ? response.tree : [];
      indexTree(state.tree);
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

function renderTree(preserveScroll = true) {
  if (preserveScroll) {
    state.treeScrollTop = treeContainer.scrollTop;
  }

  treeContainer.innerHTML = "";
  if (state.tree.length === 0) {
    treeContainer.textContent = "No elements detected.";
    return;
  }

  for (const node of state.tree) {
    treeContainer.appendChild(renderNode(node, 0));
  }

  if (preserveScroll) {
    requestAnimationFrame(() => {
      treeContainer.scrollTop = state.treeScrollTop;
    });
  }
}

function renderNode(node, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";
  wrapper.dataset.selector = node.selector;

  const row = document.createElement("div");
  row.className = "tree-row";
  if (state.focusedSelector === node.selector) row.classList.add("focused");
  if (state.hoveredSelector === node.selector) row.classList.add("hovered");
  row.style.paddingLeft = `${depth * 5}px`;

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "compact-check";
  checkbox.checked = !state.settings.selectors.includes(node.selector);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => {
    setSelectorEnabled(node.selector, !checkbox.checked);
    checkbox.checked = !state.settings.selectors.includes(node.selector);
    renderTree();
  });

  const text = document.createElement("div");
  text.className = "node-text";
  const label = document.createElement("span");
  label.className = "node-label";
  const childCount = Array.isArray(node.children) ? node.children.length : 0;
  label.textContent = `${node.label || "Div"} [${childCount}]`;
  text.append(label);

  const expandButton = document.createElement("button");
  expandButton.className = "expand-btn";
  expandButton.title = hasChildren ? "Expand/collapse children" : "No children";
  expandButton.textContent = hasChildren ? (state.expanded.has(node.selector) ? "−" : "+") : " ";
  expandButton.disabled = !hasChildren;
  expandButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!hasChildren) return;
    if (state.expanded.has(node.selector)) state.expanded.delete(node.selector);
    else state.expanded.add(node.selector);
    renderTree();
  });

  row.addEventListener("mouseenter", () => hoverSelector(node.selector, true));
  row.addEventListener("mouseleave", () => {
    if (state.selectedPreviewSelector === node.selector) return;
    hoverSelector(node.selector, false);
  });
  row.addEventListener("click", () => {
    state.focusedSelector = node.selector;
    state.focusedLabel = node.label;
    selectOnPage(node.selector);
    renderSelectedElementCard();
    renderTree();
  });

  row.append(checkbox, text, expandButton);
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
  if (!state.treeIndex.has(selector)) {
    state.tree.unshift({ label, selector, depth: 0, children: [] });
    indexTree(state.tree);
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
  if (!state.treeIndex.has(selector) && allowInsert) {
    state.tree.unshift({ label: fallbackLabel, selector, depth: 0, children: [] });
    indexTree(state.tree);
  }
  state.focusedSelector = selector;
  state.focusedLabel = fallbackLabel;

  requestAnimationFrame(() => {
    const node = treeContainer.querySelector(`[data-selector="${cssQuote(selector)}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "auto" });
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

function syncEditPanelWithState() {
  if (!state.editingSelector) return;
  const edit = state.settings.edits[state.editingSelector];
  if (!edit) {
    hideEditPanel();
    return;
  }
  bgColorInput.value = edit.backgroundColor || "#ffffff";
  textInput.value = edit.text || "";
  widthPreset.value = edit.widthPreset || "";
  heightPreset.value = edit.heightPreset || "";
  layoutPreset.value = edit.layoutPreset || "";
}

function expandAncestors() {
  for (const ancestor of state.focusedAncestors) {
    if (ancestor?.selector) state.expanded.add(ancestor.selector);
  }
}

function updateBlockPageBtn() {
  const blocked = state.settings.blockedPages.includes(state.pageUrl);
  blockPageBtn.textContent = blocked ? "Unblock This Page" : "Block This Page";
}

function updateFilterToggleBtn() {
  const enabled = state.settings.filterEnabled !== false;
  filterToggleBtn.textContent = enabled ? "Filter: On" : "Filter: Off";
  filterToggleBtn.classList.toggle("active", !enabled);
}

async function applyOnly() {
  syncTopLevelIntoActiveTemplate();
  const safeSettings = normalizeSettings(state.settings);
  state.settings = safeSettings;
  await chrome.runtime.sendMessage({ type: "APPLY_SETTINGS_TO_TAB", tabId: state.tabId, settings: safeSettings });
  await chrome.runtime.sendMessage({ type: "SAVE_SITE_SETTINGS", hostname: state.hostname, settings: safeSettings });
  saveBtn.classList.remove("active");
}

async function persistOnly() {
  syncTopLevelIntoActiveTemplate();
  const safeSettings = normalizeSettings(state.settings);
  state.settings = safeSettings;
  await chrome.runtime.sendMessage({ type: "SAVE_SITE_SETTINGS", hostname: state.hostname, settings: safeSettings });
  saveBtn.classList.remove("active");
}

async function setInteractionMode(mode) {
  state.interactionMode = mode;
  modeOffBtn.classList.toggle("active", mode === "off");
  pickModeBtn.classList.toggle("active", mode === "pick");
  removeModeBtn.classList.toggle("active", mode === "remove");
  directRemoveModeBtn.classList.toggle("active", mode === "direct-remove");
  autoSelectBtn.classList.toggle("active", mode === "auto-select");
  autoSelectScopeBtn.classList.toggle("active", mode === "auto-select-scope");

  await chrome.runtime.sendMessage({ type: "SIDEPANEL_SET_INTERACTION_MODE", tabId: state.tabId, mode });

  setStatus("");
}

function renderSelectedElementCard() {
  if (!state.selectedSelector) {
    selectedElementCard.classList.add("empty");
    selectedElementLabel.textContent = "No element selected";
    showInTreeBtn.disabled = true;
    hideSelectedBtn.disabled = true;
    editSelectedBtn.disabled = true;
    return;
  }

  selectedElementCard.classList.remove("empty");
  selectedElementLabel.textContent = state.selectedLabel || "Selected element";
  showInTreeBtn.disabled = false;
  hideSelectedBtn.disabled = false;
  editSelectedBtn.disabled = false;
}

function selectOnPage(selector) {
  if (state.selectedPreviewSelector && state.selectedPreviewSelector !== selector) {
    void hoverSelector(state.selectedPreviewSelector, false);
  }
  state.selectedPreviewSelector = selector;
  void hoverSelector(selector, true);
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
  const normalized = {
    ...normalizeBaseSettings(safe),
    templates: [],
    activeTemplateId: "",
  };

  if (Array.isArray(safe.templates) && safe.templates.length > 0) {
    normalized.templates = safe.templates
      .map((template) => normalizeTemplate(template))
      .filter(Boolean);
  }

  if (normalized.templates.length === 0) {
    const base = makeTemplate("Default", normalized);
    normalized.templates = [base];
    normalized.activeTemplateId = base.id;
  } else {
    normalized.activeTemplateId = safe.activeTemplateId && normalized.templates.some((item) => item.id === safe.activeTemplateId)
      ? safe.activeTemplateId
      : normalized.templates[0].id;
  }

  const active = normalized.templates.find((item) => item.id === normalized.activeTemplateId) || normalized.templates[0];
  normalized.filterEnabled = active.filterEnabled !== false;
  normalized.selectors = [...active.selectors];
  normalized.blockedPages = [...active.blockedPages];
  normalized.edits = JSON.parse(JSON.stringify(active.edits));
  return normalized;
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
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return `${host}${path}`;
  } catch {
    return "page";
  }
}

function markDirty() {
  saveBtn.classList.add("active");
}

function isEmptyEdit(edit) {
  return !edit.backgroundColor && !edit.text && !edit.widthPreset && !edit.heightPreset && !edit.layoutPreset;
}

function indexTree(nodes) {
  const index = new Map();
  const walk = (items, parent = null) => {
    for (const node of items) {
      if (!node?.selector) continue;
      index.set(node.selector, { node, parent });
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, node.selector);
      }
    }
  };
  walk(nodes);
  state.treeIndex = index;
}

function cssQuote(value) {
  return String(value).replaceAll('"', '\\"');
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function applyHoveredRowHighlight() {
  treeContainer.querySelectorAll(".tree-row.hovered").forEach((row) => row.classList.remove("hovered"));
  if (!state.hoveredSelector) return;
  const node = treeContainer.querySelector(`[data-selector="${cssQuote(state.hoveredSelector)}"] .tree-row`);
  if (node) node.classList.add("hovered");
}

function normalizeTemplate(template) {
  if (!template || typeof template !== "object") return null;
  const name = typeof template.name === "string" && template.name.trim() ? template.name.trim() : "Template";
  const id = typeof template.id === "string" && template.id ? template.id : `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normalized = normalizeBaseSettings({
    selectors: template.selectors,
    blockedPages: template.blockedPages,
    edits: template.edits,
  });
  return {
    id,
    name,
    filterEnabled: normalized.filterEnabled,
    selectors: normalized.selectors,
    blockedPages: normalized.blockedPages,
    edits: normalized.edits,
  };
}

function makeTemplate(name, sourceSettings) {
  return {
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || "Template",
    filterEnabled: sourceSettings.filterEnabled !== false,
    selectors: [...(sourceSettings.selectors || [])],
    blockedPages: [...(sourceSettings.blockedPages || [])],
    edits: JSON.parse(JSON.stringify(sourceSettings.edits || {})),
  };
}

function renderTemplateSelect() {
  templateSelect.innerHTML = "";
  for (const template of state.settings.templates) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    if (template.id === state.settings.activeTemplateId) option.selected = true;
    templateSelect.appendChild(option);
  }
}

function getActiveTemplate() {
  return state.settings.templates.find((item) => item.id === state.settings.activeTemplateId) || null;
}

function loadTemplateIntoTopLevel(template) {
  state.settings.filterEnabled = template.filterEnabled !== false;
  state.settings.selectors = [...template.selectors];
  state.settings.blockedPages = [...template.blockedPages];
  state.settings.edits = JSON.parse(JSON.stringify(template.edits));
  updateFilterToggleBtn();
}

function syncTopLevelIntoActiveTemplate() {
  const active = getActiveTemplate();
  if (!active) return;
  active.filterEnabled = state.settings.filterEnabled !== false;
  active.selectors = [...state.settings.selectors];
  active.blockedPages = [...state.settings.blockedPages];
  active.edits = JSON.parse(JSON.stringify(state.settings.edits));
}

function normalizeBaseSettings(settings) {
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
    filterEnabled: safe.filterEnabled !== false,
    selectors: Array.isArray(safe.selectors)
      ? [...new Set(safe.selectors.map((s) => String(s).trim()).filter(Boolean))]
      : [],
    blockedPages: Array.isArray(safe.blockedPages)
      ? [...new Set(safe.blockedPages.map((s) => normalizePageUrl(String(s))).filter(Boolean))]
      : [],
    edits,
  };
}
