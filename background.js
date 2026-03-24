const DEFAULT_PROFILE_NAME = "Default";

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
    await sendApplyMessage(tabId, settings);
  } catch {
    // Ignore special URLs and restricted pages.
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
      .then(async () => {
        const tabId = sender.tab?.id ?? message.tabId;
        if (typeof tabId === "number") {
          await sendApplyMessage(tabId, message.settings);
        }
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "APPLY_TO_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs?.[0];
      if (!activeTab?.id || !activeTab.url) {
        sendResponse({ ok: false, error: "No active tab found." });
        return;
      }
      try {
        const hostname = new URL(activeTab.url).hostname;
        const settings = await getSiteSettings(hostname);
        await sendApplyMessage(activeTab.id, settings);
        sendResponse({ ok: true, hostname, settings });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    });
    return true;
  }

  return undefined;
});

async function sendApplyMessage(tabId, settings) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "APPLY_BLOCK_RULES",
      settings,
    });
  } catch {
    // Content script may not be available for browser internal pages.
  }
}

async function getSiteSettings(hostname) {
  const key = getStorageKey(hostname);
  const data = await chrome.storage.sync.get([key]);
  return (
    data[key] ?? {
      activeProfile: DEFAULT_PROFILE_NAME,
      profiles: {
        [DEFAULT_PROFILE_NAME]: {
          selectors: [],
        },
      },
    }
  );
}

async function saveSiteSettings(hostname, settings) {
  const key = getStorageKey(hostname);
  await chrome.storage.sync.set({ [key]: settings });
}

function getStorageKey(hostname) {
  return `site:${hostname}`;
}
