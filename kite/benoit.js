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
const { calculateExtremePrice, getDataFromYahoo, processYahooData } = require('../kite/utils');
const { scanBenoitStocks } = require("../analytics/benoit");
const { getDateStringIND } = require('../kite/utils');


const BENOIT_RISK_AMOUNT = 200;
const CANCEL_AFTER_MINUTES = 20;


async function setupBenoitOrders() {
    try {
        await sendMessageToChannel(`⌛️ Executing Benoit MIS Jobs`);

        let highBetaData, niftyList;

        highBetaData = await readSheetData('HIGHBETA!C2:C550')
        niftyList = highBetaData
                        .map(stock => stock[0])
                        .filter(d => d !== 'NOT FOUND' && d)
        highBetaData = highBetaData
                        .map(d => ({sym: d[0]?.trim()?.toUpperCase(), dir: d[2]?.trim()?.toLowerCase()}))
                        .filter(d => d.sym)
 

        let sheetData = await readSheetData('MIS-ALPHA!A2:W1000')
        sheetData = processMISSheetData(sheetData)

        await kiteSession.authenticate();

        let result = null

        result = await scanBenoitStocks(
            niftyList,
            null,
            '5m',
            false,
        )

        let {selectedStocks, no_data_stocks, too_high_stocks, too_many_incomplete_candles_stocks, errored_stocks} = result

        const orders = await kiteSession.kc.getOrders();
        const positions = await kiteSession.kc.getPositions();

        const completed_benoit_orders = orders.filter(order => 
            order.tag?.includes('benoit') &&
            !(order.status === 'TRIGGER PENDING' || order.status === 'OPEN')
        );
        const completed_benoit_orders_symbols = completed_benoit_orders.map(o => o.tradingsymbol);

        let loggingBenoitOrders = selectedStocks.map(s => {
            delete s.data
            return s
        })

        sendMessageToChannel(`🔔 Benoit MIS Stocks: `, loggingBenoitOrders);

        if (
            // Check if there are more than 5 triggered benoit orders in the sheet
            sheetData.filter(s => s.status?.toLowerCase() == 'triggered' && s.source?.toLowerCase() == 'benoit').length >= 5
        ) {
            await sendMessageToChannel('🔔 Benoit Active positions are more than 5')
            return
        }

        const sheetEntries = []

        const allStocks = [...selectedStocks]

        for (const stock of allStocks) {
            try {
                // Skip if stock is already in position or open orders
                if (
                    positions.net.find(p => p.tradingsymbol === stock.sym)
                    // (positions.net.find(p => p.tradingsymbol === stock.sym)?.quantity || 0) != 0
                ) {
                    await sendMessageToChannel('🔔 Ignoring coz already in position', stock.sym)
                    continue
                }
                
                if (sheetData.find(s => s.stockSymbol === stock.sym)) {
                    await sendMessageToChannel('🔔 Ignoring coz already in sheet', stock.sym)
                    continue
                }

                let sheetEntry = await createBenoitOrdersEntries(stock);
                // sheetEntries.push(sheetEntry)
                // await appendRowsToMISD([sheetEntry])
            } catch (error) {
                console.error(error);
                await sendMessageToChannel(`🚨 Error running Benoit MIS Jobs`, stock, error?.message);
            }
        }


    } catch (error) {
        await sendMessageToChannel(`🚨 Error running Benoit MIS Jobs`, error?.message);
    }
}

/**
 * Creates Benoit orders entries in the sheet
 * @param {Object} stock - Stock object
 * @returns {Promise<void>}
 */
