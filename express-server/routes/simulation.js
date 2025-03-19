const express = require('express');
const router = express.Router();
// const { placeOrder } = require("../kite/processor")
const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../../kite/utils")
const { Simulator } = require("../../simulator/SimulatorV3")
const { scanZaireStocks, scanBailyStocks, getDateRange, addMovingAverage } = require("../../analytics")
const { readSheetData } = require("../../gsheets")
const { getGrowwChartData, processGrowwData } = require("../../kite/utils")

const RISK_AMOUNT = 100;

// Store ongoing simulations
const simulationJobs = new Map();

// New endpoint to start simulation
router.post('/simulate/v2/start', async (req, res) => {
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
});

// New endpoint to check simulation status
router.get('/simulate/v2/status/:jobId', (req, res) => {
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
});

const simulate = async (startdate, enddate, symbol, simulation, jobId, selectionParams) => { // Add jobId parameter
    try {
        let niftyList = []
        let allTraded = []

        console.log(selectionParams)

        if (!symbol) {
            niftyList = await readSheetData(selectionParams.STOCK_LIST)  
            niftyList = niftyList.map(stock => stock[0])
        }
        else {
            niftyList = symbol.split(',').map(s => s.trim())
        }

        console.log(niftyList)

        // Convert start and end dates to Date objects
        let currentDate = new Date(startdate)
        let finalEndDate = new Date(enddate)
        let singleDate = false;

        console.log(currentDate, finalEndDate)

        if (currentDate.toISOString() == finalEndDate.toISOString()) {
            singleDate = true;
        }

        singleDate = true


        // Iterate through each day
        while (currentDate <= finalEndDate) {
            // Update current date in job status

            if (currentDate.getDate() == 26 && currentDate.getMonth() == 2) {
                currentDate.setDate(currentDate.getDate() + 1)
            }

            if (currentDate.getDay() == 0 || currentDate.getDay() == 6) {
                currentDate.setDate(currentDate.getDate() + (currentDate.getDay() == 0 ? 1 : 2))
            }

            let dayStartTime = new Date(currentDate)
            let dayEndTime = new Date(currentDate)

            dayStartTime.setHours(3, 50, 20, 0)

            // 12:00 PM IST
            // dayEndTime.setHours(6, 30, 10, 0)

            // 2:00 PM IST
            // dayEndTime.setHours(8, 30, 10, 0)

            // 2:35 PM IST
            dayEndTime.setHours(9, 5, 10, 0)

            let traded = []


            // Inner loop for each 5-minute interval within the day
            while (dayStartTime < dayEndTime) {
                console.log(getDateStringIND(dayStartTime), '---------')
                // console.log(dayStartTime, '---------')

                simulationJobs.get(jobId).currentDate = dayStartTime;

                
                // const selectedStocks = await scanBailyStocks(niftyList, date, '5m')
                let selectedStocks = await scanZaireStocks(niftyList, dayStartTime, '5m', false, true, true, selectionParams);

                // INVERSE THE DIRECTION OF STOCKS
                // console.log("INVERSE THE DIRECTION OF STOCKS")
                // selectedStocks = selectedStocks.map(s => ({...s, direction: s.direction == 'BULLISH' ? 'BEARISH' : 'BULLISH'}))

                // console.log(selectedStocks)

                
                if (selectedStocks.length > 0) {
                    const BATCH_SIZE = 2;
                    const activePromises = new Set();
                    const results = [];

                    for (let i = 0; i < selectedStocks.length; i++) {
                        const stock = selectedStocks[i];
                        const promise = (async () => {
                            const { _startDate, endDate } = getDateRange(dayStartTime);
                            endDate.setHours(11, 0, 0, 0);
                            const startDate = new Date(endDate);
                            startDate.setHours(3, 0, 0, 0);
                            // console.log(stock.sym, startDate, endDate)

                            let yahooData = await getDataFromYahoo(stock.sym, 5, '1m', startDate, endDate, true);
                            yahooData = processYahooData(yahooData, 1, false);

                            // let yahooData = await getGrowwChartData(stock.sym, startDate, endDate, 1, true);
                            // yahooData = processGrowwData(yahooData);

                            yahooData = addMovingAverage(yahooData,'close',44, 'sma44');

                            let triggerPadding = 1;
                            if (stock.high < 20)
                                triggerPadding = 0.1;
                            else if (stock.high < 50)
                                triggerPadding = 0.2;
                            else if (stock.high < 100)
                                triggerPadding = 0.3;
                            else if (stock.high < 300)
                                triggerPadding = 0.5;

                            let direction = stock.direction;
                            let triggerPrice, targetPrice, stopLossPrice;

                            let [targetMultiplier, stopLossMultiplier] = simulation.targetStopLossRatio.split(':').map(Number);
                            let candleLength = stock.high - stock.low;

                            if (direction == 'BULLISH') {
                                triggerPrice = stock.high + triggerPadding;
                                stopLossPrice = stock.low - (candleLength * (stopLossMultiplier - 1)) - triggerPadding;
                                targetPrice = stock.high + ((triggerPrice - stopLossPrice) * targetMultiplier);
                            }
                            else {
                                triggerPrice = stock.low - triggerPadding;
                                stopLossPrice = stock.high + (candleLength * (stopLossMultiplier - 1)) + triggerPadding;
                                targetPrice = stock.low - ((stopLossPrice - triggerPrice) * targetMultiplier);
                            }
                            
                            triggerPrice = Math.round(triggerPrice * 10) / 10;
                            stopLossPrice = Math.round(stopLossPrice * 10) / 10;
                            targetPrice = Math.round(targetPrice * 10) / 10;

                            let quantity = Math.ceil(RISK_AMOUNT / (triggerPrice - stopLossPrice));
                            quantity = Math.abs(quantity);

                            // console.log(simulation)

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
                                marketOrder: simulation.marketOrder
                            });

                            sim.run();

                            // console.log(triggerPrice, targetPrice, stopLossPrice)

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
                    traded.push(...results);
                }

                dayStartTime = new Date(dayStartTime.getTime() + 5 * 60 * 1000)
            }

            console.table(traded.map(t => ({sym: t.sym, pnl: t.pnl, placedAt: getDateStringIND(t.placedAt), placedAtUk: t.placedAt, startedAt: t.startedAt})))

            let filTraded = []

            // console.log(traded.map(t => [t.placedAt, t.exitTime]))
    
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

        // console.log(filTraded)
        
        return allTraded;
    } catch (error) {
      console.error('Error fetching orders data:', error);
      return null;
    }
}

module.exports = router;
