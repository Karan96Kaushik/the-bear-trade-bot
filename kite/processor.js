const { getStockLoc, readSheetData, numberToExcelColumn, bulkUpdateCells, getOrderLoc, processMISSheetData, appendRowsToMISD } = require("../gsheets")
const { sendMessageToChannel } = require("../slack-actions")
const { kiteSession } = require("./setup")
const OrderLog = require('../models/OrderLog');
const { getDataFromYahoo, processYahooData } = require("./utils");

const MAX_ORDER_VALUE = 200000
const MIN_ORDER_VALUE = 0
const RISK_AMOUNT = 100;

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

    let slPrice = stock.stopLossPrice
    let quote = await kiteSession.kc.getQuote([`NSE:${stock.stockSymbol}`]) 
    let upper_circuit_limit = quote[`NSE:${stock.stockSymbol}`]?.upper_circuit_limit
    let lower_circuit_limit = quote[`NSE:${stock.stockSymbol}`]?.lower_circuit_limit
    if (!slPrice)
        if (stock.triggerPrice == 'mkt') {
            let ltp = quote[`NSE:${stock.stockSymbol}`]?.last_price
            slPrice = Number(ltp) * 1.02
        }
        else
            slPrice = Number(stock.triggerPrice) * 1.02

    let orderResponse = await placeOrder('BUY', 'SL-M', slPrice, stock.quantity, stock, 'stoploss-CBLS')

    await logOrder('PLACED', 'CREATE BUY LIM SL', orderResponse)

    let targetPrice = stock.targetPrice
    if (stock.targetPrice > upper_circuit_limit)
        targetPrice = upper_circuit_limit - 0.1
    if (targetPrice < lower_circuit_limit)
        targetPrice = lower_circuit_limit + 0.1

    orderResponse = await placeOrder('BUY', 'LIMIT', targetPrice, stock.quantity, stock, 'target-CBLS')

    await logOrder('PLACED', 'CREATE BUY LIM SL', orderResponse)
}

const createSellLimSLOrders = async (stock, order) => {
    await kiteSession.authenticate()

    let slPrice = stock.stopLossPrice
    let quote = await kiteSession.kc.getQuote([`NSE:${stock.stockSymbol}`]) 
    let upper_circuit_limit = quote[`NSE:${stock.stockSymbol}`]?.upper_circuit_limit
    let lower_circuit_limit = quote[`NSE:${stock.stockSymbol}`]?.lower_circuit_limit
    if (!slPrice)
        if (stock.triggerPrice == 'mkt') {
            let ltp = quote[`NSE:${stock.stockSymbol}`]?.last_price
            slPrice = Number(ltp) * 0.98 
        }
        else
            slPrice = Number(stock.triggerPrice) * 0.98

    if (slPrice < lower_circuit_limit) {
        slPrice = lower_circuit_limit + 0.1
        sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.stockSymbol, stock.quantity, slPrice)
    }
    if (slPrice > upper_circuit_limit) {
        slPrice = upper_circuit_limit - 0.1
        sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.stockSymbol, stock.quantity, slPrice)
    }

    let orderResponse = await placeOrder('SELL', 'SL-M', slPrice, stock.quantity, stock, 'stoploss-CSLS')

    await logOrder('PLACED', 'CREATE SELL LIM SL', orderResponse)

    let targetPrice = stock.targetPrice
    if (targetPrice < lower_circuit_limit)
        targetPrice = lower_circuit_limit + 0.1
    if (targetPrice > upper_circuit_limit)
        targetPrice = upper_circuit_limit - 0.1

    orderResponse = await placeOrder('SELL', 'LIMIT', targetPrice, Math.abs(stock.quantity), stock, 'target-CSLS')

    await logOrder('PLACED', 'CREATE SELL LIM SL', orderResponse)
}

