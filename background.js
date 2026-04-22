let cachedInstructions = null;

// Pre-fetch instructions at startup to reduce latency during the first call
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
    console.log(`onStartup()`);
    getInstructions(); // Initial fetch
});

// Also fetch on installation or reload
chrome.runtime.onInstalled.addListener(() => {
    getInstructions();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processText') {
    const extractedText = request.data;
    console.log("Extracted text in background:", extractedText);
    
    // Get API key from storage
    chrome.storage.sync.get('apiKey', (data) => {
      if (!data.apiKey) {
        chrome.runtime.sendMessage({ action: 'error', data: 'API key not set.' });
        return;
      }
      const apiKey = data.apiKey;

      (async () => {
        try {
          const instructions = await getInstructions();

          // Speed up: Using gpt-4o-mini which is significantly faster than larger models
          // while maintaining high reasoning capabilities for scientific validation.
          const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: "gpt-4o-mini", 
              messages: [{
                role: "system",
                content: instructions
              }, {
                role: "user",
                content: ("INPUT: " + extractedText)
              }],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "scientific_evaluation",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      overall_accuracy_score: { "type": "number" },
                      flagged_inaccuracies: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            quoted_text: { "type": "string" },
                            explanation: { "type": "string" },
                            sources: { "type": "array", "items": { "type": "string" } },
                            confidence_level: { "type": "string", "enum": ["high", "medium", "low"] }
                          },
                          required: ["quoted_text", "explanation", "sources", "confidence_level"],
                          additionalProperties: false
                        }
                      }
                    },
                    required: ["overall_accuracy_score", "flagged_inaccuracies"],
                    additionalProperties: false
                  }
                }
              }
            })
          });

          if (!openaiResponse.ok) {
            const errorData = await openaiResponse.json();
            throw new Error(`OpenAI API error: ${openaiResponse.status} - ${errorData.error.message}`);
          }

          const result = await openaiResponse.json();
          const LLM_out_text = result.choices[0].message.content;

          chrome.runtime.sendMessage({ action: 'displayResult', data: LLM_out_text });
        } catch (error) {
          console.error("OpenAI API call failed: ", error);
          chrome.runtime.sendMessage({ action: 'error', data: error.message });
        }
      })();
    });
  }
});
