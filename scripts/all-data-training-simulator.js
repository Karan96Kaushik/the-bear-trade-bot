const { getDataFromYahoo, processYahooData, getDateStringIND,
    getGrowwChartData, processGrowwData
 } = require("../kite/utils");
const { appendRowsToSheet, readSheetData } = require("../gsheets");
const { addMovingAverage, scanZaireStocks, countMATrendRising, 
    countMATrendFalling, checkMARising, checkMAFalling, checkUpwardTrend, 
    checkDownwardTrend, printTrendEmojis, isBullishCandle,
    addRSI, calculateBollingerBands, removeIncompleteCandles,
    getDateRange, DEFAULT_PARAMS } = require("../analytics");
// const { sendMessageToChannel } = require("./slack-actions");
const fs = require('fs');
const path = require('path');
const { Simulator } = require('../simulator/SimulatorV3');

function appendArrayToCSV(data, filePath=defaultFilePath) {
    const csvContent = data.map(row => row.join(',')).join('\n') + '\n';

    fs.appendFile(filePath, csvContent, 'utf8', (err) => {
        if (err) {
            console.error('Error appending to CSV file:', err);
        } else {
            console.log('Data successfully appended to CSV file.', filePath);
        }
    });
}


const sheetID = '17eVGOMlgO8M62PrD8JsPIRcavMmPz-KH7c8QW1edzZE'
const DEBUG = false

const interval = '5m'
// let sheetName = '29Nov'

// if (interval == '5m') {
//     sheetName = '5Dec-5m'
// }

let headers = {
    candleTimestamp: 'CandleTimestamp',
    orderTimestamp: 'OrderTimestamp',
    candleNum: 'CandleNum',
    sym: 'Sym',

    high: 'High',
    low: 'Low',
    open: 'Open',
    close: 'Close',
    volume: 'Volume',

    sma44: 'SMA44',
    rsi: 'RSI14',
    bb_middle: 'BB_Middle',
    bb_upper: 'BB_Upper',
    bb_lower: 'BB_Lower',

    sma44_1: 'SMA44_T-1',
    sma44_2: 'SMA44_T-2',
    sma44_3: 'SMA44_T-3',
    sma44_4: 'SMA44_T-4',


    t1h: 'T5-1H',
    t1l: 'T5-1L',
    t1o: 'T5-1O',
    t1c: 'T5-1C',

    t2h: 'T5-2H',
    t2l: 'T5-2L',
    t2o: 'T5-2O',
    t2c: 'T5-2C',

    t3h: 'T5-3H',
    t3l: 'T5-3L',
    t3o: 'T5-3O',
    t3c: 'T5-3C',

    t4h: 'T5-4H',
    t4l: 'T5-4L',
    t4o: 'T5-4O',
    t4c: 'T5-4C',

    t5h: 'T5-5H',
    t5l: 'T5-5L',
    t5o: 'T5-5O',
    t5c: 'T5-5C',





    t150h: 'T15-0H',
    t150l: 'T15-0L',
    t150o: 'T15-0O',
    t150c: 'T15-0C',

    t151h: 'T15-1H',
    t151l: 'T15-1L',
    t151o: 'T15-1O',
    t151c: 'T15-1C',

    t152h: 'T15-2H',
    t152l: 'T15-2L',
    t152o: 'T15-2O',
    t152c: 'T15-2C',

    t153h: 'T15-3H',
    t153l: 'T15-3L',
    t153o: 'T15-3O',
    t153c: 'T15-3C',

    t154h: 'T15-4H',
    t154l: 'T15-4L',
    t154o: 'T15-4O',
    t154c: 'T15-4C',



    t75h: 'T75-0H',
    t75l: 'T75-0L',
    t75o: 'T75-0O',
    t75c: 'T75-0C',

    t751h: 'T75-1H',
    t751l: 'T75-1L',
    t751o: 'T75-1O',
    t751c: 'T75-1C',

    t752h: 'T75-2H',
    t752l: 'T75-2L',
    t752o: 'T75-2O',
    t752c: 'T75-2C',

    t753h: 'T75-3H',
    t753l: 'T75-3L',
    t753o: 'T75-3O',
    t753c: 'T75-3C',

    t754h: 'T75-4H',
    t754l: 'T75-4L',
    t754o: 'T75-4O',
    t754c: 'T75-4C',

    t755h: 'T75-5H',
    t755l: 'T75-5L',
    t755o: 'T75-5O',
    t755c: 'T75-5C',

    

    // volume: 'Volume Prev Day Avg',
    // volume5m: 'Volume 5m',
    volume15m: 'Volume_15m',
    volume75m: 'Volume_75m',

    pnlBullish: 'PnL_Bullish',
    pnlBearish: 'PnL_Bearish',
    direction: 'Direction'
}

