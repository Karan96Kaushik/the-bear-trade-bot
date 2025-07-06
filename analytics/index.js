const { processYahooData, getDataFromYahoo, getDhanNIFTY50Data, getMcIndicators, getGrowwChartData, processGrowwData } = require("../kite/utils");
const { getDateStringIND } = require("../kite/utils");

const _ = require('lodash')

const MA_TREND_WINDOW = 10;
const DEBUG = process.env.DEBUG || false;
const MAX_STOCK_PRICE = 5000;

function analyzeDataForTrends(df, sym, tolerance = 0.01) {
	try {
		// Calculate moving averages
		df['sma44'] = calculateMovingAverage(df['close'], 44);
		df['sma7_vol'] = calculateMovingAverage(df['volume'], 7);
		
		const events = [];
		const i = df.length - 1;
		
		if (!isNaN(df[i]['sma44'])) {
			// Check for upward trend
			if (checkUpwardTrend(df, i, tolerance)) {
				events.push(df[i-2], df[i-1], df[i]);
				return 'BULLISH'
			}
			// Check for downward trend
			else if (checkDownwardTrend(df, i, tolerance)) {
				events.push(df[i-2], df[i-1], df[i]);
				return 'BEARISH'
			}
		}
		
		// if (events.length > 0) {
		//     return events;
		// }
	} catch (e) {
		console.error(e, sym);
	}
	return null;
}

// Helper functions
function calculateMovingAverage(data, window) {
	return data.map((_, index, array) => 
		array.slice(Math.max(0, index - window + 1), index + 1)
	.reduce((sum, num) => sum + num, 0) / Math.min(window, index + 1)
);
}

function checkLowsDescending(df, i) {
	// Check if we have enough candles
	if (i < 3) return false;
	
	// Check Low of Candle t-2 > Low of Candle t-0
	const lowT2vsT0 = df[i-2].low > df[i].low;
	// Check Low of Candle t-3 > Low of Candle t-0
	const lowT3vsT0 = df[i-3].low > df[i].low;
	
	return lowT2vsT0 && lowT3vsT0;
}

function checkLowsAboveMA(df, i) {
	// Check if we have enough candles
	if (i < 3) return false;
	
	const maT2 = df[i-2]['sma44'];
	const maT3 = df[i-3]['sma44'];
	
	// Check Low of Candle t-2 > MA & Low of Candle t-3 > MA
	return df[i-2].low > maT2 && df[i-3].low > maT3;
}

// BULLISH
function checkUpwardTrend(df, i, tolerance = 0.015) {
	const currentCandle = df[i];
	const candleType = categorizeStock(currentCandle)
	if (DEBUG) {
		console.log(currentCandle)
		console.log('candlePlacement', checkCandlePlacement(df[i], df[i]['sma44']))
		console.log('isBullishCandle', isBullishCandle(df[i]))
		console.log('isDojiCandle', isDojiCandle(df[i]))
		console.log('isNarrowRange', isNarrowRange(currentCandle))
		// console.log('checkLowsAboveMA', checkLowsAboveMA(df, i))
		console.log('checkLowsDescending', checkLowsDescending(df, i))
		console.log('candleType', candleType)
	}
	
	return (
		checkCandlePlacement(currentCandle, currentCandle['sma44']) &&
		(candleType == 'BL' || candleType == 'DOJI') &&
		// (isBullishCandle(currentCandle) || isDojiCandle(currentCandle)) &&
		isNarrowRange(currentCandle) &&
		// checkLowsAboveMA(df, i) &&
		checkLowsDescending(df, i) 
	);
}

/*

BULLISH TREND

A: Stock Symbol
B: High
C: Low
D: Open
E: Close
F: SMA44

=AND(
OR( 
ABS(F3-C3) < (F3*0.01), 
AND( F3>C3 , F3<B3 ) 
),
OR( 
E3>D3, 
(B3-E3) < (E3-C3), 
ABS(E3-((B3+C3)/2))<((B3+C3)/2)*0.001 
)
)

*/

function checkHighsAscending(df, i) {
	// Check if we have enough candles
	if (i < 3) return false;
	
	// Check High of Candle t-2 < High of Candle t-0
	const highT2vsT0 = df[i-2].high < df[i].high;
	// Check High of Candle t-3 < High of Candle t-0
	const highT3vsT0 = df[i-3].high < df[i].high;
	
	return highT2vsT0 && highT3vsT0;
}

function checkHighsBelowMA(df, i) {
	// Check if we have enough candles
	if (i < 3) return false;
	
	const maT2 = df[i-2]['sma44'];
	const maT3 = df[i-3]['sma44'];
	
	// Check High of Candle t-2 < MA & High of Candle t-3 < MA
	return df[i-2].high < maT2 && df[i-3].high < maT3;
}

function categorizeStock(candle) {
	const { high, low, open, close } = candle;
	const average = (a, b) => (a + b) / 2;
	const range = high - low;
	
	if (
		open >= average(low, high) - (0.2 * range) &&
		open <= average(low, high) + (0.2 * range) &&
		close >= average(low, high) - (0.2 * range) &&
		close <= average(low, high) + (0.2 * range)
	) {
		return "DOJI";
	} else if (
		open >= high - (0.35 * range) &&
		close >= high - (0.35 * range)
	) {
		return "BL";
	} else if (
		open <= low + (0.35 * range) &&
		close <= low + (0.35 * range)
	) {
		return "BR";
	} else if (
		open >= close &&
		open <= average(high, low) &&
		close <= average(high, low)
	) {
		return "BR";
	} else if (
		close >= open &&
		open >= average(high, low) &&
		close >= average(high, low)
	) {
		return "BL";
	} else if (
		Math.abs(open - close) >= 0.5 * range
	) {
		return close >= open ? "BL" : "BR";
	} else {
		return "";
	}
}

