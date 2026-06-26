const PREFIX = 'cc_cache_v1_';

export function cacheSet(key, data, ttlMs) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, expires: Date.now() + ttlMs }));
  } catch {
    clearExpired();
  }
}

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() > obj.expires) { localStorage.removeItem(PREFIX + key); return null; }
    return obj.data;
  } catch { return null; }
}

export function cacheClear() {
  Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
}

function clearExpired() {
  Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => {
    try {
      const obj = JSON.parse(localStorage.getItem(k));
      if (Date.now() > obj.expires) localStorage.removeItem(k);
    } catch { localStorage.removeItem(k); }
  });
}

export const TTL = {
  COMMESSE_INDEX: 10 * 60 * 1000,  // 10 min
  COMMESSA:        5 * 60 * 1000,  // 5 min
  TODO_LISTS:     60 * 60 * 1000,  // 1 ora
};
