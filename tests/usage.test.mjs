import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState, freezeMemory, uid } from '../.test-build/src/orbis/core.js'
import { streamModel } from '../.test-build/src/orbis/network.js'
import { providerUsage } from '../.test-build/src/orbis/usage.js'

test('provider totals distinguish cached input, explicit zero and missing counters', () => {
  assert.deepEqual(providerUsage({input_tokens:12,cache_read_input_tokens:90,cache_creation_input_tokens:8,output_tokens:23}, 'messages'), {input:110,output:23,cached:90})
  assert.deepEqual(providerUsage({prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:0,prompt_tokens_details:{cached_tokens:99}}, 'openai'), {input:100,output:10,cached:0})
  assert.equal(providerUsage({}, 'openai'), undefined)
  assert.equal(providerUsage({prompt_tokens:100,completion_tokens:10}, 'openai').cached, undefined)
  assert.equal(providerUsage({prompt_tokens:100,prompt_cache_hit_tokens:101}, 'openai').cached, undefined)
  assert.equal(providerUsage({prompt_tokens:'100',completion_tokens:-1}, 'openai'), undefined)
})

test('real SSE parser preserves Messages start counters through output-only deltas without accumulating totals', async t => {
  t.mock.method(globalThis,'fetch',async()=>new Response([
    {type:'message_start',message:{usage:{input_tokens:10,cache_read_input_tokens:90,cache_creation_input_tokens:0,output_tokens:0}}},
    {type:'content_block_delta',delta:{text:'回复'}},
    {type:'message_delta',usage:{output_tokens:12}},
    {type:'message_delta',usage:{output_tokens:23}},
    {type:'message_stop'},
  ].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}))
  globalThis.sessionStorage={getItem:()=> 'synthetic-not-a-key'}
  const s=initialState(),w=s.windows[0],turn=freezeMemory(s,w.id,uid(),'你好')
  const result=await streamModel(s,w,turn,[],new AbortController().signal,()=>{})
  assert.deepEqual(result.usage,{input:100,output:23,cached:90})
})

test('OpenAI requests ask for usage and each request starts without previous cache counters', async t => {
  globalThis.sessionStorage={getItem:()=> 'synthetic-not-a-key'}
  let n=0
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    assert.equal(JSON.parse(options.body).stream_options.include_usage,true)
    const usage = n++===0 ? {prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:90}} : {prompt_tokens:120,completion_tokens:20}
    return new Response('data: '+JSON.stringify({choices:[],usage})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
  })
  const s=initialState();s.settings.protocol='openai';const w=s.windows[0],turn=freezeMemory(s,w.id,uid(),'你好')
  const a=await streamModel(s,w,turn,[],new AbortController().signal,()=>{})
  const b=await streamModel(s,w,turn,[],new AbortController().signal,()=>{})
  assert.equal(a.usage.cached,90);assert.equal(b.usage.cached,undefined);assert.equal(b.usage.input,120)
})
