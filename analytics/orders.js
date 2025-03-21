const { getDateStringIND } = require('../kite/utils');
const { addMovingAverage } = require('../analytics');
const OrderLog = require('../models/OrderLog');
const { connectToDatabase } = require('../modules/db');
const { getDataFromYahoo, processYahooData } = require('../kite/utils');
const { kiteSession } = require('../kite/setup');

const calculatePnLForPairs = async (data) => {
    const trades = {};
    const pnlResults = [];

    // Group trades by symbol and pair them
    data.forEach(trade => {
        const symbol = trade.tradingsymbol;
        if (!trades[symbol]) {
            trades[symbol] = [];
        }
        trades[symbol].push(trade);
    });

    // Calculate PnL for each pair
    Object.keys(trades).forEach(symbol => {
        const symbolTrades = trades[symbol];
        let i = 0;

        while (i < symbolTrades.length) {
            const entryTrade = symbolTrades[i];
            const exitTrade = symbolTrades[i + 1];

            if (symbol === 'ABCAPITAL') {
                console.table([entryTrade, exitTrade, ...trades[symbol]])
            }

            if (exitTrade && exitTrade.isExit) {
                // Calculate PnL for closed trade
                let pnl;
                if (entryTrade.transaction_type === 'BUY' && exitTrade.transaction_type === 'SELL') {
                    pnl = (exitTrade.price - entryTrade.price) * entryTrade.quantity;
                } else if (entryTrade.transaction_type === 'SELL' && exitTrade.transaction_type === 'BUY') {
                    pnl = (entryTrade.price - exitTrade.price) * entryTrade.quantity;
                } else {
                    pnl = null; // Invalid pair
                }

                pnlResults.push({
                    symbol,
                    entryTime: entryTrade._timestamp,
                    entryTime: entryTrade._timestamp,
                    exitTime: exitTrade._timestamp,
                    quantity: entryTrade.quantity,
                    entryPrice: entryTrade.price,
                    exitPrice: exitTrade.price,
                    source: entryTrade.source,
                    exitReason: exitTrade.exitReason,
                    direction: entryTrade.direction,
                    status: 'CLOSED',
                    pnl
                });

                i += 2; // Move to the next pair
            } else {
                // Trade is still open
                pnlResults.push({
                    symbol,
                    entryTime: entryTrade._timestamp,
                    exitTime: null,
                    quantity: entryTrade.quantity,
                    entryPrice: entryTrade.price,
                    exitPrice: null,
                    source: entryTrade.source,
                    exitReason: null,
                    direction: entryTrade.direction,
                    status: 'OPEN',
                    pnl: null
                });

                i += 1; // Move to the next trade
            }
        }
    });

    const openTradeSymbols = pnlResults.filter(a => a.status === 'OPEN').map(a => a.symbol).map(a => `NSE:${a}`);

    const ltps = await kiteSession.kc.getLTP(openTradeSymbols);

    const orders = await kiteSession.kc.getOrders();
    const openOrders = orders
                            .filter(o => o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
                            .filter(o => o.tag?.includes('target') || o.tag?.includes('stoploss'));

    // console.log(ltps, openTradeSymbols)

    pnlResults.forEach(a => {
        if (a.status === 'OPEN') {
            a.ltp = ltps[`NSE:${a.symbol}`].last_price;
            a.pnl = (a.direction === 'BULLISH' ? a.ltp - a.entryPrice : a.entryPrice - a.ltp) * a.quantity;
            let sl = openOrders.filter(o => o.tradingsymbol === a.symbol).find(o => o.tag?.includes('stoploss'));
            let t = openOrders.filter(o => o.tradingsymbol === a.symbol).find(o => o.tag?.includes('target'));
            sl = sl?.trigger_price || sl?.price || 'NA';
            t = t?.trigger_price || t?.price || 'NA';
            a.exitReason = `${sl}-${a.ltp}-${t}`;
        }
    });

    pnlResults.forEach(a => {
        a.pnl = parseFloat(a.pnl.toFixed(2));
    });

    return pnlResults;
}

async function getRetrospective(startDate, endDate) {

        await connectToDatabase();

        // const times = ['04:15'];
        const times = ['04:01', '04:16'];
        // const dates = ['2024-11-12'];
        // const dates = ['2024-11-12', '2024-11-13', '2024-11-14'];
        const dates = ['2024-11-19'];

        const timestamp = getDateStringIND(new Date());

        let results = [];

        const allOrders = await OrderLog.find({
            // bear_status: 'COMPLETED',
            timestamp: {
                $gte: startDate, // Replace with your desired date
                $lt: endDate   // This gets orders for the entire day of March 20th
            }
        })
        .sort({ timestamp: 1 });

        allOrders.sort((a, b) => a.tradingsymbol.localeCompare(b.tradingsymbol));

        const completedOrders = allOrders.filter(a => a.bear_status === 'COMPLETED');

        console.table(completedOrders.filter(a => a.tradingsymbol === 'ABCAPITAL'))

        // for (const order of completedOrders) {
        //     const placeOrder = allOrders.find(o => o.order_id === order.order_id && o.bear_status.includes('PLACE'));
        //     if (!placeOrder) {
        //         console.log(order.tradingsymbol)
        //         console.log(allOrders.filter(o => o.tradingsymbol === order.tradingsymbol).map(o => [o.bear_status, o.order_id, order.order_id]))
        //         console.log(allOrders.filter(o => o.order_id === order.order_id).map(o => [o.timestamp, o.bear_status]))
        //     }
        // }
        // return

        // console.log(completedOrders.map(a => [a.tradingsymbol, a.tag]))

        results.push(...completedOrders.map(a => ({
            _timestamp: allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('COMPLE'))?.timestamp || a.timestamp,
            timestamp: (allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('COMPLE'))?.timestamp && getDateStringIND(allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('COMPLE'))?.timestamp)) || getDateStringIND(a.timestamp), 
            tradingsymbol: a.tradingsymbol, 
            quantity: a.quantity, 
            price: a.average_price || a.price, 
            order_type: a.order_type, 
            transaction_type: a.transaction_type,
            source: !a.tag ? '?' : a.tag?.includes('zaire') ? 'zaire' : a.tag?.includes('bailey') ? 'bailey' : 'sheet',
            exitReason: a.tag?.includes('loss-UD') ? 'stoploss-u' : a.tag?.split('-')[0] || '-',
            direction: (a.tag?.includes('trigger') && (a.transaction_type === 'SELL' ? 'BEARISH' : 'BULLISH')) || '',
            isExit: a.tag?.includes('trigger') ? false : true
        })))

        // console.table(results)
        // console.log(JSON.stringify(results))
        return results 
                // .filter(a => a.timestamp !== '2025-03-19 15:10:49');


}

