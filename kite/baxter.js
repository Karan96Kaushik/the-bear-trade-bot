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
    getLTPWithRetry, readSheetDataWithRetry, authenticateWithRetry,
    validatePrices, validateCircuitLimits, isDataStale, getDataAge,
    calculateExtremePriceWithFallback, MAX_ORDER_VALUE, MIN_ORDER_VALUE
} = require('./baxterHelpers');
const { acquireLock, releaseLock, hasLock } = require('./lockManager');
const fs = require('fs');
const path = require('path');


const BAXTER_RISK_AMOUNT = 200;
const CANCEL_AFTER_MINUTES = 10;
const MAX_ACTIVE_ORDERS = 1;
const UPDATE_SL_INTERVAL = 15;
const ENABLE_ORDER_DEBUG_LOGGER = process.env.ENABLE_ORDER_DEBUG_LOGGER || true;
const TERMINAL_STATUSES = ['COMPLETE', 'REJECTED', 'CANCELLED'];
const FAILED_STATUSES = ['REJECTED', 'CANCELLED'];

let orderDebugLogData = [];

function logOrderDebug(eventType, sym, details = {}) {
    if (!ENABLE_ORDER_DEBUG_LOGGER) return;
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        eventType,
        symbol: sym,
        ...details
    };
    
    orderDebugLogData.push(logEntry);
}

function writeOrderDebugLogToCSV(filename = 'baxter_orders_debug.csv') {
    if (!ENABLE_ORDER_DEBUG_LOGGER || orderDebugLogData.length === 0) return;
    
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const filepath = path.join(logsDir, filename);
    
    const headers = [
        'timestamp',
        'eventType',
        'symbol',
        'direction',
        'high',
        'low',
        'ltp',
        'triggerPrice',
        'stopLossPrice',
        'triggerPadding',
        'quantity',
        'riskAmount',
        'orderType',
        'orderAction',
        'status',
        'reason',
        'oldStopLoss',
        'newStopLoss',
        'extremePrice',
        'timeSinceScan',
        'cancelTimeout',
        'circuitLimitAdjustment'
    ];
    
    const fileExists = fs.existsSync(filepath);
    const needsHeader = !fileExists || fs.readFileSync(filepath, 'utf8').trim() === '';
    
    const rows = orderDebugLogData.map(entry => 
        headers.map(header => {
            const value = entry[header];
            if (value === null || value === undefined || value === '') return '';
            if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return String(value);
        }).join(',')
    );
    
    const csvContent = (needsHeader ? headers.join(',') + '\n' : '') + rows.join('\n') + '\n';
    
    fs.appendFileSync(filepath, csvContent, 'utf8');
    
    orderDebugLogData = [];
    
    console.log(`📝 Baxter order debug logs written to ${filepath}`);
}

