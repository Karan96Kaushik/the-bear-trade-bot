const { scanZaireStocks } = require("../analytics")
const { readSheetData, processMISSheetData, getStockLoc } = require("../gsheets")
const { kiteSession } = require("../kite/setup")

const run = async () => {

    try {

        let niftyList = await readSheetData('Nifty!A1:A200')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])

        // await kiteSession.authenticate();
        // const positions = await kiteSession.kc.getPositions();
        // const orders = await kiteSession.kc.getOrders();

        const selectedStocks = await scanZaireStocks(niftyList, new Date('2024-10-30T04:16:10Z'));
        console.table(selectedStocks)

        
        // console.log(pos)

        return 

        console.log(orders)

        stockData = await readSheetData('MIS-ALPHA!A2:W100')
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