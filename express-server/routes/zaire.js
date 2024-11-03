const express = require('express');
const router = express.Router();

const { readSheetData } = require('../../gsheets');
const { scanZaireStocks } = require('../../analytics');

router.get('/selected-stocks', async (req, res) => {
    // Get date from query or use current date
    let date = req.query.date ? new Date(req.query.date) : new Date();
    let interval = req.query.interval ? req.query.interval : '15m';
    const intervalMins = parseInt(interval.split('m')[0]);
    
    // Round to nearest 15 minutes
    date.setMinutes(Math.round(date.getMinutes() / intervalMins) * intervalMins);
    date.setSeconds(10); // Add 10 seconds
    
    if (date.getUTCHours() < 4 && intervalMins >= 15) {
        date.setUTCHours(4,0,10,0);
    }
    else if (date.getUTCHours() < 4 && intervalMins < 15) {
        date.setUTCHours(3,50,10,0);
    }

    let niftyList = await readSheetData('Nifty!A1:A200')
    niftyList = niftyList.map(stock => stock[0])

    let selectedStocks = await scanZaireStocks(niftyList, date, interval);
    selectedStocks = selectedStocks.map(a => ({...a, qty: Math.ceil(200/(a.high - a.low))}))

    res.json({stocks: selectedStocks})
});

module.exports = router;