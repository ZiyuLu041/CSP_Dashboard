#!/usr/bin/env python3
"""
CSP Multi-Ticker WebSocket Output Pipeline with Real Polygon Data + Parquet Storage
Uses csp.dynamic to handle multiple tickers dynamically
Saves trades and statistics to Parquet files for historical analysis
"""

import threading
import os
from datetime import datetime, timedelta
from typing import List
import csp
from csp import ts
from csp.adapters.websocket import WebsocketTableAdapter
from csp.adapters.parquet import ParquetWriter
from csp.adapters.output_adapters.parquet import ParquetOutputConfig
from csp.impl.pushadapter import PushInputAdapter
from csp.impl.wiring import py_push_adapter_def
from polygon import WebSocketClient
from polygon.websocket.models import WebSocketMessage, Feed, Market

# Define crypto trade data structure
class CryptoTradeData(csp.Struct):
    pair: str
    price: float
    size: float
    volume: float
    timestamp: float
    trade_time: datetime
    sellorbuy: int
    exchange: int

# Define crypto statistics data structure for each ticker
class TickerStatisticsData(csp.Struct):
    pair: str
    trade_count: float
    VWA: float  # Volume Weighted Average
    EWA60s: float  # Exponential Weighted Average 60s
    EWA120s: float  # Exponential Weighted Average 120s
    EWA180s: float  # Exponential Weighted Average 180s
    return_1min: float  # Price return over 1 min
    volitality_60s: float  # Volatility 60s
    volitality_MA5mins: float  # Volatility Moving Average 5mins
    volitality_stddev: float  # Volatility Standard Deviation
    sell_count: float
    buy_count: float
    buy_pressure: float  # Buy Side Pressure: buy_count / (buy_count + sell_count)
    volumn_60s: float  # Volume 60s sum
    timestamp: float
    trade_time: datetime

# ==================== POLYGON WEBSOCKET ADAPTER ====================

class PolygonWebSocketAdapter(PushInputAdapter):
    """WebSocket adapter for Polygon crypto live data"""

    def __init__(self, api_key: str, feed: str = "RealTime", market: str = "Crypto"):
        self._api_key = api_key
        self._feed = Feed.RealTime if feed == "RealTime" else Feed.Delayed
        self._market = Market.Crypto if market == "Crypto" else Market.Stocks
        self._client = None
        self._thread = None
        self._running = False

    def start(self, starttime, endtime):
        """Start Polygon WebSocket connection"""
        print(f"Polygon API key: {self._api_key[:10]}...")
        print(f"Feed: {self._feed}, Market: {self._market}")

        try:
            # Create Polygon WebSocket client
            self._client = WebSocketClient(
                api_key=self._api_key,
                feed=self._feed,
                market=self._market
            )

            # Subscribe to ALL crypto trade streams (not just BTC)
            subscription = f"XT.*"
            self._client.subscribe(subscription)
            print(f"Subscribed to {subscription}")

            self._running = True

            # Start in background thread
            def run_client():
                try:
                    print("Starting Polygon data stream...")
                    self._client.run(self._handle_messages)
                except Exception as e:
                    if self._running:
                        print(f"Polygon WebSocket Error: {e}")

            self._thread = threading.Thread(target=run_client, daemon=True)
            self._thread.start()

        except Exception as e:
            print(f"Polygon connection failed: {e}")
            self._running = False

    def stop(self):
        """Stop WebSocket connection"""
        print("Stopping Polygon WebSocket...")
        self._running = False
        if self._client:
            try:
                # For sync usage, we don't need to await
                if hasattr(self._client, 'disconnect'):
                    self._client.disconnect()
                else:
                    # Just set running to False and let the thread finish naturally
                    pass
            except Exception as e:
                print(f"Warning during client shutdown: {e}")
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def _handle_messages(self, msgs: List[WebSocketMessage]):
        """Handle incoming Polygon WebSocket messages"""
        if not self._running:
            return

        for message in msgs:
            try:
                self._process_message(message)
            except Exception as e:
                print(f"Message processing error: {e}")

    def _process_message(self, message: WebSocketMessage):
        """Process individual Polygon message and push to CSP"""
        try:
            # Convert message to dict for easier access
            msg_dict = message.dict() if hasattr(message, 'dict') else message.__dict__

            # Check if this is a crypto trade message (XT event)
            if msg_dict.get('event_type') == 'XT':
                timestamp_ms = float(msg_dict.get('timestamp'))
                trade_time = datetime.fromtimestamp(timestamp_ms / 1000.0)

                trade = CryptoTradeData(
                    pair=msg_dict.get('pair', 'UNKNOWN'),
                    price=float(msg_dict.get('price', 0.0)),
                    size=float(msg_dict.get('size', 0.0)),
                    volume=float(msg_dict.get('size')) * float(msg_dict.get('price')),
                    timestamp=timestamp_ms,
                    trade_time=trade_time,
                    sellorbuy=int(msg_dict.get('conditions', [0])[0]),
                    exchange=int(msg_dict.get('exchange', 0))
                )

                # Push to CSP pipeline
                self.push_tick(trade)

        except Exception as e:
            print(f"Trade processing error: {e}")

