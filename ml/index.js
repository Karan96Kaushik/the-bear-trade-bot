const { getDataFromYahoo, processYahooData, getDateStringIND } = require("../kite/utils");
const { appendRowsToSheet, readSheetData } = require("../gsheets");
const { addMovingAverage, scanZaireStocks, countMATrendRising, 
    countMATrendFalling, checkMARising, checkMAFalling, checkUpwardTrend, 
    checkDownwardTrend, printTrendEmojis, isBullishCandle,
    addRSI, calculateBollingerBands} = require("../analytics");
// const { sendMessageToChannel } = require("./slack-actions");
const fs = require('fs');
const path = require('path');
const { predictMarketDirection } = require("./predict");

const interval = '15m'


let niftyList = []

async function processStock(stock, startTime, endTime, candleType) {
    try {
        const data = await getDataFromYahoo(stock, 1, interval, startTime, endTime);
        let candles = processYahooData(data);

        let startTimeDay = new Date(endTime)
        // startTimeDay.setUTCHours(0, 0, 10, 0)
        // startTimeDay.setDate(startTimeDay.getDate() - 5)
        let endTimeDay = new Date(endTime)
        endTimeDay.setUTCHours(23, 0, 10, 0)

        // const dataDay = await getDataFromYahoo(stock, 1, '15m', startTimeDay, endTimeDay);
        // // console.log(startTimeDay, endTimeDay, dataDay.chart.result)
        // let candlesDay = processYahooData(dataDay);

        // console.log(startTimeDay, endTimeDay, candlesDay)

        // const dayHigh = Math.max(...candlesDay.map(candle => candle.high));
        // const dayLow = Math.min(...candlesDay.map(candle => candle.low));

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

        // const { high: highDay, low: lowDay, volume: volumeDay } = candlesDay[candlesDay.length - 1]

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

        // if (DEBUG) {
        //     console.log(stock, isRising)
        // }
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
            // acheieved = dayHigh > targetPrice ? true : false
            count = countRising
            console.log(stock, 'bullish', triggerPrice, stopLossPrice, targetPrice, acheieved, count)
        }
        else if (trend === 'BEARISH' ) {
            candleCleared = checkDownwardTrend(candles, candles.length - 2) ? true : false
            triggerPrice = low - 1;
            stopLossPrice = high + 1;
            targetPrice = (triggerPrice - (high - low)* 2);
            // acheieved = dayLow < targetPrice ? true : false
            count = countFalling
            console.log(stock, 'bearish', triggerPrice, stopLossPrice, targetPrice, acheieved, count)
        }

        // console.log(stock, trendCountRising, trendCountFalling, trend, candleCleared)
        // console.log(scanZaireStocks())
        // console.log({...candles[candles.length - 2], time: new Date(candles[candles.length - 2].time)})
        // return
        // if (false)

        return {
            Timestamp: getDateStringIND(new Date(time)),
            'Candle Type': candleType,
            Sym: stock,
            High: high,
            Low: low,
            Open: open,
            Close: close,
            Volume: volume,
            SMA44: sma44,
            RSI14: rsi,
            'BB Middle': bb_middle,
            'BB Upper': bb_upper,
            'BB Lower': bb_lower,
            T1H: candles[candles.length - 3].high,
            T1L: candles[candles.length - 3].low,
            T1O: candles[candles.length - 3].open,
            T1C: candles[candles.length - 3].close,
            T2H: candles[candles.length - 4].high,
            T2L: candles[candles.length - 4].low,
            T2O: candles[candles.length - 4].open,
            T2C: candles[candles.length - 4].close,
            T3H: candles[candles.length - 5].high,
            T3L: candles[candles.length - 5].low,
            T3O: candles[candles.length - 5].open,
            T3C: candles[candles.length - 5].close,
            // 'Volume Prev Day Avg': volumeDay / (6*4),
            'Volume P Last': prevDayCandles[prevDayCandles.length - 1].volume,
            'Volume P 2nd Last': prevDayCandles[prevDayCandles.length - 2].volume,
            'Volume P 3rd Last': prevDayCandles[prevDayCandles.length - 3].volume,
            // 'Low Day': dayLow,
            // 'High Day': dayHigh,
            'MA Direction': trend,
            'MA Trend Count': count,
            // Acheieved: acheieved
        };
    } catch (error) {
        console.trace(`Error processing ${stock}:`, error?.response?.data || error?.message);
        return null;
    }
}

function getCandleType(endTime) {
    // Convert endTime to hours and minutes
    const hours = endTime.getUTCHours();
    const minutes = endTime.getUTCMinutes();
    const totalMinutes = hours * 60 + minutes;

    // Mapping based on the code:
    // F  -> 4:01  (241 minutes)
    // S  -> 4:16  (256 minutes)
    // T  -> 4:31  (271 minutes)
    // FT -> 4:31  (271 minutes)
    // FH -> 4:46  (286 minutes)
    // SI -> 5:01  (301 minutes)

    if (totalMinutes <= 241) return 'F';
    if (totalMinutes <= 256) return 'S';
    if (totalMinutes <= 271) return 'T';
    if (totalMinutes <= 271) return 'FT';
    if (totalMinutes <= 286) return 'FH';
    if (totalMinutes <= 301) return 'SI';
    
    return 'UNKNOWN';
}

async function getDailyStats(startTime, endTime) {
    try {

        if (!startTime) {
            startTime = new Date()
            // startTime.setUTCHours(4, 0, 10, 0);
            startTime.setDate(startTime.getDate() - 6)
        }

        if (!endTime) {
            endTime = new Date()
            // endTime.setUTCHours(4, 1, 10, 0)
        }

        const candleType = getCandleType(endTime)
        console.log(startTime, endTime);
        console.log('---');

        const maxConcurrent = 50;
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

        return rows

        // Update CSV file
        // await appendArrayToCSV(rows);

    } catch (error) {
        console.trace('Error in getDailyStats:', error?.response?.data || error?.message);
    }
}

defaultFilePath = `training_1_${interval}.csv`

const run = async () => {

    niftyList = fs.readFileSync('mega-stock-list.csv', 'utf8')
                    .split('\n')
                    .map(row => row.split(',')[0])
                    .slice(0, 100)

    console.log(niftyList)

    const baseDate = new Date(`2024-12-23`)

    let startTime = new Date(baseDate)
    startTime.setUTCHours(4, 0, 10, 0);
    startTime.setDate(startTime.getDate() - 6)

    let endTime = new Date(baseDate);
    endTime.setUTCHours(4, 31, 10, 0);

    const data = await getDailyStats(startTime, endTime)

    const results = await predictMarketDirection(data)

    console.log(results.filter(d => d.prediction !== 'none'))
        
}

run()