async function setupBaxterOrders() {
    try {
        await sendMessageToChannel(`⌛️ Executing Baxter MIS Jobs`);

        let stockListData = await readSheetDataWithRetry('Baxter-StockList!A1:B1000')
        stockListData = processSheetWithHeaders(stockListData);
        
        let bullishStockList = (stockListData.map(row => row.bullish).filter(s => s?.length > 0));
        let bearishStockList = (stockListData.map(row => row.bearish).filter(s => s?.length > 0));

        let sheetData = await readSheetDataWithRetry('MIS-ALPHA!A2:W1000')
        sheetData = processMISSheetData(sheetData)

        await authenticateWithRetry();

        let selectedStocks = [];
        
        if (bullishStockList.length > 0) {
            const { selectedStocks: bullishSelected } = await scanBaxterStocks(bullishStockList, undefined, undefined, false, {}, 'BULLISH');
            selectedStocks.push(...bullishSelected);
        }
        if (bearishStockList.length > 0) {
            const { selectedStocks: bearishSelected } = await scanBaxterStocks(bearishStockList, undefined, undefined, false, {}, 'BEARISH');
            selectedStocks.push(...bearishSelected);
        }

        const orders = await kiteSession.kc.getOrders();
        const positions = await kiteSession.kc.getPositions();

        // Cancel all existing TRIGGER PENDING Baxter orders before setup
        const pendingBaxterOrders = orders.filter(o => 
            o.tag?.includes('baxter') && 
            (o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
        );
        
        if (pendingBaxterOrders.length > 0) {
            await sendMessageToChannel(`🗑️ Cancelling ${pendingBaxterOrders.length} pending Baxter orders before new setup`);
            for (const order of pendingBaxterOrders) {
                try {
                    await kiteSession.kc.cancelOrder("regular", order.order_id);
                    await sendMessageToChannel(`❎ Cancelled pending order: ${order.tradingsymbol}`);
                } catch (cancelError) {
                    await sendMessageToChannel(`⚠️ Failed to cancel order ${order.order_id}:`, cancelError?.message);
                }
            }
        }

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
                // Check if already being processed (lock)
                if (hasLock(stock.sym)) {
                    await sendMessageToChannel('🔒 Skipping - already processing', stock.sym);
                    continue;
                }
                
                // Check for existing Baxter orders (by tag)
                const existingBaxterOrders = orders.filter(o => 
                    o.tradingsymbol === stock.sym && 
                    o.tag?.includes('baxter') &&
                    (o.status === 'TRIGGER PENDING' || o.status === 'OPEN' || o.status === 'COMPLETE')
                );
                
                if (existingBaxterOrders.length > 0) {
                    await sendMessageToChannel('🔔 Ignoring coz existing baxter order', stock.sym);
                    continue;
                }
                
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

                // Acquire lock before processing
                if (!acquireLock(stock.sym)) {
                    await sendMessageToChannel('🔒 Failed to acquire lock', stock.sym);
                    continue;
                }

                try {
                    let sheetEntry = await createBaxterOrdersEntries(stock);
                } finally {
                    releaseLock(stock.sym);
                }
            } catch (error) {
                console.error(error);
                await sendMessageToChannel(`🚨 Error running Baxter MIS Jobs`, stock, error?.message);
            }
        }

    } catch (error) {
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
            logOrderDebug('LTP_NOT_FOUND', stock.sym, {
                direction: stock.direction,
                high: stock.high,
                low: stock.low,
                reason: 'LTP not available from quote'
            });
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

        let circuitAdjustment = '';

        if (stock.direction == 'BULLISH') {
            triggerPrice = stock.high + triggerPadding;
            stopLossPrice = stock.low - triggerPadding;
            targetPrice = '';

            // For BULLISH: SL is below, so only check lower circuit
            if (stopLossPrice < lower_circuit_limit) {
                stopLossPrice = lower_circuit_limit + 0.1
                circuitAdjustment = `SL adjusted from ${stock.low - triggerPadding} to ${stopLossPrice} (lower circuit: ${lower_circuit_limit})`;
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

            // For BEARISH: SL is above, so only check upper circuit
            if (stopLossPrice > upper_circuit_limit) {
                stopLossPrice = upper_circuit_limit - 0.1
                circuitAdjustment = `SL adjusted from ${stock.high + triggerPadding} to ${stopLossPrice} (upper circuit: ${upper_circuit_limit})`;
                sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stopLossPrice)
            }

            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;

            quantity = Math.ceil(BAXTER_RISK_AMOUNT / Math.abs(triggerPrice - stopLossPrice));
            quantity = Math.abs(quantity);
            quantity = -quantity;
        }
        
        // Validate prices and quantity
        try {
            validatePrices(triggerPrice, stopLossPrice, quantity, ltp, stock.sym);
            validateCircuitLimits(triggerPrice, stopLossPrice, stock.direction, lower_circuit_limit, upper_circuit_limit);
        } catch (validationError) {
            logOrderDebug('VALIDATION_FAILED', stock.sym, {
                direction: stock.direction,
                triggerPrice,
                stopLossPrice,
                quantity,
                ltp,
                reason: validationError.message
            });
            await sendMessageToChannel('🚫 Validation failed', stock.sym, validationError.message);
            writeOrderDebugLogToCSV();
            return;
        }

        logOrderDebug('PRICE_CALCULATED', stock.sym, {
            direction: stock.direction,
            high: stock.high,
            low: stock.low,
            ltp,
            triggerPrice,
            stopLossPrice,
            triggerPadding,
            quantity,
            riskAmount: BAXTER_RISK_AMOUNT,
            circuitLimitAdjustment: circuitAdjustment || 'none'
        });

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

        let sheetUpdated = false;
        let symbolToRollback = null;

        try {
            await appendRowsToMISD([sheetEntry], source)
            sheetUpdated = true;
            symbolToRollback = stock.sym;

            let triggerOrderResponse, stopLossOrderResponse;
            
            if (stock.direction === 'BULLISH') {
                if (ltp > triggerPrice) {
                    logOrderDebug('ORDER_PLACED', stock.sym, {
                        direction: stock.direction,
                        ltp,
                        triggerPrice,
                        stopLossPrice,
                        quantity,
                        orderType: 'MARKET + SL',
                        orderAction: 'BUY + SL-M',
                        reason: 'LTP already above trigger, placing market + SL orders'
                    });
                    
                    // Place market order for trigger
                    triggerOrderResponse = await placeOrder('BUY', 'MARKET', null, quantity, stock, `trigger-m-baxter`);
                    await logOrder('PLACED', 'TRIGGER', triggerOrderResponse);
                    
                    // Place SL-M order for stop loss
                    stopLossOrderResponse = await placeOrder('SELL', 'SL-M', stopLossPrice, quantity, stock, `sl-baxter`);
                    await logOrder('PLACED', 'STOPLOSS', stopLossOrderResponse);
                    
                    await sendMessageToChannel('✅ Baxter market + SL orders placed', ltp, stock.sym, quantity, stock.direction);
                    
                    const baxterSheetData = await readSheetDataWithRetry('MIS-ALPHA!A1:W1000')
                    const rowHeaders = baxterSheetData.map(a => a[1])
                    const colHeaders = baxterSheetData[0]
                    
                    const [rowStatus, colStatus] = getStockLoc(stock.sym, 'Status', rowHeaders, colHeaders)
                    const updates = [{
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus), 
                        values: [['triggered']], 
                    }];
                    await bulkUpdateCells(updates);
                } else {
                    logOrderDebug('ORDER_PLACED', stock.sym, {
                        direction: stock.direction,
                        ltp,
                        triggerPrice,
                        stopLossPrice,
                        quantity,
                        orderType: 'SL-M (trigger only)',
                        orderAction: 'BUY',
                        reason: 'LTP below trigger, waiting for trigger. SL will be placed after trigger.'
                    });
                    
                    // Place SL-M order for trigger only
                    triggerOrderResponse = await placeOrder('BUY', 'SL-M', triggerPrice, quantity, stock, `trigger-baxter`);
                    await logOrder('PLACED', 'TRIGGER', triggerOrderResponse);
                    await sendMessageToChannel('✅ Baxter trigger order placed', stock.sym, quantity, triggerPrice, stock.direction);
                }
            } else {
                if (ltp < triggerPrice) {
                    logOrderDebug('ORDER_PLACED', stock.sym, {
                        direction: stock.direction,
                        ltp,
                        triggerPrice,
                        stopLossPrice,
                        quantity,
                        orderType: 'MARKET + SL',
                        orderAction: 'SELL + SL-M',
                        reason: 'LTP already below trigger, placing market + SL orders'
                    });
                    
                    // Place market order for trigger
                    triggerOrderResponse = await placeOrder('SELL', 'MARKET', null, Math.abs(quantity), stock, `trigger-m-baxter`);
                    await logOrder('PLACED', 'TRIGGER', triggerOrderResponse);
                    
                    // Place SL-M order for stop loss
                    stopLossOrderResponse = await placeOrder('BUY', 'SL-M', stopLossPrice, Math.abs(quantity), stock, `sl-baxter`);
                    await logOrder('PLACED', 'STOPLOSS', stopLossOrderResponse);
                    
                    await sendMessageToChannel('✅ Baxter market + SL orders placed', ltp, stock.sym, quantity, stock.direction);
                    
                    const baxterSheetData = await readSheetDataWithRetry('MIS-ALPHA!A1:W1000')
                    const rowHeaders = baxterSheetData.map(a => a[1])
                    const colHeaders = baxterSheetData[0]
                    
                    const [rowStatus, colStatus] = getStockLoc(stock.sym, 'Status', rowHeaders, colHeaders)
                    const updates = [{
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus), 
                        values: [['triggered']], 
                    }];
                    await bulkUpdateCells(updates);
                } else {
                    logOrderDebug('ORDER_PLACED', stock.sym, {
                        direction: stock.direction,
                        ltp,
                        triggerPrice,
                        stopLossPrice,
                        quantity,
                        orderType: 'SL-M (trigger only)',
                        orderAction: 'SELL',
                        reason: 'LTP above trigger, waiting for trigger. SL will be placed after trigger.'
                    });
                    
                    // Place SL-M order for trigger only
                    triggerOrderResponse = await placeOrder('SELL', 'SL-M', triggerPrice, Math.abs(quantity), stock, `trigger-baxter`);
                    await logOrder('PLACED', 'TRIGGER', triggerOrderResponse);
                    await sendMessageToChannel('✅ Baxter trigger order placed', stock.sym, quantity, triggerPrice, stock.direction);
                }
            }
            
            writeOrderDebugLogToCSV();
            
        } catch (orderError) {
            // ROLLBACK: Mark sheet entry as failed if order placement failed
            if (sheetUpdated && symbolToRollback) {
                try {
                    await markSheetEntryFailed(symbolToRollback);
                } catch (rollbackError) {
                    await sendMessageToChannel(`🚨 Rollback failed for ${symbolToRollback}`, rollbackError?.message);
                }
            }
            
            logOrderDebug('ERROR', stock?.sym || 'unknown', {
                reason: orderError?.message,
                orderPlacementFailed: sheetUpdated,
                phase: sheetUpdated ? 'order_placement' : 'sheet_update'
            });
            writeOrderDebugLogToCSV();
            
            await sendMessageToChannel(`🚨 Error creating Baxter order for ${stock?.sym}`, orderError?.message);
            throw orderError;
        }

        writeOrderDebugLogToCSV();

    } catch (error) {
        console.error(error);
        logOrderDebug('ERROR', stock?.sym || 'unknown', {
            reason: error?.message || 'Unknown error',
            stack: error?.stack
        });
        writeOrderDebugLogToCSV();
        await sendMessageToChannel(`🚨 Error creating Baxter orders`, error?.message);
        return;
    }
}

