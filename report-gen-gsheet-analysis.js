const { getDataFromYahoo, processYahooData } = require("./kite/utils");
const { appendRowsToSheet, readSheetData } = require("./gsheets");
const { addMovingAverage } = require("./analytics");
// const { sendMessageToChannel } = require("./slack-actions");

// List of stocks to track
const STOCKS = [
    "RELIANCE",
    "TCS",
    // ... add more stocks as needed
];

async function getDailyStats() {
    try {

        let niftyList = await readSheetData('Nifty!A1:A200')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])

        let startTime = new Date('2024-10-20').setUTCHours(4, 0, 10, 0);
        let endTime = new Date('2024-10-30').setUTCHours(4, 0, 10, 0);
        console.log(endTime)
        const interval = '15m'

        const rows = [['Data ' + interval + ' ' + (new Date(endTime).toISOString().split('T')[0])]];

        for (const stock of niftyList) {
            try {

                // startTime = new Date().setUTCHours(4, 0, 10, 0) / 1000;
                // endTime = new Date() / 1000;

                // const sym = `NSE:${stock}`;
                // Get 1-minute candles for today

                const data = await getDataFromYahoo(stock, 1, interval, startTime, endTime);
                let candles = processYahooData(data);

                let startTimeDay = new Date('2024-10-30').setUTCHours(0, 0, 10, 0);
                let endTimeDay = new Date('2024-10-30').setUTCHours(23, 0, 10, 0);

                const dataDay = await getDataFromYahoo(stock, 1, '1d', startTimeDay, endTimeDay);
                let candlesDay = processYahooData(dataDay);

                // console.log(candles[candles.length - 2])
                console.log(new Date(candles[candles.length - 2].time))
                // return
                // Calculate SMA44

                candles = addMovingAverage(candles, 'close', 44, 'sma44');

                const { high, low, open, close, sma44 } = candles[candles.length - 2]
                const { high: highDay, low: lowDay, open: openDay, close: closeDay } = candlesDay[0]

                // Calculate continuous MA trend
                const [maTrend, count] = calculateMATrend(candles, sma44).split(' ');

                rows.push([
                    stock,          // Stock
                    high,           // H
                    low,            // L
                    open,           // O
                    close,          // C
                    highDay,        // H
                    lowDay,         // L

                    sma44,        // SMA44
                    maTrend,      // Continuous Up/Down MA
                    count         // Count
                ]);

            } catch (error) {
                console.error(`Error processing ${stock}:`, error?.response?.data || error?.message);
                // await sendMessageToChannel(`❌ Error processing ${stock}:`, error.message);
            }
        }

        // Update Google Sheet
        await appendRowsToSheet('Analysis1!A2:G', rows);
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
            trend = currentValue > previousValue ? 'UP' : 'DOWN';
            count = 1;
        } else {
            // Check if the trend continues
            const isUp = currentValue > previousValue;
            if ((trend === 'UP' && isUp) || (trend === 'DOWN' && !isUp)) {
                count++;
            } else {
                break;
            }
        }
    }
    
    return `${trend} ${count}`;
}

getDailyStats()