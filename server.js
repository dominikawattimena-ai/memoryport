import http from "node:http";
import {
  buildContextBlock,
  callProvider,
  candidateIsGrounded,
  extractExplicitMemory,
  findMemoryConflict,
  providerFromEnv,
  selectRelevantMemories,
  validateCandidateMemory,
} from "./orchestrator.js";
const PORT = process.env.PORT || 10000,
  SUPABASE = "https://rsnjkbdasrekxghevrse.supabase.co",
  AUTH = SUPABASE + "/auth/v1",
  KEY = "sb_publishable_k9b1xloyfGxmTqM5PY0ZnA_BR3X_s15";
const SEC = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "frame-ancestors 'none'",
};
const j = (r, s, b, h = {}) => {
    r.writeHead(s, {
      ...SEC,
      "content-type": "application/json",
      "cache-control": "no-store",
      ...h,
    });
    r.end(JSON.stringify(b));
  },
  body = async (q) => {
    let x = "";
    for await (const c of q) {
      x += c;
      if (x.length > 32768) {
        const e = new Error("payload_too_large");
        e.status = 413;
        throw e;
      }
    }
    return x;
  };
const agentRate = new Map();
const allowAgentRequest = (id) => {
  const now = Date.now(),
    row = agentRate.get(id) || { start: now, count: 0 };
  if (now - row.start > 60000) {
    row.start = now;
    row.count = 0;
  }
  row.count++;
  agentRate.set(id, row);
  return row.count <= 20;
};
const tools = [
  {
    name: "memoryport_get_context",
    description:
      "Read the owner MemoryPort drive: visible folders, memory titles, IDs, and contents. Read-only.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "memoryport_remember",
    description:
      "Create a new memory in the owner MemoryPort. Long content is automatically chunked and returned to AI as one logical memory. This changes owner data; call only when the owner asks to save something.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1, maxLength: 160 },
        folder_id: { type: ["string", "null"] },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "memoryport_create_folder",
    description:
      "Create a folder in the owner MemoryPort. Mutating action: requires owner approval in the AI client.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120 },
        parent_id: { type: ["string", "null"] },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "memoryport_update_memory",
    description:
      "Edit or rename a memory chunk, or explicitly target its whole chunk group. Mutating action: requires owner approval in the AI client.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: ["string", "null"], maxLength: 160 },
        content: { type: ["string", "null"], maxLength: 6000 },
        scope: { type: "string", enum: ["chunk", "group"], default: "chunk" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memoryport_move_memory",
    description:
      "Move one specific memory to a folder or root. Mutating action: requires owner approval in the AI client.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        folder_id: { type: ["string", "null"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memoryport_delete_memory",
    description:
      "Permanently delete one memory chunk or explicitly its entire chunk group. Destructive action: call only after explicit owner request and approval.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        scope: { type: "string", enum: ["chunk", "group"], default: "chunk" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memoryport_rename_folder",
    description:
      "Rename one specific folder. Mutating action: requires owner approval in the AI client.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["id", "name"],
      additionalProperties: false,
    },
  },
];
const splitMemory = (text, max = 6000) => {
  const src = String(text || "").trim();
  if (src.length <= max) return [src];
  const paras = src
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    out = [];
  let cur = "";
  const push = (s) => {
    if (s) out.push(s.trim());
  };
  for (const p0 of paras) {
    let p = p0;
    while (p.length > max) {
      let cut = p.lastIndexOf(". ", max);
      if (cut < max * 0.6) cut = p.lastIndexOf(" ", max);
      if (cut < 1) cut = max;
      else cut += 1;
      const part = p.slice(0, cut).trim();
      if (cur) {
        push(cur);
        cur = "";
      }
      push(part);
      p = p.slice(cut).trim();
    }
    if (!p) continue;
    const next = cur ? cur + "\n\n" + p : p;
    if (next.length <= max) cur = next;
    else {
      push(cur);
      cur = p;
    }
  }
  push(cur);
  return out;
};
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://local"),
      base =
        "https://" + (process.env.RAILWAY_PUBLIC_DOMAIN || req.headers.host);
    if (
      u.pathname === "/MemoryPort_Card_LOCKED.png" &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      const asset = await fetch(
        "https://raw.githubusercontent.com/dominikawattimena-ai/memoryport/main/MemoryPort_Card_LOCKED.png",
      );
      if (!asset.ok) return j(res, 502, { error: "card_asset_unavailable" });
      res.writeHead(200, {
        ...SEC,
        "content-type": "image/png",
        "cache-control": "public, max-age=3600",
      });
      if (req.method === "HEAD") return res.end();
      return res.end(Buffer.from(await asset.arrayBuffer()));
    }
    if (u.pathname === "/MemoryPort_Card_LOCKED.png" && req.method === "GET") {
      return fetch(
        "https://raw.githubusercontent.com/dominikawattimena-ai/memoryport/main/MemoryPort_Card_LOCKED.png",
      ).then(async (x) => {
        if (!x.ok) return j(res, 502, { error: "card_asset_unavailable" });
        const buf = Buffer.from(await x.arrayBuffer());
        res.writeHead(200, {
          ...SEC,
          "content-type": "image/png",
          "cache-control": "public, max-age=3600, immutable",
          "content-length": buf.length,
        });
        res.end(buf);
      });
    }
    if (u.pathname === "/" && req.method === "GET") {
      res.writeHead(200, {
        ...SEC,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      });
      return res.end(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoryPort · Personal AI Memory Wallet</title><meta name="description" content="One Card. One Memory. Any AI."><meta property="og:title" content="MemoryPort · Personal AI Memory"><meta property="og:description" content="Your memory, independent of your AI."><meta property="og:image" content="${base}/MemoryPort_Card_LOCKED.png"><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#F8FAFC;color:#0F172A;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;display:grid;place-items:center;padding:24px}.wrap{width:min(1000px,100%);text-align:center}.visual{position:relative}.cardimg{display:block;width:100%;height:auto}.hot{position:absolute;left:19.2%;right:19.2%;top:70.4%;height:6.2%;border-radius:14px}.get{display:inline-block;margin-top:18px;background:#0F172A;color:#fff;text-decoration:none;border-radius:16px;padding:14px 22px;font-weight:850}.meta{font-size:12px;color:#64748b;margin-top:14px}.meta a{color:inherit}</style></head><body><main class="wrap"><div class="visual"><img class="cardimg" src="/MemoryPort_Card_LOCKED.png" alt="MemoryPort Digital Memory Card"><a class="hot" href="/app" aria-label="Get or open my MemoryPort card"></a></div><a class="get" href="/app">Get My Memory Card</a><div class="meta"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div></main></body></html>`,
      );
    }
    if (u.pathname === "/app" && req.method === "GET") {
      res.writeHead(200, {
        ...SEC,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoryPort · My Card</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;display:grid;place-items:center;padding:24px}.c{width:min(760px,100%);text-align:center}.panel{background:#fff;border-radius:24px;padding:24px;box-shadow:0 18px 50px #0f172a14}.brand{font-weight:900;letter-spacing:.08em;color:#14b8a6}.muted{color:#64748b;line-height:1.5}.cardid{font:700 18px ui-monospace,SFMono-Regular,monospace;letter-spacing:.06em;background:#f1f5f9;padding:12px 14px;border-radius:12px;display:inline-block}.btn{display:inline-block;background:#0f172a;color:#fff;border:0;text-decoration:none;border-radius:14px;padding:13px 18px;font-weight:800}.small{font-size:12px;color:#64748b;margin-top:16px}.small a{color:inherit}input{width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:12px;margin:8px 0 12px}.preview{position:relative;overflow:hidden;border-radius:18px;margin:18px auto;max-width:620px}.preview img{display:block;width:100%}.owner-name{position:absolute;left:40.7%;top:47.7%;width:30%;text-align:left;font-family:Arial,Helvetica,sans-serif;font-weight:600;font-size:clamp(8px,1.45vw,14px);line-height:1;color:#d9dde3;text-transform:uppercase;letter-spacing:.16em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;text-shadow:-.6px -.6px .5px rgba(255,255,255,.95),.7px .7px .7px rgba(15,23,42,.7),0 1px 1px rgba(15,23,42,.25)}.profile{max-width:520px;margin:16px auto}</style></head><body><main class="c"><section class="panel"><div class="brand">MEMORYPORT</div><div id="app"><h1>Your AI memory belongs to you.</h1><p class="muted">Sign in with your email. New owners automatically receive one private Memory Card.</p><input id="email" type="email" autocomplete="email" placeholder="Email"><button class="btn" id="login">Get My Memory Card</button><p id="status" class="muted"></p></div><div class="small"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const sb=createClient('https://rsnjkbdasrekxghevrse.supabase.co','sb_publishable_k9b1xloyfGxmTqM5PY0ZnA_BR3X_s15',{auth:{persistSession:true,detectSessionInUrl:true}}),app=document.getElementById('app');const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function show(){const{data:{session}}=await sb.auth.getSession();if(!session){document.getElementById('login').onclick=async()=>{const email=document.getElementById('email').value.trim(),s=document.getElementById('status');if(!email){s.textContent='Enter your email.';return}const{error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+'/app'}});s.textContent=error?error.message:'Secure sign-in link sent. Open the newest email to continue.'};return}const{data,error}=await sb.rpc('memoryport_my_card');if(error||!data?.[0]){app.innerHTML='<h1>Card setup is not ready.</h1><p class="muted">Your account is signed in, but your card could not be loaded. No duplicate card was created.</p>';return}const id=esc(data[0].card_id);const{data:card}=await sb.from('memoryport_cards').select('display_name').single();let name=card?.display_name||'';app.innerHTML='<h1>My Memory Card</h1><p class="muted">Owned by you · private memory · portable across supported AI connections.</p><div class="preview"><img src="/MemoryPort_Card_LOCKED.png" alt="MemoryPort card"><div id="ownerName" class="owner-name">MY MEMORY</div></div><div class="cardid">'+id+'</div><div class="profile"><input id="displayName" maxlength="60" placeholder="Name on your MemoryPort profile" value="'+esc(name)+'"><button class="btn" id="saveProfile">Save profile</button><p id="profileStatus" class="muted"></p></div><p><a class="btn" href="/agent">Open MemoryPort Agent</a> <a class="btn" href="/memory" style="background:#fff;color:#0f172a;border:1px solid #cbd5e1">My Memory</a> <a class="btn" href="/connect" style="background:#fff;color:#0f172a;border:1px solid #cbd5e1">Connect Memory</a></p><p class="muted">Your Card ID is a reference, not a password. Never share access tokens or API keys.</p><button class="btn" id="out" style="background:#fff;color:#0f172a;border:1px solid #cbd5e1">Sign out</button>';const ownerName=document.getElementById('ownerName');const paintName=n=>{ownerName.textContent=(n||'MY MEMORY').toUpperCase()};paintName(name);document.getElementById('displayName').addEventListener('input',e=>paintName(e.target.value.trim()));document.getElementById('saveProfile').onclick=async()=>{const n=document.getElementById('displayName').value.trim(),ps=document.getElementById('profileStatus');if(!n){ps.textContent='Enter a display name.';return}const{error}=await sb.rpc('memoryport_update_card_profile',{p_display_name:n,p_card_theme:'ice_blue'});if(error){ps.textContent=error.message;return}paintName(n);ps.textContent='Saved to your card.'};document.getElementById('out').onclick=async()=>{await sb.auth.signOut();location.reload()}}show();</script></body></html>`,
      );
    }

    if (u.pathname === "/memory" && req.method === "GET") {
      res.writeHead(200, {
        ...SEC,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoryPort · My Memory</title><style>*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#0f172a;font-family:Inter,system-ui,sans-serif;padding:24px}.wrap{max-width:980px;margin:auto}.top{display:flex;justify-content:space-between;align-items:center;gap:12px}.brand{font-weight:900;letter-spacing:.08em;color:#14b8a6}.panel{background:#fff;border-radius:22px;padding:20px;box-shadow:0 14px 45px #0f172a12;margin-top:18px}.bar{display:flex;gap:8px;flex-wrap:wrap}.btn{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:11px;padding:9px 12px;font-weight:750;cursor:pointer}.primary{background:#0f172a;color:#fff;border-color:#0f172a}.folder{display:inline-flex;gap:8px;align-items:center;padding:10px 12px;background:#f1f5f9;border-radius:12px;margin:6px 6px 6px 0}.table{width:100%;border-collapse:collapse;margin-top:12px}.table th,.table td{text-align:left;padding:12px 8px;border-top:1px solid #e2e8f0;font-size:14px}.muted{color:#64748b}.name{font-weight:750}.actions{display:flex;gap:6px;flex-wrap:wrap}.viewer{white-space:pre-wrap;background:#f8fafc;padding:14px;border-radius:12px;max-height:360px;overflow:auto}.danger{color:#b91c1c}.hidden{display:none}@media(max-width:700px){.table th:nth-child(2),.table td:nth-child(2){display:none}.top{align-items:flex-start;flex-direction:column}}</style></head><body><main class="wrap"><div class="top"><div><div class="brand">MEMORYPORT</div><h1>My Memory</h1><div class="muted">Your private AI memory drive. You own and control every item.</div></div><a href="/app" class="btn">← My Card</a></div><section class="panel"><div class="bar"><button class="btn primary" id="newFolder">+ Folder</button><button class="btn" id="newMemory">+ Memory</button></div><div id="folders"></div><div id="status" class="muted"></div><table class="table"><thead><tr><th>Name</th><th>Folder</th><th>Size</th><th>Updated</th><th></th></tr></thead><tbody id="rows"></tbody></table></section><section class="panel hidden" id="detail"><div class="top"><h2 id="detailTitle"></h2><button class="btn" id="closeDetail">Close</button></div><div class="viewer" id="detailContent"></div></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const sb=createClient('https://rsnjkbdasrekxghevrse.supabase.co','sb_publishable_k9b1xloyfGxmTqM5PY0ZnA_BR3X_s15',{auth:{persistSession:true,detectSessionInUrl:true}}),rows=document.getElementById('rows'),foldersEl=document.getElementById('folders'),status=document.getElementById('status');let folders=[],memories=[];const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=n=>n<1024?n+' B':(n/1024).toFixed(1)+' KB',fname=id=>folders.find(f=>f.id===id)?.name||'My Memory';async function load(){const{data:{session}}=await sb.auth.getSession();if(!session){location.href='/app';return}const[{data:f,error:fe},{data:m,error:me}]=await Promise.all([sb.from('memoryport_folders').select('id,name,parent_id,created_at').order('created_at'),sb.from('memoryport_memories').select('id,title,folder_id,content,ai_visible,updated_at').order('updated_at',{ascending:false})]);if(fe||me){status.textContent='Could not load your memory.';return}folders=f||[];memories=m||[];render()}function render(){foldersEl.innerHTML=folders.map(f=>'<span class="folder">📁 '+esc(f.name)+' <button class="btn" data-rf="'+f.id+'">Rename</button></span>').join('');rows.innerHTML=memories.map(m=>'<tr><td class="name">📄 '+esc(m.title)+'</td><td>'+esc(fname(m.folder_id))+'</td><td>'+fmt(new TextEncoder().encode(m.content||'').length)+'</td><td>'+new Date(m.updated_at).toLocaleString()+'</td><td><div class="actions"><button class="btn" data-view="'+m.id+'">View</button><button class="btn" data-rename="'+m.id+'">Rename</button><button class="btn" data-edit="'+m.id+'">Edit</button><button class="btn" data-move="'+m.id+'">Move</button><button class="btn" data-ai="'+m.id+'">'+(m.ai_visible?'AI: Shared':'AI: Private')+'</button><button class="btn danger" data-del="'+m.id+'">Delete</button></div></td></tr>').join('')||'<tr><td colspan="5" class="muted">No memories yet.</td></tr>'}document.addEventListener('click',async e=>{const t=e.target;if(t.dataset.view){const m=memories.find(x=>x.id===t.dataset.view);document.getElementById('detailTitle').textContent=m.title;document.getElementById('detailContent').textContent=m.content;document.getElementById('detail').classList.remove('hidden')}if(t.dataset.rename){const m=memories.find(x=>x.id===t.dataset.rename),v=prompt('Rename memory',m.title);if(v&&v.trim()){await sb.rpc('memoryport_update_memory',{p_id:m.id,p_title:v.trim(),p_content:null});load()}}if(t.dataset.edit){const m=memories.find(x=>x.id===t.dataset.edit),v=prompt('Edit memory',m.content);if(v&&v.trim()){await sb.rpc('memoryport_update_memory',{p_id:m.id,p_title:null,p_content:v.trim()});load()}}if(t.dataset.move){const m=memories.find(x=>x.id===t.dataset.move),opts=['0: My Memory',...folders.map((f,i)=>(i+1)+': '+f.name)],v=prompt('Move to folder:\n'+opts.join('\n'),'0');if(v!==null){const n=Number(v),fid=n===0?null:folders[n-1]?.id;if(n===0||fid){const{error}=await sb.rpc('memoryport_move_memory',{p_id:m.id,p_folder_id:fid});if(error)alert(error.message);load()}}}if(t.dataset.ai){const m=memories.find(x=>x.id===t.dataset.ai),next=!m.ai_visible;if(confirm(next?'Share “'+m.title+'” with connected AI?':'Make “'+m.title+'” private from connected AI?')){const{error}=await sb.rpc('memoryport_set_ai_visibility',{p_id:m.id,p_ai_visible:next});if(error)alert(error.message);load()}}if(t.dataset.del){const m=memories.find(x=>x.id===t.dataset.del);if(confirm('Delete “'+m.title+'”? This cannot be undone.')){await sb.rpc('memoryport_delete_memory',{p_id:m.id});load()}}if(t.dataset.rf){const f=folders.find(x=>x.id===t.dataset.rf),v=prompt('Rename folder',f.name);if(v&&v.trim()){await sb.rpc('memoryport_rename_folder',{p_id:f.id,p_name:v.trim()});load()}}});document.getElementById('closeDetail').onclick=()=>document.getElementById('detail').classList.add('hidden');document.getElementById('newFolder').onclick=async()=>{const v=prompt('Folder name');if(v&&v.trim()){const{error}=await sb.rpc('memoryport_create_folder',{p_name:v.trim(),p_parent_id:null});if(error)alert(error.message);load()}};document.getElementById('newMemory').onclick=async()=>{const title=prompt('Memory name');if(!title?.trim())return;const content=prompt('Memory content');if(!content?.trim())return;const{error}=await sb.rpc('memoryport_create_memory',{p_title:title.trim(),p_content:content.trim(),p_folder_id:null});if(error)alert(error.message);load()};load();</script></body></html>`,
      );
    }
    if (u.pathname === "/agent" && req.method === "GET") {
      res.writeHead(200, {
        ...SEC,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoryPort Agent</title><style>*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#0f172a;font-family:Inter,system-ui,sans-serif}.shell{max-width:780px;margin:auto;min-height:100vh;display:flex;flex-direction:column;padding:22px}.top{display:flex;justify-content:space-between;align-items:center}.brand{font-weight:900;letter-spacing:.08em;color:#14b8a6}.back{color:#475569;text-decoration:none}.sub{color:#64748b;margin:5px 0 18px}.chat{flex:1;background:#fff;border-radius:22px;padding:18px;box-shadow:0 14px 45px #0f172a12;overflow:auto;min-height:55vh}.msg{max-width:82%;padding:12px 14px;border-radius:16px;margin:10px 0;white-space:pre-wrap;line-height:1.5}.me{margin-left:auto;background:#0f172a;color:#fff}.ai{background:#ecfeff;border:1px solid #ccfbf1}.composer{display:flex;gap:9px;margin-top:14px}.composer textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:14px;padding:13px;font:inherit}.composer button{border:0;border-radius:14px;padding:0 18px;background:#0f172a;color:#fff;font-weight:800}.note{font-size:12px;color:#64748b;margin-top:8px}.saved{color:#0f766e;font-size:12px;margin:4px 0}@media(max-width:600px){.shell{padding:14px}.msg{max-width:92%}}</style></head><body><main class="shell"><header class="top"><div><div class="brand">MEMORYPORT</div><h1>MemoryPort Agent</h1></div><a class="back" href="/app">My Card</a></header><p class="sub">Your AI that remembers you.</p><section class="chat" id="chat"><div class="msg ai">Hi. What would you like to work on?</div></section><form class="composer" id="form"><textarea id="input" maxlength="4000" rows="2" placeholder="Ask MemoryPort..." required></textarea><button>Send</button></form><div class="note" id="status">Only relevant AI-visible memory is used.</div></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const sb=createClient('${SUPABASE}','${KEY}',{auth:{persistSession:true,detectSessionInUrl:true}}),chat=document.getElementById('chat'),form=document.getElementById('form'),input=document.getElementById('input'),status=document.getElementById('status');let history=[];const add=(text,role)=>{const d=document.createElement('div');d.className='msg '+(role==='user'?'me':'ai');d.textContent=text;chat.appendChild(d);chat.scrollTop=chat.scrollHeight};const{data:{session}}=await sb.auth.getSession();if(!session)location.href='/app';form.onsubmit=async e=>{e.preventDefault();const message=input.value.trim();if(!message)return;add(message,'user');input.value='';form.querySelector('button').disabled=true;status.textContent='MemoryPort is thinking…';try{const r=await fetch('/api/agent/chat',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:JSON.stringify({message,history})}),d=await r.json();if(!r.ok)throw Error(d.error||'request_failed');add(d.answer,'assistant');history=[...history,{role:'user',content:message},{role:'assistant',content:d.answer}].slice(-10);status.textContent=d.memory_saved?'Remembered in your MemoryPort vault.':'Only relevant AI-visible memory is used.'}catch{add('MemoryPort could not answer right now. Your memory was not changed.','assistant');status.textContent='Please try again.'}finally{form.querySelector('button').disabled=false;input.focus()}};</script></body></html>`,
      );
    }
    if (u.pathname === "/api/agent/chat" && req.method === "POST") {
      let payload;
      try {
        payload = JSON.parse((await body(req)) || "{}");
      } catch (e) {
        return j(res, e?.status === 413 ? 413 : 400, {
          error: e?.status === 413 ? "payload_too_large" : "invalid_request",
        });
      }
      const auth = req.headers.authorization || "";
      if (!/^Bearer /i.test(auth))
        return j(res, 401, { error: "unauthorized" });
      const token = auth.replace(/^Bearer\s+/i, ""),
        ur = await fetch(AUTH + "/user", {
          headers: { apikey: KEY, authorization: "Bearer " + token },
        }),
        user = await ur.json().catch(() => null);
      if (!ur.ok || !user?.id) return j(res, 401, { error: "unauthorized" });
      if (!allowAgentRequest(user.id))
        return j(res, 429, { error: "rate_limited" });
      const message = String(payload?.message || "").trim();
      if (!message || message.length > 4000)
        return j(res, 400, { error: "invalid_message" });
      const headers = {
        "content-type": "application/json",
        apikey: KEY,
        authorization: "Bearer " + token,
      };
      const dr = await fetch(
          SUPABASE + "/rest/v1/rpc/memoryport_drive_context",
          { method: "POST", headers, body: "{}" },
        ),
        drive = await dr.json().catch(() => null);
      if (!dr.ok || !drive) return j(res, 503, { error: "memory_unavailable" });
      const selected = selectRelevantMemories(message, drive, {
          limit: 6,
          maxChars: 12000,
        }),
        config = providerFromEnv();
      if (!config.ok) return j(res, 503, { error: "agent_not_configured" });
      try {
        const out = await callProvider(config, {
          message,
          history: payload?.history,
          memoryBlock: buildContextBlock(selected),
        });
        let answer = String(out?.answer || "")
          .trim()
          .slice(0, 8000);
        if (!answer) throw Error("empty_answer");
        let memorySaved = false,
          memoryConflict = false;
        let candidate = validateCandidateMemory(out?.memory_candidate);
        if (!candidate.save || !candidateIsGrounded(candidate, message))
          candidate = extractExplicitMemory(message);
        if (candidate.save && candidateIsGrounded(candidate, message)) {
          const conflict = findMemoryConflict(candidate, drive.memories || []);
          if (conflict) {
            memoryConflict = true;
            if (
              String(conflict.content || "")
                .trim()
                .toLowerCase() !==
              String(candidate.content || "")
                .trim()
                .toLowerCase()
            ) {
              answer +=
                "\n\nI found an existing memory with different information, so I did not overwrite it. Please confirm the change in My Memory.";
            }
          } else {
            const sr = await fetch(
              SUPABASE + "/rest/v1/rpc/memoryport_create_memory",
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  p_title: candidate.title,
                  p_content: candidate.content,
                  p_folder_id: null,
                }),
              },
            );
            memorySaved = sr.ok;
          }
        }
        return j(res, 200, {
          answer,
          memory_saved: memorySaved,
          memory_conflict: memoryConflict,
        });
      } catch {
        return j(res, 502, { error: "agent_temporarily_unavailable" });
      }
    }
    if (u.pathname === "/privacy" && req.method === "GET") {
      res.writeHead(200, {
        ...SEC,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      });
      return res.end(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoryPort Privacy</title><style>body{font:16px system-ui;line-height:1.6;max-width:760px;margin:48px auto;padding:0 20px;color:#0f172a}a{color:#0f172a}</style><h1>MemoryPort Privacy</h1><p>MemoryPort stores the minimum data needed for the service: your authenticated owner account identifier, Memory Card identifier, memory entries you ask an AI to save, and authorization records needed to connect supported AI clients.</p><p>Your private memory is protected by owner authentication and database row-level access controls. AI clients receive MemoryPort data only through an authorized connection. Server-side provider keys and OAuth access tokens are not shown on the public card.</p><p>MemoryPort does not treat the public Card ID as a password or bearer credential.</p><p><a href="/">Back to MemoryPort</a></p>`,
      );
    }
    if (u.pathname === "/terms" && req.method === "GET") {
      res.writeHead(200, {
        ...SEC,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      });
      return res.end(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoryPort Terms</title><style>body{font:16px system-ui;line-height:1.6;max-width:760px;margin:48px auto;padding:0 20px;color:#0f172a}a{color:#0f172a}</style><h1>MemoryPort MVP Terms</h1><p>MemoryPort is a personal AI memory wallet. One owner account receives one Memory Card linked to one canonical memory store. Availability of third-party AI connections depends on those providers.</p><p>Do not use MemoryPort to store passwords, API keys, access tokens, payment credentials, or other secrets. You remain responsible for the information you choose to save through connected AI services.</p><p>This is an MVP release and service behavior may evolve while preserving owner control and portable-memory principles.</p><p><a href="/">Back to MemoryPort</a></p>`,
      );
    }
    if (u.pathname === "/connect" && req.method === "GET") {
      res.writeHead(200, {
        ...SEC,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoryPort · Connect</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;display:grid;place-items:center;padding:24px}.c{width:min(620px,100%);background:#fff;border-radius:28px;padding:30px;box-shadow:0 20px 60px #0f172a14}.brand{font-weight:900;letter-spacing:.08em;color:#14b8a6}.card{width:100%;border-radius:20px;margin:18px 0}.step{padding:16px 0;border-top:1px solid #e2e8f0}.step b{display:block;margin-bottom:5px}.muted{color:#64748b;line-height:1.5}.url{display:block;background:#f1f5f9;padding:12px;border-radius:12px;overflow-wrap:anywhere;font:13px ui-monospace,SFMono-Regular,monospace}.back{display:inline-block;margin-top:18px;color:#0f172a;font-weight:750}</style></head><body><main class="c"><div class="brand">MEMORYPORT</div><h1>Connect your Memory Card</h1><img class="card" src="/MemoryPort_Card_LOCKED.png" alt="Your MemoryPort card"><div class="step"><b>Claude</b><span class="muted">Add MemoryPort as a custom connector once, then approve the secure MemoryPort permission screen.</span><span class="url">${base}/mcp</span></div><div class="step"><b>GPT & Gemini</b><span class="muted">MemoryPort already uses the standard remote MCP endpoint. Provider-native consumer connection availability depends on the AI product. Your card and canonical memory do not change.</span></div><div class="step"><b>Permission</b><span class="muted">Only the MemoryPort owner can authorize access. Never paste API keys or access tokens into chat.</span></div><a class="back" href="/">← Back to my Memory Card</a></main></body></html>`,
      );
    }
    if (u.pathname === "/oauth/consent" && req.method === "GET") {
      res.writeHead(200, {
        ...SEC,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoryPort · Connect AI</title><style>body{font:16px system-ui;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}.c{width:min(520px,calc(100% - 40px));background:#fff;padding:28px;border-radius:26px;box-shadow:0 18px 50px #0f172a18}.brand{color:#14b8a6;font-weight:800}.muted{color:#64748b}.row{display:flex;gap:10px}.a{background:#0f172a;color:#fff;border:0;border-radius:14px;padding:14px 18px;font-weight:700;flex:1}.deny{background:#fff;color:#0f172a;border:1px solid #cbd5e1}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:12px;margin:8px 0 12px}</style><main class="c"><div class="brand">MEMORYPORT</div><h1>Connect your Memory Card</h1><div id="app"><p class="muted">Loading secure authorization…</p></div></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const sb=createClient('https://rsnjkbdasrekxghevrse.supabase.co','sb_publishable_k9b1xloyfGxmTqM5PY0ZnA_BR3X_s15',{auth:{persistSession:true,detectSessionInUrl:true}}),app=document.getElementById('app'),aid=new URLSearchParams(location.search).get('authorization_id'),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function render(){if(!aid){app.innerHTML='<p>Authorization request tidak valid.</p>';return}const{data:{session}}=await sb.auth.getSession();if(!session){app.innerHTML='<p>Verifikasi sebagai pemilik Memory Card.</p><input id="email" type="email" placeholder="Email owner"><button class="a" id="login">Send secure sign-in link</button><p id="s" class="muted"></p>';document.getElementById('login').onclick=async()=>{const email=document.getElementById('email').value.trim(),s=document.getElementById('s');if(!email){s.textContent='Masukkan email owner.';return}const{error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:location.href}});s.textContent=error?error.message:'Link dikirim. Buka email terbaru untuk melanjutkan.'};return}const{data:d,error}=await sb.auth.oauth.getAuthorizationDetails(aid);if(error){app.innerHTML='<p>Authorization gagal: '+esc(error.message)+'</p>';return}app.innerHTML='<p><b>'+esc(d.client?.name||'AI connector')+'</b> meminta akses ke MemoryPort kamu.</p><p class="muted">Izin: membaca dan menyimpan memory melalui MemoryPort. Kamu dapat mencabut akses nanti.</p><div class="row"><button class="a" id="ok">Allow</button><button class="a deny" id="no">Deny</button></div><p id="s" class="muted"></p>';document.getElementById('ok').onclick=async()=>{const{data,error}=await sb.auth.oauth.approveAuthorization(aid);if(error)return document.getElementById('s').textContent=error.message;location.href=data.redirect_url};document.getElementById('no').onclick=async()=>{const{data,error}=await sb.auth.oauth.denyAuthorization(aid);if(error)return document.getElementById('s').textContent=error.message;location.href=data.redirect_url}}render();</script>`,
      );
    }
    if (
      u.pathname === "/.well-known/oauth-protected-resource" ||
      u.pathname === "/.well-known/oauth-protected-resource/mcp"
    )
      return j(res, 200, {
        resource: base + "/mcp",
        authorization_servers: [AUTH],
        bearer_methods_supported: ["header"],
      });
    if (u.pathname === "/mcp" && req.method === "POST") {
      let b;
      try {
        b = JSON.parse((await body(req)) || "{}");
      } catch (e) {
        if (e?.status === 413)
          return j(res, 413, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Request too large" },
          });
        return j(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
      }
      if (b.method === "initialize")
        return j(res, 200, {
          jsonrpc: "2.0",
          id: b.id ?? null,
          result: {
            protocolVersion: b.params?.protocolVersion || "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "MemoryPort", version: "2.0.0" },
            instructions: "ONE CARD · ONE MEMORY · ANY AI",
          },
        });
      if (b.method === "notifications/initialized") {
        res.writeHead(204);
        return res.end();
      }
      if (b.method === "ping")
        return j(res, 200, { jsonrpc: "2.0", id: b.id ?? null, result: {} });
      const auth = req.headers.authorization || "";
      if (!/^Bearer /i.test(auth))
        return j(
          res,
          401,
          { error: "unauthorized" },
          {
            "www-authenticate":
              'Bearer resource_metadata="' +
              base +
              '/.well-known/oauth-protected-resource/mcp"',
          },
        );
      const token = auth.replace(/^Bearer\s+/i, ""),
        ur = await fetch(AUTH + "/user", {
          headers: { apikey: KEY, authorization: "Bearer " + token },
        });
      if (!ur.ok) return j(res, 401, { error: "unauthorized" });
      if (b.method === "tools/list")
        return j(res, 200, {
          jsonrpc: "2.0",
          id: b.id ?? null,
          result: { tools },
        });
      const headers = {
        "content-type": "application/json",
        apikey: KEY,
        authorization: "Bearer " + token,
      };
      if (
        b.method === "tools/call" &&
        b.params?.name === "memoryport_get_context"
      ) {
        const r = await fetch(
            SUPABASE + "/rest/v1/rpc/memoryport_drive_context",
            { method: "POST", headers, body: "{}" },
          ),
          d = await r.json().catch(() => ({ folders: [], memories: [] }));
        if (!r.ok)
          return j(res, 500, {
            jsonrpc: "2.0",
            id: b.id ?? null,
            error: { code: -32001, message: "Memory read failed" },
          });
        return j(res, 200, {
          jsonrpc: "2.0",
          id: b.id ?? null,
          result: {
            content: [{ type: "text", text: JSON.stringify(d) }],
            structuredContent: d,
          },
        });
      }
      if (b.method === "tools/call") {
        const name = b.params?.name,
          a = b.params?.arguments || {};
        let rpc = null,
          payload = {};
        if (name === "memoryport_remember") {
          const content = String(a.content || "").trim();
          if (!content)
            return j(res, 400, {
              jsonrpc: "2.0",
              id: b.id ?? null,
              error: { code: -32602, message: "Invalid memory content" },
            });
          const chunks = splitMemory(content),
            base =
              String(a.title || "Memory")
                .trim()
                .slice(0, 145) || "Memory",
            gid = chunks.length > 1 ? crypto.randomUUID() : null,
            ids = [];
          for (let i = 0; i < chunks.length; i++) {
            const pp = {
              p_title:
                chunks.length > 1
                  ? base + " (" + (i + 1) + "/" + chunks.length + ")"
                  : base,
              p_content: chunks[i],
              p_folder_id: a.folder_id || null,
              p_group_id: gid,
              p_chunk_index: gid ? i + 1 : null,
            };
            const rr = await fetch(
                SUPABASE + "/rest/v1/rpc/memoryport_create_memory",
                { method: "POST", headers, body: JSON.stringify(pp) },
              ),
              dd = await rr.json().catch(() => null);
            if (!rr.ok)
              return j(res, 400, {
                jsonrpc: "2.0",
                id: b.id ?? null,
                error: { code: -32002, message: "Memory action rejected" },
              });
            ids.push(dd);
          }
          return j(res, 200, {
            jsonrpc: "2.0",
            id: b.id ?? null,
            result: {
              content: [
                {
                  type: "text",
                  text:
                    chunks.length > 1
                      ? "MemoryPort saved " +
                        chunks.length +
                        " linked chunks as one logical memory."
                      : "MemoryPort action completed.",
                },
              ],
              structuredContent: {
                ok: true,
                id: ids[0],
                ids,
                group_id: gid,
                chunks: chunks.length,
              },
            },
          });
        }
        if (name === "memoryport_create_folder") {
          rpc = "memoryport_create_folder";
          payload = {
            p_name: String(a.name || "").trim(),
            p_parent_id: a.parent_id || null,
          };
        }
        if (name === "memoryport_update_memory") {
          rpc = "memoryport_update_memory";
          payload = {
            p_id: a.id,
            p_title: a.title ?? null,
            p_content: a.content ?? null,
            p_scope: a.scope || "chunk",
          };
        }
        if (name === "memoryport_move_memory") {
          rpc = "memoryport_move_memory";
          payload = { p_id: a.id, p_folder_id: a.folder_id || null };
        }
        if (name === "memoryport_delete_memory") {
          rpc = "memoryport_delete_memory";
          payload = { p_id: a.id, p_scope: a.scope || "chunk" };
        }
        if (name === "memoryport_rename_folder") {
          rpc = "memoryport_rename_folder";
          payload = { p_id: a.id, p_name: String(a.name || "").trim() };
        }
        if (rpc) {
          const r = await fetch(SUPABASE + "/rest/v1/rpc/" + rpc, {
              method: "POST",
              headers,
              body: JSON.stringify(payload),
            }),
            d = await r.json().catch(() => null);
          if (!r.ok)
            return j(res, 400, {
              jsonrpc: "2.0",
              id: b.id ?? null,
              error: { code: -32002, message: "Memory action rejected" },
            });
          return j(res, 200, {
            jsonrpc: "2.0",
            id: b.id ?? null,
            result: {
              content: [{ type: "text", text: "MemoryPort action completed." }],
              structuredContent: { result: d },
            },
          });
        }
      }
      return j(res, 200, {
        jsonrpc: "2.0",
        id: b.id ?? null,
        error: { code: -32601, message: "Tool not found" },
      });
    }
    return j(res, 404, { error: "not_found" });
  })
  .listen(PORT, () => console.log("MemoryPort v2 listening", PORT));
// exact locked card asset production render

// exact asset HEAD verification

// exact locked card production release

// mvp consumer connect flow release

// trigger final consumer flow production deploy

// MemoryPort Agent production release

// explicit Agent memory save production release
