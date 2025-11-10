
// content.js — "We are the fact-checker": investigate claims against trusted sources (no Wikipedia)
const CFG = { maxClaimLen: 260, maxClaims: 18 };

const DEFAULTS = {
  skipSelectors: [
    "header, nav, aside, footer, dialog, [role=banner], [role=navigation], [role=complementary], [role=dialog], [aria-modal=true]",
    ".ad, .ads, [class*=advert i], [class*=sponsor i], [id*=ad i], [class*=promo i], [class*=newsletter i], [class*=cookie i]",
    "[class*=outbrain i], [class*=taboola i], [class*=doubleclick i], [class*=sharethrough i], [class*=teads i]",
    ".comments, #comments, [data-component='comments'], [role='complementary']",
    ".sidebar, [class*=sidebar i], [class*=sticky i]"
  ]
};

// ---------- Article extraction (content-dense only) ----------
function isHidden(el){ return !el || el.offsetParent === null || getComputedStyle(el).visibility === "hidden"; }
function textLen(el){ return (el.innerText || "").replace(/\s+/g," ").trim().length; }
function elementCount(el){ return el.querySelectorAll("*").length || 1; }
function densityScore(el){ return textLen(el) / elementCount(el); }
function candidateSelectors(){ return [
  "article","main article","main [role='article']","section[itemprop='articleBody']","[data-component='articleBody']",
  ".article-body,.articleBody,.post-content,.entry-content,#article-body,#content article","main .content,.story-body,.body-copy"
];}
function getArticleRoot(){
  const cands = new Set();
  document.querySelectorAll(candidateSelectors().join(",")).forEach(n => { if(!isHidden(n)) cands.add(n); });
  const main = document.querySelector("main") || document.body;
  Array.from(main.querySelectorAll("section, div")).forEach(n => {
    if (isHidden(n)) return;
    if (n.matches(DEFAULTS.skipSelectors.join(","))) return;
    if (textLen(n) > 800) cands.add(n);
  });
  let best=null, bestScore=0;
  for (const el of cands){
    const score = densityScore(el);
    if (score>bestScore){ bestScore=score; best=el; }
  }
  return best || main;
}

