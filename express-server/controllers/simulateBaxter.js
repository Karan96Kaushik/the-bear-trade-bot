const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../../kite/utils")
const { Simulator } = require("../../simulator/SimulatorV3")
const { scanBaxterStocks } = require("../../analytics/baxter")
const { getDateRange, addMovingAverage } = require("../../analytics")
const { readSheetData, processSheetWithHeaders } = require("../../gsheets")
const { getGrowwChartData, processGrowwData } = require("../../kite/utils")
const { logSimulationResult } = require("../../analytics/baxterLogger")

const RISK_AMOUNT = 200;

// Store ongoing simulations
const simulationJobs = new Map();

// New endpoint to start simulation
const startBaxterSimulation = async (req, res) => {
    try {
        const { startdate, enddate, symbol, simulation, selectionParams } = req.body;
        const jobId = Date.now().toString(); // Simple unique ID
        
        // Start simulation in background
        simulationJobs.set(jobId, {
            status: 'running',
            startTime: new Date(),
            currentDate: startdate, // Add current date being processed
            result: null,
            error: null
        });
        
        // Run simulation asynchronously
        simulate(startdate, enddate, symbol, simulation, jobId, selectionParams) // Pass jobId to simulate function
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
}

// New endpoint to check simulation status
const checkBaxterSimulationStatus = (req, res) => {
    const { jobId } = req.params;
    const job = simulationJobs.get(jobId);
    
    if (!job) {
        return res.status(404).json({ message: 'Simulation job not found' });
    }
    
    res.json(job);
    
    // Clean up completed jobs after some time
    if (job.status === 'completed' || job.status === 'error') {
        setTimeout(() => {
            simulationJobs.delete(jobId);
        }, 1000 * 60 * 5); // Clean up after 5 minutes
    }
}

const simulate = async (startdate, enddate, symbol, simulation, jobId, selectionParams) => {
    try {
        let stockList = []
        let allTraded = []

        console.log(selectionParams, symbol)

        if (!symbol) {
            console.log('No symbol provided, reading from sheet based on selectionParams', selectionParams)
            // Read from Baxter-StockList sheet, column "bullish"
            let sheetData = await readSheetData(selectionParams.STOCK_LIST || 'Baxter-StockList');
            sheetData = processSheetWithHeaders(sheetData);
            // Extract bullish column
            stockList = sheetData.map(row => row.bullish)
        }
        else {
            stockList = symbol.split(',').map(s => s.trim())
        }

        stockList = stockList.filter(stock => stock?.length > 0)

        console.log(stockList)
        console.log(startdate, enddate)

        // Convert start and end dates to Date objects
        let currentDate = new Date(startdate)
        let finalEndDate = new Date(enddate)
        let singleDate = false;

        console.log(currentDate, finalEndDate)

        if (currentDate.toISOString() == finalEndDate.toISOString()) {
            singleDate = false;
        }

        // Iterate through each day
        while (currentDate <= finalEndDate) {
            
            // Update current date in job status

            // In case of nse holiday, move to next day
            if (checkIfMarketClosed(currentDate)) {
                currentDate.setDate(currentDate.getDate() + 1)
            }

            // In case of weekend, move to next day
            if (currentDate.getDay() == 0 || currentDate.getDay() == 6) {
                currentDate.setDate(currentDate.getDate() + (currentDate.getDay() == 0 ? 1 : 2))
            }

            // In case of nse holiday on a monday, move to next day
            if (checkIfMarketClosed(currentDate)) {
                currentDate.setDate(currentDate.getDate() + 1)
            }


            let dayStartTime = new Date(currentDate)
            let dayEndTime = new Date(currentDate)

            console.log(dayStartTime, dayEndTime)

            dayStartTime.setUTCHours(3, 50, 20, 0)

            // 2:35 PM IST
            dayEndTime.setUTCHours(9, 5, 10, 0)

            let traded = []

            // Track last scan time to scan every 15 minutes
            let lastScanTime = new Date(dayStartTime)
            lastScanTime.setUTCMinutes(lastScanTime.getUTCMinutes() - 15) // Force first scan

            // Inner loop for each 5-minute interval within the day
            while (dayStartTime < dayEndTime) {
                // console.log(getDateStringIND(dayStartTime), '---------')

                simulationJobs.get(jobId).currentDate = dayStartTime;

                const interval = '15m'

                // Scan every 15 minutes using 15m candles
                const minutesSinceLastScan = (dayStartTime - lastScanTime) / (1000 * 60);
                
                if (minutesSinceLastScan >= 15) {
                    // console.log('selectionParams', selectionParams)

                    const candleDate = new Date(dayStartTime)
                    const {selectedStocks} = await scanBaxterStocks(stockList, candleDate, interval, true, selectionParams);

                    lastScanTime = new Date(dayStartTime);

                    if (selectedStocks.length > 0) {
                        const BATCH_SIZE = 2;
                        const activePromises = new Set();
                        const results = [];

                        for (let i = 0; i < selectedStocks.length; i++) {
                            const stock = selectedStocks[i];
                            const promise = (async () => {
                                const { _startDate, endDate } = getDateRange(dayStartTime);
                                endDate.setUTCHours(11, 0, 0, 0);
                                const startDate = new Date(endDate);
                                startDate.setUTCHours(3, 0, 0, 0);

                                // Fetch 5m data for precise execution monitoring
                                let yahooData = await getGrowwChartData(stock.sym, startDate, endDate, 1, true);
                                yahooData = processGrowwData(yahooData);

                                // Same padding logic as Benoit
                                let triggerPadding = 1;
                                if (stock.high < 20)
                                    triggerPadding = 0.1;
                                else if (stock.high < 50)
                                    triggerPadding = 0.2;
                                else if (stock.high < 100)
                                    triggerPadding = 0.3;
                                else if (stock.high < 300)
                                    triggerPadding = 0.5;

                                let direction = stock.direction; // Always BULLISH for Baxter
                                let triggerPrice, targetPrice, stopLossPrice;

                                let [targetMultiplier, stopLossMultiplier] = simulation.targetStopLossRatio.split(':').map(Number);
                                let candleLength = stock.high - stock.low;

                                // For BULLISH direction
                                triggerPrice = stock.high + triggerPadding; // Buy above The Queen's high
                                stopLossPrice = stock.low - triggerPadding; // The Knight - initial SL
                                targetPrice = null; // No target, trail infinitely

                                triggerPrice = Math.round(triggerPrice * 10) / 10;
                                stopLossPrice = Math.round(stopLossPrice * 10) / 10;

                                let quantity = Math.ceil(RISK_AMOUNT / (triggerPrice - stopLossPrice));
                                quantity = Math.abs(quantity);

                                const sim = new Simulator({
                                    stockSymbol: stock.sym,
                                    triggerPrice,
                                    targetPrice,
                                    stopLossPrice,
                                    quantity,
                                    direction,
                                    yahooData,
                                    orderTime: dayStartTime,
                                    cancelInMins: simulation.cancelInMins,
                                    updateSL: simulation.updateSL,
                                    updateSLInterval: simulation.updateSLInterval,
                                    updateSLFrequency: simulation.updateSLFrequency,
                                    marketOrder: simulation.marketOrder,
                                    enableTriggerDoubleConfirmation: simulation.enableTriggerDoubleConfirmation,
                                    enableStopLossDoubleConfirmation: simulation.enableStopLossDoubleConfirmation,
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
                                        exitReason: sim.exitReason || null,
                                        triggerPrice: triggerPrice,
                                        targetPrice: targetPrice,
                                        stopLossPrice: stopLossPrice
                                    };
                                }
                                return null;
                            })();

                            // Add promise to active set
                            activePromises.add(promise);

                            // When promise completes, remove it from active set and add result if not null
                            promise.then(result => {
                                activePromises.delete(promise);
                                if (result !== null) {
                                    results.push(result);
                                }
                            });

                            // If we've hit the batch size limit, wait for at least one promise to complete
                            if (activePromises.size >= BATCH_SIZE) {
                                await Promise.race(activePromises);
                            }
                        }

                        // Wait for any remaining promises to complete
                        await Promise.all(activePromises);
                        
                        // Log each trade result
                        results.forEach(result => {
                            if (result) {
                                logSimulationResult(result, dayStartTime, selectionParams);
                            }
                        });
                        
                        traded.push(...results);
                    }
                }

                // Move to next 5-minute interval for execution checking
                dayStartTime = new Date(dayStartTime.getTime() + 5 * 60 * 1000)
            }

            console.table(traded.map(t => ({sym: t.sym, pnl: t.pnl, placedAt: getDateStringIND(t.placedAt), placedAtUk: t.placedAt, startedAt: t.startedAt})))

            let filTraded = []
    
            if (simulation.reEnterPosition) {
                filTraded = traded.filter(t => (singleDate && !t.pnl) ||    // Show cancelled trades if it's a single day simulation
                                                // Remove trades that were started before an active trade
                                                !traded.find(t1 => (
                                                    (t1.startedAt < t.startedAt || +t1.placedAt < +t.placedAt) && 
                                                    (t.sym == t1.sym) && 
                                                    (+t1.placedAt < +t.exitTime)
                                                ))
                                        )
            }
            else {
                filTraded = traded.filter(t => !traded.find(t1 => ((t1.startedAt < t.startedAt || +t1.placedAt < +t.placedAt) && (t.sym == t1.sym))))
            }


            allTraded.push(...filTraded);


            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1)
        }
        
        return allTraded;
    } catch (error) {
      console.error('Error fetching orders data:', error);
      return null;
    }
}

const checkIfMarketClosed = (date) => {
    const day = date.getDate();
    const month = date.getMonth()+1;
    const year = date.getFullYear();

    const marketClosed = [
        {day: 18, month: 4}, // April 18, 2025
        {day: 14, month: 4}, // April 14, 2025
        {day: 10, month: 4}, // April 10, 2025
        {day: 1, month: 5}, // May 01, 2025
        {day: 15, month: 8}, // August 15, 2025 
        {day: 27, month: 8}, // August 27, 2025 
    ]
    
    return marketClosed.find(m => m.day == day && m.month == month);
    
}

module.exports = {
    startBaxterSimulation,
    checkBaxterSimulationStatus
}