// Update headers for analytics fields
const analyticsHeaders = [
    'v3_result',
    'v3_5m_bearishSlope1', 'v3_5m_bearishSlope2', 'v3_5m_bullishSlope1', 'v3_5m_bullishSlope2', 'v3_5m_bearishCondition', 'v3_5m_bullishCondition', 'v3_5m_direction',
    'v3_15m_bearishSlope1', 'v3_15m_bearishSlope2', 'v3_15m_bullishSlope1', 'v3_15m_bullishSlope2', 'v3_15m_bearishCondition', 'v3_15m_bullishCondition', 'v3_15m_direction',
    'v3_75m_bearishSlope1', 'v3_75m_bearishSlope2', 'v3_75m_bullishSlope1', 'v3_75m_bullishSlope2', 'v3_75m_bearishCondition', 'v3_75m_bullishCondition', 'v3_75m_direction',
    'v3_candleMidToClose', 'v3_closeToCandleMid', 'v3_t2LowToCurrentLow', 'v3_t3LowToCurrentLow', 'v3_t2HighToCurrentHigh', 'v3_t3HighToCurrentHigh',
    'v3_touchingSmaHigh', 'v3_touchingSmaLow', 'v3_touchingSma15High', 'v3_touchingSma15Low', 'v3_touchingSma', 'v3_touchingSma15',
    'v3_range', 'v3_narrowRange', 'v3_wideRange',
    'v3_baseConditionsMet', 'v3_bearishConditionsMet', 'v3_bullishConditionsMet', 'v3_directionsMatch', 'v3_finalBearish', 'v3_finalBullish'
];

analyticsHeaders.forEach(header => {
    headers[header] = header;
});

const RISK_AMOUNT = 200

const simulation = {
    targetStopLossRatio: '2:2',
    cancelInMins: 5,
    updateSL: false, //true,
    updateSLInterval: 15,
    updateSLFrequency: 15,
}
const MA_WINDOW = 22

const runSimulation = async (stock, dayStartTime) => {


    const startTime = new Date(dayStartTime);
    startTime.setUTCHours(3, 45, 0, 0);

    const endTime = new Date(dayStartTime);
    endTime.setUTCHours(11, 0, 0, 0);

    
    // const useCached = true
    // let yahooData = await getDataFromYahoo(stock.sym, 5, '1m', startTime, endTime, useCached);
    // yahooData = processYahooData(yahooData, '1m', useCached);

    let yahooData = await getGrowwChartData(stock.sym, startTime, endTime, 1, true);
    yahooData = processGrowwData(yahooData);

    yahooData = addMovingAverage(yahooData,'close',22, 'sma44');

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

    // triggerPadding = 0

    if (direction == 'BULLISH') {
        triggerPrice = stock.high + triggerPadding;
        stopLossPrice = stock.low - (candleLength * (stopLossMultiplier - 1)) - triggerPadding;
        targetPrice = stock.high + (candleLength * targetMultiplier) + triggerPadding;
    }
    else {
        triggerPrice = stock.low - triggerPadding;
        stopLossPrice = stock.high + (candleLength * (stopLossMultiplier - 1)) + triggerPadding;
        targetPrice = stock.low - (candleLength * targetMultiplier) - triggerPadding;
    }
    
    triggerPrice = Math.round(triggerPrice * 10) / 10;
    stopLossPrice = Math.round(stopLossPrice * 10) / 10;
    targetPrice = Math.round(targetPrice * 10) / 10;

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
        orderTime: new Date(+dayStartTime),
        // orderTime: new Date(+dayStartTime + (5 * 60 * 1000)),
        cancelInMins: simulation.cancelInMins,
        updateSL: simulation.updateSL,
        updateSLInterval: simulation.updateSLInterval,
        updateSLFrequency: simulation.updateSLFrequency,
    });

    sim.run();

    // console.log(getDateStringIND(sim.orderTime), sim.pnl, sim.direction, sim.quantity, simulation)
    // console.table(sim.tradeActions.map(t => ({
    //     time: getDateStringIND(t.time),
    //     action: t.action,
    //     price: t.price,
    // })))

    // if (getDateStringIND(sim.orderTime) == '2025-03-20 13:10:20') {
    //     throw new Error('Test error')
    // }



    return {
        // startedAt: sim.startedAt,
        placedAt: sim.orderTime,
        pnl: sim.pnl || 0,
        // quantity: sim.quantity,
        direction: sim.direction,
        sym: sim.stockSymbol,
        // data: yahooData,
        // actions: sim.tradeActions,
        exitTime: sim.exitTime || null,
        triggerPrice: triggerPrice,
        targetPrice: targetPrice,
        stopLossPrice: stopLossPrice
    };
}


