#!/usr/bin/env python3
"""Download Binance Spot BTCUSDT 1-minute historical klines.

Downloads official Binance Vision monthly ZIPs and current-month daily ZIPs,
verifies SHA256 when a checksum is published, and preserves original files.
No API key is required. Does not alter dashboard runtime code.
"""
from __future__ import annotations
import argparse, calendar, hashlib, json, time, urllib.error, urllib.request, zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BASE = "https://data.binance.vision/data/spot"
SYMBOL = "BTCUSDT"
INTERVAL = "1m"
UA = "TradingDashboardHistoricalData/1.0"

def fetch(url: str, target: Path, retries: int = 4) -> bool:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size:
        return True
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as response, target.open('wb') as f:
                while True:
                    chunk=response.read(1024*1024)
                    if not chunk: break
                    f.write(chunk)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                target.unlink(missing_ok=True)
                return False
            target.unlink(missing_ok=True)
            if attempt == retries-1: raise
        except Exception:
            target.unlink(missing_ok=True)
            if attempt == retries-1: raise
        time.sleep(2 ** attempt)
    return False

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()

def verify(zip_path: Path, checksum_path: Path) -> tuple[bool,str]:
    if not checksum_path.exists(): return True, "checksum-not-published"
    raw=checksum_path.read_text(errors='replace').strip().split()
    expected=raw[0] if raw else ''
    actual=sha256(zip_path)
    return (actual.lower()==expected.lower(), actual)

def month_iter(start: date, end_exclusive: date):
    y,m=start.year,start.month
    while (y,m) < (end_exclusive.year,end_exclusive.month):
        yield y,m
        m+=1
        if m==13: y,m=y+1,1

def main():
    p=argparse.ArgumentParser(description='Download official Binance BTCUSDT 1m history (2017-08 onward).')
    p.add_argument('--start',default='2017-08-17',help='UTC start date, YYYY-MM-DD')
    p.add_argument('--end',default=None,help='UTC end date inclusive; default yesterday UTC')
    p.add_argument('--out',default='data/backtest/binance/BTCUSDT/1m',help='Output directory')
    p.add_argument('--keep-zips',action='store_true',help='Keep downloaded ZIPs after extraction')
    args=p.parse_args()
    start=date.fromisoformat(args.start)
    end=date.fromisoformat(args.end) if args.end else datetime.now(timezone.utc).date()-timedelta(days=1)
    if end < start: p.error('--end must be on or after --start')
    out=Path(args.out)
    raw_dir=out/'raw'
    extracted=out/'csv'
    records=[]
    first_month=date(start.year,start.month,1)
    end_month_exclusive=date(end.year,end.month,1)+timedelta(days=32)
    end_month_exclusive=date(end_month_exclusive.year,end_month_exclusive.month,1)
    today=datetime.now(timezone.utc).date()
    current_month=date(today.year,today.month,1)

    # Complete historical months: official monthly archives.
    for y,m in month_iter(first_month, min(end_month_exclusive,current_month)):
        ym=f'{y:04d}-{m:02d}'
        name=f'{SYMBOL}-{INTERVAL}-{ym}.zip'
        folder=f'{BASE}/monthly/klines/{SYMBOL}/{INTERVAL}'
        zpath=raw_dir/'monthly'/name
        ok=fetch(f'{folder}/{name}',zpath)
        if not ok:
            print(f'SKIP (not published): {name}')
            continue
        cpath=zpath.with_suffix('.zip.CHECKSUM')
        fetch(f'{folder}/{name}.CHECKSUM',cpath)
        valid,digest=verify(zpath,cpath)
        if not valid: raise RuntimeError(f'SHA256 mismatch: {name}')
        with zipfile.ZipFile(zpath) as z: z.extractall(extracted/'monthly'/ym)
        records.append({'kind':'monthly','period':ym,'zip':str(zpath),'sha256':digest,'verified':cpath.exists()})
        print(f'OK monthly {ym}')
        if not args.keep_zips: zpath.unlink(missing_ok=True); cpath.unlink(missing_ok=True)

    # Current/incomplete month: official daily archives through requested end.
    daily_start=max(start,current_month)
    if daily_start <= end:
        day=daily_start
        while day <= end:
            ds=day.isoformat()
            name=f'{SYMBOL}-{INTERVAL}-{ds}.zip'
            folder=f'{BASE}/daily/klines/{SYMBOL}/{INTERVAL}'
            zpath=raw_dir/'daily'/name
            ok=fetch(f'{folder}/{name}',zpath)
            if not ok:
                print(f'SKIP (not published): {name}')
                day += timedelta(days=1); continue
            cpath=zpath.with_suffix('.zip.CHECKSUM')
            fetch(f'{folder}/{name}.CHECKSUM',cpath)
            valid,digest=verify(zpath,cpath)
            if not valid: raise RuntimeError(f'SHA256 mismatch: {name}')
            with zipfile.ZipFile(zpath) as z: z.extractall(extracted/'daily'/ds)
            records.append({'kind':'daily','period':ds,'zip':str(zpath),'sha256':digest,'verified':cpath.exists()})
            print(f'OK daily {ds}')
            if not args.keep_zips: zpath.unlink(missing_ok=True); cpath.unlink(missing_ok=True)
            day += timedelta(days=1)

    manifest={
      'symbol':SYMBOL,'market':'Binance Spot','interval':INTERVAL,
      'start_requested':start.isoformat(),'end_requested':end.isoformat(),
      'downloaded_at_utc':datetime.now(timezone.utc).isoformat(),
      'source':'https://data.binance.vision/data/spot/',
      'timestamp_note':'Binance Spot kline timestamps are milliseconds before 2025-01-01 and microseconds from 2025-01-01 onward; normalize before parsing.',
      'records':records,
      'status':'downloaded' if records else 'no-files-downloaded'
    }
    out.mkdir(parents=True,exist_ok=True)
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(f"Done: {len(records)} archive files recorded. Manifest: {out/'manifest.json'}")

if __name__=='__main__': main()