// BEARISH
function checkDownwardTrend(df, i, tolerance = 0.015) {
	const currentCandle = df[i];
	const candleType = categorizeStock(currentCandle)
	
	if (DEBUG) {
		console.log('candlePlacement', checkCandlePlacement(df[i], df[i]['sma44']))
		console.log('isBearishCandle', isBearishCandle(df[i]))
		console.log('isDojiCandle', isDojiCandle(df[i]))
		console.log('isNarrowRange', isNarrowRange(currentCandle))
		console.log('checkHighsAscending', checkHighsAscending(df, i))
		console.log('candleType', candleType)
		// console.log('checkHighsBelowMA', checkHighsBelowMA(df[i]))
	}
	
	return (
		checkCandlePlacement(currentCandle, currentCandle['sma44']) &&
		(candleType == 'BR' || candleType == 'DOJI') &&
		// (isBearishCandle(currentCandle) || isDojiCandle(currentCandle)) &&
		isNarrowRange(currentCandle) &&
		// checkHighsBelowMA(df, i) &&
		checkHighsAscending(df, i)
	);
}

/*

BEARISH TREND

A: Stock Symbol
B: High
C: Low
D: Open
E: Close
F: SMA44

=AND(
OR( 
ABS(F3-B3)<(F3*0.01), 
AND( F3>C3 , F3<B3 ) 
),
OR( 
E3<D3, 
(B3-E3)>(E3-C3), 
ABS(E3-((B3+C3)/2))<((B3+C3)/2)*0.001 
)
)

*/

/**
* Add moving average for a specified key to an array of objects
* @param {Array} data - Array of objects containing OHLCV data
* @param {string} key - The key for which to calculate the moving average
* @param {number} window - The window size for the moving average
* @param {string} newKey - The key to store the moving average results
* @returns {Array} The original array with the new moving average key added
*/
function addMovingAverage(data, key, window, newKey) {
	return data.map((item, index, array) => {
		const start = Math.max(0, index - window + 1);
		const values = array.slice(start, index + 1).filter(i => i[key]>0).map(i => i[key]);
		const average = values.reduce((sum, val) => sum + val, 0) / values.length;
		
		return {
			...item,
			[newKey]: Number(average.toFixed(2))
		};
	});
}

function calculateRSI(df, window = 14) {
	// Skip first row since we can't calculate change
	const changes = df.slice(1).map((item, index) => {
		const prevClose = df[index].close;
		const change = item.close - prevClose;
		return {
			gain: change > 0 ? change : 0,
			loss: change < 0 ? -change : 0
		};
	});
	
	// Calculate initial averages
	const initialGains = changes.slice(0, window);
	const initialLosses = changes.slice(0, window);
	let avgGain = initialGains.reduce((sum, curr) => sum + curr.gain, 0) / window;
	let avgLoss = initialLosses.reduce((sum, curr) => sum + curr.loss, 0) / window;
	
	const rsi = [null]; // First period will be null
	
	for (let i = 1; i <= window; i++) {
		rsi.push(null);
	}
	
	// Calculate subsequent RSIs using smoothing
	for (let i = window + 1; i < df.length; i++) {
		avgGain = ((avgGain * (window - 1)) + changes[i - 1].gain) / window;
		avgLoss = ((avgLoss * (window - 1)) + changes[i - 1].loss) / window;
		rsi.push(100 - (100 / (1 + avgGain / (avgLoss || 1))));
	}
	
	return rsi;
}

function addRSI(df, window = 14) {
	const rsi = calculateRSI(df, window);
	// console.log(rsi.length, df.length)
	return df.map((item, index) => ({
		...item,
		rsi: rsi[index]
	}));
}

function countMATrendRising(maValues) {
	const _maValues = [...maValues]
	_maValues.reverse()
	// console.log(`${_maValues[0]} <= ${_maValues[1]}`)
	if (_maValues[0] <= _maValues[1]) return 0
	for (let i = 0; i < _maValues.length - 1; i++) {
		if (_maValues[i] <= _maValues[i+1])
			return i + 1
	}
	return maValues.length
}

function checkMARising(df, window = 10) {
	const maValues = df.slice(-window).map(row => row['sma44']);
	const trendCount = countMATrendRising(maValues);
	return trendCount >= window;
}

function countMATrendFalling(maValues) {
	const _maValues = [...maValues]
	_maValues.reverse()
	// console.log(`${_maValues[0]} >= ${_maValues[1]}`)
	if (_maValues[0] >= _maValues[1]) return 0
	for (let i = 0; i < _maValues.length - 1; i++) {
		if (_maValues[i] >= _maValues[i+1])
			return i + 1
	}
	return maValues.length
}

function checkMAFalling(df, window = 10) {
	const maValues = df.slice(-window).map(row => row['sma44']);
	const trendCount = countMATrendFalling(maValues);
	return trendCount >= window;
}

function checkCandleConditions(row, maValue, tolerance = 0.01) {
	const { open, close, high, low } = row;
	
	const condition1 = close > open && Math.abs(close - open) / open < 0.05;
	const condition2 = close > (high + low) / 2;
	const condition3 = (Math.abs(maValue - low) < (maValue * tolerance)) || (maValue > low && maValue < high);
	return (condition1 || condition2) && condition3;
}

function checkReverseCandleConditions(row, maValue, tolerance = 0.01) {
	const { open, close, high, low } = row;
	
	const condition1 = close < open && Math.abs(close - open) / open < 0.05;
	const condition2 = close < (high + low) / 2;
	const condition3 = (Math.abs(maValue - high) < (maValue * tolerance)) || (maValue < high && maValue > low);
	console.log(condition1, condition2, condition3)
	return (condition1 || condition2) && condition3;
}

function getDateRange(endDateNew) {
	let endDate = new Date();
	endDate.setUTCSeconds(10);
	
	if (endDateNew) {
		endDate = new Date(endDateNew);
	}
	
	const startDate = new Date(endDate);
	startDate.setDate(startDate.getDate() - 6);
	
	return { startDate, endDate };
}

function removeIncompleteCandles(df, useCached = false) {
	if (!df || df.length === 0) return df;
	
	// Remove last candle as it's likely incomplete
	df.pop();
	
	/**
	* 
	* TODO:
	*  - Check in production if this is needed
	*/
	
	if (!useCached) {
		df.pop();
	}
	
	return df;
}

