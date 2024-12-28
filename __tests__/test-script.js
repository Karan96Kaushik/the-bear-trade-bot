const { scanZaireStocks } = require("../analytics")
const { readSheetData, processMISSheetData, getStockLoc } = require("../gsheets")
const { updateNameInSheetForClosedOrder } = require("../kite/processor")
const { kiteSession } = require("../kite/setup")
// const { placeOrder } = require("../kite/processor")
const { getDateStringIND } = require("../kite/utils")

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

        let niftyList = await readSheetData('Nifty!A1:A200')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])
        niftyList = ['EICHERMOT']

        // await kiteSession.authenticate();
        // const positions = await kiteSession.kc.getPositions();
        // const orders = await kiteSession.kc.getOrders();

        let date = new Date('2024-12-27T05:11:10Z')

        for (let i = 0; i < 100; i++) {
            console.log(getDateStringIND(date), '---------')
            let selectedStocks = await scanZaireStocks(niftyList, date, '15m', false);
            if (selectedStocks.length > 0) {
                console.log('selected stocks found-------------------->>>>>>>')
                console.log(selectedStocks)
                break
            }
            date = new Date(date.getTime() + 5 * 60 * 1000)
        }

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