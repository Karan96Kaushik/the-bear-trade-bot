const schedule = require('node-schedule');
const { sendMessageToChannel } = require('../slack-actions');
const { readSheetData, processMISSheetData, appendRowsToMISD } = require('../gsheets');
const { kiteSession } = require('./setup');
// const { getInstrumentToken } = require('./utils'); // Assuming you have a utility function to get instrument token
const { getDateStringIND, getDataFromYahoo, getDhanNIFTY50Data } = require('./utils');
const { createOrders, createZaireOrders, placeOrder, logOrder } = require('./processor');
const { scanZaireStocks } = require('../analytics');

// const OrderLog = require('../models/OrderLog');

const MAX_ORDER_VALUE = 200000
const MIN_ORDER_VALUE = 0

async function setupZaireOrders() {
    try {
        await sendMessageToChannel('⌛️ Executing Zaire MIS Jobs');

        let niftyList = await readSheetData('Nifty!A1:A200')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])

        let stockData = await readSheetData('MIS-ALPHA!A2:W100')
        stockData = processMISSheetData(stockData)

        await kiteSession.authenticate();
        
        const selectedStocks = await scanZaireStocks(niftyList);
        
        const orders = await kiteSession.kc.getOrders();
        const positions = await kiteSession.kc.getPositions();

        sendMessageToChannel('🔔 Zaire MIS Stocks: ', selectedStocks);

        const sheetEntries = []

        for (const stock of selectedStocks) {
            try {
                // Skip if stock is already in position or open orders
                if (
                    positions.net.find(p => p.tradingsymbol === stock.sym) 
                    || 
                    orders.find(o => o.tradingsymbol === stock.sym)
                )
                    continue

                if (stockData.find(s => s.stockSymbol === stock.sym)) {
                    await sendMessageToChannel('🔔 Ignoring coz already in sheet', stock.sym)
                    continue
                }

                let sheetEntry = await createZaireOrders(stock);
                // sheetEntries.push(sheetEntry)
                // await appendRowsToMISD([sheetEntry])
            } catch (error) {
                console.error(error);
                await sendMessageToChannel('🚨 Error running Zaire MIS Jobs', stock, error?.message);
            }
        }

    } catch (error) {
        await sendMessageToChannel('🚨 Error running Zaire MIS Jobs', error?.message);
    }
}

async function cancelZaireOrders() {
    try {
        await sendMessageToChannel('⌛️ Executing Zaire Cancel Orders Job');

        const orders = await kiteSession.kc.getOrders();
        const zaireOrders = orders.filter(o => (o.status === 'TRIGGER PENDING' || o.status === 'OPEN') && o.tag === 'zaire');

        for (const order of zaireOrders) {
            try {

                await kiteSession.kc.cancelOrder('regular', order.order_id);
                await sendMessageToChannel('❎ Cancelled Zaire order:', order.tradingsymbol, order.quantity, order.status, order.tag);
            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🚨 Error cancelling Zaire order:', order.tradingsymbol, order.quantity, error?.message);
            }
        }

    } catch (error) {
        await sendMessageToChannel('🚨 Error running Zaire Cancel Orders Job', error?.message);
    }
}

async function setupSpecialOrdersFromSheet() {
    try {
        await sendMessageToChannel('⌛️ Executing Special MIS Jobs');
    
        let niftyList = await getDhanNIFTY50Data()

        niftyList = niftyList.map(stock => stock.Sym)
    
        await kiteSession.authenticate();
    
        for (const stock of niftyList) {
            try {
                const orderResponse = await createSpecialOrders(stock);
            } catch (error) {
                console.error(error);
                await sendMessageToChannel('🚨 Error running special schedule jobs', stock.stockSymbol, stock.quantity, stock.triggerPrice, error?.message);
            }
        }
    } catch (error) {
        await sendMessageToChannel('🚨 Error running special schedule jobs', error?.message);
    }
}

