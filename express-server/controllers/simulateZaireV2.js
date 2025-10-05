const { getDateStringIND, getGrowwChartData, processGrowwData } = require("../../kite/utils");
const { Simulator } = require("../../simulator/SimulatorV3");
const { scanZaireStocks, getDateRange } = require("../../analytics");
const { readSheetData } = require("../../gsheets");

/**
 * Configuration constants for the simulation
 */
class SimulationConfig {
    static RISK_AMOUNT = 200;
    static BATCH_SIZE = 2;
    static JOB_CLEANUP_TIME_MS = 5 * 60 * 1000; // 5 minutes
    static DEFAULT_INTERVAL = '5m';
    static INTERVAL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    // Market timings (UTC)
    static MARKET_START_HOUR = 3;
    static MARKET_START_MINUTE = 50;
    static MARKET_END_HOUR = 9;
    static MARKET_END_MINUTE = 5;

    // Trigger padding based on price ranges
    static TRIGGER_PADDING_RANGES = [
        { maxPrice: 20, padding: 0.1 },
        { maxPrice: 50, padding: 0.2 },
        { maxPrice: 100, padding: 0.3 },
        { maxPrice: 300, padding: 0.5 },
        { maxPrice: Infinity, padding: 1 }
    ];

    // Market holidays for 2025
    static MARKET_HOLIDAYS = [
        { day: 18, month: 4 },  // April 18, 2025
        { day: 14, month: 4 },  // April 14, 2025
        { day: 10, month: 4 },  // April 10, 2025
        { day: 1, month: 5 },   // May 01, 2025
        { day: 15, month: 8 },  // August 15, 2025
        { day: 27, month: 8 },  // August 27, 2025
        { day: 2, month: 10 },  // October 2, 2025
        { day: 21, month: 10 },  // October 21, 2025
        { day: 22, month: 10 },  // October 22, 2025
        { day: 5, month: 11 },  // November 5, 2025
        { day: 25, month: 12 },  // December 25, 2025
    ];
}

/**
 * Manages simulation jobs - storage, status tracking, and cleanup
 */
class JobManager {
    constructor() {
        this.jobs = new Map();
    }

    /**
     * Creates a new simulation job
     * @returns {string} Unique job ID
     */
    createJob(startdate) {
        const jobId = Date.now().toString();
        this.jobs.set(jobId, {
            status: 'running',
            startTime: new Date(),
            currentDate: startdate,
            result: null,
            error: null
        });
        return jobId;
    }

    /**
     * Updates the current date being processed in a job
     */
    updateJobProgress(jobId, currentDate) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.currentDate = currentDate;
        }
    }

    /**
     * Marks a job as completed with results
     */
    completeJob(jobId, result) {
        const job = this.jobs.get(jobId);
        if (job) {
            this.jobs.set(jobId, {
                status: 'completed',
                currentDate: null,
                startTime: job.startTime,
                result,
                error: null
            });
        }
    }

    /**
     * Marks a job as failed with error message
     */
    failJob(jobId, errorMessage) {
        this.jobs.set(jobId, {
            status: 'error',
            currentDate: null,
            result: null,
            error: errorMessage
        });
    }

    /**
     * Gets job status by ID
     */
    getJob(jobId) {
        return this.jobs.get(jobId);
    }

    /**
     * Schedules cleanup of a completed or failed job
     */
    scheduleCleanup(jobId) {
        setTimeout(() => {
            this.jobs.delete(jobId);
        }, SimulationConfig.JOB_CLEANUP_TIME_MS);
    }
}

/**
 * Handles date iteration and market holiday checks
 */
class DateManager {
    /**
     * Checks if the market is closed on given date
     */
    static isMarketClosed(date) {
        const day = date.getDate();
        const month = date.getMonth() + 1;
        return SimulationConfig.MARKET_HOLIDAYS.some(
            h => h.day === day && h.month === month
        );
    }

