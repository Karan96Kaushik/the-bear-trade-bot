const { getStockLoc, readSheetData, numberToExcelColumn, bulkUpdateCells, getOrderLoc, processMISSheetData, appendRowsToMISD } = require("../gsheets")
const { sendMessageToChannel } = require("../slack-actions")
const { kiteSession } = require("./setup")
const OrderLog = require('../models/OrderLog');
const { getDataFromYahoo, processYahooData } = require("./utils");

const MAX_ORDER_VALUE = 200000
const MIN_ORDER_VALUE = 0
const RISK_AMOUNT = 200;

// Add this helper function near the top of the file
const logOrder = async (status, initiator, orderResponse) => {
    try {
        await OrderLog.create({
            bear_status: status,
            initiated_by: initiator,
            ...orderResponse
        });
    } catch (error) {
        await sendMessageToChannel(`❌ Error logging ${initiator}`, error?.message)
        console.error(`Error logging ${initiator}`, error)
    }
}

const createBuyLimSLOrders = async (stock, order) => {
    await kiteSession.authenticate()

    let orderResponse = await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol,
        transaction_type: "BUY",
        quantity: stock.quantity,
        order_type: "SL-M",    // Stop Loss Market
        product: "MIS",        // Intraday
        validity: "DAY",
        trigger_price: Number(stock.stopLossPrice),  // Stop-loss trigger price
        // guid: 'x' + stock.id + 'xSL' + (order.order_type == 'MANUAL' ? 'man' : ''),
    });
    await sendMessageToChannel('✅ Successfully placed SL-M buy order', stock.stockSymbol, stock.quantity)

    await logOrder('PLACED', 'CREATE BUY LIM SL', orderResponse)

    orderResponse = await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol,
        transaction_type: "BUY",
        quantity: Math.abs(stock.quantity),
        order_type: "LIMIT",    // Stop Loss Market
        product: "MIS",        // Intraday
        validity: "DAY",
        price: Number(stock.targetPrice),  // Stop-loss trigger price
        // guid: 'x' + stock.id + 'xLIM' + (order.order_type == 'MANUAL' ? 'man' : ''),
        // price: stock.targetPrice  // Stop-loss trigger price
    });
    await sendMessageToChannel('✅ Successfully placed LIMIT buy order', stock.stockSymbol, stock.quantity)

    await logOrder('PLACED', 'CREATE BUY LIM SL', orderResponse)
}

const createSellLimSLOrders = async (stock, order) => {
    await kiteSession.authenticate()

    let orderResponse = await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol,
        transaction_type: "SELL",
        quantity: stock.quantity,
        order_type: "SL-M",    // Stop Loss Market
        product: "MIS",        // Intraday
        validity: "DAY",
        trigger_price: Number(stock.stopLossPrice),  // Stop-loss trigger price
        // guid: 'x' + stock.id + 'xSL' + (order.order_type == 'MANUAL' ? 'man' : ''),
    });
    await sendMessageToChannel('✅ Successfully placed SL-M buy order', stock.stockSymbol, stock.quantity)

    await logOrder('PLACED', 'CREATE SELL LIM SL', orderResponse)

    orderResponse = await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol,
        transaction_type: "SELL",
        quantity: Math.abs(stock.quantity),
        order_type: "LIMIT",    // Stop Loss Market
        product: "MIS",        // Intraday
        validity: "DAY",
        price: Number(stock.targetPrice),  // Stop-loss trigger price
        // guid: 'x' + stock.id + 'xLIM' + (order.order_type == 'MANUAL' ? 'man' : ''),
        // price: stock.targetPrice  // Stop-loss trigger price
    });
    await sendMessageToChannel('✅ Successfully placed LIMIT buy order', stock.stockSymbol, stock.quantity)

    await logOrder('PLACED', 'CREATE SELL LIM SL', orderResponse)
}

