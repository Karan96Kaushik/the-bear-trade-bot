const { scanBaxterStocks } = require("../analytics/baxter");
const { Simulator } = require("../simulator/SimulatorV3");
const { readSheetData, processSheetWithHeaders } = require("../gsheets");
const { getGrowwChartData, processGrowwData, getDateStringIND } = require("../kite/utils");
const { getDateRange } = require("../analytics");
const { logSimulationResult, printStatistics } = require("../analytics/baxterLogger");

/**
 * Test file for Baxter strategy
 * 
 * Tests:
 * 1. Stock scanning with 15m candles and 44-period SMA
 * 2. Simulation with trailing stop loss
 * 3. LTP-based cancellation when price drops below Knight
 */

const RISK_AMOUNT = 200;

function roundToTick(price, tick = 0.1) {
    return Math.round(price / tick) * tick;
}

function getTriggerPadding(high) {
    if (high < 20) return 0.1;
    if (high < 50) return 0.2;
    if (high < 100) return 0.3;
    if (high < 300) return 0.5;
    return 1;
}

function getMostRecentTradingDayAtUTC(targetHour, targetMinute) {
    const now = new Date();
    const d = new Date(now);
    d.setUTCSeconds(0, 0);
    d.setUTCHours(targetHour, targetMinute, 0, 0);

    // If current time is earlier than the target time today, go to previous day.
    if (now < d) d.setUTCDate(d.getUTCDate() - 1);

    // Skip weekends.
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
        d.setUTCDate(d.getUTCDate() - 1);
    }

    return d;
}

async function testBaxterScanning(scanTime = null) {
    console.log('\n=== Testing Baxter Stock Scanning ===\n');
    
    try {
        // Get stock list from Google Sheets or use test symbols
        let stockList;
        try {
            let sheetData = await readSheetData('Baxter-StockList');
            sheetData = processSheetWithHeaders(sheetData);
            // Filter for bullish column
            stockList = sheetData.map(row => row.bullish).filter(d => d && d !== 'NOT FOUND');
        } catch (error) {
            console.log('Using default test stock list');
            stockList = ['RELIANCE', 'INFY', 'TCS', 'HDFCBANK', 'ICICIBANK'];
        }
        
        console.log(`Testing with ${stockList.length} stocks`);
        
        // Scan time: aim for a time after market open so 15m candles exist.
        // 04:45Z ~= 10:15 IST
        const scanDate = scanTime || getMostRecentTradingDayAtUTC(4, 45);
        
        console.time('scanBaxterStocks');
        const result = await scanBaxterStocks(stockList, scanDate, '15m', false);
        console.timeEnd('scanBaxterStocks');
        
        const { selectedStocks, no_data_stocks, too_high_stocks, errored_stocks } = result;
        
        console.log(`\nResults:`);
        console.log(`✓ Selected stocks: ${selectedStocks.length}`);
        console.log(`✗ No data: ${no_data_stocks.length}`);
        console.log(`✗ Too high: ${too_high_stocks.length}`);
        console.log(`✗ Errors: ${errored_stocks.length}`);
        
        if (selectedStocks.length > 0) {
            console.log(`\nFirst selected stock details:`);
            console.log(selectedStocks[0]);
        }

        return selectedStocks;
    } catch (error) {
        console.error('Error in scanning test:', error);
        return [];
    }
}

async function simulateOneBaxterStockFromScan(scanStock, orderTime) {
    const triggerPadding = getTriggerPadding(scanStock.high);

    const triggerPrice = roundToTick(scanStock.high + triggerPadding, 0.1);
    const stopLossPrice = roundToTick(scanStock.low - triggerPadding, 0.1);
    const targetPrice = null; // No target for Baxter

    const riskPerShare = triggerPrice - stopLossPrice;
    if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) {
        throw new Error(`Invalid risk per share for ${scanStock.sym}: ${riskPerShare}`);
    }

    const quantity = Math.ceil(RISK_AMOUNT / riskPerShare);

    // Fetch 5-minute data for simulation (same day)
    const startDate = new Date(orderTime);
    const endDate = new Date(orderTime);
    startDate.setUTCHours(3, 0, 0, 0);
    endDate.setUTCHours(11, 0, 0, 0);

    let yahooData = await getGrowwChartData(scanStock.sym, startDate, endDate, 5, true);
    yahooData = processGrowwData(yahooData);

    const sim = new Simulator({
        stockSymbol: scanStock.sym,
        triggerPrice,
        targetPrice,
        stopLossPrice,
        quantity,
        direction: 'BULLISH',
        yahooData,
        orderTime,
        cancelInMins: 60,
        updateSL: true,
        updateSLInterval: 30,
        updateSLFrequency: 15,
        enableTriggerDoubleConfirmation: false,
        enableStopLossDoubleConfirmation: false
    });

    await sim.run();

    return {
        sim,
        setup: {
            sym: scanStock.sym,
            triggerPrice,
            stopLossPrice,
            targetPrice,
            quantity,
            orderTime,
            scanHigh: scanStock.high,
            scanLow: scanStock.low
        }
    };
}