async function validateOrdersFromSheet() {
    try {
        await sendMessageToChannel('⌛️ Executing Validation Job')
    
        let stockData = await readSheetData('MIS-ALPHA!A2:W100')
        stockData = processMISSheetData(stockData)
    
        await kiteSession.authenticate()
    
        for (const stock of stockData) {
            try {
                const sym = `NSE:${stock.stockSymbol}`
                let ltp = await kiteSession.kc.getLTP([sym]);
                ltp = ltp[sym].last_price
                let order_value = Math.abs(stock.quantity) * Number(ltp)
                
                if (stock.type === 'BEARISH' && Number(stock.triggerPrice) > ltp) {
                    await sendMessageToChannel('🔔 Cannot place target sell order: LTP lower than Sell Price.', stock.stockSymbol, stock.quantity, "Sell Price:", stock.triggerPrice, 'LTP: ', ltp)
                    continue
                }
                if (stock.type === 'BULLISH' && Number(stock.triggerPrice) < ltp) {
                    await sendMessageToChannel('🔔 Cannot place target buy order: LTP higher than Buy Price.', stock.stockSymbol, stock.quantity, "Buy Price:", stock.triggerPrice, 'LTP: ', ltp)
                    continue
                }
                if (order_value > MAX_ORDER_VALUE || order_value < MIN_ORDER_VALUE) {
                    await sendMessageToChannel(`🔔 Order value ${order_value} not within limits!`, stock.stockSymbol, stock.quantity, "Price:", stock.triggerPrice, 'LTP: ', ltp)
                    continue
                }

                await sendMessageToChannel('✅ Validation passed', stock.stockSymbol, stock.quantity, stock.type, "Price:", stock.triggerPrice, 'LTP: ', ltp)

            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🔕 Error validating', stock.stockSymbol, stock.quantity, stock.triggerPrice, error?.message)
            }
        }
    } catch (error) {
        await sendMessageToChannel('🚨 Error running validation job', error?.message)
    }
}