async function createManualOrdersEntries(stock) {
    try {
        const source = 'manual';

        if (!stock?.sym) {
            throw new Error('Missing symbol (sym)');
        }

        if (!stock?.direction || !['BULLISH', 'BEARISH'].includes(stock.direction)) {
            throw new Error('Invalid direction. Expected BULLISH or BEARISH');
        }

        const direction = stock.direction;
        const riskAmount = Number(stock.riskAmount || BAXTER_RISK_AMOUNT);

        if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
            throw new Error('Invalid riskAmount');
        }

        let sym = `NSE:${stock.sym}`;
        let quote = await kiteSession.kc.getQuote([sym]);
        let ltp = quote[sym]?.last_price;

        if (!ltp) {
            logOrderDebug('LTP_NOT_FOUND', stock.sym, {
                direction: stock.direction,
                high: stock.high,
                low: stock.low,
                triggerPrice: stock.triggerPrice,
                stopLossPrice: stock.stopLossPrice,
                reason: 'LTP not available from quote',
            });
            await sendMessageToChannel('🔕 LTP not found for', stock.sym);
            return;
        }

        let upper_circuit_limit = quote[sym]?.upper_circuit_limit;
        let lower_circuit_limit = quote[sym]?.lower_circuit_limit;

        let triggerPrice, targetPrice, stopLossPrice, quantity;
        targetPrice = '';

        if (Number.isFinite(stock.triggerPrice) && Number.isFinite(stock.stopLossPrice)) {
            // Mode 2: direct prices -> use as-is
            triggerPrice = stock.triggerPrice;
            stopLossPrice = stock.stopLossPrice;
        } else {
            throw new Error('Provide either (high, low) or (triggerPrice, stopLossPrice)');
        }

        let circuitAdjustment = '';

        // Circuit adjustments (same pattern as Baxter)
        if (direction === 'BULLISH') {
            if (stopLossPrice < lower_circuit_limit) {
                circuitAdjustment = `SL adjusted from ${stopLossPrice} to ${lower_circuit_limit + 0.1} (lower circuit: ${lower_circuit_limit})`;
                stopLossPrice = lower_circuit_limit + 0.1;
                await sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stopLossPrice);
            }
        } else {
            if (stopLossPrice > upper_circuit_limit) {
                circuitAdjustment = `SL adjusted from ${stopLossPrice} to ${upper_circuit_limit - 0.1} (upper circuit: ${upper_circuit_limit})`;
                stopLossPrice = upper_circuit_limit - 0.1;
                await sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stopLossPrice);
            }
        }

        triggerPrice = Math.round(triggerPrice * 10) / 10;
        stopLossPrice = Math.round(stopLossPrice * 10) / 10;

        if (stock.quantity && Number.isFinite(Number(stock.quantity))) {
            quantity = Math.abs(parseInt(stock.quantity, 10));
            quantity = direction === 'BEARISH' ? -quantity : quantity;
        } else {
            quantity = Math.ceil(riskAmount / Math.abs(triggerPrice - stopLossPrice));
            quantity = Math.abs(quantity);
            quantity = direction === 'BEARISH' ? -quantity : quantity;
        }

        // Validate prices and quantity
        try {
            validatePrices(triggerPrice, stopLossPrice, quantity, ltp, stock.sym);
            validateCircuitLimits(triggerPrice, stopLossPrice, direction, lower_circuit_limit, upper_circuit_limit);
        } catch (validationError) {
            logOrderDebug('VALIDATION_FAILED', stock.sym, {
                direction,
                triggerPrice,
                stopLossPrice,
                quantity,
                ltp,
                reason: validationError.message,
            });
            await sendMessageToChannel('🚫 Validation failed', stock.sym, validationError.message);
            writeOrderDebugLogToCSV();
            return;
        }

        logOrderDebug('PRICE_CALCULATED', stock.sym, {
            direction,
            high: stock.high,
            low: stock.low,
            ltp,
            triggerPrice,
            stopLossPrice,
            quantity,
            riskAmount,
            circuitLimitAdjustment: circuitAdjustment || 'none',
        });

        const sheetEntry = {
            source,
            stockSymbol: stock.sym,
            reviseSL: String(stock.reviseSL || UPDATE_SL_INTERVAL),
            ignore: '',
            status: 'new',
            time: +new Date(),
        };

        sheetEntry.targetPrice = targetPrice;
        sheetEntry.stopLossPrice = stopLossPrice;
        sheetEntry.triggerPrice = triggerPrice;
        sheetEntry.quantity = quantity;

        let sheetUpdated = false;
        let symbolToRollback = null;

        try {
            await appendRowsToMISD([sheetEntry], source);
            sheetUpdated = true;
            symbolToRollback = stock.sym;

            let triggerOrderResponse, stopLossOrderResponse;

            if (direction === 'BULLISH') {
                if (ltp > triggerPrice) {
                    triggerOrderResponse = await placeOrder(
                        'BUY',
                        'MARKET',
                        null,
                        quantity,
                        stock,
                        `trigger-m-${source}`,
                    );
                    await logOrder('PLACED', 'TRIGGER', triggerOrderResponse);

                    stopLossOrderResponse = await placeOrder(
                        'SELL',
                        'SL-M',
                        stopLossPrice,
                        quantity,
                        stock,
                        `sl-${source}`,
                    );
                    await logOrder('PLACED', 'STOPLOSS', stopLossOrderResponse);

                    await sendMessageToChannel('✅ Manual market + SL orders placed', ltp, stock.sym, quantity, stock.direction);

                    const baxterSheetData = await readSheetDataWithRetry('MIS-ALPHA!A1:W1000');
                    const rowHeaders = baxterSheetData.map(a => a[1]);
                    const colHeaders = baxterSheetData[0];
                    const [rowStatus, colStatus] = getStockLoc(stock.sym, 'Status', rowHeaders, colHeaders);
                    const updates = [
                        {
                            range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus),
                            values: [['triggered']],
                        },
                    ];
                    await bulkUpdateCells(updates);
                } else {
                    triggerOrderResponse = await placeOrder(
                        'BUY',
                        'SL-M',
                        triggerPrice,
                        quantity,
                        stock,
                        `trigger-${source}`,
                    );
                    await logOrder('PLACED', 'TRIGGER', triggerOrderResponse);
                    await sendMessageToChannel('✅ Manual trigger order placed', stock.sym, quantity, triggerPrice, stock.direction);
                }
            } else {
                if (ltp < triggerPrice) {
                    triggerOrderResponse = await placeOrder(
                        'SELL',
                        'MARKET',
                        null,
                        Math.abs(quantity),
                        stock,
                        `trigger-m-${source}`,
                    );
                    await logOrder('PLACED', 'TRIGGER', triggerOrderResponse);

                    stopLossOrderResponse = await placeOrder(
                        'BUY',
                        'SL-M',
                        stopLossPrice,
                        Math.abs(quantity),
                        stock,
                        `sl-${source}`,
                    );
                    await logOrder('PLACED', 'STOPLOSS', stopLossOrderResponse);

                    await sendMessageToChannel('✅ Manual market + SL orders placed', ltp, stock.sym, Math.abs(quantity), stock.direction);

                    const baxterSheetData = await readSheetDataWithRetry('MIS-ALPHA!A1:W1000');
                    const rowHeaders = baxterSheetData.map(a => a[1]);
                    const colHeaders = baxterSheetData[0];
                    const [rowStatus, colStatus] = getStockLoc(stock.sym, 'Status', rowHeaders, colHeaders);
                    const updates = [
                        {
                            range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus),
                            values: [['triggered']],
                        },
                    ];
                    await bulkUpdateCells(updates);
                } else {
                    triggerOrderResponse = await placeOrder(
                        'SELL',
                        'SL-M',
                        triggerPrice,
                        Math.abs(quantity),
                        stock,
                        `trigger-${source}`,
                    );
                    await logOrder('PLACED', 'TRIGGER', triggerOrderResponse);
                    await sendMessageToChannel('✅ Manual trigger order placed', stock.sym, Math.abs(quantity), triggerPrice, stock.direction);
                }
            }

            writeOrderDebugLogToCSV();

            return {
                triggerOrderId: triggerOrderResponse?.order_id || null,
                stopLossOrderId: stopLossOrderResponse?.order_id || null,
                triggerPrice,
                stopLossPrice,
                quantity,
            };
        } catch (orderError) {
            // ROLLBACK: Mark sheet entry as failed if order placement failed
            if (sheetUpdated && symbolToRollback) {
                try {
                    await markSheetEntryFailed(symbolToRollback);
                } catch (rollbackError) {
                    await sendMessageToChannel(`🚨 Rollback failed for ${symbolToRollback}`, rollbackError?.message);
                }
            }

            logOrderDebug('ERROR', stock?.sym || 'unknown', {
                reason: orderError?.message,
                orderPlacementFailed: sheetUpdated,
                phase: sheetUpdated ? 'order_placement' : 'sheet_update',
            });
            writeOrderDebugLogToCSV();

            await sendMessageToChannel(`🚨 Error creating Manual order for ${stock?.sym}`, orderError?.message);
            throw orderError;
        }
    } catch (error) {
        console.error(error);
        logOrderDebug('ERROR', stock?.sym || 'unknown', {
            reason: error?.message || 'Unknown error',
            stack: error?.stack,
        });
        writeOrderDebugLogToCSV();
        await sendMessageToChannel(`🚨 Error creating Manual orders`, error?.message);
        return;
    }
}

