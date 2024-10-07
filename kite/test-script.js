// console.error = console.trace

const { readSheetData, processMISSheetData, getStockLoc } = require("../gsheets")
const { kiteSession } = require("./setup")

// console.debug = console.trace
// console.warn = console.trace
// console.info = console.trace

const run = async () => {

    try {

        let stockData = await readSheetData('MIS-D!A2:W100')
        stockData = processMISSheetData(stockData)

        // await kiteSession.authenticate()
        // // const orders = await kiteSession.kc.getOrders()

        // // await kiteSession.kc.getInstruments('NSE')
        // const stockSymbol = 'MOIL'
        // const sym = `NSE:${stockSymbol}`
        // let order_value = await kiteSession.kc.getLTP([sym]);
        // order_value = order_value[sym].last_price
        // console.log(order_value)



        return 

        console.log(orders)

        stockData = await readSheetData('MIS-D!A2:W100')
        stockData = processMISSheetData(stockData)
        console.log(stockData)

        stockData = await readSheetData('MIS-D!A1:W100')
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