const cardsContainer = document.getElementById("cardsContainer");
const statusEl = document.getElementById("status");

const TWITTER_RULES = [
  { id: "upgrade_premium", label: "Upgrade to Premium+", group: "Left Bar", match: { type: "aria", value: "Upgrade to Premium+" } },
  { id: "todays_news", label: "Today's News", group: "Left Bar", match: { type: "class", value: "css-175oi2r r-14lw9ot r-jxzhtn r-1867qdf r-1phboty r-rs99b7 r-1ifxtd0 r-1udh08x", index: 0 } },
  { id: "whats_happening", label: "What's Happening", group: "Left Bar", match: { type: "class", value: "css-175oi2r r-14lw9ot r-jxzhtn r-1867qdf r-1phboty r-rs99b7 r-1ifxtd0 r-1udh08x", index: 1 } },
  { id: "who_to_follow", label: "Who to Follow", group: "Left Bar", match: { type: "class", value: "css-175oi2r r-14lw9ot r-jxzhtn r-1867qdf r-1phboty r-rs99b7 r-1ifxtd0 r-1udh08x", index: 2 } },

  { id: "feed_header", label: "Feed Header", group: "Feed", match: { type: "class", value: "css-175oi2r r-aqfbo4 r-gtdqiz r-1gn8etr r-4zbufd r-1g40b8q" } },
  { id: "post_box", label: "Post Box", group: "Feed", match: { type: "class", value: "css-175oi2r r-14lw9ot r-184en5c" } },
  { id: "post_feed", label: "Post Feed", group: "Feed", match: { type: "class", value: "css-175oi2r r-f8sm7e r-13qz1uu r-1ye8kvj" } },

  { id: "x_logo", label: "X Logo", group: "Left Nav", match: { type: "class", value: "css-175oi2r r-dnmrzs r-1559e4e" } },
  { id: "home_icon", label: "Home Icon", group: "Left Nav", match: { type: "aria", value: "Home (New unread posts)" } },
  { id: "search", label: "Search", group: "Left Nav", match: { type: "aria", value: "Search and explore" } },
  { id: "notifications", label: "Notifications", group: "Left Nav", match: { type: "aria", value: "Notifications" } },
  { id: "chat", label: "Chat", group: "Left Nav", match: { type: "aria", value: "Direct Messages" } },
  { id: "grok", label: "Grok", group: "Left Nav", match: { type: "aria", value: "Grok" } },
  { id: "premium", label: "Premium", group: "Left Nav", match: { type: "aria", value: "Premium" } },
  { id: "bookmarks", label: "Bookmarks", group: "Left Nav", match: { type: "aria", value: "Bookmarks" } },
  { id: "articles", label: "Articles", group: "Left Nav", match: { type: "aria", value: "Articles" } },
  { id: "profile", label: "Profile", group: "Left Nav", match: { type: "aria", value: "Profile" } },
  { id: "more_menu", label: "More Menu", group: "Left Nav", match: { type: "aria", value: "More menu items" } },
  { id: "create_post", label: "Create Post", group: "Left Nav", match: { type: "class", value: "css-175oi2r r-l00any r-e7q0ms r-1awozwy" } },
  { id: "profile_menu", label: "Profile Menu", group: "Left Nav", match: { type: "class", value: "css-175oi2r r-184id4b r-1awozwy" } },
];

const state = {
  tabId: null,
  isTwitter: false,
  toggles: Object.fromEntries(TWITTER_RULES.map((rule) => [rule.id, true])),
};

void init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    setStatus("Open twitter.com or x.com in the active tab.");
    return;
  }

  state.tabId = tab.id;
  const host = new URL(tab.url).hostname;
  state.isTwitter = host.includes("twitter.com") || host.includes("x.com");

  if (!state.isTwitter) {
    setStatus("This panel works on twitter.com / x.com tabs.");
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "GET_TWITTER_PREFS" });
  if (response?.ok && response.prefs?.toggles) {
    state.toggles = { ...state.toggles, ...response.prefs.toggles };
  }

  renderCards();
  await applyPrefs();
  setStatus("Ready.");
}

function renderCards() {
  cardsContainer.innerHTML = "";

  for (const rule of TWITTER_RULES) {
    const card = document.createElement("article");
    card.className = "card";

    const labelWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = rule.label;
    const subtitle = document.createElement("p");
    subtitle.className = "card-subtitle";
    subtitle.textContent = `${rule.group} • ${describeMatch(rule.match)}`;
    labelWrap.append(title, subtitle);

    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.toggles[rule.id] !== false;

    const slider = document.createElement("span");
    slider.className = "slider";
    switchLabel.append(input, slider);

    input.addEventListener("change", async () => {
      state.toggles[rule.id] = input.checked;
      await savePrefs();
      await applyPrefs();
      setStatus(input.checked ? `Showing ${rule.label}.` : `Hiding ${rule.label}.`);
    });

    card.addEventListener("mouseenter", () => highlightRule(rule.id, true));
    card.addEventListener("mouseleave", () => highlightRule(rule.id, false));

    card.append(labelWrap, switchLabel);
    cardsContainer.append(card);
  }
}

function describeMatch(match) {
  if (match.type === "aria") return `aria-label=\"${match.value}\"`;
  if (match.type === "class") return `class=${match.value}`;
  return "selector";
}

async function highlightRule(ruleId, enabled) {
  if (!state.isTwitter || !state.tabId) return;
  await chrome.runtime.sendMessage({
    type: "TWITTER_HIGHLIGHT_RULE",
    tabId: state.tabId,
    ruleId,
    enabled,
    rules: TWITTER_RULES,
  });
}

async function applyPrefs() {
  if (!state.isTwitter || !state.tabId) return;
  await chrome.runtime.sendMessage({
    type: "APPLY_TWITTER_PREFS_TO_TAB",
    tabId: state.tabId,
    prefs: { toggles: state.toggles },
    rules: TWITTER_RULES,
  });
}

async function savePrefs() {
  await chrome.runtime.sendMessage({
    type: "SAVE_TWITTER_PREFS",
    prefs: { toggles: state.toggles },
  });
}

function setStatus(message) {
  statusEl.textContent = message;
}
