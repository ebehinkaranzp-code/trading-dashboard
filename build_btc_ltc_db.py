#!/usr/bin/env python3
"""
BTC + LTC historical market database builder.

Downloads Binance public monthly archives and combines them into ONE SQLite file.
Default: Spot + USD-M futures 1-minute candles for BTCUSDT and LTCUSDT.
Optional --trades downloads aggregate trades too (very large; allow substantial disk/time).

Examples:
  python build_btc_ltc_db.py
  python build_btc_ltc_db.py --start 2020-01 --end 2026-10 --trades
  python build_btc_ltc_db.py --output market_history.sqlite --symbols BTCUSDT,LTCUSDT

No API key is required. Missing archive months are logged and skipped.
Existing imported months are skipped, so rerunning resumes the job.
"""

import argparse
import csv
import hashlib
import io
import json
import sqlite3
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

BASE = "https://data.binance.vision/data"
DEFAULT_SYMBOLS = "BTCUSDT,LTCUSDT"
INTERVALS = ("1m",)  # Store canonical 1-minute candles; program can aggregate larger timeframes.
UA = "BTC-LTC-Historical-Database/1.0"

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS candles (
 market TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL,
 open_time INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL,
 low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
 close_time INTEGER, quote_volume REAL, trade_count INTEGER,
 taker_buy_base REAL, taker_buy_quote REAL,
 PRIMARY KEY(market,symbol,interval,open_time)
);
CREATE INDEX IF NOT EXISTS candles_lookup
 ON candles(symbol,market,interval,open_time);
CREATE TABLE IF NOT EXISTS aggregate_trades (
 market TEXT NOT NULL, symbol TEXT NOT NULL, agg_trade_id INTEGER NOT NULL,
 price REAL NOT NULL, quantity REAL NOT NULL, first_trade_id INTEGER,
 last_trade_id INTEGER, trade_time INTEGER NOT NULL,
 buyer_is_maker INTEGER NOT NULL,
 PRIMARY KEY(market,symbol,agg_trade_id)
);
CREATE INDEX IF NOT EXISTS trades_lookup
 ON aggregate_trades(symbol,market,trade_time);
CREATE TABLE IF NOT EXISTS imports (
 dataset TEXT NOT NULL, market TEXT NOT NULL, symbol TEXT NOT NULL,
 interval TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL,
 row_count INTEGER NOT NULL, sha256 TEXT, status TEXT NOT NULL,
 imported_at TEXT NOT NULL,
 PRIMARY KEY(dataset,market,symbol,interval,year,month)
);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

def get_bytes(url, retries=4):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    last_error = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise FileNotFoundError(url)
            last_error = exc
        except Exception as exc:
            last_error = exc
        time.sleep(min(2 ** attempt, 15))
    raise RuntimeError(f"Download failed after {retries} attempts: {url} ({last_error})")

def sha256_for(url, payload):
    try:
        check = get_bytes(url + ".CHECKSUM").decode("utf-8", "replace").strip()
        expected = check.split()[0].lower()
        actual = hashlib.sha256(payload).hexdigest()
        if expected and expected != actual:
            raise ValueError(f"Checksum mismatch: {url}")
        return actual
    except FileNotFoundError:
        return hashlib.sha256(payload).hexdigest()

def months_between(start, end):
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield y, m
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1

def month_end_ms(y, m):
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return int(datetime(ny, nm, 1, tzinfo=timezone.utc).timestamp() * 1000)

def archive_path(dataset, market, symbol, interval, y, m):
    ym = f"{y}-{m:02d}"
    if dataset == "klines":
        return f"{BASE}/{market}/monthly/klines/{symbol}/{interval}/{symbol}-{interval}-{ym}.zip"
    return f"{BASE}/{market}/monthly/aggTrades/{symbol}/{symbol}-aggTrades-{ym}.zip"

