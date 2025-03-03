const express = require('express');

const { setupOrdersFromSheet } = require('../../kite/scheduledJobs');
const router = express.Router();

router.get('/run-init-schedule', async (req, res) => {
    try {
        await setupOrdersFromSheet()

        res.status(200).json({ message: 'Scheduled jobs completed' })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: error?.message })
    }
})

module.exports = router;