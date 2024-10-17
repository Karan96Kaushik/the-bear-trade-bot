const express = require('express');

const { readSheetData, processMISSheetData, appendRowToMISD } = require("../../gsheets");
const { createSellOrders } = require("../../kite/processor");
const { kiteSession } = require("../../kite/setup");

const router = express.Router();

const INDIAN_TIMEZONE_OFFSET = 60 * 60 * 1000 * (process.env.NODE_ENV == 'production' ? 5.5 : 4.5);

router.get('/kite-orders', async (req, res) => {
    try {
      let sheetData = []
        try {
            sheetData = await readSheetData('MIS-D!A2:W100')
            sheetData = processMISSheetData(sheetData)
            sheetData = sheetData.reverse()
        } catch (error) {
            console.error('Error reading sheet data:', error);
        }

      let orders = await kiteSession.kc.getOrders();
      orders = orders.map(d => ({
        ...d,
        order_timestamp: new Date(+new Date(d.order_timestamp) - INDIAN_TIMEZONE_OFFSET)
    }))
      res.json({orders, sheetData});
    } catch (error) {
      console.error('Error fetching Yahoo Finance data:', error?.response?.data);
      res.status(500).json({ message: 'Server error' });
    }
  });

// API endpoint to create sell orders
router.post('/create-sell-orders', async (req, res) => {
  try {
    const order = req.body;
    await appendRowToMISD(order)
    const result = await createSellOrders(order);
    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('Error creating sell orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
