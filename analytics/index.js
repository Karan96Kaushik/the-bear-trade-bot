function analyzeDataForTrends(df, sym, tolerance = 0.01) {
  try {
    // Calculate moving averages
    df['44_day_ma'] = calculateMovingAverage(df['close'], 44);
    df['7_vol_ma'] = calculateMovingAverage(df['volume'], 7);

    const events = [];
    const i = df.length - 1;

    if (!isNaN(df[i]['44_day_ma'])) {
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

function checkUpwardTrend(df, i, tolerance) {
  return (
    df[i-1]['44_day_ma'] < df[i]['44_day_ma'] &&
    df[i-2]['44_day_ma'] < df[i-1]['44_day_ma'] &&
    df[i-3]['44_day_ma'] < df[i-2]['44_day_ma'] &&
    df[i-4]['44_day_ma'] < df[i-3]['44_day_ma'] &&
    (Math.abs(df[i]['44_day_ma'] - df[i]['low']) < (df[i]['44_day_ma'] * tolerance) ||
     (df[i]['44_day_ma'] > df[i]['low'] && df[i]['44_day_ma'] < df[i]['high'])) &&
    (df[i]['close'] > df[i]['open'] ||
     (df[i]['high'] - df[i]['close']) < (df[i]['close'] - df[i]['low']))
  );
}

function checkDownwardTrend(df, i, tolerance) {
  return (
    df[i-1]['44_day_ma'] > df[i]['44_day_ma'] &&
    df[i-2]['44_day_ma'] > df[i-1]['44_day_ma'] &&
    df[i-3]['44_day_ma'] > df[i-2]['44_day_ma'] &&
    df[i-4]['44_day_ma'] > df[i-3]['44_day_ma'] &&
    (Math.abs(df[i]['44_day_ma'] - df[i]['high']) < (df[i]['44_day_ma'] * tolerance) ||
     (df[i]['44_day_ma'] > df[i]['low'] && df[i]['44_day_ma'] < df[i]['high'])) &&
    (df[i]['close'] < df[i]['open'] ||
     (df[i]['high'] - df[i]['close']) > (df[i]['close'] - df[i]['low']))
  );
}

module.exports = { 
    analyzeDataForTrends,
    calculateMovingAverage,
    checkUpwardTrend,
    checkDownwardTrend
};
