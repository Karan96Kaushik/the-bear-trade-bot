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

        let startTime = new Date().setDate(20);
        let endTime = new Date().setUTCHours(4, 0, 10, 0);

        const interval = '15m'

        const rows = [['Data ' + interval + ' ' + endTime.toLocaleString()]];

        for (const stock of niftyList) {
            try {
                // startTime = new Date().setUTCHours(4, 0, 10, 0) / 1000;
                // endTime = new Date() / 1000;

                // const sym = `NSE:${stock}`;
                // Get 1-minute candles for today
                const data = await getDataFromYahoo(stock, 1, interval, startTime, endTime);
                let candles = processYahooData(data);

                // console.log(candles[candles.length - 2])
                console.log(new Date(candles[candles.length - 2].time).toLocaleString())
                // return
                // Calculate SMA44

                candles = addMovingAverage(candles, 'close', 44, 'sma44');

                const { high, low, open, close, sma44 } = candles[candles.length - 2]

                // Calculate continuous MA trend
                const maTrend = calculateMATrend(candles, sma44);

                rows.push([
                    stock,          // Stock
                    high,           // H
                    low,            // L
                    open,           // O
                    close,          // C
                    sma44,        // SMA44
                    maTrend         // Continuous Up/Down MA
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