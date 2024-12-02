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
		data = data.filter(d => d.sma44 && d.close)
		res.json(data);
	} catch (error) {
		console.error('Error fetching Yahoo Finance data:', error?.data || error);
		res.status(500).json({ message: ('Error fetching Yahoo Finance data:', error?.data || error) });
	}
});

router.get('/nse', async (req, res) => {
	try {
		let { symbol, fromDate, toDate } = req.query;

		if (!symbol) {
			return res.status(400).json({ message: 'Symbol is required' });
		}

		if (!fromDate) fromDate = new Date()
		if (!toDate) toDate = new Date()

		if (typeof fromDate == 'string') fromDate = new Date(fromDate)
		if (typeof toDate == 'string') toDate = new Date(toDate)

		const data = await getNSEChartData(symbol, fromDate, toDate)
		data = processNSEChartData(data)

		res.json(data);
	} catch (error) {
		console.error('Error fetching NSE data:', error?.data || error);
		res.status(500).json({ message: ('Error fetching NSE data:', error?.data || error) });
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

		const savedFunctions = await FunctionHistory.find().sort('-createdAt').limit(20);
		res.json(savedFunctions);
	} catch (error) {
		console.error('Error fetching function history:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/delete-function', async (req, res) => {
	try {
		const { _id } = req.body;
		
		if (!_id) {
			return res.status(400).json({ message: 'Function _id is required' });
		}

		const result = await FunctionHistory.findByIdAndDelete(_id);

		if (!result) {
			return res.status(404).json({ message: 'Function not found' });
		}

		res.status(200).json({ message: 'Function deleted successfully' });
	} catch (error) {
		console.error('Error deleting function:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

module.exports = router;
