const schedule = require('node-schedule');
const { sendMessageToChannel } = require('../slack-actions');
const { readSheetData, processMISSheetData } = require('../gsheets');
const { kiteSession } = require('./setup');

const sellSch = process.env.NODE_ENV === 'production' ? 
                    '46 3 * * 1-5' : 
                    // '11 7 * * 1-5' : 
                    '17 6 * * 1-5'

// const buySch = process.env.NODE_ENV === 'production' ? 
//                     '30 9 * * 1-5' : 
//                     '1 5 * * 1-5'

const IND_OFFSET = 3600*1000*5.5
const getDateStringIND = (date) => {
    if (typeof(date) == 'string') date = new Date(date)
    date = new Date(+new Date(date) + IND_OFFSET)
    date = date.toISOString().split('T')
    return date[0] + ' ' + date[1].split('.')[0]
}

const MAX_ORDER_VALUE = 110000
const MIN_ORDER_VALUE = 50000

async function setupSellOrdersFromSheet() {
    sendMessageToChannel('⌛️ Executing MIS Sell Jobs')

    let stockData = await readSheetData('MIS-D!A2:W100')
    stockData = processMISSheetData(stockData)

    await kiteSession.authenticate()

    stockData.map(async (stock) => {
        if (stock.ignore)
            return console.log('IGNORING', stock.stockSymbol)

        try {

            const sym = `NSE:${stockSymbol}`
            let order_value = await kiteSession.kc.getLTP([sym]);
            order_value = order_value[sym].last_price
            order_value = Number(stock.quantity.trim()) * Number(order_value)

            if (order_value > MAX_ORDER_VALUE || order_value < MIN_ORDER_VALUE)
                throw new Error('Order value not within limits!')

            // console.log(stock.targetPrice, stock.stockSymbol)
            if (stock.sellPrice.trim() == 'MKT') {
                await kiteSession.kc.placeOrder("regular", {
                    exchange: "NSE",
                    tradingsymbol: stock.stockSymbol.trim(),
                    transaction_type: "SELL",
                    quantity: Number(stock.quantity.trim()),
                    order_type: "MARKET",
                    product: "MIS",
                    validity: "DAY"
                });
            }
            else {
                await kiteSession.kc.placeOrder("regular", {
                    exchange: "NSE",
                    tradingsymbol: stock.stockSymbol.trim(),
                    transaction_type: "SELL",
                    quantity: Number(stock.quantity.trim()),
                    order_type: "SL-M",
                    trigger_price: Number(stock.sellPrice.trim()),  // Stop-loss trigger price
                    // price: Number(stock.targetPrice),
                    product: "MIS",
                    validity: "DAY",
                    guid: 'x' + stock.id,
                });
                sendMessageToChannel('✅ Successfully placed target sell order', stock.stockSymbol, stock.quantity)
            }
        } catch (error) {
            sendMessageToChannel('🚨 Error placing target sell order', stock.stockSymbol, stock.quantity. stock.sellPrice, error?.message)
            console.error("🚨 Error placing target sell order: ", stock.stockSymbol, stock.quantity. stock.sellPrice, error?.message);
        }

    })

    sendMessageToChannel('⏰ MIS Sell Scheduled - ', getDateStringIND(sellJob.nextInvocation()))
}

const scheduleMISJobs = () => {

    const sellJob = schedule.scheduleJob(sellSch, setupSellOrdersFromSheet);

    sendMessageToChannel('⏰ MIS Sell Scheduled - ', getDateStringIND(sellJob.nextInvocation()))



    return 
    /** Closing since not necessary **/
    const buyJob = schedule.scheduleJob(buySch, async function(){
        let stockData = await readSheetData('MIS-D!A2:W100')
        stockData = stockData.map(s => ({stockSymbol: s[0], targetPrice: s[1], quantity: s[2]}))
    
        sendMessageToChannel('⌛️ Executing MIS Buy Jobs')

        await kiteSession.authenticate()

        stockData.map(async (stock) => {
            try {
                await kiteSession.kc.placeOrder("regular", {
                    exchange: "NSE",
                    tradingsymbol: stock.stockSymbol,
                    transaction_type: "BUY",
                    quantity: Number(stock.quantity),
                    order_type: "MARKET",
                    product: "MIS",
                    validity: "DAY"
                });
                sendMessageToChannel('✅ Successfully placed market buy order', stock.stockSymbol, stock.quantity)
    
            } catch (error) {
                sendMessageToChannel('🚨 Error placing market sell order', stock.stockSymbol, stock.quantity, error?.message)
                console.error("🚨 Error placing market sell order: ", stock.stockSymbol, stock.quantity, error?.message);
            }
        })

        sendMessageToChannel('⏰ MIS Buy Scheduled - ', getDateStringIND(buyJob.nextInvocation()))
    });

    sendMessageToChannel('⏰ MIS Buy Scheduled - ', getDateStringIND(buyJob.nextInvocation()))

}

module.exports = {
    scheduleMISJobs,
}