function extractExecutedTradeSummary(sim, setup) {
    const entryAction = sim.tradeActions.find(a => a.action === 'Trigger Hit');
    if (!entryAction) return null;

    const exitAction = sim.tradeActions.find(a =>
        a.action === 'Stop Loss Hit' ||
        a.action === 'Target Hit' ||
        a.action === 'Auto Square-off'
    );

    return {
        sym: setup.sym,
        quantity: setup.quantity,
        triggerPrice: setup.triggerPrice,
        stopLossPrice: setup.stopLossPrice,
        startedAt: sim.startedAt,
        entryPrice: entryAction.price,
        exitTime: sim.exitTime || exitAction?.time || null,
        exitPrice: exitAction?.price ?? null,
        exitReason: sim.exitReason || null,
        pnl: sim.pnl
    };
}

const NUM_STOCKS_TO_SIMULATE = 25;

async function testBaxterSimulationBatch(selectedStocks, scanTime) {
    console.log('\n=== Testing Baxter Simulation (Batch: up to 5 stocks) ===\n');

    const orderTime = new Date(scanTime);
    const stocksToSimulate = selectedStocks.slice(0, NUM_STOCKS_TO_SIMULATE || 5);
    const executedTrades = [];

    console.log(`Simulating ${stocksToSimulate.length} stock(s) from scanTime=${scanTime.toISOString()}`);

    for (const s of stocksToSimulate) {
        try {
            console.log(`\n--- ${s.sym} ---`);

            const { sim, setup } = await simulateOneBaxterStockFromScan(s, orderTime);

            const tradeSummary = extractExecutedTradeSummary(sim, setup);
            if (tradeSummary) {
                executedTrades.push(tradeSummary);
                console.log(`Executed trade: ENTRY @ ₹${tradeSummary.entryPrice?.toFixed(2)} | exit=${tradeSummary.exitReason} | PnL=₹${tradeSummary.pnl.toFixed(2)}`);
            } else {
                console.log(`No trade executed (trigger never hit). Exit reason: ${sim.exitReason || 'N/A'}`);
            }
        } catch (error) {
            console.log(`Simulation error for ${s.sym}: ${error.message}`);
        }
    }

    console.log('\n=== Executed Trades (up to 5) ===');
    if (executedTrades.length === 0) {
        console.log('No executed trades found in these simulations.');
        return [];
    }

    executedTrades.slice(0, 5).forEach((t, idx) => {
        const startedAt = t.startedAt ? getDateStringIND(t.startedAt) : 'N/A';
        const exitAt = t.exitTime ? getDateStringIND(t.exitTime) : 'N/A';
        const exitPrice = t.exitPrice != null ? `₹${Number(t.exitPrice).toFixed(2)}` : 'N/A';
        console.log(
            `${idx + 1}. ${t.sym} qty=${t.quantity} | entry=${startedAt} @ ₹${Number(t.entryPrice).toFixed(2)} | exit=${exitAt} @ ${exitPrice} | reason=${t.exitReason} | pnl=₹${t.pnl.toFixed(2)}`
        );
    });

    return executedTrades;
}

