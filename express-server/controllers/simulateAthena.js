const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../../kite/utils");
const { scanAthenaStocks, addEMA } = require("../../analytics/athena");
const { getDateRange } = require("../../analytics");
const { readSheetData, processSheetWithHeaders } = require("../../gsheets");
const { logSimulationResult } = require("../../analytics/athenaLogger");

const RISK_AMOUNT = 200;

const fs = require('fs');

const simulationJobs = new Map();

const startAthenaSimulation = async (req, res) => {
    try {
        const { startdate, enddate, symbol, simulation, selectionParams } = req.body;
        const jobId = Date.now().toString();

        simulationJobs.set(jobId, {
            status: 'running',
            startTime: new Date(),
            currentDate: startdate,
            result: null,
            error: null
        });

        simulate(startdate, enddate, symbol, simulation, jobId, selectionParams)
            .then(result => {
                simulationJobs.set(jobId, {
                    status: 'completed',
                    currentDate: null,
                    startTime: simulationJobs.get(jobId).startTime,
                    result,
                    error: null
                });
            })
            .catch(error => {
                simulationJobs.set(jobId, {
                    status: 'error',
                    currentDate: null,
                    result: null,
                    error: error.message
                });
            });

        res.json({ jobId });
    } catch (error) {
        console.error('Error starting simulation:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const checkAthenaSimulationStatus = (req, res) => {
    const { jobId } = req.params;
    const job = simulationJobs.get(jobId);

    if (!job) {
        return res.status(404).json({ message: 'Simulation job not found' });
    }

    res.json(job);

    if (job.status === 'completed' || job.status === 'error') {
        setTimeout(() => {
            simulationJobs.delete(jobId);
        }, 1000 * 60 * 5);
    }
};

/**
 * Simulate a single Athena trade with EMA-based exit
 */
function simulateAthenaTrade(stock, dayData5m, orderTime, riskAmount = RISK_AMOUNT) {
    const direction = stock.direction;
    const entry = stock.entryPrice || stock.close;
    const slPrice = stock.slPrice;
    const quantity = stock.quantity || Math.ceil(riskAmount / Math.abs(entry - slPrice));

    const entryTime = stock.candleTime || stock.data?.currentCandle?.time;
    if (!entryTime) return null;

    const entryTimestamp = new Date(entryTime).getTime();
    const candlesAfterEntry = dayData5m.filter(c => new Date(c.time).getTime() > entryTimestamp);

    const actions = [
        { time: entryTime, action: 'Entry', price: entry }
    ];

    let exitTime = null;
    let exitPrice = null;
    let exitReason = null;

    for (const candle of candlesAfterEntry) {
        if (!candle.ema50) continue;

        if (direction === 'BULLISH') {
            if (candle.low <= slPrice) {
                exitTime = candle.time;
                exitPrice = slPrice;
                exitReason = 'Stop Loss Hit';
                break;
            } else if (candle.close < candle.ema50) {
                exitTime = candle.time;
                exitPrice = candle.close;
                exitReason = 'EMA Exit';
                break;
            }
        } else {
            if (candle.high >= slPrice) {
                exitTime = candle.time;
                exitPrice = slPrice;
                exitReason = 'Stop Loss Hit';
                break;
            } else if (candle.close > candle.ema50) {
                exitTime = candle.time;
                exitPrice = candle.close;
                exitReason = 'EMA Exit';
                break;
            }
        }
    }

    if (!exitTime && candlesAfterEntry.length > 0) {
        const lastCandle = candlesAfterEntry[candlesAfterEntry.length - 1];
        exitTime = lastCandle.time;
        exitPrice = lastCandle.close;
        exitReason = 'Auto Square-off';
    }

    if (!exitTime) return null;

    const pnl = direction === 'BULLISH'
        ? (exitPrice - entry) * quantity
        : (entry - exitPrice) * quantity;

    actions.push({ time: exitTime, action: exitReason, price: exitPrice });

    return {
        startedAt: entryTime,
        placedAt: orderTime,
        pnl,
        quantity,
        direction,
        sym: stock.sym,
        actions,
        exitTime,
        exitReason,
        entryPrice: entry,
        stopLossPrice: slPrice,
        triggerPrice: entry,
        targetPrice: null,
        scanData: stock.data || null
    };
}

const simulate = async (startdate, enddate, symbol, simulation, jobId, selectionParams) => {
    try {
        let allTraded = [];
        let allSelectedStocks = [];

        let bullishStockList = [];
        let bearishStockList = [];
        let bothStockList = [];

        if (!symbol) {
            console.log('No symbol provided, reading from sheet based on selectionParams', selectionParams);
            let sheetData = await readSheetData(selectionParams.STOCK_LIST || 'Athena-StockList');
            sheetData = processSheetWithHeaders(sheetData);
            bullishStockList = (sheetData.map(row => row.bullish).filter(s => s?.length > 0)).map(s => s.toUpperCase());
            bearishStockList = (sheetData.map(row => row.bearish).filter(s => s?.length > 0)).map(s => s.toUpperCase());
            bothStockList = (sheetData.map(row => row.both).filter(s => s?.length > 0)).map(s => s.toUpperCase());
        } else {
            const symbols = symbol.split(',').map(s => s.trim()).filter(Boolean);
            bullishStockList = [];
            bearishStockList = [];
            bothStockList = symbols.filter(s => s?.length > 0).map(s => s.toUpperCase());
        }

        bothStockList = Array.from(new Set(bothStockList));
        bullishStockList = Array.from(new Set(bullishStockList));
        bearishStockList = Array.from(new Set(bearishStockList));

        let currentDate = new Date(startdate);
        let finalEndDate = new Date(enddate);
        let singleDate = false;

        if (currentDate.toISOString() == finalEndDate.toISOString()) {
            singleDate = true;
        }

        const emaWindow = Number(selectionParams?.EMA_WINDOW || 50);
        const riskAmount = Number(selectionParams?.RISK_AMOUNT || RISK_AMOUNT);

        while (currentDate <= finalEndDate) {
            if (checkIfMarketClosed(currentDate)) {
                currentDate.setDate(currentDate.getDate() + 1);
            }

            if (currentDate.getDay() == 0 || currentDate.getDay() == 6) {
                currentDate.setDate(currentDate.getDate() + (currentDate.getDay() == 0 ? 1 : 2));
            }

            if (checkIfMarketClosed(currentDate)) {
                currentDate.setDate(currentDate.getDate() + 1);
            }

            let dayStartTime = new Date(currentDate);
            let dayEndTime = new Date(currentDate);

            dayStartTime.setUTCHours(3, 50, 20, 0);
            dayEndTime.setUTCHours(9, 30, 10, 0);

            let traded = [];

            const INTERVAL_MINUTES = 5;
            let lastScanTime = new Date(dayStartTime);
            lastScanTime.setUTCMinutes(lastScanTime.getUTCMinutes() - INTERVAL_MINUTES);

            while (dayStartTime < dayEndTime) {
                simulationJobs.get(jobId).currentDate = dayStartTime;

                const minutesSinceLastScan = (dayStartTime - lastScanTime) / (1000 * 60);

                if (minutesSinceLastScan >= INTERVAL_MINUTES) {
                    const candleDate = new Date(dayStartTime);
                    console.log('candleDate', getDateStringIND(candleDate));
                    let selectedStocks = [];

                    if (bothStockList.length > 0) {
                        const { selectedStocks: bothSelected } = await scanAthenaStocks(
                            bothStockList, candleDate, '5m', true, selectionParams, 'BOTH'
                        );
                        selectedStocks.push(...bothSelected);
                    } else {
                        if (bullishStockList.length > 0) {
                            const { selectedStocks: bullishSelected } = await scanAthenaStocks(
                                bullishStockList, candleDate, '5m', true, selectionParams, 'BULLISH'
                            );
                            selectedStocks.push(...bullishSelected);
                        }
                        if (bearishStockList.length > 0) {
                            const { selectedStocks: bearishSelected } = await scanAthenaStocks(
                                bearishStockList, candleDate, '5m', true, selectionParams, 'BEARISH'
                            );
                            selectedStocks.push(...bearishSelected);
                        }
                    }

                    allSelectedStocks.push(...selectedStocks);
                    lastScanTime = new Date(dayStartTime);

                    if (selectedStocks.length > 0) {
                        const BATCH_SIZE = 2;
                        const activePromises = new Set();
                        const results = [];

                        for (let i = 0; i < selectedStocks.length; i++) {
                            const stock = selectedStocks[i];
                            const promise = (async () => {
                                try {
                                    const { startDate: _startDate, endDate } = getDateRange(dayStartTime);
                                    endDate.setUTCHours(11, 0, 0, 0);
                                    const startDate = new Date(endDate);
                                    startDate.setUTCHours(3, 0, 0, 0);

                                    let yahooData = await getDataFromYahoo(stock.sym, 6, '5m', startDate, endDate, true);
                                    yahooData = processYahooData(yahooData, '5m', true);
                                    yahooData = yahooData.filter(r => r.close);
                                    yahooData = addEMA(yahooData, 'close', emaWindow, 'ema50');

                                    const result = simulateAthenaTrade(stock, yahooData, dayStartTime, riskAmount);

                                    if (singleDate || (result && result.startedAt)) {
                                        return {
                                            ...result,
                                            data: yahooData,
                                        };
                                    }
                                    return null;
                                } catch (error) {
                                    console.error('Error processing stock:', error);
                                    console.trace(error);
                                    return null;
                                }
                            })();

                            activePromises.add(promise);

                            promise.then(result => {
                                activePromises.delete(promise);
                                if (result !== null) {
                                    results.push(result);
                                }
                            });

                            if (activePromises.size >= BATCH_SIZE) {
                                await Promise.race(activePromises);
                            }
                        }

                        await Promise.all(activePromises);

                        results.forEach(result => {
                            if (result) {
                                logSimulationResult(result, dayStartTime, selectionParams);
                            }
                        });

                        traded.push(...results);
                    }
                }

                dayStartTime = new Date(dayStartTime.getTime() + INTERVAL_MINUTES * 60 * 1000);
            }

            console.table(traded.map(t => ({
                sym: t.sym,
                pnl: t.pnl,
                placedAt: getDateStringIND(t.placedAt),
                startedAt: t.startedAt ? getDateStringIND(new Date(t.startedAt)) : null,
                exitTime: getDateStringIND(t.exitTime),
                exitReason: t.exitReason
            })));

            let filTraded = [];

            fs.writeFileSync('athena-traded.json', JSON.stringify(traded, null, 4));

            if (simulation.reEnterPosition) {
                const eligible = traded.filter((t) => t && t.startedAt);
                const bySym = new Map();
                for (const t of eligible) {
                    if (!bySym.has(t.sym)) bySym.set(t.sym, []);
                    bySym.get(t.sym).push(t);
                }
                filTraded = [];
                for (const arr of bySym.values()) {
                    arr.sort((a, b) => +new Date(a.placedAt) - +new Date(b.placedAt));
                    const openStack = [];
                    for (const t of arr) {
                        const placed = +new Date(t.placedAt);
                        while (
                            openStack.length &&
                            +openStack[openStack.length - 1].exitTime <= placed
                        ) {
                            openStack.pop();
                        }
                        const surroundingTrade = openStack[openStack.length - 1];
                        if (surroundingTrade) {
                            continue;
                        }
                        openStack.push(t);
                        filTraded.push(t);
                    }
                }
                filTraded.sort(
                    (a, b) => +new Date(a.placedAt) - +new Date(b.placedAt)
                );
            } else {
                filTraded = traded.filter(t => t && !traded.find(t1 => (
                    (t1.startedAt < t.startedAt || +t1.placedAt < +t.placedAt) && (t.sym == t1.sym)
                )));
            }

            allTraded.push(...filTraded);

            currentDate.setDate(currentDate.getDate() + 1);
        }

        console.log('allSelectedStocks', allSelectedStocks.length);
        console.table(allSelectedStocks.map(s => ({
            sym: s.sym,
            time: s.time,
            direction: s.direction,
            close: s.close,
            ema50: s.ema50,
            slPrice: s.slPrice,
            quantity: s.quantity
        })));

        return allTraded;
    } catch (error) {
        console.error('Error fetching orders data:', error);
        return null;
    }
};

const checkIfMarketClosed = (date) => {
    const day = date.getDate();
    const month = date.getMonth() + 1;

    const marketClosed = [];

    return marketClosed.find(m => m.day == day && m.month == month);
};

module.exports = {
    startAthenaSimulation,
    checkAthenaSimulationStatus,
    simulateAthenaTrade
};
