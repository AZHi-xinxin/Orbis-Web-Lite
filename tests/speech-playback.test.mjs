import test from 'node:test'
import assert from 'node:assert/strict'
import { preparePlayback, playSpeechBlob, releasePlayback } from '../.test-build/src/orbis/speechPlayback.js'
let made=[],gesture=false,deny=true
class AudioFixture extends EventTarget {
  src=''; calls=[]; paused=true
  constructor(){super();made.push(this)}
  setAttribute(){} removeAttribute(){this.src=''} load(){} pause(){this.paused=true}
  play(){this.calls.push(this.src);if(this.src.startsWith('blob:')&&deny&&!gesture)return Promise.reject(new DOMException('blocked','NotAllowedError'));this.paused=false;return Promise.resolve()}
}
globalThis.Audio=AudioFixture
const tick=()=>new Promise(r=>setTimeout(r,0))
test('tap-unlocked element is reused; denied playback retries the same fetched blob and only then reports playing',async()=>{
  gesture=true;preparePlayback();gesture=false
  const a=made.at(-1);let retry,playing=0
  const run=playSpeechBlob(new Blob(['wav']),new AbortController().signal,()=>playing++,fn=>retry=fn)
  await tick();assert.equal(playing,0);assert.equal(typeof retry,'function');const source=a.src
  gesture=true;retry();gesture=false;await tick()
  assert.equal(playing,1);assert.equal(retry,undefined);assert.equal(a.src,source);assert.equal(made.length,1)
  a.dispatchEvent(new Event('ended'));await run;assert.equal(a.paused,true);assert.equal(a.src,'')
  releasePlayback()
})
test('hangup while playback is blocked cancels pending recovery and frees the blob',async()=>{
  let retry;const ctl=new AbortController()
  const run=playSpeechBlob(new Blob(['wav']),ctl.signal,undefined,fn=>retry=fn)
  await tick();const stale=retry,a=made.at(-1);ctl.abort()
  await assert.rejects(run,{name:'AbortError'});assert.equal(retry,undefined);assert.equal(a.src,'')
  const count=a.calls.length;gesture=true;stale();gesture=false;assert.equal(a.calls.length,count)
  releasePlayback()
})
test('decode failure is reported; aborted playback never starts; sequential chunks reuse one element',async()=>{
  deny=false;const ctl=new AbortController();ctl.abort()
  const before=made.length;await assert.rejects(playSpeechBlob(new Blob(['x']),ctl.signal),{name:'AbortError'});assert.equal(made.length,before)
  const run=playSpeechBlob(new Blob(['broken']),new AbortController().signal)
  made.at(-1).dispatchEvent(new Event('error'));await assert.rejects(run,/无法播放/)
  const a=made.at(-1), next=playSpeechBlob(new Blob(['wav']),new AbortController().signal)
  await tick();assert.equal(made.at(-1),a);a.dispatchEvent(new Event('ended'));await next;releasePlayback()
})