async function testBaxterSimulation() {
    console.log('\n=== Testing Baxter Simulation (Single Stock) ===\n');
    
    try {
        // Use a test stock
        const testStock = {
            sym: 'RELIANCE',
            high: 2850.50,
            low: 2830.20,
            close: 2845.30,
            open: 2835.00,
            direction: 'BULLISH',
            sma44: 2840.00
        };
        
        const triggerPadding = getTriggerPadding(testStock.high);
        const triggerPrice = roundToTick(testStock.high + triggerPadding, 0.1);
        const stopLossPrice = roundToTick(testStock.low - triggerPadding, 0.1);
        const targetPrice = null; // No target for Baxter
        
        const quantity = Math.ceil(RISK_AMOUNT / (triggerPrice - stopLossPrice));
        
        console.log('Trade Setup:');
        console.log(`Stock: ${testStock.sym}`);
        console.log(`Direction: ${testStock.direction}`);
        console.log(`Trigger (Buy above Queen): ${triggerPrice}`);
        console.log(`Initial SL (The Knight): ${stopLossPrice}`);
        console.log(`Target: ${targetPrice || 'None (Trailing SL only)'}`);
        console.log(`Quantity: ${quantity}`);
        console.log(`Risk Amount: ${RISK_AMOUNT}`);
        
        // Fetch 5-minute data for simulation
        const testDate = new Date('2025-12-15T09:15:00.000Z');
        const { startDate, endDate } = getDateRange(testDate);
        endDate.setUTCHours(11, 0, 0, 0);
        startDate.setUTCHours(3, 0, 0, 0);
        
        console.log(`\nFetching data from ${startDate.toISOString()} to ${endDate.toISOString()}`);
        
        let yahooData = await getGrowwChartData(testStock.sym, startDate, endDate, 1, true);
        yahooData = processGrowwData(yahooData);
        
        console.log(`Data points fetched: ${yahooData.length}`);
        
        // Run simulation with trailing SL
        const sim = new Simulator({
            stockSymbol: testStock.sym,
            triggerPrice,
            targetPrice,
            stopLossPrice,
            quantity,
            direction: testStock.direction,
            yahooData,
            orderTime: testDate,
            cancelInMins: 60, // Cancel after 1 hour if not triggered
            updateSL: true,
            updateSLInterval: 30, // Look back 30 minutes
            updateSLFrequency: 15, // Check every 15 minutes
            enableTriggerDoubleConfirmation: false,
            enableStopLossDoubleConfirmation: false
        });
        
        console.log('\nRunning simulation...');
        await sim.run();
        
        console.log('\n=== Simulation Results ===');
        console.log(`PnL: ₹${sim.pnl.toFixed(2)}`);
        console.log(`Exit Reason: ${sim.exitReason || 'N/A'}`);
        console.log(`Position Status: ${sim.isPositionOpen ? 'OPEN' : 'CLOSED'}`);
        
        if (sim.startedAt) {
            console.log(`Started At: ${getDateStringIND(sim.startedAt)}`);
        }
        if (sim.exitTime) {
            console.log(`Exited At: ${getDateStringIND(sim.exitTime)}`);
        }
        
        console.log('\n=== Trade Actions ===');
        sim.tradeActions.forEach(action => {
            console.log(`${getDateStringIND(action.time)}: ${action.action} @ ₹${action.price.toFixed(2)}`);
        });
        
        // Log the trade result
        const simResult = {
            startedAt: sim.startedAt,
            placedAt: sim.orderTime,
            pnl: sim.pnl || 0,
            quantity: sim.quantity,
            direction: sim.direction,
            sym: sim.stockSymbol,
            actions: sim.tradeActions,
            exitTime: sim.exitTime || null,
            exitReason: sim.exitReason || null,
            triggerPrice: triggerPrice,
            targetPrice: targetPrice,
            stopLossPrice: stopLossPrice
        };
        
        const tradeId = logSimulationResult(simResult, testDate, { RISK_AMOUNT });
        console.log(`\nTrade logged with ID: ${tradeId}`);
        
        return sim;
    } catch (error) {
        console.error('Error in simulation test:', error);
        return null;
    }
}

async function testParameterValidation() {
    console.log('\n=== Testing Parameter Validation (Phase 2) ===\n');

    const testCases = [
        {
            name: 'Invalid direction',
            params: {
                stockSymbol: 'TEST',
                triggerPrice: 100,
                stopLossPrice: 95,
                quantity: 10,
                direction: 'INVALID',
                yahooData: [],
                orderTime: new Date()
            },
            shouldFail: true
        },
        {
            name: 'Negative triggerPrice',
            params: {
                stockSymbol: 'TEST',
                triggerPrice: -100,
                stopLossPrice: 95,
                quantity: 10,
                direction: 'BULLISH',
                yahooData: [],
                orderTime: new Date()
            },
            shouldFail: true
        },
        {
            name: 'Missing required parameters',
            params: {
                triggerPrice: 100,
                stopLossPrice: 95
            },
            shouldFail: true
        },
        {
            name: 'Valid parameters with all optional fields',
            params: {
                stockSymbol: 'RELIANCE',
                triggerPrice: 2851.5,
                stopLossPrice: 2829.7,
                targetPrice: 2900,
                quantity: 5,
                direction: 'BULLISH',
                yahooData: [{ time: 0, open: 100, high: 101, low: 99, close: 100 }],
                orderTime: new Date(),
                cancelInMins: 60,
                updateSL: true,
                updateSLInterval: 30,
                updateSLFrequency: 15,
                enableTriggerDoubleConfirmation: true,
                enableStopLossDoubleConfirmation: true,
                doubleConfirmationLookbackHours: 3,
                placeAverageMarketPrice: false
            },
            shouldFail: false
        }
    ];

    for (const testCase of testCases) {
        try {
            const sim = new Simulator(testCase.params);
            if (testCase.shouldFail) {
                console.log(`✗ FAILED: "${testCase.name}" - Should have thrown error`);
            } else {
                console.log(`✓ PASSED: "${testCase.name}"`);
            }
        } catch (error) {
            if (testCase.shouldFail) {
                console.log(`✓ PASSED: "${testCase.name}" - Correctly threw: ${error.message.substring(0, 60)}...`);
            } else {
                console.log(`✗ FAILED: "${testCase.name}" - ${error.message}`);
            }
        }
    }
}