    /**
     * Checks if date falls on weekend
     */
    static isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    /**
     * Moves date to next trading day, skipping weekends and holidays
     */
    static getNextTradingDay(date) {
        const nextDate = new Date(date);
        
        // Skip if market is closed
        if (this.isMarketClosed(nextDate)) {
            nextDate.setDate(nextDate.getDate() + 1);
        }

        // Skip weekends
        if (this.isWeekend(nextDate)) {
            const daysToAdd = nextDate.getDay() === 0 ? 1 : 2;
            nextDate.setDate(nextDate.getDate() + daysToAdd);
        }

        // Check again if Monday is a holiday
        if (this.isMarketClosed(nextDate)) {
            nextDate.setDate(nextDate.getDate() + 1);
        }

        return nextDate;
    }

    /**
     * Creates market start time for a given date
     */
    static getMarketStartTime(date) {
        const startTime = new Date(date);
        startTime.setUTCHours(
            SimulationConfig.MARKET_START_HOUR,
            SimulationConfig.MARKET_START_MINUTE,
            20,
            0
        );
        return startTime;
    }

    /**
     * Creates market end time for a given date
     */
    static getMarketEndTime(date) {
        const endTime = new Date(date);
        endTime.setUTCHours(
            SimulationConfig.MARKET_END_HOUR,
            SimulationConfig.MARKET_END_MINUTE,
            10,
            0
        );
        return endTime;
    }

    /**
     * Advances time by the configured interval
     */
    static advanceTime(date) {
        return new Date(date.getTime() + SimulationConfig.INTERVAL_MS);
    }
}

/**
 * Handles stock processing and trade execution
 */
class StockProcessor {
    /**
     * Calculates trigger padding based on stock price
     */
    static calculateTriggerPadding(price) {
        const range = SimulationConfig.TRIGGER_PADDING_RANGES.find(
            r => price < r.maxPrice
        );
        return range ? range.padding : 1;
    }

    /**
     * Calculates trade prices (trigger, target, stop loss)
     */
    static calculateTradePrices(stock, simulation, triggerPadding) {
        const { high, low, direction } = stock;
        const [targetMultiplier, stopLossMultiplier] = simulation.targetStopLossRatio
            .split(':')
            .map(Number);
        
        const candleLength = high - low;
        let triggerPrice, targetPrice, stopLossPrice;

        if (direction === 'BULLISH') {
            triggerPrice = high + triggerPadding;
            stopLossPrice = low - (candleLength * (stopLossMultiplier - 1)) - triggerPadding;
            targetPrice = high + (candleLength * targetMultiplier) + triggerPadding;
        } else {
            triggerPrice = low - triggerPadding;
            stopLossPrice = high + (candleLength * (stopLossMultiplier - 1)) + triggerPadding;
            targetPrice = low - (candleLength * targetMultiplier) - triggerPadding;
        }

        return {
            triggerPrice: Math.round(triggerPrice * 10) / 10,
            stopLossPrice: Math.round(stopLossPrice * 10) / 10,
            targetPrice: Math.round(targetPrice * 10) / 10
        };
    }

    /**
     * Calculates quantity based on risk amount
     */
    static calculateQuantity(triggerPrice, stopLossPrice) {
        const quantity = Math.ceil(
            SimulationConfig.RISK_AMOUNT / Math.abs(triggerPrice - stopLossPrice)
        );
        return Math.abs(quantity);
    }

    /**
     * Fetches historical data for a stock
     */
    static async fetchStockData(symbol, startTime) {
        const { endDate } = getDateRange(startTime);
        endDate.setUTCHours(11, 0, 0, 0);
        
        const startDate = new Date(endDate);
        startDate.setUTCHours(3, 0, 0, 0);

        let data = await getGrowwChartData(symbol, startDate, endDate, 1, true);
        return processGrowwData(data);
    }

