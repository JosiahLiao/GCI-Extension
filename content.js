// content.js — screen reader + key point highlighting + credibility checks
// (No Node; all on-device heuristics.)

const DEFAULT_SETTINGS = {
  rate: 1.0, pitch: 1.0, volume: 1.0, voiceURI: "", useChromeTTS: false,
  skipSelectors: [
    "header, nav, aside, footer, dialog, [role=banner], [role=navigation], [role=complementary], [role=dialog], [aria-modal=true]",
    "[aria-label*=ad], [aria-label*=Ad], [aria-label*=advert], [id*=ad], [class*=ad], [class*=ads], [class*=advert], [class*=sponsor], [id*=sponsor]",
    "[class*=outbrain], [class*=taboola], [class*=teads], [class*=sharethrough], [class*=doubleclick], [class*=googlesyndication]",
    "[class*=sticky], [class*=sidebar], [class*=promo], [class*=newsletter], [class*=signup], [class*=cookie]"
  ],
  minParagraphChars: 80,
  maxChunkChars: 1200,
  keyPointCount: 5
};

let SETTINGS = { ...DEFAULT_SETTINGS };
let speaking = false, paused = false, currentUtterance = null, queue = [];
let observer = null;

const isHidden = (el) => !el || el.offsetParent === null || getComputedStyle(el).visibility === "hidden";

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (cfg) => {
      SETTINGS = { ...DEFAULT_SETTINGS, ...cfg };
      resolve(SETTINGS);
    });
  });
}

function getMainRoot() {
  const main = document.querySelector("main, article, [role=main]");
  if (main && !isHidden(main)) return main;
  const candidates = Array.from(document.querySelectorAll("main, article, section, [role=main], [role=article], #content, .content, .post, .article, .entry, [itemprop=articleBody]"));
  let best = null, bestLen = 0;
  for (const el of candidates) {
    if (isHidden(el)) continue;
    const txt = el.innerText?.trim() || "";
    if (txt.length > bestLen) { bestLen = txt.length; best = el; }
  }
  return best || document.body;
}

function shouldSkip(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const skipRoles = new Set(["banner", "navigation", "complementary", "dialog", "menu", "search", "contentinfo", "alert", "tooltip"]);
  const role = el.getAttribute("role");
  if (role && skipRoles.has(role)) return true;
  const aria = (el.getAttribute("aria-label") || "").toLowerCase();
  if (/\b(ad|advert|advertisement|sponsored|promo)\b/.test(aria)) return true;
  const cls = (el.className || "").toString().toLowerCase();
  const id = (el.id || "").toLowerCase();
  if (/(^|[^a-z])(ad|ads|advert|sponsor|promo|outbrain|taboola|sharethrough|doubleclick|teads)([^a-z]|$)/.test(cls + " " + id)) return true;
  if (el.hidden || el.getAttribute("inert") !== null) return true;
  if (el.closest("header, nav, aside, footer, dialog, [role=banner], [role=navigation], [role=complementary], [aria-modal=true]")) return true;
  return false;
}

function collectTextNodes(el) {
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.TEXT_NODE) {
        const s = n.nodeValue.replace(/\s+/g, " ").trim();
        if (!s) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || isHidden(p) || shouldSkip(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = n.tagName;
        if (["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","IFRAME","SVG","CANVAS"].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (shouldSkip(n)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_SKIP;
    }
  });
  let curr;
  while ((curr = walker.nextNode())) if (curr.nodeType === Node.TEXT_NODE) out.push(curr);
  return out;
}

function extractCleanText(root) {
  const nodes = collectTextNodes(root);
  return nodes.map(n => n.nodeValue).join(" ").replace(/\s+/g, " ").trim();
}

// --- Screen reading ---
function chunk(text, maxLen) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + maxLen);
    const slice = text.slice(i, end);
    const lastPeriod = slice.lastIndexOf(". ");
    if (lastPeriod > i + maxLen * 0.6) end = i + lastPeriod + 2;
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

function buildQueueFrom(root) {
  const text = extractCleanText(root);
  const paragraphs = text.split(/\n{2,}|(?<=[.!?])\s{2,}/).map(s => s.trim()).filter(s => s.length >= SETTINGS.minParagraphChars);
  return paragraphs.flatMap(p => chunk(p, SETTINGS.maxChunkChars));
}

