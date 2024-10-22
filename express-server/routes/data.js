const express = require('express');
const axios = require('axios');
const router = express.Router();
const { getDataFromYahoo, searchUpstoxStocks, processYahooData } = require('../../kite/utils'); // Assuming this module exists
const { kiteSession } = require('../../kite/setup');
const { readSheetData, processMISSheetData } = require('../../gsheets');
const FunctionHistory = require('../../models/FunctionHistory');
const { addMovingAverage } = require('../../analytics');

const INDIAN_TIMEZONE_OFFSET = 60 * 60 * 1000 * (process.env.NODE_ENV == 'production' ? 5.5 : 4.5);

const yahooDataCache = new Map();

router.get('/yahoo', async (req, res) => {
	try {
		let { symbol, days, interval, startDate, endDate } = req.query;
		
		if (!symbol) {
			return res.status(400).json({ message: 'Symbol is required' });
		}
		
		if (!days)
			days = 70;
		if (!interval)
			interval = '1d';
		
		if (interval.includes('m'))
			days = 2;
		
		const cacheKey = `${symbol}-${days}-${interval}-${startDate}-${endDate}`;

		let data

		if (yahooDataCache.has(cacheKey)) {
			data = yahooDataCache.get(cacheKey);
		}
		else {
			data = await getDataFromYahoo(symbol, days, interval, startDate, endDate);
			yahooDataCache.set(cacheKey, data);
		}

		data = processYahooData(data)
		data = addMovingAverage(data, 'close', 44, 'sma44')

		res.json(data);
	} catch (error) {
		console.error('Error fetching Yahoo Finance data:', error?.data || error);
		res.status(500).json({ message: ('Error fetching Yahoo Finance data:', error?.data || error) });
	}
});

router.get('/stocks/suggest', async (req, res) => {
	try {
		let { query } = req.query;
		
		if (!query) {
			return res.status(400).json({ message: 'Symbol is required' });
		}

		const data = await searchUpstoxStocks(query)

		res.json(data);
	} catch (error) {
		console.error('Error fetching Symbol search data:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/stocks/ltp', async (req, res) => {
	try {
		let { symbol } = req.query;
		
		if (!symbol) {
			return res.status(400).json({ message: 'Symbol is required' });
		}

        const sym = `NSE:${symbol}`
        let ltp = await kiteSession.kc.getLTP([sym]);
        ltp = ltp[sym].last_price

		res.json({ltp});
	} catch (error) {
		console.error('Error fetching Symbol search data:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/', async (req, res) => {
	try {
		const data = {};
		res.json(data);
	} catch (error) {
		console.error('Error :', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/save-function', async (req, res) => {
	try {
		const { name, code, type } = req.body;
		
		if (!name || !code || !type) {
			return res.status(400).json({ message: 'Name, code and type are required' });
		}

		const existingFunction = await FunctionHistory.findOne({ name, type });
		if (existingFunction) {
			existingFunction.code = code;
			existingFunction.type = type;
			await existingFunction.save();
		} else {
			const functionHistory = new FunctionHistory({ name, code, type });
			await functionHistory.save();
		}

		res.status(201).json({ message: 'Function saved successfully' });
	} catch (error) {
		console.error('Error saving function:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/functions', async (req, res) => {
	try {
		// const { name } = req.query;
		
		// if (!name) {
		// 	return res.status(400).json({ message: 'Function name is required' });
		// }

		const savedFunctions = await FunctionHistory.find().sort('-createdAt').limit(10);
		res.json(savedFunctions);
	} catch (error) {
		console.error('Error fetching function history:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

module.exports = router;
