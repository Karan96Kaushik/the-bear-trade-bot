const { getDateStringIND, getDataFromYahoo, processYahooData, getDataFromMoneycontrol, processMoneycontrolData } = require("../kite/utils");
const { getDateRange, addMovingAverage } = require("./index");
const fs = require('fs');
const path = require('path');

const DEBUG = process.env.DEBUG || false;
const MAX_STOCK_PRICE = 5000;
const ENABLE_CSV_DEBUG_LOGGER = process.env.ENABLE_CSV_DEBUG_LOGGER == undefined ? true : process.env.ENABLE_CSV_DEBUG_LOGGER == 'true';

const DEFAULT_PARAMS = {
	TOUCHING_SMA_TOLERANCE: 0,
	NARROW_RANGE_TOLERANCE: 0.01,
	MA_WINDOW: 200,
}

let debugLogData = new Map();

/**
 * CSV Debug Logger for tracking stock condition evaluation
 * Accumulates data for each symbol+timestamp and writes one row per combination
 */
function logStockDebug(sym, timestamp, condition, status, details = {}) {
	if (!ENABLE_CSV_DEBUG_LOGGER) return;
	
	const key = `${sym}_${timestamp || 'unknown'}`;
	
		if (!debugLogData.has(key)) {
		debugLogData.set(key, {
			timestamp: timestamp || new Date().toISOString(),
			symbol: sym,
			close: '',
			high: '',
			low: '',
			open: '',
			sma: '',
			previousHigh: '',
			previousLow: '',
			previousClose: '',
			dataLength: '',
			failedCondition: '',
			failedReason: '',
			maxPrice: '',
			isBullish: '',
			isBearish: '',
			bullishMid: '',
			bearishMid: '',
			touchingSma: '',
			smaLowBound: '',
			smaHighBound: '',
			narrowRange: '',
			candleRange: '',
			maxAllowedRange: '',
			breakout: '',
			allConditionsPassed: 'NO'
		});
	}
	
	const entry = debugLogData.get(key);
	
	if (details.close) entry.close = details.close;
	if (details.high) entry.high = details.high;
	if (details.low) entry.low = details.low;
	if (details.open) entry.open = details.open;
	if (details.sma) entry.sma = details.sma;
	if (details.previousHigh) entry.previousHigh = details.previousHigh;
	if (details.previousLow) entry.previousLow = details.previousLow;
	if (details.previousClose) entry.previousClose = details.previousClose;
	if (details.currentMid) {
			entry.bullishMid = details.currentMid;
			entry.bearishMid = details.currentMid;
		}
	if (details.lowBound) entry.smaLowBound = details.lowBound;
	if (details.highBound) entry.smaHighBound = details.highBound;
	if (details.candleRange) entry.candleRange = details.candleRange;
	if (details.maxAllowedRange) entry.maxAllowedRange = details.maxAllowedRange;
	
	switch(condition) {
		case 'DATA_FETCH':
			if (status === 'PASSED' && details.notes) {
				const match = details.notes.match(/(\d+) candles/);
				if (match) entry.dataLength = match[1];
			} else if (status === 'FAILED') {
				entry.failedCondition = 'DATA_FETCH';
				entry.failedReason = details.notes || 'No data';
			}
			break;
		case 'DATA_LENGTH':
			if (status === 'FAILED') {
				entry.failedCondition = 'DATA_LENGTH';
				entry.failedReason = details.notes || 'Insufficient candles';
			}
			break;
		case 'MAX_PRICE':
			entry.maxPrice = status === 'PASSED' ? 'YES' : 'NO';
			if (status === 'FAILED') {
				entry.failedCondition = 'MAX_PRICE';
				entry.failedReason = details.notes || 'Price too high';
			}
			break;
		case 'BULLISH':
			entry.isBullish = status === 'PASSED' ? 'YES' : 'NO';
			if (status === 'FAILED') {
				entry.failedCondition = 'BULLISH';
				entry.failedReason = details.notes || 'Not bullish';
			}
			break;
		case 'BEARISH':
			entry.isBearish = status === 'PASSED' ? 'YES' : 'NO';
			if (status === 'FAILED') {
				entry.failedCondition = 'BEARISH';
				entry.failedReason = details.notes || 'Not bearish';
			}
			break;
		case 'TOUCHING_SMA':
			entry.touchingSma = status === 'PASSED' ? 'YES' : 'NO';
			if (status === 'FAILED') {
				entry.failedCondition = 'TOUCHING_SMA';
				entry.failedReason = details.notes || 'Not touching SMA';
			}
			break;
		case 'NARROW_RANGE':
			entry.narrowRange = status === 'PASSED' ? 'YES' : 'NO';
			if (status === 'FAILED') {
				entry.failedCondition = 'NARROW_RANGE';
				entry.failedReason = details.notes || 'Range too wide';
			}
			break;
		case 'BREAKOUT':
			entry.breakout = status === 'PASSED' ? 'YES' : 'NO';
			if (status === 'FAILED') {
				entry.failedCondition = 'BREAKOUT';
				entry.failedReason = details.notes || 'Not breaking higher';
			}
			break;
		case 'ALL_CONDITIONS':
			if (status === 'PASSED') {
				entry.allConditionsPassed = 'YES';
				entry.failedCondition = 'NONE';
				entry.failedReason = 'All conditions passed';
			}
			break;
		case 'ERROR':
			entry.failedCondition = 'ERROR';
			entry.failedReason = details.notes || 'Exception occurred';
			break;
	}
}