    /**
     * Processes a single stock and runs simulation
     */
    static async processStock(stock, simulation, dayStartTime, singleDate) {
        const yahooData = await this.fetchStockData(stock.sym, dayStartTime);
        const triggerPadding = this.calculateTriggerPadding(stock.high);
        
        const { triggerPrice, targetPrice, stopLossPrice } = this.calculateTradePrices(
            stock,
            simulation,
            triggerPadding
        );
        
        const quantity = this.calculateQuantity(triggerPrice, stopLossPrice);

        const sim = new Simulator({
            stockSymbol: stock.sym,
            triggerPrice,
            targetPrice,
            stopLossPrice,
            quantity,
            direction: stock.direction,
            yahooData,
            orderTime: dayStartTime,
            cancelInMins: simulation.cancelInMins,
            updateSL: simulation.updateSL,
            updateSLInterval: simulation.updateSLInterval,
            updateSLFrequency: simulation.updateSLFrequency,
            marketOrder: simulation.marketOrder,
            enableDoubleConfirmation: simulation.enableDoubleConfirmation,
            doubleConfirmationLookbackHours: simulation.doubleConfirmationLookbackHours
        });

        sim.run();

        if (singleDate || sim.startedAt) {
            return {
                startedAt: sim.startedAt,
                placedAt: sim.orderTime,
                pnl: sim.pnl || 0,
                quantity: sim.quantity,
                direction: sim.direction,
                sym: sim.stockSymbol,
                data: yahooData,
                actions: sim.tradeActions,
                exitTime: sim.exitTime || null,
                triggerPrice,
                targetPrice,
                stopLossPrice
            };
        }

        return null;
    }

    /**
     * Processes multiple stocks with batching to control concurrency
     */
    static async processStocksBatch(stocks, simulation, dayStartTime, singleDate) {
        const activePromises = new Set();
        const results = [];

        for (const stock of stocks) {
            const promise = this.processStock(stock, simulation, dayStartTime, singleDate);

            activePromises.add(promise);

            promise.then(result => {
                activePromises.delete(promise);
                if (result !== null) {
                    results.push(result);
                }
            });

            // Control concurrency
            if (activePromises.size >= SimulationConfig.BATCH_SIZE) {
                await Promise.race(activePromises);
            }
        }

        await Promise.all(activePromises);
        return results;
    }
}

/**
 * Filters trades based on re-entry settings
 */
class TradeFilter {
    /**
     * Filters trades to prevent duplicate positions
     */
    static filterTrades(trades, simulation, singleDate) {
        if (simulation.reEnterPosition) {
            return this.filterWithReEntry(trades, singleDate);
        } else {
            return this.filterWithoutReEntry(trades);
        }
    }

    /**
     * Filter allowing re-entry into positions
     */
    static filterWithReEntry(trades, singleDate) {
        return trades.filter(trade => {
            // Show cancelled trades for single day simulations
            if (singleDate && !trade.pnl) {
                return true;
            }

            // Remove trades started before an active trade in the same symbol
            const hasConflict = trades.some(otherTrade => {
                const isEarlierTrade = 
                    otherTrade.startedAt < trade.startedAt ||
                    +otherTrade.placedAt < +trade.placedAt;
                
                const isSameSymbol = trade.sym === otherTrade.sym;
                const isOverlapping = +otherTrade.placedAt < +trade.exitTime;

                return isEarlierTrade && isSameSymbol && isOverlapping;
            });

            return !hasConflict;
        });
    }

    /**
     * Filter preventing re-entry into positions
     */
    static filterWithoutReEntry(trades) {
        return trades.filter(trade => {
            const hasEarlierTrade = trades.some(otherTrade => {
                const isEarlier =
                    otherTrade.startedAt < trade.startedAt ||
                    +otherTrade.placedAt < +trade.placedAt;
                
                const isSameSymbol = trade.sym === otherTrade.sym;
                
                return isEarlier && isSameSymbol;
            });

            return !hasEarlierTrade;
        });
    }
}

/**
 * Main service class that orchestrates the simulation
 */
class ZaireSimulationService {
    constructor(jobManager) {
        this.jobManager = jobManager;
    }

    /**
     * Loads stock list from selection parameters or comma-separated symbols
     */
    async loadStockList(symbol, selectionParams) {
        if (!symbol) {
            const niftyList = await readSheetData(selectionParams.STOCK_LIST);
            return niftyList.map(stock => stock[0]);
        }
        return symbol.split(',').map(s => s.trim());
    }

