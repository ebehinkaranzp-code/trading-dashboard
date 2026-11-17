# Strategy signal archive data

`btc.csv` and `eth.csv` are the daily USD reference-price archives distributed with the `crypto-strategy-backtest` research repository.

- Original source: Coin Metrics Community data archive (https://github.com/coinmetrics/data)
- License: CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)
- Columns: `date,close`; daily UTC reference close.
- The dashboard uses this archive as the historical walk-forward training base and appends completed daily spot candles from public exchange APIs after the archive's last date. Historical archive values are not overwritten.
- The source data is provided for research/non-commercial use with attribution. It is not an execution-price guarantee.
