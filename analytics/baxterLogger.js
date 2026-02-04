const fs = require('fs');
const path = require('path');
const { getDateStringIND } = require('../kite/utils');

/**
 * Baxter Trade Logger
 * 
 * Logs all Baxter strategy trade results to CSV and JSON formats
 * Tracks: Entry, Exit, PnL, Actions, SL updates
 */

const LOGS_DIR = path.join(__dirname, '../logs');
const CSV_LOG_FILE = path.join(LOGS_DIR, 'baxter_trades.csv');
const JSON_LOG_FILE = path.join(LOGS_DIR, 'baxter_trades.json');
const DETAILED_LOG_DIR = path.join(LOGS_DIR, 'baxter_detailed');

// Ensure log directories exist
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

if (!fs.existsSync(DETAILED_LOG_DIR)) {
    fs.mkdirSync(DETAILED_LOG_DIR, { recursive: true });
}

/**
 * Initialize CSV log file with headers if it doesn't exist
 */
function initializeCSVLog() {
    if (!fs.existsSync(CSV_LOG_FILE)) {
        const headers = [
            'Trade ID',
            'Date',
            'Symbol',
            'Direction',
            'Order Time',
            'Trigger Price',
            'Initial SL (Knight)',
            'Final SL',
            'Target Price',
            'Quantity',
            'Entry Time',
            'Entry Price',
            'Exit Time',
            'Exit Price',
            'Exit Reason',
            'PnL',
            'PnL %',
            'Risk Amount',
            'SL Updates Count',
            'Duration (mins)',
            'Status'
        ].join(',');
        
        fs.writeFileSync(CSV_LOG_FILE, headers + '\n');
    }
}

/**
 * Format a trade result for CSV logging
 */
function formatTradeForCSV(trade) {
    const {
        tradeId,
        date,
        sym,
        direction,
        orderTime,
        triggerPrice,
        initialStopLoss,
        finalStopLoss,
        targetPrice,
        quantity,
        entryTime,
        entryPrice,
        exitTime,
        exitPrice,
        exitReason,
        pnl,
        pnlPercent,
        riskAmount,
        slUpdatesCount,
        durationMins,
        status
    } = trade;
    
    return [
        tradeId,
        date,
        sym,
        direction,
        orderTime,
        triggerPrice.toFixed(2),
        initialStopLoss.toFixed(2),
        finalStopLoss ? finalStopLoss.toFixed(2) : 'N/A',
        targetPrice ? targetPrice.toFixed(2) : 'None',
        quantity,
        entryTime || 'N/A',
        entryPrice ? entryPrice.toFixed(2) : 'N/A',
        exitTime || 'N/A',
        exitPrice ? exitPrice.toFixed(2) : 'N/A',
        exitReason || 'N/A',
        pnl.toFixed(2),
        pnlPercent ? pnlPercent.toFixed(2) : 'N/A',
        riskAmount,
        slUpdatesCount,
        durationMins || 'N/A',
        status
    ].join(',');
}

/**
 * Log a trade result to CSV file
 */
function logTradeToCSV(trade) {
    initializeCSVLog();
    const csvLine = formatTradeForCSV(trade) + '\n';
    fs.appendFileSync(CSV_LOG_FILE, csvLine);
}

/**
 * Log a trade result to JSON file
 */
function logTradeToJSON(trade) {
    let trades = [];
    
    if (fs.existsSync(JSON_LOG_FILE)) {
        const content = fs.readFileSync(JSON_LOG_FILE, 'utf8');
        try {
            trades = JSON.parse(content);
        } catch (error) {
            console.error('Error parsing JSON log file:', error);
            trades = [];
        }
    }
    
    trades.push(trade);
    fs.writeFileSync(JSON_LOG_FILE, JSON.stringify(trades, null, 2));
}

/**
 * Log detailed trade actions to a separate file
 */
