
/*
 * Candle Intelligence Module
 * Version: 1.0.0
 * Compatible with Lightweight Charts 4.2.x
 *
 * Features:
 * - Candlestick pattern detection
 * - Williams Alligator (SMMA 13/8/5, shifts 8/5/3)
 * - Confirmed pivot detection
 * - Trendline break candidates
 * - Selected-candle explanation panel
 *
 * Important:
 * - No future data is used for a signal.
 * - A pattern is not a trading signal by itself.
 * - Alligator shifts are display shifts, not future-looking values.
 */

(function (global) {
  'use strict';

  const VERSION = '1.0.0';

  const CONFIG = {
    alligator: {
      jawPeriod: 13,
      teethPeriod: 8,
      lipsPeriod: 5,
      jawShift: 8,
      teethShift: 5,
      lipsShift: 3
    },
    pivots: {
      left: 3,
      right: 3
    },
    volumeLookback: 20
  };

  let state = {
    chart: null,
    candleSeries: null,
    getContext: null,
    container: null,
    panel: null,
    selectedTime: null,
    alligatorSeries: [],
    clickHandler: null
  };

  // --------------------------------------------------
  // General helpers
  // --------------------------------------------------

  function validNumber(value) {
    return Number.isFinite(Number(value));
  }

  function toChartTime(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;

    // Unix milliseconds -> Unix seconds
    return Math.floor(n > 1e12 ? n / 1000 : n);
  }

  function normalizeBars(input) {
    if (!Array.isArray(input)) return [];

    return input
      .map(bar => {
        if (!bar || typeof bar !== 'object') return null;

        const time = toChartTime(bar.time);

        const open = Number(bar.open);
        const high = Number(bar.high);
        const low = Number(bar.low);
        const close = Number(bar.close);
        const volume = Number(bar.volume ?? 0);

        if (
          time === null ||
          ![open, high, low, close, volume].every(Number.isFinite) ||
          open <= 0 ||
          high <= 0 ||
          low <= 0 ||
          close <= 0 ||
          volume < 0 ||
          high < Math.max(open, close) ||
          low > Math.min(open, close) ||
          high < low
        ) {
          return null;
        }

        return {
          time,
          open,
          high,
          low,
          close,
          volume
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time)
      .filter((bar, index, list) =>
        index === 0 || bar.time !== list[index - 1].time
      );
  }

  function average(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function candleParts(bar) {
    const body = Math.abs(bar.close - bar.open);
    const range = Math.max(bar.high - bar.low, 1e-12);

    return {
      body,
      range,
      upperShadow: bar.high - Math.max(bar.open, bar.close),
      lowerShadow: Math.min(bar.open, bar.close) - bar.low,
      bullish: bar.close > bar.open,
      bearish: bar.close < bar.open,
      bodyRatio: body / range,
      closePosition: (bar.close - bar.low) / range
    };
  }

  // --------------------------------------------------
  // SMMA
  // --------------------------------------------------

  function smma(values, period) {
    const output = Array(values.length).fill(null);

    if (!Number.isInteger(period) || period < 1) {
      return output;
    }

    if (values.length < period) return output;

    const firstWindow = values.slice(0, period);

    if (firstWindow.some(v => !Number.isFinite(v))) {
      return output;
    }

    let previous = average(firstWindow);
    output[period - 1] = previous;

    for (let i = period; i < values.length; i++) {
      const current = values[i];

      if (!Number.isFinite(current) || previous === null) {
        previous = null;
        continue;
      }

      if (previous === null) {
        const window = values.slice(i - period + 1, i + 1);

        if (window.some(v => !Number.isFinite(v))) {
          continue;
        }

        previous = average(window);
      } else {
        previous = (previous * (period - 1) + current) / period;
      }

      output[i] = previous;
    }

    return output;
  }

  // --------------------------------------------------
  // Williams Alligator
  // --------------------------------------------------

  function shiftForDisplay(values, shift) {
    const output = Array(values.length).fill(null);

    for (let i = 0; i < values.length; i++) {
      const destination = i + shift;

      if (destination < output.length) {
        output[destination] = values[i];
      }
    }

    return output;
  }

  function alligator(input) {
    const bars = normalizeBars(input);
    const median = bars.map(bar => (bar.high + bar.low) / 2);

    const jawRaw = smma(median, CONFIG.alligator.jawPeriod);
    const teethRaw = smma(median, CONFIG.alligator.teethPeriod);
    const lipsRaw = smma(median, CONFIG.alligator.lipsPeriod);

    return {
      jaw: shiftForDisplay(jawRaw, CONFIG.alligator.jawShift),
      teeth: shiftForDisplay(teethRaw, CONFIG.alligator.teethShift),
      lips: shiftForDisplay(lipsRaw, CONFIG.alligator.lipsShift),

      // Raw values are included for transparent inspection.
      raw: {
        jaw: jawRaw,
        teeth: teethRaw,
        lips: lipsRaw
      },

      settings: { ...CONFIG.alligator }
    };
  }

  function alligatorAt(lines, index) {
    if (!lines || index < 0) return null;

    const jaw = lines.jaw[index];
    const teeth = lines.teeth[index];
    const lips = lines.lips[index];

    if (![jaw, teeth, lips].every(Number.isFinite)) {
      return null;
    }

    let direction = 'MIXED';

    if (lips > teeth && teeth > jaw) {
      direction = 'BULLISH';
    } else if (lips < teeth && teeth < jaw) {
      direction = 'BEARISH';
    }

    return { jaw, teeth, lips, direction };
  }

  // --------------------------------------------------
  // Confirmed pivots
  // --------------------------------------------------

  function findPivots(input, left = 3, right = 3, endIndex) {
    const bars = normalizeBars(input);
    const pivots = [];

    const lastIndex = Math.min(
      bars.length - 1,
      Number.isInteger(endIndex) ? endIndex : bars.length - 1
    );

    // A pivot is not confirmed until 'right' candles have closed.
    const lastConfirmable = lastIndex - right;

    for (let i = left; i <= lastConfirmable; i++) {
      const current = bars[i];

      let isHigh = true;
      let isLow = true;

      for (let j = i - left; j <= i + right; j++) {
        if (j === i) continue;

        if (bars[j].high >= current.high) isHigh = false;
        if (bars[j].low <= current.low) isLow = false;

        if (!isHigh && !isLow) break;
      }

      if (isHigh) {
        pivots.push({
          index: i,
          time: current.time,
          price: current.high,
          type: 'HIGH'
        });
      }

      if (isLow) {
        pivots.push({
          index: i,
          time: current.time,
          price: current.low,
          type: 'LOW'
        });
      }
    }

    return pivots.sort((a, b) => a.index - b.index);
  }

  // --------------------------------------------------
  // Trendline break candidates
  // --------------------------------------------------

  function lineValueAt(p1, p2, index) {
    if (!p1 || !p2 || p1.index === p2.index) return null;

    const slope =
      (p2.price - p1.price) / (p2.index - p1.index);

    return p1.price + slope * (index - p1.index);
  }

  function detectTrendlineBreaks(input, index) {
    const bars = normalizeBars(input);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= bars.length
    ) {
      return [];
    }

    // Only pivots confirmed by the selected candle are allowed.
    const pivots = findPivots(
      bars,
      CONFIG.pivots.left,
      CONFIG.pivots.right,
      index
    );

    const result = [];
    const current = bars[index];

    const lows = pivots.filter(p => p.type === 'LOW');
    const highs = pivots.filter(p => p.type === 'HIGH');

    if (lows.length >= 2) {
      const p1 = lows[lows.length - 2];
      const p2 = lows[lows.length - 1];

      if (p2.index > p1.index) {
        const level = lineValueAt(p1, p2, index);

        if (Number.isFinite(level)) {
          if (current.close < level) {
            result.push({
              type: 'SUPPORT_BREAK_CANDIDATE',
              level,
              confirmedByClose: true,
              description: 'بسته‌شدن کندل زیر خط حمایت احتمالی'
            });
          } else if (current.low < level) {
            result.push({
              type: 'SUPPORT_WICK_BREACH',
              level,
              confirmedByClose: false,
              description: 'سایه زیر حمایت رفته، اما کندل زیر آن بسته نشده است'
            });
          }
        }
      }
    }

    if (highs.length >= 2) {
      const p1 = highs[highs.length - 2];
      const p2 = highs[highs.length - 1];

      if (p2.index > p1.index) {
        const level = lineValueAt(p1, p2, index);

        if (Number.isFinite(level)) {
          if (current.close > level) {
            result.push({
              type: 'RESISTANCE_BREAK_CANDIDATE',
              level,
              confirmedByClose: true,
              description: 'بسته‌شدن کندل بالای خط مقاومت احتمالی'
            });
          } else if (current.high > level) {
            result.push({
              type: 'RESISTANCE_WICK_BREACH',
              level,
              confirmedByClose: false,
              description: 'سایه بالای مقاومت رفته، اما کندل بالای آن بسته نشده است'
            });
          }
        }
      }
    }

    return result;
  }

  // --------------------------------------------------
  // Candlestick patterns
  // --------------------------------------------------

  function detectPatterns(input, index) {
    const bars = normalizeBars(input);
    const patterns = [];

    if (!Number.isInteger(index) || index < 0 || index >= bars.length) {
      return patterns;
    }

    const current = bars[index];
    const p = candleParts(current);

    const previous = index > 0 ? bars[index - 1] : null;
    const pp = previous ? candleParts(previous) : null;

    // Doji
    if (p.bodyRatio <= 0.10) {
      patterns.push({
        name: 'DOJI',
        direction: 'NEUTRAL',
        strength: 'LOW',
        description: 'بدنه بسیار کوچک؛ نشانه تردید و تعادل نسبی خریداران و فروشندگان'
      });
    }

    // Hammer
    if (
      p.lowerShadow >= Math.max(p.body * 2, p.range * 0.35) &&
      p.upperShadow <= p.range * 0.25 &&
      p.closePosition >= 0.55 &&
      p.bodyRatio <= 0.45
    ) {
      patterns.push({
        name: 'HAMMER',
        direction: 'BULLISH',
        strength: 'MEDIUM',
        description: 'سایه پایینی بلند و بسته‌شدن نزدیک بخش بالایی کندل؛ در کف روند مهم‌تر است'
      });
    }

    // Shooting star
    if (
      p.upperShadow >= Math.max(p.body * 2, p.range * 0.35) &&
      p.lowerShadow <= p.range * 0.25 &&
      p.closePosition <= 0.45 &&
      p.bodyRatio <= 0.45
    ) {
      patterns.push({
        name: 'SHOOTING_STAR',
        direction: 'BEARISH',
        strength: 'MEDIUM',
        description: 'سایه بالایی بلند؛ در نزدیکی مقاومت یا پس از رشد قیمت اهمیت بیشتری دارد'
      });
    }

    // Bullish engulfing
    if (
      previous &&
      pp.body > 0 &&
      p.bullish &&
      pp.bearish &&
      current.open <= previous.close &&
      current.close >= previous.open
    ) {
      patterns.push({
        name: 'BULLISH_ENGULFING',
        direction: 'BULLISH',
        strength: 'MEDIUM',
        description: 'بدنه صعودی، بدنه نزولی قبلی را پوشانده است'
      });
    }

    // Bearish engulfing
    if (
      previous &&
      pp.body > 0 &&
      p.bearish &&
      pp.bullish &&
      current.open >= previous.close &&
      current.close <= previous.open
    ) {
      patterns.push({
        name: 'BEARISH_ENGULFING',
        direction: 'BEARISH',
        strength: 'MEDIUM',
        description: 'بدنه نزولی، بدنه صعودی قبلی را پوشانده است'
      });
    }

    // Morning star (simplified three-candle structure)
    if (index >= 2) {
      const first = candleParts(bars[index - 2]);
      const middle = candleParts(bars[index - 1]);

      const firstMid =
        (bars[index - 2].open + bars[index - 2].close) / 2;

      if (
        first.bearish &&
        first.bodyRatio >= 0.45 &&
        middle.bodyRatio <= 0.30 &&
        p.bullish &&
        current.close > firstMid
      ) {
        patterns.push({
          name: 'MORNING_STAR',
          direction: 'BULLISH',
          strength: 'MEDIUM',
          description: 'ساختار سه‌کندلی شبیه ستاره صبحگاهی؛ نیازمند تأیید روند و حجم'
        });
      }
    }

    // Evening star (simplified three-candle structure)
    if (index >= 2) {
      const first = candleParts(bars[index - 2]);
      const middle = candleParts(bars[index - 1]);

      const firstMid =
        (bars[index - 2].open + bars[index - 2].close) / 2;

      if (
        first.bullish &&
        first.bodyRatio >= 0.45 &&
        middle.bodyRatio <= 0.30 &&
        p.bearish &&
        current.close < firstMid
      ) {
        patterns.push({
          name: 'EVENING_STAR',
          direction: 'BEARISH',
          strength: 'MEDIUM',
          description: 'ساختار سه‌کندلی شبیه ستاره شامگاهی؛ نیازمند تأیید روند و حجم'
        });
      }
    }

    return patterns;
  }

  // --------------------------------------------------
  // Context and analysis
  // --------------------------------------------------

  function volumeContext(bars, index) {
    const start = Math.max(0, index - CONFIG.volumeLookback);
    const previous = bars.slice(start, index);

    if (previous.length < 5) {
      return {
        average: null,
        current: bars[index].volume,
        ratio: null,
        status: 'INSUFFICIENT_DATA'
      };
    }

    const avg = average(previous.map(x => x.volume));
    const current = bars[index].volume;
    const ratio = avg > 0 ? current / avg : null;

    return {
      average: avg,
      current,
      ratio,
      status:
        ratio === null ? 'UNAVAILABLE' :
        ratio >= 1.5 ? 'ABOVE_AVERAGE' :
        ratio <= 0.7 ? 'BELOW_AVERAGE' :
        'NORMAL'
    };
  }

  function analyze(input, index, context = {}) {
    const bars = normalizeBars(input);

    if (!bars.length) {
      return {
        status: 'NO_DATA',
        message: 'داده معتبر کندل در دسترس نیست'
      };
    }

    if (!Number.isInteger(index) || index < 0 || index >= bars.length) {
      return {
        status: 'INVALID_INDEX',
        message: 'شماره کندل انتخاب‌شده معتبر نیست'
      };
    }

    const bar = bars[index];
    const patterns = detectPatterns(bars, index);
    const lines = alligator(bars);
    const gator = alligatorAt(lines, index);
    const breaks = detectTrendlineBreaks(bars, index);
    const volume = volumeContext(bars, index);

    const bullishPatterns = patterns.filter(
      p => p.direction === 'BULLISH'
    );

    const bearishPatterns = patterns.filter(
      p => p.direction === 'BEARISH'
    );

    let bias = 'NEUTRAL';

    if (gator?.direction === 'BULLISH') bias = 'BULLISH';
    if (gator?.direction === 'BEARISH') bias = 'BEARISH';

    const reasons = [];

    if (gator) {
      reasons.push(
        gator.direction === 'BULLISH'
          ? 'ترتیب خطوط Alligator صعودی است'
          : gator.direction === 'BEARISH'
            ? 'ترتیب خطوط Alligator نزولی است'
            : 'خطوط Alligator جهت یکپارچه ندارند'
      );
    } else {
      reasons.push('برای محاسبه Alligator داده کافی وجود ندارد');
    }

    if (bullishPatterns.length) {
      reasons.push('الگوی شمعی با جهت صعودی شناسایی شد');
    }

    if (bearishPatterns.length) {
      reasons.push('الگوی شمعی با جهت نزولی شناسایی شد');
    }

    if (volume.status === 'ABOVE_AVERAGE') {
      reasons.push('حجم از میانگین دوره اخیر بیشتر است');
    } else if (volume.status === 'BELOW_AVERAGE') {
      reasons.push('حجم از میانگین دوره اخیر کمتر است');
    }

    if (breaks.length) {
      breaks.forEach(item => reasons.push(item.description));
    }

    const conflicts =
      (bias === 'BULLISH' && bearishPatterns.length > 0) ||
      (bias === 'BEARISH' && bullishPatterns.length > 0);

    return {
      status: 'OK',
      version: VERSION,
      candle: {
        index,
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      },
      bias,
      patterns,
      alligator: gator,
      alligatorLines: {
        jaw: lines.jaw[index],
        teeth: lines.teeth[index],
        lips: lines.lips[index]
      },
      trendlineBreaks: breaks,
      volume,
      conflicts,
      reasons,
      decision: 'REVIEW',
      warning: 'این تحلیل به‌تنهایی سیگنال خرید یا فروش نیست.',
      context: {
        market: context.market || null,
        timeframe: context.timeframe || null
      }
    };
  }

  // --------------------------------------------------
  // User interface
  // --------------------------------------------------

  function createPanel() {
    if (state.panel && state.panel.isConnected) {
      return state.panel;
    }

    let host = state.container;

    if (!host && typeof document !== 'undefined') {
      host = document.getElementById('tv_chart');
    }

    if (!host) return null;

    let panel = document.getElementById('candleIntel');

    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'candleIntel';

      panel.style.cssText = [
        'margin-top:10px',
        'padding:14px',
        'background:#101b2b',
        'border:1px solid #26364b',
        'border-radius:10px',
        'color:#edf4ff',
        'font-family:Tahoma,Arial,sans-serif',
        'font-size:12px',
        'line-height:1.9',
        'direction:rtl'
      ].join(';');

      const chartWrap = host.closest('.chart-wrap') || host;
      chartWrap.insertAdjacentElement('afterend', panel);
    }

    state.panel = panel;
    return panel;
  }

  function addPanelRow(title, value) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:5px 0;border-bottom:1px solid #26364b';

    const strong = document.createElement('strong');
    strong.textContent = title + ': ';

    const span = document.createElement('span');
    span.textContent = value;

    row.append(strong, span);
    return row;
  }

  function render(result) {
    const panel = createPanel();
    if (!panel) return;

    panel.replaceChildren();

    const heading = document.createElement('div');
    heading.textContent = 'تحلیل هوشمند کندل انتخاب‌شده';
    heading.style.cssText = 'font-size:14px;font-weight:bold;margin-bottom:8px';

    panel.appendChild(heading);

    if (!result || result.status !== 'OK') {
      const message = document.createElement('div');
      message.textContent = result?.message || 'برای مشاهده تحلیل، روی یک کندل کلیک کن.';
      panel.appendChild(message);
      return;
    }

    const candle = result.candle;

    panel.appendChild(addPanelRow(
      'قیمت بسته‌شدن',
      candle.close.toLocaleString('en-US')
    ));

    panel.appendChild(addPanelRow(
      'جهت کلی Alligator',
      result.bias
    ));

    panel.appendChild(addPanelRow(
      'حجم نسبت به میانگین',
      result.volume.ratio === null
        ? 'داده کافی نیست'
        : result.volume.ratio.toFixed(2) + ' برابر'
    ));

    const patternText = result.patterns.length
      ? result.patterns.map(p => p.name + ' — ' + p.description).join(' | ')
      : 'الگوی مشخصی شناسایی نشد';

    panel.appendChild(addPanelRow('الگوهای کندلی', patternText));

    const breakText = result.trendlineBreaks.length
      ? result.trendlineBreaks.map(x => x.description).join(' | ')
      : 'شکست خط روند تأییدشده‌ای شناسایی نشد';

    panel.appendChild(addPanelRow('خطوط روند', breakText));

    const reasonsTitle = document.createElement('div');
    reasonsTitle.textContent = 'دلایل تحلیل';
    reasonsTitle.style.cssText = 'font-weight:bold;margin-top:10px';

    panel.appendChild(reasonsTitle);

    result.reasons.forEach(reason => {
      const item = document.createElement('div');
      item.textContent = '• ' + reason;
      panel.appendChild(item);
    });

    if (result.conflicts) {
      const conflict = document.createElement('div');
      conflict.textContent =
        'هشدار: شواهد جهت‌دار با یکدیگر تعارض دارند؛ بررسی دستی ضروری است.';
      conflict.style.cssText = 'color:#e6b65b;margin-top:8px;font-weight:bold';
      panel.appendChild(conflict);
    }

    const warning = document.createElement('div');
    warning.textContent = result.warning;
    warning.style.cssText = 'color:#e6b65b;margin-top:10px';

    panel.appendChild(warning);
  }

  // --------------------------------------------------
  // Chart integration
  // --------------------------------------------------

  function getBars() {
    if (typeof state.getContext !== 'function') return [];

    try {
      const context = state.getContext() || {};
      return normalizeBars(context.bars || []);
    } catch (error) {
      console.error('[CandleIntel] getContext failed:', error);
      return [];
    }
  }

  function renderAlligatorLines() {
    if (!state.chart || typeof state.chart.addLineSeries !== 'function') {
      return;
    }

    const bars = getBars();
    if (!bars.length) return;

    const lines = alligator(bars);

    if (!state.alligatorSeries.length) {
      try {
        state.alligatorSeries = [
          state.chart.addLineSeries({
            color: '#e6b65b',
            lineWidth: 2,
            title: 'Alligator Jaw'
          }),
          state.chart.addLineSeries({
            color: '#55aef5',
            lineWidth: 2,
            title: 'Alligator Teeth'
          }),
          state.chart.addLineSeries({
            color: '#34c78a',
            lineWidth: 2,
            title: 'Alligator Lips'
          })
        ];
      } catch (error) {
        console.warn('[CandleIntel] Could not create Alligator lines:', error);
        return;
      }
    }

    const toSeriesData = values =>
      values
        .map((value, i) =>
          Number.isFinite(value)
            ? { time: bars[i].time, value }
            : null
        )
        .filter(Boolean);

    try {
      state.alligatorSeries[0].setData(toSeriesData(lines.jaw));
      state.alligatorSeries[1].setData(toSeriesData(lines.teeth));
      state.alligatorSeries[2].setData(toSeriesData(lines.lips));
    } catch (error) {
      console.warn('[CandleIntel] Alligator update failed:', error);
    }
  }

  function handleChartClick(param) {
    if (!param || param.time == null) return;

    const selectedTime = toChartTime(param.time);
    if (selectedTime === null) return;

    const bars = getBars();
    const index = bars.findIndex(bar => bar.time === selectedTime);

    if (index < 0) {
      render({
        status: 'NO_DATA',
        message: 'کندل انتخاب‌شده در داده‌های تحلیلی پیدا نشد.'
      });
      return;
    }

    state.selectedTime = selectedTime;

    let context = {};

    try {
      context = typeof state.getContext === 'function'
        ? state.getContext() || {}
        : {};
    } catch (_) {}

    const result = analyze(bars, index, context);
    render(result);
  }

  function init(options = {}) {
    destroy();

    state.chart = options.chart || null;
    state.candleSeries = options.candleSeries || null;
    state.getContext = options.getContext || null;
    state.container =
      options.container ||
      (typeof document !== 'undefined'
        ? document.getElementById('tv_chart')
        : null);

    if (!state.chart || typeof state.chart.subscribeClick !== 'function') {
      console.warn('[CandleIntel] A valid Lightweight Charts chart is required.');
      return false;
    }

    if (typeof state.getContext !== 'function') {
      console.warn('[CandleIntel] getContext callback is required.');
      return false;
    }

    state.clickHandler = handleChartClick;

    state.chart.subscribeClick(state.clickHandler);

    createPanel();
    renderAlligatorLines();

    render({
      status: 'WAITING',
      message: 'برای مشاهده تحلیل، روی یک کندل کلیک کن.'
    });

    return true;
  }

  function refresh() {
    renderAlligatorLines();

    if (state.selectedTime === null) return;

    const bars = getBars();
    const index = bars.findIndex(
      bar => bar.time === state.selectedTime
    );

    if (index >= 0) {
      let context = {};

      try {
        context = state.getContext() || {};
      } catch (_) {}

      render(analyze(bars, index, context));
    }
  }

  function destroy() {
    if (state.chart && state.clickHandler) {
      try {
        state.chart.unsubscribeClick(state.clickHandler);
      } catch (_) {}
    }

    state.alligatorSeries.forEach(series => {
      try {
        state.chart?.removeSeries(series);
      } catch (_) {}
    });

    state = {
      chart: null,
      candleSeries: null,
      getContext: null,
      container: null,
      panel: null,
      selectedTime: null,
      alligatorSeries: [],
      clickHandler: null
    };
  }

  // --------------------------------------------------
  // Public API
  // --------------------------------------------------

  global.CandleIntel = {
    version: VERSION,
    init,
    refresh,
    destroy,
    normalizeBars,
    smma,
    alligator,
    alligatorAt,
    findPivots,
    detectPatterns,
    detectTrendlineBreaks,
    analyze
  };

})(window);