async function createBenoitOrdersEntries(stock) {
    try {

        const source = 'benoit';

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

        if (stock.direction == 'BULLISH') {
            return;
        } else {

            let triggerPadding = 1;
            if (stock.high < 20)
                triggerPadding = 0.1;
            else if (stock.high < 50)
                triggerPadding = 0.2;
            else if (stock.high < 100)
                triggerPadding = 0.3;
            else if (stock.high < 300)
                triggerPadding = 0.5;


            let [targetMultiplier, stopLossMultiplier] = [2, 1];
            let candleLength = stock.high - stock.low;

            // For BEARISH direction
            triggerPrice = stock.low - triggerPadding;
            stopLossPrice = stock.high + (candleLength * (stopLossMultiplier - 1)) + triggerPadding;
            targetPrice = '' //stock.low - (candleLength * targetMultiplier) - triggerPadding;

            if (stopLossPrice < lower_circuit_limit) {
                stopLossPrice = lower_circuit_limit + 0.1
                sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stock.quantity, stopLossPrice)
            }
            if (stopLossPrice > upper_circuit_limit) {
                stopLossPrice = upper_circuit_limit - 0.1
                sendMessageToChannel('🚪 SL Updated based on circuit limit', stock.sym, stock.quantity, stopLossPrice)
            }

            triggerPrice = Math.round(triggerPrice * 10) / 10;
            stopLossPrice = Math.round(stopLossPrice * 10) / 10;

            quantity = Math.ceil(BENOIT_RISK_AMOUNT / (stopLossPrice - triggerPrice));
            quantity = Math.abs(quantity);
            quantity = -quantity


        }

        const sheetEntry = {
            source: source,
            stockSymbol: stock.sym,
            reviseSL: '',
            ignore: true,    // '' = false
            status: 'new',    // '' = false
            time: +new Date(),
        }

        sheetEntry.targetPrice = targetPrice
        sheetEntry.stopLossPrice = stopLossPrice
        sheetEntry.triggerPrice = triggerPrice
        sheetEntry.quantity = quantity

        await appendRowsToMISD([sheetEntry], source)
    } catch (error) {
        console.error(error);
        await sendMessageToChannel(`🚨 Error creating Benoit orders`, error?.message);
        return;
    }
}

/**
 * Creates Benoit orders for a given stock
 * @returns {Promise<void>}
 */
async function cancelBenoitOrders() {
    try {

        let benoitSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = benoitSheetData.map(a => a[1])
        const colHeaders = benoitSheetData[0]
        benoitSheetData = processSheetWithHeaders(benoitSheetData)

        let updates = []

        for (const order of benoitSheetData) {
            try {

                if (order.status != 'new') continue;
                if (order.symbol[0] == '-' || order.symbol[0] == '*') continue;
                const timeSinceScan = +new Date() - Number(order.time);
                // Cancel if the order was scanned more than 10 minutes ago
                if (timeSinceScan < 1000 * 60 * CANCEL_AFTER_MINUTES) continue;

                await sendMessageToChannel('❎ Cancelled Benoit order:', order.symbol, order.quantity, order.status, order.source);

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
                await sendMessageToChannel('🚨 Error cancelling Benoit order:', order.symbol, order.quantity, error?.message);
            }
        }

        if (updates.length > 0) {
            await bulkUpdateCells(updates)
        }
    } catch (error) {
        console.error(error);
        await sendMessageToChannel(`🚨 Error cancelling Benoit orders`, error?.message);
        return;
    }
}

/**
 * Updates stop loss prices for Benoit orders in the MIS-ALPHA sheet
 * @param {Function} calculateExtremePrice - Function to calculate extreme prices
 * @returns {Promise<void>}
 */
async function updateBenoitStopLoss() {
    try {
        await sendMessageToChannel('⌛️ Executing Update Benoit Stop Loss Job');

        let benoitSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = benoitSheetData.map(a => a[1])
        const colHeaders = benoitSheetData[0]
        benoitSheetData = processSheetWithHeaders(benoitSheetData)

        let updates = []

        for (const order of benoitSheetData) {
            let newPrice, shouldUpdate, ltp;
            try {
                if (order.status != 'triggered') continue;

                // Skip stocks that are closed / cancelled
                if (order.symbol[0] == '*' || order.symbol[0] == '-') continue;

                const sym = order.symbol;
                const isBearish = parseFloat(order.quantity) < 0;

                // Calculate new stop loss price based on extreme price
                newPrice = isBearish 
                    ? await calculateExtremePrice(sym, 'highest', 15)
                    : await calculateExtremePrice(sym, 'lowest', 15);

                // Get current LTP to validate the new SL price
                ltp = await kiteSession.kc.getLTP([`NSE:${sym}`]);
                ltp = ltp[`NSE:${sym}`]?.last_price;

                // Get existing stop loss price from sheet
                const existingStopLoss = parseFloat(order.stop_loss);
                if (isNaN(existingStopLoss)) continue;

                // Only update if new price is better than existing
                shouldUpdate = isBearish 
                    ? newPrice < existingStopLoss
                    : newPrice > existingStopLoss;

                if (shouldUpdate) {
                    // Round to 1 decimal place
                    newPrice = Math.round(newPrice * 10) / 10;

                    const [row, col] = getStockLoc(order.symbol, 'Stop Loss', rowHeaders, colHeaders)
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(col) + String(row), 
                        values: [[newPrice]], 
                    })

                    await sendMessageToChannel(`🔄 Updated Benoit SL for ${sym}`, `Old: ${existingStopLoss}`, `New: ${newPrice}`, `LTP: ${ltp}`);
                }
            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🚨 Error updating Benoit stop loss:', order.symbol, newPrice, ltp, shouldUpdate, error?.message);
            }
        }

        if (updates.length > 0) {
            await bulkUpdateCells(updates)
            await sendMessageToChannel(`✅ Updated ${updates.length} Benoit stop loss prices`);
        }
    } catch (error) {
        console.error(error);
        await sendMessageToChannel(`🚨 Error updating Benoit stop loss prices`, error?.message);
        return;
    }
}

