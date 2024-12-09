const { getDataFromYahoo, processYahooData, getDateStringIND } = require("../kite/utils");
const { appendRowsToSheet, readSheetData } = require("../gsheets");
const { addMovingAverage, scanZaireStocks, countMATrendRising, 
    countMATrendFalling, checkMARising, checkMAFalling, checkUpwardTrend, 
    checkDownwardTrend, printTrendEmojis, isBullishCandle,
    addRSI, calculateBollingerBands} = require("../analytics");
// const { sendMessageToChannel } = require("./slack-actions");
const fs = require('fs');
const path = require('path');

let defaultFilePath = 'training.csv'

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
let sheetName = '29Nov'

if (interval == '5m') {
    sheetName = '5Dec-5m'
}

sheetName = '5Dec-15m-Notif'

let sheetRange = 'HIGHBETA!B2:B200'
sheetRange = '4Dec-notif-list!A1:A200'

let niftyList = []

async function getDailyStats(startTime, endTime, candleType) {
    try {

        console.log(startTime, endTime)

        console.log('---')

        const rows = [
        ];

        for (const stock of niftyList) {
            try {

                // startTime = new Date().setUTCHours(4, 0, 10, 0) / 1000;
                // endTime = new Date() / 1000;

                // const sym = `NSE:${stock}`;
                // Get 1-minute candles for today

                const data = await getDataFromYahoo(stock, 1, interval, startTime, endTime);
                let candles = processYahooData(data);

                let startTimeDay = new Date(endTime)
                startTimeDay.setUTCHours(0, 0, 10, 0)
                startTimeDay.setDate(startTimeDay.getDate() - 5)
                let endTimeDay = new Date(endTime)
                endTimeDay.setUTCHours(23, 0, 10, 0)

                const dataDay = await getDataFromYahoo(stock, 1, '1d', startTimeDay, endTimeDay);
                let candlesDay = processYahooData(dataDay);

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
                    continue; // Skip this stock if no previous day data found
                }

                const { high,
                    low,
                    open,
                    close,
                    sma44,
                    time,
                    rsi,
                    bb_middle,
                    bb_upper,
                    bb_lower } = candles[candles.length - 2]

                console.log(new Date(time))

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
                    acheieved = highDay > targetPrice ? true : false
                    count = countRising
                    console.log(stock, 'bullish', triggerPrice, stopLossPrice, targetPrice, acheieved, count)
                }
                else if (trend === 'BEARISH' ) {
                    candleCleared = checkDownwardTrend(candles, candles.length - 2) ? true : false
                    triggerPrice = low - 1;
                    stopLossPrice = high + 1;
                    targetPrice = (triggerPrice - (high - low)* 2);
                    acheieved = lowDay < targetPrice ? true : false
                    count = countFalling
                    console.log(stock, 'bearish', triggerPrice, stopLossPrice, targetPrice, acheieved, count)
                }

                // console.log(stock, trendCountRising, trendCountFalling, trend, candleCleared)
                // console.log(scanZaireStocks())
                // console.log({...candles[candles.length - 2], time: new Date(candles[candles.length - 2].time)})
                // return
                // if (false)

                rows.push([
                    getDateStringIND(new Date(time)),
                    candleType,
                    stock,          // Stock
                    high,           // H
                    low,            // L
                    open,           // O
                    close,          // C
                    sma44,          // SMA44
                    rsi,          // RSI14
                    bb_middle,
                    bb_upper,
                    bb_lower,

                    volumeDay / (6*4),      // Volume Day
                    prevDayCandles[prevDayCandles.length - 1].volume,         // Volume
                    prevDayCandles[prevDayCandles.length - 2].volume,         // Volume
                    prevDayCandles[prevDayCandles.length - 3].volume,         // Volume

                    lowDay,         // L
                    highDay,        // H

                    trend,      // Continuous Up/Down MA
                    count,         // Count

                    // candleCleared,
                    // targetPrice,
                    // stopLossPrice,

                    acheieved
                ]);

            } catch (error) {
                console.trace(`Error processing ${stock}:`, error?.response?.data || error?.message);
                // await sendMessageToChannel(`❌ Error processing ${stock}:`, error.message);
            }
        }

        // Update Google Sheet
        await appendArrayToCSV(rows);
        // await sendMessageToChannel('✅ Successfully updated daily stats sheet');

    } catch (error) {
        console.trace('Error in getDailyStats:', error?.response?.data || error?.message);
        // await sendMessageToChannel('❌ Error updating daily stats:', error.message);
    }
}

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
        'SMA44',
        'RSI14',
        'BB Middle',
        'BB Upper',
        'BB Lower',
        'Volume Prev Day Avg',
        'Volume P Last',
        'Volume P 2nd Last',
        'Volume P 3rd Last',
        'Low Day',
        'High Day',
        'MA Direction',
        'MA Trend Count',
        //  'Candle Selected',
        //  'Target',
        //  'SL',
        'Acheieved'
    ]

    appendArrayToCSV([headers]);


    niftyList = await readSheetData(sheetRange)  
    niftyList = niftyList.map(stock => stock[0])

    niftyList = fs.readFileSync('nifty-list.csv', 'utf8').split('\n').map(row => row.split(',')[0])

    console.log(niftyList)

    const baseDate = new Date(`2024-12-05`)

    const days = 50
    baseDate.setDate(baseDate.getDate() - days)

    for (let i = days; i >= 0; i--) {

        baseDate.setDate(baseDate.getDate() + 1)

        let startTime = new Date(baseDate)
        startTime.setUTCHours(4, 0, 10, 0);
        startTime.setDate(startTime.getDate() - 5)
        let endTime = new Date(baseDate);
        endTime.setUTCHours(4, 1, 10, 0);
        if (interval == '5m') {
            endTime.setUTCHours(3, 51, 10, 0);
        }

        console.log(startTime, endTime)
        await getDailyStats(startTime, endTime, 'F')

        startTime = new Date(baseDate)
        startTime.setUTCHours(4, 0, 10, 0);
        startTime.setDate(startTime.getDate() - 5)

        endTime = new Date(baseDate);
        endTime.setUTCHours(4, 16, 10, 0);
        if (interval == '5m') {
            endTime.setUTCHours(3, 56, 10, 0);
        }

        await getDailyStats(startTime, endTime, 'S')

        startTime = new Date(baseDate)
        startTime.setUTCHours(4, 0, 10, 0);
        startTime.setDate(startTime.getDate() - 5)

        endTime = new Date(baseDate);
        endTime.setUTCHours(4, 31, 10, 0);
        if (interval == '5m') {
            endTime.setUTCHours(4, 1, 10, 0);
        }

        await getDailyStats(startTime, endTime, 'T')
    }
}

run()