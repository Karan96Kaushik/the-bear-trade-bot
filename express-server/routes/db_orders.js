const express = require('express');
const router = express.Router();
const OrderLog = require('../../models/OrderLog');
const { getRetrospective, getTradeAnalysis } = require('../../analytics/orders');
const { calculatePnLForPairs } = require('../../analytics/orders');
// Get all orders with pagination and filtering
router.get('/logs', async (req, res) => {
    try {
        const { page = 1, limit = 50, symbol, action, status, date } = req.query;
        
        const query = {};
        if (symbol) query.tradingsymbol = { $regex: new RegExp(symbol, 'i') };
        if (status) query.bear_status = { $regex: new RegExp(status, 'i') };
        if (date) {
            const startDate = new Date(date);
            const endDate = new Date(date);
            endDate.setDate(endDate.getDate() + 1);
            query.timestamp = { 
                $gte: startDate,
                $lt: endDate
            };
        }

        const orders = await OrderLog.find(query)
            .sort({ timestamp: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const count = await OrderLog.countDocuments(query);

        res.json({
            orders,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
            totalOrders: count
        });
    } catch (error) {
        console.error('Error fetching order logs:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get order statistics
router.get('/stats', async (req, res) => {
    try {
        const { date } = req.query;
        const query = {};
        if (date) {
            const startDate = new Date(date);
            const endDate = new Date(date);
            endDate.setDate(endDate.getDate() + 1);
            query.timestamp = { 
                $gte: startDate,
                $lt: endDate
            };
        }

        const stats = await OrderLog.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$bear_status',
                    count: { $sum: 1 }
                }
            }
        ]);

        res.json(stats);
    } catch (error) {
        console.error('Error fetching order stats:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/retrospective', async (req, res) => {
    try {
        const { date } = req.query;
        const startDate = new Date(date);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setDate(endDate.getDate() + 1);
        const results = await getRetrospective(startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Error fetching retrospective:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/trade-analysis', async (req, res) => {
    try {
        const { date } = req.query;
        const startDate = new Date(date);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setDate(endDate.getDate() + 1);
        const results = await getTradeAnalysis(startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Error fetching trade analysis:', error);
        console.trace(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// New endpoint for date range analytics
router.get('/date-range-analytics', async (req, res) => {
    try {
        const { startDate, endDate, source, direction } = req.query;
        
        // Parse dates
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        
        // Get all trades within date range
        const trades = await getRetrospective(start, end);


        let pairedTrades = await calculatePnLForPairs(trades);
        
        // Filter by source and direction if provided
        if (source && source !== 'all') {
            pairedTrades = pairedTrades.filter(trade => trade.source === source);
        }
        
        if (direction && direction !== 'all') {
            pairedTrades = pairedTrades.filter(trade => trade.direction === direction);
        }
        
        // Group trades by day
        const tradesByDay = pairedTrades.reduce((acc, trade) => {
            const date = new Date(trade.entryTime).toISOString().split('T')[0];
            if (!acc[date]) {
                acc[date] = [];
            }
            acc[date].push(trade);
            return acc;
        }, {});
        
        // Create daily summary data
        const dailyData = Object.entries(tradesByDay).map(([date, dayTrades]) => {
            const winCount = dayTrades.filter(t => t.pnl > 0).length;
            const lossCount = dayTrades.filter(t => t.pnl < 0).length;
            
            return {
                _id: {
                    date,
                    source: source !== 'all' ? source : 'all',
                    direction: direction !== 'all' ? direction : 'all'
                },
                totalOrders: dayTrades.length,
                totalPnL: parseFloat(dayTrades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2)),
                winCount,
                lossCount
            };
        });
        
        // Calculate overall summary
        const totalPnL = parseFloat(pairedTrades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2));
        const winCount = pairedTrades.filter(t => t.pnl > 0).length;
        const lossCount = pairedTrades.filter(t => t.pnl < 0).length;
        const winRate = winCount + lossCount > 0 ? (winCount / (winCount + lossCount) * 100) : 0;
        
        // Get available sources and directions for filters
        const allSources = [...new Set(trades.map(t => t.source))];
        const allDirections = [...new Set(trades.map(t => t.direction))];
        
        const summary = {
            totalOrders: pairedTrades.length,
            totalPnL,
            avgPnL: pairedTrades.length > 0 ? parseFloat((totalPnL / pairedTrades.length).toFixed(2)) : 0,
            winCount,
            lossCount,
            winRate: parseFloat(winRate.toFixed(2)),
            sources: allSources,
            directions: allDirections
        };
        
        res.json({
            dailyData,
            summary,
            // Include these for additional details if needed
            pairedTrades
        });
    } catch (error) {
        console.error('Error fetching date range analytics:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;