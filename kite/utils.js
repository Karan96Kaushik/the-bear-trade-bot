const { kiteSession } = require('./setup');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const CACHE_FILE_PATH = path.join(__dirname, 'instrumentTokenCache.json');

// Cache to store instrument tokens
let instrumentTokenCache = new Map();

const IND_OFFSET = 3600*1000*5.5
const getDateStringIND = (date) => {
    if (typeof(date) == 'string') date = new Date(date)
    date = new Date(+new Date(date) + IND_OFFSET)
    date = date.toISOString().split('T')
    return date[0] + ' ' + date[1].split('.')[0]
}

/**
 * Load the instrument token cache from the local JSON file
 */
async function loadCacheFromFile() {
    try {
        const data = await fs.readFile(CACHE_FILE_PATH, 'utf8');
        instrumentTokenCache = new Map(JSON.parse(data));
        console.log('Instrument token cache loaded from file');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading cache from file:', error.message);
        }
    }
}

/**
 * Save the instrument token cache to the local JSON file
 */
async function saveCacheToFile() {
    try {
        const data = JSON.stringify(Array.from(instrumentTokenCache.entries()));
        await fs.writeFile(CACHE_FILE_PATH, data, 'utf8');
        console.log('Instrument token cache saved to file');
    } catch (error) {
        console.error('Error saving cache to file:', error.message);
    }
}

/**
 * Get the instrument token for a given trading symbol
 * @param {string} tradingSymbol - The trading symbol (e.g., "NSE:RELIANCE")
 * @returns {Promise<number>} The instrument token
 */
async function getInstrumentToken(tradingSymbol) {
    // Check if the token is already in the cache
    if (instrumentTokenCache.has(tradingSymbol)) {
        return instrumentTokenCache.get(tradingSymbol);
    }

    try {
        // Authenticate the Kite session if needed
        await kiteSession.authenticate();

        // Fetch all instruments
        const instruments = await kiteSession.kc.getInstruments();

        // Find the matching instrument
        const instrument = instruments.find(
            (inst) => `${inst.exchange}:${inst.tradingsymbol}` === tradingSymbol
        );

        if (!instrument) {
            throw new Error(`Instrument not found for symbol: ${tradingSymbol}`);
        }

        // Cache the instrument token
        instrumentTokenCache.set(tradingSymbol, instrument.instrument_token);

        return instrument.instrument_token;
    } catch (error) {
        console.error(`Error fetching instrument token for ${tradingSymbol}:`, error.message);
        throw error;
    }
}

/**
 * Fetch stock data from Yahoo Finance
 * @param {string} sym - The stock symbol (without .NS)
 * @param {number} [days=70] - Number of days of historical data to fetch
 * @param {string} [interval='1d'] - Data interval ('1d', '1h', etc.)
 * @returns {Promise<Object>} The stock data
 */
async function getDataFromYahoo(sym, days = 70, interval = '1d') {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}.NS`;
        
        const today = new Date();
        const period1Date = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
        
        const period1 = Math.floor(period1Date.getTime() / 1000);
        const period2 = Math.floor(today.getTime() / 1000);
        
        const params = {
            period1,
            period2,
            interval,
            includePrePost: 'true',
            events: 'div|split|earn',
            lang: 'en-US',
            region: 'US'
        };
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Referer': 'https://finance.yahoo.com/quote/TATAMOTORS.NS/chart/?guccounter=1',
            'Origin': 'https://finance.yahoo.com',
            'Connection': 'keep-alive'
        };
        
        const response = await axios.get(url, { params, headers });
        return response.data;
    } catch (error) {
        console.error(`Error fetching data from Yahoo Finance for ${sym}:`, error.message);
        throw error;
    }
}

// Load the cache when the module is imported
loadCacheFromFile();

// Save the cache periodically (e.g., every 5 minutes)
setInterval(saveCacheToFile, 5 * 60 * 1000);

module.exports = {
    getInstrumentToken,
    loadCacheFromFile,
    saveCacheToFile,
    getDateStringIND,
    getDataFromYahoo
};
