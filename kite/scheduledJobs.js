const schedule = require('node-schedule');
const { sendMessageToChannel } = require('../slack-actions');
const { readSheetData, processMISSheetData, appendRowsToMISD, getStockLoc, numberToExcelColumn, bulkUpdateCells } = require('../gsheets');
const { kiteSession } = require('./setup');
// const { getInstrumentToken } = require('./utils'); // Assuming you have a utility function to get instrument token
const { getDateStringIND, getDataFromYahoo, getDhanNIFTY50Data, processYahooData } = require('./utils');
const { createOrders, createZaireOrders, placeOrder, logOrder } = require('./processor');
const { scanZaireStocks, isBullishCandle, getLastCandle, isBearishCandle } = require('../analytics');
const { generateDailyReport } = require('../analytics/reports');

// const OrderLog = require('../models/OrderLog');

const MAX_ORDER_VALUE = 200000
const MIN_ORDER_VALUE = 0

async function setupZaireOrders() {
    try {
        await sendMessageToChannel('⌛️ Executing Zaire MIS Jobs');

        // let niftyList = await readSheetData('Nifty!A1:A200') 
        // niftyList = niftyList.map(stock => stock[0])

        let niftyList = await readSheetData('HIGHBETA!B2:B150')
        niftyList = niftyList.map(stock => stock[0]).filter(a => a !== 'NOT FOUND')

        let sheetData = await readSheetData('MIS-ALPHA!A2:W10000')
        sheetData = processMISSheetData(sheetData)

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
                    // || 
                    // orders.find(o => o.tradingsymbol === stock.sym)
                ) {
                    await sendMessageToChannel('🔔 Ignoring coz already in position', stock.sym)
                    continue
                }

                if (sheetData.find(s => s.stockSymbol === stock.sym)) {
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
        const zaireOrders = orders.filter(o => (o.status === 'TRIGGER PENDING' || o.status === 'OPEN') && o.tag?.includes('zaire') && o.tag?.includes('trigger'));

        let sheetData = await readSheetData('MIS-ALPHA!A1:W150')
        const rowHeaders = sheetData.map(a => a[1])
        const colHeaders = sheetData[0]

        const updates = [

        ];

        for (const order of zaireOrders) {
            try {

                await kiteSession.kc.cancelOrder('regular', order.order_id);
                await sendMessageToChannel('❎ Cancelled Zaire order:', order.tradingsymbol, order.quantity, order.status, order.tag);

                const [row, col] = getStockLoc(order.tradingsymbol, 'Symbol', rowHeaders, colHeaders)
                updates.push({
                    range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
                    values: [['-' + order.tradingsymbol]], 
                })
            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🚨 Error cancelling Zaire order:', order.tradingsymbol, order.quantity, error?.message);
            }
        }

        await bulkUpdateCells(updates)


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
    
        let stockData = await readSheetData('MIS-ALPHA!A2:W1000')
        stockData = processMISSheetData(stockData)
    
        await kiteSession.authenticate()
    
        for (const stock of stockData) {
            try {
                const sym = `NSE:${stock.stockSymbol}`
                let ltp = await kiteSession.kc.getLTP([sym]);
                ltp = ltp[sym]?.last_price
                if (!ltp) {
                    await sendMessageToChannel('🔕 LTP not found for', stock.stockSymbol)
                    continue
                }

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
    
        let stockData = await readSheetData('MIS-ALPHA!A2:W1000')
        stockData = processMISSheetData(stockData)

        const orders = await kiteSession.kc.getOrders();

        await kiteSession.authenticate()
        console.log(orders)
    
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
                await placeOrder(position.quantity < 0 ? 'BUY' : 'SELL', 'MARKET', null, position.quantity, position, 'squareoff')

                // await kiteSession.kc.placeOrder("regular", {
                //     exchange: position.exchange,
                //     tradingsymbol: position.tradingsymbol,
                //     transaction_type: position.quantity < 0 ? "BUY" : "SELL",
                //     quantity: Math.abs(position.quantity),
                //     order_type: "MARKET",
                //     product: "MIS",
                //     validity: "DAY"
                // });
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

async function closeZaireOppositePositions() {
    try {
        await sendMessageToChannel('⌛️ Executing Close Zaire Opposite Positions Job');

        await kiteSession.authenticate();

        const positions = await kiteSession.kc.getPositions();
        const allPositions = positions.net.filter(position => (position.quantity || 0) != 0);
        const orders = await kiteSession.kc.getOrders();

        const zairePositions = allPositions.filter(p => 
            orders.find(o => o.tradingsymbol === p.tradingsymbol && o.tag?.includes('zaire') && 
            o.tag?.includes('trigger'))
        )

        let updates = []

        for (const position of zairePositions) {
            try {
                const lastCandle = await getLastCandle(position.tradingsymbol)
                if (position.quantity > 0) {
                    if (isBearishCandle(lastCandle)) {
                        await sendMessageToChannel('🔔 Closing Zaire Bullish position', position.tradingsymbol, position.quantity, 'Last Candle:', lastCandle)
                        // await placeOrder('SELL', 'MARKET', null, position.quantity, position, 'zaire-opp-cl')
                        await sendMessageToChannel(lastCandle)
                        // const [row, col] = getStockLoc(position.tradingsymbol, 'Symbol', rowHeaders, colHeaders)
                        // updates.push({
                        //     range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
                        //     values: [['-' + position.tradingsymbol]], 
                        // })
                    }
                } else {
                    if (isBullishCandle(lastCandle)) {
                        await sendMessageToChannel('🔔 Closing Zaire Bearish position', position.tradingsymbol, position.quantity, 'Last Candle:', lastCandle)
                        // await placeOrder('BUY', 'MARKET', null, position.quantity, position, 'zaire-opp-cl')
                        await sendMessageToChannel(lastCandle)
                        // const [row, col] = getStockLoc(position.tradingsymbol, 'Symbol', rowHeaders, colHeaders)
                        // updates.push({
                        //     range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
                        //     values: [['-' + position.tradingsymbol]], 
                        // })

                    }
                }

                // if (updates.length > 0)
                //     await bulkUpdateCells(updates)

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
    let data = await getDataFromYahoo(sym, 1, '1m');  // 1 day of 1-minute data
    data = processYahooData(data)
    const thirtyMinutesAgo = (Math.floor(Date.now() / 1000)*1000) - (30 * 60 * 1000);
    const priceType = type === 'highest' ? 'high' : 'low';
    const last30MinData = data
                            .slice(-30)
                            // .filter((d) => d.time >= thirtyMinutesAgo)
                            .map(p => p[priceType])
                            .filter(p => p);

    return type === 'highest' ? Math.max(...last30MinData) : Math.min(...last30MinData);
}

async function updateStopLossOrders() {
    try {
        await sendMessageToChannel('⌛️ Executing Update Stop Loss Orders Job');

        await kiteSession.authenticate();

        let stockData = await readSheetData('MIS-ALPHA!A2:W1000');
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
            const isBearish = stock.type === 'BEARISH';

            const position = positions.net.find(p => p.tradingsymbol === sym);
            if (!position) continue;

            const existingOrder = orders.find(order => 
                order.tradingsymbol === stock.stockSymbol && 
                order.transaction_type === (isBearish ? 'BUY' : 'SELL') && 
                order.order_type === 'SL' &&
                (order.status === 'TRIGGER PENDING' || order.status === 'OPEN')
            );

            if (!existingOrder) continue;

            let newPrice = isBearish 
                ? await calculateExtremePrice(sym, 'highest')
                : await calculateExtremePrice(sym, 'lowest');

            // Get current LTP to validate the new SL price
            let ltp = await kiteSession.kc.getLTP([`NSE:${sym}`]);
            ltp = ltp[`NSE:${sym}`]?.last_price;

            let type = 'SL-M'

            const shouldUpdate = isBearish 
                ? newPrice < existingOrder.trigger_price
                : newPrice > existingOrder.trigger_price;

            // For bearish trades, new SL should be above LTP
            // For bullish trades, new SL should be below LTP
            if (shouldUpdate && isBearish && newPrice <= ltp) {
                type = 'MARKET'
                newPrice = null
                await sendMessageToChannel(`ℹ️ Exiting as new SL would be above LTP for ${sym}`);
            } else if (shouldUpdate && !isBearish && newPrice >= ltp) {
                type = 'MARKET'
                newPrice = null
                await sendMessageToChannel(`ℹ️ Exiting as new SL would be below LTP for ${sym}`);
            }

            if (shouldUpdate) {
                newPrice = isBearish ? newPrice + 1 : newPrice - 1
                let orderResponse = await placeOrder(isBearish ? "BUY" : "SELL", type, newPrice, stock.quantity, stock, 'stoploss-UD')
                await logOrder('PLACED', 'UPDATE SL', orderResponse)

                await kiteSession.kc.cancelOrder("regular", existingOrder.order_id);
                await logOrder('CANCELLED', 'UPDATE SL', existingOrder)

                await sendMessageToChannel(`🔄 Updated SL ${isBearish ? 'BUY' : 'SELL'} order`, stock.stockSymbol, stock.quantity, 'New trigger price:', newPrice);
            }
        }

        // await sendMessageToChannel('✅ Completed Update Stop Loss Orders Job');
    } catch (error) {
        await sendMessageToChannel('🚨 Error running Update Stop Loss Orders job', error?.message);
        console.error("🚨 Error running Update Stop Loss Orders job: ", error?.message);
    }
}

async function generateDailyReportF() {
    try {
        await generateDailyReport('29Nov')
    } catch (error) {
        await sendMessageToChannel('🚨 Error running Generate Daily Report job', error?.message);
        console.error("🚨 Error running Generate Daily Report job: ", error?.message);
    }
}

async function setupMissingOrders() {
    try {
        await sendMessageToChannel('⌛️ Executing Setup Missing Orders Job');

        await kiteSession.authenticate();

        // Get current positions and orders
        const positions = await kiteSession.kc.getPositions();
        const orders = await kiteSession.kc.getOrders();
        const openPositions = positions.net.filter(position => (position.quantity || 0) != 0);

        // Get sheet data for reference
        let stockData = await readSheetData('MIS-ALPHA!A2:W10000');
        stockData = processMISSheetData(stockData);

        console.log(stockData)

        for (const position of openPositions) {
            try {
                // Find corresponding stock data from sheet
                const stock = stockData.find(s => s.stockSymbol === position.tradingsymbol);
                if (!stock) {
                    await sendMessageToChannel('⚠️ No sheet data found for position:', position.tradingsymbol);
                    continue;
                }

                // Check existing orders for this position
                const existingOrders = orders.filter(o => 
                    o.tradingsymbol === position.tradingsymbol && 
                    (o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
                );

                const hasStoploss = existingOrders.some(o => o.tag?.includes('stoploss'));
                const hasTarget = existingOrders.some(o => o.tag?.includes('target'));

                // Position is bullish (long)
                if (position.quantity > 0) {
                    if (!hasStoploss) {
                        await placeOrder('SELL', 'SL-M', stock.stopLossPrice, position.quantity, stock, 'stoploss-missing');
                    }
                    if (!hasTarget) {
                        await placeOrder('SELL', 'LIMIT', stock.targetPrice, position.quantity, stock, 'target-missing');
                    }
                }
                // Position is bearish (short)
                else {
                    if (!hasStoploss) {
                        await placeOrder('BUY', 'SL-M', stock.stopLossPrice, Math.abs(position.quantity), stock, 'stoploss-missing');
                    }
                    if (!hasTarget) {
                        await placeOrder('BUY', 'LIMIT', stock.targetPrice, Math.abs(position.quantity), stock, 'target-missing');
                    }
                }

            } catch (error) {
                console.error(error);
                await sendMessageToChannel('🚨 Error setting up missing orders for:', position.tradingsymbol, error?.message);
            }
        }

        await sendMessageToChannel('✅ Completed Setup Missing Orders Job');

    } catch (error) {
        await sendMessageToChannel('🚨 Error running Setup Missing Orders job', error?.message);
        console.error("🚨 Error running Setup Missing Orders job: ", error?.message);
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
    const updateStopLossJob = schedule.scheduleJob('*/15 5-9 * * 1-5', () => {
        updateStopLossOrders();
        sendMessageToChannel('⏰ Update Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ Update Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob.nextInvocation()))

    const updateStopLossJob2 = schedule.scheduleJob('15,30,45 4 * * 1-5', () => {
        updateStopLossOrders();
        sendMessageToChannel('⏰ Update Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob2.nextInvocation()));
    });
    sendMessageToChannel('⏰ Update Stop Loss Orders Job Scheduled - ', getDateStringIND(updateStopLossJob2.nextInvocation()))

    const zaireJob = schedule.scheduleJob('1,16 4 * * 1-5', () => {
        sendMessageToChannel('⏰ Zaire Scheduled - ', getDateStringIND(zaireJob.nextInvocation()));
        setupZaireOrders();
    });
    sendMessageToChannel('⏰ Zaire Scheduled - ', getDateStringIND(zaireJob.nextInvocation()));

    const zaireCancelJob = schedule.scheduleJob('15,30 4 * * 1-5', () => {
        sendMessageToChannel('⏰ Cancel Zaire Scheduled - ', getDateStringIND(zaireCancelJob.nextInvocation()));
        cancelZaireOrders();
    });
    sendMessageToChannel('⏰ Cancel Zaire Scheduled - ', getDateStringIND(zaireCancelJob.nextInvocation()));

    const zaireCloseJob = schedule.scheduleJob('10 15,30 4 * * 1-5', () => {
        sendMessageToChannel('⏰ Close Zaire Opposite Positions Scheduled - ', getDateStringIND(zaireCloseJob.nextInvocation()));
        closeZaireOppositePositions();
    });
    sendMessageToChannel('⏰ Close Zaire Opposite Positions Scheduled - ', getDateStringIND(zaireCloseJob.nextInvocation()));

    const dailyReportJob = schedule.scheduleJob('40 10 * * 1-5', () => {
        generateDailyReportF('29Nov')
        sendMessageToChannel('⏰ Daily Report Scheduled - ', getDateStringIND(dailyReportJob.nextInvocation()));
    });
    sendMessageToChannel('⏰ Daily Report Scheduled - ', getDateStringIND(dailyReportJob.nextInvocation()));
}

module.exports = {
    scheduleMISJobs,
    setupOrdersFromSheet,
    closePositions,
    updateStopLossOrders,
    validateOrdersFromSheet,
    calculateExtremePrice,
    setupSpecialOrdersFromSheet,
    setupZaireOrders,
    closeZaireOppositePositions,
    setupMissingOrders
};
