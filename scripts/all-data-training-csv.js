const { getDataFromYahoo, processYahooData, getDateStringIND } = require("../kite/utils");
const { appendRowsToSheet, readSheetData } = require("../gsheets");
const { addMovingAverage, scanZaireStocks, countMATrendRising, 
    countMATrendFalling, checkMARising, checkMAFalling, checkUpwardTrend, 
    checkDownwardTrend, printTrendEmojis, isBullishCandle,
    addRSI, calculateBollingerBands, DEFAULT_PARAMS } = require("../analytics");
// const { sendMessageToChannel } = require("./slack-actions");
const fs = require('fs');
const path = require('path');

function appendArrayToCSV(data, filePath=defaultFilePath) {
    const csvContent = data.map(row => row.join(',')).join('\n') + '\n';

    fs.appendFile(filePath, csvContent, 'utf8', (err) => {
        if (err) {
            console.error('Error appending to CSV file:', err);
        } else {
            console.log('Data successfully appended to CSV file.');
        }
    });
}

const sheetID = '17eVGOMlgO8M62PrD8JsPIRcavMmPz-KH7c8QW1edzZE'
const DEBUG = false

const interval = '15m'
// let sheetName = '29Nov'

// if (interval == '5m') {
//     sheetName = '5Dec-5m'
// }


let defaultFilePath = `training_1_${interval}.csv`

let sheetRange = 'HIGHBETA!B2:B200'
sheetRange = '4Dec-notif-list!A1:A200'

let niftyList = []

async function processBatch(stocks, startTime, endTime, candleType) {
    return Promise.all(stocks.map(stock => processStock(stock, startTime, endTime, candleType)));
}