async function getLastCandle(sym, endDateNew, interval = '15m') {
	try {
		
		let endDate = new Date();
		endDate.setUTCSeconds(10);
		
		if (endDateNew) {
			endDate = new Date(endDateNew);
		}
		
		const startDate = new Date(endDate);
		startDate.setDate(startDate.getDate() - 6);
		
		let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate);
		df = processYahooData(df);
		
		/*
		Remove incomplete candles
		*/
		df.pop()
		// Confirm that the final candle will be for today only and then remve the additional incomplete one
		if (new Date(df[df.length - 2].time).getDate() === new Date().getDate()) {
			df.pop()
		}
		
		if (DEBUG) {
			console.log('----')
		}
		
		if (!df || df.length === 0) return null;
		
		df = addMovingAverage(df, 'close', 44, 'sma44');
		df = df.filter(r => r.close);
		
		const firstCandle = df[df.length - 1];
		
		return firstCandle;
		
	} catch (e) {
		console.error(e?.response?.data || e.message || e, sym);
	}
	return null;
}

const DEFAULT_PARAMS = {
    TOUCHING_SMA_TOLERANCE: 0.0003,
    TOUCHING_SMA_15_TOLERANCE: 0.0003,
    NARROW_RANGE_TOLERANCE: 0.0046,
    WIDE_RANGE_TOLERANCE: 0.00055,
    CANDLE_CONDITIONS_SLOPE_TOLERANCE: 1,
    BASE_CONDITIONS_SLOPE_TOLERANCE: 1,
    MA_WINDOW: 44,
	MA_WINDOW_5: 22,
    CHECK_75MIN: 1
}

async function scanZaireStocks(stockList, endDateNew, interval='15m', checkV2=false, checkV3=false, useCached=false, params=DEFAULT_PARAMS, options={}) {
	const selectedStocks = [];
	const BATCH_SIZE = 1; // Adjust batch size based on your needs
	
	// Split stockList into batches
	const batches = [];
	for (let i = 0; i < stockList.length; i += BATCH_SIZE) {
		batches.push(stockList.slice(i, i + BATCH_SIZE));
	}
	const no_data_stocks = [];
	const too_high_stocks = [];
	const too_many_incomplete_candles_stocks = [];
	
	// Process each batch in parallel
	for (const batch of batches) {
		const batchPromises = batch.map(async (sym) => {
			try {
				const { startDate, endDate } = getDateRange(endDateNew);
				let df75min = [];
				
				let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);
				df = processYahooData(df, interval, useCached);

				// let df = await getGrowwChartData(sym, startDate, endDate, Number(interval), useCached);
				// df = processGrowwData(df, interval, useCached);

				// console.log(df.slice(-3).map(d => ({...d, time: getDateStringIND(d.time)})))
				
				// df = removeIncompleteCandles(df, useCached);
				// console.log(df.slice(-3).map(d => ({...d, time: getDateStringIND(d.time)})))
				
				if (DEBUG) {
					console.log('----')
				}
				
				if (!df || df.length === 0) {
					if (DEBUG) console.debug('No data')
					no_data_stocks.push(sym)
					return null;
				}
				
				if (df[df.length - 1].high > MAX_STOCK_PRICE)  {
					if (DEBUG) console.debug('Too high')
					too_high_stocks.push(sym)
					return null;
				}
				
				if (df.slice(-44).filter(r => !r.close).length > 4) {
					if (DEBUG) console.debug('Too many incomplete candles', sym)
					too_many_incomplete_candles_stocks.push(sym)
					return null;
				}
				
				df = addMovingAverage(df, 'close', params.MA_WINDOW || 44, 'sma44');
				df = df.filter(r => r.close);
				
				// const isRising = checkMARising(df, MA_TREND_WINDOW) ? 'BULLISH' : checkMAFalling(df, MA_TREND_WINDOW) ? 'BEARISH' : null;
				// if (DEBUG) {
				//   console.log(sym, isRising)
				// }
				// if (!isRising) continue;
				
				const firstCandle = df[df.length - 1];
				const maValue = firstCandle['sma44'];
				
				let conditionsMet = null
				if (checkV3) {
					
					let df5min = await getDataFromYahoo(sym, 5, '5m', startDate, endDate, useCached);
					df5min = processYahooData(df5min, '5m', useCached);

					if (!df5min || df5min.length === 0) return null;
					df5min = addMovingAverage(df5min, 'close', params.MA_WINDOW_5 || 22, 'sma44');
					df5min = df5min.filter(r => r.close);
					
					// 75 Mins candles needs more data
					let earlierStart = new Date(startDate)
					earlierStart.setDate(earlierStart.getDate() - 5)
					
					let df15min = await getDataFromYahoo(sym, 5, '15m', earlierStart, endDate, useCached);
					df15min = processYahooData(df15min, '15m', useCached);

					let df15min_copy = [...df15min]
					
					if (!df15min || df15min.length === 0) return null;
					df15min = addMovingAverage(df15min, 'close', params.MA_WINDOW || 44, 'sma44');
					df15min = df15min.filter(r => r.close);
					
					let startIndex = 0;
					for (let i = 0; i < df15min_copy.length; i++) {
						const ts = new Date(df15min_copy[i].time);
						if (['3:45','5:0','6:15','7:30','8:45'].includes(ts.getUTCHours() + ':' + ts.getUTCMinutes())) {
							startIndex = i;
							break;
						}
					}
					
					for (let i = startIndex; i < df15min_copy.length; i += 5) {
						if (i + 4 >= df15min_copy.length) break;
						
						const fiveCandles = df15min_copy.slice(i, i + 5);
						
						// const ts = new Date(fiveCandles[0].time)
						// console.debug(ts.getUTCHours() + ':' + ts.getUTCMinutes(), ['3:45','5:0','6:15','7:30','8:45'].includes(ts.getUTCHours() + ':' + ts.getUTCMinutes()) ? '✅' : '❌')
						// if (!['3:45','5:0','6:15','7:30','8:45'].includes(ts.getUTCHours() + ':' + ts.getUTCMinutes())) continue
						
						const combined = {
							time: fiveCandles[0].time,
							open: fiveCandles[0].open,
							high: Math.max(...fiveCandles.map(c => c.high)),
							low: Math.min(...fiveCandles.map(c => c.low)),
							close: fiveCandles[4].close,
							volume: fiveCandles.reduce((sum, c) => sum + c.volume, 0)
						};
						df75min.push(combined);
					}
					// console.log(df75min.length)
					
					df75min = addMovingAverage(df75min, 'close', params.MA_WINDOW || 44, 'sma44');
					df75min = df75min.filter(r => r.close);
					
					/**
					* 
					* Debugging 75 min candles
					* 
					*/
					
					// console.debug(df75min.map(d => ({...d, time: getDateStringIND(d.time)})))
					
					// conditionsMet = checkV3Conditions(df5min, df15min, df75min, params)
					conditionsMet = checkV3ConditionsNumerical(df5min, df15min, df75min, params)
				}
				else if (checkV2) {
					conditionsMet = checkV2Conditions(df)
				} else {
					conditionsMet = checkUpwardTrend(df, df.length - 1) ? 'BULLISH' : checkDownwardTrend(df, df.length - 1) ? 'BEARISH' : null;
				}

				// let result = conditionsMet;
				result = conditionsMet.result;
				
				if (result) {
					const t2Candle = df75min[df75min.length - 1]
					t2Candle.time = getDateStringIND(t2Candle.time)
					const t3Candle = df75min[df75min.length - 2]
					t3Candle.time = getDateStringIND(t3Candle.time)
					
					return {
						sym,
						open: firstCandle.open,
						close: firstCandle.close,
						high: firstCandle.high,
						low: firstCandle.low,
						time: getDateStringIND(firstCandle.time),
						'sma44': maValue,
						volume: firstCandle.volume,
						direction: result,
						t75_0: t2Candle,
						t75_1: t3Candle,
						sma44_0: df[df.length - 1]?.sma44,
						sma44_1: df[df.length - 2]?.sma44,
						sma44_2: df[df.length - 3]?.sma44,
						sma44_3: df[df.length - 4]?.sma44,
						source: 'zaire',

						data: conditionsMet
					};
				}

				if (options.all_results) {
					const t2Candle = df75min[df75min.length - 1]
					t2Candle.time = getDateStringIND(t2Candle.time)
					const t3Candle = df75min[df75min.length - 2]
					t3Candle.time = getDateStringIND(t3Candle.time)
					
					return {
						sym,
						open: firstCandle.open,
						close: firstCandle.close,
						high: firstCandle.high,
						low: firstCandle.low,
						time: getDateStringIND(firstCandle.time),
						'sma44': maValue,
						volume: firstCandle.volume,
						direction: result,
						t75_0: t2Candle,
						t75_1: t3Candle,
						sma44_0: df[df.length - 1]?.sma44,
						sma44_1: df[df.length - 2]?.sma44,
						sma44_2: df[df.length - 3]?.sma44,
						sma44_3: df[df.length - 4]?.sma44,

						data: conditionsMet
					};
				}
			} catch (e) {
				console.log(e?.response?.data || e.message || e, sym);
				console.trace(e);
			}
			return null;
		});
		
		// Wait for all promises in the batch to resolve
		const batchResults = await Promise.all(batchPromises);
		selectedStocks.push(...batchResults.filter(result => result !== null));
	}

	return {
		selectedStocks,
		no_data_stocks,
		too_high_stocks,
		too_many_incomplete_candles_stocks
	};
}


