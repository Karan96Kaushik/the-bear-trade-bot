const express = require('express');
const router = express.Router();
// const { placeOrder } = require("../kite/processor")
const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../../kite/utils")
const { Simulator } = require("../../simulator/SimulatorV2")
const { scanZaireStocks, scanBailyStocks, getDateRange, addMovingAverage } = require("../../analytics")
const { readSheetData } = require("../../gsheets")

const RISK_AMOUNT = 100;

router.get('/simulate/v2', async (req, res) => {
    try {
        let niftyList = ['TCS']
        let traded = []

        let { date, symbol } = req.query

        if (!symbol) {
            niftyList = await readSheetData('HIGHBETA!D2:D550')  // await getDhanNIFTY50Data();
            niftyList = niftyList.map(stock => stock[0])
        }
        else {
            niftyList = [symbol]
        }

        date = new Date(date)
        let endday = new Date(date)

        date.setHours(3,46,10,0)
        endday.setHours(9,50,10,0)
        // let date = new Date('2025-01-27T03:46:10Z')

        while (date < endday) {

            console.log(getDateStringIND(date), '---------')

            // const selectedStocks = await scanBailyStocks(niftyList, date, '5m')
            let selectedStocks = await scanZaireStocks(niftyList, date, '5m', false, true, true);

            
            if (selectedStocks.length > 0) {

                for (let index = 0; index < selectedStocks.length; index++) {
                    const stock = selectedStocks[index];

                    const { startDate, endDate } = getDateRange(date);
                    endDate.setHours(11)
    
                    let yahooData = await getDataFromYahoo(stock.sym, 5, '1m', startDate, endDate, true);
                    yahooData = processYahooData(yahooData)

                    yahooData = addMovingAverage(yahooData,'close',44, 'sma44')

                    let triggerPadding = 1
                    if (stock.high < 20)
                        triggerPadding = 0.1
                    else if (stock.high < 50)
                        triggerPadding = 0.2
                    else if (stock.high < 100)
                        triggerPadding = 0.3
                    else if (stock.high < 300)
                        triggerPadding = 0.5

                    let direction = stock.direction

                    let triggerPrice, targetPrice, stopLossPrice

                    if (direction == 'BULLISH') {
                        triggerPrice = stock.high + triggerPadding;
                        // Stop loss is low
                        stopLossPrice = stock.low - triggerPadding;
                        targetPrice = stock.high + ((triggerPrice - stopLossPrice) * 2) // triggerPrice;
                    }
                    else {
                        triggerPrice = stock.low - triggerPadding;
                        // Stop loss is high
                        stopLossPrice = stock.high + triggerPadding;
                        // Target price is double the difference between trigger price and low
                        targetPrice = stock.low - ((stopLossPrice - triggerPrice) * 2)
            
                    }
                    
                    triggerPrice = Math.round(triggerPrice * 10) / 10;
                    stopLossPrice = Math.round(stopLossPrice * 10) / 10;
                    targetPrice = Math.round(targetPrice * 10) / 10;

                    let quantity = Math.ceil(RISK_AMOUNT / (triggerPrice - stopLossPrice));
                    // if (quantity < 1)
                    //     quantity = 1

                    quantity = Math.abs(quantity)
    
                    const sim = new Simulator({
                        stockSymbol: stock.sym,
                        triggerPrice,
                        targetPrice,
                        stopLossPrice,
                        quantity,
                        direction,
                        yahooData,
                        orderTime: date
                    })

                    sim.run()

                    if (sim.startedAt) {
                        traded.push({
                            startedAt: sim.startedAt,
                            placedAt: sim.orderTime,
                            pnl: sim.pnl,
                            quantity: sim.quantity,
                            direction: sim.direction,
                            sym: sim.stockSymbol,
                            data: yahooData,
                            actions: sim.tradeActions,
                            // actions: sim.tradeActions.map(s => ({...s, time: getDateStringIND(new Date(s.time))}))
                        })
                    }

                }

            }

            date = new Date(date.getTime() + 5 * 60 * 1000)
        }
        let filTraded = traded.filter(t => !traded.find(t1 => ((t1.startedAt < t.startedAt || +t1.placedAt < +t.placedAt) && (t.sym == t1.sym))))

        // console.log(filTraded)
        
      res.json(filTraded);
    } catch (error) {
      console.error('Error fetching orders data:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });

module.exports = router;
