
/* Trading Dashboard - Multi Exchange Data Hub */
(() => {
  'use strict';

  const CONFIG = {
    timeoutMs: 9000,
    retries: 1,
    cacheMs: 2500,
    providers: ['okx', 'binance', 'bybit']
  };

  const SYMBOLS = {
    BTC: { okx: 'BTC-USDT-SWAP', binance: 'BTCUSDT', bybit: 'BTCUSDT' },
    ETH: { okx: 'ETH-USDT-SWAP', binance: 'ETHUSDT', bybit: 'ETHUSDT' },
    LTC: { okx: 'LTC-USDT-SWAP', binance: 'LTCUSDT', bybit: 'LTCUSDT' },
    BCH: { okx: 'BCH-USDT-SWAP', binance: 'BCHUSDT', bybit: 'BCHUSDT' },
    UNI: { okx: 'UNI-USDT-SWAP', binance: 'UNIUSDT', bybit: 'UNIUSDT' }
  };

  const INTERVALS = {
    '1m': { okx: '1m', binance: '1m', bybit: '1' },
    '5m': { okx: '5m', binance: '5m', bybit: '5' },
    '15m': { okx: '15m', binance: '15m', bybit: '15' },
    '30m': { okx: '30m', binance: '30m', bybit: '30' },
    '1H': { okx: '1H', binance: '1h', bybit: '60' },
    '2H': { okx: '2H', binance: '2h', bybit: '120' },
    '4H': { okx: '4H', binance: '4h', bybit: '240' },
    '6H': { okx: '6H', binance: '6h', bybit: '360' },
    '12H': { okx: '12H', binance: '12h', bybit: '720' },
    '1D': { okx: '1D', binance: '1d', bybit: 'D' },
    '1W': { okx: '1W', binance: '1w', bybit: 'W' }
  };

  const cache = new Map();

  const providerState = Object.fromEntries(
    CONFIG.providers.map(name => [name, {
      name,
      online: null,
      lastSuccess: 0,
      lastError: '',
      latencyMs: null,
      failures: 0,
      successes: 0
    }])
  );

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function validNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function validateCandle(c) {
    return c &&
      Number.isFinite(c.time) &&
      c.time > 0 &&
      [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
      c.open > 0 &&
      c.high > 0 &&
      c.low > 0 &&
      c.close > 0 &&
      c.high >= Math.max(c.open, c.close, c.low) &&
      c.low <= Math.min(c.open, c.close, c.high) &&
      c.volume >= 0;
  }

  function normalizeCandles(rows) {
    const unique = new Map();

    for (const row of rows || []) {
      if (validateCandle(row)) {
        unique.set(row.time, row);
      }
    }

    return [...unique.values()].sort((a, b) => a.time - b.time);
  }

  async function request(url, provider) {
    let lastError;

    for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        CONFIG.timeoutMs
      );

      const started = Date.now();

      try {
        const response = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`${provider}: HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data || typeof data !== 'object') {
          throw new Error(`${provider}: پاسخ نامعتبر`);
        }

        clearTimeout(timer);

        providerState[provider].online = true;
        providerState[provider].lastSuccess = Date.now();
        providerState[provider].lastError = '';
        providerState[provider].latencyMs = Date.now() - started;
        providerState[provider].successes++;
        providerState[provider].failures = 0;

        return data;

      } catch (error) {
        clearTimeout(timer);

        lastError = error.name === 'AbortError'
          ? new Error(`${provider}: مهلت پاسخ‌گویی تمام شد`)
          : error;

        providerState[provider].online = false;
        providerState[provider].lastError = String(
          lastError.message || lastError
        );

        providerState[provider].failures++;

        if (attempt < CONFIG.retries) {
          await sleep(350 * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  function candleUrl(provider, asset, interval, limit) {
    const symbol = SYMBOLS[asset]?.[provider];
    const tf = INTERVALS[interval]?.[provider];

    if (!symbol || !tf) {
      throw new Error(`نماد یا بازه پشتیبانی نمی‌شود: ${asset}/${interval}`);
    }

    if (provider === 'okx') {
      return `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(symbol)}&bar=${encodeURIComponent(tf)}&limit=${limit}`;
    }

    if (provider === 'binance') {
      return `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`;
    }

    return `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${tf}&limit=${limit}`;
  }

  function parseCandles(provider, json) {
    let rows;

    if (provider === 'okx') {
      if (json.code !== '0') {
        throw new Error(json.msg || 'OKX API error');
      }

      rows = (json.data || []).map(x => ({
        time: Number(x[0]),
        open: Number(x[1]),
        high: Number(x[2]),
        low: Number(x[3]),
        close: Number(x[4]),
        volume: Number(x[5])
      }));

    } else if (provider === 'binance') {
      if (!Array.isArray(json)) {
        throw new Error('Binance response نامعتبر است');
      }

      rows = json.map(x => ({
        time: Number(x[0]),
        open: Number(x[1]),
        high: Number(x[2]),
        low: Number(x[3]),
        close: Number(x[4]),
        volume: Number(x[5])
      }));

    } else {
      if (json.retCode !== 0) {
        throw new Error(json.retMsg || 'Bybit API error');
      }

      rows = (json.result?.list || []).map(x => ({
        time: Number(x[0]),
        open: Number(x[1]),
        high: Number(x[2]),
        low: Number(x[3]),
        close: Number(x[4]),
        volume: Number(x[5])
      }));
    }

    return normalizeCandles(rows);
  }

  async function getCandles(options = {}) {
    const asset = String(options.asset || 'BTC').toUpperCase();
    const interval = options.interval || '4H';
    const limit = Math.max(30, Math.min(1000, Number(options.limit) || 300));
    const providers = options.providers || CONFIG.providers;

    const key = `candles:${asset}:${interval}:${limit}`;
    const cached = cache.get(key);

    if (
      !options.force &&
      cached &&
      Date.now() - cached.at < CONFIG.cacheMs
    ) {
      return { ...cached.value, cached: true };
    }

    const errors = [];

    for (const provider of providers) {
      if (!CONFIG.providers.includes(provider)) continue;

      try {
        const json = await request(
          candleUrl(provider, asset, interval, limit),
          provider
        );

        const candles = parseCandles(provider, json);

        if (candles.length < Math.min(30, limit)) {
          throw new Error(`${provider}: تعداد کندل معتبر کافی نیست`);
        }

        const result = {
          asset,
          interval,
          candles,
          provider,
          receivedAt: Date.now(),
          stale: false,
          sourceStatus: 'live',
          errors
        };

        cache.set(key, {
          at: Date.now(),
          value: result
        });

        return result;

      } catch (error) {
        errors.push({
          provider,
          message: String(error.message || error)
        });
      }
    }

    if (cached) {
      return {
        ...cached.value,
        cached: true,
        stale: true,
        sourceStatus: 'cached-stale',
        errors
      };
    }

    throw new Error(
      'تمام منابع دریافت کندل ناموفق بودند: ' +
      errors.map(x => x.provider + ': ' + x.message).join(' | ')
    );
  }

  function tickerUrl(provider, asset) {
    const symbol = SYMBOLS[asset]?.[provider];

    if (!symbol) {
      throw new Error(`نماد پشتیبانی نمی‌شود: ${asset}`);
    }

    if (provider === 'okx') {
      return `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(symbol)}`;
    }

    if (provider === 'binance') {
      return `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;
    }

    return `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`;
  }

  function parseTicker(provider, json) {
    let item;
    let last, open, bid, ask, volume;

    if (provider === 'okx') {
      if (json.code !== '0' || !json.data?.[0]) {
        throw new Error(json.msg || 'OKX ticker unavailable');
      }

      item = json.data[0];

      last = validNumber(item.last);
      open = validNumber(item.open24h);
      bid = validNumber(item.bidPx);
      ask = validNumber(item.askPx);
      volume = validNumber(item.vol24h);

    } else if (provider === 'binance') {
      item = json;

      last = validNumber(item.lastPrice);
      open = validNumber(item.openPrice);
      bid = validNumber(item.bidPrice);
      ask = validNumber(item.askPrice);
      volume = validNumber(item.volume);

    } else {
      if (json.retCode !== 0 || !json.result?.list?.[0]) {
        throw new Error(json.retMsg || 'Bybit ticker unavailable');
      }

      item = json.result.list[0];

      last = validNumber(item.lastPrice);
      open = validNumber(item.prevPrice24h);
      bid = validNumber(item.bid1Price);
      ask = validNumber(item.ask1Price);
      volume = validNumber(item.volume24h);
    }

    if (!(last > 0)) {
      throw new Error(`${provider}: قیمت نامعتبر`);
    }

    return {
      provider,
      last,
      open24h: open,
      bid,
      ask,
      volume24h: volume,
      change24hPct: open > 0 ? ((last / open) - 1) * 100 : null,
      receivedAt: Date.now()
    };
  }

  async function getTicker(options = {}) {
    const asset = String(options.asset || 'BTC').toUpperCase();
    const providers = options.providers || CONFIG.providers;

    const results = await Promise.allSettled(
      providers.map(async provider => {
        const json = await request(tickerUrl(provider, asset), provider);
        return parseTicker(provider, json);
      })
    );

    const tickers = results
      .filter(x => x.status === 'fulfilled')
      .map(x => x.value);

    const errors = results
      .map((x, i) => x.status === 'rejected'
        ? {
            provider: providers[i],
            message: String(x.reason?.message || x.reason)
          }
        : null
      )
      .filter(Boolean);

    if (!tickers.length) {
      throw new Error(
        'هیچ صرافی قیمت معتبری برنگرداند: ' +
        errors.map(x => x.provider + ': ' + x.message).join(' | ')
      );
    }

    tickers.sort((a, b) => a.receivedAt - b.receivedAt);

    const prices = tickers.map(x => x.last);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    return {
      asset,
      primary: tickers[0],
      tickers,
      errors,
      priceSpread: min > 0 ? ((max - min) / min) * 100 : null,
      receivedAt: Date.now(),
      stale: false
    };
  }

  function getProviderStatus() {
    return Object.values(providerState).map(x => ({ ...x }));
  }

  function clearCache() {
    cache.clear();
  }

  window.MarketDataHub = Object.freeze({
    getCandles,
    getTicker,
    getProviderStatus,
    clearCache,
    symbols: SYMBOLS,
    intervals: INTERVALS,
    config: Object.freeze({ ...CONFIG })
  });

})();
