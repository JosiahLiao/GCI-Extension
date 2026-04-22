(function() {
  const mainText = document.querySelector('main');
  const extractedText = mainText ? mainText.innerText : document.body.innerText;
  console.log("Extracted text:", extractedText);
  chrome.runtime.sendMessage({ action: 'processText', data: extractedText });
})();