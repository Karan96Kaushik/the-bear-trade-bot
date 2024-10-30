const { processYahooData, getDataFromYahoo, getDhanNIFTY50Data } = require("../kite/utils");

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
        return "UP"
      }
      // Check for downward trend
      else if (checkDownwardTrend(df, i, tolerance)) {
        events.push(df[i-2], df[i-1], df[i]);
        return "DOWN"
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

function checkUpwardTrend(df, i, tolerance, doji_tolerance = 0.001) {
  // Check that we have enough data points
  if (i < 20) return false;
  
  // Check 20 consecutive increases in SMA44
  for (let j = 0; j < 19; j++) {
    if (df[i-j-1]['sma44'] >= df[i-j]['sma44']) {
      return false;
    }
  }

  return (
    (Math.abs(df[i]['sma44'] - df[i]['low']) < (df[i]['sma44'] * tolerance) ||
     (df[i]['sma44'] > df[i]['low'] && df[i]['sma44'] < df[i]['high'])) &&

    // Bullish Candle or Doji
    (df[i]['close'] > df[i]['open'] ||
     (df[i]['high'] - df[i]['close']) < (df[i]['close'] - df[i]['low']) ||
     Math.abs(df[i]['close'] - ((df[i]['high'] + df[i]['low']) / 2)) < ((df[i]['high'] + df[i]['low']) / 2) * doji_tolerance) // Doji condition
  );
}

function checkDownwardTrend(df, i, tolerance, doji_tolerance = 0.001) {
  // Check that we have enough data points
  if (i < 20) return false;
  
  // Check 20 consecutive decreases in SMA44
  for (let j = 0; j < 19; j++) {
    if (df[i-j-1]['sma44'] <= df[i-j]['sma44']) {
      return false;
    }
  }

  return (
    (Math.abs(df[i]['sma44'] - df[i]['high']) < (df[i]['sma44'] * tolerance) ||
     (df[i]['sma44'] > df[i]['low'] && df[i]['sma44'] < df[i]['high'])) &&

    // Bearish Candle or Doji
    (df[i]['close'] < df[i]['open'] ||
     (df[i]['high'] - df[i]['close']) > (df[i]['close'] - df[i]['low']) ||
     Math.abs(df[i]['close'] - ((df[i]['high'] + df[i]['low']) / 2)) < ((df[i]['high'] + df[i]['low']) / 2) * doji_tolerance) // Doji condition
  );
}

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

function checkMARising(df, window = 5) {
    const maValues = df.slice(-window).map(row => row['sma44']);
    // console.log(maValues.map((value, index) => index === 0 || maValues[index - 1] < value));
    return maValues.every((value, index) => index === 0 || maValues[index - 1] < value);
}

function checkCandleConditions(row, maValue, tolerance = 0.01) {
    const { open, close, high, low } = row;

    const condition1 = close > open && Math.abs(close - open) / open < 0.05;
    const condition2 = close > (high + low) / 2;
    const condition3 = (Math.abs(maValue - low) < (maValue * tolerance)) || (maValue > low && maValue < high);
    return (condition1 || condition2) && condition3;
}

function checkMAFalling(df, window = 5) {
    const maValues = df.slice(-window).map(row => row['sma44']);
    return maValues.every((value, index) => index === 0 || maValues[index - 1] > value);
}

function checkReverseCandleConditions(row, maValue, tolerance = 0.01) {
    const { open, close, high, low } = row;

    const condition1 = close < open && Math.abs(close - open) / open < 0.05;
    const condition2 = close < (high + low) / 2;
    const condition3 = (Math.abs(maValue - high) < (maValue * tolerance)) || (maValue < high && maValue > low);
    console.log(condition1, condition2, condition3)
    return (condition1 || condition2) && condition3;
}

async function scanZaireStocks(stockList) {
    const selectedStocks = [];

    for (const sym of stockList) {
      try {

        const endDate = new Date();
        // endDate.setUTCDate(endDate.getUTCDate() - 1);
        // endDate.setUTCHours(4);
        endDate.setUTCSeconds(10);

        // console.log(endDate)

        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 5);

        let df = await getDataFromYahoo(sym, 5, '15m', startDate, endDate);
        df = processYahooData(df);

        // console.log(df.map(r => ({...r, time: new Date(r.time)}))[df.length - 1])
        // console.log(df.map(r => ({...r, time: new Date(r.time)}))[df.length - 2])
        // console.log(df.map(r => ({...r, time: new Date(r.time)}))[df.length - 3])

        /*
          Remove incomplete candles
        */
        df.pop()
        // Confirm that the final candle will be for today only and then remve the additional incomplete one
        if (new Date(df[df.length - 2].time).getDate() === new Date().getDate()) {
            df.pop()
        }

        if (!df || df.length === 0) continue;
        
        df = addMovingAverage(df, 'close', 44, 'sma44');
        df = df.filter(r => r.close);

        const isRising = checkMARising(df) ? "UP" : checkMAFalling(df) ? "DOWN" : null;
        if (!isRising) continue;

        const firstCandle = df[df.length - 1];
        const maValue = firstCandle['sma44'];

        const conditionsMet = isRising 
            ? checkCandleConditions(firstCandle, maValue)
            : checkReverseCandleConditions(firstCandle, maValue);

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
        console.error(e?.response?.data, sym);
      }
    }

    return selectedStocks;
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
    scanZaireStocks
};


// getDhanNIFTY50Data().then(async (stocks) => {
//   const selectedStocks = await scanZaireStocks(stocks.map(s => s.Sym))
//   console.log(selectedStocks)
// })