async function analyzeTradeResults(trades) {
    // Group trades by symbol
    const tradesBySymbol = trades.reduce((acc, trade) => {
        if (!acc[trade.tradingsymbol]) {
            acc[trade.tradingsymbol] = [];
        }
        acc[trade.tradingsymbol].push(trade);
        return acc;
    }, {});

    const results = [];

    for (const [symbol, symbolTrades] of Object.entries(tradesBySymbol)) {
        // Sort trades by timestamp
        symbolTrades.sort((a, b) => new Date(a._timestamp) - new Date(b._timestamp));
        
        const firstTrade = symbolTrades[0];
        const lastTrade = symbolTrades[symbolTrades.length - 1];
        
        let result = {
            symbol,
            direction: firstTrade.direction || 'UNKNOWN',
            entry: firstTrade.price,
            quantity: firstTrade.quantity,
            entryTime: firstTrade.timestamp,
            source: firstTrade.source
        };

        // If we have a matching exit trade
        if (symbolTrades.length > 1 && 
            ((firstTrade.transaction_type === 'BUY' && lastTrade.transaction_type === 'SELL') ||
             (firstTrade.transaction_type === 'SELL' && lastTrade.transaction_type === 'BUY'))) {
            
            const pnl = firstTrade.transaction_type === 'BUY' 
                ? (lastTrade.price - firstTrade.price) * firstTrade.quantity
                : (firstTrade.price - lastTrade.price) * firstTrade.quantity;

            result = {
                ...result,
                exit: lastTrade.price,
                exitTime: lastTrade.timestamp,
                exitReason: lastTrade.exitReason || '-',
                status: 'CLOSED',
                pnl: parseFloat(pnl.toFixed(2)),
                pnlPercentage: parseFloat(((pnl / (firstTrade.price * firstTrade.quantity)) * 100).toFixed(2))
            };
        } else {
            
            const sym = `NSE:${symbol}`
            const ltp = await kiteSession.kc.getLTP([sym]);
            console.log(parseFloat(((ltp[sym].last_price - firstTrade.price) * firstTrade.quantity).toFixed(2)))
            result = {
                ...result,
                exit: ltp[sym].last_price,
                exitTime: lastTrade.timestamp,
                exitReason: '-',
                status: 'OPEN',
                pnl: parseFloat(((ltp[sym].last_price - firstTrade.price) * firstTrade.quantity).toFixed(2)),
                pnlPercentage: parseFloat((((ltp[sym].last_price - firstTrade.price) * firstTrade.quantity) / (firstTrade.price * firstTrade.quantity) * 100).toFixed(2))
            };
        }

        results.push(result);
    }

    return results;
}

