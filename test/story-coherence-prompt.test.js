import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARN_SEMANTIC_INSTRUCTIONS, interpretPatterns } from '../src/learn/semantic.js';

test('Learn prompt distinguishes shared actors from story continuity',()=>{
  assert.match(LEARN_SEMANTIC_INSTRUCTIONS,/shared actor.*does NOT by itself establish/i);
  assert.match(LEARN_SEMANTIC_INSTRUCTIONS,/unrelated activities recorded for the same individual/);
  assert.match(LEARN_SEMANTIC_INSTRUCTIONS,/link the existing micro-stories/);
  assert.match(LEARN_SEMANTIC_INSTRUCTIONS,/Never create a catch-all micro_story/);
});

test('DeepSeek-compatible interpreter receives the story coherence rules',async()=>{
  let captured;
  const client={chat:{completions:{create:async options=>{
    captured=options;
    return {choices:[{message:{content:JSON.stringify({annotations:[]})}}]};
  }}}};
  const output=await interpretPatterns({sources:[],columns:[],findings:[],known:[]},{client,model:'deepseek-chat'});
  assert.deepEqual(output.annotations,[]);
  assert.equal(captured.model,'deepseek-chat');
  assert.match(captured.messages[0].content,/keep different activities involving the same actor as distinct micro-stories/i);
});
