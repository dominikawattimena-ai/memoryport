// MemoryPort internal orchestrator v1.
// Pure helpers: no network, no secrets, no vault mutation.

export function tokenize(value='') {
  return [...new Set(String(value).toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{2,}/gu) || [])];
}

export function selectRelevantMemories(prompt, drive, { limit = 6, maxChars = 12000 } = {}) {
  const memories = Array.isArray(drive?.memories) ? drive.memories : [];
  const q = new Set(tokenize(prompt));
  if (!q.size) return [];
  return memories.map((m, index) => {
    const title = tokenize(m?.title);
    const body = tokenize(m?.content);
    let score = 0;
    for (const t of title) if (q.has(t)) score += 4;
    for (const t of body) if (q.has(t)) score += 1;
    return { m, score, index };
  }).filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, limit))
    .reduce((out, x) => {
      const used = out.reduce((n,m)=>n+String(m.content||'').length,0);
      if (used >= maxChars) return out;
      const room = maxChars-used;
      out.push({...x.m, content:String(x.m.content||'').slice(0,room)});
      return out;
    }, []);
}

export function buildContextBlock(memories=[]) {
  if (!memories.length) return '';
  return memories.map((m,i)=>`[MEMORY ${i+1}]\nTitle: ${String(m.title||'Untitled')}\nContent: ${String(m.content||'')}`).join('\n\n');
}

export function providerFromEnv(env=process.env) {
  const name=String(env.MEMORYPORT_AI_PROVIDER||'').trim().toLowerCase();
  if (!name) return {ok:false,error:'provider_not_configured'};
  if (name==='gemini') {
    if (!env.GEMINI_API_KEY) return {ok:false,error:'gemini_key_missing'};
    return {ok:true,name,model:env.GEMINI_MODEL||'gemini-2.5-flash'};
  }
  if (name==='groq') {
    if (!env.GROQ_API_KEY) return {ok:false,error:'groq_key_missing'};
    return {ok:true,name,model:env.GROQ_MODEL||'llama-3.3-70b-versatile'};
  }
  return {ok:false,error:'unsupported_provider'};
}

export function validateCandidateMemory(candidate) {
  if (!candidate || candidate.save !== true) return {save:false};
  const title=String(candidate.title||'').trim().slice(0,160);
  const content=String(candidate.content||'').trim();
  if (!title || !content || content.length>6000) return {save:false};
  return {save:true,title,content};
}
