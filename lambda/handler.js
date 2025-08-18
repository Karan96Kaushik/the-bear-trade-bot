const { scanZaireStocks, getDhanNIFTY50Data, getDateRange, DEFAULT_PARAMS } = require('./analytics');

// Lambda handler function
exports.handler = async (event, context) => {
    try {
        // Parse input parameters from the event
        const {
            stockList = null,
            endDateNew = null, // Default to today
            interval = '15m',
            checkV2 = false,
            checkV3 = true,
            useCached = false,
            params = DEFAULT_PARAMS,
            options = {}
        } = event;

        // If no stockList provided, get NIFTY 50 stocks
        let stocks = stockList;
        if (!stocks || stocks.length === 0) {
            console.log('No stock list provided, fetching NIFTY 50 stocks...');
            const niftyData = await getDhanNIFTY50Data();
            stocks = niftyData.map(stock => stock.Sym);
        }

        console.log(`Scanning ${stocks.length} stocks with parameters:`, {
            endDateNew,
            interval,
            checkV2,
            checkV3,
            useCached,
            params,
            options
        });

        // Call the scanZaireStocks function
        const result = await scanZaireStocks(
            stocks,
            endDateNew,
            interval,
            checkV2,
            checkV3,
            useCached,
            params,
            options
        );

        // Return successful response
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
            },
            body: JSON.stringify({
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                inputParams: {
                    stockCount: stocks.length,
                    endDateNew,
                    interval,
                    checkV2,
                    checkV3,
                    useCached
                }
            })
        };

    } catch (error) {
        console.error('Lambda execution error:', error);
        
        // Return error response
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
            },
            body: JSON.stringify({
                success: false,
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                timestamp: new Date().toISOString()
            })
        };
    }
};

// For local testing
if (require.main === module) {
    // Example test call
    const testEvent = {
        stockList: ['RELIANCE', 'TCS', 'INFY'],
        interval: '15m',
        checkV3: true,
        useCached: true
    };
    
    exports.handler(testEvent, {})
        .then(result => console.log('Test result:', JSON.stringify(result, null, 2)))
        .catch(error => console.error('Test error:', error));
} 