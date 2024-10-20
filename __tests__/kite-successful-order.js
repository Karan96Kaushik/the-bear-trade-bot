const { processSuccessfulOrder } = require('../kite/processor');
const { sendMessageToChannel } = require("../slack-actions");
const { readSheetData, bulkUpdateCells } = require("../gsheets");
const { kiteSession } = require("../kite/setup");
const OrderLog = require('../models/OrderLog');
const { connectToDatabase } = require('../modules/db');

// // Mock dependencies
jest.mock('../slack-actions');
jest.mock('../gsheets', () => {
  const originalModule = jest.requireActual('../gsheets');
  return {
    ...originalModule,
    readSheetData: jest.fn(),
    bulkUpdateCells: jest.fn(),
  };
});
jest.mock('../kite/setup');
jest.mock('../models/OrderLog');

describe('processSuccessfulOrder', () => {

  beforeAll(async () => {
    await connectToDatabase();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockOrder = {
    product: 'MIS',
    status: 'COMPLETE',
    transaction_type: 'SELL',
    tradingsymbol: 'VTL',
    average_price: 465,
    filled_quantity: 200,
    order_type: 'MARKET',
  };

  
  test('should process a successful SELL order', async () => {
    // Mock readSheetData to return some stock data
    readSheetData.mockResolvedValue([
      [ 'TradeID', 'Symbol', 'Sell Price', 'Stop Loss', 'Target', 'Quantity', 'Last Action', 'Ignore', 'Revise SL'],
      [ 'TMD14', 'VTL', '465',   '470', '425',   '200', '',  '', '1'],
    ]);

    

    // Mock processMISSheetData (you'll need to add this mock if it's not already in your mocks)
    // const processMISSheetData = jest.fn().mockReturnValue([
    //   { stockSymbol: 'VTL', lastAction: 'SELL-500', quantity: 10 }
    // ]);

    await processSuccessfulOrder(mockOrder);

    // Verify OrderLog creation
    expect(OrderLog.create).toHaveBeenCalledWith({
      bear_status: 'COMPLETED',
      ...mockOrder
    });

    // Verify Slack message sent
    expect(sendMessageToChannel).toHaveBeenCalledWith(
      '📬 Order update',
      'SELL',
      'VTL',
      465,
      200,
      'MIS',
      'MARKET',
      'COMPLETE'
    );

    // Verify sheet update
    expect(bulkUpdateCells).toHaveBeenCalled();

    // Verify createBuyLimSLOrders was called (you'll need to mock this function)
    // expect(createBuyLimSLOrders).toHaveBeenCalled();
  });
  if (false)
  test('should process a successful BUY order', async () => {
    const buyOrder = { ...mockOrder, transaction_type: 'BUY' };

    // Mock getOrders to return a single open BUY order
    kiteSession.kc.getOrders.mockResolvedValueOnce([
      { tradingsymbol: 'VTL', status: 'OPEN', transaction_type: 'BUY', order_id: '123' }
    ]);

    await processSuccessfulOrder(buyOrder);

    // Verify OrderLog creation for COMPLETED status
    expect(OrderLog.create).toHaveBeenCalledWith({
      bear_status: 'COMPLETED',
      ...buyOrder
    });

    // Verify cancel order was called
    expect(kiteSession.kc.cancelOrder).toHaveBeenCalledWith('regular', '123');

    // Verify OrderLog creation for CANCELLED status
    expect(OrderLog.create).toHaveBeenCalledWith({
      bear_status: 'CANCELLED',
      ...buyOrder
    });

    // Verify Slack messages
    expect(sendMessageToChannel).toHaveBeenCalledWith(
      '📬 Order update',
      'BUY',
      'VTL',
      500,
      10,
      'MIS',
      'MARKET',
      'COMPLETE'
    );
    expect(sendMessageToChannel).toHaveBeenCalledWith('📁 Closed order', 'VTL', 'MARKET');
  });
  if (false)
  test('should handle errors gracefully', async () => {
    // Force an error by making readSheetData throw
    readSheetData.mockRejectedValueOnce(new Error('Sheet read error'));

    await processSuccessfulOrder(mockOrder);

    // Verify error logging
    expect(console.error).toHaveBeenCalled();
    expect(sendMessageToChannel).toHaveBeenCalledWith('🛑 Error updating sheet!', 'Sheet read error');
  });
}, 10000);
