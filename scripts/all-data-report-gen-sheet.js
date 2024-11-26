const { getDataFromYahoo, processYahooData, getDateStringIND } = require("../kite/utils");
const { appendRowsToSheet, readSheetData } = require("../gsheets");
const { addMovingAverage, scanZaireStocks, countMATrendRising, 
    countMATrendFalling, checkMARising, checkMAFalling, checkUpwardTrend, 
    checkDownwardTrend, printTrendEmojis, isBullishCandle} = require("../analytics");
// const { sendMessageToChannel } = require("./slack-actions");

const sheetID = '17eVGOMlgO8M62PrD8JsPIRcavMmPz-KH7c8QW1edzZE'
const DEBUG = false

const MA_TREND_WINDOW = 10

async function getDailyStats(startTime, endTime) {
    try {

        let niftyList = await readSheetData('HIGHBETA!B2:B200')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])

        niftyList = ['APARINDS']

        // let data = await scanZaireStocks(niftyList, '2024-11-22T04:01:10Z')
        // console.log(data)
        console.log('---')
        // return


        // console.log(endTime)

        const interval = '15m'

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

                let startTimeDay = new Date('2024-10-22').setUTCHours(0, 0, 10, 0);
                let endTimeDay = new Date(endTime).setUTCHours(23, 0, 10, 0);

                const dataDay = await getDataFromYahoo(stock, 1, '1d', startTimeDay, endTimeDay);
                let candlesDay = processYahooData(dataDay);

                // console.log(candlesDay, new Date(candlesDay[candlesDay.length - 1].time))

                // console.log(candles[candles.length - 2])
                // console.log(new Date(candles[candles.length - 2].time))
                // return
                // Calculate SMA44

                candles = addMovingAverage(candles, 'close', 44, 'sma44');

                const { high, low, open, close, sma44, time } = candles[candles.length - 2]
                const { high: highDay, low: lowDay } = candlesDay[candlesDay.length - 1]

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
                    targetPrice = ((high - low) * 3) + triggerPrice;
                    acheieved = highDay > targetPrice ? true : false
                    count = countRising
                    console.log(stock, 'bullish', triggerPrice, stopLossPrice, targetPrice, acheieved, count)
                }
                else if (trend === 'BEARISH' ) {
                    candleCleared = checkDownwardTrend(candles, candles.length - 2) ? true : false
                    triggerPrice = low - 1;
                    stopLossPrice = high + 1;
                    targetPrice = (triggerPrice - (high - low)* 3);
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

                    stock,          // Stock
                    high,           // H
                    low,            // L
                    open,           // O
                    close,          // C
                    sma44,          // SMA44

                    lowDay,         // L
                    highDay,        // H

                    trend,      // Continuous Up/Down MA
                    count,         // Count

                    candleCleared,
                    targetPrice,
                    stopLossPrice,

                    acheieved
                ]);

            } catch (error) {
                console.trace(`Error processing ${stock}:`, error?.response?.data || error?.message);
                // await sendMessageToChannel(`❌ Error processing ${stock}:`, error.message);
            }
        }

        // Update Google Sheet
        await appendRowsToSheet('26Nov!A1:G', rows, sheetID);
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

    const headers = [['Timestamp', 'Sym', 'High', 'Low', 'Open', 'Close', 'SMA44', 'Low Day', 'High Day', 'MA Direction', 'MA Trend Count', 'Candle Selected', 'Target', 'SL', 'Acheieved']]

    await appendRowsToSheet('26Nov!A1:G', headers, sheetID);

    for (let i = 25; i <= 26; i++) {    
        let startTime = new Date(`2024-11-${i-5}`).setUTCHours(4, 0, 10, 0);
        let endTime = new Date(`2024-11-${i}`).setUTCHours(4, 1, 10, 0);

        await getDailyStats(startTime, endTime)

        startTime = new Date(`2024-11-${i-5}`).setUTCHours(4, 0, 10, 0);
        endTime = new Date(`2024-11-${i}`).setUTCHours(4, 16, 10, 0);

        await getDailyStats(startTime, endTime)


        startTime = new Date(`2024-11-${i-5}`).setUTCHours(4, 0, 10, 0);
        endTime = new Date(`2024-11-${i}`).setUTCHours(4, 31, 10, 0);

        await getDailyStats(startTime, endTime)
    }
}

run()