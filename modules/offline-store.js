
/* Trading Dashboard - Offline IndexedDB Storage */
(() => {
  'use strict';

  const DB_NAME = 'trading-dashboard-cache';
  const DB_VERSION = 1;
  const STORE = 'market-data';

  let dbPromise;

  function openDB() {
    if (!('indexedDB' in window)) {
      return Promise.reject(
        new Error('مرورگر IndexedDB را پشتیبانی نمی‌کند')
      );
    }

    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);

      request.onerror = () => {
        reject(
          request.error ||
          new Error('باز کردن پایگاه داده ناموفق بود')
        );
      };

      request.onblocked = () => {
        reject(new Error('به‌روزرسانی پایگاه داده مسدود شده است'));
      };
    });

    return dbPromise;
  }

  async function put(key, value, metadata = {}) {
    if (!key || typeof key !== 'string') {
      throw new TypeError('کلید ذخیره‌سازی معتبر نیست');
    }

    const db = await openDB();

    const record = {
      key,
      value,
      metadata,
      savedAt: Date.now(),
      schemaVersion: DB_VERSION
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).put(record);

      request.onsuccess = () => resolve({
        key,
        savedAt: record.savedAt
      });

      request.onerror = () => {
        reject(request.error || new Error('ذخیره اطلاعات ناموفق بود'));
      };
    });
  }

  async function get(key, options = {}) {
    const db = await openDB();

    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);

      request.onsuccess = () => resolve(request.result || null);

      request.onerror = () => {
        reject(request.error || new Error('خواندن کش ناموفق بود'));
      };
    });

    if (!record) return null;

    const ageMs = Date.now() - record.savedAt;
    const maxAge = Number(options.maxAgeMs);

    if (
      Number.isFinite(maxAge) &&
      maxAge >= 0 &&
      ageMs > maxAge &&
      !options.allowExpired
    ) {
      return null;
    }

    return {
      ...record,
      ageMs,
      stale: ageMs > 30000
    };
  }

  async function remove(key) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).delete(key);

      request.onsuccess = () => resolve(true);

      request.onerror = () => {
        reject(request.error || new Error('حذف اطلاعات ناموفق بود'));
      };
    });
  }

  async function clear() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).clear();

      request.onsuccess = () => resolve(true);

      request.onerror = () => {
        reject(request.error || new Error('پاک‌سازی کش ناموفق بود'));
      };
    });
  }

  async function list() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();

      request.onsuccess = () => {
        resolve((request.result || []).map(item => ({
          key: item.key,
          savedAt: item.savedAt,
          ageMs: Date.now() - item.savedAt,
          metadata: item.metadata || {}
        })));
      };

      request.onerror = () => {
        reject(request.error || new Error('فهرست کش خوانده نشد'));
      };
    });
  }

  async function saveMarketSnapshot(asset, interval, payload) {
    const key = `market:${String(asset).toUpperCase()}:${interval}`;

    return put(key, payload, {
      type: 'market-snapshot',
      asset,
      interval
    });
  }

  async function getMarketSnapshot(asset, interval, options = {}) {
    const key = `market:${String(asset).toUpperCase()}:${interval}`;

    return get(key, {
      allowExpired: true,
      ...options
    });
  }

  window.OfflineStore = Object.freeze({
    put,
    get,
    remove,
    clear,
    list,
    saveMarketSnapshot,
    getMarketSnapshot,
    supported: 'indexedDB' in window
  });

})();
