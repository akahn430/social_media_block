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
    selectors: Array.isArray(safe.selectors)
      ? [...new Set(safe.selectors.map((item) => String(item).trim()).filter(Boolean))]
      : [],
    blockedPages: Array.isArray(safe.blockedPages)
      ? [...new Set(safe.blockedPages.map((item) => normalizePageUrl(String(item))).filter(Boolean))]
      : [],
    edits,
  };
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
