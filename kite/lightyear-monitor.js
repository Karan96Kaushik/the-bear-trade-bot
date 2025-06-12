const { KiteTicker } = require("kiteconnect");
const { kiteSession } = require('./setup');
const { getInstrumentToken } = require('./utils');
const { readSheetData, processMISSheetData } = require('../gsheets');
const { getDataFromYahoo, processYahooData } = require('./utils');
const { sendMessageToChannel } = require('../slack-actions');

let ticker = null;
let monitoredStocks = new Map();

async function setupLightyearMonitor() {
    try {
        // Disconnect existing ticker if any
        if (ticker) {
            ticker.disconnect();
            ticker = null;
        }
        
        // Clear existing monitored stocks
        monitoredStocks.clear();

        // Read and process MIS-ALPHA sheet data
        let stockData = await readSheetData('MIS-ALPHA!A2:W1000');
        stockData = processMISSheetData(stockData);

        // Filter for Lightyear stocks
        const lightyearStocks = stockData.filter(stock => 
            stock.source?.toLowerCase().includes('lightyear') && 
            stock.stockSymbol && 
            !stock.lastAction?.length
        );

        if (lightyearStocks.length === 0) {
            console.log('No Lightyear stocks found to monitor');
            return;
        }

        // Get existing positions
        await kiteSession.authenticate();
        const positions = await kiteSession.kc.getPositions();
        const netPositions = positions.net.filter(p => p.quantity !== 0);

        // Initialize ticker
        ticker = new KiteTicker({
            api_key: process.env.API_KEY,
            access_token: kiteSession.state.accessToken,
        });

        // Set up event handlers
        ticker.on("ticks", onTicks);
        ticker.on("connect", () => subscribe(lightyearStocks));
        ticker.on("disconnect", onDisconnect);
        ticker.on("error", onError);
        ticker.on("close", onClose);

        // Connect to websocket
        ticker.connect();

        // Store stock data for monitoring and update state based on positions
        lightyearStocks.forEach(stock => {
            const existingPosition = netPositions.find(p => p.tradingsymbol === stock.stockSymbol);
            
            monitoredStocks.set(stock.stockSymbol, {
                ...stock,
                triggerHit: existingPosition ? true : false, // If position exists, mark trigger as hit
                stopLossHit: false,
                hasPosition: existingPosition ? true : false,
                positionQuantity: existingPosition ? existingPosition.quantity : 0
            });
        });

        // Log monitoring state
        const stocksWithPositions = Array.from(monitoredStocks.values()).filter(s => s.hasPosition);
        const stocksWithoutPositions = Array.from(monitoredStocks.values()).filter(s => !s.hasPosition);

        await sendMessageToChannel(
            '🔄 Lightyear Monitor Started',
            `Monitoring ${lightyearStocks.length} stocks\n` +
            `📊 With positions: ${stocksWithPositions.length} stocks\n` +
            `📈 Without positions: ${stocksWithoutPositions.length} stocks`
        );

    } catch (error) {
        console.error('Error setting up Lightyear monitor:', error);
        await sendMessageToChannel('❌ Error setting up Lightyear monitor:', error.message);
    }
}

async function subscribe(stockList) {
    try {
        const tokens = await Promise.all(stockList.map(stock => getInstrumentToken(stock.stockSymbol)));
        ticker.subscribe(tokens);
        ticker.setMode(ticker.modeFull, tokens);
    } catch (error) {
        console.error('Error subscribing to stocks:', error);
    }
}

async function onTicks(ticks) {
    for (const tick of ticks) {
        const stock = Array.from(monitoredStocks.values()).find(s => s.stockSymbol === tick.tradingsymbol);
        if (!stock) continue;

        const currentPrice = tick.last_price;
        
        // Only check trigger price if no position exists
        if (!stock.hasPosition && !stock.triggerHit && currentPrice >= stock.triggerPrice) {
            stock.triggerHit = true;
            await checkAndPlaceOrder(stock, 'TRIGGER', currentPrice);
        }
        
        // Always check stop loss
        if (!stock.stopLossHit && currentPrice <= stock.stopLossPrice) {
            stock.stopLossHit = true;
            await checkAndPlaceOrder(stock, 'STOPLOSS', currentPrice);
        }
    }
}

async function checkAndPlaceOrder(stock, type, currentPrice) {
    try {
        // Get historical data from Yahoo
        const data = await getDataFromYahoo(stock.stockSymbol, 0.5, '1m');
        const candles = processYahooData(data);
        
        // Filter for candles older than 5 minutes
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        const historicalCandles = candles.filter(c => c.time < fiveMinutesAgo);
        
        // Check if price was achieved in historical data
        const priceAchieved = historicalCandles.some(candle => {
            if (type === 'TRIGGER') {
                return candle.high >= stock.triggerPrice;
            } else {
                return candle.low <= stock.stopLossPrice;
            }
        });

        if (priceAchieved) {
            // Place market order
            const order = {
                exchange: "NSE",
                tradingsymbol: stock.stockSymbol,
                transaction_type: stock.type === 'BULLISH' ? 'BUY' : 'SELL',
                quantity: stock.quantity,
                order_type: "MARKET",
                product: "MIS",
                validity: "DAY",
                tag: `lgy-2-${type.toLowerCase()}`
            };

            const orderResponse = await kiteSession.kc.placeOrder("regular", order);
            await sendMessageToChannel(
                `✅ Lightyear ${type} Order Placed`,
                `${stock.stockSymbol} ${stock.type} ${stock.quantity} @ MARKET`
            );
            
            // Remove from monitoring
            monitoredStocks.delete(stock.stockSymbol);
        }
    } catch (error) {
        console.error(`Error placing ${type} order for ${stock.stockSymbol}:`, error);
        await sendMessageToChannel(`❌ Error placing ${type} order for ${stock.stockSymbol}:`, error.message);
    }
}

function onDisconnect(error) {
    console.log("Closed connection on disconnect", error?.response?.data || error?.message || error);
}

function onError(error) {
    console.log("Closed connection on error", error?.response?.data || error?.message || error);
}

function onClose(reason) {
    console.log("Closed connection on close", reason);
}

module.exports = {
    setupLightyearMonitor
}; 