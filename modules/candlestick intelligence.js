
/*
 * Candlestick Intelligence
 * Candle patterns + Alligator + Trendline breakout detection
 * No external dependencies
 */

(function (global) {
  "use strict";

  const CandleIntel = {};

  // -----------------------------
  // Basic candle calculations
  // -----------------------------

  function candleStats(c) {
    const range = Math.max(c.high - c.low, 1e-12);
    const body = Math.abs(c.close - c.open);

    return {
      range,
      body,
      upper: c.high - Math.max(c.open, c.close),
      lower: Math.min(c.open, c.close) - c.low,
      bodyRatio: body / range,
      upperRatio:
        (c.high - Math.max(c.open, c.close)) / range,
      lowerRatio:
        (Math.min(c.open, c.close) - c.low) / range,
      bullish: c.close > c.open,
      bearish: c.close < c.open
    };
  }

  // -----------------------------
  // Candlestick pattern detection
  // -----------------------------

  CandleIntel.detectPatterns = function (bars, i) {
    const c = bars[i];
    const p = bars[i - 1];
    const p2 = bars[i - 2];
    const p3 = bars[i - 3];

    if (!c) return [];

    const s = candleStats(c);
    const patterns = [];

    if (s.bodyRatio <= 0.10) {
      patterns.push({
        name: "Doji",
        direction: "neutral",
        explanation:
          "قیمت باز و بسته شدن بسیار نزدیک است؛ بازار دچار بی‌تصمیمی شده است."
      });
    }

    if (
      s.bodyRatio < 0.30 &&
      s.upperRatio > 0.25 &&
      s.lowerRatio > 0.25
    ) {
      patterns.push({
        name: "Spinning Top",
        direction: "neutral",
        explanation:
          "بدنه کوچک و سایه‌های بلند نشان‌دهنده کشمکش خریداران و فروشندگان است."
      });
    }

    if (
      s.lower >= s.body * 2 &&
      s.upper <= s.body * 0.45 &&
      s.bodyRatio < 0.42
    ) {
      patterns.push({
        name: "Hammer / Hanging Man",
        direction: "conditional",
        explanation:
          "سایه پایینی بلند نشان می‌دهد قیمت‌های پایین‌تر پس زده شده‌اند. محل تشکیل نسبت به روند قبلی اهمیت دارد."
      });
    }

    if (
      s.upper >= s.body * 2 &&
      s.lower <= s.body * 0.45 &&
      s.bodyRatio < 0.42
    ) {
      patterns.push({
        name: "Inverted Hammer / Shooting Star",
        direction: "conditional",
        explanation:
          "سایه بالایی بلند نشان‌دهنده رد قیمت‌های بالاتر است. روند قبلی برای تفسیر ضروری است."
      });
    }

    if (
      s.bodyRatio >= 0.75 &&
      s.upperRatio < 0.08 &&
      s.lowerRatio < 0.08
    ) {
      patterns.push({
        name: s.bullish
          ? "Bullish Marubozu"
          : "Bearish Marubozu",
        direction: s.bullish ? "bullish" : "bearish",
        explanation:
          "بدنه بزرگ و سایه‌های بسیار کوچک؛ یک سمت بازار در این بازه تسلط بیشتری داشته است."
      });
    }

    if (p) {
      const ps = candleStats(p);

      if (
        ps.bearish &&
        s.bullish &&
        c.open <= p.close &&
        c.close >= p.open
      ) {
        patterns.push({
          name: "Bullish Engulfing",
          direction: "bullish",
          explanation:
            "بدنه کندل صعودی بدنه کندل نزولی قبلی را پوشانده است."
        });
      }

      if (
        ps.bullish &&
        s.bearish &&
        c.open >= p.close &&
        c.close <= p.open
      ) {
        patterns.push({
          name: "Bearish Engulfing",
          direction: "bearish",
          explanation:
            "بدنه کندل نزولی بدنه کندل صعودی قبلی را پوشانده است."
        });
      }

      if (c.high < p.high && c.low > p.low) {
        patterns.push({
          name: "Inside Bar",
          direction: "neutral",
          explanation:
            "دامنه کندل داخل دامنه کندل قبلی قرار دارد؛ احتمال فشردگی قیمت و شکست محدوده وجود دارد."
        });
      }

      if (c.high > p.high && c.low < p.low) {
        patterns.push({
          name: "Outside Bar",
          direction: "neutral",
          explanation:
            "دامنه کندل هر دو طرف کندل قبلی را پوشانده است."
        });
      }

      const tolerance = Math.max(
        Math.abs(c.close) * 0.0005,
        1e-10
      );

      if (
        Math.abs(c.high - p.high) <= tolerance &&
        ps.bullish &&
        s.bearish
      ) {
        patterns.push({
          name: "Tweezer Top",
          direction: "bearish",
          explanation:
            "دو سقف نزدیک به هم تشکیل شده‌اند و کندل جدید نزولی است."
        });
      }

      if (
        Math.abs(c.low - p.low) <= tolerance &&
        ps.bearish &&
        s.bullish
      ) {
        patterns.push({
          name: "Tweezer Bottom",
          direction: "bullish",
          explanation:
            "دو کف نزدیک به هم تشکیل شده‌اند و کندل جدید صعودی است."
        });
      }

      if (
        ps.bearish &&
        s.bullish &&
        c.close > (p.open + p.close) / 2 &&
        c.close < p.open
      ) {
        patterns.push({
          name: "Piercing Line",
          direction: "bullish",
          explanation:
            "کندل صعودی بیش از نیمه بدنه کندل نزولی قبلی را پس گرفته است."
        });
      }

      if (
        ps.bullish &&
        s.bearish &&
        c.close < (p.open + p.close) / 2 &&
        c.close > p.open
      ) {
        patterns.push({
          name: "Dark Cloud Cover",
          direction: "bearish",
          explanation:
            "کندل نزولی بیش از نیمه بدنه کندل صعودی قبلی را پس گرفته است."
        });
      }
    }

    if (p && p2) {
      const p2s = candleStats(p2);
      const ps = candleStats(p);

      if (
        p2s.bearish &&
        ps.bodyRatio < 0.35 &&
        s.bullish &&
        c.close > (p2.open + p2.close) / 2
      ) {
        patterns.push({
          name: "Morning Star Candidate",
          direction: "bullish",
          explanation:
            "ساختار سه‌کندلی شبیه ستاره صبحگاهی دیده می‌شود؛ تأیید روند لازم است."
        });
      }

      if (
        p2s.bullish &&
        ps.bodyRatio < 0.35 &&
        s.bearish &&
        c.close < (p2.open + p2.close) / 2
      ) {
        patterns.push({
          name: "Evening Star Candidate",
          direction: "bearish",
          explanation:
            "ساختار سه‌کندلی شبیه ستاره شامگاهی دیده می‌شود؛ تأیید روند لازم است."
        });
      }
    }

    if (p && p2 && p3) {
      const seq = [p3, p2, p, c];

      const whiteSoldiers =
        seq.slice(1).every(x => x.close > x.open) &&
        seq[1].close > seq[0].close &&
        seq[2].close > seq[1].close &&
        seq[3].close > seq[2].close;

      const blackCrows =
        seq.slice(1).every(x => x.close < x.open) &&
        seq[1].close < seq[0].close &&
        seq[2].close < seq[1].close &&
        seq[3].close < seq[2].close;

      if (whiteSoldiers) {
        patterns.push({
          name: "Three White Soldiers",
          direction: "bullish",
          explanation:
            "سه کندل صعودی متوالی با بسته شدن‌های بالاتر؛ نشانه قدرت خریداران."
        });
      }

      if (blackCrows) {
        patterns.push({
          name: "Three Black Crows",
          direction: "bearish",
          explanation:
            "سه کندل نزولی متوالی با بسته شدن‌های پایین‌تر؛ نشانه قدرت فروشندگان."
        });
      }
    }

    return patterns;
  };

  // -----------------------------
  // Smoothed Moving Average
  // -----------------------------

  CandleIntel.smma = function (values, period) {
    const result = Array(values.length).fill(null);

    if (values.length < period) return result;

    let sum = 0;

    for (let i = 0; i < period; i++) {
      sum += values[i];
    }

    result[period - 1] = sum / period;

    for (let i = period; i < values.length; i++) {
      result[i] =
        (
          result[i - 1] * (period - 1) +
          values[i]
        ) / period;
    }

    return result;
  };

  // -----------------------------
  // Alligator indicator
  // -----------------------------

  CandleIntel.alligator = function (bars) {
    const median = bars.map(
      c => (c.high + c.low) / 2
    );

    const jaw = CandleIntel.smma(median, 13);
    const teeth = CandleIntel.smma(median, 8);
    const lips = CandleIntel.smma(median, 5);

    return bars.map((_, i) => ({
      jaw: jaw[i],
      teeth: teeth[i],
      lips: lips[i],

      // Plot shifts are visual only.
      // Signal logic must use unshifted values.
      jawPlot: jaw[i - 8] ?? null,
      teethPlot: teeth[i - 5] ?? null,
      lipsPlot: lips[i - 3] ?? null,

      state:
        lips[i] == null ||
        teeth[i] == null ||
        jaw[i] == null
          ? "insufficient-data"
          : lips[i] > teeth[i] &&
            teeth[i] > jaw[i]
          ? "bullish"
          : lips[i] < teeth[i] &&
            teeth[i] < jaw[i]
          ? "bearish"
          : "ranging"
    }));
  };

  // -----------------------------
  // Confirmed swing points
  // -----------------------------

  CandleIntel.findPivots = function (
    bars,
    left = 3,
    right = 3
  ) {
    const highs = [];
    const lows = [];

    for (
      let i = left;
      i < bars.length - right;
      i++
    ) {
      let isHigh = true;
      let isLow = true;

      for (
        let k = i - left;
        k <= i + right;
        k++
      ) {
        if (k === i) continue;

        if (bars[k].high >= bars[i].high) {
          isHigh = false;
        }

        if (bars[k].low <= bars[i].low) {
          isLow = false;
        }
      }

      if (isHigh) {
        highs.push({
          index: i,
          price: bars[i].high
        });
      }

      if (isLow) {
        lows.push({
          index: i,
          price: bars[i].low
        });
      }
    }

    return { highs, lows };
  };

  // -----------------------------
  // Trendline evaluation
  // -----------------------------

  function lineValue(a, b, index) {
    if (b.index === a.index) return b.price;

    return (
      a.price +
      (b.price - a.price) *
      (index - a.index) /
      (b.index - a.index)
    );
  }

  CandleIntel.detectTrendlineBreaks = function (
    bars,
    index
  ) {
    const current = bars[index];
    const previous = bars[index - 1];

    if (!current || !previous) return [];

    // Only use pivots confirmed by the current candle.
    const confirmedBars = bars.slice(0, index + 1);

    const pivots = CandleIntel.findPivots(
      confirmedBars,
      3,
      3
    );

    const results = [];

    const highs = pivots.highs.slice(-2);
    const lows = pivots.lows.slice(-2);

    // Descending resistance line
    if (highs.length === 2) {
      const [a, b] = highs;

      if (b.price < a.price) {
        const currentLine = lineValue(a, b, index);
        const previousLine = lineValue(a, b, index - 1);

        if (
          current.high > currentLine &&
          current.close <= currentLine
        ) {
          results.push({
            type: "fakeout",
            direction: "bullish-failed",
            name: "شکست ناموفق مقاومت",
            explanation:
              "سایه از خط روند عبور کرده اما قیمت زیر خط بسته شده است."
          });
        } else if (
          current.close > currentLine &&
          previous.close <= previousLine
        ) {
          results.push({
            type: "candidate-breakout",
            direction: "bullish",
            name: "شکست صعودی خط روند",
            explanation:
              "کندل بالای خط روند نزولی بسته شده است. تأیید کندل بعدی یا پولبک لازم است."
          });
        }
      }
    }

    // Ascending support line
    if (lows.length === 2) {
      const [a, b] = lows;

      if (b.price > a.price) {
        const currentLine = lineValue(a, b, index);
        const previousLine = lineValue(a, b, index - 1);

        if (
          current.low < currentLine &&
          current.close >= currentLine
        ) {
          results.push({
            type: "fakeout",
            direction: "bearish-failed",
            name: "شکست ناموفق حمایت",
            explanation:
              "قیمت زیر خط نفوذ کرده اما بالای آن بسته شده است."
          });
        } else if (
          current.close < currentLine &&
          previous.close >= previousLine
        ) {
          results.push({
            type: "candidate-breakout",
            direction: "bearish",
            name: "شکست نزولی خط روند",
            explanation:
              "کندل زیر خط روند صعودی بسته شده است. تأیید کندل بعدی یا پولبک لازم است."
          });
        }
      }
    }

    return results;
  };

  // -----------------------------
  // Full candle explanation
  // -----------------------------

  CandleIntel.analyze = function (bars, index, context = {}) {
    const candle = bars[index];

    if (!candle) return null;

    const stats = candleStats(candle);
    const patterns = CandleIntel.detectPatterns(
      bars,
      index
    );

    const breaks =
      CandleIntel.detectTrendlineBreaks(
        bars,
        index
      );

    const alligator =
      context.alligator?.[index] ?? null;

    const notes = [];

    notes.push(
      `بدنه کندل ${(
        stats.bodyRatio * 100
      ).toFixed(1)} درصد دامنه آن است.`
    );

    notes.push(
      `سایه بالایی ${(
        stats.upperRatio * 100
      ).toFixed(1)} درصد و سایه پایینی ${(
        stats.lowerRatio * 100
      ).toFixed(1)} درصد دامنه است.`
    );

    if (context.rsi?.[index] != null) {
      notes.push(
        `مقدار RSI برابر ${Number(
          context.rsi[index]
        ).toFixed(2)} است.`
      );
    }

    if (alligator) {
      const labels = {
        bullish: "آرایش صعودی",
        bearish: "آرایش نزولی",
        ranging: "بازار خنثی یا خطوط درهم‌تنیده",
        "insufficient-data": "داده ناکافی"
      };

      notes.push(
        "وضعیت Alligator: " +
        (labels[alligator.state] || "نامشخص")
      );
    }

    return {
      candle,
      stats,
      patterns,
      trendlineEvents: breaks,
      notes,
      direction:
        stats.bullish
          ? "bullish"
          : stats.bearish
          ? "bearish"
          : "neutral"
    };
  };

  // -----------------------------
  // Optional chart click integration
  // -----------------------------

  CandleIntel.attachChart = function (options) {
    const {
      chart,
      getContext,
      onSelect
    } = options || {};

    if (
      !chart ||
      typeof chart.subscribeClick !== "function"
    ) {
      return false;
    }

    const handler = param => {
      if (!param || param.time == null) return;

      const context = getContext?.();

      if (!context || !Array.isArray(context.bars)) {
        return;
      }

      const index = context.bars.findIndex(
        bar => String(bar.time) === String(param.time)
      );

      if (index < 0) return;

      const result = CandleIntel.analyze(
        context.bars,
        index,
        context
      );

      if (typeof onSelect === "function") {
        onSelect(result, index);
      }
    };

    chart.subscribeClick(handler);

    return true;
  };

  // -----------------------------
  // Export
  // -----------------------------

  global.CandleIntel = CandleIntel;

})(window);
