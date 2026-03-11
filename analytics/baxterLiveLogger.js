const fs = require('fs');
const path = require('path');
const { getDateStringIND } = require('../kite/utils');

/**
 * Baxter Live Order Logger
 * 
 * Logs all real-time Baxter strategy order actions and candle checks
 * Tracks: Scans, Order Placements, SL Updates, Executions, Cancellations
 */

const LOGS_DIR = path.join(__dirname, '../logs');
const LIVE_CSV_LOG_FILE = path.join(LOGS_DIR, 'baxter_live_orders.csv');
const LIVE_JSON_LOG_FILE = path.join(LOGS_DIR, 'baxter_live_orders.json');
const CANDLE_CHECK_LOG_FILE = path.join(LOGS_DIR, 'baxter_candle_checks.csv');
const SCAN_DETAILS_DIR = path.join(LOGS_DIR, 'baxter_scan_details');

// Ensure log directories exist
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

if (!fs.existsSync(SCAN_DETAILS_DIR)) {
    fs.mkdirSync(SCAN_DETAILS_DIR, { recursive: true });
}

/**
 * Initialize CSV log files with headers if they don't exist
 */
function initializeLiveCSVLog() {
    if (!fs.existsSync(LIVE_CSV_LOG_FILE)) {
        const headers = [
            'Timestamp',
            'Date',
            'Time',
            'Symbol',
            'Direction',
            'Action',
            'Price',
            'Quantity',
            'Trigger Price',
            'Stop Loss',
            'LTP',
            'Status',
            'Order ID',
            'Tag',
            'Notes'
        ].join(',');
        
        fs.writeFileSync(LIVE_CSV_LOG_FILE, headers + '\n');
    }
}

function initializeCandleCheckLog() {
    if (!fs.existsSync(CANDLE_CHECK_LOG_FILE)) {
        const headers = [
            'Timestamp',
            'Date',
            'Time',
            'Symbol',
            'Direction',
            'Scan Time',
            'High',
            'Low',
            'Close',
            'Trigger Price',
            'Stop Loss',
            'Quantity',
            'Selected',
            'Reason'
        ].join(',');
        
        fs.writeFileSync(CANDLE_CHECK_LOG_FILE, headers + '\n');
    }
}

/**
 * Log a live order action
 */
function logLiveOrderAction(orderData) {
    try {
        initializeLiveCSVLog();
        
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().split('T')[0];
        const timeStr = getDateStringIND(timestamp);
        
        const csvLine = [
            timestamp.toISOString(),
            dateStr,
            timeStr,
            orderData.symbol || '',
            orderData.direction || '',
            orderData.action || '',
            orderData.price ? orderData.price.toFixed(2) : '',
            orderData.quantity || '',
            orderData.triggerPrice ? orderData.triggerPrice.toFixed(2) : '',
            orderData.stopLoss ? orderData.stopLoss.toFixed(2) : '',
            orderData.ltp ? orderData.ltp.toFixed(2) : '',
            orderData.status || '',
            orderData.orderId || '',
            orderData.tag || '',
            orderData.notes || ''
        ].join(',');
        
        fs.appendFileSync(LIVE_CSV_LOG_FILE, csvLine + '\n');
        
        // Also append to JSON log
        let jsonLogs = [];
        if (fs.existsSync(LIVE_JSON_LOG_FILE)) {
            try {
                const content = fs.readFileSync(LIVE_JSON_LOG_FILE, 'utf8');
                jsonLogs = JSON.parse(content);
            } catch (error) {
                console.error('Error parsing live JSON log:', error);
            }
        }
        
        jsonLogs.push({
            timestamp: timestamp.toISOString(),
            ...orderData
        });
        
        fs.writeFileSync(LIVE_JSON_LOG_FILE, JSON.stringify(jsonLogs, null, 2));
        
    } catch (error) {
        console.error('Error logging live order action:', error);
    }
}

/**
 * Log a candle check (for debugging scan process)
 */
