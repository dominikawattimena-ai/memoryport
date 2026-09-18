# MemoryPort — Verified Facts Log

## Evidence labels
- [DOC-VERIFIED] current official documentation supports the fact.
- [LIVE-TESTED] exercised in the named real runtime.
- [UNVERIFIED] not yet proven.

## 2026-09-18 — Claude Phase 1
- [DOC-VERIFIED] Anthropic's current Help Center says remote MCP custom connectors are available on Claude, Cowork and Claude Desktop; Free users are limited to one custom connector.
- [DOC-VERIFIED] Individual Pro/Max setup is Customize > Connectors > + > Add custom connector > remote MCP URL. OAuth Client ID and Client Secret are optional advanced settings.
- [DOC-VERIFIED] Claude connects to remote MCP from Anthropic cloud, so the server must be publicly reachable.
- [LIVE-TESTED] Railway deployment memoryport-bridge-v2 is publicly reachable.
- [LIVE-TESTED] Public OAuth protected-resource and authorization-server discovery endpoints return MemoryPort metadata.
- [UNVERIFIED] Claude.ai consumer OAuth handshake has not yet passed live E2E.
- [UNVERIFIED] Canonical candidate-memory approval endpoint is not deployed yet; production write remains fail-closed at the Railway bridge.
- [UNVERIFIED] Interactive Memory Card UI in Claude has not passed live E2E.

## Architecture
- [LIVE-TESTED] Existing AppDeploy backend remains the canonical MemoryPort vault.
- [LIVE-TESTED] Railway is a transport/auth bridge only; it is not a second memory vault.
- [LIVE-TESTED] Existing AppDeploy source still exposes legacy direct-write endpoints. Those are historical interoperability paths and MUST NOT be used by the Claude production write flow.

## Founder Blocker Template
MEMORYPORT — FOUNDER BLOCKER

BLOCKER:
[masalah spesifik]

STATUS:
[DOC-VERIFIED / LIVE-TESTED / UNVERIFIED]

KENAPA INI MEMBLOKIR:
[dampak langsung terhadap langkah build]

EVIDENCE:
[sumber resmi / hasil live test / apa yang belum diketahui]

OPSI A:
[opsi]
Trade-off:
[konsekuensi]

OPSI B:
[opsi]
Trade-off:
[konsekuensi]

REKOMENDASI:
[hanya jika evidence cukup; kalau tidak: "Evidence insufficient"]

KEPUTUSAN DIPERLUKAN SEBELUM:
[langkah build yang tidak boleh dilewati]


## Deployment sync marker — 2026-09-18
- [DOC-VERIFIED] Railway redeploy reuses the commit associated with the current deployment; it does not fetch the latest GitHub HEAD.
- [LIVE-TESTED] OAuth discovery wiring source is present on GitHub main in server.js, but production must not be marked updated until Railway reports a deployment containing this marker commit or later and live discovery is re-tested.
