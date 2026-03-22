const { 
    getStockLoc, readSheetData, numberToExcelColumn, bulkUpdateCells, 
    getOrderLoc, processMISSheetData, appendRowsToMISD } = require("../gsheets")
const { sendMessageToChannel } = require("../slack-actions")
const { kiteSession } = require("./setup")
const OrderLog = require('../models/OrderLog');
const { getDataFromYahoo, processYahooData } = require("./utils");

const MAX_ORDER_VALUE = 200000
const MIN_ORDER_VALUE = 0

const RISK_AMOUNT = 200;

const ZAIRE_RISK_AMOUNT = 200;
const BAILEY_RISK_AMOUNT = 100;
const LIGHTYEAR_RISK_AMOUNT = 100;
const DEFAULT_RISK_AMOUNT = 100;

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
            stopLossPrice = triggerPrice - (DEFAULT_RISK_AMOUNT/quantity)
            targetPrice = triggerPrice + ((DEFAULT_RISK_AMOUNT*2)/quantity)
            if (targetPrice > upper_circuit_limit)
                targetPrice = upper_circuit_limit - 0.1
        }
        else {
            direction = 'BEARISH'
            transaction_type = 'BUY'
            stopLossPrice = triggerPrice + (DEFAULT_RISK_AMOUNT/quantity)
            targetPrice = triggerPrice - ((DEFAULT_RISK_AMOUNT*2)/quantity)
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
        // Handle failed/rejected/cancelled Baxter orders - except for SL and target orders - these can get cancelled by the system
        const isBaxterOrManual = order.tag?.includes('baxter') || order.tag?.includes('manual');
        const isSlOrTargetOrder = order.tag?.includes('sl-baxter') || order.tag?.includes('sl-manual') || order.tag?.includes('target-baxter') || order.tag?.includes('target-manual');
        if (isBaxterOrManual && !isSlOrTargetOrder && (order.status === 'REJECTED' || order.status === 'CANCELLED')) {
            try {
                const sourceLabel = order.tag?.includes('manual') ? 'manual' : 'baxter';
                await sendMessageToChannel(`❌ ${sourceLabel} order failed`, order.tradingsymbol, order.status, order.status_message || '');
                await logOrder('FAILED', 'BAXTER_ORDER_FAILED', order);
                
                // Update sheet to mark as failed
                let sheetData = await readSheetData('MIS-ALPHA!A1:W1000')
                const rowHeaders = sheetData.map(a => a[1])
                const colHeaders = sheetData[0]
                
                const [rowSym, colSym] = getStockLoc(order.tradingsymbol, 'Symbol', rowHeaders, colHeaders);
                const [rowStatus, colStatus] = getStockLoc(order.tradingsymbol, 'Status', rowHeaders, colHeaders);
                const [rowTime, colTime] = getStockLoc(order.tradingsymbol, 'Time', rowHeaders, colHeaders);
                
                const updates = [
                    {
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colSym) + String(rowSym),
                        values: [['-' + order.tradingsymbol]]
                    },
                    {
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus),
                        values: [['failed']]
                    },
                    {
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colTime) + String(rowTime),
                        values: [[+new Date()]]
                    }
                ];
                
                await bulkUpdateCells(updates);
                await sendMessageToChannel('✅ Sheet updated - Order marked as failed', order.tradingsymbol);
            } catch (error) {
                await sendMessageToChannel('💥 Error handling failed Baxter order', order.tradingsymbol, error?.message);
                console.error("💥 Error handling failed Baxter order: ", order.tradingsymbol, error?.message);
            }
            return;
        }

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

            if (order.tag?.includes('benoit')) {
                sendMessageToChannel('🔔 Benoit order executed', order.tradingsymbol, order.quantity, order.average_price, order.filled_quantity, order.product, order.order_type, order.status, order.tag)
                return
            }

            // Handle trigger orders - place SL and optional target upon trigger completion
            if (order.tag?.includes('trigger') && (order.tag?.includes('baxter') || order.tag?.includes('manual'))) {
                try {
                    const source = (stock?.source || (order.tag?.includes('manual') ? 'manual' : 'baxter')).toLowerCase();
                    const direction = order.transaction_type === 'BUY' ? 'BULLISH' : 'BEARISH';
                    const qty = Math.abs(order.filled_quantity);

                    const rawTargetPrice = stock?.targetPrice;
                    const parsedTargetPrice = Number(rawTargetPrice);
                    // Sheet parsing maps empty cells to `0`, so treat `0` as "no target configured".
                    const hasTarget = Number.isFinite(parsedTargetPrice) && parsedTargetPrice !== 0;

                    await sendMessageToChannel(
                        `${source === 'manual' ? '🎯 Manual' : '🎯 Baxter'} trigger completed, placing SL${hasTarget ? ' and target' : ''} orders`,
                        order.tradingsymbol,
                        qty,
                        order.average_price,
                    );

                    // Avoid duplicating orders if SL/Target were already placed.
                    const existingOrders = await kiteSession.kc.getOrders();

                    // Place SL-M order (if configured on sheet)
                    if (stock?.stopLossPrice) {
                        const existingSlOrder = existingOrders.find(o =>
                            o.tradingsymbol === order.tradingsymbol &&
                            o.tag?.includes(`sl-${source}`) &&
                            (o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
                        );

                        if (existingSlOrder) {
                            await sendMessageToChannel(
                                `ℹ️ ${source} SL order already exists, skipping placement`,
                                order.tradingsymbol,
                                existingSlOrder.order_id,
                            );
                        } else {
                            let slOrderResponse;
                            if (direction === 'BULLISH') {
                                slOrderResponse = await placeOrder('SELL', 'SL-M', stock.stopLossPrice, qty, stock, `sl-${source}`);
                            } else {
                                slOrderResponse = await placeOrder('BUY', 'SL-M', stock.stopLossPrice, qty, stock, `sl-${source}`);
                            }

                            await logOrder('PLACED', 'STOPLOSS_ON_TRIGGER', slOrderResponse);
                            await sendMessageToChannel(`✅ ${source === 'manual' ? 'Manual' : 'Baxter'} SL order placed`, order.tradingsymbol, qty, stock.stopLossPrice, direction);
                        }
                    } else {
                        await sendMessageToChannel(`⚠️ Cannot place SL for ${source} - SL price missing`, order.tradingsymbol);
                    }

                    // Place target LIMIT order (if configured on sheet)
                    if (hasTarget) {
                        // Validate and clamp to circuit limits to avoid invalid prices.
                        let targetPrice = parsedTargetPrice;

                        const hasCircuitLimits = Number.isFinite(lower_circuit_limit) && Number.isFinite(upper_circuit_limit);
                        if (!hasCircuitLimits) {
                            await sendMessageToChannel(
                                `⚠️ Cannot place target for ${source} - missing circuit limits`,
                                order.tradingsymbol
                            );
                        } else {
                            if (targetPrice > upper_circuit_limit) {
                                const old = targetPrice;
                                targetPrice = upper_circuit_limit - 0.1;
                                await sendMessageToChannel('🚪 Target adjusted based on circuit limit', order.tradingsymbol, old, targetPrice);
                            }
                            if (targetPrice < lower_circuit_limit) {
                                const old = targetPrice;
                                targetPrice = lower_circuit_limit + 0.1;
                                await sendMessageToChannel('🚪 Target adjusted based on circuit limit', order.tradingsymbol, old, targetPrice);
                            }

                            // Final sanity check
                            if (targetPrice < lower_circuit_limit || targetPrice > upper_circuit_limit) {
                                await sendMessageToChannel(
                                    `🚫 Target price still out of circuit for ${source}, skipping target placement`,
                                    order.tradingsymbol,
                                    targetPrice,
                                    `LCL:${lower_circuit_limit}`,
                                    `UCL:${upper_circuit_limit}`
                                );
                            } else {
                                const existingTargetOrder = existingOrders.find(o =>
                                    o.tradingsymbol === order.tradingsymbol &&
                                    o.tag?.includes(`target-${source}`) &&
                                    (o.status === 'OPEN' || o.status === 'TRIGGER PENDING')
                                );

                                if (existingTargetOrder) {
                                    await sendMessageToChannel(
                                        `ℹ️ ${source} target order already exists, skipping placement`,
                                        order.tradingsymbol,
                                        existingTargetOrder.order_id,
                                    );
                                } else {
                                    const targetTransactionType = direction === 'BULLISH' ? 'SELL' : 'BUY';
                                    const targetOrderResponse = await placeOrder(
                                        targetTransactionType,
                                        'LIMIT',
                                        targetPrice,
                                        qty,
                                        stock,
                                        `target-${source}`,
                                    );
                                    await logOrder('PLACED', 'TARGET_ON_TRIGGER', targetOrderResponse);
                                    await sendMessageToChannel(
                                        `✅ ${source === 'manual' ? 'Manual' : 'Baxter'} target order placed`,
                                        order.tradingsymbol,
                                        qty,
                                        targetPrice,
                                        direction
                                    );
                                }
                            }
                        }

                        // Note: existingTargetOrder/placement handled only when circuit limits are valid.
                    }

                    // Update sheet status to triggered
                    try {
                        let sheetData = await readSheetData('MIS-ALPHA!A1:W1000')
                        const rowHeaders = sheetData.map(a => a[1])
                        const colHeaders = sheetData[0]

                        const [rowStatus, colStatus] = getStockLoc(order.tradingsymbol, 'Status', rowHeaders, colHeaders)
                        const [rowTime, colTime] = getStockLoc(order.tradingsymbol, 'Time', rowHeaders, colHeaders)

                        const updates = [
                            {
                                range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus),
                                values: [['triggered']],
                            },
                            {
                                range: 'MIS-ALPHA!' + numberToExcelColumn(colTime) + String(rowTime),
                                values: [[+new Date()]],
                            }
                        ];

                        await bulkUpdateCells(updates);
                    } catch (sheetError) {
                        await sendMessageToChannel(`⚠️ Failed to update sheet for ${source} trigger`, order.tradingsymbol, sheetError?.message);
                    }
                } catch (error) {
                    await sendMessageToChannel(`💥 Error placing ${source} SL/Target orders`, order.tradingsymbol, error?.message);
                    console.error(`💥 Error placing ${source} SL/Target orders: `, order.tradingsymbol, error?.message);
                }
                return; // Don't process further for trigger orders
            }

            // Handle target orders - cancel SL when target completes
            if ((order.tag?.includes('target-baxter') || order.tag?.includes('target-manual')) && (order.tag?.includes('baxter') || order.tag?.includes('manual'))) {
                try {
                    const source = order.tag?.includes('target-manual') ? 'manual' : 'baxter';
                    await sendMessageToChannel(`🎯 ${source} target executed`, order.tradingsymbol, order.filled_quantity, order.average_price);

                    // Cancel SL-M if it's still pending
                    try {
                        const existingOrders = await kiteSession.kc.getOrders();
                        const existingSlOrder = existingOrders.find(o =>
                            o.tradingsymbol === order.tradingsymbol &&
                            o.tag?.includes(`sl-${source}`) &&
                            (o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
                        );

                        if (existingSlOrder) {
                            await kiteSession.kc.cancelOrder("regular", existingSlOrder.order_id);
                            await logOrder('CANCELLED', 'PROCESS SUCCESS', existingSlOrder);
                            await sendMessageToChannel(`ℹ️ Cancelled ${source} SL after target execution`, order.tradingsymbol);
                        }
                    } catch (cancelError) {
                        await sendMessageToChannel(`⚠️ Failed to cancel ${source} SL after target execution`, order.tradingsymbol, cancelError?.message);
                    }

                    // Update sheet status to stopped
                    try {
                        let sheetData = await readSheetData('MIS-ALPHA!A1:W1000')
                        const rowHeaders = sheetData.map(a => a[1])
                        const colHeaders = sheetData[0]

                        const [rowStatus, colStatus] = getStockLoc(order.tradingsymbol, 'Status', rowHeaders, colHeaders)
                        const [rowTime, colTime] = getStockLoc(order.tradingsymbol, 'Time', rowHeaders, colHeaders)
                        const [rowLastAction, colLastAction] = getStockLoc(order.tradingsymbol, 'Last Action', rowHeaders, colHeaders)

                        const updates = [
                            {
                                range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus),
                                values: [['stopped']],
                            },
                            {
                                range: 'MIS-ALPHA!' + numberToExcelColumn(colTime) + String(rowTime),
                                values: [[+new Date()]],
                            },
                            {
                                range: 'MIS-ALPHA!' + numberToExcelColumn(colLastAction) + String(rowLastAction),
                                values: [[order.transaction_type + '-' + order.average_price]],
                            }
                        ];

                        await bulkUpdateCells(updates);
                        await sendMessageToChannel(`✅ Sheet updated - ${source} target position stopped`, order.tradingsymbol);
                    } catch (sheetError) {
                        await sendMessageToChannel(`⚠️ Failed to update sheet for ${source} target`, order.tradingsymbol, sheetError?.message);
                    }
                } catch (error) {
                    await sendMessageToChannel(`💥 Error handling ${source} target execution`, order.tradingsymbol, error?.message);
                    console.error(`💥 Error handling ${source} target execution: `, order.tradingsymbol, error?.message);
                }
                return; // Don't process further for target orders
            }

            // Handle SL orders - update sheet when stop loss executes
            if ((order.tag?.includes('sl-baxter') || order.tag?.includes('sl-manual')) && (order.tag?.includes('baxter') || order.tag?.includes('manual'))) {
                try {
                    const source = order.tag?.includes('sl-manual') ? 'manual' : 'baxter';
                    await sendMessageToChannel(`🛑 ${source} SL executed`, order.tradingsymbol, order.filled_quantity, order.average_price);
                    // await logOrder('COMPLETED', 'BAXTER_STOPLOSS_HIT', order);
                    
                    // Update sheet status to stopped
                    try {
                        let sheetData = await readSheetData('MIS-ALPHA!A1:W1000')
                        const rowHeaders = sheetData.map(a => a[1])
                        const colHeaders = sheetData[0]
                        
                        const [rowStatus, colStatus] = getStockLoc(order.tradingsymbol, 'Status', rowHeaders, colHeaders)
                        const [rowTime, colTime] = getStockLoc(order.tradingsymbol, 'Time', rowHeaders, colHeaders)
                        const [rowLastAction, colLastAction] = getStockLoc(order.tradingsymbol, 'Last Action', rowHeaders, colHeaders)
                        
                        const updates = [
                            {
                                range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus), 
                                values: [['stopped']], 
                            },
                            {
                                range: 'MIS-ALPHA!' + numberToExcelColumn(colTime) + String(rowTime), 
                                values: [[+new Date()]], 
                            },
                            {
                                range: 'MIS-ALPHA!' + numberToExcelColumn(colLastAction) + String(rowLastAction), 
                                values: [[order.transaction_type + '-' + order.average_price]], 
                            }
                        ];
                        
                        await bulkUpdateCells(updates);
                        await sendMessageToChannel(`✅ Sheet updated - ${source} position stopped`, order.tradingsymbol);
                    } catch (sheetError) {
                        await sendMessageToChannel(`⚠️ Failed to update sheet for ${source} SL`, order.tradingsymbol, sheetError?.message);
                    }

                    // Cancel target LIMIT order if it's still pending
                    try {
                        const existingOrders = await kiteSession.kc.getOrders();
                        const existingTargetOrder = existingOrders.find(o =>
                            o.tradingsymbol === order.tradingsymbol &&
                            o.tag?.includes(`target-${source}`) &&
                            (o.status === 'OPEN' || o.status === 'TRIGGER PENDING')
                        );

                        if (existingTargetOrder) {
                            await kiteSession.kc.cancelOrder("regular", existingTargetOrder.order_id);
                            await logOrder('CANCELLED', 'PROCESS SUCCESS', existingTargetOrder);
                            await sendMessageToChannel(`ℹ️ Cancelled ${source} target after SL execution`, order.tradingsymbol);
                        }
                    } catch (cancelError) {
                        await sendMessageToChannel(`⚠️ Failed to cancel ${source} target after SL execution`, order.tradingsymbol, cancelError?.message);
                    }
                } catch (error) {
                    const source = order.tag?.includes('sl-manual') ? 'manual' : 'baxter';
                    await sendMessageToChannel(`💥 Error handling ${source} SL execution`, order.tradingsymbol, error?.message);
                    console.error(`💥 Error handling ${source} SL execution: `, order.tradingsymbol, error?.message);
                }
                return; // Don't process further for SL orders
            }

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

