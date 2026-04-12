/**
 * Baxter candle simulation: for each stock from Baxter-StockList, each trading day,
 * and each 5m candle in the session, run SimulatorV3 with Baxter-style prices
 * (no scanBaxterStocks filter). Output CSV with t0/t1/t2 OHLCV+SMA and simulation summary.
 *
 * Configure via scripts/baxter-candle-simulation/config.js or BAXTER_CANDLE_SIM_CONFIG.
 */

const path = require('path');
const { loadConfig } = require('./config');
const { appendRow, pickFields } = require('./csvExporter');
const { runSimulationForCandle } = require('./simulationRunner');
const {
	sessionUtcBoundsForISTCalendarDate,
	eachTradingDayBetween,
	loadSymbolsFromSheet,
	fetchFiveMinuteSeriesWithSma,
	directionFromCandleSentiment,
	computeLastNCandleMetrics
} = require('./candleCollector');

async function runWithConcurrency(items, limit, worker) {
	const results = [];
	let idx = 0;
	const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
		while (idx < items.length) {
			const i = idx++;
			results[i] = await worker(items[i], i);
		}
	});
	await Promise.all(runners);
	return results;
}

async function main() {
	const config = loadConfig();
	const csvPath = path.resolve(config.output.csvPath);
	const fields = config.output.fields;
	const skip = new Set((config.skipSymbols || []).map((s) => String(s).toUpperCase()));

	console.log('Baxter candle simulation');
	console.log('Date range:', config.input.startDate, '→', config.input.endDate);
	console.log('CSV:', csvPath);

	const symbols = await loadSymbolsFromSheet(config.input.stockListSheet);
	const symbolsFiltered = symbols.filter((s) => !skip.has(s));
	console.log('Symbols:', symbolsFiltered.length, skip.size ? `(skipped ${[...skip].join(',')})` : '');

	let totalRows = 0;
	let totalErrors = 0;

	for (const day of eachTradingDayBetween(config.input.startDate, config.input.endDate)) {
		const { y, m, d } = day;
		const { startMs, endMs } = sessionUtcBoundsForISTCalendarDate(y, m, d);
		const candleMs = config.input.candleIntervalMinutes * 60 * 1000;

		const tasks = [];
		for (const sym of symbolsFiltered) {
			tasks.push({ sym, y, m, d, startMs, endMs, candleMs });
		}

		const dayResults = await runWithConcurrency(tasks, config.run.concurrency, async (task) => {
			const { sym, y, m, d, startMs, endMs, candleMs } = task;
			try {
				const { df, error } = await fetchFiveMinuteSeriesWithSma(sym, y, m, d, config);
				if (error || !df) {
					console.warn(`[${sym} ${y}-${m}-${d}] fetch 5m failed:`, error || 'no df');
					return { sym, rows: 0, err: 1 };
				}

				let localRows = 0;
				let localErr = 0;

				const lookback = config.input.lookbackCandles ?? 10;
				const minIndex = Math.max(2, lookback - 1);

				for (let i = minIndex; i < df.length; i++) {
					const t0 = df[i];
					if (t0.time < startMs || t0.time > endMs) continue;

					const t1 = df[i - 1];
					const t2 = df[i - 2];
					const direction = directionFromCandleSentiment(t0);
					if (!direction) continue;

					const metrics = computeLastNCandleMetrics(df, i, lookback);
					const orderTime = new Date(t0.time + candleMs);

					try {
						const { ok, row } = await runSimulationForCandle({
							sym,
							t0,
							t1,
							t2,
							direction,
							orderTime,
							metrics,
							simulation: config.simulation,
							riskAmount: config.simulation.riskAmount,
							useCached: config.input.useCachedGroww
						});
						if (!ok) {
							localErr++;
						}
						appendRow(csvPath, fields, pickFields(row, fields));
						localRows++;
					} catch (e) {
						console.error(`[${sym}] sim error`, t0.time, e.message);
						localErr++;
					}
				}

				return { sym, rows: localRows, err: localErr };
			} catch (e) {
				console.error(`[${sym} ${y}-${m}-${d}]`, e.message || e);
				return { sym, rows: 0, err: 1 };
			}
		});

		for (const r of dayResults) {
			if (!r) continue;
			totalRows += r.rows;
			totalErrors += r.err;
		}
		console.log(`Day ${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}: rows=${dayResults.reduce((a, x) => a + (x?.rows || 0), 0)}`);
	}

	console.log('Done. Total CSV rows:', totalRows, 'errors:', totalErrors);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
