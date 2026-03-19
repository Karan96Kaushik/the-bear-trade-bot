const express = require('express');

const { authenticateWithRetry } = require('../../kite/baxterHelpers');
const { kiteSession } = require('../../kite/setup');
const { createManualOrdersEntries } = require('../../kite/baxter');
const { acquireLock, releaseLock, hasLock } = require('../../kite/lockManager');

const router = express.Router();

router.post('/', async (req, res) => {
    let lockKey = null;
    let didAcquireLock = false;
    try {
        const {
            symbol,
            direction,
            // Levels mode
            high,
            low,
            // Direct mode
            triggerPrice,
            stopLossPrice,
            // Sizing / optional
            quantity,
            riskAmount,
            reviseSL,
        } = req.body || {};

        if (!symbol) {
            return res.status(400).json({ success: false, message: 'symbol is required' });
        }

        const dir = String(direction || '').toUpperCase();
        if (!['BULLISH', 'BEARISH'].includes(dir)) {
            return res.status(400).json({ success: false, message: 'direction must be BULLISH or BEARISH' });
        }

        const parsed = {
            sym: String(symbol).trim().toUpperCase(),
            direction: dir,
            high: high !== undefined ? Number(high) : undefined,
            low: low !== undefined ? Number(low) : undefined,
            triggerPrice: triggerPrice !== undefined ? Number(triggerPrice) : undefined,
            stopLossPrice: stopLossPrice !== undefined ? Number(stopLossPrice) : undefined,
            quantity: quantity !== undefined ? Number(quantity) : undefined,
            riskAmount: riskAmount !== undefined ? Number(riskAmount) : undefined,
            reviseSL: reviseSL !== undefined ? Number(reviseSL) : undefined,
        };

        const hasLevels = Number.isFinite(parsed.high) && Number.isFinite(parsed.low);
        const hasDirect = Number.isFinite(parsed.triggerPrice) && Number.isFinite(parsed.stopLossPrice);

        if (!hasLevels && !hasDirect) {
            return res.status(400).json({
                success: false,
                message: 'Provide either (high, low) or (triggerPrice, stopLossPrice)',
            });
        }

        lockKey = parsed.sym;
        if (hasLock(lockKey)) {
            return res.status(409).json({ success: false, message: 'Order is already being processed for this symbol' });
        }

        acquireLock(lockKey);
        didAcquireLock = true;

        await authenticateWithRetry();
        await kiteSession.authenticate();

        const result = await createManualOrdersEntries(parsed);
        if (!result) {
            return res.status(422).json({ success: false, message: 'Failed to create order. Check logs.' });
        }

        return res.status(200).json({ success: true, result });
    } catch (error) {
        console.error('Error creating manual order:', error);
        return res.status(500).json({ success: false, message: error?.message || 'Server error' });
    } finally {
        if (didAcquireLock && lockKey) releaseLock(lockKey);
    }
});

module.exports = router;