async function processStock(stock, startTime, endTime, candleType) {
    try {
        const data = await getDataFromYahoo(stock, 1, interval, startTime, endTime);
        let candles = processYahooData(data);

        let startTimeDay = new Date(endTime)
        // startTimeDay.setUTCHours(0, 0, 10, 0)
        // startTimeDay.setDate(startTimeDay.getDate() - 5)
        let endTimeDay = new Date(endTime)
        endTimeDay.setUTCHours(23, 0, 10, 0)

        const dataDay = await getDataFromYahoo(stock, 1, '15m', startTimeDay, endTimeDay);
        // console.log(startTimeDay, endTimeDay, dataDay.chart.result)
        let candlesDay = processYahooData(dataDay);

        // console.log(startTimeDay, endTimeDay, candlesDay)

        const dayHigh = Math.max(...candlesDay.map(candle => candle.high));
        const dayLow = Math.min(...candlesDay.map(candle => candle.low));

        // console.log(candlesDay, new Date(candlesDay[candlesDay.length - 1].time))

        // console.log(candles[candles.length - 2])
        // console.log(new Date(candles[candles.length - 2].time))
        // return
        // Calculate SMA44

        candles = addMovingAverage(candles, 'close', 44, 'sma44');
        candles = addRSI(candles, 14);
        candles = calculateBollingerBands(candles, 20, 2)

        // console.log(candles)
        // return

        const getPreviousTradingDay = (currentDate, daysToLookBack = 1) => {
            const date = new Date(currentDate);
            date.setDate(date.getDate() - daysToLookBack);
            return date.getDate();
        };

        const currentCandleDate = new Date(candles[candles.length - 2].time);
        let prevDayCandles = [];
        
        // Look back up to 5 trading days to find previous day data
        for (let daysBack = 1; daysBack <= 5; daysBack++) {
            prevDayCandles = candles.filter(candle => 
                new Date(candle.time).getDate() === getPreviousTradingDay(currentCandleDate, daysBack)
            );
            
            if (prevDayCandles.length > 0) break;
        }

        if (prevDayCandles.length === 0) {
            console.warn(`No previous day data found for ${stock}`);
            return null; // Skip this stock if no previous day data found
        }

        const { 
            high,
            low,
            open,
            close,
            sma44,
            time,
            rsi,
            bb_middle,
            bb_upper,
            bb_lower,
            volume
        } = candles[candles.length - 2]

        console.log(getDateStringIND(new Date(time)))

        const { high: highDay, low: lowDay, volume: volumeDay } = candlesDay[candlesDay.length - 1]

        // if (rows.length == 0) {
        //     rows.push(['' + interval + ' - ' + getDateStringIND(new Date(time))]);
        // }

        const maValues = candles.map(row => row['sma44']) //.reverse() //.slice(0, -2);
        
        const countRising = countMATrendRising(maValues)
        const countFalling = countMATrendFalling(maValues)

        const trendEmojis = printTrendEmojis(maValues.reverse().slice(0, 10))
        console.log(trendEmojis)

        // console.log(maValues.reverse().slice(0, 10))
        // console.log(countRising, countFalling)
        
        let isRising = null

        if (countRising == countFalling) {
            if (maValues[maValues.length - 1] > maValues[maValues.length - 2]) {
                isRising = 'BULLISH'
            }
            else if (maValues[maValues.length - 1] < maValues[maValues.length - 2]) {
                isRising = 'BEARISH'
            }
            else if (maValues[maValues.length - 2] > maValues[maValues.length - 3]) {
                isRising = 'BULLISH'
            }
            else if (maValues[maValues.length - 2] < maValues[maValues.length - 3]) {
                isRising = 'BEARISH'
            }
        }
        else {
            isRising = countRising > countFalling ? 'BULLISH' : 'BEARISH'
        }

        if (DEBUG) {
            console.log(stock, isRising)
        }
        // if (!isRising) continue;

        const firstCandle = candles[candles.length - 1];
        const maValue = firstCandle['sma44'];

        // let trend = isRising == 'BULLISH'
        //     ? checkUpwardTrend(candles, candles.length - 1)
        //     : checkDownwardTrend(candles, candles.length - 1);

        // const candleMatched

        // if (!trend) {
        let trend = isRising // (trendCountRising > trendCountFalling ? 'BULLISH' : 'BEARISH')
        // }

        // if (!trend) {
        //     if (isBullishCandle(candles[candles.length - 2])) {
        //         trend = 'BULLISH'
        //     }
        //     else {
        //         trend = 'BEARISH'
        //     }
        // }

        let candleCleared, triggerPrice, stopLossPrice, targetPrice, acheieved, count

        if (trend === 'BULLISH' ) {
            candleCleared = checkUpwardTrend(candles, candles.length - 2) ? true : false
            triggerPrice = high + 1;
            stopLossPrice = low - 1;
            targetPrice = ((high - low) * 2) + triggerPrice;
            acheieved = dayHigh > targetPrice ? true : false
            count = countRising
            console.log(stock, 'bullish', triggerPrice, stopLossPrice, targetPrice, acheieved, count)
        }
        else if (trend === 'BEARISH' ) {
            candleCleared = checkDownwardTrend(candles, candles.length - 2) ? true : false
            triggerPrice = low - 1;
            stopLossPrice = high + 1;
            targetPrice = (triggerPrice - (high - low)* 2);
            acheieved = dayLow < targetPrice ? true : false
            count = countFalling
            console.log(stock, 'bearish', triggerPrice, stopLossPrice, targetPrice, acheieved, count)
        }

        // console.log(stock, trendCountRising, trendCountFalling, trend, candleCleared)
        // console.log(scanZaireStocks())
        // console.log({...candles[candles.length - 2], time: new Date(candles[candles.length - 2].time)})
        // return
        // if (false)

        // --- Call scanZaireStocks for analytics data ---
        let analyticsData = null;
        try {
            const { selectedStocks } = await scanZaireStocks([stock], endTime, '15m', false, true, true, DEFAULT_PARAMS, { all_results: true });
            if (selectedStocks && selectedStocks.length > 0 && selectedStocks[0].data) {
                analyticsData = selectedStocks[0].data;
            }
        } catch (e) {
            console.warn('Analytics data fetch failed for', stock, e.message);
        }

        // Prepare analytics fields for CSV
        let analyticsFields = [];
        if (analyticsData) {
            analyticsFields = [
                // V3 main result
                analyticsData.result,
                // --- Slopes ---
                analyticsData.slopes?.fiveMin?.bearishSlope1,
                analyticsData.slopes?.fiveMin?.bearishSlope2,
                analyticsData.slopes?.fiveMin?.bullishSlope1,
                analyticsData.slopes?.fiveMin?.bullishSlope2,
                analyticsData.slopes?.fiveMin?.bearishCondition,
                analyticsData.slopes?.fiveMin?.bullishCondition,
                analyticsData.slopes?.fiveMin?.direction,
                analyticsData.slopes?.fifteenMin?.bearishSlope1,
                analyticsData.slopes?.fifteenMin?.bearishSlope2,
                analyticsData.slopes?.fifteenMin?.bullishSlope1,
                analyticsData.slopes?.fifteenMin?.bullishSlope2,
                analyticsData.slopes?.fifteenMin?.bearishCondition,
                analyticsData.slopes?.fifteenMin?.bullishCondition,
                analyticsData.slopes?.fifteenMin?.direction,
                analyticsData.slopes?.seventyFiveMin?.bearishSlope1,
                analyticsData.slopes?.seventyFiveMin?.bearishSlope2,
                analyticsData.slopes?.seventyFiveMin?.bullishSlope1,
                analyticsData.slopes?.seventyFiveMin?.bullishSlope2,
                analyticsData.slopes?.seventyFiveMin?.bearishCondition,
                analyticsData.slopes?.seventyFiveMin?.bullishCondition,
                analyticsData.slopes?.seventyFiveMin?.direction,
                // --- Ratios ---
                analyticsData.ratios?.candleMidToClose,
                analyticsData.ratios?.closeToCandleMid,
                analyticsData.ratios?.t2LowToCurrentLow,
                analyticsData.ratios?.t3LowToCurrentLow,
                analyticsData.ratios?.t2HighToCurrentHigh,
                analyticsData.ratios?.t3HighToCurrentHigh,
                // --- SMA Touching ---
                analyticsData.smaTouching?.touchingSmaHigh,
                analyticsData.smaTouching?.touchingSmaLow,
                analyticsData.smaTouching?.touchingSma15High,
                analyticsData.smaTouching?.touchingSma15Low,
                analyticsData.smaTouching?.touchingSma,
                analyticsData.smaTouching?.touchingSma15,
                // --- Range Conditions ---
                analyticsData.rangeConditions?.range,
                analyticsData.rangeConditions?.narrowRange,
                analyticsData.rangeConditions?.wideRange,
                // --- Final Conditions ---
                analyticsData.conditions?.baseConditionsMet,
                analyticsData.conditions?.bearishConditionsMet,
                analyticsData.conditions?.bullishConditionsMet,
                analyticsData.conditions?.directionsMatch,
                analyticsData.conditions?.finalBearish,
                analyticsData.conditions?.finalBullish
            ];
        } else {
            analyticsFields = Array(36).fill('');
        }

        return [
            getDateStringIND(new Date(time)),
            candleType,
            stock,
            high,
            low,
            open,
            close,
            volume,
            sma44,
            rsi,
            bb_middle,
            bb_upper,
            bb_lower,
            candles[candles.length - 3].high,
            candles[candles.length - 3].low,
            candles[candles.length - 3].open,
            candles[candles.length - 3].close,
            candles[candles.length - 4].high,
            candles[candles.length - 4].low,
            candles[candles.length - 4].open,
            candles[candles.length - 4].close,
            candles[candles.length - 5].high,
            candles[candles.length - 5].low,
            candles[candles.length - 5].open,
            candles[candles.length - 5].close,
            volumeDay / (6*4),
            prevDayCandles[prevDayCandles.length - 1].volume,
            prevDayCandles[prevDayCandles.length - 2].volume,
            prevDayCandles[prevDayCandles.length - 3].volume,
            dayLow,
            dayHigh,
            trend,
            count,
            acheieved,
            ...analyticsFields
        ];
    } catch (error) {
        console.trace(`Error processing ${stock}:`, error?.response?.data || error?.message);
        return null;
    }
}

