const { readSheetData } = require('../gsheets');
const { setupSellOrdersFromSheet } = require('../kite/scheduledJobs');
const { kiteSession } = require('../kite/setup');
const { connectToDatabase } = require('../modules/db');

// kiteSession.authenticate = async () => console.log('[KITE AUTH]')

kiteSession.kc.placeOrder = async (...p) => {
    console.log('[KITE placeOrder]', ...p)
    return {
        account_id: 'BH6008-TEST',
        unfilled_quantity: 0,
        checksum: '',
        placed_by: 'BH6008',
        order_id: '241018401399572',
        exchange_order_id: '1200000035695825',
        parent_order_id: null,
        status: 'COMPLETE',
        status_message: null,
        status_message_raw: null,
        order_timestamp: '2024-10-18 12:07:55',
        exchange_update_timestamp: '2024-10-18 12:07:55',
        exchange_timestamp: '2024-10-18 12:07:55',
        variety: 'regular',
        exchange: 'NSE',
        tradingsymbol: p.tradingsymbol,
        instrument_token: 3908097,
        order_type: p.order_type,
        transaction_type: p.transaction_type,
        validity: 'DAY',
        product: 'MIS',
        quantity: p.quantity,
        disclosed_quantity: 0,
        price: 0,
        trigger_price: p.trigger_price,
        average_price: 730.45,
        filled_quantity: 1,
        pending_quantity: 0,
        cancelled_quantity: 0,
        market_protection: 0,
        meta: {},
        tag: null,
        guid: 'TEST-124764X04ngjURq78Ev-TEST'
      }
}

const run = async () => {
    await connectToDatabase()
    // await setupSellOrdersFromSheet()
    const data = await readSheetData('MIS-D!A1:W100')
    console.log(data)
}

run()