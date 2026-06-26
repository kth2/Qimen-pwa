/* 奇门遁甲 PWA Service Worker —— 离线缓存排盘核心，AI 跨域请求不缓存 */
const CACHE = 'qimen-pwa-v1';
const ASSETS = [
  './', './index.html', './style.css', './engine.bundle.js', './llm.js', './app.js',
  './manifest.json', './assets/feipan-method.md', './assets/zhuanpan-method.md', './assets/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // AI(Gemini/Ollama/自定义)跨域：直连不拦截
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
