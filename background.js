let cachedInstructions = null;

// The AWS API Gateway endpoint (Update this with your actual URL)
const PROXY_URL = 'https://16z7cirb83.execute-api.us-east-2.amazonaws.com/dev/new-resource';

async function getInstructions() {
  if (cachedInstructions) return cachedInstructions;
  try {
    const instructionsUrl = chrome.runtime.getURL('LLM_instructions.prompt');
    const response = await fetch(instructionsUrl);
    if (response.ok) {
      cachedInstructions = await response.text();
      return cachedInstructions;
    }
  } catch (error) {
    console.error("Failed to pre-fetch instructions:", error);
  }
  return "";
}

chrome.runtime.onStartup.addListener(() => {
    getInstructions();
});

chrome.runtime.onInstalled.addListener(() => {
    getInstructions();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processText') {
    const extractedText = request.data;
    const tabId = sender.tab.id;

    (async () => {
      try {
        const instructions = await getInstructions();

        // Calling the AWS Proxy instead of OpenAI directly
        const response = await fetch(PROXY_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            extractedText: extractedText,
            instructions: instructions
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          const detailedError = errorData.message || errorData.error || 'Unknown error';
          throw new Error(`Proxy error: ${response.status} - ${detailedError}`);
        }

        let result = await response.json();
        console.log("TruthForge: Received response:", result);

        // Helper to find 'choices' anywhere in the object (handles unexpected nesting)
        function findChoices(obj) {
          if (obj && obj.choices) return obj.choices;
          if (obj && obj.body && typeof obj.body === 'object' && obj.body.choices) return obj.body.choices;
          if (obj && typeof obj.body === 'string') {
            try {
              const parsed = JSON.parse(obj.body);
              if (parsed.choices) return parsed.choices;
            } catch (e) {}
          }
          return null;
        }

        const choices = findChoices(result);

        if (choices && choices[0] && choices[0].message) {
          const LLM_out_text = choices[0].message.content;
          try {
            const parsedData = JSON.parse(LLM_out_text);
            chrome.tabs.sendMessage(tabId, { action: 'showOverlay', data: parsedData });
          } catch (e) {
            console.error("TruthForge: Error parsing LLM output:", e);
            chrome.tabs.sendMessage(tabId, { action: 'error', data: "Failed to parse validation results." });
          }
        } else {
          // If we still can't find it, provide a very detailed error
          const keys = Object.keys(result).join(', ');
          console.error("TruthForge: Structure mismatch. Keys found:", keys, result);
          
          let errorHint = "The 'choices' field was not found in the response.";
          if (result.error) errorHint = `OpenAI Error: ${result.error.message || JSON.stringify(result.error)}`;
          else if (result.message === "Endpoint request timed out") errorHint = "AWS Gateway Timeout: Increase your Lambda timeout to 30 seconds.";
          
          throw new Error(`${errorHint} (Found keys: ${keys})`);
        }

      } catch (error) {
        console.error("API call failed: ", error);
        chrome.tabs.sendMessage(tabId, { action: 'error', data: error.message });
      }
    })();
  }
});