/**
 * Write accumulated debug logs to CSV file (appends to existing file)
 */
function writeDebugLogToCSV(filename = 'baxter_debug.csv') {
	if (!ENABLE_CSV_DEBUG_LOGGER || debugLogData.size === 0) return;
	
	const logsDir = path.join(__dirname, '..', 'logs');
	if (!fs.existsSync(logsDir)) {
		fs.mkdirSync(logsDir, { recursive: true });
	}
	
	const filepath = path.join(logsDir, filename);
	
	const headers = [
		'timestamp',
		'symbol',
		'close',
		'high',
		'low',
		'open',
		'sma',
		'previousHigh',
		'previousLow',
		'previousClose',
		'dataLength',
		'maxPrice',
		'isBullish',
		'isBearish',
		'bullishMid',
		'bearishMid',
		'touchingSma',
		'smaLowBound',
		'smaHighBound',
		'narrowRange',
		'candleRange',
		'maxAllowedRange',
		'breakout',
		'allConditionsPassed',
		'failedCondition',
		'failedReason'
	];
	
	const fileExists = fs.existsSync(filepath);
	const needsHeader = !fileExists || fs.readFileSync(filepath, 'utf8').trim() === '';
	
	const rows = Array.from(debugLogData.values()).map(entry => 
		headers.map(header => {
			const value = entry[header];
			if (value === null || value === undefined || value === '') return '';
			if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
				return `"${value.replace(/"/g, '""')}"`;
			}
			return value;
		}).join(',')
	);
	
	let csvContent = '';
	if (needsHeader) {
		csvContent = headers.join(',') + '\n';
	}
	csvContent += rows.join('\n') + '\n';
	
	fs.appendFileSync(filepath, csvContent, 'utf8');
	console.log(`Debug log appended to: ${filepath} (${debugLogData.size} rows)`);
	
	debugLogData.clear();
}

/**
 * Clear debug log data (useful for testing or resetting between scans)
 */
function clearDebugLog() {
	debugLogData.clear();
}

