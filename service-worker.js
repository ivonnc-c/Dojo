// v3.24 Service Worker
// 這個檔案負責快取 App 核心資源, 讓我們可以離線使用

const CACHE_NAME = 'dojo-system-cache-v1';
// v3.24: 我們只需要快取 Vue, Tailwind 和 HTML 檔案本身
// v3.25: 將 ./dojo_system_v3_5.html 改為 index.html (假設主檔案會是 index.html)
const URLS_TO_CACHE = [
  './index.html', // 假設主檔案會是 index.html
  './', // 快取根目錄 (為了 start_url)
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/vue@3/dist/vue.global.js'
];

// 1. 安裝 Service Worker
self.addEventListener('install', event => {
  console.log('[ServiceWorker] Install');
  // 立即啟動
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Pre-caching offline page');
        // v3.25: 改用 addAll(URLS_TO_CACHE.map(url => new Request(url, {cache: 'reload'})))
        // 確保我們抓到的是最新的 CDN 檔案, 而不是瀏覽器舊的快取
        const cacheRequests = URLS_TO_CACHE.map(url => new Request(url, {
          cache: 'reload' // 強制重新抓取
        }));
        return cache.addAll(cacheRequests);
      })
      .catch(err => {
        console.error('[ServiceWorker] Cache addAll failed:', err);
      })
  );
});

// 2. 啟用 Service Worker (清除舊快取)
self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // 立即控制頁面
  return self.clients.claim();
});

// 3. 攔截網路請求 (核心)
self.addEventListener('fetch', event => {
  // 我們只處理 GET 請求 (Firebase 的 POST 請求讓它自己走網路)
  if (event.request.method !== 'GET' || 
      !event.request.url.startsWith('http')) { // v3.25: 忽略非 http 請求 (例如 chrome-extension://)
    return;
  }
  
  // v3.24: 策略 - 網路優先 (Network First) for Firebase scripts
  // Firebase SDK 最好總是保持最新
  if (event.request.url.includes('firebase')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // 如果網路失敗, 嘗試從快取拿 (如果之前有成功載入過)
        return caches.match(event.request);
      })
    );
    return;
  }

  // v3.24: 策略 - 快取優先 (Cache First) for App Shell (Vue, Tailwind, HTML)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          // 1. 在快取中找到: 直接回傳
          // console.log('[ServiceWorker] Fetch (Cache):', event.request.url);
          return response;
        }

        // 2. 在快取中找不到: 嘗試從網路抓取
        // console.log('[ServiceWorker] Fetch (Network):', event.request.url);
        return fetch(event.request).then(
          networkResponse => {
            // 2a. 成功抓到: 存入快取並回傳
            // 複製一份 response, 因為 response 只能被讀取一次
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME)
              .then(cache => {
                // v3.25: 檢查 URL 是否在我們要快取的清單中
                // 我們只想快取核心 App Shell, 不快取例如 placeholder 圖片
                const isCoreAsset = URLS_TO_CACHE.some(url => event.request.url.startsWith(url));
                if(isCoreAsset || event.request.url === self.location.origin + '/') {
                   cache.put(event.request, responseToCache);
                }
              });

            return networkResponse;
          }
        ).catch(() => {
          // 3. 網路也失敗: (例如真的離線)
          // v3.25: 嘗試回傳 index.html
          console.log('[ServiceWorker] Fetch failed, returning cache fallback for:', event.request.url);
          if (event.request.mode === 'navigate') {
             return caches.match('./index.html');
          }
        });
      })
  );
});

