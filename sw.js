const CACHE_PREFIX = 'vcbly-audio-v1-';
const params = new URL(self.location.href).searchParams;
const VERSION = params.get('v') || 'default';
const AUDIO_CACHE = `${CACHE_PREFIX}${VERSION}`;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== AUDIO_CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

function isAudioRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.endsWith('.m4a');
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match) return null;

  let start;
  let end;
  if (match[1] === '' && match[2] !== '') {
    const suffix = Number(match[2]);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }
  return {
    start,
    end: Math.min(end, size - 1),
  };
}

async function rangeResponse(response, rangeHeader) {
  const blob = await response.blob();
  const range = parseRange(rangeHeader, blob.size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${blob.size}` },
    });
  }

  const chunk = blob.slice(range.start, range.end + 1, blob.type || 'audio/mp4');
  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunk.size),
      'Content-Range': `bytes ${range.start}-${range.end}/${blob.size}`,
      'Content-Type': response.headers.get('Content-Type') || blob.type || 'audio/mp4',
      'Cache-Control': response.headers.get('Cache-Control') || 'public, max-age=31536000',
    },
  });
}

async function fetchFullAudio(requestUrl) {
  return fetch(requestUrl, { cache: 'force-cache' });
}

async function handleAudioRequest(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const url = request.url;
  const rangeHeader = request.headers.get('range');

  let cached = await cache.match(url);
  if (!cached) {
    let response = rangeHeader ? await fetchFullAudio(url) : await fetch(request);
    // 非 200（如 304 force-cache 命中但浏览器仍返回空）时跳过浏览器缓存重新拉取一次。
    if (!response || !response.ok || response.status !== 200) {
      response = await fetch(url, { cache: 'reload' });
    }
    if (!response || !response.ok) return response;

    if (response.status === 200) {
      await cache.put(url, response.clone());
      cached = response.clone();
    } else {
      return response;
    }
  }

  if (rangeHeader) {
    return rangeResponse(cached.clone(), rangeHeader);
  }
  return cached;
}

self.addEventListener('fetch', event => {
  if (!isAudioRequest(event.request)) return;
  event.respondWith(handleAudioRequest(event.request));
});