async function scanLightyearD2Stocks(stockList, endDateNew, interval='5m', useCached=false, params=DEFAULT_PARAMS, options={}) {
	const selectedStocks = [];
	const BATCH_SIZE = 1; // Adjust batch size based on your needs
	
	// Split stockList into batches
	const batches = [];
	for (let i = 0; i < stockList.length; i += BATCH_SIZE) {
		batches.push(stockList.slice(i, i + BATCH_SIZE));
	}
	const no_data_stocks = [];
	const too_high_stocks = [];
	const too_many_incomplete_candles_stocks = [];
	
	// Process each batch in parallel
	for (const batch of batches) {
		const batchPromises = batch.map(async (sym) => {
			try {
				const { startDate, endDate } = getDateRange(endDateNew);
				
				let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);
				df = processYahooData(df, interval, useCached);

				// let df = await getGrowwChartData(sym, startDate, endDate, Number(interval), useCached);
				// df = processGrowwData(df, interval, useCached);

				// console.log(df.slice(-3).map(d => ({...d, time: getDateStringIND(d.time)})))
				
				// df = removeIncompleteCandles(df, useCached);
				// console.log(df.slice(-3).map(d => ({...d, time: getDateStringIND(d.time)})))
				
				if (DEBUG) {
					console.log('----')
				}
				
				if (!df || df.length === 0) {
					if (DEBUG) console.debug('No data')
					no_data_stocks.push(sym)
					return null;
				}
				
				if (df[df.length - 1].high > MAX_STOCK_PRICE)  {
					if (DEBUG) console.debug('Too high')
					too_high_stocks.push(sym)
					return null;
				}
				
				if (df.slice(-44).filter(r => !r.close).length > 4) {
					if (DEBUG) console.debug('Too many incomplete candles', sym)
					too_many_incomplete_candles_stocks.push(sym)
					return null;
				}
				
				df = addMovingAverage(df, 'close', params.MA_WINDOW || 44, 'sma44');
				df = df.filter(r => r.close);
				
				// const isRising = checkMARising(df, MA_TREND_WINDOW) ? 'BULLISH' : checkMAFalling(df, MA_TREND_WINDOW) ? 'BEARISH' : null;
				// if (DEBUG) {
				//   console.log(sym, isRising)
				// }
				// if (!isRising) continue;
				
				const firstCandle = df[df.length - 1];
				const maValue = firstCandle['sma44'];
				
				let conditionsMet = null
				
				let df5min = await getDataFromYahoo(sym, 5, '5m', startDate, endDate, useCached);
				df5min = processYahooData(df5min, '5m', useCached);

				if (!df5min || df5min.length === 0) return null;
				df5min = addMovingAverage(df5min, 'close', params.MA_WINDOW_5 || 22, 'sma44');
				df5min = df5min.filter(r => r.close);
				
				// 75 Mins candles needs more data
				let earlierStart = new Date(startDate)
				earlierStart.setDate(earlierStart.getDate() - 5)
				
				let df15min = await getDataFromYahoo(sym, 5, '15m', earlierStart, endDate, useCached);
				df15min = processYahooData(df15min, '15m', useCached);

				if (!df15min || df15min.length === 0) return null;

				df15min = addMovingAverage(df15min, 'close', params.MA_WINDOW || 44, 'sma44');
				df15min = df15min.filter(r => r.close);

				conditionsMet = checkV3ConditionsNumerical(df5min, df15min, null, params)

				// let result = conditionsMet;
				result = conditionsMet.result;
				
				if (result) {
					const t2Candle = df15min[df15min.length - 1]
					t2Candle.time = getDateStringIND(t2Candle.time)
					const t3Candle = df15min[df15min.length - 2]
					t3Candle.time = getDateStringIND(t3Candle.time)
					
					return {
						sym,
						open: firstCandle.open,
						close: firstCandle.close,
						high: firstCandle.high,
						low: firstCandle.low,
						time: getDateStringIND(firstCandle.time),
						'sma44': maValue,
						volume: firstCandle.volume,
						direction: result,
						t15_0: t2Candle,
						t15_1: t3Candle,
						sma44_0: df[df.length - 1]?.sma44,
						sma44_1: df[df.length - 2]?.sma44,
						sma44_2: df[df.length - 3]?.sma44,
						sma44_3: df[df.length - 4]?.sma44,
						source: 'lgy',

						data: conditionsMet
					};
				}

				if (options.all_results) {
					const t2Candle = df15min[df15min.length - 1]
					t2Candle.time = getDateStringIND(t2Candle.time)
					const t3Candle = df15min[df15min.length - 2]
					t3Candle.time = getDateStringIND(t3Candle.time)
					
					return {
						sym,
						open: firstCandle.open,
						close: firstCandle.close,
						high: firstCandle.high,
						low: firstCandle.low,
						time: getDateStringIND(firstCandle.time),
						'sma44': maValue,
						volume: firstCandle.volume,
						direction: result,
						t15_0: t2Candle,
						t15_1: t3Candle,
						sma44_0: df[df.length - 1]?.sma44,
						sma44_1: df[df.length - 2]?.sma44,
						sma44_2: df[df.length - 3]?.sma44,
						sma44_3: df[df.length - 4]?.sma44,

						data: conditionsMet
					};
				}
			} catch (e) {
				console.log(e?.response?.data || e.message || e, sym);
				console.trace(e);
			}
			return null;
		});
		
		// Wait for all promises in the batch to resolve
		const batchResults = await Promise.all(batchPromises);
		selectedStocks.push(...batchResults.filter(result => result !== null));
	}

	return {
		selectedStocks,
		no_data_stocks,
		too_high_stocks,
		too_many_incomplete_candles_stocks
	};
}

