// background.js
chrome.runtime.onInstalled.addListener(() => {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "read-selection", title: "Read selection", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "read-main", title: "Read main content", contexts: ["page"] });
    chrome.contextMenus.create({ id: "analyze", title: "Analyze & highlight key points", contexts: ["page"] });
  });
});

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab || !tab.id) return;
    if (info.menuItemId === "read-selection") chrome.tabs.sendMessage(tab.id, { type: "READ_SELECTION" });
    if (info.menuItemId === "read-main") chrome.tabs.sendMessage(tab.id, { type: "READ_MAIN" });
    if (info.menuItemId === "analyze") chrome.tabs.sendMessage(tab.id, { type: "ANALYZE" });
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  if (command === "read_page") chrome.tabs.sendMessage(tab.id, { type: "READ_MAIN" });
  if (command === "pause_resume") chrome.tabs.sendMessage(tab.id, { type: "PAUSE_RESUME" });
  if (command === "stop") chrome.tabs.sendMessage(tab.id, { type: "STOP" });
  if (command === "analyze") chrome.tabs.sendMessage(tab.id, { type: "ANALYZE" });
});