// ---------- Claim extraction ----------
function splitSentences(t){ return t.replace(/\s+/g," ").split(/(?<=[.!?])\s+(?=[A-Z0-9“"'\[])/).map(s=>s.trim()).filter(Boolean); }
function collectArticleText(root){
  const out=[];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      const p=n.parentElement;
      if(!p || isHidden(p) || p.matches(DEFAULTS.skipSelectors.join(","))) return NodeFilter.FILTER_REJECT;
      const s=n.nodeValue.replace(/\s+/g," ").trim();
      if (!s || s.length<3) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let cur; while((cur=walker.nextNode())) out.push(cur.nodeValue);
  return out.join(" ").replace(/\s+/g," ").trim();
}
function extractClaims(root){
  const sents = splitSentences(collectArticleText(root));
  const claims=[];
  for (const s of sents){
    if (s.length<28 || s.length>CFG.maxClaimLen) continue;
    const hasNum = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/.test(s);
    const hasYear = /\b(19|20)\d{2}\b/.test(s);
    const hasEntity = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3}\b/.test(s);
    const hasVerb = /\b(is|are|was|were|claims?|reports?|causes?|reduces?|increases?|leads?|results?|shows?)\b/i.test(s);
    const notUI = !/subscribe|cookie|sign in|menu|share|read more|next|previous/i.test(s);
    if (notUI && (hasNum || hasYear || hasEntity) && hasVerb) claims.push(s);
  }
  return claims.slice(0, CFG.maxClaims);
}

// ---------- Investigation (background relay) ----------
function investigate(query){
  return new Promise(res => chrome.runtime.sendMessage({ type:"INVESTIGATE", query }, res));
}

// ---------- Evidence-based scoring ----------
function extractNumbers(t){
  return (t.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/g) || []).map(x=>x.replace(/,/g,""));
}
function numericConcordance(claimNums, evidenceSnippet){
  if (!claimNums.length) return 0;
  const snums = extractNumbers(evidenceSnippet);
  if (!snums.length) return 0;
  let score = 0;
  for (const c of claimNums){
    const cval = parseFloat(c);
    for (const s of snums){
      const sval = parseFloat(s);
      if (!isFinite(cval) || !isFinite(sval)) continue;
      const relErr = Math.abs(cval - sval) / Math.max(1, Math.abs(cval));
      if (relErr < 0.05) score += 2;        // within 5%
      else if (relErr < 0.15) score += 1;   // within 15%
      else if (relErr > 0.40) score -= 2;   // far off -> contradiction
    }
  }
  return score;
}
function authorityWeight(source){
  if (source==="CDC" || source==="NIH" || source==="NOAA") return 12;
  if (source==="PubMed" || source==="CrossRef") return 10;
  if (source==="Reuters" || source==="AP News") return 8;
  return 4;
}
function scoreFromEvidence(claim, evidence){
  let score = 50;
  const reasons = [];
  const claimNums = extractNumbers(claim);
  let corroborations = 0, contradictions = 0, numericScore = 0, maxAuth = 0;
  for (const ev of evidence){
    const w = authorityWeight(ev.source);
    maxAuth = Math.max(maxAuth, w);
    // simple textual plausibility: overlap of key tokens
    const tokClaim = claim.toLowerCase().split(/\W+/).filter(x=>x.length>3);
    const t = (ev.title + " " + (ev.snippet||"")).toLowerCase();
    const overlap = tokClaim.filter(x=>t.includes(x)).length;
    if (overlap >= 3){ corroborations += 1; score += Math.min(10, w); reasons.push(`Corroborated by ${ev.source}: ${ev.title}`); }
    const numC = numericConcordance(claimNums, ev.title + " " + (ev.snippet||""));
    numericScore += numC;
    if (numC < -1){ contradictions += 1; reasons.push(`Numbers conflict with ${ev.source}.`); }
  }
  if (corroborations >= 2) score += 10;
  if (contradictions >= 1) score -= 15;
  score += Math.max(-10, Math.min(10, numericScore));
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score>=75?"High":score<=45?"Low":"Medium";
  return { score, label, reasons };
}

// ---------- UI helpers ----------
function ensurePanel(){ let p=document.querySelector('.cr-panel'); if(p) return p; p=document.createElement('div'); p.className='cr-panel'; document.body.appendChild(p); return p; }
function badge(label){ const cls = label==="High"?"cr-high":label==="Low"?"cr-low":"cr-med"; return `<span class="cr-badge ${cls}">${label}</span>`; }
function escapeHtml(s){return s.replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]))}
function clearHighlights(){ document.querySelectorAll(".cr-highlight").forEach(el=>{ const p=el.parentNode; while(el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); }); }
function highlightClaim(root, sentence){
  const nodes=[]; const walker=document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode:n => {
    const p=n.parentElement; if(!p||isHidden(p)||p.matches(DEFAULTS.skipSelectors.join(","))) return NodeFilter.FILTER_REJECT;
    const s=n.nodeValue.replace(/\s+/g," ").trim(); return s?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
  }}); let cur; while((cur=walker.nextNode())) nodes.push(cur);
  const needle = sentence.slice(0,120).replace(/\s+/g," ");
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i");
  for (const t of nodes){
    const hay=t.nodeValue.replace(/\s+/g," ");
    const i=hay.search(re);
    if(i>=0){
      const full=t.nodeValue;
      const before=document.createTextNode(full.slice(0,i));
      const mid=document.createTextNode(full.slice(i,i+needle.length));
      const after=document.createTextNode(full.slice(i+needle.length));
      const span=document.createElement("span"); span.className="cr-highlight";
      t.parentNode.insertBefore(before,t); span.appendChild(mid);
      t.parentNode.insertBefore(span,t); t.parentNode.insertBefore(after,t);
      t.parentNode.removeChild(t); return span;
    }
  }
  return null;
}

