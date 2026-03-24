chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

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
    sendTabMessage(message.tabId, {
      type: "APPLY_BLOCK_RULES",
      settings: message.settings,
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "SIDEPANEL_PICK_MODE") {
    sendTabMessage(message.tabId, {
      type: "SET_PICK_MODE",
      enabled: Boolean(message.enabled),
    })
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
    });
    sendResponse({ ok: true });
    return;
  }

  return undefined;
});

async function sendTabMessage(tabId, message) {
  if (typeof tabId !== "number") {
    return;
  }

  await chrome.tabs.sendMessage(tabId, message);
}

async function getSiteSettings(hostname) {
  const key = siteKey(hostname);
  const data = await chrome.storage.sync.get([key]);
  return data[key] ?? { selectors: [] };
}

async function saveSiteSettings(hostname, settings) {
  const key = siteKey(hostname);
  await chrome.storage.sync.set({
    [key]: {
      selectors: Array.isArray(settings?.selectors) ? settings.selectors : [],
    },
  });
}

function siteKey(hostname) {
  return `site:${hostname}`;
}
