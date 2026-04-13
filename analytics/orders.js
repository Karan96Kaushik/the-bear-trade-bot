const { getDateStringIND } = require('../kite/utils');
const OrderLog = require('../models/OrderLog');
const { connectToDatabase } = require('../modules/db');
const { kiteSession } = require('../kite/setup');

/**
 * Order preserved: first matching `tagIncludes` wins (same priority as the former nested ternary).
 * Exactly one row should set `isDefault` for tags that match no `tagIncludes`.
 */
const TRADE_ANALYSIS_SOURCES = [
    // { id: 'lightyear', label: 'Lightyear', tagIncludes: 'lgy' },
    // { id: 'zaire', label: 'Zaire', tagIncludes: 'zaire' },
    // { id: 'bailey', label: 'Bailey', tagIncludes: 'bailey' },
    // { id: 'benoit', label: 'Benoit', tagIncludes: 'benoit' },
    { id: 'baxter', label: 'Baxter', tagIncludes: 'baxter' },
    { id: 'manual', label: 'Manual', isDefault: true }
];

function sourceFromOrderTag(tag) {
    if (!tag) {
        return '?';
    }
    for (const row of TRADE_ANALYSIS_SOURCES) {
        if (row.tagIncludes && tag.includes(row.tagIncludes)) {
            return row.id;
        }
    }
    const fallback = TRADE_ANALYSIS_SOURCES.find((r) => r.isDefault);
    return fallback ? fallback.id : 'manual';
}

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

            // if (symbol === 'ABCAPITAL') {
            //     console.table([entryTrade, exitTrade, ...trades[symbol]])
            // }

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
                    entryTimeIST: entryTrade.timestamp,
                    exitTime: exitTrade._timestamp,
                    quantity: entryTrade.quantity,
                    entryPrice: entryTrade.price,
                    exitPrice: exitTrade.price,
                    source: entryTrade.source,
                    exitReason: exitTrade.exitReason,
                    direction: entryTrade.direction || (entryTrade.transaction_type == 'BUY' ? 'BULLISH' : 'BEARISH'),
                    status: 'CLOSED',
                    pnl
                });

                i += 2; // Move to the next pair
            } else {
                // Trade is still open
                pnlResults.push({
                    symbol,
                    entryTime: entryTrade._timestamp,
                    entryTimeIST: entryTrade.timestamp,
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

    const openTradeSymbols = pnlResults
        .filter(a => a.status === 'OPEN')
        .map(a => `NSE:${a.symbol}`);

    let ltps = {};
    let ordersBySymbol = {};
    if (openTradeSymbols.length) {
        ltps = await kiteSession.kc.getLTP(openTradeSymbols);

        const orders = await kiteSession.kc.getOrders();
        const openOrders = orders
            .filter(o => o.status === 'TRIGGER PENDING' || o.status === 'OPEN')
            .filter(o => o.tag?.includes('target') || o.tag?.includes('stoploss'));

        ordersBySymbol = openOrders.reduce((acc, order) => {
            const symbol = order.tradingsymbol;
            if (!symbol) {
                return acc;
            }
            if (!acc[symbol]) {
                acc[symbol] = { sl: null, target: null };
            }
            if (order.tag?.includes('stoploss') && !acc[symbol].sl) {
                acc[symbol].sl = order;
            }
            if (order.tag?.includes('target') && !acc[symbol].target) {
                acc[symbol].target = order;
            }
            return acc;
        }, {});
    }

    // console.log(ltps, openTradeSymbols)

    pnlResults.forEach(a => {
        if (a.status === 'OPEN') {
            a.ltp = ltps[`NSE:${a.symbol}`]?.last_price;
            a.pnl = (a.direction === 'BULLISH' ? a.ltp - a.entryPrice : a.entryPrice - a.ltp) * a.quantity;
            const symbolOrders = ordersBySymbol[a.symbol] || {};
            let sl = symbolOrders.sl;
            let t = symbolOrders.target;
            sl = sl?.trigger_price || sl?.price || 'NA';
            t = t?.trigger_price || t?.price || 'NA';
            a.exitReason = `${sl}-${a.ltp}-${t}`;
        }
        if (typeof a.pnl === 'number') {
            a.pnl = parseFloat(a.pnl.toFixed(2));
        }
    });

    return pnlResults;
}

async function getRetrospective(startDate, endDate) {

        await connectToDatabase();

        let results = [];

        let allOrders = await OrderLog.find({
            // bear_status: 'COMPLETED',
            timestamp: {
                $gte: startDate, // Replace with your desired date
                $lt: endDate   // This gets orders for the entire day of March 20th
            }
        })
        .sort({ timestamp: 1 });

        // console.table(allOrders.map(a => {
        //     return {
        //         timestamp: a.timestamp,
        //         tradingsymbol: a.tradingsymbol,
        //         bear_status: a.bear_status,
        //         quantity: a.quantity,
        //         price: a.average_price || a.price,
        //         order_type: a.order_type,
        //         tag: a.tag
        //     }
        // }))

        allOrders = allOrders.filter(a => a.tradingsymbol);
        allOrders.sort((a, b) => a.tradingsymbol.localeCompare(b.tradingsymbol));

        const completedOrders = allOrders.filter(a => a.bear_status === 'COMPLETED');
        const completedOrderById = new Map();

        allOrders.forEach(order => {
            if (order.order_id && order.bear_status?.includes('COMPLE')) {
                completedOrderById.set(order.order_id, order);
            }
        });

        results.push(...completedOrders.map(a => ({
            _timestamp: completedOrderById.get(a.order_id)?.timestamp || a.timestamp,
            timestamp: getDateStringIND(completedOrderById.get(a.order_id)?.timestamp || a.timestamp),
            tradingsymbol: a.tradingsymbol, 
            quantity: a.quantity, 
            price: a.average_price || a.price, 
            order_type: a.order_type, 
            transaction_type: a.transaction_type,
            source: sourceFromOrderTag(a.tag),
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
    const openSymbols = [];
    const openResults = [];

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
            results.push(result);
        } else {
            openSymbols.push(`NSE:${symbol}`);
            openResults.push({ firstTrade, lastTrade, baseResult: result });
        }
    }

    const ltps = openSymbols.length ? await kiteSession.kc.getLTP(openSymbols) : {};
    openResults.forEach(({ firstTrade, lastTrade, baseResult }) => {
        const sym = `NSE:${baseResult.symbol}`;
        const ltp = ltps[sym]?.last_price;
        const pnl = (ltp - firstTrade.price) * firstTrade.quantity;
        results.push({
            ...baseResult,
            exit: ltp,
            exitTime: lastTrade.timestamp,
            exitReason: '-',
            status: 'OPEN',
            pnl: parseFloat(pnl.toFixed(2)),
            pnlPercentage: parseFloat(((pnl / (firstTrade.price * firstTrade.quantity)) * 100).toFixed(2))
        });
    });

    return results;
}

async function getTradeAnalysis(startDate, endDate) {
    const trades = await getRetrospective(startDate, endDate);
    // const analysis = await analyzeTradeResults(trades);
        
    const analysis = await calculatePnLForPairs(trades);

    // console.table(analysis)

    const initialSourceStats = () => ({
        trades: 0,
        wins: 0,
        pnl: 0,
        targetExits: 0,
        stopLossExits: 0,
        stopLossUDExits: 0,
        otherExits: 0
    });

    const sourceStats = Object.fromEntries(
        TRADE_ANALYSIS_SOURCES.map(({ id }) => [id, initialSourceStats()])
    );

    let closedTradesCount = 0;
    let winningTradesCount = 0;
    let realisedPnL = 0;
    let totalPnL = 0;

    analysis.forEach(trade => {
        const tradePnl = typeof trade.pnl === 'number' ? trade.pnl : 0;
        totalPnL += tradePnl;

        if (trade.status === 'CLOSED') {
            closedTradesCount += 1;
            realisedPnL += tradePnl;
            if (trade.exitReason === 'target') {
                winningTradesCount += 1;
            }
        }

        const stats = sourceStats[trade.source];
        if (!stats) {
            return;
        }

        stats.trades += 1;
        stats.pnl += tradePnl;
        if (trade.exitReason === 'target') {
            stats.wins += 1;
            stats.targetExits += 1;
        } else if (trade.exitReason === 'stoploss') {
            stats.stopLossExits += 1;
        } else if (trade.exitReason === 'stoploss-u') {
            stats.stopLossUDExits += 1;
            stats.otherExits += 1;
        } else {
            stats.otherExits += 1;
        }
    });

    const sourceBreakdown = TRADE_ANALYSIS_SOURCES.map(({ id, label }) => {
        const s = sourceStats[id];
        return {
            id,
            label,
            trades: s.trades,
            winRate: s.trades ? parseFloat(((s.wins / s.trades) * 100).toFixed(2)) : 0,
            pnl: parseFloat(s.pnl.toFixed(2)),
            targetExits: s.targetExits,
            stopLossExits: s.stopLossExits,
            stopLossUDExits: s.stopLossUDExits,
            otherExits: s.otherExits
        };
    });

    return {
        trades: analysis,
        summary: {
            totalTrades: analysis.length,
            closedTrades: closedTradesCount,
            openTrades: analysis.length - closedTradesCount,
            totalPnL: parseFloat(totalPnL.toFixed(2)),
            winRate: closedTradesCount ? parseFloat(((winningTradesCount / closedTradesCount) * 100).toFixed(2)) : 0,
            realisedPnL: parseFloat(realisedPnL.toFixed(2)),
            sourceBreakdown
        }
    };
}

/**
 * Get SL progression per stock: how stoploss was placed, updated, and exited.
 * Returns for each symbol a list of { price, timestamp, event } (event: 'sl_placed' | 'sl_updated' | 'exited').
 * Also returns a list of raw prices per symbol for simple display.
 */
async function getSLProgression(startDate, endDate) {
    await connectToDatabase();

    const allOrders = await OrderLog.find({
        timestamp: { $gte: startDate, $lt: endDate },
        tag: { $regex: 'sl-', $options: 'i' }
    })
        .sort({ timestamp: 1 })
        .lean();

    const bySymbol = {};
    for (const doc of allOrders) {
        const symbol = doc.tradingsymbol;
        if (!symbol) continue;
        if (!bySymbol[symbol]) bySymbol[symbol] = [];
        bySymbol[symbol].push(doc);
    }

    const progression = {};
    const pricesByStock = {};

    for (const [symbol, docs] of Object.entries(bySymbol)) {
        docs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const list = [];
        const prices = [];
        let placedCount = 0;

        for (const doc of docs) {
            const status = doc.bear_status || doc.status;
            const ts = doc.timestamp;

            if (status === 'COMPLETED') {
                const price = doc.average_price ?? doc.price;
                if (price != null) {
                    list.push({ price, timestamp: ts, event: 'exited' });
                    prices.push(price);
                }
            } else if (status === 'PLACED') {
                const price = doc.trigger_price ?? doc.price;
                if (price != null) {
                    const event = placedCount === 0 ? 'sl_placed' : 'sl_updated';
                    list.push({ price, timestamp: ts, event });
                    prices.push(price);
                    placedCount += 1;
                }
            }
        }

        if (list.length) {
            progression[symbol] = list;
            pricesByStock[symbol] = prices;
        }
    }

    return { progression, pricesByStock };
}

module.exports = {
    TRADE_ANALYSIS_SOURCES,
    sourceFromOrderTag,
    getRetrospective,
    getTradeAnalysis,
    calculatePnLForPairs,
    getSLProgression
};