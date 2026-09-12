import assert from 'node:assert/strict';
import {createPromptJobs} from '../paseo-plugin/server/prompt-jobs.mjs';
import {createPromptController} from '../paseo-plugin/client/prompt-controller.mjs';
const tick = () => new Promise(resolve=>setImmediate(resolve));
const deferred = () => {let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};

let calls=0,clock=0;
const pending=deferred();
const jobs=createPromptJobs(()=>{calls++;return pending.promise;},{now:()=>clock,ttl:10});
const input={requestId:'request-a',agentId:'agent-a',text:'检查说明'};
assert.equal(jobs.start(input).phase,'running');
assert.equal(jobs.start(input).phase,'running');
assert.throws(()=>jobs.start({...input,text:'different'}),/标识/);
assert.equal(jobs.start({...input,requestId:'request-b'}).phase,'rejected');
assert.equal(jobs.status({...input,agentId:'agent-b'}).phase,'missing');
await tick();assert.equal(calls,1);
pending.resolve('优化结果');await tick();
assert.equal(jobs.status(input).optimized,'优化结果');
let sendCount=0;const ack=deferred();
const confirm={...input,text:'edited result'};
assert.equal(jobs.confirm(confirm,async()=>{sendCount++;await ack.promise;}).phase,'sending');
assert.equal(jobs.confirm(confirm,()=>{throw new Error('duplicate');}).phase,'sending');
await tick();assert.equal(sendCount,1);ack.resolve();await tick();
assert.equal(jobs.latest(input).phase,'sent');assert.equal(jobs.confirm(confirm,()=>{}).phase,'sent');
clock=11;assert.equal(jobs.status(input).phase,'missing');jobs.dispose();

const task=deferred(), sent=deferred();let submits=0,sends=0;
const controller=createPromptController({start:async data=>{submits++;return {requestId:data.requestId,phase:'running'};},
  status:()=>task.promise,send:async({agentId,text})=>{sends++;assert.equal(agentId,'a');assert.equal(text,'优化 A');await sent.promise;},newId:()=>`request-${submits+sends+1}`});
controller.setInput('a','原文 A');const first=controller.optimize('a');await tick();
await controller.optimize('a');assert.equal(submits,1);
controller.setInput('b','原文 B');task.resolve({requestId:'request-1',phase:'ready',optimized:'优化 A'});await first;
assert.equal(controller.get('a').output,'优化 A');assert.equal(controller.get('b').output,'');
const send=controller.send('a');await tick();assert.equal(await controller.send('a'),false);assert.equal(sends,1);
sent.reject(new Error('lost ack'));assert.equal(await send,false);assert.equal(controller.get('a').phase,'send-unknown');
assert.equal(await controller.send('a'),false);controller.dispose();

const late=deferred();
const changing=createPromptController({start:async data=>{const result=await late.promise;return {...result,requestId:data.requestId};},status:()=>{},send:()=>{}});
changing.setInput('a','old');const work=changing.optimize('a');changing.setInput('a','new');
late.resolve({phase:'ready',optimized:'old optimized'});await work;
assert.equal(changing.get('a').input,'new');assert.equal(changing.get('a').output,'');changing.dispose();

let retries=0;
const recovery=createPromptController({start:async()=>{retries++;throw new Error('disconnect');},status:async data=>({...data,phase:'ready',optimized:'恢复结果'}),send:()=>{}});
recovery.setInput('a','text');await recovery.optimize('a');assert.equal(recovery.get('a').phase,'waiting');
await recovery.optimize('a');await recovery.refresh('a');assert.equal(retries,1);assert.equal(recovery.get('a').output,'恢复结果');recovery.dispose();
const restored=createPromptController({latest:async()=>({requestId:'saved-job',phase:'sent',original:'原文',optimized:'已发送文本'}),send:()=>{throw new Error('should not resend');}});
await restored.restore('a');assert.equal(restored.get('a').phase,'sent');assert.equal(restored.get('a').output,'已发送文本');
assert.equal(await restored.send('a'),false);restored.dispose();
console.log('Prompt optimization identity, retry and explicit-send checks passed');
