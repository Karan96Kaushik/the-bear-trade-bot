const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../kite/utils");
const { getDateRange } = require("./index");
const fs = require('fs');
const path = require('path');

const DEBUG = process.env.DEBUG || false;
const MAX_STOCK_PRICE = 5000;
const ENABLE_CSV_DEBUG_LOGGER = process.env.ENABLE_CSV_DEBUG_LOGGER == undefined ? true : process.env.ENABLE_CSV_DEBUG_LOGGER == 'true';

const DEFAULT_PARAMS = {
	EMA_WINDOW: 50,
	RISK_AMOUNT: 200,
};

let debugLogData = new Map();

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
			ema50: '',
			prevClose: '',
			prevEma50: '',
			dataLength: '',
			failedCondition: '',
			failedReason: '',
			maxPrice: '',
			isBullishCrossover: '',
			isBearishCrossover: '',
			slPrice: '',
			quantity: '',
			allConditionsPassed: 'NO'
		});
	}

	const entry = debugLogData.get(key);

	if (details.close) entry.close = details.close;
	if (details.high) entry.high = details.high;
	if (details.low) entry.low = details.low;
	if (details.open) entry.open = details.open;
	if (details.ema50) entry.ema50 = details.ema50;
	if (details.prevClose) entry.prevClose = details.prevClose;
	if (details.prevEma50) entry.prevEma50 = details.prevEma50;
	if (details.slPrice) entry.slPrice = details.slPrice;
	if (details.quantity) entry.quantity = details.quantity;

	switch (condition) {
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
		case 'BULLISH_CROSSOVER':
			entry.isBullishCrossover = status === 'PASSED' ? 'YES' : 'NO';
			if (status === 'FAILED') {
				entry.failedCondition = 'BULLISH_CROSSOVER';
				entry.failedReason = details.notes || 'No bullish crossover';
			}
			break;
		case 'BEARISH_CROSSOVER':
			entry.isBearishCrossover = status === 'PASSED' ? 'YES' : 'NO';
			if (status === 'FAILED') {
				entry.failedCondition = 'BEARISH_CROSSOVER';
				entry.failedReason = details.notes || 'No bearish crossover';
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

function writeDebugLogToCSV(filename = 'athena_debug.csv') {
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
		'ema50',
		'prevClose',
		'prevEma50',
		'dataLength',
		'maxPrice',
		'isBullishCrossover',
		'isBearishCrossover',
		'slPrice',
		'quantity',
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

function clearDebugLog() {
	debugLogData.clear();
}

/**
 * Add exponential moving average for a specified key
 * @param {Array} data - Array of objects containing OHLCV data
 * @param {string} key - The key for which to calculate EMA
 * @param {number} window - The window size for EMA
 * @param {string} newKey - The key to store the EMA results
 * @returns {Array} The original array with the new EMA key added
 */
function addEMA(data, key, window, newKey) {
	const multiplier = 2 / (window + 1);
	let ema = null;

	return data.map((item, index, array) => {
		const value = Number(item[key]);

		if (!Number.isFinite(value) || value <= 0) {
			return { ...item, [newKey]: null };
		}

		if (ema === null) {
			const start = Math.max(0, index - window + 1);
			const values = array
				.slice(start, index + 1)
				.map(i => Number(i[key]))
				.filter(v => Number.isFinite(v) && v > 0);

			if (values.length < window) {
				return { ...item, [newKey]: null };
			}

			ema = values.reduce((sum, val) => sum + val, 0) / values.length;
		} else {
			ema = (value - ema) * multiplier + ema;
		}

		return {
			...item,
			[newKey]: Number(ema.toFixed(2))
		};
	});
}

function detectCrossover(currentCandle, previousCandle, direction) {
	if (!currentCandle?.ema50 || !previousCandle?.ema50) return false;

	if (direction === 'BULLISH') {
		return previousCandle.close < previousCandle.ema50 && currentCandle.close > currentCandle.ema50;
	}

	if (direction === 'BEARISH') {
		return previousCandle.close > previousCandle.ema50 && currentCandle.close < currentCandle.ema50;
	}

	return false;
}

/**
 * Scan stocks based on Athena strategy (50 EMA crossover on 5m)
 *
 * BULLISH: previous close < EMA50, current close > EMA50
 * BEARISH: previous close > EMA50, current close < EMA50
 */
async function scanAthenaStocks(stockList, endDateNew, interval = '5m', useCached = false, params = DEFAULT_PARAMS, direction = 'BULLISH') {
	const selectedStocks = [];
	const BATCH_SIZE = 5;

	params = { ...DEFAULT_PARAMS, ...params };
	const isBullishMode = (direction || 'BULLISH').toUpperCase() === 'BULLISH';
	const isBothMode = (direction || 'BOTH').toUpperCase() === 'BOTH';
	const emaWindow = Number(params.EMA_WINDOW);
	const riskAmount = Number(params.RISK_AMOUNT);

	const batches = [];
	for (let i = 0; i < stockList.length; i += BATCH_SIZE) {
		batches.push(stockList.slice(i, i + BATCH_SIZE));
	}

	const no_data_stocks = [];
	const too_high_stocks = [];
	const errored_stocks = [];

	for (const batch of batches) {
		const batchPromises = batch.map(async (sym) => {
			try {
				const { startDate, endDate } = getDateRange(endDateNew);

				let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);
				df = processYahooData(df, interval, useCached);

				if (!df || df.length === 0) {
					if (DEBUG) console.log('No data for', sym);
					logStockDebug(sym, null, 'DATA_FETCH', 'FAILED', { notes: 'No data returned' });
					no_data_stocks.push(sym);
					return null;
				}

				df = df.filter(r => r.close);
				df = addEMA(df, 'close', emaWindow, 'ema50');

				if (df.length < emaWindow + 1) {
					if (DEBUG) console.log('Not enough data for', sym);
					logStockDebug(sym, null, 'DATA_LENGTH', 'FAILED', {
						notes: `Only ${df.length} candles, need ${emaWindow + 1}`
					});
					return null;
				}

				const currentCandle = df[df.length - 1];
				const previousCandle = df[df.length - 2];
				const timestamp = getDateStringIND(currentCandle.time);

				logStockDebug(sym, timestamp, 'DATA_FETCH', 'PASSED', {
					close: currentCandle.close,
					high: currentCandle.high,
					low: currentCandle.low,
					open: currentCandle.open,
					ema50: currentCandle.ema50,
					prevClose: previousCandle.close,
					prevEma50: previousCandle.ema50,
					notes: `${df.length} candles available`
				});

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

				const isBullishCrossover = detectCrossover(currentCandle, previousCandle, 'BULLISH');
				const isBearishCrossover = detectCrossover(currentCandle, previousCandle, 'BEARISH');

				let resultDirection = null;
				if (isBothMode) {
					if (isBullishCrossover) resultDirection = 'BULLISH';
					else if (isBearishCrossover) resultDirection = 'BEARISH';
				} else if (isBullishMode) {
					resultDirection = isBullishCrossover ? 'BULLISH' : null;
				} else {
					resultDirection = isBearishCrossover ? 'BEARISH' : null;
				}

				if (!resultDirection) {
					const conditionName = isBothMode
						? (isBullishCrossover ? 'BULLISH_CROSSOVER' : 'BEARISH_CROSSOVER')
						: (isBullishMode ? 'BULLISH_CROSSOVER' : 'BEARISH_CROSSOVER');

					logStockDebug(sym, timestamp, conditionName, 'FAILED', {
						close: currentCandle.close,
						ema50: currentCandle.ema50,
						prevClose: previousCandle.close,
						prevEma50: previousCandle.ema50,
						notes: 'No EMA crossover detected'
					});
					return null;
				}

				const entryPrice = currentCandle.close;
				const slPrice = resultDirection === 'BULLISH' ? currentCandle.low : currentCandle.high;
				const riskPerShare = Math.abs(entryPrice - slPrice);
				const quantity = riskPerShare > 0 ? Math.ceil(riskAmount / riskPerShare) : 0;

				if (quantity <= 0) {
					logStockDebug(sym, timestamp, 'ERROR', 'FAILED', {
						notes: 'Invalid quantity - risk per share is zero'
					});
					return null;
				}

				const crossoverCondition = resultDirection === 'BULLISH' ? 'BULLISH_CROSSOVER' : 'BEARISH_CROSSOVER';
				logStockDebug(sym, timestamp, crossoverCondition, 'PASSED', {
					close: currentCandle.close,
					ema50: currentCandle.ema50,
					prevClose: previousCandle.close,
					prevEma50: previousCandle.ema50,
					slPrice,
					quantity,
					notes: `${resultDirection} crossover detected`
				});

				logStockDebug(sym, timestamp, 'ALL_CONDITIONS', 'PASSED', {
					close: currentCandle.close,
					ema50: currentCandle.ema50,
					slPrice,
					quantity,
					notes: 'Stock selected for Athena strategy'
				});

				return {
					sym,
					open: currentCandle.open,
					close: currentCandle.close,
					high: currentCandle.high,
					low: currentCandle.low,
					time: getDateStringIND(currentCandle.time),
					candleTime: currentCandle.time,
					direction: resultDirection,
					ema50: currentCandle.ema50,
					entryPrice,
					slPrice,
					quantity,
					data: {
						currentCandle,
						previousCandle,
					},
					display: {
						sym,
						open: currentCandle.open,
						close: currentCandle.close,
						high: currentCandle.high,
						low: currentCandle.low,
						time: getDateStringIND(currentCandle.time),
						direction: resultDirection,
						ema50: currentCandle.ema50,
						slPrice,
						quantity,
					}
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

		const batchResults = await Promise.all(batchPromises);
		selectedStocks.push(...batchResults.filter(result => result !== null));
	}

	if (ENABLE_CSV_DEBUG_LOGGER) {
		writeDebugLogToCSV();
	}

	if (DEBUG) {
		console.log(`Athena scan results: ${selectedStocks.length} stocks selected`);
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
	addEMA,
	scanAthenaStocks,
	writeDebugLogToCSV,
	clearDebugLog,
	DEFAULT_PARAMS
};