/**
 * Scan stocks based on Baxter strategy (BULLISH or BEARISH)
 *
 * @param {string} [direction='BULLISH'] - 'BULLISH' or 'BEARISH'
 *
 * Conditions:
 * 1. Candle sentiment: BULLISH → [0] close > ([0] high + [0] low) / 2; BEARISH → [0] close < ([0] high + [0] low) / 2
 * 2. Placement on MA: [0] low * 0.998 <= [0] sma(close, 44) AND [0] high * 1.002 >= [0] sma(close, 44)
 * 3. Max stock price: [0] close < 5000
 * 4. Candle size: ([0] high - [0] low) <= ([0] high + [0] low) / 2 * 0.0046
 * 5. Entry point: BULLISH → [0] high > [-1] high; BEARISH → [0] low < [-1] low (breakout/breakdown - The Queen)
 */
async function scanBaxterStocks(stockList, endDateNew, interval = '5m', useCached = false, params = DEFAULT_PARAMS, direction = 'BULLISH') {
	const selectedStocks = [];
	const BATCH_SIZE = 5;

	params = { ...DEFAULT_PARAMS, ...params };
	const isBullishMode = (direction || 'BULLISH').toUpperCase() === 'BULLISH';
	const isBothMode = (direction || 'BOTH').toUpperCase() === 'BOTH';

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
				// console.log('df before processing:', df.chart.result[0].timestamp.slice(-2).map(t => getDateStringIND(t*1000)))
				df = processYahooData(df, interval, useCached);

				// console.log('scanning df:', df.slice(-2).map(d => ({...d, time: getDateStringIND(d.time)})))

				const resolution = parseInt(interval)
				// let df = await getDataFromMoneycontrol(sym, startDate, endDate, resolution, useCached);
				// console.log(df)
				// df = processMoneycontrolData(df, interval, useCached);

				if (!df || df.length === 0) {
					if (DEBUG) console.log('No data for', sym);
					logStockDebug(sym, null, 'DATA_FETCH', 'FAILED', { notes: 'No data returned' });
					no_data_stocks.push(sym);
					return null;
				}
				
				// Need at least 2 candles to compare [0] and [-1]
				if (df.length < 45) { // Need at least 44 for SMA + 1 more
					if (DEBUG) console.log('Not enough data for', sym);
					logStockDebug(sym, null, 'DATA_LENGTH', 'FAILED', { notes: `Only ${df.length} candles, need 45` });
					return null;
				}

				// Add 44-period SMA
				df = addMovingAverage(df, 'close', params.MA_WINDOW, 'sma');
				df = df.filter(r => r.close);
				
				// Get current and previous candles
				const currentCandle = df[df.length - 1];  // [0] - The Queen
				const previousCandle = df[df.length - 2]; // [-1]
				
				const timestamp = getDateStringIND(currentCandle.time);
				
				logStockDebug(sym, timestamp, 'DATA_FETCH', 'PASSED', {
					close: currentCandle.close,
					high: currentCandle.high,
					low: currentCandle.low,
					open: currentCandle.open,
					sma: currentCandle.sma,
					notes: `${df.length} candles available`
				});
				
				// Condition 3: Max stock price check
				if (currentCandle.close >= MAX_STOCK_PRICE) {
					if (DEBUG) console.log('Price too high for', sym);
					logStockDebug(sym, timestamp, 'MAX_PRICE', 'FAILED', {
						close: currentCandle.close,
						notes: `Price ${currentCandle.close} >= ${MAX_STOCK_PRICE}`
					});
					too_high_stocks.push(sym);
					return null;
				}
				
				logStockDebug(sym, timestamp, 'MAX_PRICE', 'PASSED', {
					close: currentCandle.close,
					notes: `Price ${currentCandle.close} < ${MAX_STOCK_PRICE}`
				});
				
				// Condition 1: Candle sentiment (Bullish or Bearish)
				const currentCandleMid = (currentCandle.high + currentCandle.low) / 2;
				const isBullishCandle = currentCandle.close > currentCandleMid;
				const isBearishCandle = currentCandle.close < currentCandleMid;
				const sentimentOk = isBothMode ? (isBullishCandle || isBearishCandle) : isBullishMode ? isBullishCandle : isBearishCandle;
				let conditionName = isBullishMode ? 'BULLISH' : 'BEARISH';

				if (isBothMode) {
					conditionName = isBullishCandle ? 'BULLISH' : isBearishCandle ? 'BEARISH' : 'BOTH';
				}

				if (!sentimentOk) {
					if (DEBUG) console.log(`Not ${conditionName.toLowerCase()} for`, sym);
					logStockDebug(sym, timestamp, conditionName, 'FAILED', {
						close: currentCandle.close,
						high: currentCandle.high,
						low: currentCandle.low,
						currentMid: currentCandleMid,
						notes: isBullishMode
							? `Close ${currentCandle.close} <= Mid ${currentCandleMid.toFixed(2)}`
							: `Close ${currentCandle.close} >= Mid ${currentCandleMid.toFixed(2)}`
					});
					return null;
				}

				logStockDebug(sym, timestamp, conditionName, 'PASSED', {
					close: currentCandle.close,
					high: currentCandle.high,
					low: currentCandle.low,
					currentMid: currentCandleMid,
					notes: isBullishMode
						? `Close ${currentCandle.close} > Mid ${currentCandleMid.toFixed(2)}`
						: `Close ${currentCandle.close} < Mid ${currentCandleMid.toFixed(2)}`
				});
				
				// Condition 2: Placement on moving average
				// [0] low * 0.998 <= [0] sma AND [0] high * 1.002 >= [0] sma
				const currentSma = currentCandle.sma;
				if (!currentSma) {
					if (DEBUG) console.log('No SMA for', sym);
					logStockDebug(sym, timestamp, 'SMA_AVAILABLE', 'FAILED', {
						notes: 'SMA not calculated'
					});
					return null;
				}
				
				const lowBound = currentCandle.low * (1 - params.TOUCHING_SMA_TOLERANCE);
				const highBound = currentCandle.high * (1 + params.TOUCHING_SMA_TOLERANCE);
				const isTouchingSma = lowBound <= currentSma && highBound >= currentSma;
				
				if (!isTouchingSma) {
					if (DEBUG) console.log('Not touching SMA for', sym);
					logStockDebug(sym, timestamp, 'TOUCHING_SMA', 'FAILED', {
						high: currentCandle.high,
						low: currentCandle.low,
						sma: currentSma,
						lowBound: lowBound,
						highBound: highBound,
						notes: `SMA ${currentSma.toFixed(2)} not between ${lowBound.toFixed(2)} and ${highBound.toFixed(2)}`
					});
					return null;
				}
				
				logStockDebug(sym, timestamp, 'TOUCHING_SMA', 'PASSED', {
					high: currentCandle.high,
					low: currentCandle.low,
					sma: currentSma,
					lowBound: lowBound,
					highBound: highBound,
					notes: `SMA ${currentSma.toFixed(2)} between ${lowBound.toFixed(2)} and ${highBound.toFixed(2)}`
				});
				
				// Condition 4: Candle size condition
				// ([0] high - [0] low) <= ([0] high + [0] low) / 2 * 0.0046
				const currentRange = currentCandle.high - currentCandle.low;
				const currentAvgPrice = (currentCandle.high + currentCandle.low) / 2;
				const maxAllowedRange = currentAvgPrice * params.NARROW_RANGE_TOLERANCE;
				const isNarrowRange = currentRange <= maxAllowedRange;
				
				if (!isNarrowRange) {
					if (DEBUG) console.log('Range too wide for', sym);
					logStockDebug(sym, timestamp, 'NARROW_RANGE', 'FAILED', {
						high: currentCandle.high,
						low: currentCandle.low,
						candleRange: currentRange,
						maxAllowedRange: maxAllowedRange,
						notes: `Range ${currentRange.toFixed(2)} > Max ${maxAllowedRange.toFixed(2)}`
					});
					return null;
				}
				
				logStockDebug(sym, timestamp, 'NARROW_RANGE', 'PASSED', {
					high: currentCandle.high,
					low: currentCandle.low,
					candleRange: currentRange,
					maxAllowedRange: maxAllowedRange,
					notes: `Range ${currentRange.toFixed(2)} <= Max ${maxAllowedRange.toFixed(2)}`
				});

				// Condition 5: Breakout (bullish) or breakdown (bearish)
				// const hasBreakout = isBullishMode
				// 	? currentCandle.high > previousCandle.high
				// 	: currentCandle.low < previousCandle.low;

				// if (!hasBreakout) {
				// 	if (DEBUG) console.log(`No ${isBullishMode ? 'breakout' : 'breakdown'} for`, sym);
				// 	logStockDebug(sym, timestamp, 'BREAKOUT', 'FAILED', {
				// 		notes: isBullishMode
				// 			? `[0] high ${currentCandle.high.toFixed(2)} <= [-1] high ${previousCandle.high.toFixed(2)}`
				// 			: `[0] low ${currentCandle.low.toFixed(2)} >= [-1] low ${previousCandle.low.toFixed(2)}`
				// 	});
				// 	return null;
				// }

				// logStockDebug(sym, timestamp, 'BREAKOUT', 'PASSED', {
				// 	notes: isBullishMode
				// 		? `[0] high ${currentCandle.high.toFixed(2)} > [-1] high ${previousCandle.high.toFixed(2)}`
				// 		: `[0] low ${currentCandle.low.toFixed(2)} < [-1] low ${previousCandle.low.toFixed(2)}`
				// });

				logStockDebug(sym, timestamp, 'ALL_CONDITIONS', 'PASSED', {
					close: currentCandle.close,
					high: currentCandle.high,
					low: currentCandle.low,
					sma: currentCandle.sma,
					notes: 'Stock selected for Baxter strategy'
				});
				
				// All conditions met - return stock data
				const resultDirection = isBothMode ? (isBullishCandle ? 'BULLISH' : isBearishCandle ? 'BEARISH' : 'UNKNOWN') : isBullishMode ? 'BULLISH' : 'BEARISH';
				return {
					sym,
					open: currentCandle.open,
					close: currentCandle.close,
					high: currentCandle.high,
					low: currentCandle.low,
					time: getDateStringIND(currentCandle.time),
					direction: resultDirection,
					sma: currentCandle.sma,
					// previousCandle: {
					// 	open: previousCandle.open,
					// 	close: previousCandle.close,
					// 	high: previousCandle.high,
					// 	low: previousCandle.low,
					// 	sma: previousCandle.sma
					// }
				};
			} catch (error) {
				if (DEBUG) console.error(`Error processing ${sym}:`, error);
				console.trace(error);
				logStockDebug(sym, null, 'ERROR', 'FAILED', {
					notes: `Exception: ${error.message}`
				});
				errored_stocks.push(sym);
				return null;
			}
		});
		
		// Wait for all promises in the batch to resolve
		const batchResults = await Promise.all(batchPromises);
		selectedStocks.push(...batchResults.filter(result => result !== null));
	}
	
	if (ENABLE_CSV_DEBUG_LOGGER) {
		writeDebugLogToCSV();
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

// ;(async function testBaxterData() {
// 	const { startDate, endDate } = getDateRange();
					
// 	// Fetch 15-minute data
// 	let df = await getDataFromYahoo('INDIGO', 5, '3m', startDate, endDate);
// 	// console.log('df before processing:', df.chart.result[0].timestamp.slice(-2).map(t => getDateStringIND(t*1000)))
// 	df = processYahooData(df, '3m');

// 	// console.log(df)

// })()


module.exports = {
	scanBaxterStocks,
	writeDebugLogToCSV,
	clearDebugLog
};
