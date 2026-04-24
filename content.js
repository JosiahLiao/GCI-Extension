if (!window.truthForgeInitialized) {
  window.truthForgeInitialized = true;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showOverlay') {
      showResultsOverlay(request.data);
    } else if (request.action === 'error') {
      alert("TruthForge Error: " + request.data);
    }
  });

  checkAutoRun();
}

function checkAutoRun() {
  chrome.storage.sync.get(['runAutomatically', 'acceptedWebsites'], (data) => {
    if (data.runAutomatically) {
      const currentDomain = window.location.hostname;
      const acceptedWebsites = data.acceptedWebsites || [];
      if (acceptedWebsites.includes(currentDomain)) {
        extractAndSend();
      }
    }
  });
}

function extractAndSend() {
  const mainText = document.querySelector('main');
  const extractedText = mainText ? mainText.innerText : document.body.innerText;
  chrome.runtime.sendMessage({ action: 'processText', data: extractedText });
}

/**
 * Maps the current DOM text nodes into an aggregate string for searching.
 */
function getDOMMapping() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let aggregate = "";
  const mappings = [];
  let node;

  while (node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName) || parent.closest('#truthforge-overlay-root')) continue;

    const content = node.textContent;
    if (content.length === 0) continue;

    mappings.push({
      start: aggregate.length,
      node: node,
      length: content.length
    });
    aggregate += content;
  }
  return { aggregate, mappings };
}

/**
 * Finds the match indices in the aggregate text.
 */
function findMatch(targetText, aggregate) {
  const escapedTarget = targetText.trim().replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' ').join('\\s+');
  const regex = new RegExp(escapedTarget, 'i');
  return aggregate.match(regex);
}

function scrollToText(targetText, preComputedMapping) {
  const { aggregate, mappings } = preComputedMapping || getDOMMapping();
  const match = findMatch(targetText, aggregate);

  if (match) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const range = document.createRange();
    
    let startMapping = mappings.find(m => m.start <= matchStart && (m.start + m.length) > matchStart);
    let endMapping = mappings.find(m => m.start < matchEnd && (m.start + m.length) >= matchEnd);

    if (startMapping && endMapping) {
      try {
        range.setStart(startMapping.node, matchStart - startMapping.start);
        range.setEnd(endMapping.node, matchEnd - endMapping.start);

        const rect = range.getBoundingClientRect();
        const targetY = window.scrollY + rect.top - (window.innerHeight / 2) + (rect.height / 2);
        
        window.scrollTo({ top: targetY, behavior: 'smooth' });
        highlightRange(range);
      } catch (e) {
        console.warn("TruthForge: Range setting failed", e);
      }
    }
  }
}

function highlightRange(range) {
  const rects = range.getClientRects();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const highlights = [];

  for (const rect of rects) {
    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.left = `${rect.left + scrollX - 2}px`;
    div.style.top = `${rect.top + scrollY - 2}px`;
    div.style.width = `${rect.width + 4}px`;
    div.style.height = `${rect.height + 4}px`;
    div.style.backgroundColor = 'rgba(59, 130, 246, 0.4)';
    div.style.boxShadow = '0 0 12px rgba(59, 130, 246, 0.5)';
    div.style.pointerEvents = 'none';
    div.style.zIndex = '2147483646';
    div.style.borderRadius = '4px';
    div.style.transition = 'opacity 0.6s ease';
    document.body.appendChild(div);
    highlights.push(div);
  }

  setTimeout(() => {
    highlights.forEach(h => {
      h.style.opacity = '0';
      setTimeout(() => h.remove(), 600);
    });
  }, 2500);
}