function speakNext() {
  if (paused || speaking) return;
  const next = queue.shift();
  if (!next) return;
  if (SETTINGS.useChromeTTS && chrome.tts) {
    speaking = true;
    chrome.tts.speak(next, {
      voiceName: SETTINGS.voiceURI || undefined,
      rate: SETTINGS.rate, pitch: SETTINGS.pitch, volume: SETTINGS.volume,
      onEvent: (e) => { if (e.type === "end" || e.type === "interrupted" || e.type === "cancelled") { speaking = false; speakNext(); } }
    });
  } else {
    const u = new SpeechSynthesisUtterance(next);
    u.rate = SETTINGS.rate; u.pitch = SETTINGS.pitch; u.volume = SETTINGS.volume;
    if (SETTINGS.voiceURI) {
      const voice = speechSynthesis.getVoices().find(v => v.voiceURI === SETTINGS.voiceURI || v.name === SETTINGS.voiceURI);
      if (voice) u.voice = voice;
    }
    speaking = true;
    u.onend = () => { speaking = false; speakNext(); };
    u.onerror = () => { speaking = false; speakNext(); };
    speechSynthesis.speak(u);
    currentUtterance = u;
  }
}

function stopSpeaking() {
  queue = []; paused = false; speaking = false;
  if (SETTINGS.useChromeTTS && chrome.tts) chrome.tts.stop();
  else speechSynthesis.cancel();
}
function pauseResume() {
  if (SETTINGS.useChromeTTS && chrome.tts) {
    if (speaking) { chrome.tts.stop(); paused = true; speaking = false; }
    else if (paused) { paused = false; speakNext(); }
    return;
  }
  if (speechSynthesis.speaking && !speechSynthesis.paused) { speechSynthesis.pause(); paused = true; }
  else if (speechSynthesis.paused) { speechSynthesis.resume(); paused = false; }
}

