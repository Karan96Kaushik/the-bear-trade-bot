const express = require('express');
const axios = require('axios');
const router = express.Router();
const { getDataFromYahoo, searchUpstoxStocks } = require('../../kite/utils'); // Assuming this module exists
const { kiteSession } = require('../../kite/setup');
const { readSheetData, processMISSheetData } = require('../../gsheets');

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
		
		if (yahooDataCache.has(cacheKey)) {
			return res.json(yahooDataCache.get(cacheKey));
		}
		
		const data = await getDataFromYahoo(symbol, days, interval, startDate, endDate);
		yahooDataCache.set(cacheKey, data);
		res.json(data);
	} catch (error) {
		console.error('Error fetching Yahoo Finance data:', error?.data || error);
		res.status(500).json({ message: 'Server error' });
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



module.exports = router;

