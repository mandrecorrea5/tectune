// Service worker do Tectune (PWA): o app abre sem internet e os shows já abertos continuam legíveis.
// - Páginas, JS e CSS: rede primeiro (cada deploy chega na hora), cópia guardada se estiver sem conexão.
// - Fontes, bibliotecas e ícones: cache primeiro (quase nunca mudam).
// - API: só leituras do repertório, rede primeiro; sem conexão, a última resposta guardada.
//   Separado por banda (x-band) e apagado ao sair da conta.
const VERSION = 'v1';
const SHELL = `tectune-shell-${VERSION}`, STATIC = `tectune-static-${VERSION}`, API = 'tectune-api';
const SHELL_FILES = [
  '/', '/css/app.css', '/js/app.js', '/js/cifra.js', '/js/player.js', '/js/live.js',
  '/core/index.js', '/core/staff.js', '/core/edit.js', '/manifest.webmanifest', '/favicon.png',
];
const STATIC_FILES = ['/vendor/jspdf.umd.min.js', '/vendor/qrcode.js', '/vendor/fonts/fonts.css', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];
// leituras que valem a pena ter sem internet
const API_READ = /^\/api\/(me|setlists(\/[0-9a-f-]{36})?|songs\/[0-9a-f-]{36}|bands\/[0-9a-f-]{36}|public\/shows\/[A-Za-z0-9_-]{20,64})$/i;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL); await shell.addAll(SHELL_FILES);
    const st = await caches.open(STATIC); await st.addAll(STATIC_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, STATIC, API]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// o app avisa quando a pessoa sai da conta: os dados guardados da API vão embora
self.addEventListener('message', e => {
  if (e.data?.t === 'logout') e.waitUntil(caches.delete(API));
});

const offlineJson = () => new Response(JSON.stringify({ error: 'Sem conexão com a internet' }), { status: 503, headers: { 'content-type': 'application/json' } });

async function networkFirst(req, cacheName, key = req) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;

  // páginas (inclusive o link do show /s/…): sempre a mesma index.html
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL, '/').catch(async () => (await caches.match('/')) || Response.error()));
    return;
  }
  if (p.startsWith('/api/')) {
    if (!API_READ.test(p) || url.search) return; // o resto da API não passa pelo cache
    // a mesma URL devolve coisas diferentes por banda: a banda entra na chave do cache
    const key = new Request(`${url.origin}${p}?__banda=${encodeURIComponent(req.headers.get('x-band') || '')}`);
    e.respondWith(networkFirst(req, API, key).catch(offlineJson));
    return;
  }
  if (p.startsWith('/vendor/') || p.startsWith('/icons/')) { e.respondWith(cacheFirst(req)); return; }
  if (p.startsWith('/js/') || p.startsWith('/css/') || p.startsWith('/core/') || p === '/manifest.webmanifest' || p === '/favicon.png') {
    e.respondWith(networkFirst(req, SHELL));
  }
});
