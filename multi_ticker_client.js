/**
 * Multi-Ticker Crypto Dashboard Client
 * Connects to CSP multi-ticker WebSocket pipeline and handles multiple trading pairs
 */

import perspective from "https://cdn.jsdelivr.net/npm/@finos/perspective/dist/cdn/perspective.js";

class MultiTickerDashboardClient {
    constructor() {
        this.wsPort = 7678; // Multi-ticker port
        this.wsHost = `wss://zyl-csp-streaming.duckdns.org`;
        this.connections = new Map();
        this.viewers = {};
        this.worker = null;
        this.tables = {};
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        this.reconnectTimer = null;
        this.currentTheme = 'Pro Light';

        // Data tracking
        this.tradeCount = 0;
        this.activePairs = new Set();
        this.lastUpdate = null;
        this.statsCount = 0; // Track statistics updates
        this.statisticsPairs = new Set(); // Track pairs with statistics data
        this.selectedTicker = 'BTC-USD'; // Default ticker for charts

        // Treemap refresh control - disabled for real-time updates
        this.treemapRefreshInterval = 0; // Disabled - real-time updates
        this.treemapTimer = null;

        this.init();
    }

    async init() {
        console.log("Initializing Multi-Ticker Dashboard...");

        // Set light theme immediately
        document.body.classList.add("light-theme");
        const themeToggle = document.getElementById("theme-toggle");
        if (themeToggle) {
            themeToggle.textContent = "Dark";
        }

        // Initialize Perspective worker with retry logic
        this.worker = await this.initializeWorkerWithRetry();
        console.log("Perspective worker initialized");

        // Setup tables and viewers
        await this.setupTables();
        await this.initializeViewers();

        // Add a small delay and test CSP server first
        setTimeout(() => {
            this.testCSPServer();
        }, 1000);

        setTimeout(() => this.connectToWebSockets(), 500);
        this.setupEventHandlers();
        // this.startTreemapRefresh(); // Disabled - treemaps update in real-time
    }