async function getTradeAnalysis(startDate, endDate) {
    const trades = await getRetrospective(startDate, endDate);
    // const analysis = await analyzeTradeResults(trades);
        
    const analysis = await calculatePnLForPairs(trades);

    // console.table(analysis)

    const zaireTrades = analysis.filter(t => t.source === 'zaire');
    const baileyTrades = analysis.filter(t => t.source === 'bailey');
    const manualTrades = analysis.filter(t => t.source === 'sheet');

    // Calculate overall statistics
    const closedTrades = analysis.filter(t => t.status === 'CLOSED');
    const realisedPnL = closedTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const totalPnL = analysis.reduce((sum, trade) => sum + trade.pnl, 0);
    const winningTrades = closedTrades.filter(t => t.exitReason === 'target');
    
    return {
        trades: analysis,
        summary: {
            totalTrades: analysis.length,
            closedTrades: closedTrades.length,
            openTrades: analysis.length - closedTrades.length,
            totalPnL: parseFloat(totalPnL.toFixed(2)),
            winRate: closedTrades.length ? parseFloat(((winningTrades.length / closedTrades.length) * 100).toFixed(2)) : 0,
            realisedPnL: parseFloat(realisedPnL.toFixed(2)),

            zaireTrades: zaireTrades.length,
            zaireWinRate: zaireTrades.length ? parseFloat(((winningTrades.filter(t => t.source === 'zaire').length / zaireTrades.length) * 100).toFixed(2)) : 0,
            zairePnL: parseFloat(zaireTrades.reduce((sum, trade) => sum + trade.pnl, 0).toFixed(2)),
            zaireTargetExits: zaireTrades.filter(t => t.exitReason === 'target').length,
            zaireStopLossExits: zaireTrades.filter(t => t.exitReason === 'stoploss').length,
            zaireStopLossUDExits: zaireTrades.filter(t => t.exitReason === 'stoploss-u').length,
            zaireOtherExits: zaireTrades.filter(t => t.exitReason !== 'target' && t.exitReason !== 'stoploss').length,

            baileyTrades: baileyTrades.length,
            baileyWinRate: baileyTrades.length ? parseFloat(((winningTrades.filter(t => t.source === 'bailey').length / baileyTrades.length) * 100).toFixed(2)) : 0,
            baileyPnL: parseFloat(baileyTrades.reduce((sum, trade) => sum + trade.pnl, 0).toFixed(2)),
            baileyTargetExits: baileyTrades.filter(t => t.exitReason === 'target').length,
            baileyStopLossExits: baileyTrades.filter(t => t.exitReason === 'stoploss').length,
            baileyStopLossUDExits: baileyTrades.filter(t => t.exitReason === 'stoploss-u').length,
            baileyOtherExits: baileyTrades.filter(t => t.exitReason !== 'target' && t.exitReason !== 'stoploss').length,

            manualTrades: manualTrades.length,
            manualWinRate: manualTrades.length ? parseFloat(((winningTrades.filter(t => t.source === 'sheet').length / manualTrades.length) * 100).toFixed(2)) : 0,
            manualPnL: parseFloat(manualTrades.reduce((sum, trade) => sum + trade.pnl, 0).toFixed(2)),
            manualTargetExits: manualTrades.filter(t => t.exitReason === 'target').length,
            manualStopLossExits: manualTrades.filter(t => t.exitReason === 'stoploss').length,
            manualStopLossUDExits: manualTrades.filter(t => t.exitReason === 'stoploss-u').length,
            manualOtherExits: manualTrades.filter(t => t.exitReason !== 'target' && t.exitReason !== 'stoploss').length,
        }
    };
}

module.exports = {
    getRetrospective,
    getTradeAnalysis
}