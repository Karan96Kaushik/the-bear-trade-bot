const schedule = require('node-schedule');
const { sendMessageToChannel } = require('../slack-actions');
const { readSheetData, processMISSheetData } = require('../gsheets');
const { kiteSession } = require('./setup');
// const { getInstrumentToken } = require('./utils'); // Assuming you have a utility function to get instrument token
const { getDateStringIND, getDataFromYahoo } = require('./utils');
const { createOrders } = require('./processor');
const { connectToDatabase } = require('../modules/db');
// const OrderLog = require('../models/OrderLog');

const sellSch = process.env.NODE_ENV === 'production' ? 
                    // '16 5 * * 1-5' : 
                    '46 3 * * 1-5' : 
                    '17 16 * * 1-5'

const buySch = process.env.NODE_ENV === 'production' ? 
                    // '50 10 * * 1-5' : 
                    '49 9 * * 1-5' : 
                    '17 16 * * 1-5'


const MAX_ORDER_VALUE = 110000
const MIN_ORDER_VALUE = 0

async function validateOrdersFromSheet() {
    try {
        await sendMessageToChannel('⌛️ Executing Validation Job')
    
        let stockData = await readSheetData('MIS-TEST!A2:W100')
        stockData = processMISSheetData(stockData)
    
        await kiteSession.authenticate()
    
        for (const stock of stockData) {
            try {
                const sym = `NSE:${stock.stockSymbol}`
                let ltp = await kiteSession.kc.getLTP([sym]);
                ltp = ltp[sym].last_price
                let order_value = Math.abs(stock.quantity) * Number(ltp)
                
                if (Number(stock.triggerPrice) > ltp) {
                    await sendMessageToChannel('🔔 Cannot place target sell order: LTP lower than Sell Price.', stock.stockSymbol, stock.quantity, "Sell Price:", stock.triggerPrice, 'LTP: ', ltp)
                    return
                }
                if (order_value > MAX_ORDER_VALUE || order_value < MIN_ORDER_VALUE) {
                    await sendMessageToChannel(`🔔 Order value ${order_value} not within limits!`, stock.stockSymbol, stock.quantity, "Sell Price:", stock.triggerPrice, 'LTP: ', ltp)
                    return
                }

            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🔕 Error validating', stock.stockSymbol, stock.quantity, stock.triggerPrice, error?.message)
            }
        }
    } catch (error) {
        await sendMessageToChannel('🚨 Error running schedule sell jobs', error?.message)
    }

}

async function setupOrdersFromSheet() {
    try {
        await sendMessageToChannel('⌛️ Executing MIS Jobs')
    
        let stockData = await readSheetData('MIS-TEST!A2:W100')
        stockData = processMISSheetData(stockData)
    
        await kiteSession.authenticate()
    
        for (const stock of stockData) {
            try {
                const orderResponse = await createOrders(stock)

            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🚨 Error running schedule sell jobs', stock.stockSymbol, stock.quantity, stock.triggerPrice, error?.message)
            }
        }
    } catch (error) {
        await sendMessageToChannel('🚨 Error running schedule sell jobs', error?.message)
    }

}

async function closePositions() {
    try {
        await sendMessageToChannel('⌛️ Executing Close [POSITIVE] Positions Job');

        await kiteSession.authenticate();

        const positions = await kiteSession.kc.getPositions();
        const allPositions = positions.net.filter(position => position.quantity > 0);

        for (const position of allPositions) {
            try {
                await kiteSession.kc.placeOrder("regular", {
                    exchange: position.exchange,
                    tradingsymbol: position.tradingsymbol,
                    transaction_type: position.quantity < 0 ? "BUY" : "SELL",
                    quantity: Math.abs(position.quantity),
                    order_type: "MARKET",
                    product: "MIS",
                    validity: "DAY"
                });
                await sendMessageToChannel(`✅ Successfully placed Market ${position.quantity < 0 ? "BUY" : "SELL"} order to close position`, position.tradingsymbol, Math.abs(position.quantity));
            } catch (error) {
                await sendMessageToChannel('🚨 Error placing  order to close position', position.tradingsymbol, position.quantity, error?.message);
                console.error("🚨 Error placing  order to close position: ", position.tradingsymbol, position.quantity, error?.message);
            }
        }
    } catch (error) {
        await sendMessageToChannel('🚨 Error running close negative positions job', error?.message);
        console.error("🚨 Error running close negative positions job: ", error?.message);
    }
}

