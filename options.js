const DEFAULTS = { skipSelectors: [] };

document.addEventListener("DOMContentLoaded", () => {
  const ta = document.getElementById("selectors");
  const status = document.getElementById("status");

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    ta.value = (cfg.skipSelectors || []).join("\n");
  });

  document.getElementById("save").onclick = () => {
    const list = ta.value.split(/\n+/).map(s => s.trim()).filter(Boolean);
    chrome.storage.sync.set({ skipSelectors: list }, () => {
      status.textContent = "Saved.";
      setTimeout(()=> status.textContent = "", 1200);
      chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "SETTINGS_UPDATED" });
      });
    });
  };
});