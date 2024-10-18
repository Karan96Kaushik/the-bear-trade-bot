const schedule = require('node-schedule');
const { sendMessageToChannel } = require('../slack-actions');
const { readSheetData, processMISSheetData } = require('../gsheets');
const { kiteSession } = require('./setup');
// const { getInstrumentToken } = require('./utils'); // Assuming you have a utility function to get instrument token
const { getDateStringIND, getDataFromYahoo } = require('./utils');
const { createSellOrders } = require('./processor');

const sellSch = process.env.NODE_ENV === 'production' ? 
                    // '16 5 * * 1-5' : 
                    '46 3 * * 1-5' : 
                    '17 16 * * 1-5'

const buySch = process.env.NODE_ENV === 'production' ? 
                    // '50 10 * * 1-5' : 
                    '49 9 * * 1-5' : 
                    '17 16 * * 1-5'




async function setupSellOrdersFromSheet() {
    try {
        await sendMessageToChannel('⌛️ Executing MIS Sell Jobs')
    
        let stockData = await readSheetData('MIS-D!A2:W100')
        stockData = processMISSheetData(stockData)
    
        await kiteSession.authenticate()
    
        stockData.map(async (stock) => {
            try {
                await createSellOrders(stock)
            } catch (error) {
                console.error(error)
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

async function updateStopLossOrders() {
    try {
        await sendMessageToChannel('⌛️ Executing Update Stop Loss Orders Job');

        await kiteSession.authenticate();

        let stockData = await readSheetData('MIS-D!A2:W100');
        stockData = processMISSheetData(stockData);

        for (const stock of stockData) {
            if (!stock.reviseSL) continue;

            const sym = stock.stockSymbol;  // No need to append .NS here

            // Get historical data for the last 30 minutes
            const data = await getDataFromYahoo(sym, 1, '1m');  // 1 day of 1-minute data
            
            // Extract the last 30 minutes of data
            const historicalData = data.chart.result[0].indicators.quote[0];
            const timestamps = data.chart.result[0].timestamp;
            const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - 30 * 60;
            const last30MinData = historicalData.high.slice(-30).filter((_, index) => timestamps[timestamps.length - 30 + index] >= thirtyMinutesAgo);

            // Calculate the highest price in the last 30 minutes
            const highestPrice = Math.max(...last30MinData);

            // Get open orders for this stock
            const orders = await kiteSession.kc.getOrders();
            const existingOrder = orders.find(order => 
                order.tradingsymbol === stock.stockSymbol && 
                order.transaction_type === 'BUY' && 
                order.order_type === 'SL-M' &&
                order.status === 'TRIGGER PENDING'
            );
            // await sendMessageToChannel('🫥', stock.stockSymbol, existingOrder?.trigger_price || 'N/A', highestPrice);

            if (existingOrder && highestPrice < existingOrder.trigger_price) {
                // Cancel the existing order
                await kiteSession.kc.cancelOrder("regular", existingOrder.order_id);

                // Place a new order with updated stop loss
                await kiteSession.kc.placeOrder("regular", {
                    exchange: "NSE",
                    tradingsymbol: stock.stockSymbol.trim(),
                    transaction_type: "BUY",
                    quantity: Number(stock.quantity),
                    order_type: "SL-M",
                    trigger_price: highestPrice,
                    product: "MIS",
                    validity: "DAY",
                    guid: 'x' + stock.id,
                });

                await sendMessageToChannel('🔄 Updated SL-M SELL order', stock.stockSymbol, stock.quantity, 'New trigger price:', highestPrice);
            }
        }

        // await sendMessageToChannel('✅ Completed Update Stop Loss Orders Job');
    } catch (error) {
        await sendMessageToChannel('🚨 Error running Update Stop Loss Orders job', error?.message);
        console.error("🚨 Error running Update Stop Loss Orders job: ", error?.message);
    }
}

const scheduleMISJobs = () => {

    const sellJob = schedule.scheduleJob(sellSch, () => {
        setupSellOrdersFromSheet()
        sendMessageToChannel('⏰ MIS SELL Scheduled - ', getDateStringIND(sellJob.nextInvocation()))
    });
    sendMessageToChannel('⏰ MIS SELL Scheduled - ', getDateStringIND(sellJob.nextInvocation()))
    
    const closeNegativePositionsJob = schedule.scheduleJob(buySch, () => {
        closeNegativePositions();
        sendMessageToChannel('⏰ MIS BUY Close Negative Positions Job Scheduled - ', getDateStringIND(closeNegativePositionsJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ MIS BUY Close Negative Positions Job Scheduled - ', getDateStringIND(closeNegativePositionsJob.nextInvocation()));

    // Schedule the new job to run every 15 minutes
    const updateStopLossJob = schedule.scheduleJob('*/15 4-9 * * 1-5', () => {
        updateStopLossOrders();
        sendMessageToChannel('⏰ Update Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ MIS UPDATE Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob.nextInvocation()))
}

module.exports = {
    scheduleMISJobs,
    setupSellOrdersFromSheet,
    closeNegativePositions,
    updateStopLossOrders, // Export the new function
}
