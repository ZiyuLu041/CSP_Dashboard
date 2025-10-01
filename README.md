# Multi-Ticker Crypto Live-Streaming Dashboard

Real-time cryptocurrency market monitoring system built with CSP (Continuous Stream Processing) and Perspective.js.

## Overview

This application streams live cryptocurrency trade data from Polygon.io, processes it in real-time using CSP's dynamic stream processing, and visualizes insights through an interactive web dashboard.

## Components

### 1. `csp_multi_ticker_websocket_parquet.py`
**CSP Backend Pipeline with Parquet Storage**
- Connects to Polygon.io WebSocket API for live crypto trades
- Dynamically processes multiple cryptocurrency pairs simultaneously (BTC, ETH, SOL, XRP, DOGE, etc.)
- Computes real-time statistics:
  - Volume-weighted averages (VWA)
  - Exponential moving averages (60s, 120s, 180s)
  - 1-minute returns
  - Rolling volatility (60s stddev + 5-min MA)
  - Buy/sell order flow analysis
  - Buy-side pressure ratio
- Publishes data via CSP's native WebSocket server on port 7678
- **Persists data to Parquet files**:
  - `parquet_data/crypto_trades.parquet` - Raw trade data
  - `parquet_data/crypto_statistics.parquet` - Computed statistics
  - 24-hour runtime for extended data collection
  - 24-hour reset cycle for statistics

**Usage:**
```bash
python csp_multi_ticker_websocket_parquet.py
```

### 1b. `csp_multi_ticker_websocket.py`
**CSP Backend Pipeline (In-Memory Only)**
- Same functionality as parquet version but without persistent storage
- Use for testing or when storage is not needed

### 2. `multi_ticker_dashboard.html`
**Frontend Dashboard UI**
- HTML structure for the interactive dashboard
- 9 coordinated visualization panels:
  - Live trades table
  - Statistics table
  - Trade count treemap
  - Volume distribution treemap
  - Return vs Volatility scatter plot
  - Buy/Sell pressure datagrid with bar charts
  - Price analysis line chart (multi-horizon EMAs)
  - Volatility monitoring chart (with 2σ bands)
- Ticker selection controls (quick buttons + dropdown)
- Light/Dark theme toggle

### 3. `multi_ticker_client.js`
**Frontend JavaScript Client**
- Perspective.js integration for GPU-accelerated rendering
- WebSocket client connecting to CSP backend
- Real-time data processing and visualization updates
- Interactive features:
  - Ticker selection (switches between crypto pairs)
  - Theme toggling
  - Connection status monitoring
  - Coordinated multi-view updates

### 4. `server.py`
**Flask Web Server**
- Serves the dashboard HTML and static files
- Runs on port 8096
- Routes:
  - `/` → Single-ticker dashboard
  - `/multi_ticker_dashboard.html` → Multi-ticker dashboard
  - `/<filename>` → Static files (JS, CSS, etc.)

**Usage:**
```bash
python server.py
```

### 5. `restart_dashboard.sh`
**Deployment Script**
- Stops existing dashboard processes on port 8096
- Starts Gunicorn production server
- Uses 2 workers for external access
- Logs output to `dashboard_nohup.out`

**Usage:**
```bash
bash restart_dashboard.sh
```

### 6. `check_parquet.py`
**Parquet Data Inspector**
- Reads and displays parquet file contents
- Useful for verifying data persistence

### 7. `save_parquet_to_excel.py`
**Data Export Tool**
- Converts parquet files to Excel format for analysis
- Exports first 1000 rows of statistics

## Quick Start

### Prerequisites
- Python 3.8+
- Polygon.io API key (for live data)
- Required packages: `csp`, `polygon`, `flask`, `gunicorn`

### Installation
```bash
# Install dependencies
pip install csp-adapter polygon-api-client flask gunicorn
```

### Running Locally

**Step 1: Start CSP Backend**
```bash
python csp_multi_ticker_websocket_parquet.py
```
- Listens on `ws://localhost:7678`
- Streams trades and statistics tables
- Saves data to `parquet_data/` directory

**Step 2: Start Web Server**
```bash
python server.py
```
- Dashboard available at `http://localhost:8096/multi_ticker_dashboard.html`

### Production Deployment
```bash
bash restart_dashboard.sh
```
- Accessible at `http://YOUR_SERVER_IP:8096/multi_ticker_dashboard.html`

## System Architecture

