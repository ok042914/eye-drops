// Only a generic, non-personal offline page is cached. Never cache app/API/auth data.
const CACHE='eye-drops-public-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('eye-drops-public-')&&k!==CACHE).map(k=>caches.delete(k)))));});
self.addEventListener('fetch',event=>{
  const request=event.request;const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||request.mode!=='navigate'||request.headers.has('authorization')||url.pathname.startsWith('/api/'))return;
  event.respondWith(fetch(request,{cache:'no-store'}).catch(async()=>await caches.match('/offline.html')||new Response('オフラインです。接続して開き直してください。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
});