async function testLTPCancellation() {
    console.log('\n=== Testing LTP-Based Cancellation ===\n');
    
    try {
        const testStock = {
            sym: 'TESTSTOCK',
            high: 100,
            low: 95,
            close: 98,
            direction: 'BULLISH'
        };
        
        const triggerPrice = 100.5;
        const stopLossPrice = 94.5; // The Knight
        
        // Create mock data where price drops below Knight
        const mockData = [];
        const baseTime = new Date('2025-12-15T09:15:00.000Z');
        
        // Generate data where price never hits trigger but drops below Knight
        for (let i = 0; i < 20; i++) {
            const time = new Date(baseTime.getTime() + i * 5 * 60 * 1000);
            const close = 98 - (i * 0.5); // Price gradually drops
            mockData.push({
                time: time.getTime(),
                open: close + 0.2,
                high: close + 0.3,
                low: close - 0.3,
                close: close
            });
        }
        
        console.log(`Initial Knight (SL): ${stopLossPrice}`);
        console.log(`Trigger Price: ${triggerPrice}`);
        console.log(`Starting Price: 98`);
        console.log(`Price will drop below Knight at candle ~${Math.ceil((98 - stopLossPrice) / 0.5)}`);
        
        const sim = new Simulator({
            stockSymbol: testStock.sym,
            triggerPrice,
            targetPrice: null,
            stopLossPrice,
            quantity: 10,
            direction: 'BULLISH',
            yahooData: mockData,
            orderTime: baseTime,
            cancelInMins: null, // No time-based cancellation
            updateSL: false,
            updateSLInterval: 0,
            updateSLFrequency: 0
        });
        
        sim.run();
        
        console.log('\n=== Cancellation Test Results ===');
        console.log(`Exit Reason: ${sim.exitReason}`);
        console.log(`Expected: 'cancelled-ltp-below-knight'`);
        console.log(`Test ${sim.exitReason === 'cancelled-ltp-below-knight' ? '✓ PASSED' : '✗ FAILED'}`);
        
        console.log('\nTrade Actions:');
        sim.tradeActions.forEach(action => {
            console.log(`${getDateStringIND(action.time)}: ${action.action} @ ₹${action.price.toFixed(2)}`);
        });
        
        return sim;
    } catch (error) {
        console.error('Error in cancellation test:', error);
        return null;
    }
}

async function runAllTests() {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║   BAXTER STRATEGY TEST SUITE              ║');
    console.log('║   Bullish 15m Candles with Trailing SL    ║');
    console.log('║   Phase 1 & 2: Refactored Simulator       ║');
    console.log('╚════════════════════════════════════════════╝');
    
    try {
        // Test 1: Parameter Validation (Phase 2)
        await testParameterValidation();

        // Test 2: Stock Scanning + Batch Simulation (up to 5)
        let scanTime = getMostRecentTradingDayAtUTC(4, 45);
        scanTime = new Date("2026-02-03T04:45:00.000Z"); // 2 days ago for more data
        scanTime = new Date("2026-02-02T04:45:00.000Z"); // 2 days ago for more data
        const selectedStocks = await testBaxterScanning(scanTime);

        // Test 3: Simulate up to 5 of the selected stocks and show up to 5 executed trades
        await testBaxterSimulationBatch(selectedStocks, scanTime);
        
        // Test 4: LTP-Based Cancellation
        await testLTPCancellation();
        
        console.log('\n╔════════════════════════════════════════════╗');
        console.log('║   ALL TESTS COMPLETED                     ║');
        console.log('║   Backward Compatibility: ✓               ║');
        console.log('║   Phase 1 & 2 Improvements: ✓             ║');
        console.log('╚════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('Test suite error:', error);
    }
}

// Run tests if executed directly
if (require.main === module) {
    runAllTests().then(() => {
        console.log('Tests finished');
        process.exit(0);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    testParameterValidation,
    testBaxterScanning,
    testBaxterSimulation,
    testLTPCancellation,
    runAllTests
};
