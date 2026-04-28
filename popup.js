document.addEventListener('DOMContentLoaded', () => {
  const extractAndSendButton = document.getElementById('extractAndSend');
  const outputDiv = document.getElementById('output');
  const allowOnWebsiteCheckbox = document.getElementById('allowOnWebsite');
  const runAutomaticallyCheckbox = document.getElementById('runAutomatically');
  const toggleWebsitesLink = document.getElementById('toggleWebsites');
  const acceptedWebsitesList = document.getElementById('acceptedWebsitesList');

  let currentDomain = "";

  function getDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      return "";
    }
  }

  // Load saved settings
  chrome.storage.sync.get(['acceptedWebsites', 'runAutomatically'], (data) => {
    if (data.runAutomatically) runAutomaticallyCheckbox.checked = data.runAutomatically;
    
    const acceptedWebsites = data.acceptedWebsites || [];
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        currentDomain = getDomain(tabs[0].url);
        if (currentDomain) {
          allowOnWebsiteCheckbox.checked = acceptedWebsites.includes(currentDomain);
        } else {
          allowOnWebsiteCheckbox.disabled = true;
        }
      }
      updateWebsitesList(acceptedWebsites);
    });
  });

  // Handle "Allow on this website" checkbox
  allowOnWebsiteCheckbox.addEventListener('change', () => {
    if (!currentDomain) return;
    
    chrome.storage.sync.get(['acceptedWebsites'], (data) => {
      let acceptedWebsites = data.acceptedWebsites || [];
      if (allowOnWebsiteCheckbox.checked) {
        if (!acceptedWebsites.includes(currentDomain)) {
          acceptedWebsites.push(currentDomain);
        }
      } else {
        acceptedWebsites = acceptedWebsites.filter(domain => domain !== currentDomain);
      }
      chrome.storage.sync.set({ acceptedWebsites }, () => {
        updateWebsitesList(acceptedWebsites);
      });
    });
  });

  // Handle "Run automatically" checkbox
  runAutomaticallyCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ runAutomatically: runAutomaticallyCheckbox.checked });
  });

  // Toggle websites list
  toggleWebsitesLink.addEventListener('click', () => {
    const isHidden = acceptedWebsitesList.style.display === 'none' || !acceptedWebsitesList.style.display;
    acceptedWebsitesList.style.display = isHidden ? 'block' : 'none';
    toggleWebsitesLink.innerText = isHidden ? 'Hide accepted websites' : 'View all accepted websites';
  });

  function updateWebsitesList(websites) {
    acceptedWebsitesList.innerHTML = '';
    if (websites.length === 0) {
      acceptedWebsitesList.innerHTML = '<div style="padding: 5px; color: #666;">No accepted websites yet.</div>';
      return;
    }
    
    websites.forEach(domain => {
      const item = document.createElement('div');
      item.className = 'website-item';
      item.innerHTML = `
        <span>${domain}</span>
        <span class="remove-website" data-domain="${domain}">&times;</span>
      `;
      acceptedWebsitesList.appendChild(item);
    });

    acceptedWebsitesList.querySelectorAll('.remove-website').forEach(btn => {
      btn.onclick = (e) => {
        const domainToRemove = e.target.getAttribute('data-domain');
        chrome.storage.sync.get(['acceptedWebsites'], (data) => {
          const acceptedWebsites = (data.acceptedWebsites || []).filter(d => d !== domainToRemove);
          chrome.storage.sync.set({ acceptedWebsites }, () => {
            updateWebsitesList(acceptedWebsites);
            if (domainToRemove === currentDomain) {
              allowOnWebsiteCheckbox.checked = false;
            }
          });
        });
      };
    });
  }

  extractAndSendButton.addEventListener('click', () => {
    console.log("Extract and Send button clicked");
    outputDiv.innerText = 'Processing... Results will appear as an overlay on the page.';
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          if (window.truthForgeManualTrigger) {
            window.truthForgeManualTrigger();
          } else {
            location.reload(); 
          }
        }
      }, () => {
        if (chrome.runtime.lastError) {
          console.error("Script execution failed:", chrome.runtime.lastError.message);
          outputDiv.innerText = "Error: Could not trigger extraction. Try refreshing the page.";
        } else {
          console.log("Extraction triggered successfully");
          setTimeout(() => window.close(), 2000);
        }
      });
    });
  });

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
  
});