/**
 * Checks if a price condition is met in both the current candle and at least one more candle
 * within the lookback period (default 3 hours)
 * 
 * @param {number} currentIndex - Index of current candle in data array
 * @param {number} priceLevel - Price level to check against
 * @param {string} conditionType - Type of condition: 'trigger_bullish', 'trigger_bearish', 'stoploss_bullish', 'stoploss_bearish'
 * @param {Array} data - Array of candle data
 * @param {number} startTime - Earliest time to look back from (orderTime for triggers, trigger execution time for exits)
 * @param {number} lookbackHours - Number of hours to look back for confirmation (default 3)
 * @returns {object} - {isConfirmed: boolean, confirmationCount: number, confirmationTimes: array}
 */
function checkDoubleConfirmation(currentIndex, priceLevel, conditionType, data, startTime, lookbackHours = 3) {
    const currentCandle = data[currentIndex];
    const lookbackPeriodMs = lookbackHours * 60 * 60 * 1000;
    const lookbackStartTime = Math.max(
        currentCandle.time - lookbackPeriodMs,
        startTime  // Don't look back before the order was placed or position opened
    );
    
    console.debug(`[checkDoubleConfirmation] Starting check:`, {
        currentIndex,
        priceLevel,
        conditionType,
        lookbackHours,
        currentCandleTime: new Date(currentCandle.time).toISOString(),
        lookbackStartTime: new Date(lookbackStartTime).toISOString(),
        startTime: new Date(startTime).toISOString(),
        totalCandles: data.length
    });
    
    // Count how many candles in the lookback period meet the condition
    let confirmationCount = 0;
    const confirmationTimes = [];
    let candlesChecked = 0;

    // Start from current index and go backwards
    for (let i = currentIndex; i >= 0; i--) {
        const candle = data[i];
        
        // Stop if we've gone beyond the lookback period
        if (candle.time < lookbackStartTime) {
            console.debug(`[checkDoubleConfirmation] Stopped at candle ${i}, time ${new Date(candle.time).toISOString()} is before lookback start`);
            break;
        }

        candlesChecked++;
        let conditionMet = false;

        switch (conditionType) {
            case 'trigger_bullish':
                // For bullish trigger, check if high reached or exceeded trigger price
                conditionMet = candle.high >= priceLevel;
                break;
                
            case 'trigger_bearish':
                // For bearish trigger, check if low reached or went below trigger price
                conditionMet = candle.low <= priceLevel;
                break;
                
            case 'stoploss_bullish':
                // For bullish stop loss, check if low reached or went below stop loss
                conditionMet = candle.low <= priceLevel;
                break;
                
            case 'stoploss_bearish':
                // For bearish stop loss, check if high reached or exceeded stop loss
                conditionMet = candle.high >= priceLevel;
                break;

            default:
                console.warn(`Unknown condition type: ${conditionType}`);
                return { isConfirmed: false, confirmationCount: 0, confirmationTimes: [] };
        }

        if (conditionMet) {
            confirmationCount++;
            confirmationTimes.push(candle.time);
            console.debug(`[checkDoubleConfirmation] Condition met at candle ${i}:`, {
                time: new Date(candle.time).toISOString(),
                high: candle.high,
                low: candle.low,
                priceLevel,
                confirmationCount
            });
        }
    }

    const isConfirmed = confirmationCount >= 2;
    console.debug(`[checkDoubleConfirmation] Result:`, {
        isConfirmed,
        confirmationCount,
        candlesChecked,
        confirmationTimes: confirmationTimes.map(t => new Date(t).toISOString())
    });
    
    return { isConfirmed, confirmationCount, confirmationTimes };
}

