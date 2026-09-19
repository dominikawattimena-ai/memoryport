# MemoryPort — OpenAI Plugin Submission Pack

## Product
Name: MemoryPort
Tagline: One Card. One Memory. Any AI.
Short description: Your personal AI memory wallet. Keep one owner-controlled memory and use it across supported AI connections.
Website: https://memoryport-bridge-v2-production.up.railway.app/
Privacy: https://memoryport-bridge-v2-production.up.railway.app/privacy
Terms: https://memoryport-bridge-v2-production.up.railway.app/terms
MCP server: https://memoryport-bridge-v2-production.up.railway.app/mcp
Authentication: OAuth owner authorization

## Tool review notes
- memoryport_get_context — readOnlyHint=true; destructiveHint=false; openWorldHint=false. Reads only the authenticated owner's AI-visible MemoryPort context and does not mutate data.
- memoryport_remember — readOnlyHint=false; destructiveHint=false; openWorldHint=false. Creates owner-requested memory; it does not delete or overwrite existing memory.
- memoryport_create_folder — readOnlyHint=false; destructiveHint=false; openWorldHint=false. Creates an owner folder only.
- memoryport_update_memory — readOnlyHint=false; destructiveHint=false; openWorldHint=false. Modifies an explicitly identified owner memory/chunk/group.
- memoryport_move_memory — readOnlyHint=false; destructiveHint=false; openWorldHint=false. Changes folder placement for an explicitly identified owner memory.
- memoryport_delete_memory — readOnlyHint=false; destructiveHint=true; openWorldHint=false. Permanently deletes an explicitly identified chunk or group and therefore is destructive.
- memoryport_rename_folder — readOnlyHint=false; destructiveHint=false; openWorldHint=false. Renames an explicitly identified owner folder.

All tools operate only on MemoryPort's authenticated private store; they do not browse or act on the open web.

## Starter prompts
1. Read my MemoryPort and summarize what you remember about me.
2. Save this preference to my MemoryPort: I prefer concise, direct answers.
3. Find the memory about my Founder DNA and show me its title.
4. Update the MemoryPort memory I specify after showing me what will change.

## Positive review tests
1. READ: Authenticated owner asks “What do you remember about me?” Expected: memoryport_get_context reads only AI-visible owner memory; no mutation.
2. CREATE: Owner explicitly asks “Save this in MemoryPort: I prefer concise answers.” Expected: memoryport_remember creates a memory; response confirms completion.
3. LONG CREATE: Owner explicitly saves content longer than 6000 characters. Expected: memoryport_remember creates linked ordered chunks and the context endpoint later returns them as one logical memory.
4. UPDATE: Owner identifies a memory and explicitly asks to rename/edit it. Expected: memoryport_update_memory changes only the requested target/scope.
5. DELETE: Owner identifies a memory and explicitly asks to delete it. Expected: memoryport_delete_memory is treated as destructive and deletes only the approved chunk/group scope.

## Negative review tests
1. Unauthenticated request to read MemoryPort. Expected: 401 / OAuth authorization required; no private memory returned.
2. User supplies only a public Card ID and asks for private memory. Expected: access denied; Card ID is never treated as a credential.
3. User asks the AI to delete unspecified/all memory without a clearly identified target/scope. Expected: do not guess a target; require explicit owner selection/approval before destructive action.

## Submission acceptance
Do not mark ChatGPT integration PASS until production consumer E2E verifies:
OAuth sign-in → READ → SAVE → read-after-write → EDIT → read-after-edit → DELETE → confirm deletion.

## Domain verification
OpenAI submission requires the exact portal-generated challenge token at:
https://memoryport-bridge-v2-production.up.railway.app/.well-known/openai-apps-challenge
The token must be returned alone as plain text. Do not invent a token before the portal issues it.
