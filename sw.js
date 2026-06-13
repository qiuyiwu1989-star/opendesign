/* OpenDesign Service Worker —— 让站点成为可安装、可离线、二次秒开的 PWA。
 * 策略：
 *   - 应用壳(html/css/js/icon)：install 预缓存 + stale-while-revalidate（秒开且自动更新）
 *   - 数据(sites.js / *.json)：network-first（要新），离线回退缓存
 *   - 导航：network-first，离线回退缓存的首页
 *   - 跨域(图片代理 wsrv / thum.io / 字体 / Supabase)：不拦，直接走网络
 *   - 非 GET（Supabase RPC POST）：不碰
 * 改了壳文件就把 VER 加一，旧缓存自动清。 */
const VER = "od-v4"; // 2026-06-09 强制刷新：sites-specs.json 懒加载
const SHELL = [
  "/", "/index.html", "/styles.css", "/app.js", "/i18n.js",
  "/favicon.svg", "/manifest.json",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VER)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))  // 单个失败不拖垮整体
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                      // Supabase POST 等不碰
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // 跨域(代理/统计/字体)走网络

  if (req.mode === "navigate") {                         // 导航：网络优先，离线回退首页
    e.respondWith(fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))));
    return;
  }

  const isData = url.pathname.endsWith(".json") || url.pathname.endsWith("sites.js");
  if (isData) {                                          // 数据：网络优先，离线回退缓存
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const c = res.clone(); caches.open(VER).then((ca) => ca.put(req, c)); }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 应用壳静态资源：stale-while-revalidate
  e.respondWith(
    caches.open(VER).then(async (cache) => {
      const cached = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