# Create CSP adapter
PolygonCsp = py_push_adapter_def(
    "PolygonCsp",
    PolygonWebSocketAdapter,
    csp.ts[CryptoTradeData],
    api_key=str, feed=str, market=str
)

# ==================== DYNAMIC STATISTICS PROCESSING ====================

@csp.node
def combine_ticker_statistics(
    pair: str,
    trade_count: csp.ts[float],
    VWA: csp.ts[float],
    EWA60s: csp.ts[float],
    EWA120s: csp.ts[float],
    EWA180s: csp.ts[float],
    return_1min: csp.ts[float],
    volitality_60s: csp.ts[float],
    volitality_MA5mins: csp.ts[float],
    volitality_stddev: csp.ts[float],
    sell_count: csp.ts[float],
    buy_count: csp.ts[float],
    buy_pressure: csp.ts[float],
    volumn_60s: csp.ts[float],
    latest_trade_time: csp.ts[datetime],
    trigger: csp.ts[bool]
) -> csp.ts[TickerStatisticsData]:
    """Combine all statistics into a single data structure for a ticker"""
    if csp.ticked(trigger):
        # Only create stats when we have all required values
        if (csp.valid(trade_count) and csp.valid(VWA) and csp.valid(EWA60s) and
            csp.valid(EWA120s) and csp.valid(EWA180s) and csp.valid(return_1min) and
            csp.valid(volitality_60s) and csp.valid(volitality_MA5mins) and
            csp.valid(volitality_stddev) and csp.valid(sell_count) and
            csp.valid(buy_count) and csp.valid(buy_pressure) and csp.valid(volumn_60s)):

            # Use latest trade time if available, otherwise fall back to current time
            if csp.valid(latest_trade_time):
                trade_time_to_use = latest_trade_time
                timestamp_to_use = latest_trade_time.timestamp()
            else:
                current_time = csp.now()
                trade_time_to_use = current_time
                timestamp_to_use = current_time.timestamp()

            stats_data = TickerStatisticsData(
                pair=pair,
                trade_count=trade_count,
                VWA=VWA,
                EWA60s=EWA60s,
                EWA120s=EWA120s,
                EWA180s=EWA180s,
                return_1min=return_1min,
                volitality_60s=volitality_60s,
                volitality_MA5mins=volitality_MA5mins,
                volitality_stddev=volitality_stddev,
                sell_count=sell_count,
                buy_count=buy_count,
                buy_pressure=buy_pressure,
                volumn_60s=volumn_60s,
                timestamp=timestamp_to_use,
                trade_time=trade_time_to_use
            )
            return stats_data

