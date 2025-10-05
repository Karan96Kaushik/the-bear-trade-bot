const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../kite/utils");
const { getDateRange, addMovingAverage } = require("./index");

const DEBUG = process.env.DEBUG || false;
const MAX_STOCK_PRICE = 5000;

/**
 * Scan stocks based on Benoit strategy
 * 
 * Conditions:
 * 1. Bearish definition: [-1] close < ([-1] high + [-1] low) / 2
 * 2. Placement on MA: [-1] low * 0.999 <= [-1] sma(close, 22) AND [-1] high * 1.001 >= [-1] sma(close, 22)
 * 3. Max stock price: [0] close < 5000
 * 4. Candle size: ([0] high - [0] low) <= ([0] high + [0] low) / 2 * 0.005
 * 5. Entry point: [0] low < [-1] low
 */
async function scanBenoitStocks(stockList, endDateNew, interval = '5m', useCached = false) {
	const selectedStocks = [];
	const BATCH_SIZE = 5;
	
	// Split stockList into batches
	const batches = [];
	for (let i = 0; i < stockList.length; i += BATCH_SIZE) {
		batches.push(stockList.slice(i, i + BATCH_SIZE));
	}
	
	const no_data_stocks = [];
	const too_high_stocks = [];
	const errored_stocks = [];
	
	// Process each batch in parallel
	for (const batch of batches) {
		const batchPromises = batch.map(async (sym) => {
			try {
				const { startDate, endDate } = getDateRange(endDateNew);
				
				// Fetch 5-minute data
				let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);
				df = processYahooData(df, interval, useCached);
				
				if (!df || df.length === 0) {
					if (DEBUG) console.log('No data for', sym);
					no_data_stocks.push(sym);
					return null;
				}
				
				// Need at least 2 candles to compare [-1] and [0]
				if (df.length < 23) { // Need at least 22 for SMA + 1 more
					if (DEBUG) console.log('Not enough data for', sym);
					return null;
				}
				
				// Add 22-period SMA
				df = addMovingAverage(df, 'close', 22, 'sma22');
				df = df.filter(r => r.close);
				
				// Get current and previous candles
				const currentCandle = df[df.length - 1];  // [0]
				const previousCandle = df[df.length - 2]; // [-1]
				
				// Condition 3: Max stock price check
				if (currentCandle.close >= MAX_STOCK_PRICE) {
					if (DEBUG) console.log('Price too high for', sym);
					too_high_stocks.push(sym);
					return null;
				}
				
				// Condition 1: Bearish definition
				// [-1] close < ([-1] high + [-1] low) / 2
				const previousCandleMid = (previousCandle.high + previousCandle.low) / 2;
				const isBearish = previousCandle.close < previousCandleMid;
				
				if (!isBearish) {
					if (DEBUG) console.log('Not bearish for', sym);
					return null;
				}
				
				// Condition 2: Placement on moving average
				// [-1] low * 0.999 <= [-1] sma22 AND [-1] high * 1.001 >= [-1] sma22
				const previousSma = previousCandle.sma22;
				if (!previousSma) {
					if (DEBUG) console.log('No SMA for', sym);
					return null;
				}
				
				const lowBound = previousCandle.low * 0.999;
				const highBound = previousCandle.high * 1.001;
				const isTouchingSma = lowBound <= previousSma && highBound >= previousSma;
				
				if (!isTouchingSma) {
					if (DEBUG) console.log('Not touching SMA for', sym);
					return null;
				}
				
				// Condition 4: Candle size condition
				// ([0] high - [0] low) <= ([0] high + [0] low) / 2 * 0.005
				const currentRange = currentCandle.high - currentCandle.low;
				const currentAvgPrice = (currentCandle.high + currentCandle.low) / 2;
				const maxAllowedRange = currentAvgPrice * 0.005;
				const isNarrowRange = currentRange <= maxAllowedRange;
				
				if (!isNarrowRange) {
					if (DEBUG) console.log('Range too wide for', sym);
					return null;
				}
				
				// Condition 5: Entry point
				// [0] low < [-1] low
				const isBreakingLower = currentCandle.low < previousCandle.low;
				
				if (!isBreakingLower) {
					if (DEBUG) console.log('Not breaking lower for', sym);
					return null;
				}
				
				// All conditions met - return stock data
				return {
					sym,
					open: currentCandle.open,
					close: currentCandle.close,
					high: currentCandle.high,
					low: currentCandle.low,
					time: getDateStringIND(currentCandle.time),
					direction: 'BEARISH', // Benoit is a bearish strategy
					sma22: currentCandle.sma22,
					previousCandle: {
						open: previousCandle.open,
						close: previousCandle.close,
						high: previousCandle.high,
						low: previousCandle.low,
						sma22: previousCandle.sma22
					}
				};
			} catch (error) {
				if (DEBUG) console.error(`Error processing ${sym}:`, error);
				errored_stocks.push(sym);
				return null;
			}
		});
		
		// Wait for all promises in the batch to resolve
		const batchResults = await Promise.all(batchPromises);
		selectedStocks.push(...batchResults.filter(result => result !== null));
	}
	
	if (DEBUG) {
		console.log(`Benoit scan results: ${selectedStocks.length} stocks selected`);
		console.log(`No data: ${no_data_stocks.length}, Too high: ${too_high_stocks.length}, Errors: ${errored_stocks.length}`);
	}
	
	return {
		selectedStocks,
		no_data_stocks,
		too_high_stocks,
		errored_stocks
	};
}

module.exports = {
	scanBenoitStocks
};

