
// background.js — Investigator: fetch evidence from primary/trusted sources (no Wikipedia)
async function fetchJSON(url, headers={}){
  const r = await fetch(url, { headers });
  const text = await r.text();
  try { return { ok: r.ok, json: JSON.parse(text) }; } catch { return { ok: r.ok, text }; }
}
function trimQuery(q){
  return q.replace(/[^\w\s%\-:]/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
}

// CrossRef (peer-reviewed/academic)
async function crossrefWorks(query){
  const q = encodeURIComponent(trimQuery(query));
  const url = `https://api.crossref.org/works?query=${q}&rows=5&select=title,DOI,issued,container-title,URL`;
  const { ok, json } = await fetchJSON(url, { "accept":"application/json" });
  if(!ok || !json?.message?.items) return [];
  return json.message.items.map(it => ({
    source: "CrossRef",
    title: (it.title && it.title[0]) || "",
    url: it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : ""),
    date: (it.issued?.["date-parts"]?.[0] || []).join("-"),
    snippet: it["container-title"] ? `Journal: ${it["container-title"][0]}` : ""
  }));
}

// PubMed (biomedical)
async function pubmed(query){
  const q = encodeURIComponent(trimQuery(query));
  const esearch = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=5&term=${q}`;
  const s = await fetchJSON(esearch, { "accept":"application/json" });
  if(!s.ok || !s.json?.esearchresult?.idlist?.length) return [];
  const ids = s.json.esearchresult.idlist.join(",");
  const esum = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids}`;
  const e = await fetchJSON(esum, { "accept":"application/json" });
  if(!e.ok || !e.json?.result) return [];
  const res = e.json.result;
  return Object.keys(res).filter(k=>k!=="uids").map(k => {
    const it = res[k];
    return {
      source: "PubMed",
      title: it.title || "",
      url: `https://pubmed.ncbi.nlm.nih.gov/${k}/`,
      date: it.pubdate || "",
      snippet: (it.fulljournalname || "") + (it.authors?.length ? ` • ${it.authors[0].name}` : "")
    };
  });
}

// Reuters/AP lightweight: try query against site (heuristic - may 302 HTML; extensions can fetch cross-origin)
async function reutersSearch(query){
  const q = encodeURIComponent(trimQuery(query));
  // Use Reuters search endpoint
  const url = `https://www.reuters.com/site-search/?query=${q}`;
  const { ok, text } = await fetchJSON(url, { "accept":"text/html" });
  if(!ok || !text) return [];
  const items = [];
  const re = /<a[^>]+href="(\/[^"]+)"[^>]*>(.*?)<\/a>/gi;
  let m; let seen = new Set();
  while((m=re.exec(text)) && items.length<5){
    const href = m[1]; const title = m[2].replace(/<[^>]+>/g,"").trim();
    if(!title || seen.has(href)) continue;
    seen.add(href);
    items.push({ source:"Reuters", title, url: `https://www.reuters.com${href}`, date:"", snippet:"" });
  }
  return items;
}

async function apSearch(query){
  const q = encodeURIComponent(trimQuery(query));
  const url = `https://apnews.com/search?q=${q}`;
  const { ok, text } = await fetchJSON(url, { "accept":"text/html" });
  if(!ok || !text) return [];
  const items = [];
  const re = /<a[^>]+href="(\/article\/[^"]+)"[^>]*>(.*?)<\/a>/gi;
  let m; let seen = new Set();
  while((m=re.exec(text)) && items.length<5){
    const href = m[1]; const title = m[2].replace(/<[^>]+>/g,"").trim();
    if(!title || seen.has(href)) continue;
    seen.add(href);
    items.push({ source:"AP News", title, url: `https://apnews.com${href}`, date:"", snippet:"" });
  }
  return items;
}

// .gov quick search heuristic (CDC/NIH/NOAA/BLM/etc) — use site-limited Bing-like query on CDC Search API alternative endpoints are inconsistent; fallback to guess pages
async function govHeuristic(query){
  // We try a few well-known domains: CDC, NIH, NOAA
  const trials = [
    { name:"CDC", url:`https://www.cdc.gov/search/index.html?query=${encodeURIComponent(trimQuery(query))}` },
    { name:"NIH", url:`https://search.nih.gov/search?utf8=%E2%9C%93&affiliate=nih&query=${encodeURIComponent(trimQuery(query))}` },
    { name:"NOAA", url:`https://search.usa.gov/search?affiliate=noaa.gov&query=${encodeURIComponent(trimQuery(query))}` }
  ];
  const out = [];
  for (const t of trials){
    const r = await fetchJSON(t.url, { "accept":"text/html" });
    if (!r.ok || !r.text) continue;
    const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi;
    let m; let seen = new Set();
    while((m = re.exec(r.text)) && out.length < 5){
      const href = m[1]; const ttl = m[2].replace(/<[^>]+>/g,"").trim();
      if (!href.includes(t.name.toLowerCase())) continue;
      if (seen.has(href) || !ttl) continue;
      seen.add(href);
      out.push({ source: t.name, title: ttl, url: href, date:"", snippet:"" });
    }
  }
  return out;
}

async function investigate(query){
  const [cr, pm, rtr, ap, gov] = await Promise.all([
    crossrefWorks(query),
    pubmed(query),
    reutersSearch(query),
    apSearch(query),
    govHeuristic(query)
  ]);
  return [...cr, ...pm, ...rtr, ...ap, ...gov].slice(0, 12);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "INVESTIGATE") {
      try {
        const evidence = await investigate(msg.query || "");
        sendResponse({ ok: true, evidence });
      } catch (e) {
        sendResponse({ ok:false, reason: e?.message || "Investigate failed" });
      }
    }
  })();
  return true;
});
