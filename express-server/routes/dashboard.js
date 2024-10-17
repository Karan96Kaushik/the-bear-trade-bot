const express = require('express');
const router = express.Router();
const { getDataFromYahoo } = require('../../kite/utils'); // Assuming this module exists
const { kiteSession } = require('../../kite/setup');

const INDIAN_TIMEZONE_OFFSET = 60 * 60 * 1000 * (5.5);

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

      const data = await getDataFromYahoo(symbol, days, interval, startDate, endDate);
      res.json(data);
    } catch (error) {
      console.error('Error fetching Yahoo Finance data:', error?.response?.data);
      res.status(500).json({ message: 'Server error' });
    }
  });

router.get('/', async (req, res) => {
  try {
    const data = {};
    res.json(data);
  } catch (error) {
    console.error('Error fetching Yahoo Finance data:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/orders', async (req, res) => {
    try {
      let data = await kiteSession.kc.getOrders();
      data = data.map(d => ({
        ...d,
        order_timestamp: new Date(+new Date(d.order_timestamp) - INDIAN_TIMEZONE_OFFSET)
    }))
      res.json(data);
    } catch (error) {
      console.error('Error fetching Yahoo Finance data:', error?.response?.data);
      res.status(500).json({ message: 'Server error' });
    }
  });

module.exports = router;

