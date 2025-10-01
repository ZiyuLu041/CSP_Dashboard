// Live Trading Dashboard Client
// Connects to CSP Native WebSocket tables and visualizes trades and statistics

import perspective from "https://cdn.jsdelivr.net/npm/@finos/perspective/dist/cdn/perspective.js";

class LiveTradingDashboard {
    constructor() {
        this.worker = null;
        this.tables = {};
        this.viewers = {};
        this.websockets = {};
        this.tradeCount = 0;
        this.lastUpdate = null;
        this.currentTheme = "Pro Light";

        // Update frequency controls (in milliseconds)
        this.treemapUpdateInterval = 5000; // Update treemaps every 5 seconds
        this.lastTreemapUpdate = 0;

        this.init();
    }

    async init() {
        console.log("Initializing Live Trading Dashboard...");

        // Set light theme immediately
        document.body.classList.add("light-theme");
        const themeToggle = document.getElementById("theme-toggle");
        if (themeToggle) {
            themeToggle.textContent = "Dark";
        }

        // Initialize Perspective worker
        this.worker = await perspective.worker();
        console.log("Perspective worker initialized");

        // Setup tables and viewers
        await this.setupTables();
        await this.setupViewers();

        // Start status updates
        this.updateStatus();

        // Connect to WebSocket tables
        setTimeout(() => this.connectWebSockets(), 500);
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


        // Statistics table schema with new technical indicators
        const statisticsSchema = {
            pair: "string",
            trade_count: "float",
            VWA: "float",         // Volume Weighted Average
            EWA60s: "float",      // Exponential Weighted Average 60s
            EWA120s: "float",     // Exponential Weighted Average 120s
            EWA180s: "float",     // Exponential Weighted Average 180s
            return_1min: "float",  // Price return over 1 min
            volitality_60s: "float",    // Volatility 60s
            volitality_MA5mins: "float", // Volatility Moving Average 5mins
            volitality_stddev: "float",  // Volatility Standard Deviation
            vol_upper_1sigma: "float",   // MA + 1σ
            vol_lower_1sigma: "float",   // MA - 1σ
            vol_upper_2sigma: "float",   // MA + 2σ
            vol_lower_2sigma: "float",   // MA - 2σ
            sell_count: "float",
            buy_count: "float",
            volumn_60s: "float",  // Volume data from CSP
            timestamp: "float",
            trade_time: "datetime"
        };

        // Create tables with row limits for performance
        this.tables.trades = await this.worker.table(tradesSchema, {
            limit: 1000  // Keep latest 1000 trades
        });

        this.tables.statistics = await this.worker.table(statisticsSchema, {
            limit: 100   // Keep latest 100 statistics records
        });


        console.log("Tables created successfully");
    }

