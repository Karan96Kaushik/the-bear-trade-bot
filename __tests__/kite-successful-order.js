const { readSheetData } = require('../gsheets');
const { processSuccessfulOrder } = require('../kite/processor');
const { setupOrdersFromSheet } = require('../kite/scheduledJobs');
const { kiteSession } = require('../kite/setup');
const { connectToDatabase } = require('../modules/db');

jest.setTimeout(25000);

// kiteSession.authenticate = async () => console.log('[KITE AUTH]')

kiteSession.kc.placeOrder = async (...p) => {
	console.log('[KITE placeOrder]', ...p)
	return {
		placed_by: 'BH6008',
		status: 'COMPLETE',
		order_timestamp: '2024-10-18 12:07:55',
		exchange: 'NSE',
		tradingsymbol: p.tradingsymbol,
		order_type: p.order_type,
		transaction_type: p.transaction_type,
		validity: 'DAY',
		product: 'MIS',
		quantity: p.quantity,
		price: 0,
		trigger_price: p.trigger_price,
		filled_quantity: 1,
	}
}

describe('scheduled orders', () => {
	beforeAll(async () => {
		await connectToDatabase();
	});
	
	beforeEach(() => {
		jest.clearAllMocks();
	});
	
	test('should create valid SL and target order from sheet for DOWN', async () => {
		jest.spyOn(kiteSession, 'authenticate');
		jest.spyOn(kiteSession.kc, 'placeOrder');

		await processSuccessfulOrder({
			exchange: 'NSE',
			tradingsymbol: 'JUNIPER',
			transaction_type: 'SELL',
			quantity: 1,
			order_type: 'MARKET',
			product: 'MIS',
			validity: 'DAY',
      status: 'COMPLETE'
		});
		
		expect(kiteSession.kc.placeOrder).toHaveBeenCalledTimes(2);
		expect(kiteSession.kc.placeOrder).toHaveBeenCalledWith("regular", {
			exchange: 'NSE',
			tradingsymbol: 'JUNIPER',
			transaction_type: 'BUY',
			quantity: 1,
			order_type: 'SL-M',
      trigger_price: 405,
			product: 'MIS',
			validity: 'DAY'
		});

    expect(kiteSession.kc.placeOrder).toHaveBeenCalledWith("regular", {
			exchange: 'NSE',
			tradingsymbol: 'JUNIPER',
			transaction_type: 'BUY',
			quantity: 1,
			order_type: 'LIMIT',
      price: 360,
			product: 'MIS',
			validity: 'DAY'
		});


		//   expect(kiteSession.kc.getLTP).toHaveBeenCalledTimes(2);
	});
	
});