// NOTE: executeBaxterOrders function removed - SL orders are now placed immediately
// via webhook in processor.js when trigger orders complete (processSuccessfulOrder)

async function checkBaxterOrdersStoplossHit() {
    try {
        await sendMessageToChannel('⌛️ Executing Check Baxter Orders Stoploss Hit Job');

        let baxterSheetData = await readSheetDataWithRetry('MIS-ALPHA!A1:W1000')
        const rowHeaders = baxterSheetData.map(a => a[1])
        const colHeaders = baxterSheetData[0]
        baxterSheetData = processSheetWithHeaders(baxterSheetData)

        const positions = await kiteSession.kc.getPositions();
        const orders = await kiteSession.kc.getOrders();

        for (const order of baxterSheetData) {
            try {
                const source = order.source?.toLowerCase();
                if (source !== 'baxter' && source !== 'manual') continue;
                if (order.status != 'triggered') continue;
                if (order.symbol[0] == '-' || order.symbol[0] == '*') continue;

                const activePosition = positions.net.find(p => p.tradingsymbol === order.symbol && p.quantity != 0)
                
                // Check if position exited
                if (!activePosition) {
                    // Verify if SL order was executed
                    const slOrder = orders.find(o => 
                        o.tradingsymbol === order.symbol && 
                        o.tag?.includes(`sl-${source}`) &&
                        o.status === 'COMPLETE'
                    );
                    
                    if (slOrder) {
                        // SL order executed successfully
                        await sendMessageToChannel(`✅ ${source} SL order executed`, order.symbol, order.quantity);
                        
                        let updates = [];
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
                    } else {
                        await sendMessageToChannel(`⁉️ ${source} position exited but no SL order found`, order.symbol);
                    }
                    continue;
                }
                
                // Validate quantity matches
                const expectedQuantity = Math.abs(order.quantity);
                const actualQuantity = Math.abs(activePosition.quantity);
                
                if (actualQuantity !== expectedQuantity) {
                    await sendMessageToChannel(`⚠️ Quantity mismatch: Expected ${expectedQuantity}, Got ${actualQuantity}`, order.symbol);
                    logOrderDebug('QUANTITY_MISMATCH', order.symbol, {
                        expected: expectedQuantity,
                        actual: actualQuantity,
                        reason: 'Possible partial fill'
                    });
                }

                const direction = Number(order.quantity) > 0 ? 'BULLISH' : 'BEARISH';
                const sym = `NSE:${order.symbol}`
                let ltp = await getLTPWithRetry(sym);

                // Check if SL order exists in API
                const pendingSlOrder = orders.find(o => 
                    o.tradingsymbol === order.symbol && 
                    o.tag?.includes(`sl-${source}`) &&
                    (o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
                );

                if (!pendingSlOrder) {
                    // Missing SL order - place it as safety
                    await sendMessageToChannel(`⚠️ Missing SL order for ${order.symbol}, placing safety SL`);
                    logOrderDebug('MISSING_SL_ORDER', order.symbol, {
                        direction,
                        stopLossPrice: order.stop_loss,
                        ltp,
                        reason: 'SL order not found in API, placing safety order'
                    });
                    
                    const qty = Math.abs(order.quantity);
                    try {
                        if (direction === 'BULLISH') {
                            await placeOrder('SELL', 'SL-M', order.stop_loss, qty, order, `sl-${source}`);
                        } else {
                            await placeOrder('BUY', 'SL-M', order.stop_loss, qty, order, `sl-${source}`);
                        }
                        await sendMessageToChannel(`✅ Safety SL order placed for ${order.symbol}`);
                    } catch (placeError) {
                        await sendMessageToChannel(`🚨 Failed to place safety SL for ${order.symbol}:`, placeError?.message);
                    }
                } else {
                    // SL order exists, just log status
                    sendMessageToChannel('🔎 Baxter SL check', `${order.symbol} LTP:${ltp} SL:${order.stop_loss} [API Order: ${pendingSlOrder.order_id}]`)
                }

            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🚨 Error checking Baxter orders stoploss hit:', order.symbol, order.quantity, error?.message);
            }
        }

        writeOrderDebugLogToCSV();
    } catch (error) {
        console.error(error);
        writeOrderDebugLogToCSV();
        await sendMessageToChannel(`🚨 Error checking Baxter orders stoploss hit`, error?.message);
    }
}

async function cancelBaxterOrders() {
    try {

        let baxterSheetData = await readSheetDataWithRetry('MIS-ALPHA!A1:W1000')
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

        let baxterSheetData = await readSheetDataWithRetry('MIS-ALPHA!A1:W1000')
        const rowHeaders = baxterSheetData.map(a => a[1])
        const colHeaders = baxterSheetData[0]
        baxterSheetData = processSheetWithHeaders(baxterSheetData)

        const orders = await kiteSession.kc.getOrders();
        let updates = []

        for (const order of baxterSheetData) {
            let newPrice, shouldUpdate, ltp;
            try {
                const source = order.source?.toLowerCase();
                if (source !== 'baxter' && source !== 'manual') continue;
                if (order.status != 'triggered') continue;

                if (order.symbol[0] == '*' || order.symbol[0] == '-') continue;

                const isManual = source === 'manual';
                const nowMs = +new Date();

                // Manual SL settings:
                // - SL Interval (lookback minutes) => order.sl_interval
                // - Revise SL (min minutes between revisions) => order.revise_sl
                // Backward-compat:
                // - If SL Interval column isn't present, treat revise_sl as interval and disable frequency gating.
                let slIntervalMinutes = UPDATE_SL_INTERVAL;
                let frequencyMinutes = 0;
                if (isManual) {
                    const slIntervalRaw = order.sl_interval ?? '';
                    const reviseSlRaw = order.revise_sl ?? '';

                    if (slIntervalRaw !== '') {
                        slIntervalMinutes = parseInt(slIntervalRaw, 10);
                        if (isNaN(slIntervalMinutes) || slIntervalMinutes <= 0) slIntervalMinutes = UPDATE_SL_INTERVAL;

                        frequencyMinutes = parseInt(reviseSlRaw, 10);
                        if (isNaN(frequencyMinutes) || frequencyMinutes < 0) frequencyMinutes = 0;
                    } else {
                        // Older sheet layout: only one value exists.
                        const maybeInterval = parseInt(reviseSlRaw, 10);
                        if (!isNaN(maybeInterval) && maybeInterval > 0) slIntervalMinutes = maybeInterval;
                        frequencyMinutes = 0;
                    }

                    const lastRevisionMs = Number(order.time);
                    if (
                        frequencyMinutes > 0 &&
                        Number.isFinite(lastRevisionMs) &&
                        lastRevisionMs > 0 &&
                        nowMs - lastRevisionMs < frequencyMinutes * 60 * 1000
                    ) {
                        continue;
                    }
                }

                const sym = order.symbol;
                const isBearish = parseFloat(order.quantity) < 0;
                
                ltp = await getLTPWithRetry(sym);

                newPrice = isBearish 
                    ? await calculateExtremePriceWithFallback(sym, 'highest', slIntervalMinutes, ltp)
                    : await calculateExtremePriceWithFallback(sym, 'lowest', slIntervalMinutes, ltp);

                const existingStopLoss = parseFloat(order.stop_loss);
                if (isNaN(existingStopLoss)) continue;

                shouldUpdate = isBearish 
                    ? newPrice < existingStopLoss
                    : newPrice > existingStopLoss;

                if (shouldUpdate) {
                    newPrice = Math.round(newPrice * 10) / 10;

                    logOrderDebug('STOPLOSS_UPDATED', order.symbol, {
                        direction: isBearish ? 'BEARISH' : 'BULLISH',
                        oldStopLoss: existingStopLoss,
                        newStopLoss: newPrice,
                        extremePrice: newPrice,
                        ltp,
                        reason: `Trailing SL ${isBearish ? 'downward' : 'upward'}`
                    });

                    // Find existing SL order
                    const existingSlOrder = orders.find(o => 
                        o.tradingsymbol === order.symbol && 
                        o.tag?.includes(`sl-${source}`) &&
                        (o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
                    );

                    // Cancel existing SL order if it exists
                    if (existingSlOrder) {
                        try {
                            await kiteSession.kc.cancelOrder("regular", existingSlOrder.order_id);
                            await sendMessageToChannel(`❎ Cancelled old SL order for ${sym}: ${existingStopLoss}`);
                        } catch (cancelError) {
                            await sendMessageToChannel(`⚠️ Failed to cancel SL order for ${sym}:`, cancelError?.message);
                            logOrderDebug('CANCEL_FAILED', order.symbol, {
                                orderId: existingSlOrder.order_id,
                                reason: cancelError?.message
                            });
                            continue;
                        }
                    }

                    // Place new SL order with updated stop loss
                    const qty = Math.abs(order.quantity);
                    try {
                        let slOrderResponse;
                        if (isBearish) {
                            slOrderResponse = await placeOrder('BUY', 'SL-M', newPrice, qty, order, `sl-${source}`);
                        } else {
                            slOrderResponse = await placeOrder('SELL', 'SL-M', newPrice, qty, order, `sl-${source}`);
                        }
                        await logOrder('PLACED', 'STOPLOSS_UPDATE', slOrderResponse);
                        await sendMessageToChannel(`✅ New SL order placed for ${sym}:`, `Old: ${existingStopLoss}`, `New: ${newPrice}`, `LTP: ${ltp}`);
                    } catch (placeError) {
                        await sendMessageToChannel(`🚨 Failed to place new SL order for ${sym}:`, placeError?.message);
                        logOrderDebug('PLACE_SL_FAILED', order.symbol, {
                            newStopLoss: newPrice,
                            reason: placeError?.message
                        });
                        continue;
                    }

                    // Update sheet with new SL
                    const [row, col] = getStockLoc(order.symbol, 'Stop Loss', rowHeaders, colHeaders)
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
                        values: [[newPrice]], 
                    })

                    // For manual orders, update revision timestamp to enforce frequency gating.
                    if (isManual) {
                        const [rowTime, colTime] = getStockLoc(order.symbol, 'Time', rowHeaders, colHeaders);
                        updates.push({
                            range: 'MIS-ALPHA!' + numberToExcelColumn(colTime) + String(rowTime),
                            values: [[nowMs]],
                        });
                    }

                    await sendMessageToChannel(`🔄 Updated Baxter SL for ${sym}`, `Old: ${existingStopLoss}`, `New: ${newPrice}`, `LTP: ${ltp}`);
                }
            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🚨 Error updating Baxter stop loss:', order.symbol, newPrice, ltp, shouldUpdate, error?.message);
            }
        }

        if (updates.length > 0) {
            await bulkUpdateCells(updates)
            await sendMessageToChannel(`✅ Updated ${updates.length} Baxter stop loss prices`);
        }
        
        writeOrderDebugLogToCSV();
    } catch (error) {
        console.error(error);
        writeOrderDebugLogToCSV();
        await sendMessageToChannel(`🚨 Error updating Baxter stop loss prices`, error?.message);
        return;
    }
}

