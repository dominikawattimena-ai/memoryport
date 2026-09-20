import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  selectRelevantMemories,
  buildContextBlock,
  providerFromEnv,
  validateCandidateMemory,
  candidateIsGrounded,
  candidateContainsSensitiveData,
  extractExplicitMemory,
  memoryAlreadyExists,
  findMemoryConflict,
  sanitizeHistory,
  callProvider,
} from "./orchestrator.js";

test("tokenize normalizes and deduplicates", () =>
  assert.deepEqual(tokenize("Sales SALES Q3"), ["sales", "q3"]));
test("retrieval returns only matching memories and weights title", () => {
  const drive = {
    memories: [
      { id: "a", title: "Sales report", content: "Jayapura daily total" },
      { id: "b", title: "Travel", content: "sales note" },
      { id: "c", title: "Recipe", content: "rice" },
    ],
  };
  assert.deepEqual(
    selectRelevantMemories("sales report", drive).map((x) => x.id),
    ["a", "b"],
  );
});
test("retrieval does not leak unrelated memory", () =>
  assert.deepEqual(
    selectRelevantMemories("payroll", {
      memories: [{ title: "Private trip", content: "Bali" }],
    }),
    [],
  ));
test("retrieval obeys char budget", () =>
  assert.equal(
    selectRelevantMemories(
      "alpha",
      { memories: [{ title: "alpha", content: "alpha " + "x".repeat(50) }] },
      { maxChars: 10 },
    )[0].content.length,
    10,
  ));
test("context block contains selected memory only", () =>
  assert.match(
    buildContextBlock([{ title: "A", content: "B" }]),
    /Title: A\nContent: B/,
  ));
test("provider fails closed without config", () =>
  assert.deepEqual(providerFromEnv({}), {
    ok: false,
    error: "provider_not_configured",
  }));
test("gemini requires key", () =>
  assert.equal(
    providerFromEnv({ MEMORYPORT_AI_PROVIDER: "gemini" }).ok,
    false,
  ));
test("groq requires key", () =>
  assert.equal(providerFromEnv({ MEMORYPORT_AI_PROVIDER: "groq" }).ok, false));
test("openai requires key and keeps provider internal", () => {
  assert.equal(providerFromEnv({ MEMORYPORT_AI_PROVIDER: "openai" }).ok, false);
  assert.deepEqual(
    providerFromEnv({
      MEMORYPORT_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "secret",
    }),
    { ok: true, name: "openai", model: "gpt-5.6-luna" },
  );
});
test("candidate save requires explicit true", () =>
  assert.deepEqual(
    validateCandidateMemory({ save: false, title: "x", content: "y" }),
    { save: false },
  ));
test("candidate validates only explicit confirmed memory", () =>
  assert.equal(
    validateCandidateMemory({
      save: true,
      memory_class: "USER_CONFIRMED",
      title: "Preference",
      content: "Concise answers",
      evidence: "I prefer concise answers",
    }).save,
    true,
  ));
test("candidate rejects inferred and oversized content", () => {
  assert.equal(
    validateCandidateMemory({
      save: true,
      memory_class: "INFERRED",
      title: "Home",
      content: "Bali",
      evidence: "might move",
    }).save,
    false,
  );
  assert.equal(
    validateCandidateMemory({
      save: true,
      memory_class: "USER_CONFIRMED",
      title: "x",
      content: "a".repeat(6001),
      evidence: "x",
    }).save,
    false,
  );
});
test("grounding requires exact current-user evidence", () => {
  const c = { save: true, evidence: "My company is Atlas" };
  assert.equal(
    candidateIsGrounded(c, "My company is Atlas and serves UMKM"),
    true,
  );
  assert.equal(candidateIsGrounded(c, "Tell me about Atlas"), false);
});
test("sensitive credentials are never persisted", () =>
  assert.equal(
    candidateContainsSensitiveData({
      save: true,
      title: "API key",
      content: "secret",
      evidence: "my API key",
    }),
    true,
  ));
test("explicit project declaration has a deterministic grounded fallback", () => {
  const message =
    "My project is called Atlas and it helps Indonesian UMKM.";
  assert.deepEqual(extractExplicitMemory(message), {
    save: true,
    memory_class: "USER_CONFIRMED",
    title: "Project: Atlas",
    content: message,
    evidence: message,
  });
});
test("fallback rejects uncertain declarations and credentials", () => {
  assert.deepEqual(
    extractExplicitMemory("My project might be called Atlas."),
    { save: false },
  );
  assert.deepEqual(
    extractExplicitMemory("My project is called API key and it is secret."),
    { save: false },
  );
});
test("exact memories are not duplicated", () =>
  assert.equal(
    memoryAlreadyExists(
      { save: true, title: "Atlas market", content: "Indonesian UMKM" },
      [{ title: "Atlas market", content: "Indonesian UMKM" }],
    ),
    true,
  ));
test("conflict is detected without overwriting canonical memory", () => {
  const old = { title: "Atlas market", content: "Indonesian UMKM" };
  assert.equal(
    findMemoryConflict(
      { save: true, title: "Atlas market", content: "Global enterprise" },
      [old],
    ),
    old,
  );
  assert.equal(
    findMemoryConflict(
      { save: true, title: "Atlas market", content: "Indonesian UMKM" },
      [old],
    ),
    old,
  );
});
test("history is bounded and normalized", () =>
  assert.deepEqual(
    sanitizeHistory([
      { role: "system", content: "x" },
      { role: "assistant", content: "y" },
    ]),
    [
      { role: "user", content: "x" },
      { role: "assistant", content: "y" },
    ],
  ));
test("provider adapter parses a structured response", async () => {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";
  const fetchImpl = async (_url, request) => {
    const sent = JSON.parse(request.body);
    assert.equal(sent.model, "gpt-test");
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          answer: "Hello",
          memory_candidate: {
            save: false,
            memory_class: "TEMPORARY",
            title: "",
            content: "",
            evidence: "",
          },
        }),
      }),
    };
  };
  const out = await callProvider(
    { ok: true, name: "openai", model: "gpt-test" },
    { message: "Hi", fetchImpl },
  );
  assert.equal(out.answer, "Hello");
  if (old === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = old;
});
