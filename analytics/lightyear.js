const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../kite/utils");
const { getDateRange, addMovingAverage } = require("./index");

const DEBUG = process.env.DEBUG || false;
const MAX_STOCK_PRICE = 5000;

async function scanLightyearStocks(stockList, endDateNew, interval = '1d', useCached = false, tolerance = 0.01) {
	const selectedStocks = [];
	const BATCH_SIZE = 5; // Processing stocks in batches
	
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
				startDate.setDate(startDate.getDate() - 80);
				
				let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);

				// If using cached data, we need not check for post market data
				const isPostMarket = true;
				df = processYahooData(df, interval, useCached, isPostMarket);
				
				if (!df || df.length === 0) {
					console.log('No data for', sym);
					return null;
				}
				
				if (!df || df.length === 0 || df[df.length - 1].high > MAX_STOCK_PRICE) {
					console.log('No data for or high price > MAX_STOCK_PRICE', sym);
					return null;
				}
				
				// Add moving averages
				df = addMovingAverage(df, 'close', 44, 'sma44');
				df = addMovingAverage(df, 'volume', 7, 'sma7_vol');
				
				// Check minimum volume requirement
				const currentCandle = df[df.length - 1];
				if (currentCandle.volume < 100000) {
					return null;
				}

				// console.log(sym, currentCandle, df[df.length - 2])
				
				// Check for upward trend
				const upwardSignal = analyseLightyearDataUpward(df, sym, tolerance);
				if (upwardSignal) {
					return {
						sym,
						open: currentCandle.open,
						close: currentCandle.close,
						high: currentCandle.high,
						low: currentCandle.low,
						time: getDateStringIND(currentCandle.time),
						volume: currentCandle.volume,
						sma7_vol: currentCandle.sma7_vol,
						sma44: currentCandle.sma44,
						direction: 'BULLISH',
						prev: df[df.length - 2], // Previous candle data
					};
				}
				
				// Check for downward trend
				const downwardSignal = analyseLightyearDataDownward(df, sym, tolerance);
				if (downwardSignal) {
					return {
						sym,
						open: currentCandle.open,
						close: currentCandle.close,
						high: currentCandle.high,
						low: currentCandle.low,
						time: getDateStringIND(currentCandle.time),
						volume: currentCandle.volume,
						sma7_vol: currentCandle.sma7_vol,
						sma44: currentCandle.sma44,
						direction: 'BEARISH',
						prev: df[df.length - 2], // Previous candle data
					};
				}
				
				return null;
			} catch (error) {
				console.error(`Error processing ${sym}:`, error);
				return null;
			}
		});
		
		// Wait for all promises in the batch to resolve
		const batchResults = await Promise.all(batchPromises);
		selectedStocks.push(...batchResults.filter(result => result !== null));
	}
	
	return selectedStocks;
}

function analyseLightyearDataUpward(df, sym, tolerance = 0.01) {
	try {
		const i = df.length - 1;
		
		// Check if we have enough data and the moving average exists
		if (i < 4 || isNaN(df[i].sma44)) {
			return false;
		}
		
		// Check for rising moving average trend
		const ma0 = df[i].sma44;
		const ma1 = df[i-1].sma44;
		const ma2 = df[i-2].sma44;
		const ma3 = df[i-3].sma44;
		const ma4 = df[i-4].sma44;
		
		const risingMA = ma0 > ma1 && ma1 > ma2 && ma2 > ma3 && ma3 > ma4;
		
		// Check if current price is near the moving average
		const currentCandle = df[i];
		const maValue = currentCandle.sma44;
		const touchingMA = 
			Math.abs(maValue - currentCandle.low) < (maValue * tolerance) || 
			Math.abs(maValue - currentCandle.high) < (maValue * tolerance) || 
			(maValue > currentCandle.low && maValue < currentCandle.high);
		
		// Check for bullish candle pattern
		const bullishCandle = 
			currentCandle.close > currentCandle.open || 
			(currentCandle.high - currentCandle.close) < (currentCandle.close - currentCandle.low);
		
		return risingMA && touchingMA && bullishCandle;
	} catch (e) {
		console.error(e, sym);
		return false;
	}
}

function analyseLightyearDataDownward(df, sym, tolerance = 0.01) {
	try {
		const i = df.length - 1;
		
		// Check if we have enough data and the moving average exists
		if (i < 4 || isNaN(df[i].sma44)) {
			return false;
		}
		
		// Check for falling moving average trend
		const ma0 = df[i].sma44;
		const ma1 = df[i-1].sma44;
		const ma2 = df[i-2].sma44;
		const ma3 = df[i-3].sma44;
		const ma4 = df[i-4].sma44;
		
		const fallingMA = ma0 < ma1 && ma1 < ma2 && ma2 < ma3 && ma3 < ma4;
		
		// Check if current price is near the moving average
		const currentCandle = df[i];
		const maValue = currentCandle.sma44;

		const touchingMA = 
			Math.abs(maValue - currentCandle.high) < (maValue * tolerance) || 
			Math.abs(maValue - currentCandle.low) < (maValue * tolerance) || 
			(maValue > currentCandle.low && maValue < currentCandle.high);
		
		// Check for bearish candle pattern
		const bearishCandle = 
			currentCandle.close < currentCandle.open || 
			(currentCandle.high - currentCandle.close) > (currentCandle.close - currentCandle.low);
		
		return fallingMA && touchingMA && bearishCandle;
	} catch (e) {
		console.error(e, sym);
		return false;
	}
}

module.exports = {
	scanLightyearStocks
}