const setupReversalOrders = async (order) => {
    try {
        const triggerPrice = order.trigger_price || order.price
        const quantity = order.quantity
        const stockSymbol = order.tradingsymbol
        let direction, targetPrice, stopLossPrice, transaction_type

        let quote = await kiteSession.kc.getQuote([`NSE:${stockSymbol}`]) 
        let upper_circuit_limit = quote[`NSE:${stockSymbol}`]?.upper_circuit_limit
        let lower_circuit_limit = quote[`NSE:${stockSymbol}`]?.lower_circuit_limit

        if (order.transaction_type == 'BUY') {
            direction = 'BULLISH'
            transaction_type = 'SELL'
            stopLossPrice = triggerPrice - (RISK_AMOUNT/quantity)
            targetPrice = triggerPrice + ((RISK_AMOUNT*2)/quantity)
            if (targetPrice > upper_circuit_limit)
                targetPrice = upper_circuit_limit - 0.1
        }
        else {
            direction = 'BEARISH'
            transaction_type = 'BUY'
            stopLossPrice = triggerPrice + (RISK_AMOUNT/quantity)
            targetPrice = triggerPrice - ((RISK_AMOUNT*2)/quantity)
            if (targetPrice < lower_circuit_limit)
                targetPrice = lower_circuit_limit + 0.1
        }

        await placeOrder(transaction_type, 'SL-M', stopLossPrice, quantity, order, 'stoploss-RV')
        await placeOrder(transaction_type, 'LIMIT', targetPrice, quantity, order, 'target-RV')

    } catch (error) {
        await sendMessageToChannel('🚨 Error setting up reversal orders', error?.message)
        console.error('🚨 Error setting up reversal orders', error)
    }
}

const updateNameInSheetForClosedOrder = async (order) => {
    try {
        let updates = []
        let sheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = sheetData.map(a => a[1])
        const colHeaders = sheetData[0]

        const [row, col] = getStockLoc(order.tradingsymbol, 'Symbol', rowHeaders, colHeaders)

        updates.push({
            range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
            values: [['*' + order.tradingsymbol]], 
        })

        await bulkUpdateCells(updates)

    } catch (error) {
        await sendMessageToChannel('📛 Error updating sheet name! Might create issue for reentry!', order.tradingsymbol, order.quantity, order.tag, error?.message)
        console.trace(error)
    }
}

const setToIgnoreInSheet = async (order, message) => {
    try {
        let updates = []
        let sheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = sheetData.map(a => a[1])
        const colHeaders = sheetData[0]

        const [row, col] = getStockLoc(order.stockSymbol, 'Ignore', rowHeaders, colHeaders)

        updates.push({
            range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
            values: [[message]], 
        })

        await bulkUpdateCells(updates)

    } catch (error) {
        await sendMessageToChannel('📛 Error updating ignore in sheet during validation!', order.sym, order.quantity, order.tag, error?.message)
        console.trace(error)
    }
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
                order.status,
                order.tag
            )

            console.log('📬 Order update', order)

            let stockData = await readSheetData('MIS-ALPHA!A2:W1000')
            stockData = processMISSheetData(stockData)

            let stock = stockData.find(s => s.stockSymbol == order.tradingsymbol)

            let quote = await kiteSession.kc.getQuote([`NSE:${order.tradingsymbol}`])
            let ltp = quote[`NSE:${order.tradingsymbol}`]?.last_price
            let upper_circuit_limit = quote[`NSE:${order.tradingsymbol}`]?.upper_circuit_limit
            let lower_circuit_limit = quote[`NSE:${order.tradingsymbol}`]?.lower_circuit_limit

            try {
                let sheetData = await readSheetData('MIS-ALPHA!A1:W1000')
                const rowHeaders = sheetData.map(a => a[1])
                const colHeaders = sheetData[0]
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

            if (order.transaction_type == 'SELL' && stock?.type == 'BEARISH') {
                try {
                    // This is the first completed order
                    if (!stock.lastAction) {
                        await createBuyLimSLOrders(stock, order)
                    }
                } catch (error) {
                    await sendMessageToChannel('💥 Error [BEARISH] buy orders', stock.stockSymbol, stock.quantity, error?.message)
                    console.error("💥 Error [BEARISH] buy orders: ", stock.stockSymbol, stock.quantity, error?.message);
                }
            }
            else if (order.transaction_type == 'BUY' && stock?.type == 'BULLISH') {
                try {
                    // This is the first completed order
                    if (!stock.lastAction) {
                        await createSellLimSLOrders(stock, order)
                    }
                } catch (error) {
                    await sendMessageToChannel('💥 Error [BULLISH] sell orders', stock.stockSymbol, stock.quantity, error?.message)
                    console.error("💥 Error [BULLISH] sell orders: ", stock.stockSymbol, stock.quantity, error?.message);
                }
            }
            else if (order.transaction_type == 'BUY' && stock?.type == 'BEARISH' && order.placed_by !== 'ADMINSQF') {
                let allOrders = await kiteSession.kc.getOrders()
                let orders = allOrders.filter(o => o.tradingsymbol == order.tradingsymbol && (o.status == 'OPEN' || o.status == 'TRIGGER PENDING') && o.transaction_type == 'BUY')

                await kiteSession.kc.cancelOrder("regular", orders[0].order_id)
                await logOrder('CANCELLED', 'PROCESS SUCCESS', orders[0])

                await updateNameInSheetForClosedOrder(order)

                // TRUNED OFF REVERSAL LOGIC
                if (false) {
                    if (orders.length < 1 && order.tag?.includes('stoploss')) {
                        await sendMessageToChannel('⭐️ Possible reversal happening - reinitiated stoploss trade!', order.tradingsymbol, order.quantity, order.tag)
                        await setupReversalOrders(order)
                    }
                    else if (orders.length == 1 && orders[0].tag?.includes('target')) {
                        await kiteSession.kc.cancelOrder("regular", orders[0].order_id)
                        await logOrder('CANCELLED', 'PROCESS SUCCESS', orders[0])
                        // const triggerPrice = allOrders.find(o => o.tradingsymbol == order.tradingsymbol && o.transaction_type == 'SELL' && o.tag.includes('trigger'))?.trigger_price
                        // await sendMessageToChannel('🔔 Resetting trigger after stoploss hit PLEASE CHECK!', order.tradingsymbol, order.quantity, stock.triggerPrice)
                        // await placeOrder('SELL', 'LIMIT', stock.triggerPrice, stock.quantity, stock, 'trigger-r')
                    }
                }
            }            
            else if (order.transaction_type == 'SELL' && stock?.type == 'BULLISH' && order.placed_by !== 'ADMINSQF') {
                let allOrders = await kiteSession.kc.getOrders()
                let orders = allOrders.filter(o => o.tradingsymbol == order.tradingsymbol && (o.status == 'OPEN' || o.status == 'TRIGGER PENDING') && o.transaction_type == 'SELL')

                await kiteSession.kc.cancelOrder("regular", orders[0].order_id)
                await logOrder('CANCELLED', 'PROCESS SUCCESS', orders[0])

                await updateNameInSheetForClosedOrder(order)

                // TRUNED OFF REVERSAL LOGIC
                if (false) {
                    if (orders.length < 1 && order.tag?.includes('stoploss')) {
                        await sendMessageToChannel('⭐️ Possible reversal happening - reinitiated stoploss trade!', order.tradingsymbol, order.quantity, order.tag)
                        await setupReversalOrders(order)
                    }
                    else if (orders.length == 1 && orders[0].tag?.includes('target')) {
                        // Resetting trigger after stoploss hit and target not hit
                        await kiteSession.kc.cancelOrder("regular", orders[0].order_id)
                        await logOrder('CANCELLED', 'PROCESS SUCCESS', orders[0])
                        // await sendMessageToChannel('🔔 Resetting trigger after stoploss hit PLEASE CHECK!', order.tradingsymbol, order.quantity, stock.triggerPrice)
                        // await placeOrder('BUY', 'SL', stock.triggerPrice, stock.quantity, stock, 'trigger-r')
                    }
                }

            }
        }
        
    } catch (error) {
        // console.error('Error processing message', error)
        await sendMessageToChannel('📛 Error processing order update', order.tradingsymbol, order.quantity, order.tag, error?.message)
        console.trace('Error processing message', error)
    }
}

