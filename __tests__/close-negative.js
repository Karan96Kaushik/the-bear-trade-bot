const { closePositions } = require('../kite/scheduledJobs');
const { kiteSession } = require('../kite/setup');
const { sendMessageToChannel } = require('../slack-actions');

jest.mock('../kite/setup');
jest.mock('../slack-actions');

describe('closePositions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should close all non-zero positions', async () => {
    kiteSession.authenticate.mockResolvedValue();
    kiteSession.kc.getPositions.mockResolvedValue({
      net: [
        { exchange: 'NSE', tradingsymbol: 'KNRCON', quantity: -10 },
        { exchange: 'NSE', tradingsymbol: 'JKIL', quantity: 5 },
        { exchange: 'NSE', tradingsymbol: 'MOIL', quantity: 0 },
      ]
    });
    kiteSession.kc.placeOrder.mockResolvedValue();

    await closePositions();

    expect(kiteSession.authenticate).toHaveBeenCalledTimes(1);
    expect(kiteSession.kc.getPositions).toHaveBeenCalledTimes(1);
    expect(kiteSession.kc.placeOrder).toHaveBeenCalledTimes(2);
    expect(kiteSession.kc.placeOrder).toHaveBeenNthCalledWith(1, "regular", expect.objectContaining({
      tradingsymbol: 'KNRCON',
      transaction_type: 'BUY',
      quantity: 10
    }));
    expect(kiteSession.kc.placeOrder).toHaveBeenNthCalledWith(2, "regular", expect.objectContaining({
      tradingsymbol: 'JKIL',
      transaction_type: 'SELL',
      quantity: 5
    }));
    expect(sendMessageToChannel).toHaveBeenCalledTimes(3);
  });

  test('should handle errors when placing orders', async () => {
    kiteSession.authenticate.mockResolvedValue();
    kiteSession.kc.getPositions.mockResolvedValue({
      net: [{ exchange: 'NSE', tradingsymbol: 'KNRCON', quantity: -10 }]
    });
    kiteSession.kc.placeOrder.mockRejectedValue(new Error('Order placement failed'));

    await closePositions();

    expect(kiteSession.authenticate).toHaveBeenCalledTimes(1);
    expect(kiteSession.kc.getPositions).toHaveBeenCalledTimes(1);
    expect(kiteSession.kc.placeOrder).toHaveBeenCalledTimes(1);
    expect(sendMessageToChannel).toHaveBeenCalledTimes(2);
    expect(sendMessageToChannel).toHaveBeenLastCalledWith(
      '🚨 Error placing BUY order to close negative position',
      'KNRCON',
      10,
      'Order placement failed'
    );
  });

  test('should handle authentication errors', async () => {
    kiteSession.authenticate.mockRejectedValue(new Error('Authentication failed'));

    await closePositions();

    expect(kiteSession.authenticate).toHaveBeenCalledTimes(1);
    expect(kiteSession.kc.getPositions).not.toHaveBeenCalled();
    expect(kiteSession.kc.placeOrder).not.toHaveBeenCalled();
    expect(sendMessageToChannel).toHaveBeenCalledTimes(2);
    expect(sendMessageToChannel).toHaveBeenLastCalledWith(
      '🚨 Error running close negative positions job',
      'Authentication failed'
    );
  });

  test('should handle errors when getting positions', async () => {
    kiteSession.authenticate.mockResolvedValue();
    kiteSession.kc.getPositions.mockRejectedValue(new Error('Failed to fetch positions'));

    await closePositions();

    expect(kiteSession.authenticate).toHaveBeenCalledTimes(1);
    expect(kiteSession.kc.getPositions).toHaveBeenCalledTimes(1);
    expect(kiteSession.kc.placeOrder).not.toHaveBeenCalled();
    expect(sendMessageToChannel).toHaveBeenCalledTimes(2);
    expect(sendMessageToChannel).toHaveBeenLastCalledWith(
      '🚨 Error running close negative positions job',
      'Failed to fetch positions'
    );
  });
});

