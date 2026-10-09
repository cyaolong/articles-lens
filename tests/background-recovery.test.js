import test from 'node:test';
import assert from 'node:assert/strict';
import {makeChrome,responseFor} from './helpers.js';
const text='这是一篇用于长文分组和后台恢复的合成文章。'.repeat(1000);
const wait=async env=>{for(let i=0;i<100;i++){const s=(await env.message({type:'getState'})).state;if(s.status!=='analyzing')return s;await new Promise(r=>setTimeout(r,5));}throw new Error('未结束');};
test('新文章保留配置及缓存，分组失败保存部分结果，重启恢复中断状态',async()=>{
  const env=makeChrome();globalThis.chrome=env.chrome;let calls=0;
  globalThis.fetch=async(_,options)=>{calls++;return calls===2?new Response('',{status:500}):new Response(JSON.stringify(responseFor(JSON.parse(options.body))));};
  await import('../background.js?partial');
  await env.message({type:'saveKey',key:'synthetic-test-key',remember:false,model:'jev-1.13.0'});
  await env.message({type:'paste',title:'长文',text});await env.message({type:'analyze'});
  const partial=await wait(env);assert.equal(partial.status,'error');assert.equal(partial.reports.length,1);assert.ok(partial.reports[0].total>1);
  assert.equal(env.session.lensState.reports.length,1);
  env.session.lensCache=[{key:'cached'}];await env.message({type:'newArticle'});
  assert.equal(env.session.apiKey,'synthetic-test-key');assert.equal(env.local.model,'jev-1.13.0');assert.deepEqual(env.session.lensCache,[{key:'cached'}]);assert.equal((await env.message({type:'getState'})).state.article,null);
  const reboot=makeChrome();reboot.session.lensState={...partial,status:'analyzing'};globalThis.chrome=reboot.chrome;
  await import('../background.js?reboot');const restored=(await reboot.message({type:'getState'})).state;
  assert.equal(restored.status,'error');assert.equal(restored.reports.length,1);assert.match(restored.error,/中断/);
});