async function createZaireOrders(stock, tag='zaire') {
    try {
        await kiteSession.authenticate();

        let triggerPrice, stopLossPrice, targetPrice, quantity, orderResponse;

        const sheetEntry = {
            stockSymbol: stock.sym,
            reviseSL: true,
            ignore: true,    // '' = false
            sma44_0: stock.sma44_0,
            sma44_1: stock.sma44_1,
            sma44_2: stock.sma44_2,
            sma44_3: stock.sma44_3,
        }

        const sym = `NSE:${stock.sym}`
        let ltp = await kiteSession.kc.getQuote([sym]);
        ltp = ltp[sym]?.last_price
        if (!ltp) {
            await sendMessageToChannel('🔕 LTP not found for', stock.sym)
            return
        }

        // <20.  0.1.  :    20-50.  0.2  :  50-100     0.3. :    100- 300.   0.5.     >300    Re 1
        
        let triggerPadding = 1
        if (stock.high < 20)
            triggerPadding = 0.1
        else if (stock.high < 50)
            triggerPadding = 0.2
        else if (stock.high < 100)
            triggerPadding = 0.3
        else if (stock.high < 300)
            triggerPadding = 0.5
        
        if (stock.direction === 'BULLISH') {
            // Trigger price is 0.05% above high
            triggerPrice = stock.high + triggerPadding;
            // Stop loss is low
            stopLossPrice = stock.low - triggerPadding;
            // Target price is double the difference between high and low plus trigger price
            targetPrice = stock.high + ((triggerPrice - stopLossPrice) * 2) // triggerPrice;

            // Round all values to 1 decimal place
            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;
            targetPrice = Math.round(targetPrice * 10) / 10;

            // Quantity is risk amount divided by difference between high and low
            quantity = Math.ceil(RISK_AMOUNT / (triggerPrice - stopLossPrice));
            if (quantity < 1)
                quantity = 1

            sheetEntry.quantity = stock.direction == 'BULLISH' ? quantity : -quantity
            sheetEntry.targetPrice = targetPrice
            sheetEntry.stopLossPrice = stopLossPrice
            sheetEntry.triggerPrice = triggerPrice

            await appendRowsToMISD([sheetEntry])

            let targetGain = targetPrice - triggerPrice
        
            // Place SL-M BUY order at price higher than trigger price
            if (ltp > triggerPrice) {
                if ((targetPrice - ltp) / targetGain > 0.8)
                    orderResponse = await placeOrder('BUY', 'MARKET', null, quantity, stock, `trigger-m-${tag}`)
                else
                    return sendMessageToChannel(`🔔 ${tag.toUpperCase()}: BUY order not placed: LTP too close to target price`, stock.sym, quantity, targetPrice, ltp)
            }
            else
                orderResponse = await placeOrder('BUY', 'SL-M', triggerPrice, quantity, stock, `trigger-${tag}`);


            // Place SL-M SELL order
            // await placeOrder("SELL", "SL", sellTriggerPrice, quantity, stock);

            // Place LIMIT SELL order
            // await placeOrder("SELL", "LIMIT", limitPrice, quantity, stock);
        } else if (stock.direction === 'BEARISH') {
            // Trigger price is 0.05% below low 
            triggerPrice = stock.low - triggerPadding;
            // Stop loss is high
            stopLossPrice = stock.high + triggerPadding;
            // Target price is double the difference between trigger price and low
            targetPrice = stock.low - ((stopLossPrice - triggerPrice) * 2)

            // Round all values to 1 decimal place
            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;
            targetPrice = Math.round(targetPrice * 10) / 10;

            // Quantity is risk amount divided by difference between high and low
            quantity = Math.ceil(RISK_AMOUNT / (stopLossPrice - triggerPrice));
            if (quantity < 1)
                quantity = 1

            sheetEntry.quantity = stock.direction == 'BULLISH' ? quantity : -quantity
            sheetEntry.targetPrice = targetPrice
            sheetEntry.stopLossPrice = stopLossPrice
            sheetEntry.triggerPrice = triggerPrice

            await appendRowsToMISD([sheetEntry])

            let targetGain = triggerPrice - targetPrice
            
            // Place SELL order at price lower than trigger price
            if (ltp < triggerPrice) {
                if ((ltp - targetPrice) / targetGain > 0.8)
                    orderResponse = await placeOrder('SELL', 'MARKET', null, quantity, stock, `trigger-m-${tag}`)
                else
                    return sendMessageToChannel('🔔 Zaire: SELL order not placed: LTP too close to target price', stock.sym, quantity, targetPrice, ltp)
            }
            else {
                orderResponse = await placeOrder('SELL', 'SL-M', triggerPrice, quantity, stock, `trigger-${tag}`);
            }


            // Place SL-M BUY order
            // await placeOrder("BUY", "SL-M", buyTriggerPrice, quantity, stock);

            // // Place LIMIT BUY order
            // await placeOrder("BUY", "LIMIT", limitPrice, quantity, stock);
        } else {
            throw new Error(`Invalid direction: ${stock.direction}`);
        }
        
        await logOrder('PLACED', tag.toUpperCase(), orderResponse)

        return sheetEntry

    } catch (error) {
        await sendMessageToChannel('🚨 Error running Zaire MIS Jobs', stock.sym, error?.message);
        console.error("🚨 Error running Zaire MIS Jobs: ", stock.sym, error?.message);
        await logOrder('FAILED - PLACE', 'ZAIRE', {tradingsymbol: stock.sym, error: error?.message, ...stock})
        // throw error;
    }
}