const processSuccessfulOrder = async (order) => {
    try {
        if (order.product == 'MIS' && order.status == 'COMPLETE') {

            await logOrder('COMPLETED', 'PROCESS SUCCESS', order)

            await sendMessageToChannel('📬 Order update', 
                order.transaction_type, 
                order.tradingsymbol, 
                order.average_price, 
                order.filled_quantity, 
                order.product, 
                order.order_type, 
                order.status
            )

            console.log('📬 Order update', order)

            try {
                let stockData = await readSheetData('MIS-ALPHA!A1:W100')
                const rowHeaders = stockData.map(a => a[1])
                const colHeaders = stockData[0]
                const [row, col] = getStockLoc(order.tradingsymbol, 'Last Action', rowHeaders, colHeaders)
    
                const updates = [
                    {
                        range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
                        values: [[order.transaction_type + '-' + order.average_price]], 
                    },
                ];
        
                await bulkUpdateCells(updates)
            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🛑 Error updating sheet!', error.message)
            }

            let stockData = await readSheetData('MIS-ALPHA!A2:W100')
            stockData = processMISSheetData(stockData)

            let stock = stockData.find(s => s.stockSymbol == order.tradingsymbol)

            if (order.transaction_type == 'SELL' && stock?.type == 'DOWN') {
                try {
                    if (stock.lastAction.includes('SELL')) {
                        await createBuyLimSLOrders(stock, order)
                    }
                } catch (error) {
                    await sendMessageToChannel('💥 Error [DOWN] buy orders', stock.stockSymbol, stock.quantity, error?.message)
                    console.error("💥 Error [DOWN] buy orders: ", stock.stockSymbol, stock.quantity, error?.message);
                }
            }

            if (order.transaction_type == 'BUY' && stock?.type == 'UP') {
                try {
                    if (stock.lastAction.includes('BUY')) {
                        await createSellLimSLOrders(stock, order)
                    }
                } catch (error) {
                    await sendMessageToChannel('💥 Error [UP] sell orders', stock.stockSymbol, stock.quantity, error?.message)
                    console.error("💥 Error [UP] sell orders: ", stock.stockSymbol, stock.quantity, error?.message);
                }
            }
            else if (order.transaction_type == 'BUY' && stock?.type == 'DOWN' && order.placed_by !== 'ADMINSQF') {
                // Closing opposite end order
                let orders = await kiteSession.kc.getOrders()
                orders = orders.filter(o => o.tradingsymbol == order.tradingsymbol && o.status == 'OPEN' && o.transaction_type == 'BUY')

                if (orders.length > 1)
                    await sendMessageToChannel('😱 Multiple pending buy orders found!!')
                else if (orders.length < 1)
                    await sendMessageToChannel('😱 Pending order not found!!')
                else {
                    await kiteSession.kc.cancelOrder('regular', orders[0].order_id)
                    
                    await logOrder('CANCELLED', 'PROCESS SUCCESS', order)

                    await sendMessageToChannel('📁 Closed order', order.tradingsymbol, order.order_type)
                }
            }            
            else if (order.transaction_type == 'SELL' && stock?.type == 'UP' && order.placed_by !== 'ADMINSQF') {
                // Closing opposite end order
                let orders = await kiteSession.kc.getOrders()
                orders = orders.filter(o => o.tradingsymbol == order.tradingsymbol && o.status == 'OPEN' && o.transaction_type == 'SELL')

                if (orders.length > 1)
                    await sendMessageToChannel('😱 Multiple pending buy orders found!!')
                else if (orders.length < 1)
                    await sendMessageToChannel('😱 Pending order not found!!')
                else {
                    await kiteSession.kc.cancelOrder('regular', orders[0].order_id)
                    
                    await logOrder('CANCELLED', 'PROCESS SUCCESS', order)

                    await sendMessageToChannel('📁 Closed order', order.tradingsymbol, order.order_type)
                }
            }
        }
        
    } catch (error) {
        console.error('Error processing message', error)
        await sendMessageToChannel('📛 Error processing order update', error.message)
    }
}

