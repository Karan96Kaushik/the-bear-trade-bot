const { readSheetData } = require('../gsheets');
const { setupOrdersFromSheet } = require('../kite/scheduledJobs');
const { kiteSession } = require('../kite/setup');
const { connectToDatabase } = require('../modules/db');

jest.setTimeout(25000);

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


describe('scheduled orders', () => {
    beforeAll(async () => {
        await connectToDatabase();
      });

    beforeEach(() => {
      jest.clearAllMocks();
    });
  
    test('should create orders from sheet', async () => {
        jest.spyOn(kiteSession, 'authenticate');
        jest.spyOn(kiteSession.kc, 'placeOrder');

      // kiteSession.authenticate.mockResolvedValue();
  
      // kiteSession.kc.placeOrder.mockResolvedValue();
      // kiteSession.kc.getLTP is not mocked, allowing it to call the original function
  
    //   jest.spyOn(kiteSession.kc, 'getLTP');
  
      await setupOrdersFromSheet();
  
    //   expect(kiteSession.authenticate).toHaveBeenCalledTimesMin(1);
      expect(kiteSession.kc.placeOrder).toHaveBeenCalledTimes(2);
      expect(kiteSession.kc.placeOrder).toHaveBeenCalledWith("regular", {
        exchange: 'NSE',
        tradingsymbol: 'JUNIPER',
        transaction_type: 'SELL',
        quantity: 1,
        order_type: 'MARKET',
        product: 'MIS',
        validity: 'DAY'
      });
      expect(kiteSession.kc.placeOrder).toHaveBeenCalledWith("regular", {
        exchange: 'NSE',
        tradingsymbol: 'INDHOTEL',
        transaction_type: 'BUY',
        quantity: 1,
        order_type: 'MARKET',
        product: 'MIS',
        validity: 'DAY'
      });
    //   expect(kiteSession.kc.getLTP).toHaveBeenCalledTimes(2);
    });
  
  });
  