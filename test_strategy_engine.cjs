const assert = require('node:assert/strict');
global.window = global;
require('../modules/strategy-engine.js');
const fs = require('node:fs');

function readDaily(asset) {
  const lines = fs.readFileSync(`data/strategy/${asset}.csv`, 'utf8').trim().split(/\r?\n/);
  return lines.slice(1).map(line => {
    const [date, close] = line.split(',');
    return { time: Date.parse(`${date}T00:00:00Z`), close: Number(close) };
  });
}

for (const asset of ['btc', 'eth']) {
  const result = TDStrategyEngine.computeMomentum(readDaily(asset), asset.toUpperCase());
  assert.ok(result.lookback > 0);
  assert.ok(result.trainingSharpe > -Infinity);
  assert.ok(result.exposure >= 0 && result.exposure <= 1);
  console.log(`PASS Momentum ${asset.toUpperCase()}: lookback=${result.lookback}, exposure=${result.exposure.toFixed(3)}`);
}

const daily = [];
let p = 100;
for (let i = 0; i < 320; i++) {
  p *= 1.001;
  daily.push({ time: Date.UTC(2025, 0, 1) + i * 86400000, open: p * .999, high: p * 1.003, low: p * .997, close: p, volume: 100 });
}
const fourHour = [];
p = 100;
for (let i = 0; i < 1000; i++) {
  p *= 1.004;
  fourHour.push({ time: Date.UTC(2025, 0, 1) + i * 4 * 3600000, open: p * .999, high: p * 1.0005, low: p * .9995, close: p, volume: 10 });
}
const q = TDStrategyEngine.computeQuattro(fourHour, daily);
assert.equal(q.status, 'LONG');
assert.ok(q.units >= 1 && q.units <= 4);
assert.ok(q.stop > 0);
console.log(`PASS Quattro: status=${q.status}, units=${q.units}, stop=${q.stop.toFixed(4)}`);


// Regression: a breakout on the penultimate candle must surface its next-open fill event.
const trendDaily = [];
let dp = 100;
for (let i = 0; i < 320; i++) {
  dp *= 1.002;
  trendDaily.push({ time: Date.UTC(2025, 0, 1) + i * 86400000, open: dp, high: dp * 1.01, low: dp * .99, close: dp, volume: 100 });
}
const flat4h = [];
for (let i = 0; i < 58; i++) {
  flat4h.push({ time: Date.UTC(2025, 0, 1) + i * 4 * 3600000, open: 100, high: 101, low: 99, close: 100, volume: 10 });
}
flat4h.push({ time: Date.UTC(2025, 0, 1) + 58 * 4 * 3600000, open: 100, high: 106, low: 99, close: 105, volume: 10 });
flat4h.push({ time: Date.UTC(2025, 0, 1) + 59 * 4 * 3600000, open: 106, high: 106.2, low: 105.5, close: 106, volume: 10 });
const entryRegression = TDStrategyEngine.computeQuattro(flat4h, trendDaily);
assert.equal(entryRegression.action?.action, 'ENTRY');
assert.equal(entryRegression.action?.price, 106);
console.log('PASS Quattro next-open entry event regression');
