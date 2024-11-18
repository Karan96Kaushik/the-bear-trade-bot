const { processYahooData, getDataFromYahoo, getDhanNIFTY50Data } = require("../kite/utils");

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

function checkUpwardTrend(df, i, tolerance = 0.002) {

  if (DEBUG) {
    console.log('candlePlacement', checkCandlePlacement(df[i], df[i]['sma44'], 'BULLISH', tolerance))
    console.log('isBullishCandle', isBullishCandle(df[i]))
    console.log('isDojiCandle', isDojiCandle(df[i]))
  }

  const currentCandle = df[i];
  return (
    checkCandlePlacement(currentCandle, currentCandle['sma44'], 'BULLISH', tolerance) &&
    (isBullishCandle(currentCandle) || isDojiCandle(currentCandle))
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

function checkDownwardTrend(df, i, tolerance = 0.002) {

  if (DEBUG) {
    console.log('candlePlacement', checkCandlePlacement(df[i], df[i]['sma44'], 'BEARISH', tolerance))
    console.log('isBearishCandle', isBearishCandle(df[i]))
    console.log('isDojiCandle', isDojiCandle(df[i]))
  }

  const currentCandle = df[i];
  return (
    checkCandlePlacement(currentCandle, currentCandle['sma44'], 'BEARISH', tolerance) &&
    (isBearishCandle(currentCandle) || isDojiCandle(currentCandle))
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

function countMATrendRising(maValues) {
  const _maValues = maValues.reverse()
  for (let i = 0; i < _maValues.length - 1; i++) {
    // console.log(_maValues[i], _maValues[i+1])
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
    const _maValues = maValues.reverse()
    for (let i = 0; i < _maValues.length - 1; i++) {
      // console.log(_maValues[i], _maValues[i+1])
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

async function scanZaireStocks(stockList, endDateNew, interval = '15m') {
    const selectedStocks = [];

    for (const sym of stockList) {
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

        if (!df || df.length === 0) continue;

        if (df[df.length - 1].high > MAX_STOCK_PRICE) continue;
        
        df = addMovingAverage(df, 'close', 44, 'sma44');
        df = df.filter(r => r.close);

        const isRising = checkMARising(df, MA_TREND_WINDOW) ? 'BULLISH' : checkMAFalling(df, MA_TREND_WINDOW) ? 'BEARISH' : null;
        if (DEBUG) {
          console.log(sym, isRising)
        }
        if (!isRising) continue;

        const firstCandle = df[df.length - 1];
        const maValue = firstCandle['sma44'];

        const conditionsMet = isRising == 'BULLISH'
            ? checkUpwardTrend(df, df.length - 1)
            : checkDownwardTrend(df, df.length - 1);

        if (conditionsMet) {
            selectedStocks.push({
                sym,
                open: firstCandle.open,
                close: firstCandle.close,
                high: firstCandle.high,
                low: firstCandle.low,
                'sma44': maValue,
                volume: firstCandle.volume,
                direction: isRising
            });
        }
      } catch (e) {
        console.error(e?.response?.data || e.message || e, sym);
      }
    }

    return selectedStocks;
}

function isBullishCandle(candle) {
  const { high, low, open, close } = candle;
  const avgPrice = (high + low) / 2;
  // Either both open and close are above average, or just close is above average
  return (open > avgPrice && close > avgPrice) || close > avgPrice;
}

function isBearishCandle(candle) {
  const { high, low, close } = candle;
  const avgPrice = (high + low) / 2;
  return close < avgPrice;
}

function isDojiCandle(candle) {
  const { high, low, open, close } = candle;
  // Check if the difference between open and close is less than 0.25% of the candle range
  const candleRange = high - low;
  const bodyRange = Math.abs(open - close);
  return bodyRange < (0.0025 * candleRange);
}

function checkCandlePlacement(candle, maValue, direction, tolerance = 0.01) { // Changed default tolerance to 1%
  const { high, low } = candle;
  if (DEBUG) {
    console.log(direction, maValue, high, low, maValue >= (high * 1.01), maValue >= low)
  }
  
  if (direction === 'BULLISH') {
    return maValue <= high && maValue >= (low * 0.995);
  } else if (direction === 'BEARISH') {
    return maValue <= (high * 1.005) && maValue >= low;
  }
  
  return false;
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
    countMATrendFalling
};


// getDhanNIFTY50Data().then(async (stocks) => {
//   const selectedStocks = await scanZaireStocks(stocks.map(s => s.Sym))
//   console.log(selectedStocks)
// })