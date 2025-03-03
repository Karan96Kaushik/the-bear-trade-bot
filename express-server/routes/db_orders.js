const express = require('express');
const router = express.Router();
const OrderLog = require('../../models/OrderLog');
const { getRetrospective, getTradeAnalysis } = require('../../analytics/orders');
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
        startDate.setHours(0, 0, 0, 0);
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
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setDate(endDate.getDate() + 1);
        const results = await getTradeAnalysis(startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Error fetching trade analysis:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;