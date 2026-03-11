const {
    logOrder, placeOrder
} = require('./processor');
const {
    kiteSession
} = require('./setup');
const { 
    getStockLoc, readSheetData, numberToExcelColumn, bulkUpdateCells, 
    getOrderLoc, processMISSheetData, appendRowsToMISD, processSheetWithHeaders
} = require("../gsheets");
const { sendMessageToChannel } = require("../slack-actions")
const { getDataFromYahoo, processYahooData, calculateExtremePrice } = require('../kite/utils');
const { scanBaxterStocks } = require("../analytics/baxter");
const { getDateStringIND } = require('../kite/utils');
const {
    logScanStart,
    logScanComplete,
    logCandleCheck,
    logOrderPlacement,
    logOrderExecution,
    logOrderCancellation,
    logStopLossUpdate,
    logStopLossHit,
    logPositionCheck,
    logError,
    logScanDetails
} = require("../analytics/baxterLiveLogger");


const BAXTER_RISK_AMOUNT = 200;
const CANCEL_AFTER_MINUTES = 10;
const MAX_ACTIVE_ORDERS = 1;
const UPDATE_SL_INTERVAL = 15;

async function setupBaxterOrders() {
    try {
        await sendMessageToChannel(`⌛️ Executing Baxter MIS Jobs`);

        let stockListData = await readSheetData('Baxter-StockList!A1:B1000')
        stockListData = processSheetWithHeaders(stockListData);
        
        let bullishStockList = (stockListData.map(row => row.bullish).filter(s => s?.length > 0));
        let bearishStockList = (stockListData.map(row => row.bearish).filter(s => s?.length > 0));

        const totalStocks = [...bullishStockList, ...bearishStockList].filter(Boolean);
        logScanStart(totalStocks);

        let sheetData = await readSheetData('MIS-ALPHA!A2:W1000')
        sheetData = processMISSheetData(sheetData)

        await kiteSession.authenticate();

        let selectedStocks = [];
        let scannedStocks = [];
        
        if (bullishStockList.length > 0) {
            const { selectedStocks: bullishSelected } = await scanBaxterStocks(bullishStockList, null, '15m', true, {}, 'BULLISH');
            selectedStocks.push(...bullishSelected);
            scannedStocks.push(...bullishStockList.map(s => ({ symbol: s, direction: 'BULLISH' })));
        }
        if (bearishStockList.length > 0) {
            const { selectedStocks: bearishSelected } = await scanBaxterStocks(bearishStockList, null, '15m', true, {}, 'BEARISH');
            selectedStocks.push(...bearishSelected);
            scannedStocks.push(...bearishStockList.map(s => ({ symbol: s, direction: 'BEARISH' })));
        }

        // Log candle checks for all scanned stocks
        for (const stock of selectedStocks) {
            logCandleCheck({
                symbol: stock.sym,
                direction: stock.direction,
                scanTime: stock.time,
                high: stock.high,
                low: stock.low,
                close: stock.close,
                triggerPrice: stock.direction === 'BULLISH' ? stock.high : stock.low,
                stopLoss: stock.direction === 'BULLISH' ? stock.low : stock.high,
                selected: true,
                reason: 'Met Baxter criteria'
            });
        }

        logScanComplete(selectedStocks.length, totalStocks.length);
        
        // Log detailed scan results
        logScanDetails({
            bullishStocksScanned: bullishStockList.length,
            bearishStocksScanned: bearishStockList.length,
            totalScanned: totalStocks.length,
            selectedStocks: selectedStocks.map(s => ({
                symbol: s.sym,
                direction: s.direction,
                high: s.high,
                low: s.low,
                close: s.close
            })),
            scannedStocks: scannedStocks
        });

        const orders = await kiteSession.kc.getOrders();
        const positions = await kiteSession.kc.getPositions();

        const completed_baxter_orders = orders.filter(order => 
            order.tag?.includes('baxter') &&
            !(order.status === 'TRIGGER PENDING' || order.status === 'OPEN')
        );
        const completed_baxter_orders_symbols = completed_baxter_orders.map(o => o.tradingsymbol);

        let loggingBaxterOrders = selectedStocks.map(s => {
            delete s.data
            return s
        })

        sendMessageToChannel(`🔔 Baxter MIS Stocks: `, loggingBaxterOrders);

        if (
            sheetData.filter(s => s.status?.toLowerCase() == 'triggered' && s.source?.toLowerCase() == 'baxter' && s.stockSymbol[0] != '-' && s.stockSymbol[0] != '*').length >= MAX_ACTIVE_ORDERS
        ) {
            await sendMessageToChannel('🔔 Baxter Active positions are more than ' + MAX_ACTIVE_ORDERS)
            return
        }

        const allStocks = [...selectedStocks]

        for (const stock of allStocks) {
            try {
                if (
                    positions.net.find(p => p.tradingsymbol === stock.sym)
                ) {
                    await sendMessageToChannel('🔔 Ignoring coz already in position', stock.sym)
                    continue
                }
                
                if (sheetData.find(s => s.stockSymbol === stock.sym)) {
                    await sendMessageToChannel('🔔 Ignoring coz already in sheet', stock.sym)
                    continue
                }

                let sheetEntry = await createBaxterOrdersEntries(stock);
            } catch (error) {
                console.error(error);
                logError(stock.sym, 'CREATE_ORDER', error);
                await sendMessageToChannel(`🚨 Error running Baxter MIS Jobs`, stock, error?.message);
            }
        }

    } catch (error) {
        logError(null, 'SETUP_ORDERS', error);
        await sendMessageToChannel(`🚨 Error running Baxter MIS Jobs`, error?.message);
    }
}