let defaultFilePath = `training_june23_simulator.csv`

let niftyList = []

const useCached = true

async function processStock(stock, date) {
    try {
        const { startDate, endDate } = getDateRange(date)
        startDate.setDate(startDate.getDate() - 2)
        const simulationResults = [];
        const baseTime = new Date(endDate);
        baseTime.setUTCHours(3, 45, 20, 0); // Start at 3:45 AM

        for (let i = 0; i < 6*12; i++) { 
            const index = i //parseInt(i/2)
            const isBullish = i % 2 == 0
            const intervalTime = new Date(baseTime);
            intervalTime.setMinutes(intervalTime.getMinutes() + (index * 5));
            console.log('intervalTime', intervalTime, 'stock', stock)

            let df5m = await getDataFromYahoo(stock, 2, '5m', startDate, intervalTime, useCached);
            df5m = processYahooData(df5m);
            df5m = addRSI(df5m, 14);
            df5m = calculateBollingerBands(df5m, 20, 2)
            df5m = addMovingAverage(df5m, 'close', MA_WINDOW, 'sma44');
            let df15m = []// await getDataFromYahoo(stock, 5, '15m', startDate, intervalTime, useCached);
            // df15m = processYahooData(df15m);
            // df15m = addMovingAverage(df15m, 'close', MA_WINDOW, 'sma44');
            const df75m = []// get75mCandleForTime(df15m, intervalTime);
            const current15mCandle = df15m[df15m.length - 1]
            const current5mCandle = df5m[df5m.length - 1]
            const current75mCandle = df75m[df75m.length - 1]
            // if (!current5mCandle || !current15mCandle || !current75mCandle) {
            //     console.log('No data for this interval', intervalTime)
            //     continue;
            // }
            // --- V3 Analytics ---
            let analyticsData = null;
            let timeStamp = null;


            let stockData = {
                sym: stock,
                high: current5mCandle.high,
                low: current5mCandle.low,
                open: current5mCandle.open,
                close: current5mCandle.close,
                volume: current5mCandle.volume,
                sma44: current5mCandle.sma44,
            };

            try {
                const { selectedStocks } = await scanZaireStocks([stock], intervalTime, '5m', false, true, true, DEFAULT_PARAMS, { all_results: true });
                // if (selectedStocks && selectedStocks.length > 0 && selectedStocks[0].data) {
                    analyticsData = selectedStocks[0]?.data;
                    timeStamp = selectedStocks[0]?.time;

                    if (selectedStocks[0]?.direction) {
                        console.log('selectedStocks', selectedStocks)
                        console.log('timeStamp', timeStamp)
                    }
                // }
            } catch (e) {
                console.warn('Analytics data fetch failed for', stock, e.message);
            }
            // ---
            const simResultBullish = await runSimulation({...stockData, direction: 'BULLISH'}, intervalTime);
            const simResultBearish = await runSimulation({...stockData, direction: 'BEARISH'}, intervalTime);

            simulationResults.push({
                candleTimestamp: timeStamp,
                orderTimestamp: getDateStringIND(simResultBullish.placedAt),
                candleNum: index,
                sym: stock,
                high: current5mCandle.high,
                low: current5mCandle.low,
                open: current5mCandle.open,
                close: current5mCandle.close,
                volume: current5mCandle.volume,
                sma44: current5mCandle.sma44,
                rsi: current5mCandle.rsi,
                bb_middle: current5mCandle.bb_middle,
                bb_upper: current5mCandle.bb_upper,
                bb_lower: current5mCandle.bb_lower,
                sma44_1: df5m.length > 1 ? df5m[df5m.length - 2].sma44 : null,
                sma44_2: df5m.length > 2 ? df5m[df5m.length - 3].sma44 : null,
                sma44_3: df5m.length > 3 ? df5m[df5m.length - 4].sma44 : null,
                sma44_4: df5m.length > 4 ? df5m[df5m.length - 5].sma44 : null,
                t1h: df5m.length > 1 ? df5m[df5m.length - 2].high : null,
                t1l: df5m.length > 1 ? df5m[df5m.length - 2].low : null,
                t1o: df5m.length > 1 ? df5m[df5m.length - 2].open : null,
                t1c: df5m.length > 1 ? df5m[df5m.length - 2].close : null,
                t2h: df5m.length > 2 ? df5m[df5m.length - 3].high : null,
                t2l: df5m.length > 2 ? df5m[df5m.length - 3].low : null,
                t2o: df5m.length > 2 ? df5m[df5m.length - 3].open : null,
                t2c: df5m.length > 2 ? df5m[df5m.length - 3].close : null,
                t3h: df5m.length > 3 ? df5m[df5m.length - 4].high : null,
                t3l: df5m.length > 3 ? df5m[df5m.length - 4].low : null,
                t3o: df5m.length > 3 ? df5m[df5m.length - 4].open : null,
                t3c: df5m.length > 3 ? df5m[df5m.length - 4].close : null,
                t4h: df5m.length > 4 ? df5m[df5m.length - 5].high : null,
                t4l: df5m.length > 4 ? df5m[df5m.length - 5].low : null,
                t4o: df5m.length > 4 ? df5m[df5m.length - 5].open : null,
                t4c: df5m.length > 4 ? df5m[df5m.length - 5].close : null,
                t5h: df5m.length > 5 ? df5m[df5m.length - 6].high : null,
                t5l: df5m.length > 5 ? df5m[df5m.length - 6].low : null,
                t5o: df5m.length > 5 ? df5m[df5m.length - 6].open : null,
                t5c: df5m.length > 5 ? df5m[df5m.length - 6].close : null,
                // t150h: current15mCandle.high,
                // t150l: current15mCandle.low,
                // t150o: current15mCandle.open,
                // t150c: current15mCandle.close,
                // t151h: df15m.length > 1 ? df15m[df15m.length - 2].high : null,
                // t151l: df15m.length > 1 ? df15m[df15m.length - 2].low : null,
                // t151o: df15m.length > 1 ? df15m[df15m.length - 2].open : null,
                // t151c: df15m.length > 1 ? df15m[df15m.length - 2].close : null,
                // t152h: df15m.length > 2 ? df15m[df15m.length - 3].high : null,
                // t152l: df15m.length > 2 ? df15m[df15m.length - 3].low : null,
                // t152o: df15m.length > 2 ? df15m[df15m.length - 3].open : null,
                // t152c: df15m.length > 2 ? df15m[df15m.length - 3].close : null,
                // t153h: df15m.length > 3 ? df15m[df15m.length - 4].high : null,
                // t153l: df15m.length > 3 ? df15m[df15m.length - 4].low : null,
                // t153o: df15m.length > 3 ? df15m[df15m.length - 4].open : null,
                // t153c: df15m.length > 3 ? df15m[df15m.length - 4].close : null,
                // t154h: df15m.length > 4 ? df15m[df15m.length - 5].high : null,
                // t154l: df15m.length > 4 ? df15m[df15m.length - 5].low : null,
                // t154o: df15m.length > 4 ? df15m[df15m.length - 5].open : null,
                // t154c: df15m.length > 4 ? df15m[df15m.length - 5].close : null,
                // t75h: current75mCandle.high,
                // t75l: current75mCandle.low,
                // t75o: current75mCandle.open,
                // t75c: current75mCandle.close,
                // t751h: df75m.length > 1 ? df75m[df75m.length - 2].high : null,
                // t751l: df75m.length > 1 ? df75m[df75m.length - 2].low : null,
                // t751o: df75m.length > 1 ? df75m[df75m.length - 2].open : null,
                // t751c: df75m.length > 1 ? df75m[df75m.length - 2].close : null,
                // t752h: df75m.length > 2 ? df75m[df75m.length - 3].high : null,
                // t752l: df75m.length > 2 ? df75m[df75m.length - 3].low : null,
                // t752o: df75m.length > 2 ? df75m[df75m.length - 3].open : null,
                // t752c: df75m.length > 2 ? df75m[df75m.length - 3].close : null,
                // t753h: df75m.length > 3 ? df75m[df75m.length - 4].high : null,
                // t753l: df75m.length > 3 ? df75m[df75m.length - 4].low : null,
                // t753o: df75m.length > 3 ? df75m[df75m.length - 4].open : null,
                // t753c: df75m.length > 3 ? df75m[df75m.length - 4].close : null,
                // t754h: df75m.length > 4 ? df75m[df75m.length - 5].high : null,
                // t754l: df75m.length > 4 ? df75m[df75m.length - 5].low : null,
                // t754o: df75m.length > 4 ? df75m[df75m.length - 5].open : null,
                // t754c: df75m.length > 4 ? df75m[df75m.length - 5].close : null,
                // t755h: df75m.length > 5 ? df75m[df75m.length - 6].high : null,
                // t755l: df75m.length > 5 ? df75m[df75m.length - 6].low : null,
                // t755o: df75m.length > 5 ? df75m[df75m.length - 6].open : null,
                // t755c: df75m.length > 5 ? df75m[df75m.length - 6].close : null,
                // volume15m: current15mCandle.volume,
                // volume75m: current75mCandle.volume,
                pnlBullish: simResultBullish.pnl,
                pnlBearish: simResultBearish.pnl,
                direction: '',
                triggerPrice: '', //simResult.triggerPrice,
                targetPrice: '', //simResult.targetPrice,
                stopLossPrice: '', //simResult.stopLossPrice,
                // --- analytics fields ---
                v3_result: analyticsData?.result ?? '',
                v3_5m_bearishSlope1: analyticsData?.slopes?.fiveMin?.bearishSlope1 ?? '',
                v3_5m_bearishSlope2: analyticsData?.slopes?.fiveMin?.bearishSlope2 ?? '',
                v3_5m_bullishSlope1: analyticsData?.slopes?.fiveMin?.bullishSlope1 ?? '',
                v3_5m_bullishSlope2: analyticsData?.slopes?.fiveMin?.bullishSlope2 ?? '',
                v3_5m_bearishCondition: analyticsData?.slopes?.fiveMin?.bearishCondition ?? '',
                v3_5m_bullishCondition: analyticsData?.slopes?.fiveMin?.bullishCondition ?? '',
                v3_5m_direction: analyticsData?.slopes?.fiveMin?.direction ?? '',
                v3_15m_bearishSlope1: analyticsData?.slopes?.fifteenMin?.bearishSlope1 ?? '',
                v3_15m_bearishSlope2: analyticsData?.slopes?.fifteenMin?.bearishSlope2 ?? '',
                v3_15m_bullishSlope1: analyticsData?.slopes?.fifteenMin?.bullishSlope1 ?? '',
                v3_15m_bullishSlope2: analyticsData?.slopes?.fifteenMin?.bullishSlope2 ?? '',
                v3_15m_bearishCondition: analyticsData?.slopes?.fifteenMin?.bearishCondition ?? '',
                v3_15m_bullishCondition: analyticsData?.slopes?.fifteenMin?.bullishCondition ?? '',
                v3_15m_direction: analyticsData?.slopes?.fifteenMin?.direction ?? '',
                v3_75m_bearishSlope1: analyticsData?.slopes?.seventyFiveMin?.bearishSlope1 ?? '',
                v3_75m_bearishSlope2: analyticsData?.slopes?.seventyFiveMin?.bearishSlope2 ?? '',
                v3_75m_bullishSlope1: analyticsData?.slopes?.seventyFiveMin?.bullishSlope1 ?? '',
                v3_75m_bullishSlope2: analyticsData?.slopes?.seventyFiveMin?.bullishSlope2 ?? '',
                v3_75m_bearishCondition: analyticsData?.slopes?.seventyFiveMin?.bearishCondition ?? '',
                v3_75m_bullishCondition: analyticsData?.slopes?.seventyFiveMin?.bullishCondition ?? '',
                v3_75m_direction: analyticsData?.slopes?.seventyFiveMin?.direction ?? '',
                v3_candleMidToClose: analyticsData?.ratios?.candleMidToClose ?? '',
                v3_closeToCandleMid: analyticsData?.ratios?.closeToCandleMid ?? '',
                v3_t2LowToCurrentLow: analyticsData?.ratios?.t2LowToCurrentLow ?? '',
                v3_t3LowToCurrentLow: analyticsData?.ratios?.t3LowToCurrentLow ?? '',
                v3_t2HighToCurrentHigh: analyticsData?.ratios?.t2HighToCurrentHigh ?? '',
                v3_t3HighToCurrentHigh: analyticsData?.ratios?.t3HighToCurrentHigh ?? '',
                v3_touchingSmaHigh: analyticsData?.smaTouching?.touchingSmaHigh ?? '',
                v3_touchingSmaLow: analyticsData?.smaTouching?.touchingSmaLow ?? '',
                v3_touchingSma15High: analyticsData?.smaTouching?.touchingSma15High ?? '',
                v3_touchingSma15Low: analyticsData?.smaTouching?.touchingSma15Low ?? '',
                v3_touchingSma: analyticsData?.smaTouching?.touchingSma ?? '',
                v3_touchingSma15: analyticsData?.smaTouching?.touchingSma15 ?? '',
                v3_range: analyticsData?.rangeConditions?.range ?? '',
                v3_narrowRange: analyticsData?.rangeConditions?.narrowRange ?? '',
                v3_wideRange: analyticsData?.rangeConditions?.wideRange ?? '',
                v3_baseConditionsMet: analyticsData?.conditions?.baseConditionsMet ?? '',
                v3_bearishConditionsMet: analyticsData?.conditions?.bearishConditionsMet ?? '',
                v3_bullishConditionsMet: analyticsData?.conditions?.bullishConditionsMet ?? '',
                v3_directionsMatch: analyticsData?.conditions?.directionsMatch ?? '',
                v3_finalBearish: analyticsData?.conditions?.finalBearish ?? '',
                v3_finalBullish: analyticsData?.conditions?.finalBullish ?? ''
            });
        }
        return simulationResults;
    } catch (error) {
        console.trace(error)
        console.log(`Error processing ${stock}:`, error?.response?.data || error?.message);
        return null;
    }
}