async function readSelection() {
  await loadSettings();
  const sel = window.getSelection();
  const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
  if (!text) return;
  stopSpeaking();
  queue = chunk(text, SETTINGS.maxChunkChars);
  speakNext();
}
async function readMain() {
  await loadSettings();
  stopSpeaking();
  const root = getMainRoot();
  queue = buildQueueFrom(root);
  speakNext();
  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    const textMut = mutations.some(m => Array.from(m.addedNodes).some(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !shouldSkip(n))));
    if (textMut && queue.length < 2 && !speechSynthesis.speaking) {
      const more = buildQueueFrom(getMainRoot());
      if (more.length) { queue = more; speakNext(); }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

// --- Key point extraction (lightweight TextRank-ish scoring) ---
function sentenceSplit(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9\[\(\"'])/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && /[a-zA-Z]/.test(s));
}

function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(Boolean);
}

// Simple importance: TF * position bonus * title overlap * proper noun count
function extractKeyPoints(root, count=5) {
  const title = (document.querySelector("meta[property='og:title']")?.content ||
                 document.title || "").trim();
  const titleTokens = new Set(tokenize(title));

  const text = extractCleanText(root);
  const sents = sentenceSplit(text);
  if (!sents.length) return [];

  const tf = Object.create(null);
  const allTokens = tokenize(text);
  for (const t of allTokens) tf[t] = (tf[t]||0)+1;

  const scores = sents.map((s, i) => {
    const toks = tokenize(s);
    const len = Math.max(toks.length, 1);
    const avgTF = toks.reduce((a,t)=>a+(tf[t]||0),0)/len;
    const posBonus = 1 + (i === 0 ? 0.6 : (i < 3 ? 0.3 : 0)); // early sentences matter
    // title overlap
    const overlap = toks.reduce((a,t)=> a + (titleTokens.has(t) ? 1 : 0), 0) / len;
    // crude proper noun count (words starting capital in original sentence)
    const proper = (s.match(/\b[A-Z][a-z]+/g)||[]).length;
    const properBonus = 1 + Math.min(proper, 4) * 0.05;
    // downweight very short or very long sentences
    const lenPenalty = (len < 6 || len > 40) ? 0.8 : 1;
    const score = avgTF * posBonus * (1 + overlap) * properBonus * lenPenalty;
    return { s, i, score };
  });

  scores.sort((a,b)=> b.score - a.score);
  const top = scores.slice(0, count).sort((a,b)=> a.i - b.i).map(o => o.s);
  return top;
}

function clearHighlights() {
  document.querySelectorAll(".aar-highlight").forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
}

function highlightSentences(root, sentences) {
  clearHighlights();
  if (!sentences.length) return [];
  const nodes = collectTextNodes(root);
  const found = [];
  for (const sentence of sentences) {
    const needle = sentence.slice(0, 120); // partial match window
    const re = new RegExp(reEscape(needle.replace(/\s+/g, " ")), "i");
    let matched = false;
    for (const n of nodes) {
      const idx = n.nodeValue.replace(/\s+/g, " ").search(re);
      if (idx >= 0) {
        // split the text node to wrap highlight
        const full = n.nodeValue;
        const before = document.createTextNode(full.slice(0, idx));
        const mid = document.createTextNode(full.slice(idx, idx + needle.length));
        const after = document.createTextNode(full.slice(idx + needle.length));
        const span = document.createElement("span");
        span.className = "aar-highlight";
        n.parentNode.insertBefore(before, n);
        span.appendChild(mid);
        n.parentNode.insertBefore(span, n);
        n.parentNode.insertBefore(after, n);
        n.parentNode.removeChild(n);
        found.push({ element: span, text: sentence });
        matched = true;
        break;
      }
    }
    if (!matched) {
      // fallback: ignore if not found in one node; multi-node matching is complex
    }
  }
  return found;
}

function reEscape(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}

// --- Credibility checks (heuristics only; no external calls) ---
function credibilityReport(root) {
  const url = new URL(location.href);
  const https = (url.protocol === "https:");
  const byline = !!(document.querySelector("[itemprop='author'], [rel='author'], .byline, .author, meta[name='author']"));
  const dateMeta = document.querySelector("time[datetime], meta[property='article:published_time'], meta[name='date'], meta[name='pubdate']");
  const hasDate = !!dateMeta;
  // external references: links to other domains within main
  const links = Array.from(root.querySelectorAll("a[href]"));
  const externalLinks = links.filter(a => {
    try { const u = new URL(a.href, location.href); return u.hostname && u.hostname !== location.hostname; } catch { return false; }
  });
  const externalCount = externalLinks.length;

  // ads density heuristic: elements with ad-like classes
  const adEls = root.querySelectorAll("[class*='ad'], [id*='ad'], [class*='sponsor']");
  const textLen = extractCleanText(root).length;
  const adDensity = adEls.length / Math.max(1, textLen/1000);

  // sensational/clickbait cues
  const text = extractCleanText(root);
  const sensational = /shocking|won't believe|exposed|secret[s]?|miracle|guaranteed|outrage|destroy[s]?|game[- ]changer|jaw[- ]dropping|one weird trick/i.test(text);
  const excessiveCaps = /[A-Z]{6,}/.test(text);

  // quotes / named sources
  const hasQuotes = /“.+?”|\".+?\"/.test(text) || /according to|said|stated|reported/i.test(text);

  // reading level roughness: average sentence length
  const sentences = sentenceSplit(text);
  const words = text.split(/\s+/).filter(Boolean);
  const avgSentLen = sentences.length ? words.length / sentences.length : words.length;

  // signals combine into score
  let score = 50;
  if (https) score += 5;
  if (byline) score += 10; else score -= 8;
  if (hasDate) score += 6; else score -= 6;
  if (externalCount >= 3) score += 10; else if (externalCount === 0) score -= 6;
  if (adDensity > 4) score -= 12; else if (adDensity > 2) score -= 6;
  if (sensational || excessiveCaps) score -= 10;
  if (hasQuotes) score += 6;
  if (avgSentLen > 45 || avgSentLen < 6) score -= 5; // very odd style
  score = Math.min(100, Math.max(0, Math.round(score)));

  let label = "Medium";
  if (score >= 75) label = "High";
  else if (score <= 45) label = "Low";

  return {
    score, label,
    signals: {
      https, byline, hasDate, externalReferences: externalCount,
      adDensity: Number(adDensity.toFixed(2)),
      sensational, excessiveCaps, hasQuotes, avgSentLen: Number(avgSentLen.toFixed(1))
    }
  };
}

// --- Panel UI ---
function ensurePanel() {
  let panel = document.querySelector(".aar-panel");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.className = "aar-panel";
  document.body.appendChild(panel);
  return panel;
}

function renderPanel({ keyPoints, report }) {
  const panel = ensurePanel();

const items = report.factors.map(f => `<li><strong>${escapeHtml(f.name)}</strong><br>
  <small>${escapeHtml(f.rationale)}</small><br>
  <small><em>Indicator:</em> ${typeof f.indicator === 'boolean' ? (f.indicator ? 'yes' : 'no') : escapeHtml(String(f.indicator))} •
  <em>Impact:</em> ${f.scoreDelta > 0 ? '+' : ''}${f.scoreDelta}/${f.maxImpact}</small></li>`).join("");
const list = `<ol class="aar-points">${items}</ol>`;
panel.innerHTML = `
  <h3>Page analysis</h3>
  <div class="aar-meta">
    <span>Credibility:</span>
    <span class="aar-badge ${report.label.toLowerCase()}">${report.label} • ${report.score}/100</span>
  </div>
  <div><strong>Why this score</strong></div>
  ${list}
  <div style="margin-top:8px;"><strong>Key points</strong></div>
  <ol class="aar-points">${keyPoints.map(p=>`<li>${escapeHtml(p)}</li>`).join("")}</ol>
  <div class="aar-actions">
    <button class="primary" id="aar-read-points">Read key points</button>
    <button class="ghost" id="aar-clear">Clear highlights</button>
  </div>
`;

  panel.querySelector("#aar-clear").onclick = () => clearHighlights();
  panel.querySelector("#aar-read-points").onclick = async () => {
    await loadSettings();
    const text = keyPoints.join(". ");
    stopSpeaking();
    queue = chunk(text, SETTINGS.maxChunkChars);
    speakNext();
  };
}

function escapeHtml(s){return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

// --- Analyze workflow ---
async function analyzeAndHighlight() {
  await loadSettings();
  const root = getMainRoot();
  const keyPoints = extractKeyPoints(root, SETTINGS.keyPointCount);
  highlightSentences(root, keyPoints);
  const report = credibilityScoreDetailed(root);
  renderPanel({ keyPoints, report });
}

// --- Messages ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "READ_SELECTION") readSelection();
  if (msg.type === "READ_MAIN") readMain();
  if (msg.type === "PAUSE_RESUME") pauseResume();
  if (msg.type === "STOP") stopSpeaking();
  if (msg.type === "SETTINGS_UPDATED") loadSettings();
  if (msg.type === "ANALYZE") analyzeAndHighlight();
});

// --- Detailed credibility scoring ---
// Each factor returns {scoreDelta, maxImpact, rationale, indicator}
// Score starts at 50 and is clamped to [0,100].
function credibilityScoreDetailed(root) {
  const url = new URL(location.href);
  const text = extractCleanText(root);

  const factors = [];

  // 1) Protocol (HTTPS)
  const https = (url.protocol === "https:");
  factors.push({
    name: "Secure protocol (HTTPS)",
    indicator: https,
    scoreDelta: https ? +5 : -5,
    maxImpact: 5,
    rationale: https ?
      "Page is served over HTTPS, which helps protect content integrity." :
      "Page is not served over HTTPS; content could be intercepted or altered."
  });

  // 2) Author/byline presence
  const bylineEl = document.querySelector("[itemprop='author'], [rel='author'], .byline, .author, meta[name='author']");
  const byline = !!bylineEl;
  factors.push({
    name: "Identified author/byline",
    indicator: byline,
    scoreDelta: byline ? +12 : -10,
    maxImpact: 12,
    rationale: byline ?
      "An author/byline is present, increasing accountability." :
      "No author/byline detected, reducing accountability."
  });

  // 3) Publication date
  const dateMeta = document.querySelector("time[datetime], meta[property='article:published_time'], meta[name='date'], meta[name='pubdate']");
  const hasDate = !!dateMeta;
  factors.push({
    name: "Publication date available",
    indicator: hasDate,
    scoreDelta: hasDate ? +8 : -6,
    maxImpact: 8,
    rationale: hasDate ?
      "A publication date is provided; this aids recency verification." :
      "No clear publication date was found."
  });

  // 4) External references/citations
  const links = Array.from(root.querySelectorAll("a[href]"));
  const externalLinks = links.filter(a => {
    try { const u = new URL(a.href, location.href); return u.hostname && u.hostname !== location.hostname; } catch { return false; }
  });
  const externalCount = externalLinks.length;
  let extDelta = 0, extRationale = "";
  if (externalCount >= 5) { extDelta = +12; extRationale = `Many external references detected (${externalCount}).`; }
  else if (externalCount >= 3) { extDelta = +8; extRationale = `Several external references detected (${externalCount}).`; }
  else if (externalCount >= 1) { extDelta = +3; extRationale = `Few external references detected (${externalCount}).`; }
  else { extDelta = -6; extRationale = "No external references detected."; }
  factors.push({
    name: "External references/citations",
    indicator: externalCount,
    scoreDelta: extDelta,
    maxImpact: 12,
    rationale: extRationale
  });

  // 5) Ad density around the main content
  const adEls = root.querySelectorAll("[class*='ad'], [id*='ad'], [class*='sponsor']");
  const textLen = text.length;
  const adDensity = adEls.length / Math.max(1, textLen/1000);
  let adDelta = 0, adRationale = "";
  if (adDensity <= 0.5) { adDelta = +6; adRationale = `Low ad density (~${adDensity.toFixed(2)} per 1000 chars).`; }
  else if (adDensity <= 2) { adDelta = 0; adRationale = `Moderate ad density (~${adDensity.toFixed(2)} per 1000 chars).`; }
  else if (adDensity <= 4) { adDelta = -6; adRationale = `High ad density (~${adDensity.toFixed(2)} per 1000 chars).`; }
  else { adDelta = -12; adRationale = `Very high ad density (~${adDensity.toFixed(2)} per 1000 chars).`; }
  factors.push({
    name: "Ad density (content area)",
    indicator: Number(adDensity.toFixed(2)),
    scoreDelta: adDelta,
    maxImpact: 12,
    rationale: adRationale
  });

  // 6) Sensational language / excessive capitalization
  const sensational = /shocking|won't believe|exposed|secret[s]?|miracle|guaranteed|outrage|destroy[s]?|game[- ]changer|jaw[- ]dropping|one weird trick/i.test(text);
  const excessiveCaps = /[A-Z]{6,}/.test(text);
  const sensHit = (sensational ? -6 : 0) + (excessiveCaps ? -4 : 0);
  factors.push({
    name: "Sensational or clickbait language",
    indicator: Boolean(sensational || excessiveCaps),
    scoreDelta: sensHit,
    maxImpact: 10,
    rationale: sensational || excessiveCaps ?
      "Detected clickbait/sensational cues (e.g., hype phrases or long ALL‑CAPS runs)." :
      "No strong clickbait cues detected."
  });

  // 7) Quotations / sourcing phrases
  const hasQuotes = /“.+?”|\".+?\"/.test(text) || /according to|said|stated|reported|cited/i.test(text);
  factors.push({
    name: "Quotations or sourcing language",
    indicator: hasQuotes,
    scoreDelta: hasQuotes ? +6 : 0,
    maxImpact: 6,
    rationale: hasQuotes ? "Attribution/quotes suggest sourcing is provided." : "Few/no cues of direct attribution detected."
  });

  // 8) Readability sanity (avg sentence length)
  const sentences = sentenceSplit(text);
  const words = text.split(/\s+/).filter(Boolean);
  const avgSentLen = sentences.length ? words.length / sentences.length : words.length;
  let readDelta = 0, readRationale = "";
  if (avgSentLen >= 10 && avgSentLen <= 35) { readDelta = +3; readRationale = `Readable average sentence length (${avgSentLen.toFixed(1)} words).`; }
  else { readDelta = -3; readRationale = `Atypical sentence length (${avgSentLen.toFixed(1)} words).`; }
  factors.push({
    name: "Readability (avg sentence length)",
    indicator: Number(avgSentLen.toFixed(1)),
    scoreDelta: readDelta,
    maxImpact: 3,
    rationale: readRationale
  });

  // Sum score and clamp
  let score = 50;
  for (const f of factors) score += f.scoreDelta;
  score = Math.min(100, Math.max(0, Math.round(score)));
  let label = "Medium";
  if (score >= 75) label = "High";
  else if (score <= 45) label = "Low";

  return { score, label, factors };
}