async function createBaxterOrdersEntries(stock) {
    try {

        const source = 'baxter';

        let sym = `NSE:${stock.sym}`
        let quote = await kiteSession.kc.getQuote([sym])
        let ltp = quote[sym]?.last_price
        if (!ltp) {
            await sendMessageToChannel('🔕 LTP not found for', stock.sym);
            return;
        }
        let upper_circuit_limit = quote[sym]?.upper_circuit_limit
        let lower_circuit_limit = quote[sym]?.lower_circuit_limit

        let triggerPrice, targetPrice, stopLossPrice, quantity;

        let triggerPadding = 1;
        if (stock.high < 20)
            triggerPadding = 0.1;
        else if (stock.high < 50)
            triggerPadding = 0.2;
        else if (stock.high < 100)
            triggerPadding = 0.3;
        else if (stock.high < 300)
            triggerPadding = 0.5;

        if (stock.direction == 'BULLISH') {
            triggerPrice = stock.high + triggerPadding;
            stopLossPrice = stock.low - triggerPadding;
            targetPrice = '';

            if (stopLossPrice < lower_circuit_limit) {
                stopLossPrice = lower_circuit_limit + 0.1
                sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stopLossPrice)
            }
            if (stopLossPrice > upper_circuit_limit) {
                stopLossPrice = upper_circuit_limit - 0.1
                sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stopLossPrice)
            }

            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;

            quantity = Math.ceil(BAXTER_RISK_AMOUNT / Math.abs(triggerPrice - stopLossPrice));
            quantity = Math.abs(quantity);

        } else {
            triggerPrice = stock.low - triggerPadding;
            stopLossPrice = stock.high + triggerPadding;
            targetPrice = '';

            if (stopLossPrice < lower_circuit_limit) {
                stopLossPrice = lower_circuit_limit + 0.1
                sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stopLossPrice)
            }
            if (stopLossPrice > upper_circuit_limit) {
                stopLossPrice = upper_circuit_limit - 0.1
                sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stopLossPrice)
            }

            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;

            quantity = Math.ceil(BAXTER_RISK_AMOUNT / Math.abs(triggerPrice - stopLossPrice));
            quantity = Math.abs(quantity);
            quantity = -quantity;
        }

        const sheetEntry = {
            source: source,
            stockSymbol: stock.sym,
            reviseSL: UPDATE_SL_INTERVAL.toString(),
            ignore: '',
            status: 'new',
            time: +new Date(),
        }

        sheetEntry.targetPrice = targetPrice
        sheetEntry.stopLossPrice = stopLossPrice
        sheetEntry.triggerPrice = triggerPrice
        sheetEntry.quantity = quantity

        await appendRowsToMISD([sheetEntry], source)

        let orderResponse;
        if (stock.direction === 'BULLISH') {
            if (ltp > triggerPrice) {
                orderResponse = await placeOrder('BUY', 'MARKET', null, quantity, stock, `trigger-m-baxter`);
                await logOrder('PLACED', 'TRIGGER', orderResponse);
                logOrderPlacement(stock.sym, stock.direction, 'MARKET', null, quantity, triggerPrice, stopLossPrice, ltp, orderResponse.order_id, 'trigger-m-baxter');
                await sendMessageToChannel('✅ Baxter market order placed', ltp, stock.sym, quantity, stock.direction);
                
                const benoitSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
                const rowHeaders = benoitSheetData.map(a => a[1])
                const colHeaders = benoitSheetData[0]
                
                const [rowStatus, colStatus] = getStockLoc(stock.sym, 'Status', rowHeaders, colHeaders)
                const updates = [{
                    range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus), 
                    values: [['triggered']], 
                }];
                await bulkUpdateCells(updates);
            } else {
                orderResponse = await placeOrder('BUY', 'SL-M', triggerPrice, quantity, stock, `trigger-baxter`);
                await logOrder('PLACED', 'TRIGGER', orderResponse);
                logOrderPlacement(stock.sym, stock.direction, 'SL-M', triggerPrice, quantity, triggerPrice, stopLossPrice, ltp, orderResponse.order_id, 'trigger-baxter');
                await sendMessageToChannel('✅ Baxter trigger order placed', stock.sym, quantity, triggerPrice, stock.direction);
            }
        } else {
            if (ltp < triggerPrice) {
                orderResponse = await placeOrder('SELL', 'MARKET', null, Math.abs(quantity), stock, `trigger-m-baxter`);
                await logOrder('PLACED', 'TRIGGER', orderResponse);
                logOrderPlacement(stock.sym, stock.direction, 'MARKET', null, Math.abs(quantity), triggerPrice, stopLossPrice, ltp, orderResponse.order_id, 'trigger-m-baxter');
                await sendMessageToChannel('✅ Baxter market order placed', ltp, stock.sym, quantity, stock.direction);
                
                const benoitSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
                const rowHeaders = benoitSheetData.map(a => a[1])
                const colHeaders = benoitSheetData[0]
                
                const [rowStatus, colStatus] = getStockLoc(stock.sym, 'Status', rowHeaders, colHeaders)
                const updates = [{
                    range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus), 
                    values: [['triggered']], 
                }];
                await bulkUpdateCells(updates);
            } else {
                orderResponse = await placeOrder('SELL', 'SL-M', triggerPrice, Math.abs(quantity), stock, `trigger-baxter`);
                await logOrder('PLACED', 'TRIGGER', orderResponse);
                logOrderPlacement(stock.sym, stock.direction, 'SL-M', triggerPrice, Math.abs(quantity), triggerPrice, stopLossPrice, ltp, orderResponse.order_id, 'trigger-baxter');
                await sendMessageToChannel('✅ Baxter trigger order placed', stock.sym, quantity, triggerPrice, stock.direction);
            }
        }

    } catch (error) {
        console.error(error);
        logError(stock.sym, 'CREATE_ORDER_ENTRY', error);
        await sendMessageToChannel(`🚨 Error creating Baxter orders`, error?.message);
        return;
    }
}

