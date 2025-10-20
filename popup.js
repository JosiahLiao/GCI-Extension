const DEFAULTS = { rate:1, pitch:1, volume:1, voiceURI:"", useChromeTTS:false };

function loadVoices(select, selectedURI) {
  const voices = speechSynthesis.getVoices();
  select.innerHTML = `<option value="">System default</option>` +
    voices.map(v => `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`).join("");
  if (selectedURI) select.value = selectedURI;
}

function saveSettings(partial) {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    const next = { ...DEFAULTS, ...cfg, ...partial };
    chrome.storage.sync.set(next, () => chrome.tabs.query({active:true,currentWindow:true}, (tabs)=>{
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "SETTINGS_UPDATED" });
    }));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const rate = document.getElementById("rate");
  const pitch = document.getElementById("pitch");
  const volume = document.getElementById("volume");
  const voice = document.getElementById("voice");
  const useChromeTTS = document.getElementById("useChromeTTS");

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    rate.value = cfg.rate; pitch.value = cfg.pitch; volume.value = cfg.volume; useChromeTTS.checked = !!cfg.useChromeTTS;
    loadVoices(voice, cfg.voiceURI);
  });

  speechSynthesis.onvoiceschanged = () => loadVoices(voice, voice.value);

  rate.addEventListener("input", () => saveSettings({ rate: parseFloat(rate.value) }));
  pitch.addEventListener("input", () => saveSettings({ pitch: parseFloat(pitch.value) }));
  volume.addEventListener("input", () => saveSettings({ volume: parseFloat(volume.value) }));
  voice.addEventListener("change", () => saveSettings({ voiceURI: voice.value }));
  useChromeTTS.addEventListener("change", () => saveSettings({ useChromeTTS: useChromeTTS.checked }));

  document.getElementById("analyze").onclick = () => chrome.tabs.query({active:true,currentWindow:true}, (tabs)=>{
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "ANALYZE" });
  });
  document.getElementById("readMain").onclick = () => chrome.tabs.query({active:true,currentWindow:true}, (tabs)=>{
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "READ_MAIN" });
  });
  document.getElementById("readSel").onclick = () => chrome.tabs.query({active:true,currentWindow:true}, (tabs)=>{
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "READ_SELECTION" });
  });
  document.getElementById("pause").onclick = () => chrome.tabs.query({active:true,currentWindow:true}, (tabs)=>{
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "PAUSE_RESUME" });
  });
  document.getElementById("stop").onclick = () => chrome.tabs.query({active:true,currentWindow:true}, (tabs)=>{
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "STOP" });
  });
});