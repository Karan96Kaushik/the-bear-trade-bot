const { 
    processYahooData, getDataFromYahoo, getMcIndicators, getDateStringIND,
    memoize
} = require("../kite/utils");
const { readSheetData, processSheetWithHeaders } = require("../gsheets");

const MAX_STOCK_PRICE = 5000;

let pivotSheetData = null;

const getPivotLevelsFromSheet = async (sym, date) => {
    if (!pivotSheetData) {
        pivotSheetData = await readSheetDataCached('Pivot-Data!A:Z')
        pivotSheetData = processSheetWithHeaders(pivotSheetData)
    }
    return pivotSheetData
                .find(p => p.timestamp == date && p.symbol == sym)
}

const readSheetDataCached = memoize((...args) => readSheetData(...args))

async function scanBaileyStocks(stockList, endDateNew, interval = '5m', useCached=false) {
	let endDate = new Date();
	endDate.setUTCSeconds(10);
	
	if (endDateNew) {
		endDate = new Date(endDateNew);
	}
	
	const startDate = new Date(endDate);
	startDate.setDate(startDate.getDate() - 6);
	
	const promises = stockList.map(async (sym) => {
		try {
			let df = await getDataFromYahoo(sym, 5, interval, startDate, endDate, useCached);
			df = processYahooData(df, interval, useCached);
			
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

            const currentCandle = df[df.length - 1];

			let support, resistance;
			
			if (!useCached) {
				const indicators = await getMcIndicators(sym);
				const classic = indicators.pivotLevels.find(p => p.key == 'Classic').pivotLevel;
				const { s3, r3 } = classic;
				support = s3;
				resistance = r3;
			}
			else {
                let dateStr = endDateNew.toISOString().split('T')[0];
                const pivotLevels = await getPivotLevelsFromSheet(sym, dateStr);
				if (!pivotLevels) {
					console.log('No pivot levels for', sym, dateStr)
					return null;
				}
				support = pivotLevels.classic_s3;
				resistance = pivotLevels.classic_r3;
			}

			const candleMid = (currentCandle.high + currentCandle.low) / 2;
			
			let direction = null;
			if (currentCandle.high > resistance && currentCandle.low < resistance && currentCandle.close < candleMid) {
				direction = 'BEARISH';
			}
			if (currentCandle.high > support && currentCandle.low < support && currentCandle.close > candleMid) {
				direction = 'BULLISH';
			}
			
			return direction ? {
				sym,
				support,
				resistance,
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
	scanBaileyStocks
}