import http from 'node:http';
const PORT=process.env.PORT||10000;
const j=(res,s,b,h={})=>{res.writeHead(s,{'content-type':'application/json','cache-control':'no-store',...h});res.end(JSON.stringify(b))};
const readBody=async req=>{let raw='';for await(const c of req)raw+=c;return raw};
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://local'); const base='https://'+(process.env.RAILWAY_PUBLIC_DOMAIN||req.headers.host||'memoryport-bridge-v2-production.up.railway.app');
 if(u.pathname==='/'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html'});return res.end('<!doctype html><meta charset="utf-8"><title>MemoryPort</title><h1>MemoryPort Claude Bridge</h1><p>ONE CARD · ONE MEMORY · ANY AI</p>')}
 if(u.pathname==='/_live_mcp_smoke'&&req.method==='GET'){try{const init=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'MemoryPort live smoke',version:'1.0'}}})});const initBody=await init.json();const list=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})});return j(res,200,{pass:init.status===200&&initBody?.result?.serverInfo?.name==='MemoryPort'&&list.status===401,initialize:{status:init.status,server:initBody?.result?.serverInfo?.name,protocol:initBody?.result?.protocolVersion},unauthenticatedToolsList:{status:list.status,wwwAuthenticate:list.headers.get('www-authenticate')}})}catch{return j(res,503,{pass:false,error:'smoke_failed'})}}
 if(u.pathname==='/.well-known/oauth-protected-resource')return j(res,200,{resource:base+'/mcp',authorization_servers:[base],scopes_supported:['memory:read','memory:write'],bearer_methods_supported:['header']});
 if(u.pathname==='/.well-known/oauth-authorization-server')return j(res,200,{issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',response_types_supported:['code'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],scopes_supported:['memory:read','memory:write']});
 if(u.pathname==='/authorize'){res.writeHead(503,{'content-type':'text/html','cache-control':'no-store'});return res.end('<!doctype html><meta charset="utf-8"><title>MemoryPort</title><h1>MemoryPort authorization pending</h1><p>Fail-closed: canonical owner pairing is not deployed yet. No credential is requested here.</p>')}
 if(u.pathname==='/token')return j(res,503,{error:'temporarily_unavailable',error_description:'Canonical owner pairing endpoint not deployed yet.'});
 if(u.pathname==='/mcp'&&req.method==='POST'){
   let b;try{b=JSON.parse(await readBody(req)||'{}')}catch{return j(res,400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})}
   if(b.method==='initialize')return j(res,200,{jsonrpc:'2.0',id:b.id??null,result:{protocolVersion:b.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'MemoryPort',version:'1.0.0'},instructions:'Portable owner-approved AI memory. Writes are candidate-only and require owner approval.'}});
   if(b.method==='notifications/initialized'){res.writeHead(204);return res.end()}
   if(b.method==='ping')return j(res,200,{jsonrpc:'2.0',id:b.id??null,result:{}});
   const auth=req.headers.authorization||'';
   if(!/^Bearer /i.test(auth))return j(res,401,{error:'unauthorized'},{'www-authenticate':'Bearer resource_metadata="'+base+'/.well-known/oauth-protected-resource"'});
   if(b.method==='tools/list')return j(res,200,{jsonrpc:'2.0',id:b.id??null,result:{tools:[{name:'memoryport_get_context',description:'Read owner-approved canonical MemoryPort context.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'memoryport_submit_candidate',description:'Submit a candidate memory for owner approval; never writes canonical memory directly.',inputSchema:{type:'object',properties:{content:{type:'string',minLength:1,maxLength:2000}},required:['content'],additionalProperties:false}}]}});
   return j(res,501,{jsonrpc:'2.0',id:b.id??null,error:{code:-32001,message:'Canonical authenticated bridge not active until owner OAuth pairing and candidate approval are deployed.'}})
 }
 return j(res,404,{error:'not_found'})
});
server.listen(PORT,()=>console.log('MemoryPort bridge listening',PORT));