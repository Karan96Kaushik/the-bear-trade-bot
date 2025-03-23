const { 
    getStockLoc, readSheetData, numberToExcelColumn, bulkUpdateCells, 
    getOrderLoc, processMISSheetData, appendRowsToMISD, appendRowsToSheet 
} = require("../gsheets")
const { sendMessageToChannel } = require("../slack-actions")
const { kiteSession } = require("./setup")
const { getDataFromYahoo, processYahooData, processMoneycontrolData, getMoneycontrolData } = require("./utils");
const { placeOrder, logOrder } = require("./processor");
const RISK_AMOUNT = 100;

async function createLightyearOrders(stock) {
    try {
        await kiteSession.authenticate();

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
        

        let direction = stock.direction;
        let entryTriggerPrice, targetPrice, finalStopLossPrice;

        if (direction == 'BULLISH') {
            entryTriggerPrice = stock.high + triggerPadding;
            finalStopLossPrice = Math.min(stock.prev.low, stock.low) - triggerPadding;
            targetPrice = entryTriggerPrice + ((entryTriggerPrice - finalStopLossPrice) * 2);
        }
        else if (direction == 'BEARISH') {
            entryTriggerPrice = stock.low - triggerPadding;
            finalStopLossPrice = Math.max(stock.prev.high, stock.high) + triggerPadding;
            targetPrice = entryTriggerPrice - ((finalStopLossPrice - entryTriggerPrice) * 2);
        }
        
        entryTriggerPrice = Math.round(entryTriggerPrice * 10) / 10;
        finalStopLossPrice = Math.round(finalStopLossPrice * 10) / 10;
        targetPrice = Math.round(targetPrice * 10) / 10;

        let quantity = Math.ceil(RISK_AMOUNT / Math.abs(entryTriggerPrice - finalStopLossPrice));

        if (stock.direction == 'BULLISH') quantity = Math.abs(quantity);
        else quantity = -Math.abs(quantity);

        let startDate = new Date(stock.time.split(' ')[0]);
        startDate.setDate(startDate.getDate() + (startDate.getDay() == 5 ? 3 : startDate.getDay() == 6 ? 2 : 1));

        return [
                stock.sym,
                startDate.toISOString().split('T')[0],
                entryTriggerPrice,
                finalStopLossPrice,
                targetPrice,
                quantity,
                '',      // Last action
                '',      // ignore
                true,    // reviseSL
            ]                

        // const sym = `NSE:${stock.sym}`
        // let ltp = await kiteSession.kc.getQuote([sym]);
        // ltp = ltp[sym]?.last_price
        // if (!ltp) {
        //     await sendMessageToChannel('🔕 LTP not found for', stock.sym)
        //     return
        // }


    } catch (error) {
        await sendMessageToChannel('🚨 Error running Zaire MIS Jobs', stock.sym, error?.message);
        console.error("🚨 Error running Zaire MIS Jobs: ", stock.sym, error?.message);
        await logOrder('FAILED - PLACE', 'ZAIRE', {tradingsymbol: stock.sym, error: error?.message, ...stock})
        // throw error;
    }
}

async function setupLightyearDayOneOrders(stocks) {
    try {
        await kiteSession.authenticate();

        let sheetEntries = []

        for (const stock of stocks) {
            try {
                const [
                    sym,
                    startDate,
                    entryTriggerPrice,
                    finalStopLossPrice,
                    targetPrice,
                    quantity,
                ] = stock

                let triggerPrice, stopLossPrice;

                let direction = quantity > 0 ? 'BULLISH' : 'BEARISH';

                let from = new Date();
                from.setHours(from.getHours() - (from.getDay() == 0 ? 3 : from.getDay() == 6 ? 2 : 1));
                let to = new Date();
                to.setHours(to.getHours() + 1);
                let pastData = await getMoneycontrolData(sym, from, to, 15, false);
                pastData = processMoneycontrolData(pastData);

                let last45mins = pastData.slice(-3);
                let last15mins = pastData.slice(-1);

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
                

                if (direction == 'BULLISH') {
                    triggerPrice = entryTriggerPrice;
                    stopLossPrice = last45mins.reduce((min, curr) => Math.min(min, curr.low), 1000000) - triggerPadding;
                }
                else if (direction == 'BEARISH') {
                    triggerPrice = entryTriggerPrice;
                    stopLossPrice = last45mins.reduce((max, curr) => Math.max(max, curr.high), 0) + triggerPadding;
                }

                sheetEntries.push({
                    stockSymbol: sym,
                    triggerPrice,
                    stopLossPrice,
                    targetPrice,
                    quantity,
                    lastAction: '',
                    ignore: '',
                    reviseSL: true,
                })
            }
            catch (error) {
                await sendMessageToChannel('🚨 Error setting up Lightyear Day One Order', stock[0], error?.message);
                console.error("🚨 Error setting up Lightyear Day One Order: ", stock[0], error?.message);
                throw error;
            }
        }

        return sheetEntries;
    }
    catch (error) {
        await sendMessageToChannel('🚨 Error running Lightyear Day One Orders', error?.message);
        console.error("🚨 Error running Lightyear Day One Orders: ", error?.message);
        throw error;
    }
}

module.exports = {
    createLightyearOrders,
    setupLightyearDayOneOrders
}