async function setupAllStocks(date) {
    try {
        
        console.log('date', date);
        console.log('---');

        const maxConcurrent = 3;
        let rows = [];
        let activePromises = new Set();
        let stockIndex = 0;

        // Process stocks while maintaining pool of promises
        while (stockIndex < niftyList.length || activePromises.size > 0) {
            // Fill the promise pool up to maxConcurrent
            while (activePromises.size < maxConcurrent && stockIndex < niftyList.length) {
                const stock = niftyList[stockIndex];
                const promise = processStock(stock, date)
                    .then(result => {
                        if (result !== null) {
                            // console.log('result', result)
                            rows.push(result);
                        }
                        activePromises.delete(promise);
                    });
                
                activePromises.add(promise);
                stockIndex++;
            }

            // Wait for at least one promise to complete before next iteration
            if (activePromises.size > 0) {
                await Promise.all(activePromises);
            }
        }

        // console.log(rows)

        rows = rows.flat()

        // console.log('rows', rows)

        // console.log('headers', headers)

        rows = rows.map(row => Object.keys(headers).map(key => row[key]))

        // Update CSV file
        await appendArrayToCSV(rows);

    } catch (error) {
        console.trace('Error in setupAllStocks:', error?.response?.data || error?.message);
    }
}

defaultFilePath = `training_june23_simulator_${interval}_${MA_WINDOW}.csv`

