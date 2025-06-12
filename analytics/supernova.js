const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../kite/utils");
const { getDateRange, addMovingAverage, calculateATR } = require("./index");

const DEBUG = process.env.DEBUG || false;
const MAX_STOCK_PRICE = 5000;

async function scanSupernovaStocks(stockList, endDateNew, interval = '15m', useCached = false) {
    const selectedStocks = [];
    const BATCH_SIZE = 5;
    
    // Split stockList into batches
    const batches = [];
    for (let i = 0; i < stockList.length; i += BATCH_SIZE) {
        batches.push(stockList.slice(i, i + BATCH_SIZE));
    }

    // Process each batch in parallel
    for (const batch of batches) {
        const batchPromises = batch.map(async (sym) => {
            try {
                const { startDate, endDate } = getDateRange(endDateNew);
                startDate.setDate(startDate.getDate() - 10); // Adjust as needed for 15m data
                
                let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);
                
                if (!df || df.length === 0 || df[df.length - 1].high > MAX_STOCK_PRICE) {
                    return null;
                }

                // Calculate 15-minute ATR
                df = calculateATR(df, 14);

                // Check for signals
                const bullishSignal = analyseSupernovaBullish(df);
                if (bullishSignal) {
                    const currentCandle = df[df.length - 1];
                    return {
                        sym,
                        direction: 'BULLISH',
                        entry: currentCandle.high + 1,
                        stopLoss: currentCandle.low - 1,
                        time: getDateStringIND(currentCandle.time),
                        pattern: bullishSignal.pattern
                    };
                }

                const bearishSignal = analyzeSupernovaBearish(df);
                if (bearishSignal) {
                    const currentCandle = df[df.length - 1];
                    return {
                        sym,
                        direction: 'BEARISH',
                        entry: currentCandle.low - 1,
                        stopLoss: currentCandle.high + 1,
                        time: getDateStringIND(currentCandle.time),
                        pattern: bearishSignal.pattern
                    };
                }

                return null;
            } catch (error) {
                console.error(`Error processing ${sym}:`, error);
                return null;
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        selectedStocks.push(...batchResults.filter(result => result !== null));
    }
    
    return selectedStocks;
}

function isLargeCandle(candle, atr) {
    return (candle.high - candle.low) > (2 * atr);
}

function isSmallCandle(candle, atr) {
    return (candle.high - candle.low) < (0.25 * atr);
}

function analyseSupernovaBullish(df) {
    const i = df.length - 1;
    if (i < 3 || !df[i].atr) return false;

    const currentCandle = df[i];
    const prevCandle = df[i-1];
    const twoCandlesAgo = df[i-2];
    const atr = currentCandle.atr;

    // Pattern A: Large bearish followed by large bullish
    if (isLargeCandle(twoCandlesAgo, atr) && 
        twoCandlesAgo.close < twoCandlesAgo.open && 
        isLargeCandle(prevCandle, atr) && 
        prevCandle.close > prevCandle.open) {
        return { pattern: 'A' };
    }

    // Pattern B: Large bearish, small, large bullish
    if (i >= 4 && 
        isLargeCandle(df[i-3], atr) && 
        df[i-3].close < df[i-3].open && 
        isSmallCandle(df[i-2], atr) && 
        isLargeCandle(df[i-1], atr) && 
        df[i-1].close > df[i-1].open) {
        return { pattern: 'B' };
    }

    // Pattern C: Large bullish with strong close
    if (isLargeCandle(prevCandle, atr) && 
        prevCandle.close > (prevCandle.high - 0.2 * (prevCandle.high - prevCandle.low))) {
        return { pattern: 'C' };
    }

    return false;
}

function analyzeSupernovaBearish(df) {
    const i = df.length - 1;
    if (i < 3 || !df[i].atr) return false;

    const currentCandle = df[i];
    const prevCandle = df[i-1];
    const twoCandlesAgo = df[i-2];
    const atr = currentCandle.atr;

    // Pattern A: Large bullish followed by large bearish
    if (isLargeCandle(twoCandlesAgo, atr) && 
        twoCandlesAgo.close > twoCandlesAgo.open && 
        isLargeCandle(prevCandle, atr) && 
        prevCandle.close < prevCandle.open) {
        return { pattern: 'A' };
    }

    // Pattern B: Large bullish, small, large bearish
    if (i >= 4 && 
        isLargeCandle(df[i-3], atr) && 
        df[i-3].close > df[i-3].open && 
        isSmallCandle(df[i-2], atr) && 
        isLargeCandle(df[i-1], atr) && 
        df[i-1].close < df[i-1].open) {
        return { pattern: 'B' };
    }

    // Pattern C: Large bearish with strong close
    if (isLargeCandle(prevCandle, atr) && 
        prevCandle.close < (prevCandle.low + 0.2 * (prevCandle.high - prevCandle.low))) {
        return { pattern: 'C' };
    }

    return false;
}

module.exports = {
    scanSupernovaStocks
}; 