function checkV2Conditions(df) {
	const currentCandle = df[df.length - 1]
	const t1Candle = df[df.length - 2]
	const t2Candle = df[df.length - 3]
	const t3Candle = df[df.length - 4]
	const t4Candle = df[df.length - 5]
	
	const candleMid = (currentCandle.high + currentCandle.low) / 2
	
	const touchingSma = (currentCandle.high * 1.005) > currentCandle.sma44 && (currentCandle.low * 0.995) < currentCandle.sma44
	
	if (!touchingSma) return
	
	if (!isNarrowRange(currentCandle, 0.0075)) return
	
	const t2Lower = currentCandle.high > t2Candle.high
	const t3Lower = currentCandle.high > t3Candle.high
	// const t4Lower = currentCandle.high > t4Candle.high
	const smaHigherT2 = t2Candle.sma44 > currentCandle.sma44
	const smaHigherT3 = t3Candle.sma44 > t2Candle.sma44
	const smaHigherT4 = t4Candle.sma44 > t3Candle.sma44
	
	const t2SmaHigherHigh = t2Candle.sma44 > t2Candle.high
	const t3SmaHigherHigh = t3Candle.sma44 > t3Candle.high
	const t4SmaHigherHigh = t4Candle.sma44 > t4Candle.high
	
	const closeLower = currentCandle.close < candleMid
	
	if (t2Lower && t3Lower && 
		closeLower &&
		smaHigherT2 && smaHigherT3 && smaHigherT4 &&
		t2SmaHigherHigh && t3SmaHigherHigh && t4SmaHigherHigh
	) 
	return 'BEARISH'
	
	const t2Higher = currentCandle.low < t2Candle.low
	const t3Higher = currentCandle.low < t3Candle.low
	// const t4Higher = currentCandle.low < t4Candle.low
	const smaLowerT2 = t2Candle.sma44 < currentCandle.sma44
	const smaLowerT3 = t3Candle.sma44 < t2Candle.sma44
	const smaLowerT4 = t4Candle.sma44 < t3Candle.sma44
	
	const t2SmaHigherLow = t2Candle.sma44 < t2Candle.low
	const t3SmaHigherLow = t3Candle.sma44 < t3Candle.low
	const t4SmaHigherLow = t4Candle.sma44 < t4Candle.low
	
	const closeHigher = currentCandle.close > candleMid
	
	if (t2Higher && t3Higher && 
		closeHigher &&
		smaLowerT2 && smaLowerT3 && smaLowerT4 &&
		t2SmaHigherLow && t3SmaHigherLow && t4SmaHigherLow
	) 
	return 'BULLISH'
}