def csv_rows(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            return
        with zf.open(csv_names[0]) as raw:
            import io as _io
            wrapper = _io.TextIOWrapper(raw, encoding="utf-8")
            yield from csv.reader(wrapper)

def already_done(db, dataset, market, symbol, interval, y, m):
    return db.execute(
        """SELECT status FROM imports WHERE dataset=? AND market=? AND symbol=?
           AND interval=? AND year=? AND month=?""",
        (dataset, market, symbol, interval, y, m)
    ).fetchone()

def import_month(db, dataset, market, symbol, interval, y, m, force=False):
    previous = already_done(db, dataset, market, symbol, interval, y, m)
    if previous and previous[0] == "imported" and not force:
        return 0, "already present"

    url = archive_path(dataset, market, symbol, interval, y, m)
    try:
        blob = get_bytes(url)
    except FileNotFoundError:
        with db:
            db.execute(
                """INSERT OR REPLACE INTO imports VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (dataset, market, symbol, interval, y, m, 0, None,
                 "not_published", datetime.now(timezone.utc).isoformat())
            )
        return 0, "archive not published"

    digest = sha256_for(url, blob)
    count = 0
    if dataset == "klines":
        records = []
        for row in csv_rows(blob):
            if not row or not row[0].strip().isdigit() or len(row) < 11:
                continue
            records.append((
                market, symbol, interval, int(float(row[0])),
                float(row[1]), float(row[2]), float(row[3]), float(row[4]),
                float(row[5]), int(float(row[6])), float(row[7]),
                int(float(row[8])), float(row[9]), float(row[10])
            ))
        start_ms = int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp() * 1000)
        with db:
            if force:
                db.execute(
                    """DELETE FROM candles WHERE market=? AND symbol=? AND interval=?
                       AND open_time>=? AND open_time<?""",
                    (market, symbol, interval, start_ms, month_end_ms(y, m))
                )
            db.executemany(
                "INSERT OR REPLACE INTO candles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                records
            )
        count = len(records)
    else:
        records = []
        for row in csv_rows(blob):
            if not row or not row[0].strip().isdigit() or len(row) < 7:
                continue
            records.append((
                market, symbol, int(float(row[0])), float(row[1]), float(row[2]),
                int(float(row[3])), int(float(row[4])), int(float(row[5])),
                1 if str(row[6]).strip().lower() == "true" else 0
            ))
        with db:
            if force:
                start_ms = int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp() * 1000)
                db.execute(
                    """DELETE FROM aggregate_trades WHERE market=? AND symbol=?
                       AND trade_time>=? AND trade_time<?""",
                    (market, symbol, start_ms, month_end_ms(y, m))
                )
            db.executemany(
                "INSERT OR REPLACE INTO aggregate_trades VALUES (?,?,?,?,?,?,?,?,?)",
                [(market,) + r for r in records]
            )
        count = len(records)

    with db:
        db.execute(
            """INSERT OR REPLACE INTO imports VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (dataset, market, symbol, interval, y, m, count, digest,
             "imported", datetime.now(timezone.utc).isoformat())
        )
    return count, "imported"

def main():
    parser = argparse.ArgumentParser(description="Build one BTC/LTC SQLite market database.")
    parser.add_argument("--output", default="market_history.sqlite")
    parser.add_argument("--symbols", default=DEFAULT_SYMBOLS)
    parser.add_argument("--start", default="2017-01", help="First month (YYYY-MM)")
    parser.add_argument("--end", default=datetime.now(timezone.utc).strftime("%Y-%m"),
                        help="Last month inclusive (YYYY-MM)")
    parser.add_argument("--trades", action="store_true",
                        help="Also download monthly aggregate trades; huge download.")
    parser.add_argument("--no-spot", action="store_true")
    parser.add_argument("--no-futures", action="store_true")
    parser.add_argument("--force", action="store_true", help="Re-import existing months.")
    args = parser.parse_args()

    sy, sm = map(int, args.start.split("-"))
    ey, em = map(int, args.end.split("-"))
    start, end = date(sy, sm, 1), date(ey, em, 1)
    if start > end:
        parser.error("--start must be <= --end")
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    if not symbols:
        parser.error("At least one symbol is required.")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(output)
    db.executescript(SCHEMA)
    with db:
        db.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)",
                   ("symbols", json.dumps(symbols)))
        db.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)",
                   ("date_range", f"{args.start} through {args.end}"))
        db.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)",
                   ("data_source", "Binance Public Data Vision"))
        db.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)",
                   ("updated_utc", datetime.now(timezone.utc).isoformat()))

    total_rows = 0
    jobs = []
    markets = []
    if not args.no_spot:
        markets.append("spot")
    if not args.no_futures:
        markets.append("futures/um")
    for symbol in symbols:
        for y, m in months_between(start, end):
            for market in markets:
                jobs.append(("klines", market, symbol, "1m", y, m))
            if args.trades and not args.no_spot:
                jobs.append(("aggTrades", "spot", symbol, "aggTrades", y, m))

    print(f"Database: {output.resolve()}")
    print(f"Symbols: {', '.join(symbols)} | jobs: {len(jobs)}")
    for i, job in enumerate(jobs, 1):
        dataset, market, symbol, interval, y, m = job
        try:
            rows, status = import_month(db, dataset, market, symbol, interval, y, m, args.force)
            total_rows += rows
            print(f"[{i}/{len(jobs)}] {symbol} {market} {dataset} {y}-{m:02d}: {status}, rows={rows}")
        except Exception as exc:
            print(f"[{i}/{len(jobs)}] ERROR {symbol} {market} {dataset} {y}-{m:02d}: {exc}")
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.close()
    print(f"Finished. Newly imported rows: {total_rows}")
    print("Output is one SQLite database. Larger timeframes can be aggregated from 1m candles.")
    print("Note: historical order-book depth, liquidations and all OI series are not included in these tables.")

if __name__ == "__main__":
    main()