const capitalize = (val) => String(val).charAt(0).toUpperCase() + String(val).slice(1);

const RATIO = '2:1'

async function createZaireOrders(stock, tag='zaire') {
    try {

        if (tag == 'lightyear') {
            tag = 'lgy'
        }

        const SOURCE_RISK_AMOUNT = tag == 'zaire' ? ZAIRE_RISK_AMOUNT : tag == 'bailey' ? BAILEY_RISK_AMOUNT : tag == 'lgy' ? LIGHTYEAR_RISK_AMOUNT : DEFAULT_RISK_AMOUNT
        const source = capitalize(tag)

        await kiteSession.authenticate();

        let triggerPrice, stopLossPrice, targetPrice, quantity, orderResponse;

        const sheetEntry = {
            stockSymbol: stock.sym,
            reviseSL: '',
            ignore: true,    // '' = false
            status: 'new',    // '' = false
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
        
        const candleLength = stock.high - stock.low

        const [reward, risk] = RATIO.split(':').map(Number)

        if (stock.direction === 'BULLISH') {
            // Trigger price is 0.05% above high
            triggerPrice = stock.high + triggerPadding;
            // Stop loss is low
            stopLossPrice = stock.low - (candleLength * (risk-1)) + triggerPadding;
            // Target price is double the difference between high and low plus trigger price
            targetPrice = stock.high + (candleLength * reward) + triggerPadding // triggerPrice;

            // Round all values to 1 decimal place
            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;
            targetPrice = Math.round(targetPrice * 10) / 10;

            // Quantity is risk amount divided by difference between high and low
            quantity = Math.ceil(SOURCE_RISK_AMOUNT / (triggerPrice - stopLossPrice));
            if (quantity < 1)
                quantity = 1

            sheetEntry.quantity = stock.direction == 'BULLISH' ? quantity : -quantity
            sheetEntry.targetPrice = targetPrice
            sheetEntry.stopLossPrice = stopLossPrice
            sheetEntry.triggerPrice = triggerPrice

            await appendRowsToMISD([sheetEntry], source)

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
            stopLossPrice = stock.high + (candleLength * (risk-1)) - triggerPadding;
            // Target price is double the difference between trigger price and low
            targetPrice = stock.low - (candleLength * reward) - triggerPadding

            // Round all values to 1 decimal place
            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;
            targetPrice = Math.round(targetPrice * 10) / 10;

            // Quantity is risk amount divided by difference between high and low
            quantity = Math.ceil(SOURCE_RISK_AMOUNT / (stopLossPrice - triggerPrice));
            if (quantity < 1)
                quantity = 1

            sheetEntry.quantity = stock.direction == 'BULLISH' ? quantity : -quantity
            sheetEntry.targetPrice = targetPrice
            sheetEntry.stopLossPrice = stopLossPrice
            sheetEntry.triggerPrice = triggerPrice

            await appendRowsToMISD([sheetEntry], source)

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
        tradingsymbol: stock.sym || stock.stockSymbol || stock.tradingsymbol || stock.symbol,
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

        let source = 'CO'

        if (stock.source.toLowerCase() == 'lightyear') {
            source = 'lgy'
        }
        else if (stock.source.toLowerCase() == 'lightyear-d1') {
            source = 'lgy1'
        }

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

            orderResponse = await placeOrder(stock.type == 'BEARISH' ? "SELL" : "BUY", 'MARKET', null, stock.quantity, stock, `trigger-m-${source}`)

        }
        else {
            
            if (
                (stock.type == 'BEARISH' && ltp < stock.triggerPrice) ||
                (stock.type == 'BULLISH' && ltp > stock.triggerPrice)
            ) {
                if (shouldPlaceMarketOrder(ltp, stock.triggerPrice, stock.targetPrice, stock.type)) {
                    orderResponse = await placeOrder(stock.type == 'BEARISH' ? "SELL" : "BUY", "MARKET", null, stock.quantity, stock, `trigger-mk-${source}`)
                }
                else {
                    return sendMessageToChannel('🔔 Sheet: SELL order not placed: LTP too close to target price', stock.stockSymbol, stock.quantity, stock.targetPrice, ltp)
                }
            }
            else {
                orderResponse = await placeOrder(stock.type == 'BEARISH' ? "SELL" : "BUY", 'SL-M', stock.triggerPrice, stock.quantity, stock, `trigger-${source}`);
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