```
┌─────────────────┐
│  Polygon.io API │  (Live crypto trades)
└────────┬────────┘
         │ WebSocket
         ▼
┌──────────────────────────────────┐
│  CSP Pipeline (Port 7678)         │
│  • Dynamic demultiplexing         │
│  • Statistical computation        │
│  • WebSocket publishing           │
│  • Parquet data persistence       │
└────────┬─────────────────────────┘
         │ WebSocket       │ Parquet files
         │                 ▼
         │         ┌──────────────────┐
         │         │  parquet_data/   │
         │         │  • crypto_trades │
         │         │  • crypto_stats  │
         │         └──────────────────┘
         ▼
┌──────────────────────────┐
│  Perspective Dashboard    │
│  (Port 8096)              │
│  • 9 coordinated views    │
│  • Real-time updates      │
│  • Interactive controls   │
└──────────────────────────┘
```

## Key Features

### Real-Time Processing
- **Sub-second latency**: Polygon trade → CSP → Dashboard (< 500ms)
- **Dynamic scaling**: Automatically handles new trading pairs
- **Delta updates**: Minimizes bandwidth (50KB/s vs 500KB/s full snapshots)

### Quantitative Signals
- **Return-Volatility Analysis**: Identify mean-reversion opportunities
- **Order Flow Monitoring**: Detect buy/sell pressure imbalances
- **Volatility Regimes**: 2σ bands for risk management
- **Multi-Horizon EMAs**: Capture different trader behaviors

### Interactive Visualization
- **Cross-sectional views**: Scatter plots reveal relative value across pairs
- **Time-series analysis**: Line charts track individual asset dynamics
- **Market structure**: Treemaps show liquidity concentration
- **Customizable**: Ticker selection, filtering, theme preferences

## Configuration

### CSP Backend (`csp_multi_ticker_websocket_parquet.py`)
```python
API_KEY = "your_polygon_api_key"     # Line ~340
port = 7678                          # Line ~355
parquet_dir = "path/to/parquet_data" # Line 364
runtime = timedelta(hours=24)        # Line 364 (end = start + runtime)
reset_interval = timedelta(hours=24) # Line 238 (timer_reset)
```

### Frontend Client (`multi_ticker_client.js`)
```javascript
this.wsPort = 7678;  // Line 10
this.wsHost = `wss://your-domain.com`;  // Line 11
```

### Web Server (`server.py`)
```python
app.run(host='0.0.0.0', port=8096)  # Line 19
```

## Data Flow

1. **Input**: Polygon.io streams tick-level trades via WebSocket
2. **Processing**: CSP computes statistics every 1 second
3. **Output**:
   - CSP publishes to WebSocket tables (trades + statistics)
   - CSP writes to Parquet files for persistence
4. **Visualization**: Perspective consumes streams and renders updates
5. **User Interaction**: Ticker selection triggers chart re-filtering
6. **Storage**: Parquet files enable historical analysis and replay

## Performance

- **Throughput**: 500-1000 trades/second across 15+ pairs
- **Latency**: P50=320ms, P95=685ms (end-to-end)
- **Memory**: ~180MB baseline + 5MB per ticker
- **CPU**: 30-50% single core utilization

## Troubleshooting

### CSP Backend not connecting to Polygon
- Check API key validity in `csp_multi_ticker_websocket_parquet.py`
- Verify network connectivity to `wss://socket.polygon.io`

### Parquet files not being created
- Check write permissions for `parquet_data/` directory
- Verify CSP backend is running without errors
- Ensure sufficient disk space for data storage

### Dashboard shows "Connecting..." forever
- Ensure CSP backend is running on port 7678
- Check WebSocket URL in `multi_ticker_client.js`
- Verify firewall allows WebSocket connections

### No data appearing in charts
- Confirm trades are flowing (check CSP console output)
- Wait 60 seconds for statistics to compute (requires minimum window)
- Check browser console for JavaScript errors

## Project Structure

```
live_stream_visualization/
├── csp_multi_ticker_websocket_parquet.py  # CSP backend with Parquet storage
├── csp_multi_ticker_websocket.py          # CSP backend (in-memory only)
├── multi_ticker_dashboard.html            # Dashboard UI
├── multi_ticker_client.js                 # Frontend logic
├── server.py                              # Flask web server
├── restart_dashboard.sh                   # Deployment script
├── check_parquet.py                       # Parquet inspector
├── save_parquet_to_excel.py               # Excel export tool
├── parquet_data/                          # Persistent data storage
│   ├── crypto_trades.parquet              # Raw trades
│   └── crypto_statistics.parquet          # Computed stats
├── PAPER.md                               # Technical paper
└── README.md                              # This file
```


## Acknowledgments

- **CSP**: Point72's reactive stream processing framework
- **Polygon.io**: Real-time cryptocurrency market data
- **Perspective**: FINOS high-performance visualization library
