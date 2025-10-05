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
const { calculateExtremePrice } = require('../analytics');
const BENOIT_RISK_AMOUNT = 200;


/**
 * Creates Benoit orders entries in the sheet
 * @param {Object} stock - Stock object
 * @returns {Promise<void>}
 */
async function createBenoitOrdersEntries(stock) {
    try {

        source = 'benoit';

        let sym = `NSE:${stock.sym}`
        let quote = await kiteSession.kc.getQuote([sym])
        let ltp = quote[sym]?.last_price
        if (!ltp) {
            await sendMessageToChannel('🔕 LTP not found for', stock.sym);
            return;
        }
        let upper_circuit_limit = quote[sym]?.upper_circuit_limit
        let lower_circuit_limit = quote[sym]?.lower_circuit_limit

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

            let triggerPrice, targetPrice, stopLossPrice;

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

            let quantity = Math.ceil(BENOIT_RISK_AMOUNT / (stopLossPrice - triggerPrice));
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
                const timeSinceScan = +new Date() - order.time;
                // Cancel if the order was scanned more than 10 minutes ago
                if (timeSinceScan < 1000 * 60 * 10) continue;

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

module.exports = {
    createBenoitOrdersEntries,
    cancelBenoitOrders,
    updateBenoitStopLoss
}