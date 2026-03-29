document.addEventListener('DOMContentLoaded', async () => {
  const overallScoreDiv = document.getElementById('overallScore');
  const inaccuraciesContainer = document.getElementById('inaccuraciesContainer');

  // Retrieve validated data from chrome.storage.local
  const data = await chrome.storage.local.get('llmValidatedData');
  const validatedData = data.llmValidatedData;

  if (!validatedData) {
    overallScoreDiv.innerText = 'No results to display.';
    return;
  }

  overallScoreDiv.innerText = `Overall Accuracy Score: ${validatedData.overall_accuracy_score}%`;

  if (validatedData.flagged_inaccuracies && validatedData.flagged_inaccuracies.length > 0) {
    validatedData.flagged_inaccuracies.forEach((inaccuracy, index) => {
      const inaccuracyItem = document.createElement('div');
      inaccuracyItem.className = 'inaccuracy-item';

      inaccuracyItem.innerHTML = `
        <h3>Inaccuracy ${index + 1}</h3>
        <p><strong>Quoted Text:</strong> ${inaccuracy.quoted_text}</p>
        <p><strong>Explanation:</strong> ${inaccuracy.explanation}</p>
        <p><strong>Confidence Level:</strong> ${inaccuracy.confidence_level}</p>
        <p><strong>Sources:</strong></p>
        <ul class="sources-list">
          ${inaccuracy.sources.map(source => {
            // Helper to make source text clickable if it's a URL or contains one
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            if (urlRegex.test(source)) {
               return `<li>${source.replace(urlRegex, (url) => `<a href="${url}" target="_blank">${url}</a>`)}</li>`;
            }
            return `<li>${source}</li>`;
          }).join('')}
        </ul>
      `;
      inaccuraciesContainer.appendChild(inaccuracyItem);
    });
  } else {
    inaccuraciesContainer.innerText = 'No flagged inaccuracies found. Content appears accurate.';
  }

  // Clear the stored data after displaying
  await chrome.storage.local.remove('llmValidatedData');
});