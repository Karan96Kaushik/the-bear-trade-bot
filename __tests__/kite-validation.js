const { closePositions, validateOrdersFromSheet } = require('../kite/scheduledJobs');
const { kiteSession } = require('../kite/setup');
const { sendMessageToChannel } = require('../slack-actions');

// jest.mock('../kite/setup');
jest.mock('../slack-actions');


describe('validations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should validate orders from sheet', async () => {
    // kiteSession.authenticate.mockResolvedValue();

    // kiteSession.kc.placeOrder.mockResolvedValue();
    // kiteSession.kc.getLTP is not mocked, allowing it to call the original function

    jest.spyOn(kiteSession.kc, 'getLTP');
    jest.spyOn(kiteSession, 'authenticate');

    await validateOrdersFromSheet();

    expect(kiteSession.authenticate).toHaveBeenCalledTimes(1);
    expect(kiteSession.kc.getLTP).toHaveBeenCalledTimes(2);
  });

});

