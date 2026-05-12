// ========== 有上限的音频缓存 ==========

const CACHE_PREFIX = 'vcbly-audio-v1-';
const META_KEY = 'vcbly_audio_cache_meta_v1';
const MEMORY_MAX_ITEMS = 50;
const MEMORY_MAX_BYTES = 10 * 1024 * 1024;
const DESKTOP_CACHE_MAX_BYTES = 60 * 1024 * 1024;
const MOBILE_CACHE_MAX_BYTES = 30 * 1024 * 1024;
const SAVE_DATA_CACHE_MAX_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENT_PRELOADS = 2;
const FAILED_RETRY_MS = 5 * 60 * 1000;

const memoryCache = new Map();
const failedCache = new Map();
const inflight = new Map();
const preloadQueue = [];
let activePreloads = 0;
let cacheEpoch = 0;

function getManifestVersion() {
  const meta = window.AUDIO_MANIFEST_META || {};
  return [
    meta.version || meta.source || 'audio',
    meta.count || 0,
    meta.indexCount || 0,
    meta.wordCount || 0,
    meta.missing || 0,
  ].join('-');
}

function getCacheName() {
  return `${CACHE_PREFIX}${getManifestVersion()}`;
}

function canUsePersistentCache() {
  return typeof window !== 'undefined' && 'caches' in window;
}

function getPersistentLimit() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData) return SAVE_DATA_CACHE_MAX_BYTES;
  if (window.matchMedia?.('(max-width: 600px)').matches) return MOBILE_CACHE_MAX_BYTES;
  return DESKTOP_CACHE_MAX_BYTES;
}

function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { version: getManifestVersion(), entries: {} };
    const parsed = JSON.parse(raw);
    if (parsed.version !== getManifestVersion()) {
      return { version: getManifestVersion(), entries: {} };
    }
    return {
      version: parsed.version,
      entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
    };
  } catch {
    return { version: getManifestVersion(), entries: {} };
  }
}

function saveMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // 元数据写入失败时不影响播放，只退化为浏览器默认缓存。
  }
}

// META 读-改-写串行化：trim 与 touchMeta 都通过 metaChain 排队执行，
// 避免并发时 touchMeta 用旧 entries 覆盖 trim 已删除的条目（META 与持久 cache 漂移）。
let metaChain = Promise.resolve();
function runMeta(fn) {
  const next = metaChain.catch(() => {}).then(fn);
  // 不让外部错误打断链，但保留返回 Promise 供调用方等待
  metaChain = next.catch(() => {});
  return next;
}

function touchMeta(path, patch = {}) {
  // 记录入队时的 epoch；clear 之后排队但还没执行的写入应被丢弃，
  // 避免 META 被复活回与持久 cache 不一致的状态。
  const submittedEpoch = cacheEpoch;
  return runMeta(() => {
    if (submittedEpoch !== cacheEpoch) return;
    const now = Date.now();
    const meta = loadMeta();
    const old = meta.entries[path] || {};
    let prefetchedOnly = old.prefetchedOnly ?? true;
    if (patch.prefetchedOnly === false) {
      prefetchedOnly = false;
    } else if (old.prefetchedOnly === undefined && patch.prefetchedOnly !== undefined) {
      prefetchedOnly = patch.prefetchedOnly;
    }
    meta.entries[path] = {
      size: patch.size || old.size || 0,
      lastAccess: now,
      hitCount: (old.hitCount || 0) + (patch.hit ? 1 : 0),
      prefetchedOnly,
    };
    saveMeta(meta);
  });
}

function estimateResponseSize(response, fallback = 0) {
  const raw = response.headers.get('content-length');
  const size = raw ? Number(raw) : 0;
  return Number.isFinite(size) && size > 0 ? size : fallback;
}

function getMemorySize() {
  let total = 0;
  memoryCache.forEach(entry => { total += entry.size || 0; });
  return total;
}

function removeMemory(path) {
  const entry = memoryCache.get(path);
  if (!entry) return;
  URL.revokeObjectURL(entry.url);
  memoryCache.delete(path);
}

function trimMemoryCache() {
  let total = getMemorySize();
  const entries = [...memoryCache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  for (const [path, entry] of entries) {
    if (memoryCache.size <= MEMORY_MAX_ITEMS && total <= MEMORY_MAX_BYTES) break;
    URL.revokeObjectURL(entry.url);
    memoryCache.delete(path);
    total -= entry.size || 0;
  }
}

function putMemory(path, blob) {
  if (!blob || blob.size <= 0) return '';
  removeMemory(path);
  const url = URL.createObjectURL(blob);
  memoryCache.set(path, {
    url,
    size: blob.size,
    lastAccess: Date.now(),
  });
  trimMemoryCache();
  return url;
}

export function getCachedAudioUrl(path) {
  const entry = memoryCache.get(path);
  if (!entry) return path;
  entry.lastAccess = Date.now();
  touchMeta(path, { size: entry.size, hit: true, prefetchedOnly: false });
  return entry.url;
}

async function cleanupObsoleteCaches() {
  if (!canUsePersistentCache()) return;
  try {
    const current = getCacheName();
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== current)
        .map(key => caches.delete(key))
    );
  } catch {
    // 清理失败不影响后续播放。
  }
}

const cleanupPromise = cleanupObsoleteCaches();