async function setupOrdersFromSheet() {
    try {
        await sendMessageToChannel('⌛️ Executing MIS Jobs')
    
        let stockData = await readSheetData('MIS-ALPHA!A2:W100')
        stockData = processMISSheetData(stockData)

        const orders = await kiteSession.kc.getOrders();

        await kiteSession.authenticate()
    
        for (const stock of stockData) {
            try {
                if ( orders.find(o => o.tradingsymbol === stock.stockSymbol) )
                    continue

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
        await sendMessageToChannel('⌛️ Executing Close Positions Job');

        await kiteSession.authenticate();

        const positions = await kiteSession.kc.getPositions();
        const allPositions = positions.net.filter(position => (position.quantity || 0) != 0);

        for (const position of allPositions) {
            try {
                await placeOrder(position.quantity < 0 ? 'BUY' : 'SELL', 'MARKET', null, position.quantity, position, 'CP')

                // await kiteSession.kc.placeOrder("regular", {
                //     exchange: position.exchange,
                //     tradingsymbol: position.tradingsymbol,
                //     transaction_type: position.quantity < 0 ? "BUY" : "SELL",
                //     quantity: Math.abs(position.quantity),
                //     order_type: "MARKET",
                //     product: "MIS",
                //     validity: "DAY"
                // });
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

async function calculateExtremePrice(sym, type) {
    const data = await getDataFromYahoo(sym, 1, '1m');  // 1 day of 1-minute data
    const historicalData = data.chart.result[0].indicators.quote[0];
    const timestamps = data.chart.result[0].timestamp;
    // Extract the last 30 minutes of data
    const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - 30 * 60;
    const priceType = type === 'highest' ? 'high' : 'low';
    const last30MinData = historicalData[priceType].slice(-30).filter((_, index) => timestamps[timestamps.length - 30 + index] >= thirtyMinutesAgo);
    // Calculate the extreme price in the last 30 minutes
    return type === 'highest' ? Math.max(...last30MinData) : Math.min(...last30MinData);
}

async function updateStopLossOrders() {
    try {
        await sendMessageToChannel('⌛️ Executing Update Stop Loss Orders Job');

        await kiteSession.authenticate();

        let stockData = await readSheetData('MIS-ALPHA!A2:W100');
        stockData = processMISSheetData(stockData);
        const orders = await kiteSession.kc.getOrders();
        const positions = await kiteSession.kc.getPositions();

        // console.log(orders)
        // console.log(stockData)

        for (const stock of stockData) {
            if (!stock.reviseSL) continue;

            // Only revise SL for stocks that have already been traded
            if (!stock.lastAction) continue;

            const sym = stock.stockSymbol;
            const isDown = stock.type === 'BEARISH';

            const position = positions.net.find(p => p.tradingsymbol === sym);
            if (!position) continue;

            const existingOrder = orders.find(order => 
                order.tradingsymbol === stock.stockSymbol && 
                order.transaction_type === (isDown ? 'BUY' : 'SELL') && 
                order.order_type === 'SL-M' &&
                order.status === 'TRIGGER PENDING'
            );

            if (!existingOrder) continue;

            let newPrice = isDown 
                ? await calculateExtremePrice(sym, 'highest')
                : await calculateExtremePrice(sym, 'lowest');
            
            // if (isDown) {
            //     newPrice = newPrice * 1.02
            // }
            // else {
            //     newPrice = newPrice * 0.98
            // }

            const shouldUpdate = isDown 
                ? newPrice < existingOrder.trigger_price
                : newPrice > existingOrder.trigger_price;

            if (shouldUpdate) {
                // Cancel the existing order
                await kiteSession.kc.cancelOrder("regular", existingOrder.order_id);

                let orderResponse = await placeOrder(isDown ? "BUY" : "SELL", 'SL-M', newPrice, stock.quantity, stock, 'UPD-SL')
                await logOrder('PLACED', 'Update SL', orderResponse)
                // Place a new order with updated stop loss
                // await kiteSession.kc.placeOrder("regular", {
                //     exchange: "NSE",
                //     tradingsymbol: stock.stockSymbol,
                //     transaction_type: isDown ? "BUY" : "SELL",
                //     quantity: Number(stock.quantity),
                //     order_type: "SL-M",
                //     trigger_price: newPrice,
                //     product: "MIS",
                //     validity: "DAY",
                // });

                await sendMessageToChannel(`🔄 Updated SL-M ${isDown ? 'BUY' : 'SELL'} order`, stock.stockSymbol, stock.quantity, 'New trigger price:', newPrice);
            }
        }

        // await sendMessageToChannel('✅ Completed Update Stop Loss Orders Job');
    } catch (error) {
        await sendMessageToChannel('🚨 Error running Update Stop Loss Orders job', error?.message);
        console.error("🚨 Error running Update Stop Loss Orders job: ", error?.message);
    }
}

const scheduleMISJobs = () => {

    const sheetSetupJob = schedule.scheduleJob('46 3 * * 1-5', () => {
        setupOrdersFromSheet()
        sendMessageToChannel('⏰ Manual MIS Scheduled - ', getDateStringIND(sheetSetupJob.nextInvocation()))
    });
    sendMessageToChannel('⏰ Manual MIS Scheduled - ', getDateStringIND(sheetSetupJob.nextInvocation()))
    
    const closePositionsJob = schedule.scheduleJob('49 9 * * 1-5', () => {
        closePositions();
        sendMessageToChannel('⏰ Close Positions Job Scheduled - ', getDateStringIND(closePositionsJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ Close Positions Job Scheduled - ', getDateStringIND(closePositionsJob.nextInvocation()));

    const validationJob = schedule.scheduleJob('35 3 * * 1-5', () => {
        validateOrdersFromSheet();
        sendMessageToChannel('⏰ Validation Job Scheduled - ', getDateStringIND(validationJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ Validation Job Scheduled - ', getDateStringIND(validationJob.nextInvocation()));

    // Schedule the new job to run every 15 minutes
    const updateStopLossJob = schedule.scheduleJob('*/15 4-9 * * 1-5', () => {
        updateStopLossOrders();
        sendMessageToChannel('⏰ Update Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ Update Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob.nextInvocation()))

    // const specialJob = schedule.scheduleJob('1 16 * * 1-5', () => {
    //     setupSpecialOrdersFromSheet();
    //     sendMessageToChannel('⏰ Special Manual MIS Scheduled - ', getDateStringIND(specialJob.nextInvocation()));
    // });
    // sendMessageToChannel('⏰ Special Manual MIS Scheduled - ', getDateStringIND(specialJob.nextInvocation()));

    const zaireJob = schedule.scheduleJob('1,16 4 * * 1-5', () => {
        sendMessageToChannel('⏰ Zaire Scheduled - ', getDateStringIND(zaireJob.nextInvocation()));
        setupZaireOrders();
    });
    sendMessageToChannel('⏰ Zaire Scheduled - ', getDateStringIND(zaireJob.nextInvocation()));

    const zaireCancelJob = schedule.scheduleJob('30 15,30 4 * * 1-5', () => {
        sendMessageToChannel('⏰ Cancel Zaire Scheduled - ', getDateStringIND(zaireCancelJob.nextInvocation()));
        cancelZaireOrders();
    });
    sendMessageToChannel('⏰ Cancel Zaire Scheduled - ', getDateStringIND(zaireCancelJob.nextInvocation()));
}

module.exports = {
    scheduleMISJobs,
    setupOrdersFromSheet,
    closePositions,
    updateStopLossOrders,
    validateOrdersFromSheet,
    calculateExtremePrice,
    setupSpecialOrdersFromSheet,
    // createSpecialOrders,
};
