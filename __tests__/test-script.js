const { scanZaireStocks, scanBailyStocks, getDateRange } = require("../analytics")
const { readSheetData, processMISSheetData, getStockLoc, appendRowsToMISD } = require("../gsheets")
const { updateNameInSheetForClosedOrder, processSuccessfulOrder } = require("../kite/processor")
const { setupZaireOrders } = require("../kite/scheduledJobs")

const { kiteSession } = require("../kite/setup")
// const { placeOrder } = require("../kite/processor")
const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../kite/utils")
const { Simulator } = require("../simulator/SimulatorV2")

const MAX_ORDER_VALUE = 200000
const MIN_ORDER_VALUE = 0
const RISK_AMOUNT = 100;

const run = async () => {

    try {

        // await kiteSession.authenticate()

        // let res1  = await placeOrder('SELL', 'SL', 31, 1, {stockSymbol: 'TRIDENT', quantity: 1, triggerPrice: 100}, 'stoploss-test')
        // console.log(res1)
        // console.time('ltp')
        // let ltp = await kiteSession.kc.getLTP(['NSE:TRIDENT']);
        // console.timeEnd('ltp')

        // console.time('quote')
        // let quote = await kiteSession.kc.getQuote(['NSE:TRIDENT']);
        // console.timeEnd('quote')
        // console.log(quote)

        // quote = quote['NSE:TRIDENT']?.last_price
        // console.log(quote)

        // await updateNameInSheetForClosedOrder({
        //     order_id: 'DEVMD1000',
        //     tradingsymbol: 'TRIDENT',
        //     quantity: 1,
        //     triggerPrice: 34.2,
        // })

        // return

        let niftyList = await readSheetData('HIGHBETA!D2:D550')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])
        niftyList = ['TCS']

        // const selectedStocks = await scanBailyStocks(niftyList, '2024-12-27T04:11:10Z', '5m')
        // console.log(selectedStocks)

        // await kiteSession.authenticate();
        // const positions = await kiteSession.kc.getPositions();
        // const orders = await kiteSession.kc.getOrders();

        // await setupZaireOrders(0,1)

        let date = new Date('2025-01-27T03:46:10Z')

        let traded = []

        for (let i = 0; i < 100; i++) {
            console.log(getDateStringIND(date), '---------', process.env.DEBUG)

            // const selectedStocks = await scanBailyStocks(niftyList, date, '5m')
            let selectedStocks = await scanZaireStocks(niftyList, date, '5m', false, true, true);

            if (selectedStocks.length > 0) {

                for (let index = 0; index < selectedStocks.length; index++) {
                    const stock = selectedStocks[index];

                    const { startDate, endDate } = getDateRange(date);
                    endDate.setHours(11)
    
                    let yahooData = await getDataFromYahoo(stock.sym, 5, '1m', startDate, endDate, true);
                    yahooData = processYahooData(yahooData)

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
                    if (quantity < 1)
                        quantity = 1
    
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
                            sym: sim.stockSymbol,
                            data: yahooData,
                            actions: sim.tradeActions.map(s => ({...s, time: getDateStringIND(new Date(s.time))}))
                        })
                    }

                }

            }

            date = new Date(date.getTime() + 5 * 60 * 1000)
        }

        let filTraded = traded.filter(t => !traded.find(t1 => ((t1.startedAt < t.startedAt || +t1.placedAt < +t.placedAt) && (t.sym == t1.sym))))

        console.log(filTraded)
        // console.log(filTraded.map(t => [t.sym, t.pnl]))
        // console.log(filTraded.map(t => t.pnl).reduce((p,c) => p+c,0))


        // console.log(selectedStocks)

        // date = new Date('2024-12-26T08:11:10Z')
        // console.log(getDateStringIND(date), '---------')
        // selectedStocks = await scanZaireStocks(niftyList, date, '5m');

        // console.log(selectedStocks)
        // console.table(selectedStocks.map(a => ({...a, qty: Math.ceil(200/(a.high - a.low))})))

        
        // console.log(pos)

        return 

        console.log(orders)

        stockData = await readSheetData('MIS-ALPHA!A2:W1000')
        stockData = processMISSheetData(stockData)
        console.log(stockData)

        stockData = await readSheetData('MIS-ALPHA!A1:W100')
        console.log(stockData)
        const rowHeaders = stockData.map(a => a[1])
        const colHeaders = stockData[0]
        console.log(rowHeaders)

        const [row, col] = getStockLoc('DCBBAN1K', 'Last Action', rowHeaders, colHeaders)
        console.log(row,col)

        let res
        if (false)
            res = await kiteSession.kc.placeOrder("amo", {
            exchange: "NSE",            // Exchange (NSE/BSE/MCX)
            tradingsymbol: "TRIDENT",
            transaction_type: "BUY",    // BUY or SELL
            quantity: 1, // Quantity of the stock
            order_type: "LIMIT",        // AMO orders can be LIMIT or MARKET
            price: '34.2',    // Limit price (if it's a LIMIT order)
            product: "CNC",             // AMO orders are generally used for CNC (delivery) trades
            validity: "DAY",            // Valid for the day
            disclosed_quantity: 0,      // Optional
            trigger_price: 0,           // Optional (for stop loss orders)
            guid:'DEVMD1000'
            // amo: true                   // Key flag to indicate that this is an AMO order
        });
    
        console.log(res)
        
    } catch (error) {
        console.trace(error)
    }
}

run()