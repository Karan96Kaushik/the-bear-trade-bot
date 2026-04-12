const path = require('path');

/**
 * Default configuration for Baxter candle simulation.
 * Edit this file or override via BAXTER_CANDLE_SIM_CONFIG (path to a .js module exporting a partial config).
 */
const defaultConfig = {
	input: {
		stockListSheet: 'Baxter-StockList',
		startDate: '2026-04-06',
		endDate: '2026-04-10',
		candleIntervalMinutes: 5,
		/** IST session (NSE cash) */
		marketStartHourIST: 9,
		marketStartMinuteIST: 15,
		marketEndHourIST: 15,
		marketEndMinuteIST: 30,
		maWindow: 200,
		/** Calendar days of 5m history to fetch before each session (for SMA warmup) */
		lookbackDays: 5,
		/** Candles ending at t0 (inclusive) used for slope_close_10 / avg_volume_10; column names stay *_10 even if you change this */
		lookbackCandles: 10,
		useCachedGroww: true
	},
	simulation: {
		targetStopLossRatio: '5:1',
		cancelInMins: 5,
		updateSL: true,
		updateSLInterval: 15,
		updateSLFrequency: 5,
		marketOrder: false,
		enableTriggerDoubleConfirmation: false,
		enableStopLossDoubleConfirmation: false,
		doubleConfirmationLookbackHours: 2,
		riskAmount: 200
	},
	/** Symbols to skip entirely (e.g. known bad data) */
	skipSymbols: ['IRB'],
	run: {
		/** Max concurrent Groww/simulation operations */
		concurrency: 2
	},
	output: {
		csvPath: path.join(__dirname, '..', '..', 'logs', 'baxter_candle_simulation.csv'),
		fields: [
			'timestamp',
			'symbol',
			'direction',
			't0_open',
			't0_high',
			't0_low',
			't0_close',
			't0_volume',
			't0_sma',
			't1_open',
			't1_high',
			't1_low',
			't1_close',
			't1_volume',
			't1_sma',
			't2_open',
			't2_high',
			't2_low',
			't2_close',
			't2_volume',
			't2_sma',
			'slope_close_10',
			'slope_sma_10',
			'avg_volume_10',
			'triggerPrice',
			'stopLossPrice',
			'targetPrice',
			'quantity',
			'triggerPadding',
			'orderTime',
			'pnl',
			'exitTime',
			'exitReason',
			'simulationDurationMins',
			'started'
		]
	}
};

function deepMerge(base, override) {
	if (!override || typeof override !== 'object') return base;
	const out = Array.isArray(base) ? [...base] : { ...base };
	for (const k of Object.keys(override)) {
		if (
			override[k] &&
			typeof override[k] === 'object' &&
			!Array.isArray(override[k]) &&
			typeof base[k] === 'object' &&
			base[k] !== null &&
			!Array.isArray(base[k])
		) {
			out[k] = deepMerge(base[k], override[k]);
		} else {
			out[k] = override[k];
		}
	}
	return out;
}

function loadConfig() {
	let merged = { ...defaultConfig };
	const envPath = process.env.BAXTER_CANDLE_SIM_CONFIG;
	if (envPath) {
		const abs = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
		const extra = require(abs);
		merged = deepMerge(merged, extra.default || extra);
	}
	return merged;
}

module.exports = {
	defaultConfig,
	loadConfig,
	deepMerge
};