// Helper function to place orders
async function placeOrder(transactionType, orderType, price, quantity, stock, initiatedBy='-') {
    const order = {
        exchange: "NSE",
        tradingsymbol: stock.sym || stock.stockSymbol || stock.tradingsymbol,
        transaction_type: transactionType,
        quantity: Math.abs(parseInt(quantity)),
        order_type: orderType,
        product: "MIS",
        validity: "DAY",
        tag: initiatedBy,
    };

    if ( orderType === "SL-M") {
        order.trigger_price = Math.round(price * 20) / 20;
    }
    else if (orderType === "SL") {
        order.trigger_price = Math.round(price * 20) / 20;
        order.price = Math.round(price * 20) / 20;
    }
    else if (orderType === "LIMIT") {
        order.price = Math.round(price * 20) / 20;
    }

    const orderResponse = await kiteSession.kc.placeOrder("regular", order);
    await sendMessageToChannel(`✅ ${initiatedBy}: Placed ${orderType} ${transactionType} order`, stock.sym || stock.stockSymbol || stock.tradingsymbol, quantity, price);

    return {...orderResponse, ...order}
}

const shouldPlaceMarketOrder = (ltp, triggerPrice, targetPrice, direction) => {
    const targetGain = direction === 'BULLISH' 
        ? targetPrice - triggerPrice
        : triggerPrice - targetPrice;

    if (direction === 'BULLISH') {
        return ltp > triggerPrice && ((targetPrice - ltp) / targetGain > 0.8);
    } else {
        return ltp < triggerPrice && ((ltp - targetPrice) / targetGain > 0.8);
    }
}