// NO LONGER USED
function checkV3Conditions(df5min, df15min, df75min, params) {
	
	const { 
		CANDLE_CONDITIONS_SLOPE_TOLERANCE, 
		BASE_CONDITIONS_SLOPE_TOLERANCE, 
		TOUCHING_SMA_TOLERANCE, 
		NARROW_RANGE_TOLERANCE,
		TOUCHING_SMA_15_TOLERANCE,
		CHECK_75MIN,
		WIDE_RANGE_TOLERANCE
	} = params
	
	if (
		CANDLE_CONDITIONS_SLOPE_TOLERANCE === undefined || 
		BASE_CONDITIONS_SLOPE_TOLERANCE === undefined || 
		TOUCHING_SMA_TOLERANCE === undefined || 
		NARROW_RANGE_TOLERANCE === undefined ||
		WIDE_RANGE_TOLERANCE === undefined
	) {
		throw new Error('Params are not set')
	}
	
	// console.log(params)
	
	const processConditions = (df, candleDur) => {
		const current = df[df.length - 1];
		const t1 = df[df.length - 2];
		const t2 = df[df.length - 3];
		const t3 = df[df.length - 4];
		const t4 = df[df.length - 5];
		
		if (
			t1.sma44 / current.sma44 > CANDLE_CONDITIONS_SLOPE_TOLERANCE &&
			// t1.sma44 < t2.sma44 &&
			// t2.sma44 < t3.sma44 &&
			// (candleDur === 75 || t3.sma44 < t4.sma44) &&   // Only check for 15m and 5m
			t4.sma44 / t3.sma44 > CANDLE_CONDITIONS_SLOPE_TOLERANCE
		)
		return 'BEARISH'
		
		if (
			current.sma44 / t1.sma44 > CANDLE_CONDITIONS_SLOPE_TOLERANCE &&
			// t1.sma44 > t2.sma44 &&
			// t2.sma44 > t3.sma44 &&
			// (candleDur === 75 || t3.sma44 > t4.sma44) &&  // Only check for 15m and 5m
			t3.sma44 / t4.sma44 > CANDLE_CONDITIONS_SLOPE_TOLERANCE
		)
		return 'BULLISH'
		
		// No conditions met
		return null;
	};
	
	// Evaluate conditions for each timeframe
	const result5min = processConditions(df5min, 5);
	const result15min = processConditions(df15min, 15);
	const result75min = processConditions(df75min, 75);
	
	if (DEBUG) {
		console.log('result5min', 'result15min', 'result75min')
		console.log(result5min, result15min, result75min)
		console.log(df5min[df5min.length - 1].high, df5min[df5min.length - 1].low, df5min[df5min.length - 1].close, df5min[df5min.length - 1].sma44)
		console.log(df15min[df15min.length - 1].high, df15min[df15min.length - 1].low, df15min[df15min.length - 1].close, df15min[df15min.length - 1].sma44)
	}
	
	if (
		result5min != result15min || 
		(CHECK_75MIN && result15min != result75min) || 
		!result5min
	) {
		return null
	}
	
	
	const current = df5min[df5min.length - 1];
	const current15 = df15min[df15min.length - 1];
	// const t1 = df5min[df5min.length - 2];
	const t2 = df5min[df5min.length - 3];
	const t3 = df5min[df5min.length - 4];

	const candleMid = (current.high + current.low) / 2;
	
	const touchingSma = (current.high * (1 + TOUCHING_SMA_TOLERANCE)) >= current.sma44 && (current.low * (1 - TOUCHING_SMA_TOLERANCE)) <= current.sma44
	const touchingSma15 = (current15.high * (1 + TOUCHING_SMA_15_TOLERANCE)) >= current15.sma44 && (current15.low * (1 - TOUCHING_SMA_15_TOLERANCE)) <= current15.sma44
	
	const narrowRange = isNarrowRange(current, NARROW_RANGE_TOLERANCE)
	const wideRange = isWideRange(current, WIDE_RANGE_TOLERANCE)

	const baseConditionsMet = narrowRange 
								&& wideRange 
								&& touchingSma 
								&& touchingSma15
	
	const bearishConditionsMet = candleMid / current.close > BASE_CONDITIONS_SLOPE_TOLERANCE
	
	if (
		candleMid / current.close > BASE_CONDITIONS_SLOPE_TOLERANCE &&
		baseConditionsMet &&
		// t2.high < current.high &&
		// t3.high < current.high &&
		result5min === 'BEARISH'
	)
	return 'BEARISH'
	
	// console.debug(    current.close > candleMid ,
	//   isNarrowRange(current, 0.005) ,
	//   touchingSma ,
	//   result75min === 'BULLISH')
	
	if (DEBUG) {
		console.log('current.close / candleMid > BASE_CONDITIONS_SLOPE_TOLERANCE', 'narrowRange', 'touchingSma', 'touchingSma15', 'result75min', 'result5min', 'result15min', 't2.low / current.low > BASE_CONDITIONS_SLOPE_TOLERANCE', 't2.low / current.low > BASE_CONDITIONS_SLOPE_TOLERANCE')
		console.log(current.close / candleMid > BASE_CONDITIONS_SLOPE_TOLERANCE, narrowRange, touchingSma, touchingSma15, result75min, result5min, result15min, t2.low / current.low > BASE_CONDITIONS_SLOPE_TOLERANCE, t2.low / current.low > BASE_CONDITIONS_SLOPE_TOLERANCE)
	}
	
	if (
		current.close / candleMid > BASE_CONDITIONS_SLOPE_TOLERANCE &&
		baseConditionsMet &&
		// t2.low / current.low > BASE_CONDITIONS_SLOPE_TOLERANCE &&
		// t3.low / current.low > BASE_CONDITIONS_SLOPE_TOLERANCE &&
		result5min === 'BULLISH'
	)
	return 'BULLISH'
	
}

/**
 * 
 * @param {*} df5min 
 * @param {*} df15min 
 * @param {*} df75min 
 * @param {*} params 
 * 
 * 		d75 is nullable if it does not need to be checked
 * 
 * @returns {}
 */
