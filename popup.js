async function getPageData() {
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    const [{result}] = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: () => {
        const text = (document.body && document.body.innerText || '').replace(/\s+/g,' ').slice(0, 120000);
        const meta = {};
        document.querySelectorAll('meta[name], meta[property]').forEach(m=>{
          const k = (m.getAttribute('name')||m.getAttribute('property')||'').toLowerCase();
          const v = (m.getAttribute('content')||'').trim();
          if (k && v) meta[k] = v;
        });
        const links = Array.from(document.querySelectorAll('a[href]')).map(a=>a.getAttribute('href'));
        const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(h=>h.textContent.trim()).filter(Boolean);
        const hasRefs = /references|citations|sources|bibliography/i.test(document.body.innerText || '');
        const scripts = Array.from(document.scripts||[]).map(s=>s.src||'inline');
        return {url:location.href, host:location.host, protocol:location.protocol, title:document.title, meta, links, headings, hasRefs, scripts, text};
      }
    });
    return result;
  }
  
  function colorClass(score){
    if(score>=75) return 'ok';
    if(score>=45) return 'warn';
    return 'bad';
  }
  
  async function analyze(){
    const status = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    status.textContent = 'Sending page to local analyzer on http://127.0.0.1:4000 ...';
    resultDiv.innerHTML='';
  
    try{
      const page = await getPageData();
      const resp = await fetch('http://127.0.0.1:4000/api/analyze',{
        method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(page)
      });
      const data = await resp.json();
  
      const cls = colorClass(data.credibility.score);
      const factors = (data.credibility.factors||[]).map(f=>`<li>${f}</li>`).join('');
      const bullets = (data.summary.key_points||[]).map(b=>`<li>${b}</li>`).join('');
  
      resultDiv.innerHTML = `
        <div class='section'>
          <div class='score ${cls}'>Credibility score: ${data.credibility.score}/100 — ${data.credibility.label}</div>
          <div class='small'>Domain: <code>${data.domain}</code></div>
        </div>
        <div class='section'><b>Why this score:</b><ul>${factors}</ul></div>
        <div class='section'><b>Key points:</b><ul>${bullets}</ul></div>
        <div class='section'><b>Long summary (~250–350 words):</b><div>${data.summary.long}</div></div>
      `;
      status.textContent = '';
    }catch(err){
      status.textContent = 'Analyzer not found. Make sure it is running on http://127.0.0.1:4000';
    }
  }
  
  document.getElementById('analyze').addEventListener('click', analyze);
  