function logCandleCheck(candleData) {
    try {
        initializeCandleCheckLog();
        
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().split('T')[0];
        const timeStr = getDateStringIND(timestamp);
        
        const csvLine = [
            timestamp.toISOString(),
            dateStr,
            timeStr,
            candleData.symbol || '',
            candleData.direction || '',
            candleData.scanTime ? getDateStringIND(new Date(candleData.scanTime)) : '',
            candleData.high ? candleData.high.toFixed(2) : '',
            candleData.low ? candleData.low.toFixed(2) : '',
            candleData.close ? candleData.close.toFixed(2) : '',
            candleData.triggerPrice ? candleData.triggerPrice.toFixed(2) : '',
            candleData.stopLoss ? candleData.stopLoss.toFixed(2) : '',
            candleData.quantity || '',
            candleData.selected ? 'YES' : 'NO',
            candleData.reason || ''
        ].join(',');
        
        fs.appendFileSync(CANDLE_CHECK_LOG_FILE, csvLine + '\n');
        
    } catch (error) {
        console.error('Error logging candle check:', error);
    }
}

/**
 * Log detailed scan results
 */
function logScanDetails(scanData) {
    try {
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().split('T')[0];
        const timeStr = timestamp.getTime();
        
        const filename = `scan_${dateStr}_${timeStr}.json`;
        const filepath = path.join(SCAN_DETAILS_DIR, filename);
        
        const detailedLog = {
            timestamp: timestamp.toISOString(),
            scanTime: getDateStringIND(timestamp),
            ...scanData,
            scannedStocks: scanData.scannedStocks || [],
            selectedStocks: scanData.selectedStocks || [],
            rejectedStocks: scanData.rejectedStocks || []
        };
        
        fs.writeFileSync(filepath, JSON.stringify(detailedLog, null, 2));
        
        return filename;
    } catch (error) {
        console.error('Error logging scan details:', error);
        return null;
    }
}

/**
 * Log stock scan start
 */
function logScanStart(stockList) {
    logLiveOrderAction({
        action: 'SCAN_START',
        notes: `Scanning ${stockList.length} stocks`,
        status: 'SCANNING'
    });
}

/**
 * Log stock scan completion
 */
function logScanComplete(selectedCount, totalScanned) {
    logLiveOrderAction({
        action: 'SCAN_COMPLETE',
        notes: `Selected ${selectedCount} out of ${totalScanned} stocks`,
        status: 'COMPLETED'
    });
}

/**
 * Log order placement
 */
function logOrderPlacement(symbol, direction, orderType, price, quantity, triggerPrice, stopLoss, ltp, orderId, tag) {
    logLiveOrderAction({
        symbol,
        direction,
        action: `ORDER_PLACED_${orderType}`,
        price,
        quantity,
        triggerPrice,
        stopLoss,
        ltp,
        status: 'PENDING',
        orderId,
        tag,
        notes: `${orderType} order placed`
    });
}

/**
 * Log order execution
 */
function logOrderExecution(symbol, direction, executionPrice, quantity, orderId, tag) {
    logLiveOrderAction({
        symbol,
        direction,
        action: 'ORDER_EXECUTED',
        price: executionPrice,
        quantity,
        status: 'TRIGGERED',
        orderId,
        tag,
        notes: 'Order filled'
    });
}

/**
 * Log order cancellation
 */
function logOrderCancellation(symbol, direction, reason, orderId, tag) {
    logLiveOrderAction({
        symbol,
        direction,
        action: 'ORDER_CANCELLED',
        status: 'CANCELLED',
        orderId,
        tag,
        notes: reason
    });
}

/**
 * Log stop loss update
 */
function logStopLossUpdate(symbol, direction, oldSL, newSL, ltp, reason) {
    logLiveOrderAction({
        symbol,
        direction,
        action: 'STOPLOSS_UPDATED',
        price: newSL,
        stopLoss: newSL,
        ltp,
        status: 'TRIGGERED',
        notes: `SL: ${oldSL.toFixed(2)} → ${newSL.toFixed(2)} (${reason})`
    });
}

/**
 * Log stop loss hit
 */
function logStopLossHit(symbol, direction, slPrice, ltp, quantity, exitReason) {
    logLiveOrderAction({
        symbol,
        direction,
        action: 'STOPLOSS_HIT',
        price: ltp,
        quantity,
        stopLoss: slPrice,
        ltp,
        status: 'STOPPED',
        notes: exitReason
    });
}

/**
 * Log position monitoring check
 */
function logPositionCheck(symbol, direction, ltp, stopLoss, status) {
    logLiveOrderAction({
        symbol,
        direction,
        action: 'POSITION_CHECK',
        ltp,
        stopLoss,
        status,
        notes: `LTP: ${ltp.toFixed(2)}, SL: ${stopLoss.toFixed(2)}`
    });
}