function  checkV3ConditionsNumerical(df5min, df15min, df75min=null, params) {
	
	const { 
		CANDLE_CONDITIONS_SLOPE_TOLERANCE, 
		BASE_CONDITIONS_SLOPE_TOLERANCE, 
		TOUCHING_SMA_TOLERANCE, 
		NARROW_RANGE_TOLERANCE,
		TOUCHING_SMA_15_TOLERANCE,
		CHECK_75MIN,
		WIDE_RANGE_TOLERANCE
	} = params
	
	if (
		CANDLE_CONDITIONS_SLOPE_TOLERANCE === undefined || 
		BASE_CONDITIONS_SLOPE_TOLERANCE === undefined || 
		TOUCHING_SMA_TOLERANCE === undefined || 
		NARROW_RANGE_TOLERANCE === undefined ||
		WIDE_RANGE_TOLERANCE === undefined
	) {
		throw new Error('Params are not set')
	}
	
	const processConditionsNumerical = (df, candleDur) => {
		const current = df[df.length - 1];
		const t1 = df[df.length - 2];
		const t2 = df[df.length - 3];
		const t3 = df[df.length - 4];
		const t4 = df[df.length - 5];
		
		const bearishSlope1 = t1.sma44 / current.sma44;
		const bearishSlope2 = t4.sma44 / t3.sma44;
		const bullishSlope1 = current.sma44 / t1.sma44;
		const bullishSlope2 = t3.sma44 / t4.sma44;

		if (DEBUG) {
			console.log('CANDLE_CONDITIONS_SLOPE_TOLERANCE', CANDLE_CONDITIONS_SLOPE_TOLERANCE)
			console.log('bearishSlope1', bearishSlope1, 'bearishSlope2', bearishSlope2)
			console.log('bullishSlope1', bullishSlope1, 'bullishSlope2', bullishSlope2)
			console.log(candleDur, 'candleDur', bearishSlope1 > CANDLE_CONDITIONS_SLOPE_TOLERANCE && bearishSlope2 > CANDLE_CONDITIONS_SLOPE_TOLERANCE ? 'BEARISH' : 
				bullishSlope1 > CANDLE_CONDITIONS_SLOPE_TOLERANCE && bullishSlope2 > CANDLE_CONDITIONS_SLOPE_TOLERANCE ? 'BULLISH' : null)
		}
		
		return {
			bearishSlope1,
			bearishSlope2,
			bullishSlope1,
			bullishSlope2,

			bearishCondition: bearishSlope1 > CANDLE_CONDITIONS_SLOPE_TOLERANCE && 
							  	bearishSlope2 > CANDLE_CONDITIONS_SLOPE_TOLERANCE, // &&
							//   bearishSlope1 > bearishSlope2,
			bullishCondition: bullishSlope1 > CANDLE_CONDITIONS_SLOPE_TOLERANCE && 
							  	bullishSlope2 > CANDLE_CONDITIONS_SLOPE_TOLERANCE, // &&
							//   bullishSlope1 > bullishSlope2,

			direction: bearishSlope1 > CANDLE_CONDITIONS_SLOPE_TOLERANCE && bearishSlope2 > CANDLE_CONDITIONS_SLOPE_TOLERANCE ? 'BEARISH' : 
					  bullishSlope1 > CANDLE_CONDITIONS_SLOPE_TOLERANCE && bullishSlope2 > CANDLE_CONDITIONS_SLOPE_TOLERANCE ? 'BULLISH' : null
		};
	};
	
	// Evaluate conditions for each timeframe
	const result5min = processConditionsNumerical(df5min, 5);
	const result15min = processConditionsNumerical(df15min, 15);
	let result75min = null;
	if (df75min) {
		result75min = processConditionsNumerical(df75min, 75);
	}
	
	const current = df5min[df5min.length - 1];
	const current15 = df15min[df15min.length - 1];
	const t2 = df5min[df5min.length - 3];
	const t3 = df5min[df5min.length - 4];

	const candleMid = (current.high + current.low) / 2;
	
	// Calculate all numerical values
	const touchingSmaHigh = current.high * (1 + TOUCHING_SMA_TOLERANCE);
	const touchingSmaLow = current.low * (1 - TOUCHING_SMA_TOLERANCE);
	const touchingSma15High = current15.high * (1 + TOUCHING_SMA_15_TOLERANCE);
	const touchingSma15Low = current15.low * (1 - TOUCHING_SMA_15_TOLERANCE);
	
	const range = (current.high - current.low) / ((current.high + current.low) / 2);
	
	const candleMidToCloseRatio = candleMid / current.close;
	const closeToCandleMidRatio = current.close / candleMid;
	
	const t2LowToCurrentLowRatio = t2.low / current.low;
	const t3LowToCurrentLowRatio = t3.low / current.low;
	const t2HighToCurrentHighRatio = t2.high / current.high;
	const t3HighToCurrentHighRatio = t3.high / current.high;
	
	// Boolean conditions
	const touchingSma = touchingSmaHigh >= current.sma44 && touchingSmaLow <= current.sma44;
	const touchingSma15 = touchingSma15High >= current15.sma44 && touchingSma15Low <= current15.sma44;
	const narrowRange = range < NARROW_RANGE_TOLERANCE;
	const wideRange = range >= WIDE_RANGE_TOLERANCE;
	
	const baseConditionsMet = narrowRange && wideRange && touchingSma && touchingSma15;
	
	const directionsMatch = result5min.direction === result15min.direction && 
						   (!CHECK_75MIN || !result75min || result15min.direction === result75min.direction);
	
	const bearishConditionsMet = candleMidToCloseRatio > BASE_CONDITIONS_SLOPE_TOLERANCE;
	const bullishConditionsMet = closeToCandleMidRatio > BASE_CONDITIONS_SLOPE_TOLERANCE;

	const allDirectionsMatch = result5min.direction === result15min.direction && (!result75min || result15min.direction === result75min.direction);
	
	const finalBearish = allDirectionsMatch && 
							bearishConditionsMet && baseConditionsMet && result5min.direction === 'BEARISH';
	const finalBullish = allDirectionsMatch && 
							bullishConditionsMet && baseConditionsMet && result5min.direction === 'BULLISH';
	
	return {
		// Slope calculations
		slopes: {
			fiveMin: result5min,
			fifteenMin: result15min,
			seventyFiveMin: result75min
		},
		
		// Candle properties
		candle: {
			high: current.high,
			low: current.low,
			open: current.open,
			close: current.close,
			mid: candleMid,
			range: range,
			volume: current.volume
		},
		
		// SMA values
		sma: {
			current: current.sma44,
			current15: current15.sma44,
			t2: t2.sma44,
			t3: t3.sma44
		},
		
		// Tolerance values
		tolerances: {
			CANDLE_CONDITIONS_SLOPE_TOLERANCE,
			BASE_CONDITIONS_SLOPE_TOLERANCE,
			TOUCHING_SMA_TOLERANCE,
			NARROW_RANGE_TOLERANCE,
			TOUCHING_SMA_15_TOLERANCE,
			WIDE_RANGE_TOLERANCE
		},
		
		// Ratio calculations
		ratios: {
			candleMidToClose: candleMidToCloseRatio,
			closeToCandleMid: closeToCandleMidRatio,
			t2LowToCurrentLow: t2LowToCurrentLowRatio,
			t3LowToCurrentLow: t3LowToCurrentLowRatio,
			t2HighToCurrentHigh: t2HighToCurrentHighRatio,
			t3HighToCurrentHigh: t3HighToCurrentHighRatio
		},
		
		// SMA touching calculations
		smaTouching: {
			touchingSmaHigh,
			touchingSmaLow,
			touchingSma15High,
			touchingSma15Low,
			touchingSma,
			touchingSma15
		},
		
		// Range conditions
		rangeConditions: {
			range,
			narrowRange,
			wideRange
		},
		
		// Final conditions
		conditions: {
			baseConditionsMet,
			bearishConditionsMet,
			bullishConditionsMet,
			directionsMatch,
			finalBearish,
			finalBullish
		},
		
		// Final result
		result: finalBearish ? 'BEARISH' : finalBullish ? 'BULLISH' : null
	};
}