async function executeBaxterOrders() {
    try {
        let baxterSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = baxterSheetData.map(a => a[1])
        const colHeaders = baxterSheetData[0]
        baxterSheetData = processSheetWithHeaders(baxterSheetData)

        const orders = await kiteSession.kc.getOrders();

        for (const order of baxterSheetData) {
            try {
                if (order.source?.toLowerCase() !== 'baxter') continue;
                if (order.status != 'new') continue;
                if (order.symbol[0] == '-' || order.symbol[0] == '*') continue;
                
                const timeSinceScan = +new Date() - Number(order.time);

                const direction = Number(order.quantity) > 0 ? 'BULLISH' : 'BEARISH';
                const updates = []

                const triggerOrder = orders.find(o => 
                    o.tradingsymbol === order.symbol && 
                    o.tag?.includes('baxter') && 
                    o.tag?.includes('trigger') &&
                    (o.status === 'COMPLETE')
                );

                if (triggerOrder) {
                    const [rowStatus, colStatus] = getStockLoc(order.symbol, 'Status', rowHeaders, colHeaders)
                    const [rowTime, colTime] = getStockLoc(order.symbol, 'Time', rowHeaders, colHeaders)
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus), 
                        values: [['triggered']], 
                    })
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colTime) + String(rowTime), 
                        values: [[+new Date()]], 
                    })
                    await bulkUpdateCells(updates)
                    logOrderExecution(order.symbol, direction, triggerOrder.average_price, order.quantity, triggerOrder.order_id, triggerOrder.tag);
                    await sendMessageToChannel('✅ Baxter order executed', order.symbol, order.quantity, order.status);
                }
                else if (timeSinceScan > 1000 * 60 * CANCEL_AFTER_MINUTES) {
                    const pendingOrder = orders.find(o => 
                        o.tradingsymbol === order.symbol && 
                        o.tag?.includes('baxter') && 
                        o.tag?.includes('trigger') &&
                        (o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
                    );

                    if (pendingOrder) {
                        await kiteSession.kc.cancelOrder("regular", pendingOrder.order_id);
                        logOrderCancellation(order.symbol, direction, 'Timeout after ' + CANCEL_AFTER_MINUTES + ' mins', pendingOrder.order_id, pendingOrder.tag);
                        await sendMessageToChannel('❎ Cancelled Baxter trigger order:', order.symbol, order.quantity);
                    }

                    const [rowSym, colSym] = getStockLoc(order.symbol, 'Symbol', rowHeaders, colHeaders)
                    const [rowStatus, colStatus] = getStockLoc(order.symbol, 'Status', rowHeaders, colHeaders)
                    const [rowTime, colTime] = getStockLoc(order.symbol, 'Time', rowHeaders, colHeaders)
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colSym) + String(rowSym), 
                        values: [['-' + order.symbol]], 
                    })
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus), 
                        values: [['cancelled']], 
                    })
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colTime) + String(rowTime), 
                        values: [[+new Date()]], 
                    })
                    await bulkUpdateCells(updates)
                    await sendMessageToChannel('❎ Cancelled Baxter order due to timeout:', order.symbol, order.quantity);
                }

            } catch (error) {
                console.error(error)
                logError(order.symbol, 'EXECUTE_ORDER', error);
                await sendMessageToChannel('🚨 Error executing Baxter order:', order.symbol, order.quantity, error?.message);
            }
        }
    } catch (error) {
        console.error(error);
        logError(null, 'EXECUTE_ORDERS', error);
        await sendMessageToChannel(`🚨 Error executing Baxter orders`, error?.message);
    }
}

