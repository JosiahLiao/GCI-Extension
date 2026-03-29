(function() {
  const mainText = document.querySelector('main');
  const extractedText = mainText ? mainText.innerText : document.body.innerText;
  chrome.runtime.sendMessage({ action: 'processText', data: extractedText });
})();