const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../kite/utils");
const { getDateRange, addMovingAverage } = require("./index");

const DEBUG = process.env.DEBUG || false;
const MAX_STOCK_PRICE = 5000;

const DEFAULT_PARAMS = {
	TOUCHING_SMA_TOLERANCE: 0.002,
	NARROW_RANGE_TOLERANCE: 0.0046,
	MA_WINDOW: 44,
}

/**
 * Scan stocks based on Baxter strategy (BULLISH - opposite of Benoit)
 * 
 * Conditions:
 * 1. Bullish definition: [0] close > ([0] high + [0] low) / 2
 * 2. Placement on MA: [0] low * 0.998 <= [0] sma(close, 44) AND [0] high * 1.002 >= [0] sma(close, 44)
 * 3. Max stock price: [0] close < 5000
 * 4. Candle size: ([0] high - [0] low) <= ([0] high + [0] low) / 2 * 0.0046
 * 5. Entry point: [0] high > [-1] high (breakout above previous candle - The Queen)
 */
async function scanBaxterStocks(stockList, endDateNew, interval = '15m', useCached = false, params = DEFAULT_PARAMS) {
	const selectedStocks = [];
	const BATCH_SIZE = 5;

	params = { ...DEFAULT_PARAMS, ...params };
	
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
				
				// Fetch 15-minute data
				let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);
				df = processYahooData(df, interval, useCached);
				
				if (!df || df.length === 0) {
					if (DEBUG) console.log('No data for', sym);
					no_data_stocks.push(sym);
					return null;
				}
				
				// Need at least 2 candles to compare [0] and [-1]
				if (df.length < 45) { // Need at least 44 for SMA + 1 more
					if (DEBUG) console.log('Not enough data for', sym);
					return null;
				}
				
				// Add 44-period SMA
				df = addMovingAverage(df, 'close', params.MA_WINDOW, 'sma44');
				df = df.filter(r => r.close);
				
				// Get current and previous candles
				const currentCandle = df[df.length - 1];  // [0] - The Queen
				const previousCandle = df[df.length - 2]; // [-1]
				
				// Condition 3: Max stock price check
				if (currentCandle.close >= MAX_STOCK_PRICE) {
					if (DEBUG) console.log('Price too high for', sym);
					too_high_stocks.push(sym);
					return null;
				}
				
				// Condition 1: Bullish definition
				// [0] close > ([0] high + [0] low) / 2
				const currentCandleMid = (currentCandle.high + currentCandle.low) / 2;
				const isBullish = currentCandle.close > currentCandleMid;
				
				if (!isBullish) {
					if (DEBUG) console.log('Not bullish for', sym);
					return null;
				}
				
				// Condition 2: Placement on moving average
				// [0] low * 0.998 <= [0] sma44 AND [0] high * 1.002 >= [0] sma44
				const currentSma = currentCandle.sma44;
				if (!currentSma) {
					if (DEBUG) console.log('No SMA for', sym);
					return null;
				}
				
				const lowBound = currentCandle.low * (1 - params.TOUCHING_SMA_TOLERANCE);
				const highBound = currentCandle.high * (1 + params.TOUCHING_SMA_TOLERANCE);
				const isTouchingSma = lowBound <= currentSma && highBound >= currentSma;
				
				if (!isTouchingSma) {
					if (DEBUG) console.log('Not touching SMA for', sym);
					return null;
				}
				
				// Condition 4: Candle size condition
				// ([0] high - [0] low) <= ([0] high + [0] low) / 2 * 0.0046
				const currentRange = currentCandle.high - currentCandle.low;
				const currentAvgPrice = (currentCandle.high + currentCandle.low) / 2;
				const maxAllowedRange = currentAvgPrice * params.NARROW_RANGE_TOLERANCE;
				const isNarrowRange = currentRange <= maxAllowedRange;
				
				if (!isNarrowRange) {
					if (DEBUG) console.log('Range too wide for', sym);
					return null;
				}
				
				// Condition 5: Entry point - breakout above previous high
				// [0] high > [-1] high
				const isBreakingHigher = currentCandle.high > previousCandle.high;
				
				if (!isBreakingHigher) {
					if (DEBUG) console.log('Not breaking higher for', sym);
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
					direction: 'BULLISH', // Baxter is a bullish strategy
					sma44: currentCandle.sma44,
					previousCandle: {
						open: previousCandle.open,
						close: previousCandle.close,
						high: previousCandle.high,
						low: previousCandle.low,
						sma44: previousCandle.sma44
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
		console.log(`Baxter scan results: ${selectedStocks.length} stocks selected`);
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
	scanBaxterStocks
};