async function createZaireOrders(stock) {
    try {
        await kiteSession.authenticate();

        let triggerPrice, stopLossPrice, targetPrice, quantity, orderResponse;

        const sheetEntry = {
            stockSymbol: stock.sym,
            reviseSL: true,
            ignore: '',    // False
        }

        const sym = `NSE:${stock.sym}`
        let ltp = await kiteSession.kc.getLTP([sym]);
        ltp = ltp[sym].last_price

        if (stock.direction === 'UP') {
            // Trigger price is 0.05% above high
            triggerPrice = stock.high * 1.0005;
            // Stop loss is low
            stopLossPrice = stock.low;
            // Target price is double the difference between high and low plus trigger price
            targetPrice = ((stock.high - stock.low) * 2) + triggerPrice;

            // Round all values to 1 decimal place
            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;
            targetPrice = Math.round(targetPrice * 10) / 10;

            // Quantity is risk amount divided by difference between high and low
            quantity = Math.floor(RISK_AMOUNT / (triggerPrice - stopLossPrice));
            if (quantity < 1)
                quantity = 1

            sheetEntry.quantity = stock.direction == 'UP' ? quantity : -quantity
            sheetEntry.targetPrice = targetPrice
            sheetEntry.stopLossPrice = stopLossPrice
            sheetEntry.triggerPrice = triggerPrice

            await appendRowsToMISD([sheetEntry])

            let targetGain = targetPrice - triggerPrice
        
            // Place SL-M BUY order at price higher than trigger price
            if (ltp > triggerPrice) {
                if ((targetPrice - ltp) / targetGain > 0.8)
                    orderResponse = await placeOrder('BUY', 'MARKET', null, quantity, stock)
                else
                    return sendMessageToChannel('🔔 Zaire: BUY order not placed: LTP too close to target price', stock.sym, quantity, targetPrice, ltp)
            }
            else
                orderResponse = await placeOrder('BUY', 'SL-M', triggerPrice, quantity, stock);


            // Place SL-M SELL order
            // await placeOrder("SELL", "SL-M", sellTriggerPrice, quantity, stock);

            // Place LIMIT SELL order
            // await placeOrder("SELL", "LIMIT", limitPrice, quantity, stock);
        } else if (stock.direction === 'DOWN') {
            // Trigger price is 0.05% below low 
            triggerPrice = stock.low * 0.9995;
            // Stop loss is high
            stopLossPrice = stock.high;
            // Target price is double the difference between trigger price and low
            targetPrice = ((triggerPrice - (stock.high - stock.low)) * 2);

            // Round all values to 1 decimal place
            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;
            targetPrice = Math.round(targetPrice * 10) / 10;

            // Quantity is risk amount divided by difference between high and low
            quantity = Math.floor(RISK_AMOUNT / (stopLossPrice - triggerPrice));
            if (quantity < 1)
                quantity = 1

            sheetEntry.quantity = stock.direction == 'UP' ? quantity : -quantity
            sheetEntry.targetPrice = targetPrice
            sheetEntry.stopLossPrice = stopLossPrice
            sheetEntry.triggerPrice = triggerPrice

            await appendRowsToMISD([sheetEntry])

            let targetGain = triggerPrice - targetPrice
            
            // Place SELL order at price lower than trigger price
            if (ltp < triggerPrice) {
                if ((ltp - targetPrice) / targetGain > 0.8)
                    orderResponse = await placeOrder('SELL', 'MARKET', null, quantity, stock)
                else
                    return sendMessageToChannel('🔔 Zaire: SELL order not placed: LTP too close to target price', stock.sym, quantity, targetPrice, ltp)
            }
            else {
                orderResponse = await placeOrder('SELL', 'SL-M', triggerPrice, quantity, stock);
            }


            // Place SL-M BUY order
            // await placeOrder("BUY", "SL-M", buyTriggerPrice, quantity, stock);

            // // Place LIMIT BUY order
            // await placeOrder("BUY", "LIMIT", limitPrice, quantity, stock);
        } else {
            throw new Error(`Invalid direction: ${stock.direction}`);
        }
        
        await logOrder('PLACED', 'ZAIRE', orderResponse)

        return sheetEntry

    } catch (error) {
        await sendMessageToChannel('🚨 Error running Zaire MIS Jobs', stock.sym, error?.message);
        console.error("🚨 Error running Zaire MIS Jobs: ", stock.sym, error?.message);
        await logOrder('FAILED - PLACE', 'ZAIRE', {tradingsymbol: stock.sym, error: error?.message, ...stock})
        // throw error;
    }
}

// Helper function to place orders
async function placeOrder(transactionType, orderType, price, quantity, stock) {
    const order = {
        exchange: "NSE",
        tradingsymbol: stock.sym,
        transaction_type: transactionType,
        quantity: quantity,
        order_type: orderType,
        product: "MIS",
        validity: "DAY",
    };

    if (orderType === "SL-M") {
        order.trigger_price = price;
    } else if (orderType === "LIMIT") {
        order.price = price;
    }

    const orderResponse = await kiteSession.kc.placeOrder("regular", order);
    await sendMessageToChannel(`✅ Zaire: Placed ${orderType} ${transactionType} order`, stock.sym, quantity, price);

    return orderResponse
}