async function getDailyStats(startTime, endTime, candleType) {
    try {
        console.log(startTime, endTime);
        console.log('---');

        const maxConcurrent = 3;
        const rows = [];
        let activePromises = new Set();
        let stockIndex = 0;

        // Process stocks while maintaining pool of promises
        while (stockIndex < niftyList.length || activePromises.size > 0) {
            // Fill the promise pool up to maxConcurrent
            while (activePromises.size < maxConcurrent && stockIndex < niftyList.length) {
                const stock = niftyList[stockIndex];
                const promise = processStock(stock, startTime, endTime, candleType)
                    .then(result => {
                        if (result !== null) {
                            rows.push(result);
                        }
                        activePromises.delete(promise);
                    });
                
                activePromises.add(promise);
                stockIndex++;
            }

            // Wait for at least one promise to complete before next iteration
            if (activePromises.size > 0) {
                await Promise.race(activePromises);
            }
        }

        // Update CSV file
        await appendArrayToCSV(rows);

    } catch (error) {
        console.trace('Error in getDailyStats:', error?.response?.data || error?.message);
    }
}

defaultFilePath = `training_2_${interval}.csv`

const run = async () => {


    // let startTime = new Date(`2024-11-15`).setUTCHours(4, 0, 10, 0);
    // let endTime = new Date(`2024-11-26`).setUTCHours(4, 15, 10, 0);

    // await getDailyStats(startTime, endTime)

    // return

    const headers = [
        'Timestamp',
        'Candle Type',
        'Sym',
        'High',
        'Low',
        'Open',
        'Close',
        'Volume',
        'SMA44',
        'RSI14',
        'BB Middle',
        'BB Upper',
        'BB Lower',
        'T1H',
        'T1L',
        'T1O',
        'T1C',
        'T2H',
        'T2L',
        'T2O',
        'T2C',
        'T3H',
        'T3L',
        'T3O',
        'T3C',
        'Volume Prev Day Avg',
        'Volume P Last',
        'Volume P 2nd Last',
        'Volume P 3rd Last',
        'Low Day',
        'High Day',
        'MA Direction',
        'MA Trend Count',
        'Acheieved',
        // --- Analytics fields ---
        'V3 Result',
        // Slopes 5m
        'V3 5m BearishSlope1',
        'V3 5m BearishSlope2',
        'V3 5m BullishSlope1',
        'V3 5m BullishSlope2',
        'V3 5m BearishCondition',
        'V3 5m BullishCondition',
        'V3 5m Direction',
        // Slopes 15m
        'V3 15m BearishSlope1',
        'V3 15m BearishSlope2',
        'V3 15m BullishSlope1',
        'V3 15m BullishSlope2',
        'V3 15m BearishCondition',
        'V3 15m BullishCondition',
        'V3 15m Direction',
        // Slopes 75m
        'V3 75m BearishSlope1',
        'V3 75m BearishSlope2',
        'V3 75m BullishSlope1',
        'V3 75m BullishSlope2',
        'V3 75m BearishCondition',
        'V3 75m BullishCondition',
        'V3 75m Direction',
        // Ratios
        'V3 CandleMidToClose',
        'V3 CloseToCandleMid',
        'V3 T2LowToCurrentLow',
        'V3 T3LowToCurrentLow',
        'V3 T2HighToCurrentHigh',
        'V3 T3HighToCurrentHigh',
        // SMA Touching
        'V3 TouchingSmaHigh',
        'V3 TouchingSmaLow',
        'V3 TouchingSma15High',
        'V3 TouchingSma15Low',
        'V3 TouchingSma',
        'V3 TouchingSma15',
        // Range Conditions
        'V3 Range',
        'V3 NarrowRange',
        'V3 WideRange',
        // Final Conditions
        'V3 BaseConditionsMet',
        'V3 BearishConditionsMet',
        'V3 BullishConditionsMet',
        'V3 DirectionsMatch',
        'V3 FinalBearish',
        'V3 FinalBullish'
    ]

    appendArrayToCSV([headers]);

    // niftyList = await readSheetData(sheetRange)  
    // niftyList = niftyList.map(stock => stock[0])

    niftyList = fs.readFileSync('nifty-list.csv', 'utf8')
                    .split('\n')
                    .map(row => row.split(',')[0])

    console.log(niftyList)

    const baseDate = new Date(`2025-06-09`)
    // const baseDate = new Date(`2024-11-01`)

    // const days = 50
    // baseDate.setDate(baseDate.getDate() - days)

    while (baseDate < new Date('2025-06-09')) {

        baseDate.setDate(baseDate.getDate() + 1)

        if ([0,6].includes(baseDate.getDay())) {
            console.log('Skipping weekend', baseDate)
            continue
        }

        console.log(baseDate)

        let startTime = new Date(baseDate)
        startTime.setUTCHours(4, 0, 10, 0);
        startTime.setDate(startTime.getDate() - 6)

        let endTime = new Date(baseDate);
        endTime.setUTCHours(4, 1, 10, 0);
        if (interval == '5m') {
            endTime.setUTCHours(3, 51, 10, 0);
        }

        console.log(startTime, endTime)
        await getDailyStats(startTime, endTime, 'F')

    }
}

run()