function logDetailedActions(tradeId, date, sym, actions) {
    const filename = `${date}_${sym}_${tradeId}.json`;
    const filepath = path.join(DETAILED_LOG_DIR, filename);
    
    const detailedLog = {
        tradeId,
        date,
        symbol: sym,
        timestamp: new Date().toISOString(),
        actions: actions.map(action => ({
            time: getDateStringIND(action.time),
            timestamp: action.time,
            action: action.action,
            price: action.price
        }))
    };
    
    fs.writeFileSync(filepath, JSON.stringify(detailedLog, null, 2));
}

/**
 * Process simulation result and log it
 */
function logSimulationResult(simResult, date, selectionParams = {}) {
    try {
        const tradeId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const orderDate = new Date(simResult.placedAt);
        const dateStr = orderDate.toISOString().split('T')[0];
        
        // Count SL updates
        const slUpdatesCount = simResult.actions.filter(a => 
            a.action.includes('Stop Loss Updated')
        ).length;
        
        // Calculate duration if trade was entered
        let durationMins = null;
        if (simResult.startedAt && simResult.exitTime) {
            durationMins = Math.round((simResult.exitTime - simResult.startedAt) / (1000 * 60));
        }
        
        // Calculate PnL percentage
        let pnlPercent = null;
        if (simResult.startedAt && simResult.exitTime) {
            const entryAction = simResult.actions.find(a => a.action === 'Trigger Hit');
            if (entryAction && entryAction.price > 0) {
                pnlPercent = (simResult.pnl / (entryAction.price * simResult.quantity)) * 100;
            }
        }
        
        // Determine status
        let status = 'CANCELLED';
        if (simResult.startedAt) {
            status = simResult.pnl > 0 ? 'PROFIT' : (simResult.pnl < 0 ? 'LOSS' : 'BREAKEVEN');
        }
        
        // Get entry and exit prices
        const triggerHitAction = simResult.actions.find(a => a.action === 'Trigger Hit');
        const entryPrice = triggerHitAction ? triggerHitAction.price : null;
        
        const exitAction = simResult.actions.find(a => 
            a.action === 'Stop Loss Hit' || 
            a.action === 'Target Hit' || 
            a.action === 'Auto Square-off'
        );
        const exitPrice = exitAction ? exitAction.price : null;
        
        // Get final SL
        const lastSLAction = simResult.actions.filter(a => 
            a.action === 'Stop Loss Placed' || a.action === 'Stop Loss Updated'
        ).pop();
        const finalStopLoss = lastSLAction ? lastSLAction.price : simResult.stopLossPrice;
        
        const trade = {
            tradeId,
            date: dateStr,
            sym: simResult.sym,
            direction: simResult.direction,
            orderTime: getDateStringIND(simResult.placedAt),
            triggerPrice: simResult.triggerPrice,
            initialStopLoss: simResult.stopLossPrice,
            finalStopLoss: finalStopLoss,
            targetPrice: simResult.targetPrice,
            quantity: simResult.quantity,
            entryTime: simResult.startedAt ? getDateStringIND(simResult.startedAt) : null,
            entryPrice: entryPrice,
            exitTime: simResult.exitTime ? getDateStringIND(simResult.exitTime) : null,
            exitPrice: exitPrice,
            exitReason: simResult.exitReason,
            pnl: simResult.pnl,
            pnlPercent: pnlPercent,
            riskAmount: selectionParams.RISK_AMOUNT || 200,
            slUpdatesCount: slUpdatesCount,
            durationMins: durationMins,
            status: status,
            selectionParams: selectionParams
        };
        
        // Log to CSV
        logTradeToCSV(trade);
        
        // Log to JSON
        logTradeToJSON(trade);
        
        // Log detailed actions
        logDetailedActions(tradeId, dateStr, simResult.sym, simResult.actions);
        
        return tradeId;
    } catch (error) {
        console.error('Error logging trade result:', error);
        return null;
    }
}

/**
 * Get summary statistics from logged trades
 */
