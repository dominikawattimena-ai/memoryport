import http from 'node:http';
import crypto from 'node:crypto';
const PORT=process.env.PORT||8080;
const AUTH='https://rsnjkbdasrekxghevrse.supabase.co/auth/v1';
const MCP='https://memoryport-bridge-v2-production.up.railway.app/mcp';
const states=new Map();
const send=(res,s,b,h={})=>{res.writeHead(s,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',...h});res.end(b)};
const form=o=>new URLSearchParams(o).toString();
async function register(redirect){
 const d=await fetch(AUTH+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'MemoryPort Gemini Verification',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
 if(!d.ok) throw new Error('DCR '+d.status+' '+await d.text()); return d.json();
}
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://local'); const base='https://'+(process.env.RAILWAY_PUBLIC_DOMAIN||req.headers.host); const redirect=base+'/callback';
 if(u.pathname==='/'){return send(res,200,'<h1>MemoryPort × Gemini verification</h1><p>Temporary isolated test service. Core MemoryPort is untouched.</p><a href="/start">Authorize MemoryPort for Gemini test</a>')}
 if(u.pathname==='/start'){try{const c=await register(redirect);const verifier=crypto.randomBytes(48).toString('base64url');const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');const state=crypto.randomBytes(24).toString('base64url');states.set(state,{verifier,client_id:c.client_id,redirect,at:Date.now()});const q=new URLSearchParams({response_type:'code',client_id:c.client_id,redirect_uri:redirect,state,code_challenge:challenge,code_challenge_method:'S256'});res.writeHead(302,{location:AUTH+'/oauth/authorize?'+q});return res.end()}catch(e){return send(res,500,'Start failed: '+String(e.message).replace(/[<>]/g,''))}}
 if(u.pathname==='/callback'){const state=u.searchParams.get('state'),code=u.searchParams.get('code'),x=states.get(state);states.delete(state);if(!x||!code)return send(res,400,'Invalid or expired OAuth callback.');try{
  const tr=await fetch(AUTH+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form({grant_type:'authorization_code',code,client_id:x.client_id,redirect_uri:x.redirect,code_verifier:x.verifier})});const td=await tr.json();if(!tr.ok)throw new Error('token exchange '+tr.status);
  const call=async(method,params={})=>{const r=await fetch(MCP,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+td.access_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return r.json()};
  const md=await call('tools/call',{name:'memoryport_get_context',arguments:{}});const context=md?.result?.structuredContent?.memories??[];
  const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('GEMINI_API_KEY missing');
  const prompt='Use ONLY this MemoryPort memory. In Indonesian, state the owner nickname and preferred answer style. Memory: '+JSON.stringify(context);
  const gr=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});const gd=await gr.json();if(!gr.ok)throw new Error('Gemini '+gr.status+' '+JSON.stringify(gd).slice(0,300));const answer=(gd.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
  return send(res,200,'<h1>Cross-AI READ result</h1><p><b>Memory rows:</b> '+context.length+'</p><pre>'+answer.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</pre><p>No token or API key is displayed.</p>');
 }catch(e){return send(res,500,'Test failed: '+String(e.message).replace(/[<>]/g,''))}}
 return send(res,404,'Not found');
}).listen(PORT,()=>console.log('Gemini OAuth test listening',PORT));