async function markSheetEntryFailed(symbol) {
    try {
        const baxterSheetData = await readSheetDataWithRetry('MIS-ALPHA!A1:W1000');
        const rowHeaders = baxterSheetData.map(a => a[1]);
        const colHeaders = baxterSheetData[0];
        
        const [rowSym, colSym] = getStockLoc(symbol, 'Symbol', rowHeaders, colHeaders);
        const [rowStatus, colStatus] = getStockLoc(symbol, 'Status', rowHeaders, colHeaders);
        
        const updates = [
            {
                range: 'MIS-ALPHA!' + numberToExcelColumn(colSym) + String(rowSym),
                values: [['-' + symbol]]
            },
            {
                range: 'MIS-ALPHA!' + numberToExcelColumn(colStatus) + String(rowStatus),
                values: [['failed']]
            }
        ];
        
        await bulkUpdateCells(updates);
        await sendMessageToChannel(`🔄 Rolled back sheet entry for ${symbol}`);
    } catch (error) {
        console.error(`Failed to mark ${symbol} as failed:`, error);
        throw error;
    }
}

module.exports = {
    createBaxterOrdersEntries,
    createManualOrdersEntries,
    cancelBaxterOrders,
    updateBaxterStopLoss,
    setupBaxterOrders,
    checkBaxterOrdersStoplossHit
};
