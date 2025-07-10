const { 
    getStockLoc, readSheetData, numberToExcelColumn, bulkUpdateCells, 
    getOrderLoc, processMISSheetData, appendRowsToMISD, appendRowsToSheet 
} = require("../gsheets")
const { sendMessageToChannel } = require("../slack-actions")
const { kiteSession } = require("./setup")
const { processMoneycontrolData, getMoneycontrolData, skipBackDateHolidays } = require("./utils");
const { placeOrder, logOrder } = require("./processor");

const RISK_AMOUNT = 100;

async function createLightyearOrders(stock) {
    try {
        await kiteSession.authenticate();

        // <20.  0.1.  :    20-50.  0.2  :  50-100     0.3. :    100- 300.   0.5.     >300    Re 1
        let triggerPadding = getTriggerPadding(stock.high);

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

        let startDate = new Date(stock.time.split(' ')[0]);
        skipForwardDateHolidays(startDate)

        return [
                stock.sym,
                startDate.toISOString().split('T')[0],
                entryTriggerPrice,
                finalStopLossPrice,
                targetPrice,
                direction,
                '',            // Status
                '',            // ignore
                '' // '75',    // reviseSL
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

const getTriggerPadding = (high) => {
    let triggerPadding = 1;
    if (high < 20)
        triggerPadding = 0.1;
    else if (high < 50)
        triggerPadding = 0.2;
    else if (high < 100)
        triggerPadding = 0.3;
    else if (high < 300)
        triggerPadding = 0.5;

    return triggerPadding;
}


async function setupLightyearDayOneOrders(stocks) {
    try {
        await kiteSession.authenticate();

        let sheetEntries = []

        for (const stock of stocks) {
            try {
                let [
                    sym,
                    startDate,
                    entryTriggerPrice,
                    finalStopLossPrice,
                    targetPrice,
                    direction,
                    status,
                ] = stock

                let triggerPrice, stopLossPrice, quantity;

                direction = direction.trim().toUpperCase()

                let from = new Date();
                skipBackDateHolidays(from)
                let to = new Date();
                let pastData = await getMoneycontrolData(sym, from, to, 15, false);
                pastData = processMoneycontrolData(pastData);

                // Filter out data after 3:30 PM - not sure why this is happening
                pastData = pastData.filter(d => new Date(d.time).getUTCHours() < 10)

                let last45mins = pastData.slice(-3);
                let last15mins = pastData.slice(-1);

                // <20.  0.1.  :    20-50.  0.2  :  50-100     0.3. :    100- 300.   0.5.     >300    Re 1
                let triggerPadding = getTriggerPadding(pastData[0].high);

                if (direction == 'BULLISH') {
                    triggerPrice = entryTriggerPrice;
                    stopLossPrice = last45mins.reduce((min, curr) => Math.min(min, curr.low), 1000000) - triggerPadding;
                    quantity = Math.abs(Math.ceil(RISK_AMOUNT / (entryTriggerPrice - stopLossPrice)));
                }
                else if (direction == 'BEARISH') {
                    triggerPrice = entryTriggerPrice;
                    // console.log('BR 45 min', stock.sym, last45mins.map(d => d.high), last45mins.reduce((max, curr) => Math.max(max, curr.high), 0), triggerPadding)
                    // console.log('BR 45 min', stock.sym, last45mins.map(d => getDateStringIND(d.time)))
                    stopLossPrice = last45mins.reduce((max, curr) => Math.max(max, curr.high), 0) + triggerPadding;
                    quantity = -Math.abs(Math.ceil(RISK_AMOUNT / (stopLossPrice - entryTriggerPrice)));
                }

                sheetEntries.push({
                    stockSymbol: sym,
                    triggerPrice,
                    stopLossPrice,
                    targetPrice,
                    quantity,
                    lastAction: '',
                    ignore: '',
                    reviseSL: '' // '75',
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

// Checks trigger hits for D1 orders every 5 mins - one hit and then another atleast 5 mins apart
async function checkTriggerHit(lightyearSheetData) {
    try {

        let updates = []

        let row = 1
        for (const stock of lightyearSheetData) {
            try {
                row += 1
                let status = ''

                let col = Object.keys(stock).findIndex(key => key === 'status')

                let { entry_trigger_price, final_stop_loss, target, direction } = stock

                entry_trigger_price = Number(entry_trigger_price)
                final_stop_loss = Number(final_stop_loss)
                target = Number(target)

                direction = direction.trim().toUpperCase()

                let from = new Date();
                from.setHours(from.getHours() - 6)
                let to = new Date();
                
                let pastData = await getMoneycontrolData(stock.symbol, from, to, 5, false);
                pastData = processMoneycontrolData(pastData);

                // Filter out data after 3:30 PM - not sure why this is happening
                pastData = pastData.filter(d => new Date(d.time).getUTCHours() < 10)
                pastData = pastData.filter(d => d.time > +from)

                const last5mins = pastData.pop()
                // excludes past 5 mins
                const last3hours = pastData.slice(-(12*3))


                // Check for double trigger hit
                if (direction == 'BULLISH') {
                    if (last5mins.high > entry_trigger_price) {
                        if (last3hours.some(d => d.high > entry_trigger_price)) {
                            status = 'Active'
                        }
                    }
                }
                else if (direction == 'BEARISH') {
                    if (last5mins.low < entry_trigger_price) {
                        if (last3hours.some(d => d.low < entry_trigger_price)) {
                            status = 'Active'
                        }
                    }
                }

                if (status) {
                    updates.push({
                        range: 'MIS-LIGHTYEAR!' + numberToExcelColumn(col) + String(row), 
                        values: [[status]], 
                    })
                }
            }
            catch (error) {
                await sendMessageToChannel('🚨 Error running Lightyear Trigger Hit Check', stock[0], error?.message);
                console.error("🚨 Error running Lightyear Trigger Hit Check: ", stock[0], error?.message);
                throw error;
            }

        }

        await bulkUpdateCells(updates)
        return
    }
    catch (error) {
        await sendMessageToChannel('🚨 Error running Lightyear Day One Orders', error?.message);
        console.error("🚨 Error running Lightyear Day One Orders: ", error?.message);
        throw error;
    }
}

async function updateLightyearSheet(lightyearSheetData, alphaSheetData, lightyearCompleteOrders) {
    try {

        let lightyearTriggerOrders = lightyearCompleteOrders.filter(o => o.tag?.includes('trigger'))
        let lightyearTargetOrders = lightyearCompleteOrders.filter(o => o.tag?.includes('target'))

        let updates = []
        let alphaUpdates = []
        let newOrders = []

        let row = 1
        for (const stock of lightyearSheetData) {
            try {
                row += 1

                // Only active and D1 orders
                if (stock.status && stock.status != 'Active') {
                    continue
                }

                let col = Object.keys(stock).findIndex(key => key === 'status')
                let ignoreCol = Object.keys(alphaSheetData[0]).findIndex(key => key === 'ignore')
                let alphaRow = (alphaSheetData.findIndex(s => s.symbol === stock.symbol)) + 2
                
                let status = ''
                let alphaIgnore = ''

                // let triggerOrder = lightyearTriggerOrders.find(o => o.tradingsymbol === stock.symbol)
                let targetOrder = lightyearTargetOrders.find(o => o.tradingsymbol === stock.symbol)

                // No status - it means that the order didnt reach trigger price
                if (!stock.status) {
                    status = 'Cancelled'
                    alphaIgnore = 'Cancelled'
                }
                // Active order
                else {

                    /* Following is commented because we are not changing to active at end of day, but 
                    during the day, if the stock reaches trigger price */
                    // if (!stock.status) {
                    //     status = 'Active'
                    // }

                    let { entry_trigger_price, final_stop_loss, target, direction } = stock
                    entry_trigger_price = Number(entry_trigger_price)
                    final_stop_loss = Number(final_stop_loss)
                    target = Number(target)

                    direction = direction.trim().toUpperCase()

                    let triggerPrice, stopLossPrice, targetPrice;

                    targetPrice = target

                    let from = new Date();
                    from.setDate(from.getDate() - 1)
                    let to = new Date();
                    
                    let pastData = await getMoneycontrolData(stock.symbol, from, to, 15, false);
                    pastData = processMoneycontrolData(pastData);

                    // Filter out data after 3:30 PM - not sure why this is happening
                    pastData = pastData.filter(d => new Date(d.time).getUTCHours() < 10)

                    pastData = pastData.filter(d => d.time > +from)

                    let last45mins = pastData.slice(-3);
                    let last15mins = pastData.slice(-1);

                    let dayLow = pastData.reduce((min, curr) => Math.min(min, (curr.low || 999999)), 1000000)
                    let dayHigh = pastData.reduce((max, curr) => Math.max(max, (curr.high || 0)), 0)

                    if (direction == 'BULLISH' && dayLow < final_stop_loss) {
                        status = 'Stoploss'
                    }
                    else if (direction == 'BEARISH' && dayHigh > final_stop_loss) {
                        status = 'Stoploss'
                    }
                    else if (targetOrder) {
                        status = 'Target'
                    }
                    else {

                        let triggerPadding = getTriggerPadding(entry_trigger_price);
        
                        if (direction == 'BULLISH') {
                            let last15minsHigh = last15mins.reduce((max, curr) => Math.max(max, (curr.high || 0)), 0) + triggerPadding;
                            let last45minsLow = last45mins.reduce((min, curr) => Math.min(min, (curr.low || 999999)), 1000000) - triggerPadding;
                            triggerPrice = last15minsHigh;
                            stopLossPrice = last45minsLow;
                        }
                        else if (direction == 'BEARISH') {
                            let last15minsLow = last15mins.reduce((min, curr) => Math.min(min, (curr.low || 999999)), 1000000) - triggerPadding;
                            let last45minsHigh = last45mins.reduce((max, curr) => Math.max(max, (curr.high || 0)), 0) + triggerPadding;
                            triggerPrice = last15minsLow;
                            stopLossPrice = last45minsHigh;
                        }

                        quantity = Math.ceil(RISK_AMOUNT / (triggerPrice - stopLossPrice))
        
                        newOrders.push({
                            stockSymbol: stock.symbol,
                            triggerPrice,
                            stopLossPrice,
                            targetPrice,
                            quantity,
                            lastAction: '',
                            ignore: '',
                            reviseSL: '' // '75',
                        })

                    }

                }

                if (status) {
                    updates.push({
                        range: 'MIS-LIGHTYEAR!' + numberToExcelColumn(col) + String(row), 
                        values: [[status]], 
                    })
                }

                if (alphaIgnore) {

                    if (alphaRow == 1) {
                        sendMessageToChannel('🚨 Lightyear Alpha row is 1', stock.symbol)
                        continue
                    }

                    alphaUpdates.push({
                        range: 'MIS-ALPHA!' + numberToExcelColumn(ignoreCol) + String(alphaRow), 
                        values: [[alphaIgnore]], 
                    })
                }
            }
            catch (error) {
                await sendMessageToChannel('🚨 Error updating Lightyear order', stock.sym, error?.message);
                console.error("🚨 Error updating Lightyear order: ", stock.sym, error?.message);
            }
        }

        await bulkUpdateCells(updates)
        await bulkUpdateCells(alphaUpdates)

        // Commented because no longer adding d2 orders
        // await appendRowsToMISD(newOrders, 'Lightyear')

    }
    catch (error) {
        await sendMessageToChannel('🚨 Error updating Lightyear Sheet', error?.message);
        console.error("🚨 Error updating Lightyear Sheet: ", error?.message);
        throw error;
    }
}


async function skipForwardDateHolidays(date) {

    date.setDate(date.getDate() + 1)

    const holidaySkips = {
        '2025-03-31': 1,
        '2024-04-10': 1, 
        '2024-04-14': 1, 
        '2024-04-18': 3, 
        '2024-05-01': 1, 
        '2024-08-15': 3, 
        '2024-08-27': 1, 
        // '2024-10-02': 1, 
        // '2024-10-02': 1, 
        // '2024-10-21': 1, 
        // '2024-10-21': 1, 
    }

    const dateString = date.toISOString().split('T')[0]

    if (holidaySkips[dateString]) {
        date.setDate(date.getDate() - holidaySkips[dateString])
    }
    if ([0, 6].includes(date.getDay())) {
        date.setDate(date.getDate() + (date.getDay() == 0 ? 1 : date.getDay() == 6 ? 2 : 1));
        skipForwardDateHolidays(date)
    }
}

module.exports = {
    createLightyearOrders,
    setupLightyearDayOneOrders,
    updateLightyearSheet,
    skipBackDateHolidays
}