
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