function getTradeStatistics() {
    if (!fs.existsSync(JSON_LOG_FILE)) {
        return {
            totalTrades: 0,
            profitTrades: 0,
            lossTrades: 0,
            cancelledTrades: 0,
            totalPnL: 0,
            avgPnL: 0,
            winRate: 0,
            avgDuration: 0
        };
    }
    
    const content = fs.readFileSync(JSON_LOG_FILE, 'utf8');
    const trades = JSON.parse(content);
    
    const profitTrades = trades.filter(t => t.pnl > 0);
    const lossTrades = trades.filter(t => t.pnl < 0);
    const cancelledTrades = trades.filter(t => t.status === 'CANCELLED');
    const activeTrades = trades.filter(t => t.status !== 'CANCELLED');
    
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnL = activeTrades.length > 0 ? totalPnL / activeTrades.length : 0;
    const winRate = activeTrades.length > 0 ? (profitTrades.length / activeTrades.length) * 100 : 0;
    
    const durationsSum = trades
        .filter(t => t.durationMins)
        .reduce((sum, t) => sum + t.durationMins, 0);
    const tradesWithDuration = trades.filter(t => t.durationMins).length;
    const avgDuration = tradesWithDuration > 0 ? durationsSum / tradesWithDuration : 0;
    
    return {
        totalTrades: trades.length,
        profitTrades: profitTrades.length,
        lossTrades: lossTrades.length,
        cancelledTrades: cancelledTrades.length,
        totalPnL: totalPnL,
        avgPnL: avgPnL,
        winRate: winRate,
        avgDuration: avgDuration,
        avgProfitPerTrade: profitTrades.length > 0 ? 
            profitTrades.reduce((sum, t) => sum + t.pnl, 0) / profitTrades.length : 0,
        avgLossPerTrade: lossTrades.length > 0 ? 
            lossTrades.reduce((sum, t) => sum + t.pnl, 0) / lossTrades.length : 0
    };
}

/**
 * Print statistics to console
 */
function printStatistics() {
    const stats = getTradeStatistics();
    
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   BAXTER STRATEGY STATISTICS              ║');
    console.log('╚════════════════════════════════════════════╝\n');
    
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`  Profit: ${stats.profitTrades} (${((stats.profitTrades/stats.totalTrades)*100).toFixed(1)}%)`);
    console.log(`  Loss: ${stats.lossTrades} (${((stats.lossTrades/stats.totalTrades)*100).toFixed(1)}%)`);
    console.log(`  Cancelled: ${stats.cancelledTrades} (${((stats.cancelledTrades/stats.totalTrades)*100).toFixed(1)}%)`);
    console.log(`\nWin Rate (Active Trades): ${stats.winRate.toFixed(2)}%`);
    console.log(`\nTotal PnL: ₹${stats.totalPnL.toFixed(2)}`);
    console.log(`Average PnL: ₹${stats.avgPnL.toFixed(2)}`);
    console.log(`Average Profit: ₹${stats.avgProfitPerTrade.toFixed(2)}`);
    console.log(`Average Loss: ₹${stats.avgLossPerTrade.toFixed(2)}`);
    console.log(`\nAverage Trade Duration: ${stats.avgDuration.toFixed(0)} minutes`);
    console.log('\n');
}

/**
 * Clear all logs
 */
function clearLogs() {
    if (fs.existsSync(CSV_LOG_FILE)) {
        fs.unlinkSync(CSV_LOG_FILE);
    }
    if (fs.existsSync(JSON_LOG_FILE)) {
        fs.unlinkSync(JSON_LOG_FILE);
    }
    
    // Clear detailed logs
    if (fs.existsSync(DETAILED_LOG_DIR)) {
        const files = fs.readdirSync(DETAILED_LOG_DIR);
        files.forEach(file => {
            fs.unlinkSync(path.join(DETAILED_LOG_DIR, file));
        });
    }
    
    console.log('All Baxter logs cleared.');
}

module.exports = {
    logSimulationResult,
    getTradeStatistics,
    printStatistics,
    clearLogs,
    CSV_LOG_FILE,
    JSON_LOG_FILE,
    DETAILED_LOG_DIR
};
