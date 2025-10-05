const express = require('express');
const router = express.Router();
const { startZaireSimulation, checkZaireSimulationStatus } = require('../controllers/simulateZaire');
const { startLightyearSimulation, checkLightyearSimulationStatus } = require('../controllers/simulateLightyear');
const { startBaileySimulation, checkBaileySimulationStatus } = require('../controllers/simulateBailey');
const { startBenoitSimulation, checkBenoitSimulationStatus } = require('../controllers/simulateBenoit');

router.post('/simulate/v2/start', async (req, res) => {
    try {
        if (req.body.simulation.type === 'zaire') {
            startZaireSimulation(req, res);
        } else if (req.body.simulation.type === 'bailey') {
            startBaileySimulation(req, res);
        } else if (req.body.simulation.type === 'lightyear') {
            startLightyearSimulation(req, res);
        } else if (req.body.simulation.type === 'benoit') {
            startBenoitSimulation(req, res);
        } else {
            throw new Error('Invalid simulation type');
        }
    } catch (error) {
        console.error('Error starting simulation:', error);
        res.status(500).json({ message: error.message || 'Server error' });
    }
});

// New endpoint to check simulation status
router.get('/simulate/v2/status/:jobId', (req, res) => {
    try {
        if (req.query.type === 'zaire') {
            checkZaireSimulationStatus(req, res);
        } else if (req.query.type === 'lightyear') {
            checkLightyearSimulationStatus(req, res);
        } else if (req.query.type === 'bailey') {
            checkBaileySimulationStatus(req, res);
        } else if (req.query.type === 'benoit') {
            checkBenoitSimulationStatus(req, res);
        } else {
            throw new Error('Invalid simulation type');
        }
    } catch (error) {
        console.error('Error checking simulation status:', error);
        res.status(500).json({ message: error.message || 'Server error' });
    }
});

module.exports = router;
