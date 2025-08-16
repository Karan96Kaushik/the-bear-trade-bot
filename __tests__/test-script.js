const { scanZaireStocks, getDateRange, scanLightyearD2Stocks, checkV3ConditionsNumerical } = require("../analytics")
const { readSheetData, processMISSheetData, getStockLoc, appendRowsToMISD, processSheetWithHeaders } = require("../gsheets")
const { updateNameInSheetForClosedOrder, processSuccessfulOrder } = require("../kite/processor")
const { setupZaireOrders } = require("../kite/scheduledJobs")
const { processMoneycontrolData, getMoneycontrolData } = require("../kite/utils");

const { kiteSession } = require("../kite/setup")
// const { placeOrder } = require("../kite/processor")
const { getDateStringIND, getDataFromYahoo, processYahooData } = require("../kite/utils")
const { Simulator } = require("../simulator/SimulatorV3")

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MAX_ORDER_VALUE = 200000
const MIN_ORDER_VALUE = 0
const RISK_AMOUNT = 100;


const { Lambda, InvokeCommand } = require("@aws-sdk/client-lambda");
// const OrderLog = require('../models/OrderLog');

// Initialize Lambda client
const lambdaClient = new Lambda({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

async function scanZaireStocksLambda(stockList, checkV2, checkV3, interval, params, options) {
    try {

        // Call lambda function for each batch of 20 stocks
        const batches = [];
        for (let i = 0; i < stockList.length; i += 20) {
            batches.push(stockList.slice(i, i + 20));
        }

        let resultsArray = await Promise.all(batches.map(async (batch) => {
            const command = new InvokeCommand({
                FunctionName: 'scanZaireStocks',
                Payload: JSON.stringify({
                    stockList: batch,
                    checkV2,
                    checkV3,
                    interval,
                    params,
                    options: {
                        timeout: 10000
                    }
                })
            });
            let result = await lambdaClient.send(command);
            result = JSON.parse(new TextDecoder().decode(result.Payload));
            result = JSON.parse(result.body);
            console.log('🔔 Zaire Lambda - ', result.data);
            return result.data;

        }))

        // Combine all keys of resultsArray
        let result = {}
        for (const key of Object.keys(resultsArray[0])) {
            result[key] = resultsArray.map(r => r[key]).flat()
        }

        return result

    } catch (error) {
        console.trace(error)
    }
}

const zaireV3Params = {
    TOUCHING_SMA_TOLERANCE: 0.0003,
    TOUCHING_SMA_15_TOLERANCE: 0.0003,
    NARROW_RANGE_TOLERANCE: 0.0046,
    WIDE_RANGE_TOLERANCE: 0.0015,
    CANDLE_CONDITIONS_SLOPE_TOLERANCE: 1,
    BASE_CONDITIONS_SLOPE_TOLERANCE: 1,
    MA_WINDOW_5: 22,
    MA_WINDOW: 44,
    CHECK_75MIN: 1
}

const run = async () => {

    try {

        let niftyList = await readSheetData('HIGHBETA!J2:J550')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])

        console.time('scanZaireStocksLambda')
        let result = await scanZaireStocksLambda(niftyList, false, true, '5m', zaireV3Params, {
            timeout: 10000
        })
        console.timeEnd('scanZaireStocksLambda')
        console.log(result)

        return


        await kiteSession.authenticate();
        const positions = await kiteSession.kc.getPositions();

        console.table(positions.day)
        console.table(positions.net)

        return

        let lightyearSheetData = await readSheetData('MIS-LIGHTYEAR!A1:W1000')
        lightyearSheetData = processSheetWithHeaders(lightyearSheetData)

        for (const stock of lightyearSheetData) {
                let status = ''

                let col = Object.keys(stock).findIndex(key => key === 'status')

                let { entry_trigger_price, final_stop_loss, target, direction } = stock

                entry_trigger_price = Number(entry_trigger_price)
                final_stop_loss = Number(final_stop_loss)
                target = Number(target)

                direction = direction.trim().toUpperCase()

                let from = new Date();
                from.setUTCHours(6,0,10,0)
                from.setHours(from.getHours() - 1)
                let to = new Date();
                to.setUTCHours(6,0,10,0)

                console.log(stock.symbol, from, to)
                
                const interval = 5
                let pastData = await getMoneycontrolData(stock.symbol, from, to, interval, false);
                pastData = processMoneycontrolData(pastData, interval);

                // Filter out data after 3:30 PM - not sure why this is happening
                pastData = pastData.filter(d => new Date(d.time).getUTCHours() < 10)
                pastData = pastData.filter(d => d.time > +from)

                pastData = pastData.map(d => ({...d, time: getDateStringIND(new Date(d.time))}))

                const last5mins = pastData.pop()
                // excludes past 5 mins
                const last3hours = pastData.slice(-(12*3))

                console.log(last5mins, last3hours)
            }

        return
        // await kiteSession.authenticate()

        // let res1  = await placeOrder('SELL', 'SL', 31, 1, {stockSymbol: 'TRIDENT', quantity: 1, triggerPrice: 100}, 'stoploss-test')
        // console.log(res1)
        // console.time('ltp')
        // let ltp = await kiteSession.kc.getLTP(['NSE:TRIDENT']);
        // console.timeEnd('ltp')

        // console.time('quote')
        // let quote = await kiteSession.kc.getQuote(['NSE:TRIDENT']);
        // console.timeEnd('quote')
        // console.log(quote)

        // quote = quote['NSE:TRIDENT']?.last_price
        // console.log(quote)

        // await updateNameInSheetForClosedOrder({
        //     order_id: 'DEVMD1000',
        //     tradingsymbol: 'TRIDENT',
        //     quantity: 1,
        //     triggerPrice: 34.2,
        // })

        // return


        niftyList = await readSheetData('HIGHBETA!D2:D550')  // await getDhanNIFTY50Data();
        niftyList = niftyList.map(stock => stock[0])
        // niftyList = ['BEL']

        // const selectedStocks = await (niftyList, '2024-12-27T04:11:10Z', '5m')
        // console.log(selectedStocks)

        // await kiteSession.authenticate();
        // const positions = await kiteSession.kc.getPositions();
        // const orders = await kiteSession.kc.getOrders();

        // await setupZaireOrders(0,1)

        // let date = new Date('2025-01-28T03:51:10Z')


        niftyList = ['GODREJPROP', 'LT']

        let date = new Date('2025-06-16T03:45:10Z')
        date = new Date('2025-06-25T07:10:10Z')

        console.log(date)

        for (let i = 0; i < 65; i++) {
            console.log('--------------------------------')
            console.log(getDateStringIND(date))
            date = new Date(+date + 5 * 60 * 1000)
            // const selectedStocks = await (niftyList, date, '5m')
            console.time('scanZaireStocks')
            let { selectedStocks } = await scanLightyearD2Stocks(niftyList, date, '5m', false, zaireV3Params);
            // let { selectedStocks } = await scanZaireStocks(niftyList, date, '5m', false, true, false, zaireV3Params);
            console.timeEnd('scanZaireStocks')
            if (selectedStocks.length > 0) 
            console.log(selectedStocks)
        }

        return 

        let traded = []

        for (let i = 0; i < 100; i++) {
            // console.log(getDateStringIND(date), '---------')


            if (selectedStocks.length > 0 && false) {

                // continue

                for (let index = 0; index < selectedStocks.length; index++) {
                    const stock = selectedStocks[index];

                    const { startDate, endDate } = getDateRange(date);
                    endDate.setUTCHours(11)
    
                    let yahooData = await getDataFromYahoo(stock.sym, 5, '1m', startDate, endDate, true);
                    yahooData = processYahooData(yahooData)

                    let triggerPadding = 1
                    if (stock.high < 20)
                        triggerPadding = 0.1
                    else if (stock.high < 50)
                        triggerPadding = 0.2
                    else if (stock.high < 100)
                        triggerPadding = 0.3
                    else if (stock.high < 300)
                        triggerPadding = 0.5

                    let direction = stock.direction

                    let triggerPrice, targetPrice, stopLossPrice

                    if (direction == 'BULLISH') {
                        triggerPrice = stock.high + triggerPadding;
                        // Stop loss is low
                        stopLossPrice = stock.low - triggerPadding;
                        targetPrice = stock.high + ((triggerPrice - stopLossPrice) * 2) // triggerPrice;
                    }
                    else {
                        triggerPrice = stock.low - triggerPadding;
                        // Stop loss is high
                        stopLossPrice = stock.high + triggerPadding;
                        // Target price is double the difference between trigger price and low
                        targetPrice = stock.low - ((stopLossPrice - triggerPrice) * 2)
            
                    }
                    
                    triggerPrice = Math.round(triggerPrice * 10) / 10;
                    stopLossPrice = Math.round(stopLossPrice * 10) / 10;
                    targetPrice = Math.round(targetPrice * 10) / 10;

                    let quantity = Math.ceil(RISK_AMOUNT / (triggerPrice - stopLossPrice));
                    if (quantity < 1)
                        quantity = 1
    
                    const sim = new Simulator({
                        stockSymbol: stock.sym,
                        triggerPrice,
                        targetPrice,
                        stopLossPrice,
                        quantity,
                        direction,
                        yahooData,
                        orderTime: date
                    })

                    sim.run()

                    if (sim.startedAt) {
                        traded.push({
                            startedAt: sim.startedAt,
                            placedAt: sim.orderTime,
                            pnl: sim.pnl,
                            sym: sim.stockSymbol,
                            data: yahooData,
                            actions: sim.tradeActions.map(s => ({...s, time: getDateStringIND(new Date(s.time))}))
                        })
                    }

                }

            }

            date = new Date(date.getTime() + 5 * 60 * 1000)
        }

        let filTraded = traded.filter(t => !traded.find(t1 => ((t1.startedAt < t.startedAt || +t1.placedAt < +t.placedAt) && (t.sym == t1.sym))))

        console.log(filTraded)
        // console.log(filTraded.map(t => [t.sym, t.pnl]))
        // console.log(filTraded.map(t => t.pnl).reduce((p,c) => p+c,0))


        // console.log(selectedStocks)

        // date = new Date('2024-12-26T08:11:10Z')
        // console.log(getDateStringIND(date), '---------')
        // selectedStocks = await scanZaireStocks(niftyList, date, '5m');

        // console.log(selectedStocks)
        // console.table(selectedStocks.map(a => ({...a, qty: Math.ceil(200/(a.high - a.low))})))

        
        // console.log(pos)

        return 

        console.log(orders)

        stockData = await readSheetData('MIS-ALPHA!A2:W1000')
        stockData = processMISSheetData(stockData)
        console.log(stockData)

        stockData = await readSheetData('MIS-ALPHA!A1:W100')
        console.log(stockData)
        const rowHeaders = stockData.map(a => a[1])
        const colHeaders = stockData[0]
        console.log(rowHeaders)

        const [row, col] = getStockLoc('DCBBAN1K', 'Last Action', rowHeaders, colHeaders)
        console.log(row,col)

        let res
        if (false)
            res = await kiteSession.kc.placeOrder("amo", {
            exchange: "NSE",            // Exchange (NSE/BSE/MCX)
            tradingsymbol: "TRIDENT",
            transaction_type: "BUY",    // BUY or SELL
            quantity: 1, // Quantity of the stock
            order_type: "LIMIT",        // AMO orders can be LIMIT or MARKET
            price: '34.2',    // Limit price (if it's a LIMIT order)
            product: "CNC",             // AMO orders are generally used for CNC (delivery) trades
            validity: "DAY",            // Valid for the day
            disclosed_quantity: 0,      // Optional
            trigger_price: 0,           // Optional (for stop loss orders)
            guid:'DEVMD1000'
            // amo: true                   // Key flag to indicate that this is an AMO order
        });
    
        console.log(res)
        
    } catch (error) {
        console.trace(error)
    }
}

run()