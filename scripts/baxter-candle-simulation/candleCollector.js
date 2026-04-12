const { readSheetData, processSheetWithHeaders } = require('../../gsheets');
const { getGrowwChartData, processGrowwData } = require('../../kite/utils');
const { addMovingAverage } = require('../../analytics');

/**
 * NSE cash 9:15–15:30 IST as UTC range for a given IST calendar date (no DST).
 */
function sessionUtcBoundsForISTCalendarDate(y, m, d) {
	const pad = (n) => String(n).padStart(2, '0');
	return {
		startMs: +new Date(`${y}-${pad(m)}-${pad(d)}T03:45:00.000Z`),
		endMs: +new Date(`${y}-${pad(m)}-${pad(d)}T10:00:00.000Z`)
	};
}

const checkIfMarketClosed = (date) => {
	const day = date.getDate();
	const month = date.getMonth() + 1;
	const marketClosed = [];
	return marketClosed.find((m) => m.day === day && m.month === month);
};

/**
 * Parse 'YYYY-MM-DD' into local date parts (avoid timezone drift for day iteration).
 */
function parseIsoDateParts(iso) {
	const [ys, ms, ds] = iso.split('-');
	return { y: Number(ys), m: Number(ms), d: Number(ds) };
}

function* eachTradingDayBetween(startIso, endIso) {
	const start = parseIsoDateParts(startIso);
	const end = parseIsoDateParts(endIso);
	let cur = new Date(start.y, start.m - 1, start.d);
	const last = new Date(end.y, end.m - 1, end.d);
	while (cur <= last) {
		const dow = cur.getDay();
		if (dow !== 0 && dow !== 6 && !checkIfMarketClosed(cur)) {
			yield {
				y: cur.getFullYear(),
				m: cur.getMonth() + 1,
				d: cur.getDate(),
				date: new Date(cur)
			};
		}
		cur.setDate(cur.getDate() + 1);
	}
}

async function loadSymbolsFromSheet(stockListSheet) {
	let sheetData = await readSheetData(stockListSheet);
	sheetData = processSheetWithHeaders(sheetData);
	const bullish = (sheetData.map((row) => row.bullish).filter((s) => s?.length > 0)).map((s) =>
		String(s).trim().toUpperCase()
	);
	const bearish = (sheetData.map((row) => row.bearish).filter((s) => s?.length > 0)).map((s) =>
		String(s).trim().toUpperCase()
	);
	const both = (sheetData.map((row) => row.both).filter((s) => s?.length > 0)).map((s) =>
		String(s).trim().toUpperCase()
	);
	return [...new Set([...bullish, ...bearish, ...both])];
}

/**
 * Fetch 5m Groww series ending at session close, with enough prior history for SMA.
 */
async function fetchFiveMinuteSeriesWithSma(sym, y, m, d, config) {
	const { lookbackDays, maWindow, useCachedGroww } = config.input;
	const { endMs } = sessionUtcBoundsForISTCalendarDate(y, m, d);
	const fetchEnd = new Date(endMs);
	const fetchStart = new Date(fetchEnd);
	fetchStart.setUTCDate(fetchStart.getUTCDate() - lookbackDays);
	fetchStart.setUTCHours(0, 0, 0, 0);

	let raw;
	try {
		raw = await getGrowwChartData(sym, fetchStart, fetchEnd, 5, useCachedGroww);
	} catch (e) {
		return { error: e.message || String(e), df: null };
	}

	let df = processGrowwData(raw);
	if (!df || df.length === 0) {
		return { error: 'empty', df: null };
	}
	df = addMovingAverage(df, 'close', maWindow, 'sma');
	df = df.filter((r) => r.close != null);
	return { error: null, df };
}

function directionFromCandleSentiment(candle) {
	const mid = (candle.high + candle.low) / 2;
	if (Math.abs(candle.close - mid) < 1e-9) return null;
	return candle.close > mid ? 'BULLISH' : 'BEARISH';
}

/**
 * OLS slope of y vs index 0..n-1 (price change per candle step over the window).
 */
function linearRegressionSlope(ys) {
	const n = ys.length;
	if (n < 2) return '';
	const xs = Array.from({ length: n }, (_, j) => j);
	const meanX = (n - 1) / 2;
	const meanY = ys.reduce((a, b) => a + b, 0) / n;
	let num = 0;
	let den = 0;
	for (let j = 0; j < n; j++) {
		num += (xs[j] - meanX) * (ys[j] - meanY);
		den += (xs[j] - meanX) ** 2;
	}
	if (den === 0) return '';
	return Number((num / den).toFixed(8));
}

/**
 * Metrics over df[i - n + 1] .. df[i] inclusive (n candles ending at current bar).
 */
function computeLastNCandleMetrics(df, i, n) {
	const start = i - n + 1;
	if (start < 0 || n < 1) {
		return { slope_close_10: '', slope_sma_10: '', avg_volume_10: '' };
	}
	const window = df.slice(start, i + 1);
	if (window.length !== n) {
		return { slope_close_10: '', slope_sma_10: '', avg_volume_10: '' };
	}
	const closes = window.map((c) => c.close);
	const volumes = window.map((c) => (c.volume != null ? Number(c.volume) : 0));
	const smas = window.map((c) => c.sma);
	const slope = linearRegressionSlope(closes);
	const hasAllSma = smas.every((v) => v != null && !Number.isNaN(Number(v)));
	const slopeSma = hasAllSma ? linearRegressionSlope(smas.map(Number)) : '';
	const avgVol = volumes.reduce((a, b) => a + b, 0) / n;
	return {
		slope_close_10: slope === '' ? '' : slope,
		slope_sma_10: slopeSma === '' ? '' : slopeSma,
		avg_volume_10: Number(avgVol.toFixed(2))
	};
}

module.exports = {
	sessionUtcBoundsForISTCalendarDate,
	checkIfMarketClosed,
	parseIsoDateParts,
	eachTradingDayBetween,
	loadSymbolsFromSheet,
	fetchFiveMinuteSeriesWithSma,
	directionFromCandleSentiment,
	linearRegressionSlope,
	computeLastNCandleMetrics
};