async function checkBaxterOrdersStoplossHit() {
    try {
        await sendMessageToChannel('⌛️ Executing Check Baxter Orders Stoploss Hit Job');

        let baxterSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = baxterSheetData.map(a => a[1])
        const colHeaders = baxterSheetData[0]
        baxterSheetData = processSheetWithHeaders(baxterSheetData)

        const positions = await kiteSession.kc.getPositions();

        for (const order of baxterSheetData) {
            try {
                if (order.source?.toLowerCase() !== 'baxter') continue;
                if (order.status != 'triggered') continue;
                if (order.symbol[0] == '-' || order.symbol[0] == '*') continue;

                const activePosition = positions.net.find(p => p.tradingsymbol === order.symbol && p.quantity != 0)
                if (!activePosition) {
                    await sendMessageToChannel('⁉️ Baxter order not in position', order.symbol, order.quantity, order.status);
                    continue;
                }

                const direction = Number(order.quantity) > 0 ? 'BULLISH' : 'BEARISH';

                const sym = `NSE:${order.symbol}`
                let ltp = await kiteSession.kc.getLTP([sym]);
                ltp = ltp[sym]?.last_price;

                let exited = false;
                let updates = [];
                
                if (direction === 'BULLISH') {
                    if (ltp <= order.stop_loss) {
                        exited = true;
                        await sendMessageToChannel('❎ Baxter order stopped:', order.symbol, order.quantity, order.status);
                        await placeOrder('SELL', 'MARKET', null, order.quantity, order, `sl-baxter`);
                        await logOrder('PLACED', 'STOPLOSS', order);
                    }
                }
                else if (direction === 'BEARISH') {
                    if (ltp >= order.stop_loss) {
                        exited = true;
                        await sendMessageToChannel('❎ Baxter order stopped:', order.symbol, order.quantity, order.status);
                        await placeOrder('BUY', 'MARKET', null, Math.abs(order.quantity), order, `sl-baxter`);
                        await logOrder('PLACED', 'STOPLOSS', order);
                    }
                }

                sendMessageToChannel('🔎 Baxter stoploss check', `E-${exited} ${order.symbol} LTP:${ltp} SL:${order.stop_loss}`)

                if (exited) {
                    const [rowStatus, colStatus] = getStockLoc(order.symbol, 'Status', rowHeaders, colHeaders)
                    const [rowTime, colTime] = getStockLoc(order.symbol, 'Time', rowHeaders, colHeaders)
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus), 
                        values: [['stopped']], 
                    })
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colTime) + String(rowTime), 
                        values: [[+new Date()]], 
                    })
                    await bulkUpdateCells(updates)
                    logStopLossHit(order.symbol, direction, order.stop_loss, ltp, order.quantity, 'Stop loss price hit');
                } else {
                    logPositionCheck(order.symbol, direction, ltp, order.stop_loss, 'ACTIVE');
                }
            } catch (error) {
                console.error(error)
                logError(order.symbol, 'CHECK_STOPLOSS', error);
                await sendMessageToChannel('🚨 Error checking Baxter orders stoploss hit:', order.symbol, order.quantity, error?.message);
            }
        }

    } catch (error) {
        console.error(error);
        logError(null, 'CHECK_STOPLOSS_HIT', error);
        await sendMessageToChannel(`🚨 Error checking Baxter orders stoploss hit`, error?.message);
    }
}