function showResultsOverlay(data) {
  const existing = document.getElementById('truthforge-overlay-root');
  if (existing) existing.remove();

  // Pre-compute mapping to check which quotes are findable
  const mappingData = getDOMMapping();

  const root = document.createElement('div');
  root.id = 'truthforge-overlay-root';
  document.body.appendChild(root);

  const shadow = root.attachShadow({ mode: 'open' });

  const html = `
    <div class="container">
      <button class="close" title="Close">&times;</button>
      <header>
        <h1>Validation Results</h1>
        <div class="score-card">
          <span class="score-num">${data.overall_accuracy_score}%</span>
          <span class="score-label">Accuracy Score</span>
        </div>
      </header>
      <div class="list">
        ${(data.flagged_inaccuracies || []).map((item, i) => {
          const isFindable = !!findMatch(item.quoted_text, mappingData.aggregate);
          return `
            <div class="item">
              <div class="item-head">
                <span class="badge">#${i + 1}</span>
                <span class="title">Flagged Content</span>
              </div>
              <div class="${isFindable ? 'quote clickable' : 'quote static'}" data-index="${i}">
                <span class="label">The Quote:</span>
                <blockquote>"${item.quoted_text}"</blockquote>
                ${isFindable ? '<span class="jump">Click to jump to text &uarr;</span>' : ''}
              </div>
              <div class="details">
                <span class="label">Reasoning:</span>
                <p>${item.explanation}</p>
                <div class="meta">
                  <span class="label">Confidence:</span>
                  <span class="conf">${item.confidence_level.toUpperCase()}</span>
                </div>
              </div>
              <div class="sources">
                <span class="label">Sources:</span>
                <ul>
                  ${item.sources.map(s => {
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    return `<li>${s.replace(urlRegex, u => `<a href="${u}" target="_blank">${u}</a>`)}</li>`;
                  }).join('')}
                </ul>
              </div>
            </div>
          `;
        }).join('') || '<p class="empty">No inaccuracies found.</p>'}
      </div>
    </div>
    <style>
      :host { all: initial; }
      .container {
        position: fixed; top: 20px; right: 20px; width: 420px; max-height: 85vh;
        background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); font-family: -apple-system, sans-serif;
        display: flex; flex-direction: column; overflow: hidden; z-index: 2147483647;
      }
      header { padding: 20px; background: #f9fafb; border-bottom: 1px solid #f3f4f6; }
      h1 { margin: 0 0 12px 0; font-size: 18px; color: #111827; font-weight: 700; }
      .score-card { background: #eff6ff; border-radius: 8px; padding: 12px; text-align: center; border: 1px solid #dbeafe; }
      .score-num { display: block; font-size: 24px; font-weight: bold; color: #1d4ed8; }
      .score-label { font-size: 11px; color: #1e40af; font-weight: 600; text-transform: uppercase; }
      .list { overflow-y: auto; padding: 20px; scrollbar-width: thin; }
      .item { margin-bottom: 24px; border-bottom: 1px solid #f3f4f6; padding-bottom: 24px; }
      .item:last-child { border-bottom: none; }
      .item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
      .badge { background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px; }
      .title { font-weight: 600; color: #111827; font-size: 14px; }
      .label { display: block; font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
      .quote { border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid transparent; }
      .quote.static { background: #f9fafb; border-color: #f3f4f6; cursor: default; }
      .quote.clickable { background: #fffbeb; border-color: #fef3c7; cursor: pointer; transition: background 0.2s; }
      .quote.clickable:hover { background: #fef3c7; }
      blockquote { margin: 0; font-style: italic; color: #374151; font-size: 13px; line-height: 1.5; }
      .quote.clickable blockquote { color: #92400e; }
      .jump { display: block; margin-top: 8px; font-size: 10px; color: #b45309; font-weight: 800; text-transform: uppercase; }
      .details p { margin: 0 0 12px 0; font-size: 13px; color: #374151; line-height: 1.5; }
      .conf { font-weight: 600; color: #111827; font-size: 12px; }
      .sources ul { margin: 8px 0 0 0; padding-left: 18px; font-size: 12px; color: #4b5563; }
      .sources li { margin-bottom: 4px; }
      a { color: #2563eb; text-decoration: none; word-break: break-all; }
      a:hover { text-decoration: underline; }
      .close {
        position: absolute; top: 12px; right: 12px; background: none; border: none;
        font-size: 20px; color: #9ca3af; cursor: pointer; line-height: 1;
      }
      .close:hover { color: #111827; }
      .empty { text-align: center; color: #6b7280; font-size: 14px; padding: 20px 0; }
    </style>
  `;

  shadow.innerHTML = html;
  shadow.querySelector('.close').onclick = () => root.remove();
  
  shadow.querySelectorAll('.quote.clickable').forEach(q => {
    q.onclick = () => {
      const idx = q.getAttribute('data-index');
      scrollToText(data.flagged_inaccuracies[idx].quoted_text, mappingData);
    };
  });
}

window.truthForgeManualTrigger = extractAndSend;
