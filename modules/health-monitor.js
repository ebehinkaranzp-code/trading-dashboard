
/* Trading Dashboard - Automatic Health Monitor */
(() => {
  'use strict';

  const CONFIG = {
    staleAfterMs: 30000,
    checkEveryMs: 10000,
    historyLimit: 100
  };

  const state = {
    startedAt: Date.now(),
    lastDataAt: 0,
    lastCheckAt: 0,
    network: navigator.onLine,
    dataState: 'unknown',
    errors: [],
    events: [],
    timer: null,
    lastWarning: ''
  };

  const listeners = new Set();

  function add(list, item) {
    list.unshift(item);

    if (list.length > CONFIG.historyLimit) {
      list.length = CONFIG.historyLimit;
    }
  }

  function emit() {
    const snapshot = getSnapshot();

    listeners.forEach(fn => {
      try {
        fn(snapshot);
      } catch (error) {
        console.error(error);
      }
    });
  }

  function record(type, message, detail = {}) {
    const item = {
      at: Date.now(),
      type,
      message: String(message),
      detail
    };

    add(state.events, item);

    if (type === 'error' || type === 'warning') {
      add(state.errors, item);
    }

    emit();

    return item;
  }

  function markData(source, receivedAt = Date.now()) {
    if (!Number.isFinite(receivedAt) || receivedAt <= 0) {
      return;
    }

    state.lastDataAt = receivedAt;
    state.dataState = 'live';
    state.lastWarning = '';

    record('info', 'داده معتبر دریافت شد', {
      source,
      receivedAt
    });
  }

  function check() {
    state.lastCheckAt = Date.now();
    state.network = navigator.onLine;

    const age = state.lastDataAt
      ? Date.now() - state.lastDataAt
      : Infinity;

    if (!state.network) {
      state.dataState = 'offline';

      if (state.lastWarning !== 'offline') {
        state.lastWarning = 'offline';
        record('warning', 'اتصال اینترنت مرورگر قطع است');
      }

    } else if (!state.lastDataAt) {
      state.dataState = 'waiting';

    } else if (age > CONFIG.staleAfterMs) {
      state.dataState = 'stale';

      if (state.lastWarning !== 'stale') {
        state.lastWarning = 'stale';

        record(
          'warning',
          'داده بازار قدیمی شده است',
          { ageMs: age }
        );
      }

    } else {
      state.dataState = 'live';
      state.lastWarning = '';
    }

    emit();

    return getSnapshot();
  }

  function getSnapshot() {
    const age = state.lastDataAt
      ? Date.now() - state.lastDataAt
      : null;

    return {
      startedAt: state.startedAt,
      uptimeMs: Date.now() - state.startedAt,
      lastDataAt: state.lastDataAt || null,
      dataAgeMs: age,
      lastCheckAt: state.lastCheckAt,
      network: state.network,
      dataState: state.dataState,
      errorCount: state.errors.length,
      errors: state.errors.slice(),
      events: state.events.slice()
    };
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('listener must be a function');
    }

    listeners.add(fn);
    fn(getSnapshot());

    return () => listeners.delete(fn);
  }

  function onOnline() {
    state.network = true;
    state.lastWarning = '';
    record('info', 'اتصال اینترنت برقرار شد');
    check();
  }

  function onOffline() {
    state.network = false;
    record('error', 'اتصال اینترنت قطع شد');
    check();
  }

  function start(options = {}) {
    stop();

    const interval = Math.max(
      3000,
      Number(options.checkEveryMs) || CONFIG.checkEveryMs
    );

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    state.timer = setInterval(check, interval);

    check();

    return stop;
  }

  function stop() {
    if (state.timer) {
      clearInterval(state.timer);
    }

    state.timer = null;

    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  }

  function exportReport() {
    return {
      generatedAt: new Date().toISOString(),
      health: getSnapshot(),
      providers: window.MarketDataHub?.getProviderStatus?.() || []
    };
  }

  window.HealthMonitor = Object.freeze({
    start,
    stop,
    check,
    record,
    markData,
    subscribe,
    getSnapshot,
    exportReport
  });

})();