async function calculateHighestPrice(sym) {
    const data = await getDataFromYahoo(sym, 1, '1m');  // 1 day of 1-minute data
    const historicalData = data.chart.result[0].indicators.quote[0];
    const timestamps = data.chart.result[0].timestamp;
    // Extract the last 30 minutes of data
    const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - 30 * 60;
    const last30MinData = historicalData.high.slice(-30).filter((_, index) => timestamps[timestamps.length - 30 + index] >= thirtyMinutesAgo);
    // console.log(last30MinData)
    // Calculate the highest price in the last 30 minutes
    return Math.max(...last30MinData);
}

async function updateStopLossOrders() {
    try {
        await sendMessageToChannel('⌛️ Executing Update Stop Loss Orders Job');

        await kiteSession.authenticate();

        let stockData = await readSheetData('MIS-TEST!A2:W100');
        stockData = processMISSheetData(stockData);
        const orders = await kiteSession.kc.getOrders();

        // console.log(orders)
        // console.log(stockData)

        for (const stock of stockData) {
            if (!stock.reviseSL) continue;

            const sym = stock.stockSymbol;  // No need to append .NS here

            if (stock.type === 'DOWN') {

                const existingOrder = orders.find(order => 
                    order.tradingsymbol === stock.stockSymbol && 
                    order.transaction_type === 'BUY' && 
                    order.order_type === 'SL-M' &&
                    order.status === 'TRIGGER PENDING'
                );

                if (!existingOrder) continue

                const highestPrice = await calculateHighestPrice(sym);
                // console.log(highestPrice, existingOrder.trigger_price)

                if (highestPrice < existingOrder.trigger_price) {
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
                        // guid: 'x' + stock.id,
                    });
    
                    await sendMessageToChannel('🔄 Updated SL-M BUY order', stock.stockSymbol, stock.quantity, 'New trigger price:', highestPrice);
                }

            }
            else {

                const existingOrder = orders.find(order => 
                    order.tradingsymbol === stock.stockSymbol && 
                    order.transaction_type === 'SELL' && 
                    order.order_type === 'SL-M' &&
                    order.status === 'TRIGGER PENDING'
                );

                if (!existingOrder) continue

                await sendMessageToChannel('😶‍🌫️ Could not update SL for UPWARD TREND order - no logic defined', stock.stockSymbol, stock.quantity);

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
        setupOrdersFromSheet()
        sendMessageToChannel('⏰ MIS Scheduled - ', getDateStringIND(sellJob.nextInvocation()))
    });
    sendMessageToChannel('⏰ MIS Scheduled - ', getDateStringIND(sellJob.nextInvocation()))
    
    const closePositionsJob = schedule.scheduleJob(buySch, () => {
        closePositions();
        sendMessageToChannel('⏰ MIS BUY Close Positions Job Scheduled - ', getDateStringIND(closePositionsJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ MIS BUY Close Positions Job Scheduled - ', getDateStringIND(closePositionsJob.nextInvocation()));

    const validationJob = schedule.scheduleJob('35 3 * * 1-5', () => {
        validateOrdersFromSheet();
        sendMessageToChannel('⏰ MIS Validation Job Scheduled - ', getDateStringIND(validationJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ MIS Validation Job Scheduled - ', getDateStringIND(validationJob.nextInvocation()));

    // Schedule the new job to run every 15 minutes
    const updateStopLossJob = schedule.scheduleJob('*/15 4-9 * * 1-5', () => {
        updateStopLossOrders();
        sendMessageToChannel('⏰ Update Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ MIS UPDATE Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob.nextInvocation()))
}

module.exports = {
    scheduleMISJobs,
    setupOrdersFromSheet,
    closePositions,
    updateStopLossOrders,
    validateOrdersFromSheet,
    calculateHighestPrice,
}