    /**
     * Processes a single trading day
     */
    async processTradingDay(
        currentDate,
        niftyList,
        simulation,
        selectionParams,
        jobId,
        singleDate
    ) {
        const dayStartTime = DateManager.getMarketStartTime(currentDate);
        const dayEndTime = DateManager.getMarketEndTime(currentDate);
        const dayTrades = [];

        let currentTime = dayStartTime;
        
        while (currentTime < dayEndTime) {
            console.log(getDateStringIND(currentTime), '---------');
            this.jobManager.updateJobProgress(jobId, currentTime);

            // Scan for trading opportunities
            const { selectedStocks } = await scanZaireStocks(
                niftyList,
                currentTime,
                SimulationConfig.DEFAULT_INTERVAL,
                false,
                true,
                true,
                selectionParams
            );

            // Process selected stocks
            if (selectedStocks.length > 0) {
                const trades = await StockProcessor.processStocksBatch(
                    selectedStocks,
                    simulation,
                    currentTime,
                    singleDate
                );
                dayTrades.push(...trades);
            }

            currentTime = DateManager.advanceTime(currentTime);
        }

        // Log day's results
        console.table(dayTrades.map(t => ({
            sym: t.sym,
            pnl: t.pnl,
            placedAt: getDateStringIND(t.placedAt),
            placedAtUk: t.placedAt,
            startedAt: t.startedAt
        })));

        return dayTrades;
    }

    /**
     * Runs the complete simulation across date range
     */
    async runSimulation(startdate, enddate, symbol, simulation, jobId, selectionParams) {
        const niftyList = await this.loadStockList(symbol, selectionParams);
        
        console.log('Stock list:', niftyList);
        console.log('Date range:', startdate, enddate);

        let currentDate = new Date(startdate);
        const finalEndDate = new Date(enddate);
        const singleDate = currentDate.toISOString() === finalEndDate.toISOString();
        
        const allTrades = [];

        // Iterate through each trading day
        while (currentDate <= finalEndDate) {
            // Skip to next trading day if needed
            if (DateManager.isMarketClosed(currentDate) || DateManager.isWeekend(currentDate)) {
                currentDate = DateManager.getNextTradingDay(currentDate);
                continue;
            }

            // Process this trading day
            const dayTrades = await this.processTradingDay(
                currentDate,
                niftyList,
                simulation,
                selectionParams,
                jobId,
                singleDate
            );

            // Filter trades based on re-entry settings
            const filteredTrades = TradeFilter.filterTrades(
                dayTrades,
                simulation,
                singleDate
            );

            allTrades.push(...filteredTrades);

            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return allTrades;
    }
}

// Create singleton job manager
const jobManager = new JobManager();
const simulationService = new ZaireSimulationService(jobManager);

/**
 * Express route handler: Start a new simulation
 */
const startZaireSimulation = async (req, res) => {
    try {
        const { startdate, enddate, symbol, simulation, selectionParams } = req.body;
        const jobId = jobManager.createJob(startdate);

        // Run simulation asynchronously
        simulationService
            .runSimulation(startdate, enddate, symbol, simulation, jobId, selectionParams)
            .then(result => jobManager.completeJob(jobId, result))
            .catch(error => {
                console.error('Simulation error:', error);
                jobManager.failJob(jobId, error.message);
            });

        res.json({ jobId });
    } catch (error) {
        console.error('Error starting simulation:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

/**
 * Express route handler: Check simulation status
 */
const checkZaireSimulationStatus = (req, res) => {
    const { jobId } = req.params;
    const job = jobManager.getJob(jobId);

    if (!job) {
        return res.status(404).json({ message: 'Simulation job not found' });
    }

    res.json(job);

    // Schedule cleanup for completed/failed jobs
    if (job.status === 'completed' || job.status === 'error') {
        jobManager.scheduleCleanup(jobId);
    }
};

module.exports = {
    startZaireSimulation,
    checkZaireSimulationStatus,
    // Export classes for testing
    SimulationConfig,
    JobManager,
    DateManager,
    StockProcessor,
    TradeFilter,
    ZaireSimulationService
};

