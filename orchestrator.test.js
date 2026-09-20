import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize,selectRelevantMemories,buildContextBlock,providerFromEnv,validateCandidateMemory} from './orchestrator.js';

test('tokenize normalizes and deduplicates',()=>assert.deepEqual(tokenize('Sales SALES Q3'),['sales','q3']));
test('retrieval returns only matching memories and weights title',()=>{
 const drive={memories:[
  {id:'a',title:'Sales report',content:'Jayapura daily total'},
  {id:'b',title:'Travel',content:'sales note'},
  {id:'c',title:'Recipe',content:'rice'}
 ]};
 assert.deepEqual(selectRelevantMemories('sales report',drive).map(x=>x.id),['a','b']);
});
test('retrieval does not leak unrelated memory',()=>assert.deepEqual(selectRelevantMemories('payroll',{memories:[{title:'Private trip',content:'Bali'}]}),[]));
test('retrieval obeys char budget',()=>assert.equal(selectRelevantMemories('alpha',{memories:[{title:'alpha',content:'alpha '+ 'x'.repeat(50)}]},{maxChars:10})[0].content.length,10));
test('context block contains selected memory only',()=>assert.match(buildContextBlock([{title:'A',content:'B'}]),/Title: A\nContent: B/));
test('provider fails closed without config',()=>assert.deepEqual(providerFromEnv({}),{ok:false,error:'provider_not_configured'}));
test('gemini requires key',()=>assert.equal(providerFromEnv({MEMORYPORT_AI_PROVIDER:'gemini'}).ok,false));
test('groq requires key',()=>assert.equal(providerFromEnv({MEMORYPORT_AI_PROVIDER:'groq'}).ok,false));
test('candidate save requires explicit true',()=>assert.deepEqual(validateCandidateMemory({save:false,title:'x',content:'y'}),{save:false}));
test('candidate validates bounded content',()=>assert.equal(validateCandidateMemory({save:true,title:'Preference',content:'Concise answers'}).save,true));
test('candidate rejects oversized content',()=>assert.equal(validateCandidateMemory({save:true,title:'x',content:'a'.repeat(6001)}).save,false));