function isNarrowRange(candle, tolerance = 0.015) {
	const { high, low } = candle;
	const range = (high - low) / ((high + low) / 2);
	return range < tolerance;
}

function isWideRange(candle, tolerance = 0.015) {
	const { high, low } = candle;
	const range = (high - low) / ((high + low) / 2);
	return range >= tolerance;
}

function isBullishCandle(candle) {
	const { high, low, open, close } = candle;
	// const candleLength = high - ((high - low) * 0.3);
	const isBL1 = open > (high - ((high - low) * 0.35)) && close > (high - ((high - low) * 0.35));
	const isBL2 = close > open && open > ((high + low) / 2)
	const isBL3 = (Math.abs(close - open) > ((high - low) * 0.5)) && close > open
	
	return isBL1 ? 'BL1' : isBL2 ? 'BL2' : isBL3 ? 'BL3' : null;
}

function isBearishCandle(candle) {
	const { high, low, close, open } = candle;
	
	const isBR1 = open < (low + ((high - low) * 0.35)) && close < (low + ((high - low) * 0.35));
	const isBR2 = close < open && open < ((high + low) / 2)
	const isBR3 = (Math.abs(close - open) > ((high - low) * 0.5)) && close < open
	
	return isBR1 ? 'BR1' : isBR2 ? 'BR2' : isBR3 ? 'BR3' : null;
}



function isDojiCandle(candle) {
	const { high, low, open, close } = candle;
	const mid = (high + low) / 2;
	const range = (high - low) * 0.20;
	const lower = mid - range;
	const upper = mid + range;
	return (open > lower && open < upper) && (close > lower && close < upper);
}

function checkCandlePlacement(candle, maValue) { // Changed default tolerance to 1%
	const { high, low } = candle;
	
	const range = ((high + low) / 2) * 0.005;
	
	return maValue >= low - range && maValue <= high + range;
}

// function checkVolumeTrend(candle, maValue, direction, tolerance = 0.01) {
//   const { volume } = candle;
//   return volume >= maValue - (maValue * tolerance) && volume <= maValue + (maValue * tolerance);
// }

function printTrendEmojis(values) {
	const trends = [];
	for (let i = 1; i < values.length; i++) {
		if (values[i] > values[i-1]) {
			trends.push('🟢');
		} else if (values[i] < values[i-1]) {
			trends.push('🔴'); 
		} else {
			trends.push('🔵');
		}
	}
	return trends.join(' ');
}

function calculateBollingerBands(df, period = 20, stdDev = 2) {
	// Calculate SMA
	const sma = calculateMovingAverage(df.map(d => d.close), period);
	
	// Calculate Standard Deviation
	const bands = sma.map((ma, i) => {
		if (i < period - 1) return { upper: null, middle: null, lower: null };
		
		const slice = df.slice(i - period + 1, i + 1).map(d => d.close);
		const mean = ma;
		const squaredDiffs = slice.map(x => Math.pow(x - mean, 2));
		const variance = squaredDiffs.reduce((a, b) => a + b) / period;
		const standardDeviation = Math.sqrt(variance);
		
		return {
			upper: ma + (standardDeviation * stdDev),
			middle: ma,
			lower: ma - (standardDeviation * stdDev)
		};
	});
	
	return df.map((candle, i) => ({
		...candle,
		bb_upper: bands[i].upper,
		bb_middle: bands[i].middle,
		bb_lower: bands[i].lower
	}));
}

function calculateATR(df, period = 14) {
    let tr = [];
    for (let i = 0; i < df.length; i++) {
        if (i === 0) {
            tr.push(df[i].high - df[i].low);
            continue;
        }
        
        const trueHigh = Math.max(df[i].high, df[i-1].close);
        const trueLow = Math.min(df[i].low, df[i-1].close);
        tr.push(trueHigh - trueLow);
    }

    // Calculate ATR using Simple Moving Average of TR
    let atr = [];
    for (let i = 0; i < df.length; i++) {
        if (i < period - 1) {
            atr.push(null);
            continue;
        }
        
        const slice = tr.slice(i - period + 1, i + 1);
        const avg = slice.reduce((a, b) => a + b, 0) / period;
        atr.push(avg);
    }

    // Add ATR to dataframe
    return df.map((candle, i) => ({
        ...candle,
        atr: atr[i]
    }));
}

module.exports = { 
	analyzeDataForTrends,
	calculateMovingAverage,
	checkUpwardTrend,
	checkDownwardTrend,
	addMovingAverage,
	checkMARising,
	checkCandleConditions,
	checkMAFalling,
	checkReverseCandleConditions,

	scanZaireStocks,
	scanLightyearD2Stocks,

	isBullishCandle,
	isBearishCandle,
	isDojiCandle,
	checkCandlePlacement,
	countMATrendRising,
	countMATrendFalling,
	isNarrowRange,
	printTrendEmojis,
	getLastCandle,
	addRSI,
	calculateBollingerBands,
	getDateRange,
	removeIncompleteCandles,
	calculateATR,
	checkV3ConditionsNumerical,
	DEFAULT_PARAMS
};


// getDhanNIFTY50Data().then(async (stocks) => {
	//   const {selectedStocks} = await scanZaireStocks(stocks.map(s => s.Sym))
//   console.log(selectedStocks)
// })