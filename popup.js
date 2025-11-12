
function send(type){
  chrome.tabs.query({active:true,currentWindow:true}, tabs=>{
    if(!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type }, ()=>{
      if(chrome.runtime.lastError){
        alert('⚠️ Cannot run on this page. Try a normal website.');
        console.warn(chrome.runtime.lastError.message);
      }
    });
  });
}
document.getElementById('offline').onclick = ()=> send('ANALYZE_OFFLINE');
document.getElementById('online').onclick = ()=> send('ANALYZE_ONLINE');

//Gets current website name and sends it to popup.html 
   const websiteEl = document.getElementById("currentWebsite");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) {
      websiteEl.textContent = "Unable to detect website";
      return;
    }

    try {
      const url = new URL(tab.url);
      websiteEl.textContent = url.hostname;
      websiteEl.title = url.href;
    } catch (e) {
      websiteEl.textContent = "Invalid URL";
    }
  });