/**
 * Monitors Zaire scans stored in MIS Alpha sheet with source "zaire" and status "new"
 * Checks for double confirmation of trigger or stop loss hits
 */
async function checkBenoitDoubleConfirmation(startDate = null, endDate = null) {
    try {
        await sendMessageToChannel('⌛️ Executing Zaire Double Confirmation Check');

        await kiteSession.authenticate();

        // Read MIS-ALPHA sheet data
        let stockData = await readSheetData('MIS-ALPHA!A2:W1000');
        stockData = processMISSheetData(stockData);

        // Used to update status of the order in the sheet
        let benoitSheetData = await readSheetData('MIS-ALPHA!A1:W1000')
        const rowHeaders = benoitSheetData.map(a => a[1])
        const colHeaders = benoitSheetData[0]

        tag = 'benoit'

        // Filter for Zaire entries with status "new"
        const benoitStocks = stockData.filter(s => 
            s.source?.toLowerCase() === 'benoit' && 
            (s.status?.toLowerCase() === 'new' || s.status?.toLowerCase() === 'triggered') &&
            s.stockSymbol && 
            s.stockSymbol[0] !== '-' && 
            s.stockSymbol[0] !== '*'
        );

        if (benoitStocks.length === 0) {
            await sendMessageToChannel('ℹ️ No Benoit stocks with status "new" or "triggered" found');
            return;
        }

        const newCount = benoitStocks.filter(s => s.status?.toLowerCase() === 'new').length;
        const triggeredCount = benoitStocks.filter(s => s.status?.toLowerCase() === 'triggered').length;
        await sendMessageToChannel(`🔍 Checking ${benoitStocks.length} Benoit stocks for double confirmation`, `New: ${newCount}`, `Triggered: ${triggeredCount}`);

        let updates = [];

        let orderResponse = null;
        
        for (const stock of benoitStocks) {
            try {
                const sym = stock.stockSymbol;
                const direction = stock.type; // 'BULLISH' or 'BEARISH'
                
                // Fetch recent 5-minute data (last 1 day)
                let data = await getDataFromYahoo(sym, 1, '5m', startDate, endDate);
                data = processYahooData(data, '5m', false, false);

                if (!data || data.length === 0) {
                    await sendMessageToChannel(`⚠️ No data available for ${sym}`);
                    continue;
                }

                // Get current LTP
                const nseSymbol = `NSE:${sym}`;
                let ltp;
                try {
                    const ltpData = await kiteSession.kc.getLTP([nseSymbol]);
                    ltp = ltpData[nseSymbol]?.last_price;
                } catch (error) {
                    await sendMessageToChannel(`⚠️ Could not fetch LTP for ${sym}`);
                    continue;
                }

                // Action time is the time when the order was placed or the position was opened
                let actionTime = Number(stock.time);
                // Assume order was placed at the beginning of the day or 3 hours ago
                let startTime = Math.max(Date.now() - (3 * 60 * 60 * 1000), actionTime);

                const currentIndex = data.length - 1;

                let triggerConfirmation = { isConfirmed: false, confirmationCount: 0, confirmationTimes: [] };
                let stopLossConfirmation = { isConfirmed: false, confirmationCount: 0, confirmationTimes: [] };

                if (stock.status?.toLowerCase() === 'new') {
                    // Check trigger condition with double confirmation
                    const triggerConditionType = direction === 'BULLISH' ? 'trigger_bullish' : 'trigger_bearish';
                    triggerConfirmation = checkDoubleConfirmation(
                        currentIndex,
                        stock.triggerPrice,
                        triggerConditionType,
                        data,
                        startTime,
                        3
                    );
                }

                // Check stop loss condition with double confirmation (if applicable)
                if (stock.stopLossPrice && stock.status?.toLowerCase() === 'triggered') {
                    const stopLossConditionType = direction === 'BULLISH' ? 'stoploss_bullish' : 'stoploss_bearish';
                    stopLossConfirmation = checkDoubleConfirmation(
                        currentIndex,
                        stock.stopLossPrice,
                        stopLossConditionType,
                        data,
                        startTime,
                        3
                    );
                }

                // Send notifications based on confirmation results
                if (triggerConfirmation.isConfirmed) {
                    await sendMessageToChannel(
                        `✅ ${stock.stockSymbol} - Trigger CONFIRMED (${triggerConfirmation.confirmationCount} hits)`,
                        `Direction: ${direction}, Trigger: ${stock.triggerPrice}, LTP: ${ltp}`,
                        `Confirmation times: ${triggerConfirmation.confirmationTimes.map(t => getDateStringIND(new Date(t))).join(', ')}`
                    );

                    const orderType = direction === 'BULLISH' ? 'BUY' : 'SELL';
                    orderResponse = await placeOrder(orderType, 'MARKET', null, stock.quantity, stock, `trigger-m-${tag}`)
                    await logOrder('PLACED', 'TRIGGER', orderResponse)

                    const [rowS, colS] = getStockLoc(stock.stockSymbol, 'Status', rowHeaders, colHeaders)
                    const [rowT, colT] = getStockLoc(stock.stockSymbol, 'Time', rowHeaders, colHeaders)
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colS) + String(rowS), 
                        values: [['triggered']], 
                    })
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colT) + String(rowT), 
                        values: [[+new Date()]], 
                    })
                } 
                // else if (triggerConfirmation.confirmationCount > 0) {
                //     await sendMessageToChannel(
                //         `⚠️ ${sym} - Trigger hit but NOT confirmed (${triggerConfirmation.confirmationCount}/2 hits)`,
                //         `Direction: ${direction}, Trigger: ${stock.triggerPrice}, LTP: ${ltp}`
                //     );
                // }

                if (stopLossConfirmation.isConfirmed) {
                    await sendMessageToChannel(
                        `🛑 ${sym} - Stop Loss CONFIRMED (${stopLossConfirmation.confirmationCount} hits)`,
                        `Direction: ${direction}, Stop Loss: ${stock.stopLossPrice}, LTP: ${ltp}`,
                        `Confirmation times: ${stopLossConfirmation.confirmationTimes.map(t => getDateStringIND(new Date(t))).join(', ')}`
                    );

                    const orderType = direction === 'BULLISH' ? 'SELL' : 'BUY';
                    orderResponse = await placeOrder(orderType, 'MARKET', null, stock.quantity, stock, `sl-m-${tag}`)
                    await logOrder('PLACED', 'STOP LOSS', orderResponse)

                    const [rowS, colS] = getStockLoc(stock.stockSymbol, 'Status', rowHeaders, colHeaders)
                    updates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(colS) + String(rowS), 
                        values: [['stopped']], 
                    })
                } 
                // else if (stopLossConfirmation.confirmationCount > 0) {
                //     await sendMessageToChannel(
                //         `⚠️ ${sym} - Stop Loss hit but NOT confirmed (${stopLossConfirmation.confirmationCount}/2 hits)`,
                //         `Direction: ${direction}, Stop Loss: ${stock.stopLossPrice}, LTP: ${ltp}`
                //     );
                // }

                if (updates.length > 0) {
                    await bulkUpdateCells(updates)
                }
                updates = []

            } catch (error) {
                console.error(`Error checking double confirmation for ${stock.stockSymbol}:`, error);
                await sendMessageToChannel(`🚨 Error checking ${stock.stockSymbol}:`, error?.message);
            }
        }

        await sendMessageToChannel('✅ Completed Benoit Double Confirmation Check');

        await sendMessageToChannel('❌ Cancelling old Benoit orders')

        cancelBenoitOrders()


    } catch (error) {
        await sendMessageToChannel('🚨 Error running Benoit Double Confirmation Check', error?.message);
        console.error("🚨 Error running Benoit Double Confirmation Check: ", error?.message);
    }
}

module.exports = {
    createBenoitOrdersEntries,
    cancelBenoitOrders,
    updateBenoitStopLoss,
    checkBenoitDoubleConfirmation,
    setupBenoitOrders
}