    async initializeWorkerWithRetry(maxRetries = 5, initialDelay = 100) {
        /**
         * Initialize Perspective worker with exponential backoff retry logic
         * Handles WASM loading race conditions on page refresh
         */
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                console.log(`Attempting to initialize Perspective worker (attempt ${attempt + 1}/${maxRetries})...`);
                const worker = await perspective.worker();
                console.log("✅ Perspective worker initialized successfully");
                return worker;
            } catch (error) {
                const delay = initialDelay * Math.pow(2, attempt); // Exponential backoff
                console.warn(`⚠️ Worker initialization failed (attempt ${attempt + 1}/${maxRetries}):`, error.message);

                if (attempt < maxRetries - 1) {
                    console.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error("❌ Failed to initialize Perspective worker after all retries");
                    throw new Error(`Perspective worker initialization failed: ${error.message}`);
                }
            }
        }
    }

    async setupTables() {
        console.log("Setting up Perspective tables...");

        // Trades table schema (based on CSP output)
        const tradesSchema = {
            pair: "string",
            price: "float",
            size: "float",
            volume: "float",
            timestamp: "float",
            trade_time: "datetime",
            sellorbuy: "integer",
            exchange: "integer"
        };

        // Statistics table schema
        const statisticsSchema = {
            pair: "string",
            trade_count: "float",
            VWA: "float",
            EWA60s: "float",
            EWA120s: "float",
            EWA180s: "float",
            return_1min: "float",
            volitality_60s: "float",
            volitality_MA5mins: "float",
            volitality_stddev: "float",
            sell_count: "float",
            buy_count: "float",
            volumn_60s: "float",
            timestamp: "float",
            trade_time: "datetime",
            // Calculated fields for new charts
            buy_pressure: "float",
            return_upper_band: "float",
            return_lower_band: "float",
            vol_upper_2sigma: "float",
        };

        // Create tables with row limits for performance
        this.tables.trades = await this.worker.table(tradesSchema, {
            limit: 1000  // Keep latest 1000 trades
        });

        this.tables.statistics = await this.worker.table(statisticsSchema);
        // No limit on statistics table to show complete historical data

        console.log("Tables created successfully");
    }

    async initializeViewers() {
        console.log('Initializing Perspective viewers for multi-ticker dashboard...');

        // Get viewer elements
        this.viewers = {
            tradesTable: document.getElementById('trades-table'),
            statisticsTable: document.getElementById('statistics-table'),
            sizeTreemap: document.getElementById('size-treemap'),
            volumeTreemap: document.getElementById('volume-treemap'),
            highestReturnsChart: document.getElementById('highest-returns-chart'),
            lowestReturnsChart: document.getElementById('lowest-returns-chart'),
            buyPressureChart: document.getElementById('buy-pressure-chart'),
            priceChart: document.getElementById('price-chart'),
            volatilityChart: document.getElementById('volatility-chart')
        };

        // Verify all viewers exist
        for (const [name, viewer] of Object.entries(this.viewers)) {
            if (!viewer) {
                console.error(`❌ Viewer not found: ${name}`);
                return;
            }
        }

        // Load tables into viewers
        await this.viewers.tradesTable.load(this.tables.trades);
        await this.viewers.statisticsTable.load(this.tables.statistics);
        await this.viewers.sizeTreemap.load(this.tables.statistics);
        await this.viewers.volumeTreemap.load(this.tables.statistics);
        await this.viewers.highestReturnsChart.load(this.tables.statistics);
        await this.viewers.lowestReturnsChart.load(this.tables.statistics);
        await this.viewers.buyPressureChart.load(this.tables.statistics);
        await this.viewers.priceChart.load(this.tables.statistics);
        await this.viewers.volatilityChart.load(this.tables.statistics);

        // Configure trades table view
        await this.viewers.tradesTable.restore({
            plugin: "Datagrid",
            columns: ["pair", "price", "size", "volume", "trade_time", "sellorbuy", "exchange"],
            sort: [["trade_time", "desc"]],
            theme: this.currentTheme
        });

        // Configure size distribution treemap (using trade_count from statistics)
        await this.viewers.sizeTreemap.restore({
            plugin: "Treemap",
            columns: ["trade_count", "pair"],
            group_by: ["pair"],
            color: ["pair"],
            aggregates: {
                trade_count: "last",
                pair: "any"
            },
            theme: this.currentTheme
        });

        // Configure volume distribution treemap (using volumn_60s from statistics)
        await this.viewers.volumeTreemap.restore({
            plugin: "Treemap",
            columns: ["volumn_60s", "pair"],
            group_by: ["pair"],
            color: ["pair"],
            aggregates: {
                volumn_60s: "last",
                pair: "any"
            },
            theme: this.currentTheme
        });

        // Configure statistics table view
        await this.viewers.statisticsTable.restore({
            plugin: "Datagrid",
            columns: ["trade_time", "pair", "trade_count", "VWA", "EWA60s", "EWA120s", "EWA180s", "return_1min", "volitality_60s", "volitality_MA5mins", "volitality_stddev", "sell_count", "buy_count", "volumn_60s"],
            sort: [["trade_time", "desc"]],
            columns_config: {
                volitality_60s: {
                    number_format: {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 8
                    }
                },
                    return_1min: {
                        number_format: {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 8
                        }
                },
                 volitality_MA5mins: {
                    number_format: {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 8
                    }
            },
            volitality_stddev: {
                number_format: {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 8
                }
            },
                
            },
            theme: this.currentTheme
        });

        // Configure Return vs Volatility scatter plot - sized by volume, colored by return
        await this.viewers.highestReturnsChart.restore({
            plugin: "X/Y Scatter",
            columns: ["volitality_60s", "return_1min", null, "volumn_60s"],
            columns_config: {
                return_1min: {
                    number_format: {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 8
                    }
                }   
                },
            group_by: ["pair"],
            filter: [["volumn_60s", ">", 10000],  ["volitality_60s","<=",0.02]],
            color: ["return_1min"],
            size: ["volumn_60s"],
            aggregates: {
                volitality_60s: "last",
                return_1min: "last",
                pair: "any",
                volumn_60s: "last"
            },
            theme: this.currentTheme
        });

        // Hide the lowest returns chart since we merged them
        await this.viewers.lowestReturnsChart.restore({
            plugin: "X Bar",
            columns: [],
            theme: this.currentTheme
        });

        // Configure Buy Side Pressure datagrid with bar charts
        await this.viewers.buyPressureChart.restore({
            plugin: "Datagrid",
            columns: ["sell_count", "buy_count", "buy_pressure", "volumn_60s"],
            group_by: ["pair"],
            sort: [["volumn_60s", "desc"]],
            filter: [],
            aggregates: {
                sell_count: "last",
                buy_count: "last",
                buy_pressure: "last",
                volumn_60s: "last"
            },
            plugin_config: {
                columns: {},
                edit_mode: "READ_ONLY",
                scroll_lock: false
            },
            columns_config: {
                buy_count: {
                    number_fg_mode: "bar",
                    fg_gradient: 346001.22
                },
                sell_count: {
                    number_fg_mode: "bar",
                    fg_gradient: 292761.28
                }
            },
            theme: this.currentTheme
        });

        // Configure Price Analysis chart - using trade_time (now converted from Unix timestamp)
        await this.viewers.priceChart.restore({
            plugin: "Y Line",
            columns: ["VWA", "EWA60s", "EWA120s", "EWA180s"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            filter: [["pair", "==", "BTC-USD"]],
            aggregates: {
                VWA: "last",
                EWA60s: "last",
                EWA120s: "last",
                EWA180s: "last"
            },
            plugin_config: {
                legend: {
                    enabled: true,
                    position: "right",
                    layout: "column"
                },
                series: {
                    VWA: { color: "#1f77b4" },
                    EWA60s: { color: "#ff7f0e" },
                    EWA120s: { color: "#2ca02c" },
                    EWA180s: { color: "#d62728" }
                },
                splitMainValues: [
                    "EWA180s",
                    "EWA120s"
                ]
            },
            theme: this.currentTheme
        });

        // Configure Volatility Analysis chart - using trade_time (now converted from Unix timestamp)
        await this.viewers.volatilityChart.restore({
            plugin: "Y Line",
            columns: ["volitality_60s", "volitality_MA5mins", "vol_upper_2sigma"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            filter: [["pair", "==", "BTC-USD"]],
            aggregates: {
                volitality_60s: "last",
                volitality_MA5mins: "last",
                vol_upper_2sigma: "last"
            },
            plugin_config: {
                legend: {
                    enabled: true,
                    position: "right",
                    layout: "column"
                },
                series: {
                    volitality_60s: { color: "#1f77b4", lineWidth: 2 },
                    volitality_MA5mins: { color: "#ff7f0e", lineWidth: 2 },
                    vol_upper_2sigma: { color: "#d62728", lineWidth: 1, lineStyle: "dashed" }
                }
            },
            theme: this.currentTheme
        });

        // Set initial theme
        await this.applyTheme(this.currentTheme);

        console.log('✅ All viewers initialized for multi-ticker dashboard');
    }

    connectToWebSockets() {
        console.log(`Connecting to multi-ticker WebSocket at ${this.wsHost}...`);

        // Close existing connections first
        this.disconnect();

        // Connect to trades table
        this.connectTradesWebSocket();

        // Connect to statistics table
        this.connectStatisticsWebSocket();
    }

    connectTradesWebSocket() {
        const wsUrl = `${this.wsHost}/subscribe/trades`;
        console.log(`🔄 Connecting to trades WebSocket: ${wsUrl}`);

        try {
            this.connections.set('trades', new WebSocket(wsUrl));
            const ws = this.connections.get('trades');

            ws.onopen = (event) => {
                console.log("✅ Trades WebSocket connected successfully!");
                console.log("🔍 WebSocket readyState:", ws.readyState);
                console.log("🔍 WebSocket protocol:", ws.protocol);
                console.log("🔍 WebSocket extensions:", ws.extensions);
                console.log("🔍 WebSocket URL:", ws.url);
                this.updateConnectionStatus('trades', 'Connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
            };

            ws.onmessage = (event) => {
                console.log("📨 RAW trades message received!");
                console.log("🔍 Message length:", event.data.length);
                console.log("🔍 Message type:", typeof event.data);
                console.log("🔍 First 200 chars:", event.data.substring(0, 200));

                try {
                    const data = JSON.parse(event.data);
                    console.log(`📊 Parsed trades data:`, data);
                    console.log(`📊 Message type: ${data.messageType}, Records: ${data.data ? data.data.length : 'N/A'}`);
                    this.handleTradesData(data);
                } catch (error) {
                    console.error("❌ Error parsing trades WebSocket message:", error);
                    console.error("📄 Raw message:", event.data);
                }
            };

            ws.onclose = (event) => {
                console.log(`🔌 Trades WebSocket closed. Code: ${event.code}, Reason: '${event.reason}'`);
                console.log("🔍 Was clean:", event.wasClean);
                console.log("🔍 Final readyState:", ws.readyState);
                console.log("🔍 Close event details:", event);

                this.updateConnectionStatus('trades', 'Disconnected');
                this.connections.delete('trades');

                if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts}...`);
                    setTimeout(() => {
                        console.log("🔄 Reconnecting trades WebSocket...");
                        this.connectTradesWebSocket();
                    }, 2000);
                }
            };

            ws.onerror = (error) => {
                console.error("❌ Trades WebSocket error:", error);
                console.error("🔍 Error readyState:", ws.readyState);
                console.error("🔍 Error event details:", error);
                this.updateConnectionStatus('trades', 'Error');
            };

        } catch (error) {
            console.error("❌ Failed to create trades WebSocket:", error);
            this.updateConnectionStatus('trades', 'Error');
        }
    }

    connectStatisticsWebSocket() {
        const wsUrl = `${this.wsHost}/subscribe/statistics`;
        console.log(`🔄 Connecting to statistics WebSocket: ${wsUrl}`);

        try {
            this.connections.set('statistics', new WebSocket(wsUrl));
            const ws = this.connections.get('statistics');

            ws.onopen = (event) => {
                console.log("✅ Statistics WebSocket connected successfully!");
                console.log("🔍 Stats WebSocket readyState:", ws.readyState);
                console.log("🔍 Stats WebSocket protocol:", ws.protocol);
                console.log("🔍 Stats WebSocket URL:", ws.url);
                this.updateConnectionStatus('statistics', 'Connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log(`📨 Received statistics message:`, data);
                    this.handleStatisticsData(data);
                } catch (error) {
                    console.error("❌ Error parsing statistics WebSocket message:", error);
                }
            };

            ws.onclose = (event) => {
                console.log(`🔌 Statistics WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
                this.updateConnectionStatus('statistics', 'Disconnected');
                this.connections.delete('statistics');

                if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    setTimeout(() => {
                        console.log("🔄 Reconnecting statistics WebSocket...");
                        this.connectStatisticsWebSocket();
                    }, 2000);
                }
            };

            ws.onerror = (error) => {
                console.error("❌ Statistics WebSocket error:", error);
                this.updateConnectionStatus('statistics', 'Error');
            };

        } catch (error) {
            console.error("❌ Failed to create statistics WebSocket:", error);
            this.updateConnectionStatus('statistics', 'Error');
        }
    }


    async handleTradesData(data) {
        if (data && data.data && Array.isArray(data.data)) {
            // Handle CSP native WebSocket table format
            const tradesData = [];

            for (const trade of data.data) {
                const tradeData = {
                    pair: trade.pair || "BTC-USD",
                    price: parseFloat(trade.price) || 0,
                    size: parseFloat(trade.size) || 0,
                    volume: parseFloat(trade.volume) || 0,
                    timestamp: parseFloat(trade.timestamp) || Date.now(),
                    trade_time: new Date(parseFloat(trade.trade_time) * 1000), // Convert to milliseconds
                    sellorbuy: parseInt(trade.sellorbuy) || 0,
                    exchange: parseInt(trade.exchange) || 0
                };

                tradesData.push(tradeData);
                this.tradeCount++;
            }

            // Track active pairs
            tradesData.forEach(trade => {
                if (trade.pair) {
                    this.activePairs.add(trade.pair);
                }
            });

            if (tradesData.length > 0) {
                console.log(`New trades batch: ${tradesData.length} trades`);

                // Update trades table using Perspective worker
                await this.tables.trades.update(tradesData);

                // Update counters
                this.updateTradeCount();
                this.updateActivePairs();
                this.updateLastUpdateTime();
            }
        } else {
            console.log("Unhandled trades message format:", data);
        }
    }

    async handleStatisticsData(data) {
        if (data && data.data && Array.isArray(data.data)) {
            // Handle CSP native WebSocket table format
            const statisticsData = [];

            for (const stats of data.data) {

                const buyCount = parseFloat(stats.buy_count) || 0;
                const sellCount = parseFloat(stats.sell_count) || 0;
                const returnValue = parseFloat(stats.return_1min) || 0;
                const volatility = parseFloat(stats.volitality_60s) || 0;
                const volatilityMA = parseFloat(stats.volitality_MA5mins) || 0;
                const volatilityStddev = parseFloat(stats.volitality_stddev) || 0;

                // Debug: Check trade_time conversion
                const convertedTradeTime = new Date(parseFloat(stats.trade_time) * 1000);
                console.log(`Stats trade_time: ${stats.trade_time} -> ${convertedTradeTime}`);

                const statsData = {
                    pair: stats.pair || "BTC-USD",
                    trade_count: parseFloat(stats.trade_count) || 0,
                    VWA: parseFloat(stats.VWA) || 0,
                    EWA60s: parseFloat(stats.EWA60s) || 0,
                    EWA120s: parseFloat(stats.EWA120s) || 0,
                    EWA180s: parseFloat(stats.EWA180s) || 0,
                    return_1min: returnValue,
                    volitality_60s: volatility,
                    volitality_MA5mins: parseFloat(stats.volitality_MA5mins) || 0,
                    volitality_stddev: parseFloat(stats.volitality_stddev) || 0,
                    sell_count: sellCount,
                    buy_count: buyCount,
                    buy_pressure: parseFloat(stats.buy_pressure) || 0,  // Use CSP-calculated buy pressure
                    volumn_60s: parseFloat(stats.volumn_60s) || 0,
                    timestamp: parseFloat(stats.timestamp) || Date.now(),
                    // Convert Unix timestamp float to proper Date object (CSP datetime becomes float)
                    trade_time: convertedTradeTime, // Use the pre-converted Date object
                    // Calculated fields for new charts
                    return_upper_band: returnValue + volatility,
                    return_lower_band: returnValue - volatility,
                    // Volatility bands: MA ± 2 * stddev
                    vol_upper_2sigma: volatilityMA + 2 * volatilityStddev,
                };


                statisticsData.push(statsData);
            }

            // Track active pairs and statistics pairs
            statisticsData.forEach(stat => {
                if (stat.pair) {
                    this.activePairs.add(stat.pair);
                    this.statisticsPairs.add(stat.pair);
                }
            });

            if (statisticsData.length > 0) {
                console.log(`New statistics batch: ${statisticsData.length} records`);
                console.log(`Statistics pairs in this batch:`, statisticsData.map(s => s.pair));

                // Debug: Check a sample record's trade_time
                const sampleRecord = statisticsData[0];
                console.log(`Sample statistics record trade_time:`, sampleRecord.trade_time, 'Type:', typeof sampleRecord.trade_time);

                // Check if BTC-USD is in the data
                const btcData = statisticsData.find(s => s.pair.includes('BTC'));
                if (btcData) {
                    console.log(`Found BTC data:`, btcData);
                }

                // Update statistics table using Perspective worker
                await this.tables.statistics.update(statisticsData);

                // Update UI counters
                this.updateActivePairs();
                this.updateStatisticsTitle();
                this.updateLastUpdateTime();
            }
        } else {
            console.log("Unhandled statistics message format:", data);
        }
    }



    async refreshTreemaps() {
        // Note: This method is now disabled since treemaps update in real-time
        // All treemap configurations are done during initialization
        console.log('Treemap refresh disabled - using real-time updates');
        return;
    }

    startTreemapRefresh() {
        // Treemap refresh is disabled - using real-time updates
        console.log('🔄 Treemap refresh disabled - using real-time updates via statistics table');
        return;
    }

    stopTreemapRefresh() {
        if (this.treemapTimer) {
            clearInterval(this.treemapTimer);
            this.treemapTimer = null;
        }
    }

    setupEventHandlers() {
        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        // Ticker button clicks
        const tickerButtons = document.querySelectorAll('.ticker-button');
        tickerButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const ticker = e.target.dataset.ticker;
                this.selectTicker(ticker);
            });
        });

        // Ticker dropdown selection
        const tickerSelect = document.getElementById('ticker-select');
        if (tickerSelect) {
            tickerSelect.addEventListener('change', (e) => {
                this.selectTicker(e.target.value);
            });
        }

        // Handle page visibility for performance
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden');
            } else {
                console.log('Page visible');
            }
        });
    }

    selectTicker(ticker) {
        this.selectedTicker = ticker;

        // Update button states
        document.querySelectorAll('.ticker-button').forEach(button => {
            if (button.dataset.ticker === ticker) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        // Update dropdown value
        const tickerSelect = document.getElementById('ticker-select');
        if (tickerSelect) {
            tickerSelect.value = ticker;
        }

        // Update charts
        this.updateChartFilters();
        console.log(`📊 Chart ticker changed to: ${this.selectedTicker}`);
    }

    async toggleTheme() {
        const newTheme = this.currentTheme === 'Pro Dark' ? 'Pro Light' : 'Pro Dark';
        await this.applyTheme(newTheme);

        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.textContent = newTheme === 'Pro Dark' ? 'Dark' : 'Light';
        }
    }

    async applyTheme(themeName) {
        this.currentTheme = themeName;
        document.body.className = themeName === 'Pro Light' ? 'light-theme' : '';

        // Apply theme to all viewers
        for (const viewer of Object.values(this.viewers)) {
            if (viewer && typeof viewer.restore === 'function') {
                try {
                    const config = await viewer.save();
                    config.theme = themeName;
                    await viewer.restore(config);
                } catch (error) {
                    // Viewer might not be initialized yet, skip silently
                }
            }
        }
    }

    updateConnectionStatus(tableName, status) {
        const statusMap = {
            'trades': 'trades-status',
            'statistics': 'stats-status'
        };

        const element = document.getElementById(statusMap[tableName]);
        if (element) {
            element.textContent = status;
            element.className = 'status-value ' + (status === 'Connected' ? 'connected' : 'disconnected');
        }
    }

    updateTradeCount() {
        const element = document.getElementById('trade-count');
        if (element) {
            element.textContent = this.tradeCount.toLocaleString();
        }
    }

    updateActivePairs() {
        const element = document.getElementById('active-pairs');
        if (element) {
            element.textContent = this.activePairs.size;
        }
    }

    updateStatisticsTitle() {
        // Update the statistics table header to show ticker count
        const headers = document.querySelectorAll('.viewer-header');
        headers.forEach(header => {
            if (header.textContent.includes('Real-time Statistics')) {
                const baseTitle = 'Real-time Statistics - All Pairs';
                const count = this.statisticsPairs.size;
                header.textContent = `${baseTitle} (${count} tickers)`;
            }
        });
    }

    async updateChartFilters() {
        // Update price chart filter - using trade_time (now converted from Unix timestamp)
        await this.viewers.priceChart.restore({
            plugin: "Y Line",
            columns: ["VWA", "EWA60s", "EWA120s", "EWA180s"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            filter: [["pair", "==", this.selectedTicker]],
            aggregates: {
                VWA: "last",
                EWA60s: "last",
                EWA120s: "last",
                EWA180s: "last"
            },
            plugin_config: {
                legend: {
                    enabled: true,
                    position: "right",
                    layout: "column"
                },
                series: {
                    VWA: { color: "#1f77b4" },
                    EWA60s: { color: "#ff7f0e" },
                    EWA120s: { color: "#2ca02c" },
                    EWA180s: { color: "#d62728" }
                },
                splitMainValues: [
                    "EWA180s",
                    "EWA120s"
                ]
            },
            theme: this.currentTheme
        });

        // Update volatility chart filter - using trade_time (now converted from Unix timestamp)
        await this.viewers.volatilityChart.restore({
            plugin: "Y Line",
            columns: ["volitality_60s", "volitality_MA5mins", "vol_upper_2sigma"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            filter: [["pair", "==", this.selectedTicker]],
            aggregates: {
                volitality_60s: "last",
                volitality_MA5mins: "last",
                vol_upper_2sigma: "last"
            },
            plugin_config: {
                legend: {
                    enabled: true,
                    position: "right",
                    layout: "column"
                },
                series: {
                    volitality_60s: { color: "#1f77b4", lineWidth: 2 },
                    volitality_MA5mins: { color: "#ff7f0e", lineWidth: 2 },
                    vol_upper_2sigma: { color: "#d62728", lineWidth: 1, lineStyle: "dashed" }
                }
            },
            theme: this.currentTheme
        });
    }

    updateLastUpdateTime() {
        this.lastUpdate = new Date();
        const element = document.getElementById('last-update');
        if (element) {
            element.textContent = this.lastUpdate.toLocaleTimeString();
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Max reconnection attempts reached');
            return;
        }

        // Prevent multiple concurrent reconnection attempts
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

        this.reconnectTimer = setTimeout(() => {
            console.log(`🔄 Reconnect attempt ${this.reconnectAttempts}...`);
            this.reconnectTimer = null;
            this.connectToWebSockets();
        }, delay);
    }

    disconnect() {
        console.log('🔌 Disconnecting from multi-ticker WebSocket...');
        this.stopTreemapRefresh();

        // Clear reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Close all connections
        for (const [tableName, ws] of this.connections) {
            if (ws) {
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close(1000, 'Manual disconnect'); // Normal closure
                }
            }
        }

        this.connections.clear();
        this.isConnected = false;
        this.reconnectAttempts = 0;
    }

    // Test CSP server endpoints
    async testCSPServer() {
        console.log("🧪 Testing CSP server endpoints...");

        try {
            // Test /tables endpoint
            const response = await fetch('https://zyl-csp-streaming.duckdns.org/tables');
            if (response.ok) {
                const data = await response.json();
                console.log("CSP server /tables endpoint working:", data);
                console.log("Available tables:", data.tables.map(t => t.name));
                console.log("WebSocket endpoints:", data.tables.map(t => t.sub));
            } else {
                console.error("CSP server /tables endpoint failed:", response.status);
            }
        } catch (error) {
            console.error("Failed to connect to CSP server:", error);
        }

        // Test direct WebSocket creation (minimal)
        console.log("🧪 Testing minimal WebSocket connection...");
        try {
            const testWs = new WebSocket('wss://zyl-csp-streaming.duckdns.org/subscribe/trades');

            testWs.onopen = () => {
                console.log("Minimal test WebSocket connected!");
                console.log("Test readyState:", testWs.readyState);

                // DON'T close immediately, wait for data
                console.log("⏱️ Waiting for initial data...");
            };

            testWs.onmessage = (event) => {
                console.log("Test message received!");
                console.log("Message length:", event.data.length);
                console.log("First 200 chars:", event.data.substring(0, 200));

                try {
                    const parsed = JSON.parse(event.data);
                    console.log("Message type:", parsed.messageType);
                    console.log("Data length:", parsed.data ? parsed.data.length : 'N/A');
                } catch (e) {
                    console.log("Failed to parse message");
                }

                // Close after first message
                setTimeout(() => {
                    testWs.close(1000, 'Test complete after message');
                }, 100);
            };

            testWs.onclose = (event) => {
                console.log(`Test WebSocket closed: code=${event.code}, reason='${event.reason}'`);
            };

            testWs.onerror = (error) => {
                console.error("Test WebSocket error:", error);
            };

        } catch (error) {
            console.error("Failed to create test WebSocket:", error);
        }
    }
}

// Initialize the multi-ticker dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('Starting Multi-Ticker Crypto Dashboard...');
    window.multiTickerDashboard = new MultiTickerDashboardClient();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.multiTickerDashboard) {
        window.multiTickerDashboard.disconnect();
    }
});