@csp.graph
def ticker_statistics_subgraph(
    pair: str,
    trades: csp.ts[CryptoTradeData],
    timer1s: csp.ts[bool],
    timer1m: csp.ts[bool]
) -> csp.ts[TickerStatisticsData]:
    """
    Sub-graph for processing statistics for a single ticker
    This will be dynamically instantiated for each unique pair
    """
    print(f"Creating statistics sub-graph for ticker: {pair}")
    
    timer1m = csp.timer(timedelta(minutes=1))
    timer_reset = csp.timer(timedelta(hours=24))
    # Calculate statistics for this ticker
    volumn = csp.math.multiply(trades.price, trades.size)
    trade_count = csp.stats.count(trades.price, interval=timedelta(seconds=60), min_window=timedelta(seconds=1), trigger=timer1s)

    # Filter sell/buy trades
    trades_sell = csp.filter(trades.sellorbuy == 1, trades)
    trades_buy = csp.filter(trades.sellorbuy == 2, trades)

    count_sell = csp.stats.sum(trades_sell.volume, interval=timedelta(seconds=60), min_window=timedelta(seconds=5), trigger=timer1s)
    count_buy = csp.stats.sum(trades_buy.volume, interval=timedelta(seconds=60), min_window=timedelta(seconds=5), trigger=timer1s)

    # Price analysis
    VWA = csp.stats.mean(trades.price, interval=100, min_window=1, weights=trades.size, trigger=timer1s,reset=timer_reset)
    EWA60s = csp.stats.ema(VWA, halflife=timedelta(seconds=60), trigger=timer1s,reset=timer_reset)
    EWA120s = csp.stats.ema(VWA, halflife=timedelta(seconds=120), trigger=timer1s,reset=timer_reset)
    EWA180s = csp.stats.ema(VWA, halflife=timedelta(seconds=180), trigger=timer1s,reset=timer_reset)

    # Volume analysis
    volumn_sum_1min = csp.stats.sum(trades.volume, interval=timedelta(seconds=60), min_window=timedelta(seconds=5), trigger=timer1s)

    # Return and volatility analysis
    diff_1min_ago = csp.diff(VWA, lag=timedelta(minutes=1))
    return_1min = csp.divide(diff_1min_ago, csp.add(VWA, diff_1min_ago))
    volitality_60s = csp.stats.stddev(return_1min, interval=timedelta(seconds=60), min_window=timedelta(seconds=1), trigger=timer1s)
    volitality_MA5mins = csp.stats.mean(volitality_60s, interval=timedelta(seconds=600), min_window=timedelta(seconds=1), trigger=timer1s)
    volitality_stddev = csp.stats.stddev(volitality_60s, interval=timedelta(seconds=600), min_window=timedelta(seconds=1), trigger=timer1s)

    # Calculate buy side pressure: buy_count / (buy_count + sell_count)
    total_count = csp.add(count_buy, count_sell)
    buy_pressure = csp.divide(count_buy, total_count)

    # Get latest trade time for statistics
    latest_trade_time = trades.trade_time

    # Combine statistics
    return combine_ticker_statistics(
        pair, trade_count, VWA, EWA60s, EWA120s, EWA180s,
        return_1min, volitality_60s, volitality_MA5mins, volitality_stddev,
        count_sell, count_buy, buy_pressure, volumn_sum_1min, latest_trade_time, timer1m
    )

# We need to publish individual statistics, so we'll use csp.unroll
# First convert the dict to a list of values
@csp.node
def dict_to_list(stats_dict: ts[{str: TickerStatisticsData}]) -> ts[[TickerStatisticsData]]:
    """Convert dictionary of statistics to list"""
    if csp.ticked(stats_dict):
        return list(stats_dict.values())

@csp.node
def trades_tracker(trades_all: ts[CryptoTradeData],timer: ts[bool]) -> ts[CryptoTradeData]:
    """Tracker of trades"""
    if csp.ticked(timer) and csp.valid(trades_all):
        return trades_all

