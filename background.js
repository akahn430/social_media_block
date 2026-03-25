chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  try {
    const hostname = new URL(tab.url).hostname;
    const settings = await getSiteSettings(hostname);
    await sendTabMessage(tabId, { type: "APPLY_BLOCK_RULES", settings });
  } catch {
    // Ignore restricted/internal URLs.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_SITE_SETTINGS") {
    getSiteSettings(message.hostname)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "SAVE_SITE_SETTINGS") {
    saveSiteSettings(message.hostname, message.settings)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "APPLY_SETTINGS_TO_TAB") {
    sendTabMessage(message.tabId, { type: "APPLY_BLOCK_RULES", settings: message.settings })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "APPLY_QUICK_EDIT") {
    applyQuickEdit(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "SIDEPANEL_SET_INTERACTION_MODE") {
    sendTabMessage(message.tabId, { type: "SET_INTERACTION_MODE", mode: message.mode })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "SIDEPANEL_HIGHLIGHT_SELECTOR") {
    sendTabMessage(message.tabId, {
      type: "HIGHLIGHT_SELECTOR",
      selector: message.selector,
      enabled: Boolean(message.enabled),
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "ELEMENT_PICKED") {
    chrome.runtime.sendMessage({
      type: "ELEMENT_PICKED_BROADCAST",
      tabId: sender.tab?.id,
      hostname: message.hostname,
      element: message.element,
      interactionMode: message.interactionMode,
    });
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "ELEMENT_HOVERED") {
    chrome.runtime.sendMessage({
      type: "ELEMENT_HOVERED_BROADCAST",
      tabId: sender.tab?.id,
      hostname: message.hostname,
      selector: typeof message.selector === "string" ? message.selector : null,
    });
    sendResponse({ ok: true });
    return;
  }

  return undefined;
});

async function sendTabMessage(tabId, message) {
  if (typeof tabId !== "number") return;
  await chrome.tabs.sendMessage(tabId, message);
}

async function getSiteSettings(hostname) {
  const key = siteKey(hostname);
  const data = await chrome.storage.sync.get([key]);
  return normalizeSettings(data[key]);
}

async function saveSiteSettings(hostname, settings) {
  const key = siteKey(hostname);
  await chrome.storage.sync.set({ [key]: normalizeSettings(settings) });
}

function normalizeSettings(settings) {
  const safe = settings ?? {};
  const normalized = {
    ...normalizeBaseSettings(safe),
    templates: [],
    activeTemplateId: "",
  };

  if (Array.isArray(safe.templates) && safe.templates.length > 0) {
    normalized.templates = safe.templates.map((template) => normalizeTemplate(template)).filter(Boolean);
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

function siteKey(hostname) {
  return `site:${hostname}`;
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

function normalizeTemplate(template) {
  if (!template || typeof template !== "object") return null;
  const name = typeof template.name === "string" && template.name.trim() ? template.name.trim() : "Template";
  const id = typeof template.id === "string" && template.id ? template.id : `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normalized = normalizeBaseSettings({
    selectors: template.selectors,
    blockedPages: template.blockedPages,
    edits: template.edits,
  });
  return { id, name, ...normalized };
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
    }
  }

  return {
    filterEnabled: safe.filterEnabled !== false,
    selectors: Array.isArray(safe.selectors)
      ? [...new Set(safe.selectors.map((item) => String(item).trim()).filter(Boolean))]
      : [],
    blockedPages: Array.isArray(safe.blockedPages)
      ? [...new Set(safe.blockedPages.map((item) => normalizePageUrl(String(item))).filter(Boolean))]
      : [],
    edits,
  };
}

async function applyQuickEdit(message, sender) {
  if (!message?.hostname || !message?.selector || !message?.edit) return;
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number") return;
  const settings = await getSiteSettings(message.hostname);
  settings.edits[message.selector] = {
    backgroundColor: typeof message.edit.backgroundColor === "string" ? message.edit.backgroundColor : "",
    text: typeof message.edit.text === "string" ? message.edit.text : "",
    widthPreset: typeof message.edit.widthPreset === "string" ? message.edit.widthPreset : "",
    heightPreset: typeof message.edit.heightPreset === "string" ? message.edit.heightPreset : "",
    layoutPreset: typeof message.edit.layoutPreset === "string" ? message.edit.layoutPreset : "",
  };
  const active = settings.templates.find((item) => item.id === settings.activeTemplateId);
  if (active) active.edits = JSON.parse(JSON.stringify(settings.edits));
  await saveSiteSettings(message.hostname, settings);
  await sendTabMessage(tabId, { type: "APPLY_BLOCK_RULES", settings });
}
