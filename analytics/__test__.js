const { scanZaireStocks } = require('./index');
const { readSheetData } = require('../gsheets');
const { getDataFromYahoo, processYahooData } = require('../kite/utils');
const { countMATrendRising, countMATrendFalling, checkMARising, checkMAFalling, addMovingAverage, checkUpwardTrend, checkDownwardTrend, isBullishCandle, isNarrowRange, isBearishCandle } = require('./index');

const DEBUG = true  
const MAX_STOCK_PRICE = 5000
const MA_TREND_WINDOW = 10


const testScanZaireStocks = async () => {
    let stocks = await readSheetData('HIGHBETA!B2:B150');
    stocks = stocks.map(s => s[0])

    stocks = ['BLUESTARCO']

    // console.log(selectedStocks)
    const selectedStocks = []

    const endDateNew = new Date('2024-11-19T04:01:10Z');
    const interval = '15m'
    for (const sym of stocks) {
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
  
          const direction = checkMARising(df, MA_TREND_WINDOW) ? 'BULLISH' : checkMAFalling(df, MA_TREND_WINDOW) ? 'BEARISH' : null;

          if (DEBUG) {
            console.log(sym, direction)
            console.log('trends', checkUpwardTrend(df, df.length - 1), checkDownwardTrend(df, df.length - 1))
            console.log('count', countMATrendRising(df.map(r => r['sma44'])), countMATrendFalling(df.map(r => r['sma44'])))
          }
          if (!direction) continue;
  
          const firstCandle = df[df.length - 1];
          const maValue = firstCandle['sma44'];
  
          const conditionsMet = direction == 'BULLISH'
              ? checkUpwardTrend(df, df.length - 1)
              : checkDownwardTrend(df, df.length - 1);

          if (DEBUG) {
            console.log('----')
            console.log('conditionsMet', conditionsMet, direction)
          }
  
          if (conditionsMet) {
              selectedStocks.push({
                  sym,
                  open: firstCandle.open,
                  close: firstCandle.close,
                  high: firstCandle.high,
                  low: firstCandle.low,
                  'sma44': maValue,
                  volume: firstCandle.volume,
                  direction: direction
              });
          }
        } catch (e) {
          console.error(e?.response?.data || e.message || e, sym);
        }
      }

}

testScanZaireStocks();