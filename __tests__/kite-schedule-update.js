const { updateStopLossOrders } = require('../kite/scheduledJobs');
const { kiteSession } = require('../kite/setup');
const { connectToDatabase } = require('../modules/db');

// kiteSession.authenticate = async () => console.log('[KITE AUTH]')

// kiteSession.kc.placeOrder = async (...p) => console.log('[KITE placeOrder]', ...p)


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
        // jest.mock('../kite/scheduledJobs', () => ({
        //     ...jest.requireActual('../kite/scheduledJobs'),
        //     calculateHighestPrice: jest.fn().mockResolvedValue(500),
        // }));
        // console.log(await calculateHighestPrice('JUNIPER'));
	});
	
    beforeEach(() => {
        // jest.clearAllMocks();
        // jest.resetModules();
    });
	
	test('should Update SL from sheet for DOWN', async () => {
		jest.spyOn(kiteSession, 'authenticate');
		jest.spyOn(kiteSession.kc, 'placeOrder');
		jest.spyOn(kiteSession.kc, 'cancelOrder').mockResolvedValue(true);
		jest.spyOn(require('../kite/scheduledJobs'), 'calculateHighestPrice').mockResolvedValue(500);

        jest.spyOn(kiteSession.kc, 'getOrders').mockResolvedValue([
            {
                tradingsymbol: 'JUNIPER',
                transaction_type: 'BUY',
                order_type: 'SL-M',
                trigger_price: 512,
                quantity: 1,
                status: 'TRIGGER PENDING',
                order_id: '1234567890'
            }
        ]); 

		await updateStopLossOrders();
		
		expect(kiteSession.kc.placeOrder).toHaveBeenCalledTimes(1);
		expect(kiteSession.kc.cancelOrder).toHaveBeenCalledTimes(1);
		expect(kiteSession.kc.placeOrder).toHaveBeenCalledWith("regular", {
			exchange: 'NSE',
			tradingsymbol: 'JUNIPER',
			transaction_type: 'BUY',
			quantity: 1,
			order_type: 'SL-M',
            trigger_price: 500,
			product: 'MIS',
			validity: 'DAY'
		});

    // expect(kiteSession.kc.placeOrder).toHaveBeenCalledWith("regular", {
	// 		exchange: 'NSE',
	// 		tradingsymbol: 'JUNIPER',
	// 		transaction_type: 'BUY',
	// 		quantity: 1,
	// 		order_type: 'LIMIT',
    //         price: 360,
	// 		product: 'MIS',
	// 		validity: 'DAY'
	// 	});


		//   expect(kiteSession.kc.getLTP).toHaveBeenCalledTimes(2);
	});
	
});
