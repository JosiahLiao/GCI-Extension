const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json({limit:'6mb'}));

// --- CORS so the extension can fetch without errors ---
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// quick health check
app.get('/health', (req,res)=> res.type('text').send('OK'));

const STOPWORDS = new Set((`a an the and or but if then else when at by for in of on to from into over under with without about above after again against all am any are as be because been before being below between both cannot could did do does doing down during each few further had has have having he her here hers herself him himself his how i if into is it its itself just least me more most my myself no nor not now off once only other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through too until up very was we were what when where which while who whom why will with you your yours yourself yourselves`).split(/\s+/));

function tokenize(text){
  return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
}
function sentences(text){
  const s = text.replace(/\n+/g,' ').match(/[^.!?]+[.!?]+/g);
  return s ? s.map(x=>x.trim()) : [text.trim()].filter(Boolean);
}
function tfidfScore(sentencesArr){
  const docs = sentencesArr.map(s=>tokenize(s).filter(w=>!STOPWORDS.has(w)));
  const df = new Map();
  docs.forEach(doc=>{ new Set(doc).forEach(w=> df.set(w, (df.get(w)||0)+1)); });
  const N = docs.length;
  return docs.map(doc=>{
    const tf = new Map(); doc.forEach(w=> tf.set(w, (tf.get(w)||0)+1));
    let sum = 0;
    for(const [w,f] of tf){
      const idf = Math.log((1+N)/(1+(df.get(w)||1)))+1;
      sum += (f/doc.length)*idf;
    }
    return sum;
  });
}
function longSummary(text, targetWords=340){
  const sents = sentences(text).slice(0,80);
  if (!sents.length) return '';
  const scores = tfidfScore(sents);
  const idx = sents.map((_,i)=>i).sort((a,b)=> scores[b]-scores[a]);
  let total=0; const out=[];
  for(const i of idx){
    const words = sents[i].split(/\s+/).length;
    if(words<5) continue;
    if(total+words>targetWords+120 && out.length>4) break;
    out.push([i, sents[i]]);
    total += words;
    if(total>targetWords && out.length>=5) break;
  }
  out.sort((a,b)=>a[0]-b[0]);
  return out.map(x=>x[1]).join(' ');
}
function keyPoints(text, n=7){
  const sents = sentences(text).slice(0,80);
  const scores = tfidfScore(sents);
  const idx = sents.map((_,i)=>i).sort((a,b)=> scores[b]-scores[a]).slice(0,n*2);
  const points=[];
  for(const i of idx){
    let t = sents[i].trim();
    const words = t.split(/\s+/);
    if(words.length>22) t = words.slice(0,22).join(' ')+'…';
    if(!points.some(p=>p.toLowerCase()===t.toLowerCase())) points.push(t);
    if(points.length>=n) break;
  }
  return points;
}
function credibilityHeuristics(payload){
  const {url, host, protocol, title, meta={}, links=[], headings=[], hasRefs=false, scripts=[], text=''} = payload;
  const domain = (host||'').toLowerCase();
  let score = 50;
  const factors = [];

  if((protocol||'').startsWith('https')){ score+=5; factors.push('Uses HTTPS'); } else { score-=10; factors.push('Not using HTTPS'); }
  if(/\.(gov|mil)$/.test(domain)) { score+=25; factors.push('Government domain (.gov/.mil)'); }
  else if(/\.(edu|ac\.[a-z]+)$/.test(domain)) { score+=15; factors.push('Academic domain (.edu/.ac)'); }
  else if(/\.(org)$/.test(domain)) { score+=5; factors.push('Nonprofit domain (.org)'); }

  const author = meta['author'] || meta['article:author'] || '';
  if(author){ score+=5; factors.push('Author provided'); }
  const published = meta['article:published_time'] || meta['og:updated_time'] || meta['date'] || '';
  if(published){ score+=4; factors.push('Publish date provided'); }

  if(hasRefs || /\b(references|citations|sources|bibliography)\b/i.test(title||'')){
    score+=6; factors.push('References/citations present');
  }

  const external = links.filter(h=>/^https?:\/\//.test(h)).map(h=>{ try{ return new URL(h).host; }catch{ return null; } }).filter(Boolean);
  const uniqueExt = new Set(external.filter(h=>!h.endsWith(domain)));
  if(uniqueExt.size>=5){ score+=5; factors.push('Multiple external sources linked'); }

  const caps = (text.match(/[A-Z]{6,}/g)||[]).length;
  if(caps>20){ score-=8; factors.push('Unusual amount of ALL-CAPS words'); }
  const sensational = /(shocking|you won't believe|miracle|cure|secret revealed|exposed|debunked|click here)/i;
  if(sensational.test(text)) { score-=8; factors.push('Sensational/clickbait language detected'); }

  const adHints = scripts.filter(s=>/ads|doubleclick|taboola|outbrain|adservice/i.test(s)).length;
  if(adHints>=3){ score-=6; factors.push('Heavy ad/affiliate scripts detected'); }

  const wordCount = (text.match(/\w+/g)||[]).length;
  if(wordCount<150){ score-=8; factors.push('Very little page text'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let label = 'Low';
  if(score>=75) label='High'; else if(score>=45) label='Medium';
  return {domain, score, label, factors};
}

app.post('/api/analyze', (req, res)=>{
  const payload = req.body || {};
  const credibility = credibilityHeuristics(payload);
  const long = longSummary(payload.text||'', 340);
  const kp = keyPoints(payload.text||'', 7);
  res.json({ domain: credibility.domain, credibility, summary: { long, key_points: kp } });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log(`Analyzer listening on http://127.0.0.1:${PORT}`));
