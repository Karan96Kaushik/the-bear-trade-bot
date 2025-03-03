const { setupZaireOrders } = require('../kite/scheduledJobs');
const { readSheetData, processMISSheetData } = require('../gsheets');
const { scanZaireStocks } = require('../analytics');
const { kiteSession } = require('../kite/setup');
const { sendMessageToChannel } = require('../slack-actions');
const { createZaireOrders } = require('../kite/processor');

// Mock all dependencies
// jest.mock('../gsheets');
jest.mock('../analytics');
jest.mock('../kite/setup');
jest.mock('../slack-actions');
jest.mock('../kite/processor');

describe('setupZaireOrders', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock readSheetData for both calls
        // readSheetData
        //     .mockResolvedValueOnce([['STOCK1'], ['STOCK2']]) // HIGHBETA sheet
        //     .mockResolvedValueOnce([['row1'], ['row2']]); // MIS-ALPHA sheet
        
        // Mock other dependencies
        // processMISSheetData.mockReturnValue([
        //     { stockSymbol: 'EXISTING' }
        // ]);
        
        scanZaireStocks.mockResolvedValue([
            { sym: 'STOCK1', price: 100 },
            { sym: 'EXISTING', price: 200 },
            { sym: 'STOCK3', price: 300 }
        ]);
        
        kiteSession.authenticate.mockResolvedValue();
        kiteSession.kc.getOrders.mockResolvedValue([]);
        kiteSession.kc.getPositions.mockResolvedValue({
            net: [{ tradingsymbol: 'STOCK1' }]
        });
        
        createZaireOrders.mockResolvedValue({ stockSymbol: 'STOCK3' });
        sendMessageToChannel.mockResolvedValue();
    });

    test('should process stocks and create orders correctly', async () => {
        await setupZaireOrders();

        // Verify initial setup
        expect(readSheetData).toHaveBeenCalledWith('HIGHBETA!B2:B150');
        expect(readSheetData).toHaveBeenCalledWith('MIS-ALPHA!A2:W1000');
        expect(kiteSession.authenticate).toHaveBeenCalled();
        
        // Verify stock scanning
        expect(scanZaireStocks).toHaveBeenCalledWith(['STOCK1', 'STOCK2']);
        
        // Verify position and order checks
        expect(kiteSession.kc.getPositions).toHaveBeenCalled();
        expect(kiteSession.kc.getOrders).toHaveBeenCalled();

        // Verify messages sent
        expect(sendMessageToChannel).toHaveBeenCalledWith('⌛️ Executing Zaire MIS Jobs');
        expect(sendMessageToChannel).toHaveBeenCalledWith('🔔 Zaire MIS Stocks: ', expect.any(Array));
        expect(sendMessageToChannel).toHaveBeenCalledWith('🔔 Ignoring coz already in position', 'STOCK1');
        expect(sendMessageToChannel).toHaveBeenCalledWith('🔔 Ignoring coz already in sheet', 'EXISTING');

        // Verify order creation
        expect(createZaireOrders).toHaveBeenCalledWith({ sym: 'STOCK3', price: 300 });
    });

    test('should handle errors gracefully', async () => {
        // Mock a failure in scanZaireStocks
        scanZaireStocks.mockRejectedValue(new Error('Scanning failed'));

        await setupZaireOrders();

        expect(sendMessageToChannel).toHaveBeenCalledWith(
            '🚨 Error running Zaire MIS Jobs',
            'Scanning failed'
        );
        expect(createZaireOrders).not.toHaveBeenCalled();
    });

    test('should handle individual stock errors', async () => {
        createZaireOrders.mockRejectedValue(new Error('Order creation failed'));

        await setupZaireOrders();

        expect(sendMessageToChannel).toHaveBeenCalledWith(
            '🚨 Error running Zaire MIS Jobs',
            expect.any(Object),
            'Order creation failed'
        );
    });
}); 