    async setupViewers() {
        console.log("Configuring Perspective viewers...");

        // Get viewer elements
        this.viewers.tradesTable = document.getElementById("trades-table");
        this.viewers.statisticsTable = document.getElementById("statistics-table");
        this.viewers.sizeTreemap = document.getElementById("size-treemap");
        this.viewers.volumeTreemap = document.getElementById("volume-treemap");
        this.viewers.priceChart = document.getElementById("price-chart");
        this.viewers.volumeChart = document.getElementById("volume-chart");
        this.viewers.ewaChart = document.getElementById("ewa-chart");
        this.viewers.riskChart = document.getElementById("risk-chart");

        // Load tables into viewers
        await this.viewers.tradesTable.load(this.tables.trades);
        await this.viewers.statisticsTable.load(this.tables.statistics);
        await this.viewers.sizeTreemap.load(this.tables.trades);
        await this.viewers.volumeTreemap.load(this.tables.trades);
        await this.viewers.priceChart.load(this.tables.statistics); // Use statistics for OHLC data
        await this.viewers.volumeChart.load(this.tables.statistics);
        await this.viewers.ewaChart.load(this.tables.statistics);    // EWA analysis chart
        await this.viewers.riskChart.load(this.tables.statistics);   // Risk analysis chart

        // Configure trades table view
        await this.viewers.tradesTable.restore({
            plugin: "Datagrid",
            columns: ["pair", "price", "size", "volume", "trade_time", "sellorbuy", "exchange"],
            sort: [["trade_time", "desc"]],
            plugin_config: {
                editable: false,
                scroll_lock: true
            },
            theme: this.currentTheme
        });

        // Configure statistics table view with new technical indicators
        await this.viewers.statisticsTable.restore({
            plugin: "Datagrid",
            columns: ["trade_count", "VWA", "EWA60s", "EWA120s", "EWA180s", "return_1min",
                     "volitality_60s", "volitality_MA5mins", "sell_count", "buy_count", "volumn_60s", "trade_time"],
            sort: [["trade_time", "desc"]],
            plugin_config: {
                editable: false,
                scroll_lock: true
            },
            theme: this.currentTheme
        });

        // Configure price chart as candlestick using VWA data
        await this.viewers.priceChart.restore({
            plugin: "Candlestick",
            columns: ["VWA"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            theme: this.currentTheme
        });

        // Configure sell/buy volume chart using statistics data
        await this.viewers.volumeChart.restore({
            plugin: "Y Bar",
            columns: ["sell_count", "buy_count"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            plugin_config: {
                stacked: true
            },
            theme: this.currentTheme
        });

        // Configure EWA analysis chart - four lines with split main values
        await this.viewers.ewaChart.restore({
            plugin: "Y Line",
            columns: ["VWA", "EWA60s", "EWA120s", "EWA180s"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
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

        // Configure Volatility analysis chart with outlier detection bands
        await this.viewers.riskChart.restore({
            plugin: "Y Line",
            columns: ["volitality_60s", "volitality_MA5mins", "vol_upper_1sigma", "vol_lower_1sigma", "vol_upper_2sigma", "vol_lower_2sigma"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            plugin_config: {
                series: {
                    volitality_60s: { color: "#1f77b4", lineWidth: 2 },
                    volitality_MA5mins: { color: "#ff7f0e", lineWidth: 2 },
                    vol_upper_1sigma: { color: "#2ca02c", lineWidth: 1, lineStyle: "dashed" },
                    vol_lower_1sigma: { color: "#2ca02c", lineWidth: 1, lineStyle: "dashed" },
                    vol_upper_2sigma: { color: "#d62728", lineWidth: 1, lineStyle: "dotted" },
                    vol_lower_2sigma: { color: "#d62728", lineWidth: 1, lineStyle: "dotted" }
                }
            },
            theme: this.currentTheme
        });

        // Configure size distribution treemap
        await this.viewers.sizeTreemap.restore({
            plugin: "Treemap",
            columns: ["size", "pair"],
            group_by: ["pair"],
            color: ["pair"],
            aggregates: {
                size: "sum",
                pair: "any"
            },
            theme: this.currentTheme
        });

        // Configure volume distribution treemap
        await this.viewers.volumeTreemap.restore({
            plugin: "Treemap",
            columns: ["volume", "pair"],
            group_by: ["pair"],
            color: ["pair"],
            aggregates: {
                volume: "sum",
                pair: "any"
            },
            theme: this.currentTheme
        });

        // Setup theme toggle
        this.setupThemeToggle();

        // Setup frequency controls
        this.setupFrequencyControls();

        console.log("Viewers configured successfully");
    }

    setupThemeToggle() {
        const themeToggle = document.getElementById("theme-toggle");
        if (themeToggle) {
            themeToggle.addEventListener("click", () => {
                this.toggleTheme();
            });
        }
    }

    setupFrequencyControls() {
        const treemapFreqSelect = document.getElementById("treemap-freq");

        if (treemapFreqSelect) {
            treemapFreqSelect.addEventListener("change", (e) => {
                this.treemapUpdateInterval = parseInt(e.target.value);
                console.log(`Treemap update frequency changed to: ${this.treemapUpdateInterval}ms`);
            });
        }
    }

    async toggleTheme() {
        // Toggle between themes
        this.currentTheme = this.currentTheme === "Pro Dark" ? "Pro Light" : "Pro Dark";
        const isLightTheme = this.currentTheme === "Pro Light";

        // Update global body class for background
        document.body.classList.toggle("light-theme", isLightTheme);

        // Update button text
        const themeToggle = document.getElementById("theme-toggle");
        if (themeToggle) {
            themeToggle.textContent = isLightTheme ? "Dark" : "Light";
        }

        // Update all viewers with their configurations and new theme
        await this.viewers.tradesTable.restore({
            plugin: "Datagrid",
            columns: ["pair", "price", "size", "volume", "trade_time", "sellorbuy", "exchange"],
            sort: [["trade_time", "desc"]],
            theme: this.currentTheme
        });
        await this.viewers.statisticsTable.restore({
            plugin: "Datagrid",
            columns: ["trade_count", "VWA", "EWA60s", "EWA120s", "EWA180s", "return_1min", "volitality_60s", "volitality_MA5mins", "sell_count", "buy_count", "volumn_60s", "trade_time"],
            sort: [["trade_time", "desc"]],
            theme: this.currentTheme
        });
        await this.viewers.priceChart.restore({
            plugin: "Candlestick",
            columns: ["VWA"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            theme: this.currentTheme
        });
        await this.viewers.volumeChart.restore({
            plugin: "Y Bar",
            columns: ["sell_count", "buy_count"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            plugin_config: {
                stacked: true
            },
            theme: this.currentTheme
        });
        await this.viewers.ewaChart.restore({
            plugin: "Y Line",
            columns: ["VWA", "EWA60s", "EWA120s", "EWA180s"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
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
        await this.viewers.riskChart.restore({
            plugin: "Y Line",
            columns: ["volitality_60s", "volitality_MA5mins", "vol_upper_1sigma", "vol_lower_1sigma", "vol_upper_2sigma", "vol_lower_2sigma"],
            group_by: ["trade_time"],
            sort: [["trade_time", "asc"]],
            plugin_config: {
                series: {
                    volitality_60s: { color: "#1f77b4", lineWidth: 2 },
                    volitality_MA5mins: { color: "#ff7f0e", lineWidth: 2 },
                    vol_upper_1sigma: { color: "#2ca02c", lineWidth: 1, lineStyle: "dashed" },
                    vol_lower_1sigma: { color: "#2ca02c", lineWidth: 1, lineStyle: "dashed" },
                    vol_upper_2sigma: { color: "#d62728", lineWidth: 1, lineStyle: "dotted" },
                    vol_lower_2sigma: { color: "#d62728", lineWidth: 1, lineStyle: "dotted" }
                }
            },
            theme: this.currentTheme
        });
        await this.viewers.sizeTreemap.restore({
            plugin: "Treemap",
            columns: ["size", "pair"],
            group_by: ["pair"],
            color: ["pair"],
            aggregates: {
                size: "sum",
                pair: "any"
            },
            theme: this.currentTheme
        });
        await this.viewers.volumeTreemap.restore({
            plugin: "Treemap",
            columns: ["volume", "pair"],
            group_by: ["pair"],
            color: ["pair"],
            aggregates: {
                volume: "sum",
                pair: "any"
            },
            theme: this.currentTheme
        });

        console.log(`Theme switched to: ${this.currentTheme}`);
    }

    connectWebSockets() {
        console.log("Connecting to CSP WebSocket tables...");

        // Connect to trades WebSocket
        this.connectTradesWebSocket();

        // Connect to statistics WebSocket
        this.connectStatisticsWebSocket();
    }

    connectTradesWebSocket() {
        const wsUrl = "wss://zyl-csp-streaming.duckdns.org/subscribe/trades";
        console.log(`🔄 Attempting to connect to trades WebSocket: ${wsUrl}`);

        try {
            this.websockets.trades = new WebSocket(wsUrl);
            console.log(`📡 WebSocket object created for trades, readyState: ${this.websockets.trades.readyState}`);

            this.websockets.trades.onopen = (event) => {
                console.log("✅ Trades WebSocket connected successfully!", event);
                console.log(`📊 Trades WebSocket readyState: ${this.websockets.trades.readyState}`);
                this.updateConnectionStatus("trades-status", "Connected", "#00d4aa");
            };

            this.websockets.trades.onmessage = (event) => {
                console.log(`📨 Received trades message, length: ${event.data.length}`);
                try {
                    const data = JSON.parse(event.data);
                    console.log(`📊 Parsed trades data:`, data);
                    this.handleTradesData(data);
                } catch (error) {
                    console.error("❌ Error parsing trades WebSocket message:", error);
                    console.error("📄 Raw message:", event.data);
                }
            };

            this.websockets.trades.onclose = (event) => {
                console.log(`🔌 Trades WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
                console.log(`📊 Final readyState: ${this.websockets.trades.readyState}`);
                this.updateConnectionStatus("trades-status", "Reconnecting", "#ff9500");

                setTimeout(() => {
                    if (this.websockets.trades.readyState === WebSocket.CLOSED) {
                        console.log("🔄 Attempting to reconnect trades WebSocket...");
                        this.connectTradesWebSocket();
                    }
                }, 2000);
            };

            this.websockets.trades.onerror = (error) => {
                console.error("❌ Trades WebSocket error:", error);
                console.error(`📊 WebSocket readyState during error: ${this.websockets.trades.readyState}`);
                this.updateConnectionStatus("trades-status", "Error", "#ff6b6b");
            };

            // Log readyState changes
            setTimeout(() => {
                console.log(`📊 Trades WebSocket readyState after 1s: ${this.websockets.trades.readyState}`);
            }, 1000);

        } catch (error) {
            console.error("❌ Failed to create trades WebSocket:", error);
            this.updateConnectionStatus("trades-status", "Error", "#ff6b6b");
        }
    }

    connectStatisticsWebSocket() {
        const wsUrl = "wss://zyl-csp-streaming.duckdns.org/subscribe/statistics";
        console.log(`🔄 Attempting to connect to statistics WebSocket: ${wsUrl}`);

        try {
            this.websockets.statistics = new WebSocket(wsUrl);
            console.log(`📡 WebSocket object created for statistics, readyState: ${this.websockets.statistics.readyState}`);

            this.websockets.statistics.onopen = (event) => {
                console.log("✅ Statistics WebSocket connected successfully!", event);
                console.log(`📊 Statistics WebSocket readyState: ${this.websockets.statistics.readyState}`);
                this.updateConnectionStatus("stats-status", "Connected", "#00d4aa");
            };

            this.websockets.statistics.onmessage = (event) => {
                console.log(`📨 Received statistics message, length: ${event.data.length}`);
                try {
                    const data = JSON.parse(event.data);
                    console.log(`📊 Parsed statistics data:`, data);
                    this.handleStatisticsData(data);
                } catch (error) {
                    console.error("❌ Error parsing statistics WebSocket message:", error);
                    console.error("📄 Raw message:", event.data);
                }
            };

            this.websockets.statistics.onclose = (event) => {
                console.log(`🔌 Statistics WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
                console.log(`📊 Final readyState: ${this.websockets.statistics.readyState}`);
                this.updateConnectionStatus("stats-status", "Reconnecting", "#ff9500");

                setTimeout(() => {
                    if (this.websockets.statistics.readyState === WebSocket.CLOSED) {
                        console.log("🔄 Attempting to reconnect statistics WebSocket...");
                        this.connectStatisticsWebSocket();
                    }
                }, 2000);
            };

            this.websockets.statistics.onerror = (error) => {
                console.error("❌ Statistics WebSocket error:", error);
                console.error(`📊 WebSocket readyState during error: ${this.websockets.statistics.readyState}`);
                this.updateConnectionStatus("stats-status", "Error", "#ff6b6b");
            };

            // Log readyState changes
            setTimeout(() => {
                console.log(`📊 Statistics WebSocket readyState after 1s: ${this.websockets.statistics.readyState}`);
            }, 1000);

        } catch (error) {
            console.error("❌ Failed to create statistics WebSocket:", error);
            this.updateConnectionStatus("stats-status", "Error", "#ff6b6b");
        }
    }

    async handleTradesData(data) {
        if (data && data.data && Array.isArray(data.data)) {
            // Handle CSP native WebSocket table format - accept any message type
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

            if (tradesData.length > 0) {
                console.log(`New trades batch: ${tradesData.length} trades, latest: ${tradesData[tradesData.length-1].pair} @ $${tradesData[tradesData.length-1].price}`);

                // Update trades table immediately (no delay)
                await this.tables.trades.update(tradesData);

                // Update counters
                this.lastUpdate = new Date();
            }
        } else {
            console.log("Unhandled trades message format:", data);
        }
    }

    async handleStatisticsData(data) {
        if (data && data.data && Array.isArray(data.data)) {
            // Handle CSP native WebSocket table format - accept any message type
            const statisticsData = [];

            for (const stats of data.data) {
                // Calculate volatility bands for outlier detection
                const vol_ma = parseFloat(stats.volitality_MA5mins) || 0;
                const vol_std = parseFloat(stats.volitality_stddev) || 0;

                const statsData = {
                    pair: stats.pair || "BTC-USD",
                    trade_count: parseFloat(stats.trade_count) || 0,
                    VWA: parseFloat(stats.VWA) || 0,                 // Volume Weighted Average
                    EWA60s: parseFloat(stats.EWA60s) || 0,           // Exponential Weighted Average 60s
                    EWA120s: parseFloat(stats.EWA120s) || 0,         // Exponential Weighted Average 120s
                    EWA180s: parseFloat(stats.EWA180s) || 0,         // Exponential Weighted Average 180s
                    return_1min: parseFloat(stats.return_1min) || 0,    // Price return over 1 min
                    volitality_60s: parseFloat(stats.volitality_60s) || 0,        // Volatility 60s
                    volitality_MA5mins: vol_ma,                      // Volatility Moving Average 5mins
                    volitality_stddev: vol_std,                      // Volatility Standard Deviation
                    // Calculate volatility bands
                    vol_upper_1sigma: vol_ma + vol_std,              // MA + 1σ
                    vol_lower_1sigma: vol_ma - vol_std,              // MA - 1σ
                    vol_upper_2sigma: vol_ma + 2 * vol_std,          // MA + 2σ
                    vol_lower_2sigma: vol_ma - 2 * vol_std,          // MA - 2σ
                    sell_count: parseFloat(stats.sell_count) || 0,
                    buy_count: parseFloat(stats.buy_count) || 0,
                    volumn_60s: parseFloat(stats.volumn_60s) || 0,  // Volume data from CSP
                    timestamp: parseFloat(stats.timestamp) || Date.now(),
                    trade_time: new Date(parseFloat(stats.trade_time) * 1000) // Convert to milliseconds
                };

                statisticsData.push(statsData);
            }

            if (statisticsData.length > 0) {
                const latest = statisticsData[statisticsData.length-1];
                console.log(`New statistics: trades=${latest.trade_count}, VWA=$${latest.VWA.toFixed(2)}, EWA60s=$${latest.EWA60s.toFixed(2)}, volatility=${latest.volitality_60s.toFixed(4)}`);

                // Update statistics table
                await this.tables.statistics.update(statisticsData);
            }
        } else {
            console.log("Unhandled statistics message format:", data);
        }
    }


    updateConnectionStatus(elementId, status, color) {
        const statusElement = document.getElementById(elementId);
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.style.color = color;
        }
    }

    // Method to configure treemap update frequency
    setTreemapFrequency(treemapIntervalMs = 5000) {
        this.treemapUpdateInterval = treemapIntervalMs;
        console.log(`Treemap update frequency set: ${treemapIntervalMs}ms`);
    }

    updateStatus() {
        // Update status bar periodically
        setInterval(() => {
            const tradeCountElement = document.getElementById("trade-count");
            const lastUpdateElement = document.getElementById("last-update");

            if (tradeCountElement) {
                tradeCountElement.textContent = this.tradeCount.toLocaleString();
            }

            if (lastUpdateElement && this.lastUpdate) {
                const timeDiff = Math.floor((Date.now() - this.lastUpdate.getTime()) / 1000);
                lastUpdateElement.textContent = timeDiff < 60 ? `${timeDiff}s ago` : `${Math.floor(timeDiff/60)}m ago`;
            }
        }, 1000);
    }
}

// Multiple initialization strategies for stability
function initializeDashboard() {
    console.log("Starting Live Trading Dashboard");

    // Ensure we only initialize once
    if (window.liveTradingDashboardInstance) {
        console.log("Dashboard already initialized, skipping...");
        return;
    }

    window.liveTradingDashboardInstance = new LiveTradingDashboard();
}

// Try multiple initialization approaches
if (document.readyState === 'loading') {
    // Still loading, wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initializeDashboard);
} else {
    // Already loaded, initialize immediately
    initializeDashboard();
}

// Fallback: initialize after a short delay regardless
setTimeout(() => {
    if (!window.liveTradingDashboardInstance) {
        console.log("Fallback initialization...");
        initializeDashboard();
    }
}, 1000);

// Export for potential external use
window.LiveTradingDashboard = LiveTradingDashboard;

// Debug function - you can call this in browser console
window.testWebSocketConnection = function() {
    console.log("🔧 Testing WebSocket connection manually...");

    const testTradesWS = new WebSocket("wss://zyl-csp-streaming.duckdns.org/subscribe/trades");

    testTradesWS.onopen = function(event) {
        console.log("✅ Manual test: Trades WebSocket connected!", event);
    };

    testTradesWS.onmessage = function(event) {
        console.log("📨 Manual test: Received message", event.data.substring(0, 200) + "...");
    };

    testTradesWS.onclose = function(event) {
        console.log(`🔌 Manual test: Connection closed. Code: ${event.code}, Reason: ${event.reason}`);
    };

    testTradesWS.onerror = function(error) {
        console.error("❌ Manual test: WebSocket error", error);
    };

    // Close after 5 seconds
    setTimeout(() => {
        console.log("🔧 Closing manual test connection...");
        testTradesWS.close();
    }, 5000);

    return testTradesWS;
};