const createOrders = async (stock) => {
    try {
        if (stock.ignore)
            return console.log('IGNORING', stock.stockSymbol)

        if (stock.lastAction?.length > 1)
            return console.log('ACTION ALREADY PLACED', stock.stockSymbol, stock.lastAction)

        await kiteSession.authenticate()

        const sym = `NSE:${stock.stockSymbol}`
        let ltp = await kiteSession.kc.getQuote([sym]);
        ltp = ltp[sym]?.last_price
        if (!ltp) {
            await sendMessageToChannel('🔕 LTP not found for', stock.stockSymbol)
            return
        }

        let order_value = Number(stock.quantity) * Number(ltp)

        if (order_value > MAX_ORDER_VALUE || order_value < MIN_ORDER_VALUE)
            throw new Error(`Order value ${order_value} not within limits!`)

        // if (stock.type == 'BEARISH' && Number(stock.triggerPrice) > ltp) {
        //     await sendMessageToChannel('🔔 Cannot place trigger sell order: LTP lower than Sell Price.', stock.stockSymbol, stock.quantity, "Sell Price:", stock.triggerPrice, 'LTP: ', ltp)
        //     return
        // }
        // if (stock.type == 'BULLISH' && Number(stock.triggerPrice) < ltp) {
        //     await sendMessageToChannel('🔔 Cannot place trigger buy order: LTP higher than Trigger Price.', stock.stockSymbol, stock.quantity, "Trigger Price:", stock.triggerPrice, 'LTP: ', ltp)
        //     return
        // }

        let orderResponse;
        if (stock.triggerPrice == 'mkt') {

            if (stock.type == 'BULLISH') {
                if (ltp > stock.targetPrice || ltp < stock.stopLossPrice) {
                    await sendMessageToChannel('🔔 Sheet: BUY order not placed: LTP too close to target or stoploss price', stock.stockSymbol, stock.quantity, stock.targetPrice, stock.stopLossPrice, 'LTP:', ltp)
                    return
                }
            }
            else if (stock.type == 'BEARISH') {
                if (ltp < stock.targetPrice || ltp > stock.stopLossPrice) {
                    await sendMessageToChannel('🔔 Sheet: SELL order not placed: LTP too close to target or stoploss price', stock.stockSymbol, stock.quantity, stock.targetPrice, stock.stopLossPrice, 'LTP:', ltp)
                    return
                }
            }

            orderResponse = await placeOrder(stock.type == 'BEARISH' ? "SELL" : "BUY", 'MARKET', null, stock.quantity, stock, 'trigger-m-CO')

        }
        else {
            
            if (
                (stock.type == 'BEARISH' && ltp < stock.triggerPrice) ||
                (stock.type == 'BULLISH' && ltp > stock.triggerPrice)
            ) {
                if (shouldPlaceMarketOrder(ltp, stock.triggerPrice, stock.targetPrice, stock.type)) {
                    orderResponse = await placeOrder(stock.type == 'BEARISH' ? "SELL" : "BUY", "MARKET", null, stock.quantity, stock, 'trigger-mkt-CO')
                }
                else {
                    return sendMessageToChannel('🔔 Sheet: SELL order not placed: LTP too close to target price', stock.stockSymbol, stock.quantity, stock.targetPrice, ltp)
                }
            }
            else {
                orderResponse = await placeOrder(stock.type == 'BEARISH' ? "SELL" : "BUY", 'SL-M', stock.triggerPrice, stock.quantity, stock, 'trigger-CO');
            }

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
    createZaireOrders,
    placeOrder,
    logOrder,
    updateNameInSheetForClosedOrder,
    setToIgnoreInSheet
}
