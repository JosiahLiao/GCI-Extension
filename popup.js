import { z } from "./lib/zod/v4/index.js";

const Inaccuracy = z.object({
  quoted_text: z.string(),
  explanation: z.string(),
  sources: z.array(z.string()),
  confidence_level: z.string()
});

const TextEvaluation = z.object({
  overall_accuracy_score: z.number(),
  flagged_inaccuracies: z.array(Inaccuracy)
});

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const extractAndSendButton = document.getElementById('extractAndSend');
  const outputDiv = document.getElementById('output');

  // Load saved API key
  chrome.storage.sync.get('apiKey', (data) => {
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
    }
  });

  // Save API key
  apiKeyInput.addEventListener('change', () => {
    chrome.storage.sync.set({ apiKey: apiKeyInput.value });
  });

  extractAndSendButton.addEventListener('click', () => {
    outputDiv.innerText = 'Processing...';
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js']
      });
    });
  });

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'displayResult') {
      try {
        const parsedData = JSON.parse(request.data);
        const validatedData = TextEvaluation.parse(parsedData); // Zod validation

        // Store validated data in chrome.storage.local for the new popup to access
        await chrome.storage.local.set({ llmValidatedData: validatedData });

        // Open the new popup window
        chrome.windows.create({
          url: chrome.runtime.getURL('display_results.html'),
          type: 'popup',
          width: 450,
          height: 600,
        });

        // Optionally close the current popup or clear its content
        window.close(); // Close the current popup

      } catch (e) {
        console.error("Error processing API response:", e); // Log the full error
        console.log('Error type:', typeof e);
        if (e instanceof z.ZodError) {
          outputDiv.innerText = `Zod Validation Error: ${e.message}`; // Display the main error message
        } else {
          outputDiv.innerText = `Error parsing API response: ${request.data}. Detail: ${e.message}`;
        }
      }

    } else if (request.action === 'error') {
      outputDiv.innerText = `Error: ${request.data}`;

    }
  });
});
