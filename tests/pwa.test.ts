import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('service worker stores only generic offline document; personalized navigations are not cached',async()=>{
  const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
  const handlers:Record<string,(event:any)=>void>={};const stored:string[]=[];
  let offline=false;
  const caches={open:async()=>({add:async(url:string)=>{stored.push(url);}}),keys:async()=>[],delete:async()=>true,match:async()=>new Response('generic offline')};
  const self={location:{origin:'https://eye.example'},addEventListener:(event:string,handler:(event:any)=>void)=>{handlers[event]=handler;}};
  runInNewContext(source,{self,caches,URL,Response,fetch:async()=>{if(offline)throw new Error('network');return new Response('private inventory');}});
  let pending:Promise<unknown>=Promise.resolve();handlers.install({waitUntil:(p:Promise<unknown>)=>{pending=p;}});await pending;
  assert.deepEqual(stored,['/offline.html']);
  const navigate={method:'GET',url:'https://eye.example/',mode:'navigate',headers:new Headers()};
  let response:Promise<Response>|undefined;
  handlers.fetch({request:navigate,respondWith:(p:Promise<Response>)=>{response=p;}});
  assert.equal(await (await response!).text(),'private inventory');assert.deepEqual(stored,['/offline.html']);
  offline=true;handlers.fetch({request:navigate,respondWith:(p:Promise<Response>)=>{response=p;}});assert.equal(await (await response!).text(),'generic offline');
  response=undefined;handlers.fetch({request:{...navigate,url:'https://eye.example/api/history'},respondWith:(p:Promise<Response>)=>{response=p;}});assert.equal(response,undefined);
  handlers.fetch({request:{...navigate,headers:new Headers({authorization:'Bearer test'})},respondWith:(p:Promise<Response>)=>{response=p;}});assert.equal(response,undefined);
  handlers.fetch({request:{...navigate,url:'https://supabase.example/auth/v1'},respondWith:(p:Promise<Response>)=>{response=p;}});assert.equal(response,undefined);
});