// ---------- Offline heuristic mode ----------
function offlineScoreClaim(s){
  let score=55; const reasons=[];
  if(/\baccording to\b/i.test(s)){score+=10;reasons.push("cites a source");}
  if(/\b(study|report|dataset|meta[- ]analysis)\b/i.test(s)){score+=6;reasons.push("mentions research/data");}
  if(/\bexperts?\b/i.test(s)){score+=3;reasons.push("mentions experts");}
  if(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/.test(s)){score+=4;reasons.push("uses concrete figures");}
  if(/\b(19|20)\d{2}\b/.test(s)){score+=3;reasons.push("gives a specific year");}
  if(/\b(shocking|miracle|exposed|guaranteed|secret|you won't believe|debunked)\b/i.test(s)){score-=14;reasons.push("sensational language");}
  if(/[A-Z]{6,}/.test(s)){score-=6;reasons.push("excessive capitalization");}
  if(/\b(only|always|never|every|prove)\b/i.test(s)){score-=5;reasons.push("absolute/framing language");}
  score=Math.max(0,Math.min(100,score)); const label=score>=75?"High":score<=45?"Low":"Medium"; return {score,label,reasons};
}

async function analyzeOffline(){
  clearHighlights();
  const root=getArticleRoot();
  const claims=extractClaims(root);
  const results=claims.map(c=>({claim:c, offline:offlineScoreClaim(c)}));
  [...results].sort((a,b)=>a.offline.score-b.offline.score).slice(0,5).forEach(r=>highlightClaim(root,r.claim));
  const avg=Math.round(results.reduce((a,r)=>a+r.offline.score,0)/Math.max(1,results.length));
  const label=avg>=75?"High":avg<=45?"Low":"Medium";
  const p=ensurePanel();
  p.innerHTML=`<h3>Offline validation ${badge(label)} • ${avg}/100</h3>
  <div class="cr-note"><small>Heuristic signals only (no internet). Use Online to investigate evidence.</small></div>
  <ol class="cr-points">${results.slice(0,12).map(r=>`<li>${escapeHtml(r.claim)} <span class="cr-tag">${r.offline.score}/100</span><br><small>${escapeHtml(r.offline.reasons.join("; "))}</small></li>`).join("")}</ol>
  <div class="cr-actions"><button class="cr-primary" id="cr-online">Investigate (Online)</button><button class="cr-ghost" id="cr-clear">Clear highlights</button></div>`;
  p.querySelector("#cr-clear").onclick=()=>clearHighlights();
  p.querySelector("#cr-online").onclick=()=>analyzeOnline(claims);
}

// ---------- Online investigator mode ----------
async function analyzeOnline(existingClaims=null){
  clearHighlights();
  const root=getArticleRoot();
  const claims=existingClaims || extractClaims(root);
  const p=ensurePanel();
  p.innerHTML=`<h3>Online investigation</h3><div class="cr-note"><small>Collecting evidence from CrossRef, PubMed, Reuters/AP, and .gov domains…</small></div>`;
  const out=[];
  for(const c of claims.slice(0,12)){
    const r=await new Promise(res=>chrome.runtime.sendMessage({type:"INVESTIGATE", query:c},res));
    const evidence=(r&&r.ok&&r.evidence)||[];
    const evaln=scoreFromEvidence(c, evidence);
    out.push({claim:c, evidence, ...evaln});
  }
  const avg=Math.round(out.reduce((a,r)=>a+r.score,0)/Math.max(1,out.length));
  const label=avg>=75?"High":avg<=45?"Low":"Medium";
  const items=out.map(r=>{
    const srcs=r.evidence.slice(0,5).map(s=>`<a class="cr-source" href="${s.url}" target="_blank">${escapeHtml(s.source)}: ${escapeHtml(s.title)}</a>`).join("");
    return `<li>${escapeHtml(r.claim)} <span class="cr-tag">${r.score}/100</span> ${badge(r.label)}<br>
      <small>${escapeHtml(r.reasons.join("; ")||"Evidence collected.")}</small><br>${srcs}</li>`;
  }).join("");
  p.innerHTML=`<h3>Online investigation ${badge(label)} • ${avg}/100</h3>
  <div class="cr-note"><small>Scores reflect corroboration/contradiction across trusted primary sources.</small></div>
  <ol class="cr-points">${items}</ol>
  <div class="cr-actions"><button class="cr-ghost" id="cr-clear">Clear highlights</button></div>`;
  p.querySelector("#cr-clear").onclick=()=>clearHighlights();

  // Emphasize non-High
  out.filter(r=>r.label!=="High").slice(0,5).forEach(r=>highlightClaim(root,r.claim));
}

// ---------- Messages & Popup triggers ----------
chrome.runtime.onMessage.addListener((msg)=>{
  if (msg.type==="ANALYZE_OFFLINE") analyzeOffline();
  if (msg.type==="ANALYZE_ONLINE") analyzeOnline();
});
