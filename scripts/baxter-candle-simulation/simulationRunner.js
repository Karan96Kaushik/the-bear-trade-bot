const { Simulator } = require('../../simulator/SimulatorV3');
const { getGrowwChartData, processGrowwData, getDateStringIND } = require('../../kite/utils');
const { getDateRange } = require('../../analytics');

function getTriggerPadding(high) {
	let triggerPadding = 1;
	if (high < 20) triggerPadding = 0.1;
	else if (high < 50) triggerPadding = 0.2;
	else if (high < 100) triggerPadding = 0.3;
	else if (high < 300) triggerPadding = 0.5;
	return triggerPadding;
}

/**
 * Same price construction as simulateBaxter (express-server/controllers/simulateBaxter.js).
 */
function computeTriggerTargetSl(direction, high, low, triggerPadding) {
	let triggerPrice;
	let stopLossPrice;
	let targetPrice;
	if (direction === 'BULLISH') {
		triggerPrice = high + triggerPadding;
		stopLossPrice = low - triggerPadding;
		targetPrice = high + (high - low) * 5 + triggerPadding;
	} else {
		triggerPrice = low - triggerPadding;
		stopLossPrice = high + triggerPadding;
		targetPrice = low - (high - low) * 5 - triggerPadding;
	}
	triggerPrice = Math.round(triggerPrice * 10) / 10;
	stopLossPrice = Math.round(stopLossPrice * 10) / 10;
	return { triggerPrice, stopLossPrice, targetPrice };
}

function candleToPrefix(c, prefix) {
	const vol = c.volume != null ? c.volume : '';
	const sma = c.sma != null ? c.sma : '';
	return {
		[`${prefix}_open`]: c.open,
		[`${prefix}_high`]: c.high,
		[`${prefix}_low`]: c.low,
		[`${prefix}_close`]: c.close,
		[`${prefix}_volume`]: vol,
		[`${prefix}_sma`]: sma
	};
}

function simulationDurationMins(startedAt, exitTime) {
	if (startedAt == null || exitTime == null) return '';
	return Math.round((exitTime - startedAt) / 60000);
}

/**
 * @param {object} params
 * @param {string} params.sym
 * @param {object} params.t0
 * @param {object} params.t1
 * @param {object} params.t2
 * @param {string} params.direction - BULLISH | BEARISH
 * @param {Date} params.orderTime - when the trigger is active (after t0 closes)
 * @param {object} params.simulation - Simulator options (minus data)
 * @param {number} params.riskAmount
 * @param {boolean} params.useCached
 * @param {Record<string, unknown>} [params.metrics] - e.g. slope_close_10, slope_sma_10, avg_volume_10
 */
async function runSimulationForCandle(params) {
	const { sym, t0, t1, t2, direction, orderTime, simulation, riskAmount, useCached, metrics = {} } =
		params;

	const triggerPadding = getTriggerPadding(t0.high);
	const { triggerPrice, stopLossPrice, targetPrice } = computeTriggerTargetSl(
		direction,
		t0.high,
		t0.low,
		triggerPadding
	);

	let quantity = Math.ceil(riskAmount / Math.abs(triggerPrice - stopLossPrice));
	quantity = Math.abs(quantity);

	const { endDate } = getDateRange(orderTime);
	endDate.setUTCHours(11, 0, 0, 0);
	const startDate = new Date(endDate);
	startDate.setUTCHours(3, 0, 0, 0);

	let yahooData = await getGrowwChartData(sym, startDate, endDate, 1, useCached);
	yahooData = processGrowwData(yahooData);
	if (!yahooData || yahooData.length === 0) {
		return {
			ok: false,
			error: 'no_intraday_data',
			row: {
				...metrics,
				...candleToPrefix(t0, 't0'),
				...candleToPrefix(t1, 't1'),
				...candleToPrefix(t2, 't2'),
				timestamp: getDateStringIND(t0.time),
				symbol: sym,
				direction,
				triggerPrice,
				stopLossPrice,
				targetPrice,
				quantity,
				triggerPadding,
				orderTime: orderTime.toISOString(),
				pnl: '',
				exitTime: '',
				exitReason: 'no_data',
				simulationDurationMins: '',
				started: false
			}
		};
	}

	const sim = new Simulator({
		stockSymbol: sym,
		triggerPrice,
		targetPrice,
		stopLossPrice,
		quantity,
		direction,
		yahooData,
		orderTime,
		cancelInMins: simulation.cancelInMins,
		updateSL: simulation.updateSL,
		updateSLInterval: simulation.updateSLInterval,
		updateSLFrequency: simulation.updateSLFrequency,
		enableTriggerDoubleConfirmation: simulation.enableTriggerDoubleConfirmation,
		enableStopLossDoubleConfirmation: simulation.enableStopLossDoubleConfirmation,
		doubleConfirmationLookbackHours: simulation.doubleConfirmationLookbackHours,
		reEnterPosition: simulation.reEnterPosition,
		placeAverageMarketPrice: simulation.placeAverageMarketPrice
	});

	await sim.run();

	const started = !!sim.startedAt;
	const row = {
		...metrics,
		...candleToPrefix(t0, 't0'),
		...candleToPrefix(t1, 't1'),
		...candleToPrefix(t2, 't2'),
		timestamp: getDateStringIND(t0.time),
		symbol: sym,
		direction,
		triggerPrice,
		stopLossPrice,
		targetPrice,
		quantity,
		triggerPadding,
		orderTime: orderTime.toISOString(),
		pnl: sim.pnl != null ? sim.pnl : 0,
		exitTime: sim.exitTime != null ? new Date(sim.exitTime).toISOString() : '',
		exitReason: sim.exitReason != null ? String(sim.exitReason) : '',
		simulationDurationMins: simulationDurationMins(sim.startedAt, sim.exitTime),
		started
	};

	return { ok: true, row };
}

module.exports = {
	getTriggerPadding,
	computeTriggerTargetSl,
	runSimulationForCandle,
	candleToPrefix
};
