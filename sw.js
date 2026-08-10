/* 奇门遁甲 PWA Service Worker
 * 策略：same-origin GET 用 stale-while-revalidate —— 先回缓存(离线可用/秒开)，
 * 后台再取新版本更新缓存，下次打开即最新；跨域(AI provider)与非 GET 一律不拦截。
 * CACHE 版本号由 build.js 在产出 dist/ 时以内容哈希盖章（源文件保持 dev 占位）。
 */
const CACHE = 'qimen-pwa-856f16556b';
const ASSETS = [
  './', './index.html', './style.css', './engine.bundle.js', './core/shanxiang.js', './core/wangshuai.js', './core/yingqi.js', './core/yongshen.js', './core/xiangyi.js', './core/evidence.js', './knowledge/domains.json', './knowledge/symbols.json', './knowledge/domain-rules.json', './llm.js', './app.js',
  './manifest.json', './assets/feipan-method.md', './assets/zhuanpan-method.md', './assets/shanxiang-method.md', './assets/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      // 通知已打开的页面：新版本已激活。页面据此自动刷新一次，
      // 消除 stale-while-revalidate 的"首开跑旧代码"窗口
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((cs) => cs.forEach((c) => c.postMessage({ type: 'sw-updated', cache: CACHE })))
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;                    // 非 GET 不拦截
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;                // AI(Gemini/Ollama/自定义)跨域直连
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const refresh = fetch(e.request)
        .then((resp) => { if (resp && resp.ok) cache.put(e.request, resp.clone()); return resp; })
        .catch(() => null);
      return cached || refresh.then((r) => r || new Response('offline', { status: 503 }));
    })
  );
});
