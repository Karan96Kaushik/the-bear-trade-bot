const {
    getDateStringIND, getDataFromYahoo, processYahooData,
    getGrowwChartData, processGrowwData
} = require("../../kite/utils")
const { Simulator } = require("../../simulator/SimulatorV3")
const { getDateRange, addMovingAverage } = require("../../analytics")
const { scanLightyearStocks } = require("../../analytics/lightyear")
const { readSheetData } = require("../../gsheets")

const RISK_AMOUNT = 100;

// Store ongoing simulations
const simulationJobs = new Map();

// New endpoint to start simulation
const startLightyearSimulation = async (req, res) => {
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
const checkLightyearSimulationStatus = (req, res) => {
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

        // console.log(niftyList)

        // Convert start and end dates to Date objects
        let currentDate = new Date(startdate)
        let finalEndDate = new Date(enddate)
        let singleDate = false;

        if (currentDate.toISOString() == finalEndDate.toISOString()) {
            singleDate = true;
        }

        singleDate = true


        // Iterate through each day
        while (currentDate <= finalEndDate) {
            // Update current date in job status

            if (
                (currentDate.getDate() == 26 && currentDate.getMonth()+1 == 2) || 
                (currentDate.getDate() == 14 && currentDate.getMonth()+1 == 3)) {
                currentDate.setDate(currentDate.getDate() + 1)
            }

            if (currentDate.getDay() == 0 || currentDate.getDay() == 6) {
                currentDate.setDate(currentDate.getDate() + (currentDate.getDay() == 0 ? 1 : 2))
            }

            let dayStartTime = new Date(currentDate)

            dayStartTime.setUTCHours(11, 0, 20, 0)
            dayStartTime.setDate(dayStartTime.getDate() - 1)

            let traded = []

            console.log(getDateStringIND(dayStartTime), '---------')

            simulationJobs.get(jobId).currentDate = dayStartTime;

            const interval = '1d'
            const useCached = true

            const candleDate = new Date(dayStartTime)

            console.log(candleDate)

            let selectedStocks = await scanLightyearStocks(niftyList, candleDate, interval, useCached);

            console.log(selectedStocks)

            if (selectedStocks.length > 0) {
                const BATCH_SIZE = 2;
                const activePromises = new Set();
                const results = [];

                for (let i = 0; i < selectedStocks.length; i++) {
                    const stock = selectedStocks[i];

                    const promise = (async () => {

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
                        let entryTriggerPrice, targetPrice, finalStopLossPrice;
                        let orderStartTime;

                        // let candleLength = stock.high - stock.low;

                        if (direction == 'BULLISH') {
                            entryTriggerPrice = stock.high + triggerPadding;
                            finalStopLossPrice = Math.min(stock.prev.low, stock.low) - triggerPadding;
                            targetPrice = entryTriggerPrice + ((entryTriggerPrice - finalStopLossPrice) * 2);
                        }
                        else if (direction == 'BEARISH') {
                            entryTriggerPrice = stock.low - triggerPadding;
                            finalStopLossPrice = Math.max(stock.prev.high, stock.high) + triggerPadding;
                            targetPrice = entryTriggerPrice - ((finalStopLossPrice - entryTriggerPrice) * 2);
                        }
                        
                        entryTriggerPrice = Math.round(entryTriggerPrice * 10) / 10;
                        finalStopLossPrice = Math.round(finalStopLossPrice * 10) / 10;
                        targetPrice = Math.round(targetPrice * 10) / 10;

                        let exit = null;
                        let currentDay = 0;

                        let triggerPrice, stopLossPrice, last45mins;

                        let perDayResults = [];

                        const { endDate } = getDateRange(dayStartTime);
                        endDate.setUTCHours(11, 0, 0, 0);
                        const startDate = new Date(endDate);
                        startDate.setUTCHours(3, 0, 0, 0);

                        endDate.setDate(endDate.getDate() - 1)
                        startDate.setDate(startDate.getDate() - 1)

                        orderStartTime = (new Date(startDate)).setDate(startDate.getDate() + 1);

                        // Skip weekends and 26th Feb
                        if ( [0, 6].includes(startDate.getDay()) ) {
                            startDate.setDate(startDate.getDate() - (startDate.getDay() == 0 ? 2 : 1))
                            endDate.setDate(endDate.getDate() - (endDate.getDay() == 0 ? 2 : 1))
                        }
                        if ((startDate.getDate() == 26 && startDate.getMonth()+1 == 2) || (startDate.getDate() == 14 && startDate.getMonth()+1 == 3)) {
                            startDate.setDate(startDate.getDate() - 1)
                            endDate.setDate(endDate.getDate() - 1)
                        }

                        let yahooData = await getGrowwChartData(stock.sym, startDate, endDate, 1, true);
                        yahooData = processGrowwData(yahooData);
                        last45mins = yahooData.slice(-45);

                        while (exit == null) {
                            startDate.setDate(startDate.getDate() + 1)
                            endDate.setDate(endDate.getDate() + 1)

                            // Skip weekends and 26th Feb
                            if (
                                [0, 6].includes(startDate.getDay()) || 
                                (startDate.getDate() == 26 && startDate.getMonth()+1 == 2) || 
                                (startDate.getDate() == 14 && startDate.getMonth()+1 == 3)) {
                                continue;
                            }
                            currentDay++;
                            
                            const today = new Date()

                            //Only check todays data after markets closed
                            if (today.getUTCHours() < 10) {
                                today.setUTCHours(1, 0, 0, 0)
                            }

                            if (startDate > today) {
                                break;
                            }

                            let yahooData = await getGrowwChartData(stock.sym, startDate, endDate, 1, true);
                            yahooData = processGrowwData(yahooData);

                            if (currentDay == 1) {
                                if (stock.direction == 'BULLISH') {
                                    triggerPrice = entryTriggerPrice;
                                    stopLossPrice = last45mins.reduce((min, curr) => Math.min(min, curr.low), 1000000) - triggerPadding;
                                }
                                else if (stock.direction == 'BEARISH') {
                                    triggerPrice = entryTriggerPrice;
                                    stopLossPrice = last45mins.reduce((max, curr) => Math.max(max, curr.high), 0) + triggerPadding;
                                }
                            }
                            else {
                                if (stock.direction == 'BULLISH') {
                                    let last15minsHigh = last45mins.slice(-15).reduce((max, curr) => Math.max(max, curr.high), 0) + triggerPadding;
                                    let last45minsLow = last45mins.reduce((min, curr) => Math.min(min, curr.low), 1000000) - triggerPadding;
                                    triggerPrice = last15minsHigh;
                                    stopLossPrice = last45minsLow;
                                }
                                else if (stock.direction == 'BEARISH') {
                                    let last15minsLow = last45mins.slice(-15).reduce((min, curr) => Math.min(min, curr.low), 1000000) - triggerPadding;
                                    let last45minsHigh = last45mins.reduce((max, curr) => Math.max(max, curr.high), 0) + triggerPadding;
                                    triggerPrice = last15minsLow;
                                    stopLossPrice = last45minsHigh;
                                }
                            }

                            let quantity = Math.ceil(RISK_AMOUNT / Math.abs(triggerPrice - stopLossPrice));
                            quantity = Math.abs(quantity);
    

                            const sim = new Simulator({
                                stockSymbol: stock.sym,
                                triggerPrice,
                                targetPrice,
                                stopLossPrice,
                                quantity,
                                direction,
                                yahooData,
                                orderTime: new Date(startDate).setUTCHours(3, 45, 0, 0),
                                // cancelInMins: simulation.cancelInMins,
                                updateSL: simulation.updateSL,
                                updateSLInterval: simulation.updateSLInterval,
                                updateSLFrequency: simulation.updateSLFrequency,
                                // marketOrder: true // simulation.marketOrder
                            });

                            sim.run();

                            if (sim.exitReason == 'target') {
                                exit = 'target';
                            }
                            else {
                                let dayLow = yahooData.reduce((min, curr) => Math.min(min, curr.low), 1000000)
                                let dayHigh = yahooData.reduce((max, curr) => Math.max(max, curr.high), 0)
                                
                                if (dayLow < finalStopLossPrice && sim.direction == 'BULLISH') exit = 'finalstoploss';
                                else if (dayHigh > finalStopLossPrice && sim.direction == 'BEARISH') exit = 'finalstoploss';
                            }

                            if (currentDay == 1 && !sim.startedAt) {
                                exit = 'cancelled'
                            }

                            if (sim.exitReason == 'below-target') {
                                exit = 'below-target'
                            }

                            // if (sim.startedAt) {
                                perDayResults.push({
                                    startedAt: sim.startedAt,
                                    placedAt: sim.orderTime,
                                    pnl: sim.pnl || 0,
                                    quantity: sim.quantity,
                                    direction: sim.direction,
                                    sym: sim.stockSymbol,
                                    data: yahooData,
                                    tradeActions: sim.tradeActions,
                                    exitTime: sim.exitTime || null,
                                    exitReason: sim.exitReason,
                                    triggerPrice: triggerPrice,
                                    targetPrice: targetPrice,
                                    stopLossPrice: stopLossPrice,
                                    exit,
                                    currentDay
                                });
                            // }

                            // console.log(stock.sym, currentDay, exit)

                            if (!exit) {
                                last45mins = yahooData.slice(-45);
                            }

                        }

                        ///////////////////

                        // console.table(perDayResults.map(r => ({
                        //     sym:r.sym, 
                        //     pnl:r.pnl, 
                        //     // date:getDateStringIND(r.data[0].time), 
                        //     // startedAt: r.startedAt,
                        //     placedAt: getDateStringIND(r.placedAt),
                        //     exit: r.exit,
                        //     day:r.currentDay, 
                        //     placedAtTimestamp: r.placedAt,
                        //     // triggerPrice: r.triggerPrice,
                        //     // targetPrice: r.targetPrice, stopLossPrice: r.stopLossPrice
                        // })))

                        let reversePerDayResults = [...perDayResults].reverse()
                        let exitDate = reversePerDayResults.find(r => r.placedAt)?.placedAt
                        exitDate = exitDate && new Date(exitDate)
                        if (exitDate) {
                            exitDate.setUTCHours(11, 0, 0, 0)
                        }
                        else {
                            exitDate = null
                        }

                        let result = {
                            sym: stock.sym,
                            pnl: perDayResults.reduce((sum, r) => sum + r.pnl, 0),
                            placedAt: orderStartTime,
                            quantity: perDayResults.length + ' Days',
                            data: [], //perDayResults.map(r => r.data).flat(),
                            direction,
                            triggerPrice: entryTriggerPrice,
                            targetPrice,
                            stopLossPrice: finalStopLossPrice,
                            perDayResults,
                            exitDate
                        }

                        // console.log(result)

                        return result;
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

            // console.table(traded.map(t => ({sym: t.sym, pnl: t.pnl, placedAt: getDateStringIND(t.placedAt), placedAtUk: t.placedAt, startedAt: t.startedAt})))

            allTraded.push(...traded);


            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1)
        }

        let filTraded = []

        // console.log(filTraded)

        // console.table(allTraded.map(t => ({sym: t.sym, placedAt: t.placedAt, exitDate: t.exitDate})))

        // Filter out trades that were started after an active trade
        filTraded = allTraded.filter(t => !allTraded.find(t_prev => (
            (t.sym == t_prev.sym) && 
            (+t_prev.placedAt < +t.placedAt) && 
            (t_prev.exitDate && (+t_prev.exitDate > +t.placedAt))
        )))

        
        return filTraded;
    } catch (error) {
      console.error('Error fetching orders data:', error);
      return null;
    }
}

module.exports = {
    startLightyearSimulation,
    checkLightyearSimulationStatus
}
