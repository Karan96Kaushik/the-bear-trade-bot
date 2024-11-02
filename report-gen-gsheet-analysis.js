const { getDataFromYahoo, processYahooData, getDateStringIND } = require("./kite/utils");
const { appendRowsToSheet, readSheetData } = require("./gsheets");
const { addMovingAverage, scanZaireStocks, countMATrendRising, countMATrendFalling, checkMARising, checkMAFalling, checkUpwardTrend, checkDownwardTrend } = require("./analytics");
// const { sendMessageToChannel } = require("./slack-actions");


async function getDailyStats() {
    try {

        let niftyList = await readSheetData('Nifty!A1:A200')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])

        // niftyList = ['ADANIENT']

        let startTime = new Date('2024-10-20').setUTCHours(4, 0, 10, 0);
        let endTime = new Date('2024-10-30').setUTCHours(4, 15, 10, 0);
        console.log(endTime)
        const interval = '15m'

        const rows = [];

        for (const stock of niftyList) {
            try {


                // startTime = new Date().setUTCHours(4, 0, 10, 0) / 1000;
                // endTime = new Date() / 1000;

                // const sym = `NSE:${stock}`;
                // Get 1-minute candles for today

                const data = await getDataFromYahoo(stock, 1, interval, startTime, endTime);
                let candles = processYahooData(data);

                let startTimeDay = new Date('2024-10-31').setUTCHours(0, 0, 10, 0);
                let endTimeDay = new Date('2024-10-31').setUTCHours(23, 0, 10, 0);

                const dataDay = await getDataFromYahoo(stock, 1, '1d', startTimeDay, endTimeDay);
                let candlesDay = processYahooData(dataDay);

                // console.log(candlesDay, new Date(candlesDay[0].time))

                // console.log(candles[candles.length - 2])
                // console.log(new Date(candles[candles.length - 2].time))
                // return
                // Calculate SMA44

                candles = addMovingAverage(candles, 'close', 44, 'sma44');

                const { high, low, open, close, sma44, time } = candles[candles.length - 2]
                const { high: highDay, low: lowDay } = candlesDay[0]

                if (rows.length == 0) {
                    rows.push(['' + interval + ' - ' + getDateStringIND(new Date(time))]);
                }

                const maValues = candles.map(row => row['sma44']).slice(0, -2);

                // console.log(maValues)

                const trendCountRising = countMATrendRising(maValues);
                const trendCountFalling = countMATrendFalling(maValues);

                const trend = (trendCountRising > trendCountFalling ? 'BULLISH' : 'BEARISH')
                let candleCleared

                if (trend === 'BULLISH' )
                    candleCleared = checkUpwardTrend(candles, candles.length - 2) ? 'TRUE' : 'FALSE'
                else if (trend === 'BEARISH' )
                    candleCleared = checkDownwardTrend(candles, candles.length - 2) ? 'TRUE' : 'FALSE'

                console.log(stock, trendCountRising, trendCountFalling, trend, candleCleared)
                // console.log(scanZaireStocks())
                console.log({...candles[candles.length - 2], time: new Date(candles[candles.length - 2].time)})
// return
                // if (false)
                rows.push([
                    stock,          // Stock
                    high,           // H
                    low,            // L
                    open,           // O
                    close,          // C
                    sma44,        // SMA44

                    lowDay,         // L
                    highDay,        // H

                    trend + ' - ' + candleCleared,      // Continuous Up/Down MA
                    trendCountRising > trendCountFalling ? trendCountRising : trendCountFalling         // Count
                ]);

            } catch (error) {
                console.error(`Error processing ${stock}:`, error?.response?.data || error?.message);
                // await sendMessageToChannel(`❌ Error processing ${stock}:`, error.message);
            }
        }

        // Update Google Sheet
        await appendRowsToSheet('Analysis 20Oct24!A2:G', rows);
        // await sendMessageToChannel('✅ Successfully updated daily stats sheet');

    } catch (error) {
        console.error('Error in getDailyStats:', error?.response?.data || error?.message);
        // await sendMessageToChannel('❌ Error updating daily stats:', error.message);
    }
}

function calculateMATrend(candles) {
    let trend = '';
    let count = 0;
    
    // Start from the second-to-last candle and move backwards
    for (let i = candles.length - 2; i > 0; i--) {
        const currentValue = candles[i].sma44;
        const previousValue = candles[i - 1].sma44;
        
        // Skip if either value is null/undefined
        if (!currentValue || !previousValue) break;
        
        if (count === 0) {
            // First comparison establishes the trend
            trend = currentValue > previousValue ? 'BULLISH' : 'BEARISH';
            count = 1;
        } else {
            // Check if the trend continues
            const isUp = currentValue > previousValue;
            if ((trend === 'BULLISH' && isUp) || (trend === 'BEARISH' && !isUp)) {
                count++;
            } else {
                break;
            }
        }
    }
    
    return `${trend} ${count}`;
}

getDailyStats()