@csp.graph
def crypto_multi_ticker_websocket_pipeline(port: int, trades_parquet_file: str=None, stats_parquet_file: str=None):
    """CSP pipeline using dynamic processing for multiple tickers with Parquet storage"""
    print("Building Multi-Ticker Crypto CSP pipeline with Dynamic processing + Parquet storage...")

    # Configuration
    API_KEY = "4hweaKRjg0NGhkf4YpbHrrn2_8V6AXdp"
    FEED = "RealTime"
    MARKET = "Crypto"

    # Timers
    timer1s = csp.timer(timedelta(seconds=1))
    timer1m = csp.timer(timedelta(minutes=1))

    # 1. Polygon WebSocket → CSP (All crypto data)
    trades_all = PolygonCsp(api_key=API_KEY, feed=FEED, market=MARKET)
    # This creates a snapshot of the trades at the end of each minute for visualization mointoring
    trades_flow = trades_tracker(trades_all, timer1m)
    
    # 2. Dynamic demultiplex trades by pair
    # This creates a dynamic basket where each key is a trading pair
    demuxed_trades = csp.dynamic_demultiplex(trades_all, trades_all.pair)

    # 3. Dynamic processing - create sub-graphs for each ticker
    dynamic_statistics = csp.dynamic(
        demuxed_trades,
        ticker_statistics_subgraph,
        csp.snap(trades_all.pair),
        csp.attach(),   # Pass the demuxed trades for this pair
        timer1s,        # This is the timer for the statistics calculation
        timer1m         # This is the timer for the statistics publication
    )
    # For dynamic statistics, use dynamic_collect to get all statistics
    collected_stats = csp.dynamic_collect(dynamic_statistics)
    stats_list = dict_to_list(collected_stats)
    individual_stats = csp.unroll(stats_list)
    ## Only publish statistics with volume greater than 1000 for visualization
    individual_stats_publish = csp.filter(individual_stats.volumn_60s > 1000, individual_stats)
    # 4. WebSocket/Parquet Output 
    adapter = WebsocketTableAdapter(port, delta_updates=True)
    trades_table = adapter.create_table("trades", index="timestamp")
    stats_table = adapter.create_table("statistics")
    # Write trades to Parquet
    trades_writer = ParquetWriter(
        file_name=trades_parquet_file,
        timestamp_column_name="csp_timestamp",
        config=ParquetOutputConfig(allow_overwrite=True)
    )
    # Write statistics to Parquet
    stats_writer = ParquetWriter(
        file_name=stats_parquet_file,
        timestamp_column_name="csp_timestamp",
        config=ParquetOutputConfig(allow_overwrite=True)
    )
    trades_table.publish(trades_flow)
    stats_table.publish(individual_stats_publish)
    trades_writer.publish_struct(trades_flow)
    stats_writer.publish_struct(individual_stats) # save all statistics to parquet without filtering

def main():
    import argparse

    port = 7678
    print(f"Starting CSP Multi-Ticker WebSocket + Parquet pipeline")
    print(f"All crypto pairs → CSP dynamic processing → WebSocket + Parquet")
    print(f"WebSocket Server: http://localhost:{port}")
    print(f"Tables endpoint: http://localhost:{port}/tables")
    print(f"Using CSP dynamic processing for multiple tickers")

    start = datetime.now()
    end = start + timedelta(hours=24)
    
    # Generate filenames for parquet files
    parquet_dir = "/home/ziyulu1997/live_stream_visualization/parquet_data"
    os.makedirs(parquet_dir, exist_ok=True)
    trades_parquet_file = os.path.join(parquet_dir, f"crypto_trades.parquet")
    stats_parquet_file = os.path.join(parquet_dir, f"crypto_statistics.parquet")

    try:
        csp.run(
            crypto_multi_ticker_websocket_pipeline,
            port,
            starttime=start,
            endtime=end,
            realtime=True,
            trades_parquet_file=trades_parquet_file,
            stats_parquet_file=stats_parquet_file
        )
    except KeyboardInterrupt:
        print("\nPipeline stopped by user (Ctrl+C)")
    except Exception as e:
        print(f"Pipeline failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()