async function openAudioCache() {
  if (!canUsePersistentCache()) return null;
  await cleanupPromise;
  return caches.open(getCacheName());
}

async function _trimPersistentCacheImpl() {
  const cache = await openAudioCache();
  if (!cache) return;

  const limit = getPersistentLimit();
  const meta = loadMeta();
  let entries = Object.entries(meta.entries).map(([path, value]) => ({ path, ...value }));
  let total = entries.reduce((sum, item) => sum + (item.size || 0), 0);
  if (total <= limit) return;

  entries = entries.sort((a, b) => {
    if (!!a.prefetchedOnly !== !!b.prefetchedOnly) return a.prefetchedOnly ? -1 : 1;
    return (a.lastAccess || 0) - (b.lastAccess || 0);
  });

  for (const entry of entries) {
    if (total <= limit) break;
    await cache.delete(entry.path);
    removeMemory(entry.path);
    delete meta.entries[entry.path];
    total -= entry.size || 0;
  }
  saveMeta(meta);
}

// trim 也走 metaChain，与 touchMeta 共享同一条串行链。
function trimPersistentCache() {
  return runMeta(_trimPersistentCacheImpl);
}

function recentlyFailed(path) {
  const failedAt = failedCache.get(path);
  return failedAt && Date.now() - failedAt < FAILED_RETRY_MS;
}

async function cacheAudioNow(path, options = {}) {
  if (!path) return false;
  if (options.epoch !== cacheEpoch) return false;
  if (recentlyFailed(path) && !options.force) return false;

  const cache = await openAudioCache();
  let response = cache ? await cache.match(path) : null;
  const fromPersistentCache = !!response;

  if (!response) {
    response = await fetch(path, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`音频请求失败：${response.status}`);
  }
  if (options.epoch !== cacheEpoch) return false;

  let size = estimateResponseSize(response);
  if (options.warmMemory || !size) {
    const blob = await response.clone().blob();
    size = blob.size || size;
    // blob 读取期间用户可能点了"清理音频缓存"，再次校验避免回写已被清空的缓存。
    if (options.epoch !== cacheEpoch) return false;
    if (options.warmMemory) putMemory(path, blob);
  }

  if (cache && !fromPersistentCache) {
    if (options.epoch !== cacheEpoch) return false;
    await cache.put(path, response.clone());
  }

  touchMeta(path, {
    size,
    hit: options.hit || false,
    prefetchedOnly: options.prefetchedOnly ?? true,
  });
  await trimPersistentCache();
  failedCache.delete(path);
  return true;
}

function pumpQueue() {
  while (activePreloads < MAX_CONCURRENT_PRELOADS && preloadQueue.length > 0) {
    const job = preloadQueue.shift();
    activePreloads++;
    cacheAudioNow(job.path, job.options)
      .then(job.resolve)
      .catch(err => {
        failedCache.set(job.path, Date.now());
        job.resolve(false);
      })
      .finally(() => {
        activePreloads--;
        inflight.delete(job.path);
        pumpQueue();
      });
  }
}

export function preloadAudioPath(path, options = {}) {
  if (!path) return Promise.resolve(false);
  const memoryHit = memoryCache.get(path);
  if (memoryHit) {
    memoryHit.lastAccess = Date.now();
    touchMeta(path, {
      size: memoryHit.size,
      hit: options.hit || false,
      prefetchedOnly: options.prefetchedOnly ?? true,
    });
    return Promise.resolve(true);
  }

  if (inflight.has(path)) return inflight.get(path);

  const promise = new Promise(resolve => {
    const job = { path, options: { ...options, epoch: cacheEpoch }, resolve };
    if (options.priority === 'high') preloadQueue.unshift(job);
    else preloadQueue.push(job);
    pumpQueue();
  });
  inflight.set(path, promise);
  return promise;
}

export function cacheAudioAfterPlay(path) {
  if (!path) return;
  touchMeta(path, { hit: true, prefetchedOnly: false });
  window.setTimeout(() => {
    preloadAudioPath(path, {
      priority: 'high',
      warmMemory: true,
      prefetchedOnly: false,
      hit: true,
      force: true,
    });
  }, 350);
}

export async function clearAudioCache() {
  cacheEpoch++;
  memoryCache.forEach(entry => URL.revokeObjectURL(entry.url));
  memoryCache.clear();
  failedCache.clear();
  inflight.clear();
  preloadQueue.length = 0;

  if (canUsePersistentCache()) {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key)));
  }
  // 把"清 META"排到 metaChain 队尾，等所有已入队的 touchMeta 跑完再清空一次，
  // 避免 cacheAudioAfterPlay 等同步入队的 touchMeta 在 clear 之后复活 META。
  await runMeta(() => localStorage.removeItem(META_KEY));
}

export function getAudioCacheStats() {
  const meta = loadMeta();
  const persistentBytes = Object.values(meta.entries).reduce((sum, entry) => sum + (entry.size || 0), 0);
  return {
    memoryBytes: getMemorySize(),
    memoryItems: memoryCache.size,
    persistentBytes,
    persistentItems: Object.keys(meta.entries).length,
    persistentLimitBytes: getPersistentLimit(),
  };
}

export function registerAudioServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(false);

  const url = new URL('sw.js', window.location.href);
  url.searchParams.set('v', getManifestVersion());

  return navigator.serviceWorker.register(url.href)
    .then(() => true)
    .catch(() => false);
}