const run = async () => {


    // let startTime = new Date(`2024-11-15`).setUTCHours(4, 0, 10, 0);
    // let endTime = new Date(`2024-11-26`).setUTCHours(4, 15, 10, 0);

    // await getDailyStats(startTime, endTime)

    // return



    appendArrayToCSV([ [ ...Object.values(headers) ] ]);

    // niftyList = await readSheetData(sheetRange)  
    // niftyList = niftyList.map(stock => stock[0])

    niftyList = fs.readFileSync('nifty-list-50.csv', 'utf8')
                    .split('\n')
                    .map(row => row.trim())

    console.log('niftyList', niftyList)

    // niftyList = ['GODREJPROP']

    
    const baseDate = new Date(`2025-06-01`)
    
    baseDate.setUTCHours(3, 45, 10, 0);

    const today = new Date('2025-06-27')
    today.setUTCHours(3, 0, 0, 0);
    // const days = 50
    // baseDate.setDate(baseDate.getDate() - days)

    while (baseDate < today) {

        baseDate.setDate(baseDate.getDate() + 1)

        if ([0,6].includes(baseDate.getDay())) {
            console.log('Skipping weekend', baseDate)
            continue
        }

        console.log('baseDate', baseDate)

        await setupAllStocks(baseDate)

    }

    console.log('Done')
    console.log(defaultFilePath)
    // process.exit()
}

run()