async function cancelBaxterOrders() {
    try {

        let baxterSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = baxterSheetData.map(a => a[1])
        const colHeaders = baxterSheetData[0]
        baxterSheetData = processSheetWithHeaders(baxterSheetData)

        let updates = []

        for (const order of baxterSheetData) {
            try {

                if (order.source?.toLowerCase() !== 'baxter') continue;
                if (order.status != 'new') continue;
                if (order.symbol[0] == '-' || order.symbol[0] == '*') continue;
                const timeSinceScan = +new Date() - Number(order.time);
                if (timeSinceScan < 1000 * 60 * CANCEL_AFTER_MINUTES) continue;

                await sendMessageToChannel('❎ Cancelled Baxter order:', order.symbol, order.quantity, order.status);

                const [row, col] = getStockLoc(order.symbol, 'Symbol', rowHeaders, colHeaders)
                const [rowS, colS] = getStockLoc(order.symbol, 'Status', rowHeaders, colHeaders)
                updates.push({
                    range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
                    values: [['-' + order.symbol]], 
                })
                updates.push({
                    range: 'MIS-ALPHA!' + numberToExcelColumn(colS) + String(rowS), 
                    values: [['cancelled']], 
                })
            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🚨 Error cancelling Baxter order:', order.symbol, order.quantity, error?.message);
            }
        }

        if (updates.length > 0) {
            await bulkUpdateCells(updates)
        }
    } catch (error) {
        console.error(error);
        await sendMessageToChannel(`🚨 Error cancelling Baxter orders`, error?.message);
        return;
    }
}

async function updateBaxterStopLoss() {
    try {
        await sendMessageToChannel('⌛️ Executing Update Baxter Stop Loss Job');

        let baxterSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = baxterSheetData.map(a => a[1])
        const colHeaders = baxterSheetData[0]
        baxterSheetData = processSheetWithHeaders(baxterSheetData)

        let updates = []

        for (const order of baxterSheetData) {
            let newPrice, shouldUpdate, ltp;
            try {
                if (order.source?.toLowerCase() !== 'baxter') continue;
                if (order.status != 'triggered') continue;

                if (order.symbol[0] == '*' || order.symbol[0] == '-') continue;

                const sym = order.symbol;
                const isBearish = parseFloat(order.quantity) < 0;

                newPrice = isBearish 
                    ? await calculateExtremePrice(sym, 'highest', UPDATE_SL_INTERVAL)
                    : await calculateExtremePrice(sym, 'lowest', UPDATE_SL_INTERVAL);

                ltp = await kiteSession.kc.getLTP([`NSE:${sym}`]);
                ltp = ltp[`NSE:${sym}`]?.last_price;

                const existingStopLoss = parseFloat(order.stop_loss);
                if (isNaN(existingStopLoss)) continue;

                shouldUpdate = isBearish 
                    ? newPrice < existingStopLoss
                    : newPrice > existingStopLoss;

                if (shouldUpdate) {
                    newPrice = Math.round(newPrice * 10) / 10;

                    const [row, col] = getStockLoc(order.symbol, 'Stop Loss', rowHeaders, colHeaders)
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
                        values: [[newPrice]], 
                    })

                    logStopLossUpdate(order.symbol, isBearish ? 'BEARISH' : 'BULLISH', existingStopLoss, newPrice, ltp, 'Trailing SL');
                    await sendMessageToChannel(`🔄 Updated Baxter SL for ${sym}`, `Old: ${existingStopLoss}`, `New: ${newPrice}`, `LTP: ${ltp}`);
                }
            } catch (error) {
                console.error(error)
                logError(order.symbol, 'UPDATE_STOPLOSS', error);
                await sendMessageToChannel('🚨 Error updating Baxter stop loss:', order.symbol, newPrice, ltp, shouldUpdate, error?.message);
            }
        }

        if (updates.length > 0) {
            await bulkUpdateCells(updates)
            await sendMessageToChannel(`✅ Updated ${updates.length} Baxter stop loss prices`);
        }
    } catch (error) {
        console.error(error);
        logError(null, 'UPDATE_STOPLOSS_JOB', error);
        await sendMessageToChannel(`🚨 Error updating Baxter stop loss prices`, error?.message);
        return;
    }
}

module.exports = {
    createBaxterOrdersEntries,
    cancelBaxterOrders,
    updateBaxterStopLoss,
    setupBaxterOrders,
    executeBaxterOrders,
    checkBaxterOrdersStoplossHit
};
