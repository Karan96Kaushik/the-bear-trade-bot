const { setupSellOrdersFromSheet } = require('../kite/scheduledJobs');
const { kiteSession } = require('../kite/setup');

// kiteSession.authenticate = async () => console.log('[KITE AUTH]')

kiteSession.kc.placeOrder = async (...p) => console.log('[KITE placeOrder]', ...p)

const run = async () => {
    await setupSellOrdersFromSheet()
}

run()