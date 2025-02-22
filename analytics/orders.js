const { getDateStringIND } = require('../kite/utils');
const { addMovingAverage } = require('../analytics');
const OrderLog = require('../models/OrderLog');
const { connectToDatabase } = require('../modules/db');
const { getDataFromYahoo, processYahooData } = require('../kite/utils');
const { kiteSession } = require('../kite/setup');
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

        // for (const order of completedOrders) {
        //     const placeOrder = allOrders.find(o => o.order_id === order.order_id && o.bear_status.includes('PLACE'));
        //     if (!placeOrder) {
        //         console.log(order.tradingsymbol)
        //         console.log(allOrders.filter(o => o.tradingsymbol === order.tradingsymbol).map(o => [o.bear_status, o.order_id, order.order_id]))
        //         console.log(allOrders.filter(o => o.order_id === order.order_id).map(o => [o.timestamp, o.bear_status]))
        //     }
        // }
        // return

        results.push(...completedOrders.map(a => ({
            _timestamp: allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('COMPLE'))?.timestamp || a.timestamp,
            timestamp: (allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('COMPLE'))?.timestamp && getDateStringIND(allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('COMPLE'))?.timestamp)) || getDateStringIND(a.timestamp), 
            tradingsymbol: a.tradingsymbol, 
            quantity: a.quantity, 
            price: a.price || a.average_price, 
            order_type: a.order_type, 
            transaction_type: a.transaction_type,
            source: !a.tag ? '?' : a.tag?.includes('zaire') ? 'zaire' : a.tag?.includes('bailey') ? 'bailey' : 'sheet',
            exitReason: a.tag?.split('-')[0] || '-',
            direction: (a.tag?.includes('trigger') && (a.transaction_type === 'SELL' ? 'BEARISH' : 'BULLISH')) || ''
        })))
        results = await Promise.all(results.map(async a => {
            const sym = a.tradingsymbol
            const timestamp = new Date(a._timestamp)
            const timestamp2 = new Date(timestamp)
            if (a.source === 'zaire') {
                let df = await getDataFromYahoo(sym, 5, '15m', timestamp.setDate(timestamp.getDate() - 5), timestamp2);
                df = processYahooData(df);
                df = addMovingAverage(df, 'close', 44, 'sma44');
                return {
                    ...a, 
                    high: df[df.length - 2].high, 
                    low: df[df.length - 2].low,
                    open: df[df.length - 2].open,
                    close: df[df.length - 2].close,
                    volume: df[df.length - 2].volume,
                    sma44: df[df.length - 2].sma44
                }
            }
            return a
        }))

        return results
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
    const analysis = await analyzeTradeResults(trades);

    const zaireTrades = analysis.filter(t => t.source === 'zaire');
    
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
            zaireOtherExits: zaireTrades.filter(t => t.exitReason !== 'target' && t.exitReason !== 'stoploss').length
        }
    };
}

module.exports = {
    getRetrospective,
    getTradeAnalysis
}