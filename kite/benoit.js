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

const BENOIT_RISK_AMOUNT = 200;


/**
 * Creates Benoit orders entries in the sheet
 * @param {Object} stock - Stock object
 * @returns {Promise<void>}
 */
async function createBenoitOrdersEntries(stock) {
    try {
        await kiteSession.authenticate();

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

            let direction = stock.direction; // Always BEARISH for Benoit
            let triggerPrice, targetPrice, stopLossPrice;

            let [targetMultiplier, stopLossMultiplier] = simulation.targetStopLossRatio.split(':').map(Number);
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
            targetPrice = Math.round(targetPrice * 10) / 10;

            let quantity = Math.ceil(BENOIT_RISK_AMOUNT / (stopLossPrice - triggerPrice));
            quantity = Math.abs(quantity);
            quantity = -quantity


        }

        const sheetEntry = {
            source: source,
            stockSymbol: stock.sym,
            reviseSL: true,
            ignore: true,    // '' = false
            status: 'new',    // '' = false
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

module.exports = {
    createBenoitOrdersEntries,
    cancelBenoitOrders
}