/**
 * Log error
 */
function logError(symbol, action, error) {
    logLiveOrderAction({
        symbol,
        action: 'ERROR',
        status: 'ERROR',
        notes: `${action}: ${error.message || error}`
    });
}

/**
 * Get today's live order statistics
 */
function getTodayStatistics() {
    if (!fs.existsSync(LIVE_JSON_LOG_FILE)) {
        return {
            totalScans: 0,
            ordersPlaced: 0,
            ordersExecuted: 0,
            ordersCancelled: 0,
            slUpdates: 0,
            slHits: 0,
            errors: 0
        };
    }
    
    try {
        const content = fs.readFileSync(LIVE_JSON_LOG_FILE, 'utf8');
        const logs = JSON.parse(content);
        
        const today = new Date().toISOString().split('T')[0];
        const todayLogs = logs.filter(log => log.timestamp.startsWith(today));
        
        return {
            totalScans: todayLogs.filter(l => l.action === 'SCAN_COMPLETE').length,
            ordersPlaced: todayLogs.filter(l => l.action?.startsWith('ORDER_PLACED')).length,
            ordersExecuted: todayLogs.filter(l => l.action === 'ORDER_EXECUTED').length,
            ordersCancelled: todayLogs.filter(l => l.action === 'ORDER_CANCELLED').length,
            slUpdates: todayLogs.filter(l => l.action === 'STOPLOSS_UPDATED').length,
            slHits: todayLogs.filter(l => l.action === 'STOPLOSS_HIT').length,
            errors: todayLogs.filter(l => l.action === 'ERROR').length,
            totalActions: todayLogs.length
        };
    } catch (error) {
        console.error('Error getting today statistics:', error);
        return null;
    }
}

/**
 * Print today's statistics
 */
function printTodayStatistics() {
    const stats = getTodayStatistics();
    
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   BAXTER LIVE ORDERS - TODAY               ║');
    console.log('╚════════════════════════════════════════════╝\n');
    
    console.log(`Total Scans: ${stats.totalScans}`);
    console.log(`Orders Placed: ${stats.ordersPlaced}`);
    console.log(`Orders Executed: ${stats.ordersExecuted}`);
    console.log(`Orders Cancelled: ${stats.ordersCancelled}`);
    console.log(`Stop Loss Updates: ${stats.slUpdates}`);
    console.log(`Stop Loss Hits: ${stats.slHits}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`\nTotal Actions Logged: ${stats.totalActions}`);
    console.log('\n');
}

/**
 * Clear today's logs (use with caution)
 */
function clearTodayLogs() {
    const today = new Date().toISOString().split('T')[0];
    
    // Keep logs, just add a note
    logLiveOrderAction({
        action: 'LOGS_CLEARED',
        notes: `Logs cleared for ${today}`,
        status: 'SYSTEM'
    });
    
    console.log(`Logs marked as cleared for ${today}`);
}

/**
 * Archive old logs (older than specified days)
 */
function archiveOldLogs(daysToKeep = 30) {
    try {
        const archiveDir = path.join(LOGS_DIR, 'archive');
        if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
        }
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        // Archive scan details
        if (fs.existsSync(SCAN_DETAILS_DIR)) {
            const files = fs.readdirSync(SCAN_DETAILS_DIR);
            files.forEach(file => {
                const filePath = path.join(SCAN_DETAILS_DIR, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime < cutoffDate) {
                    const archivePath = path.join(archiveDir, file);
                    fs.renameSync(filePath, archivePath);
                }
            });
        }
        
        console.log(`Archived logs older than ${daysToKeep} days`);
    } catch (error) {
        console.error('Error archiving old logs:', error);
    }
}

module.exports = {
    logLiveOrderAction,
    logCandleCheck,
    logScanDetails,
    logScanStart,
    logScanComplete,
    logOrderPlacement,
    logOrderExecution,
    logOrderCancellation,
    logStopLossUpdate,
    logStopLossHit,
    logPositionCheck,
    logError,
    getTodayStatistics,
    printTodayStatistics,
    clearTodayLogs,
    archiveOldLogs,
    LIVE_CSV_LOG_FILE,
    LIVE_JSON_LOG_FILE,
    CANDLE_CHECK_LOG_FILE,
    SCAN_DETAILS_DIR
};
