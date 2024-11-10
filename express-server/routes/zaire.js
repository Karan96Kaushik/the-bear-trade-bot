const express = require('express');
const router = express.Router();

const { readSheetData } = require('../../gsheets');
const { scanZaireStocks } = require('../../analytics');
const { getDhanNIFTY50Data } = require('../../kite/utils');

const RISK_AMOUNT = 100

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

    let niftyList = []
    if (req.query.source == 'nifty') {
        niftyList = await readSheetData('Nifty!A1:A200')
        niftyList = niftyList.map(stock => stock[0])
    }
    else if (req.query.source == 'highbeta') {
        niftyList = (await readSheetData('HIGHBETA!B2:B150'))
                        .map(a => a[0]).filter(a => a !== 'NOT FOUND')
        // niftyList = niftyList.slice(0, 50)
        // console.log(niftyList)
    }
    else if (req.query.source == 'roce') {
        niftyList = (await getDhanNIFTY50Data({sort: 'Year1ROCE'}))
                        .filter(a => a.Volume > 100000)
                        .map(a => a.Sym)
        niftyList = niftyList.slice(0, 50)
        console.log(niftyList)
    }
    else if (req.query.source == 'roe') {
        niftyList = (await getDhanNIFTY50Data({sort: 'Year1ROE'}))
                        .filter(a => a.Volume > 100000)
                        .map(a => a.Sym)
        niftyList = niftyList.slice(0, 50)
        console.log(niftyList)
    }

    let selectedStocks = await scanZaireStocks(niftyList, date, interval);
    selectedStocks = selectedStocks.map(a => ({...a, qty: Math.ceil(RISK_AMOUNT/(a.high - a.low))}))

    res.json({stocks: selectedStocks})
});


module.exports = router;