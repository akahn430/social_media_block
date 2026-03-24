const profileSelect = document.getElementById("profileSelect");
const newProfileNameInput = document.getElementById("newProfileName");
const addProfileBtn = document.getElementById("addProfileBtn");
const deleteProfileBtn = document.getElementById("deleteProfileBtn");
const refreshBlocksBtn = document.getElementById("refreshBlocksBtn");
const blocksList = document.getElementById("blocksList");
const customSelectorInput = document.getElementById("customSelectorInput");
const addCustomSelectorBtn = document.getElementById("addCustomSelectorBtn");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const siteSubtitle = document.getElementById("siteSubtitle");

const DEFAULT_PROFILE = "Default";

const state = {
  tabId: null,
  hostname: null,
  settings: {
    activeProfile: DEFAULT_PROFILE,
    profiles: {
      [DEFAULT_PROFILE]: {
        selectors: [],
      },
    },
  },
  detectedBlocks: [],
};

void bootstrap();

addProfileBtn.addEventListener("click", () => {
  const profileName = newProfileNameInput.value.trim();
  if (!profileName) {
    setStatus("Enter a profile name.", true);
    return;
  }

  if (state.settings.profiles[profileName]) {
    setStatus("Profile already exists.", true);
    return;
  }

  state.settings.profiles[profileName] = { selectors: [] };
  state.settings.activeProfile = profileName;
  newProfileNameInput.value = "";
  renderProfiles();
  renderBlocks();
  setStatus(`Created profile '${profileName}'.`);
});

deleteProfileBtn.addEventListener("click", () => {
  const profileName = profileSelect.value;
  if (profileName === DEFAULT_PROFILE) {
    setStatus("Default profile cannot be deleted.", true);
    return;
  }

  delete state.settings.profiles[profileName];
  state.settings.activeProfile = DEFAULT_PROFILE;
  renderProfiles();
  renderBlocks();
  setStatus(`Deleted profile '${profileName}'.`);
});

profileSelect.addEventListener("change", () => {
  state.settings.activeProfile = profileSelect.value;
  renderBlocks();
});

refreshBlocksBtn.addEventListener("click", async () => {
  await loadDetectedBlocks();
  renderBlocks();
  setStatus("Detected blocks refreshed.");
});

addCustomSelectorBtn.addEventListener("click", () => {
  const selector = customSelectorInput.value.trim();
  if (!selector) {
    setStatus("Enter a selector first.", true);
    return;
  }

  const selectors = getActiveSelectors();
  if (!selectors.includes(selector)) {
    selectors.push(selector);
  }
  customSelectorInput.value = "";
  renderBlocks();
  setStatus("Custom selector added.");
});

saveBtn.addEventListener("click", async () => {
  if (!state.hostname) {
    setStatus("No active website found.", true);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_SITE_SETTINGS",
    hostname: state.hostname,
    settings: state.settings,
    tabId: state.tabId,
  });

  if (!response?.ok) {
    setStatus(response?.error || "Could not save settings.", true);
    return;
  }

  setStatus("Saved and applied to current tab.");
});

async function bootstrap() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id || !activeTab.url) {
    setStatus("Open a regular webpage to configure blocking.", true);
    return;
  }

  state.tabId = activeTab.id;

  try {
    state.hostname = new URL(activeTab.url).hostname;
    siteSubtitle.textContent = `Site: ${state.hostname}`;
  } catch {
    setStatus("This tab cannot be configured.", true);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "GET_SITE_SETTINGS",
    hostname: state.hostname,
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to load site settings.", true);
    return;
  }

  state.settings = normalizeSettings(response.settings);
  await loadDetectedBlocks();
  renderProfiles();
  renderBlocks();
}

async function loadDetectedBlocks() {
  if (!state.tabId) {
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(state.tabId, {
      type: "DISCOVER_BLOCKS",
    });

    state.detectedBlocks = (response?.blocks ?? []).filter(
      (block) => block?.selector && block?.label
    );
  } catch {
    state.detectedBlocks = [];
    setStatus("Could not inspect this page (browser-restricted tab?).", true);
  }
}

function renderProfiles() {
  profileSelect.innerHTML = "";
  const names = Object.keys(state.settings.profiles).sort((a, b) =>
    a.localeCompare(b)
  );

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === state.settings.activeProfile;
    profileSelect.appendChild(option);
  }
}

function renderBlocks() {
  blocksList.innerHTML = "";
  const activeSelectors = new Set(getActiveSelectors());

  const combined = [...state.detectedBlocks];
  for (const selector of activeSelectors) {
    if (!combined.some((item) => item.selector === selector)) {
      combined.push({ label: "Custom rule", selector });
    }
  }

  if (combined.length === 0) {
    const empty = document.createElement("li");
    empty.className = "block-item";
    empty.textContent =
      "No blocks detected on this page yet. Add custom selectors or refresh.";
    blocksList.appendChild(empty);
    return;
  }

  combined.forEach((block, index) => {
    const listItem = document.createElement("li");
    listItem.className = "block-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `block-${index}`;
    checkbox.checked = activeSelectors.has(block.selector);

    checkbox.addEventListener("change", () => {
      const selectors = getActiveSelectors();
      const hasSelector = selectors.includes(block.selector);

      if (checkbox.checked && !hasSelector) {
        selectors.push(block.selector);
      }

      if (!checkbox.checked && hasSelector) {
        state.settings.profiles[state.settings.activeProfile].selectors = selectors.filter(
          (entry) => entry !== block.selector
        );
      }
    });

    const label = document.createElement("label");
    label.className = "block-label";
    label.htmlFor = checkbox.id;

    const title = document.createElement("span");
    title.textContent = block.label;

    const selector = document.createElement("small");
    selector.className = "block-selector";
    selector.textContent = block.selector;

    label.append(title, selector);
    listItem.append(checkbox, label);
    blocksList.appendChild(listItem);
  });
}

function getActiveSelectors() {
  const profile = state.settings.profiles[state.settings.activeProfile];
  if (!profile) {
    state.settings.profiles[state.settings.activeProfile] = { selectors: [] };
    return state.settings.profiles[state.settings.activeProfile].selectors;
  }

  if (!Array.isArray(profile.selectors)) {
    profile.selectors = [];
  }

  return profile.selectors;
}

function normalizeSettings(rawSettings) {
  const fallback = {
    activeProfile: DEFAULT_PROFILE,
    profiles: {
      [DEFAULT_PROFILE]: { selectors: [] },
    },
  };

  if (!rawSettings || typeof rawSettings !== "object") {
    return fallback;
  }

  const profiles = rawSettings.profiles && typeof rawSettings.profiles === "object"
    ? rawSettings.profiles
    : fallback.profiles;

  if (!profiles[DEFAULT_PROFILE]) {
    profiles[DEFAULT_PROFILE] = { selectors: [] };
  }

  const activeProfile =
    rawSettings.activeProfile && profiles[rawSettings.activeProfile]
      ? rawSettings.activeProfile
      : DEFAULT_PROFILE;

  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile || !Array.isArray(profile.selectors)) {
      profiles[name] = { selectors: [] };
    }
  }

  return { activeProfile, profiles };
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