async function createSpecialOrders(stock) {
    const sym = `NSE:${stock}`;
    const startTime = new Date().setHours(0, 0, 0, 0) / 1000;
    const endTime = new Date() / 1000;
    const data = await getDataFromYahoo(sym, 1, '1m', startTime, endTime);
    let candles = processYahooData(data)

    // Add moving average
    candles = addMovingAverage(candles, 'close', 44, 'sma44');

    // Get the 4:01 candle
    const targetTime = new Date().setHours(16, 1, 0, 0) / 1000;
    const firstCandleIndex = timestamps.findIndex(t => t >= targetTime);
    const firstCandle = candles[firstCandleIndex];

    if (!firstCandle) {
        throw new Error('First candle not found');
    }

    // Check conditions
    if (firstCandle.close <= firstCandle.open) {
        throw new Error('First candle is not green');
    }

    const priceDifference = (firstCandle.close - firstCandle.open) / firstCandle.open;
    if (priceDifference < 0.01 || priceDifference > 0.05) {
        throw new Error('Price difference not between 1-5%');
    }

    if (firstCandle.low > firstCandle.sma44 || firstCandle.high < firstCandle.sma44 * 0.99) {
        throw new Error('Candle not on or slightly above 44 MA');
    }

    // Calculate order details
    const targetBuyPrice = firstCandle.high * 1.002;
    const stopLossPrice = firstCandle.low;
    const quantity = Math.floor(1000 / (firstCandle.high - firstCandle.low));
    const targetSellPrice = (firstCandle.high - firstCandle.low) * 2 + targetBuyPrice;

    // Place the order
    const orderResponse = await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol,
        transaction_type: "BUY",
        quantity: quantity,
        order_type: "SL-M",
        product: "MIS",
        validity: "DAY",
        trigger_price: targetBuyPrice,
    });

    await sendMessageToChannel('✅ Successfully placed Special SL-M BUY order', stock.stockSymbol, quantity, targetBuyPrice);

    await logOrder('PLACED', 'SPECIAL', orderResponse)

    // Schedule order cancellation
    const cancelTime = new Date().setHours(16, 16, 0, 0);
    setTimeout(async () => {
        try {
            await kiteSession.kc.cancelOrder("regular", orderResponse.order_id);
            await sendMessageToChannel('🚫 Cancelled unfilled Special BUY order', stock.stockSymbol);
        } catch (error) {
            console.error('Error cancelling order:', error);
        }
    }, cancelTime - Date.now());

    return orderResponse;
}

const createOrders = async (stock) => {
    try {
        if (stock.ignore)
            return console.log('IGNORING', stock.stockSymbol)
        if (stock.lastAction?.length > 1)
            return console.log('ACTION ALREADY PLACED', stock.stockSymbol, stock.lastAction)

        await kiteSession.authenticate()

        const sym = `NSE:${stock.stockSymbol}`
        let ltp = await kiteSession.kc.getLTP([sym]);
        ltp = ltp[sym].last_price
        let order_value = Number(stock.quantity) * Number(ltp)

        if (order_value > MAX_ORDER_VALUE || order_value < MIN_ORDER_VALUE)
            throw new Error(`Order value ${order_value} not within limits!`)

        if (stock.type == 'DOWN' && Number(stock.triggerPrice) > ltp) {
            await sendMessageToChannel('🔔 Cannot place target sell order: LTP lower than Sell Price.', stock.stockSymbol, stock.quantity, "Sell Price:", stock.triggerPrice, 'LTP: ', ltp)
            return
        }
        if (stock.type == 'UP' && Number(stock.triggerPrice) < ltp) {
            await sendMessageToChannel('🔔 Cannot place target buy order: LTP higher than Trigger Price.', stock.stockSymbol, stock.quantity, "Trigger Price:", stock.triggerPrice, 'LTP: ', ltp)
            return
        }

        let orderResponse;
        if (stock.triggerPrice == 'mkt') {
            orderResponse = await kiteSession.kc.placeOrder("regular", {
                exchange: "NSE",
                tradingsymbol: stock.stockSymbol,
                transaction_type: stock.type == "DOWN" ? "SELL" : "BUY",
                quantity: Number(stock.quantity),
                order_type: "MARKET",
                product: "MIS",
                validity: "DAY"
            });
            await sendMessageToChannel('✅ Successfully placed Market SELL order', stock.stockSymbol, stock.quantity)
        }
        else {
            orderResponse = await kiteSession.kc.placeOrder("regular", {
                exchange: "NSE",
                tradingsymbol: stock.stockSymbol,
                transaction_type: stock.type == "DOWN" ? "SELL" : "BUY",
                quantity: Number(stock.quantity),

                order_type: "SL-M",
                trigger_price: Number(stock.triggerPrice),

                // order_type: stock.type == "DOWN" ? "SL-M" : "LIMIT",
                // ...(stock.type == "DOWN" 
                //     ? { trigger_price: Number(stock.triggerPrice) }
                //     : { price: Number(stock.triggerPrice) }
                // ),

                product: "MIS",
                validity: "DAY",
            });
            await sendMessageToChannel('✅ Successfully placed SL-M SELL order', stock.stockSymbol, stock.quantity)
        }

        await logOrder('PLACED', 'SHEET', orderResponse)

    } catch (error) {
        await sendMessageToChannel('🚨 Error placing SELL order', stock.stockSymbol, stock.quantity, stock.triggerPrice, error?.message)
        console.error("🚨 Error placing SELL order: ", stock.stockSymbol, stock.quantity, stock.triggerPrice, error?.message);
        await logOrder('FAILED - PLACE', 'SHEET', {tradingsymbol: stock.stockSymbol, quantity: stock.quantity, trigger_price: stock.triggerPrice, error: error?.message})
    }
}

module.exports = {
    processSuccessfulOrder,
    createOrders,
    createSpecialOrders,
    createZaireOrders
}
