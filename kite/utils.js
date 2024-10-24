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
async function getDataFromYahoo(sym='JPPOWER', days = 70, interval = '1d', startDate, endDate) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}.NS`;
        
        let today = new Date();
        let period1Date = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);

        if (startDate && endDate) {
            period1Date = new Date(startDate);
            today = new Date(endDate);
        }
        
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
        console.error(`Error fetching data from Yahoo Finance for ${sym}:`, error?.response?.data);
        throw error;
    }
}

/**
 * Search for stocks using the Upstox API
 * @param {string} query - The search query
 * @param {number} [records=15] - Number of records to fetch
 * @param {number} [pageNumber=1] - Page number for pagination
 * @returns {Promise<Object>} The search results
 */
async function searchUpstoxStocks(query, records = 15, pageNumber = 1) {
    try {
        const requestId = `WUPW-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const url = 'https://service.upstox.com/search/open/v1';
        
        const params = {
            query,
            segments: 'EQ',
            records,
            pageNumber,
            requestId
        };
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Referer': 'https://upstox.com/',
            'Origin': 'https://upstox.com',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
            'Priority': 'u=4',
            'TE': 'trailers'
        };
        
        let response = await axios.get(url, { params, headers });
        console.log(response.data)
        response = response.data.data.searchList.map(item => ({
            tradingSymbol: item.attributes.tradingSymbol,
            name: item.attributes.name,
            exchange: item.attributes.exchange,
          })).filter(item => item.exchange == 'NSE')
        return response;
    } catch (error) {
        console.error(`Error searching Upstox stocks:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Process Yahoo Finance data into an ordered array of OHLCV objects
 * @param {Object} yahooData - The raw data from Yahoo Finance
 * @returns {Array} An array of OHLCV objects
 */
function processYahooData(yahooData) {
    const result = yahooData.chart.result[0];
    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    
    return timestamps.map((timestamp, index) => ({
        time: timestamp * 1000,
        // time: new Date(timestamp * 1000).toISOString(),
        open: quote.open[index],
        high: quote.high[index],
        low: quote.low[index],
        close: quote.close[index],
        volume: quote.volume[index]
    }));
}

/**
 * Fetch stock data from Dhan API
 * @param {Object} params - Parameters for the API request
 * @param {number} [params.count=1000] - Number of records to fetch
 * @param {number} [params.pgno=1] - Page number for pagination
 * @returns {Promise<Object>} The stock data from Dhan API
 */
async function getDhanNIFTY50Data(params = {}) {
    try {
        const url = 'https://ow-scanx-analytics.dhan.co/customscan/fetchdt';
        
        const defaultData = {
            sort: "Mcap",
            sorder: "desc",
            count: 1000,
            params: [
                { field: "idxlist.Indexid", op: "", val: "13" },
                { field: "Exch", op: "", val: "NSE" },
                { field: "OgInst", op: "", val: "ES" }
            ],
            fields: [
                "Isin", "DispSym", "Mcap", "Pe", "DivYeild", "Revenue", "Year1RevenueGrowth",
                "NetProfitMargin", "YoYLastQtrlyProfitGrowth", "EBIDTAMargin", "volume",
                "PricePerchng1year", "PricePerchng3year", "PricePerchng5year", "Ind_Pe",
                "Pb", "DivYeild", "Eps", "DaySMA50CurrentCandle", "DaySMA200CurrentCandle",
                "DayRSI14CurrentCandle", "ROCE", "Roe", "Sym", "PricePerchng1mon", "PricePerchng3mon"
            ],
            pgno: 1
        };

        const requestData = {
            data: {
                ...defaultData,
                ...params
            }
        };

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Referer': 'https://dhan.co/',
            'Content-Type': 'application/json; charset=UTF-8',
            'Origin': 'https://dhan.co',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
            'Priority': 'u=4',
            'TE': 'trailers'
        };

        const response = await axios.post(url, requestData, { headers });
        return response.data?.data;
    } catch (error) {
        console.error(`Error fetching data from Dhan API:`, error?.response?.data);
        throw error;
    }
}

getDhanNIFTY50Data().then(console.log)
// getDhanNIFTY50Data().then(a => console.log(Object.keys(a)))

module.exports = {
    getInstrumentToken,
    getDateStringIND,
    getDataFromYahoo,
    searchUpstoxStocks,
    processYahooData,
    getDhanNIFTY50Data
};
