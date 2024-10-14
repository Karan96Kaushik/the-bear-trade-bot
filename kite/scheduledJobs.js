const schedule = require('node-schedule');
const { sendMessageToChannel } = require('../slack-actions');
const { readSheetData, processMISSheetData } = require('../gsheets');
const { kiteSession } = require('./setup');

const sellSch = process.env.NODE_ENV === 'production' ? 
                    // '16 5 * * 1-5' : 
                    '46 3 * * 1-5' : 
                    '17 16 * * 1-5'

const buySch = process.env.NODE_ENV === 'production' ? 
                    // '16 5 * * 1-5' : 
                    '50 10 * * 1-5' : 
                    '17 16 * * 1-5'


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
    try {
        await sendMessageToChannel('⌛️ Executing MIS Sell Jobs')
    
        let stockData = await readSheetData('MIS-D!A2:W100')
        stockData = processMISSheetData(stockData)
    
        await kiteSession.authenticate()
    
        stockData.map(async (stock) => {
            try {
                if (stock.ignore)
                    return console.log('IGNORING', stock.stockSymbol)
    
                const sym = `NSE:${stock.stockSymbol}`
                let ltp = await kiteSession.kc.getLTP([sym]);
                ltp = ltp[sym].last_price
                let order_value = Number(stock.quantity) * Number(ltp)
    
                if (order_value > MAX_ORDER_VALUE || order_value < MIN_ORDER_VALUE)
                    throw new Error('Order value not within limits!')
    
                if (Number(stock.sellPrice) < ltp)
                    return await sendMessageToChannel('🔔 Cannot place target sell order: LTP lower than Sell Price.', stock.stockSymbol, stock.quantity, "Sell Price:", stock.sellPrice, 'LTP: ', ltp)
    
                // console.log(stock.targetPrice, stock.stockSymbol)
                if (stock.sellPrice?.trim() == 'MKT') {
                    await kiteSession.kc.placeOrder("regular", {
                        exchange: "NSE",
                        tradingsymbol: stock.stockSymbol.trim(),
                        transaction_type: "SELL",
                        quantity: Number(stock.quantity),
                        order_type: "MARKET",
                        product: "MIS",
                        validity: "DAY"
                    });
                    await sendMessageToChannel('✅ Successfully placed Market SELL order', stock.stockSymbol, stock.quantity)
                }
                else {
                    await kiteSession.kc.placeOrder("regular", {
                        exchange: "NSE",
                        tradingsymbol: stock.stockSymbol.trim(),
                        transaction_type: "SELL",
                        quantity: Number(stock.quantity),
                        order_type: "SL-M",
                        trigger_price: Number(stock.sellPrice),  // Stop-loss trigger price
                        // price: Number(stock.targetPrice),
                        product: "MIS",
                        validity: "DAY",
                        guid: 'x' + stock.id,
                    });
                    await sendMessageToChannel('✅ Successfully placed SL-M SELL order', stock.stockSymbol, stock.quantity)
                }
            } catch (error) {
                await sendMessageToChannel('🚨 Error placing SELL order', stock.stockSymbol, stock.quantity, stock.sellPrice, error?.message)
                console.error("🚨 Error placing SELL order: ", stock.stockSymbol, stock.quantity, stock.sellPrice, error?.message);
            }
    
        })
    } catch (error) {
        await sendMessageToChannel('🚨 Error runnings schedule sell jobs', stock.stockSymbol, stock.quantity, stock.sellPrice, error?.message)
    }

}

async function closeNegativePositions() {
    try {
        await sendMessageToChannel('⌛️ Executing Close Negative Positions Job');

        await kiteSession.authenticate();

        const positions = await kiteSession.kc.getPositions();
        const negativePositions = positions.net.filter(position => position.quantity < 0);

        for (const position of negativePositions) {
            try {
                await kiteSession.kc.placeOrder("regular", {
                    exchange: position.exchange,
                    tradingsymbol: position.tradingsymbol,
                    transaction_type: "BUY",
                    quantity: Math.abs(position.quantity),
                    order_type: "MARKET",
                    product: "MIS",
                    validity: "DAY"
                });
                await sendMessageToChannel('✅ Successfully placed Market BUY order to close negative position', position.tradingsymbol, Math.abs(position.quantity));
            } catch (error) {
                await sendMessageToChannel('🚨 Error placing BUY order to close negative position', position.tradingsymbol, Math.abs(position.quantity), error?.message);
                console.error("🚨 Error placing BUY order to close negative position: ", position.tradingsymbol, Math.abs(position.quantity), error?.message);
            }
        }
    } catch (error) {
        await sendMessageToChannel('🚨 Error running close negative positions job', error?.message);
        console.error("🚨 Error running close negative positions job: ", error?.message);
    }
}

const scheduleMISJobs = () => {

    const sellJob = schedule.scheduleJob(sellSch, () => {
        setupSellOrdersFromSheet()
        sendMessageToChannel('⏰ MIS Sell Scheduled - ', getDateStringIND(sellJob.nextInvocation()))
    });
    sendMessageToChannel('⏰ MIS Sell Scheduled - ', getDateStringIND(sellJob.nextInvocation()))
    
    const closeNegativePositionsJob = schedule.scheduleJob('0 10 * * 1-5', () => {
        closeNegativePositions();
        sendMessageToChannel('⏰ Close Negative Positions Job Scheduled - ', getDateStringIND(closeNegativePositionsJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ Close Negative Positions Job Scheduled - ', getDateStringIND(closeNegativePositionsJob.nextInvocation()));
}

module.exports = {
    scheduleMISJobs,
    setupSellOrdersFromSheet,
    closeNegativePositions,
}
