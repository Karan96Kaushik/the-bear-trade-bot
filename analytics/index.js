const { processYahooData, getDataFromYahoo, getDhanNIFTY50Data, getMcIndicators } = require("../kite/utils");
const { getDateStringIND } = require("../kite/utils");
const _ = require('lodash')

const MA_TREND_WINDOW = 10;
const DEBUG = process.env.DEBUG || false;
const MAX_STOCK_PRICE = 5000;

function analyzeDataForTrends(df, sym, tolerance = 0.01) {
  try {
    // Calculate moving averages
    df['sma44'] = calculateMovingAverage(df['close'], 44);
    df['7_vol_ma'] = calculateMovingAverage(df['volume'], 7);

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
  TOUCHING_SMA_TOLERANCE: 0.00045,
  NARROW_RANGE_TOLERANCE: 0.0046,
  CANDLE_CONDITIONS_SLOPE_TOLERANCE: 1,
  BASE_CONDITIONS_SLOPE_TOLERANCE: 1,
  MA_WINDOW: 44
}

async function scanZaireStocks(stockList, endDateNew, interval='15m', checkV2=false, checkV3=false, useCached=false, params=DEFAULT_PARAMS) {
    const selectedStocks = [];

    for (const sym of stockList) {
      try {
        const { startDate, endDate } = getDateRange(endDateNew);
        let df75min = [];

        let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);
        df = processYahooData(df);
        // console.log(df.slice(-3).map(d => ({...d, time: getDateStringIND(d.time)})))

        df = removeIncompleteCandles(df, useCached);
        // console.log(df.slice(-3).map(d => ({...d, time: getDateStringIND(d.time)})))

        if (DEBUG) {
          console.log('----')
        }

        if (!df || df.length === 0) {
          if (DEBUG) console.debug('No data')
          continue 
        };

        if (df[df.length - 1].high > MAX_STOCK_PRICE)  {
          if (DEBUG) console.debug('Too high')
          continue 
        };
        
        if (df.slice(-44).filter(r => !r.close).length > 4) {
          if (DEBUG) console.debug('Too many incomplete candles', sym)
          continue
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
          df5min = processYahooData(df5min);
          df5min = removeIncompleteCandles(df5min, useCached);
          if (!df5min || df5min.length === 0) continue;
          df5min = addMovingAverage(df5min, 'close', params.MA_WINDOW || 44, 'sma44');
          df5min = df5min.filter(r => r.close);

          // 75 Mins candles needs more data
          let earlierStart = new Date(startDate)
          earlierStart.setDate(earlierStart.getDate() - 10)

          let df15min = await getDataFromYahoo(sym, 5, '15m', earlierStart, endDate, useCached);
          df15min = processYahooData(df15min);
          df15min = removeIncompleteCandles(df15min, useCached);

          let df15min_copy = [...df15min]

          if (!df15min || df15min.length === 0) continue;
          df15min = addMovingAverage(df15min, 'close', params.MA_WINDOW || 44, 'sma44');
          df15min = df15min.filter(r => r.close);

          let startIndex = 0;
          for (let i = 0; i < df15min_copy.length; i++) {
            const ts = new Date(df15min_copy[i].time);
            if (['3:45','5:0','6:15','7:30','8:45'].includes(ts.getHours() + ':' + ts.getMinutes())) {
              startIndex = i;
              break;
            }
          }

          for (let i = startIndex; i < df15min_copy.length; i += 5) {
            if (i + 4 >= df15min_copy.length) break;

            const fiveCandles = df15min_copy.slice(i, i + 5);
            
            // const ts = new Date(fiveCandles[0].time)
            // console.debug(ts.getHours() + ':' + ts.getMinutes(), ['3:45','5:0','6:15','7:30','8:45'].includes(ts.getHours() + ':' + ts.getMinutes()) ? '✅' : '❌')
            // if (!['3:45','5:0','6:15','7:30','8:45'].includes(ts.getHours() + ':' + ts.getMinutes())) continue

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

          conditionsMet = checkV3Conditions(df5min, df15min, df75min, params)
        }
        else if (checkV2) {
          conditionsMet = checkV2Conditions(df)
        } else {
          conditionsMet = checkUpwardTrend(df, df.length - 1) ? 'BULLISH' : checkDownwardTrend(df, df.length - 1) ? 'BEARISH' : null;
        }

        if (conditionsMet) {
          const t2Candle = df75min[df75min.length - 1]
          t2Candle.time = getDateStringIND(t2Candle.time)
          const t3Candle = df75min[df75min.length - 2]
          t3Candle.time = getDateStringIND(t3Candle.time)

          selectedStocks.push({
              sym,
              open: firstCandle.open,
              close: firstCandle.close,
              high: firstCandle.high,
              low: firstCandle.low,
              time: getDateStringIND(firstCandle.time),
              'sma44': maValue,
              volume: firstCandle.volume,
              direction: conditionsMet,
              t75_0: t2Candle,
              t75_1: t3Candle,
              sma44_0: df[df.length - 1]?.sma44,
              sma44_1: df[df.length - 2]?.sma44,
              sma44_2: df[df.length - 3]?.sma44,
              sma44_3: df[df.length - 4]?.sma44,
              // t2Candle,
              // t3Candle,
          });

        }
      } catch (e) {
        console.log(e?.response?.data || e.message || e, sym);
        console.trace(e);
      }
    }

    return selectedStocks;
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

function checkV3Conditions(df5min, df15min, df75min, params) {

  const { 
    CANDLE_CONDITIONS_SLOPE_TOLERANCE, 
    BASE_CONDITIONS_SLOPE_TOLERANCE, 
    TOUCHING_SMA_TOLERANCE, 
    NARROW_RANGE_TOLERANCE,
    TOUCHING_SMA_15_TOLERANCE,
    CHECK_75MIN
  } = params

  if (CANDLE_CONDITIONS_SLOPE_TOLERANCE === undefined || BASE_CONDITIONS_SLOPE_TOLERANCE === undefined || TOUCHING_SMA_TOLERANCE === undefined || NARROW_RANGE_TOLERANCE === undefined) {
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
      // t1.sma44 < t2.sma44 //&&
      // t2.sma44 < t3.sma44 //&&
      // (candleDur === 75 || t3.sma44 < t4.sma44)   // Only check for 15m and 5m
      t4.sma44 / t3.sma44 > CANDLE_CONDITIONS_SLOPE_TOLERANCE
    )
      return 'BEARISH'

    if (
      current.sma44 / t1.sma44 > CANDLE_CONDITIONS_SLOPE_TOLERANCE &&
      // t1.sma44 > t2.sma44 &&
      // t2.sma44 > t3.sma44 //&&
      // (candleDur === 75 || t3.sma44 > t4.sma44)   // Only check for 15m and 5m
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

  if (
    candleMid / current.close > BASE_CONDITIONS_SLOPE_TOLERANCE &&
    narrowRange &&
    touchingSma &&
    touchingSma15 &&
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
    console.log('current.close > candleMid', 'isNarrowRange(current, 0.005)', 'touchingSma', 'result75min', 'result5min', 'result15min', 't2.low > current.low', 't3.low > current.low')
    console.log(current.close > candleMid, isNarrowRange(current, 0.005), touchingSma, result75min, result5min, result15min, t2.low > current.low, t3.low > current.low)
  }
  
  if (
    current.close / candleMid > BASE_CONDITIONS_SLOPE_TOLERANCE &&
    narrowRange &&
    touchingSma &&
    touchingSma15 &&
    t2.low / current.low > BASE_CONDITIONS_SLOPE_TOLERANCE &&
    t3.low / current.low > BASE_CONDITIONS_SLOPE_TOLERANCE &&
    result5min === 'BULLISH'
  )
    return 'BULLISH'

}

function isNarrowRange(candle, tolerance = 0.015) {
  const { high, low } = candle;
  const range = (high - low) / ((high + low) / 2);
  return range < tolerance;
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

async function scanBaileyStocks(stockList, endDateNew, interval = '5m') {
  let endDate = new Date();
  endDate.setUTCSeconds(10);

  if (endDateNew) {
    endDate = new Date(endDateNew);
  }

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);

  const promises = stockList.map(async (sym) => {
    try {
      let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate);
      df = processYahooData(df);

      if (!df || df.length === 0) {
        console.log('No data for', sym);
        return null;
      }

      df.pop();
      if (new Date(df[df.length - 2].time).getDate() === new Date().getDate()) {
        df.pop();
      }

      if (!df || df.length === 0 || df[df.length - 1].high > MAX_STOCK_PRICE) {
        return null;
      }

      const indicators = await getMcIndicators(sym);
      const classic = indicators.pivotLevels.find(p => p.key == 'Classic').pivotLevel;
      const currentCandle = df[df.length - 1];
      const { s3, r3 } = classic;
      const candleMid = (currentCandle.high + currentCandle.low) / 2;

      let direction = null;
      if (currentCandle.high > r3 && currentCandle.low < r3 && currentCandle.close < candleMid) {
        direction = 'BEARISH';
      }
      if (currentCandle.high > s3 && currentCandle.low < s3 && currentCandle.close > candleMid) {
        direction = 'BULLISH';
      }

      return direction ? {
        sym,
        open: currentCandle.open,
        close: currentCandle.close,
        high: currentCandle.high,
        low: currentCandle.low,
        time: getDateStringIND(currentCandle.time),
        direction,
      } : null;
    } catch (error) {
      console.error(`Error processing ${sym}:`, error);
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter(result => result !== null);
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
    scanBaileyStocks,
    getDateRange
};


// getDhanNIFTY50Data().then(async (stocks) => {
//   const selectedStocks = await scanZaireStocks(stocks.map(s => s.Sym))
//   console.log(selectedStocks)
// })