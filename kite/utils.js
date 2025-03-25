const { kiteSession } = require('./setup');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const _ = require('lodash');

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

let redis = null

if (process.env.NODE_ENV != 'production') {
    console.log('Using Redis in development')
    const Redis = require('ioredis');
    redis = new Redis()
}

const memoizeRedis = (fn, ttl = 24*60*60) => { // ttl in seconds for Redis
    return async (...args) => {
        const key = `cache:${JSON.stringify(args)}`;
        
        try {
            // Try to get from Redis cache
            const cached = await redis.get(key);
            
            if (cached) {
                // console.log('Cache hit');
                return JSON.parse(cached);
            }
            
            // If not in cache, execute function
            let result = await fn(...args);
            
            // Store in Redis with TTL
            if (result?.data) {
                result = {data: result.data}
            }
            // console.log(result);
            await redis.set(key, JSON.stringify(result));
            console.log('Cache miss');
            
            return result;
        } catch (error) {
            console.error('Redis cache error:', error);
            // console.error('Redis cache result:', result);
            // Fallback to direct function call if Redis fails
            return fn(...args);
        }
    };
};

const memoizeRAM = (fn, ttl = 5*60*60*1000) => { // 5 hours in milliseconds
    const cache = new Map();
    return async (...args) => {
      const key = JSON.stringify(args);
      const cached = cache.get(key);
      if (cached && cached.timestamp > Date.now() - ttl) {
        console.log('Cache hit');
        return  _.merge({}, cached.value) ;
      }

    const result = await fn(...args);

    cache.set(key, { value: result, timestamp: Date.now() });
    console.log('Cache miss');
    return _.merge({}, result);
  };
};

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
        const instruments = await kiteSession.kc.getInstruments('NSE');

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

const memoize = process.env.NODE_ENV != 'production' ? memoizeRedis : memoizeRAM

const axiosGetYahoo = memoize((...args) => axios.get(...args))

/**
 * Fetch stock data from Yahoo Finance
 * @param {string} sym - The stock symbol (without .NS)
 * @param {number} [days=70] - Number of days of historical data to fetch
 * @param {string} [interval='1d'] - Data interval ('1d', '1h', etc.)
 * @returns {Promise<Object>} The stock data
 */
async function getDataFromYahoo(sym='JPPOWER', days = 70, interval = '1d', startDate, endDate, useCached=false) {
    try {
        const _sym = sym.includes('^') ? sym : sym + '.NS'
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${_sym}`;
        
        let today = new Date();
        let period1Date = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);

        if (startDate && endDate) {
            period1Date = new Date(startDate);
            today = new Date(endDate);
        }

        let usingCache = false
        let requestedDate = new Date(today)

        if (useCached) {
            usingCache = true
            today.setHours(11,0,0,0)
            period1Date.setHours(2,0,0,0)
        }

        // console.log(getDateStringIND(today), getDateStringIND(period1Date))
        
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

        let response

        if (usingCache) {
            response = await axiosGetYahoo(url, { params, headers });
        }
        else {
            response = await axios.get(url, { params, headers })
        }

        if (usingCache) {
            const result = response.data.chart.result[0];
            const quote = result.indicators.quote[0];

            const filteredTimestamps = result.timestamp.filter(t => t*1000 < +requestedDate);
            // console.log('old', result.timestamp.slice(-5).map(t => getDateStringIND(t*1000)))
            // console.log('new', filteredTimestamps.slice(-5).map(t => getDateStringIND(t*1000)))
            // console.log(getDateStringIND(requestedDate))
            const newLength = filteredTimestamps.length;

            result.timestamp = filteredTimestamps;
            
            result.indicators.quote[0] = {
                open: quote.open.slice(0, newLength),
                close: quote.close.slice(0, newLength),
                high: quote.high.slice(0, newLength),
                low: quote.low.slice(0, newLength),
                volume: quote.volume.slice(0, newLength)
            };
        }

        return response.data;
    } catch (error) {
        console.error(`Error fetching data from Yahoo Finance for ${sym}:`, error?.response?.data?.chart?.error?.description);
        throw new Error(error?.response?.data?.chart?.error?.description || error.message);
    }
}

async function getGrowwChartData(sym, start, end, interval = 5, useCached = false) {
    try {

        if (typeof interval == 'string' && interval.includes('m')) interval = parseInt(interval.split('m')[0])

        let startDate = new Date(start)
        let endDate = new Date(end)

        if (useCached) {
            startDate.setHours(2,0,0,0)
            endDate.setHours(11,0,0,0)
        }

        let config = {
            method: 'get',
            maxBodyLength: Infinity,
            url: `https://groww.in/v1/api/charting_service/v2/chart/delayed/exchange/NSE/segment/CASH/${sym}?`,
            params: {
                // intervalInMinutes: 5,
                endTimeInMillis: +endDate,
                // endTimeInMillis: 1735343980000,
                intervalInMinutes: interval,
                startTimeInMillis: +startDate,
                // startTimeInMillis: 1733616000000
            },
            headers: { 
                'Cookie': '_cfuvid=yton6pkeh.8NN5FjyDWIXddfAxHSOmgJmW2fc46.hJ0-1740478174567-0.0.1.1-604800000'
            }
        };

        // const config = {
        //     method: 'get',
        //     maxBodyLength: Infinity,
        //     url: `https://groww.in/v1/api/charting_service/v2/chart/delayed/exchange/NSE/segment/CASH/${sym}`,
        //     params: {
        //         endTimeInMillis: +endDate,
        //         intervalInMinutes: interval,
        //         startTimeInMillis: +startDate
        //     },
        //     headers: {
        //         'Cookie': '_cfuvid=yton6pkeh.8NN5FjyDWIXddfAxHSOmgJmW2fc46.hJ0-1740478174567-0.0.1.1-604800000'
        //     }
        // };

        let response

        if (useCached) {
            response = await axiosGroww(config);
        }
        else {
            response = await axios.request(config);
        }

        return response.data;
    } catch (error) {
        console.error(`Error fetching Groww chart data for ${sym}:`, error);
        throw error;
    }
}

const axiosGroww = memoize((...args) => axios.request(...args))

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
        // console.log(response.data)
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
function processYahooData(yahooData, interval, useCached, isPostMarket = false) {
    const result = yahooData.chart.result[0];
    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    
    let data = timestamps?.map((timestamp, index) => ({
        time: timestamp * 1000,
        // time: new Date(timestamp * 1000).toISOString(),
        open: quote.open[index],
        high: quote.high[index],
        low: quote.low[index],
        close: quote.close[index],
        volume: quote.volume[index]
    }));

    // This is to remove incomplete candles; only applicable for live data
    if (interval && typeof interval == 'string' && !useCached && !isPostMarket) {
        if (interval.includes('m')) interval = parseInt(interval.split('m')[0])
        else if (interval.includes('h')) interval = parseInt(interval.split('h')[0]) * 60
        else if (interval.includes('d')) interval = parseInt(interval.split('d')[0]) * 24 * 60
        
        let roundedTimeForReqCandle = Math.floor(data[data.length - 1].time / (interval * 60 * 1000)) * (interval * 60 * 1000) - (interval * 60 * 1000)
        data = data.filter(d => d.time <= roundedTimeForReqCandle)

        if (data.length == 0 || !data[data.length - 1].close || !data[data.length - 1].open || !data[data.length - 1].high || !data[data.length - 1].low || !data[data.length - 1].volume) {
            throw new Error(`No data found in the given time range`)
        }
        if (data[data.length - 1].time < roundedTimeForReqCandle) {
            throw new Error(`Last candle is not found`)
        }
    }
    else if (useCached && new Date(data[data.length - 1].time).getHours() < 10) {
        data.pop()
    }
    
    return data
}

/**
 * Process Groww data into an ordered array of OHLCV objects
 * @param {Object} growwData - The raw data from Groww
 * @returns {Array} An array of OHLCV objects
 */
function processGrowwData(growwData) {
    const result = growwData.candles;
    
    return result?.map((d, index) => ({
        time: d[0] * 1000,
        // time: new Date(timestamp * 1000).toISOString(),
        open: d[1],
        high: d[2],
        low: d[3],
        close: d[4],
        volume: d[5]
    }));
}

const axiosMoneycontrol = memoize((...args) => axios.request(...args))

/**
 * Fetch stock data from Moneycontrol API
 * @param {string} sym - The stock symbol
 * @param {Date} from - Start date
 * @param {Date} to - End date
 * @param {number} [resolution=1] - Time resolution (1 for minute, 5 for 5 minutes, etc.)
*/
async function getMoneycontrolData(sym, from, to, resolution = 1, useCached = false) {

    if (useCached) {
        from = new Date(from).setHours(2,0,0,0)
        to = new Date(to).setHours(11,0,0,0)
    }

    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?`, // ?symbol=${sym}&resolution=1&from=${from}&to=${to}&countback=${countback}&currencyCode=INR`,
        params: {
            symbol: sym,
            resolution,
            from: parseInt(+from / 1000),
            to: parseInt(+to / 1000),
            countback: 131,
            currencyCode: 'INR'
        }
    };

    let response

    if (useCached) {
        response = await axiosMoneycontrol(config);
    }
    else {
        response = await axios.request(config);
    }

    // console.log(response.request.path)

    return response.data;
}

/**
 * Process Moneycontrol data into an ordered array of OHLCV objects
 * @param {Object} data - The raw data from Moneycontrol
 * @returns {Array} An array of OHLCV objects
 */
function processMoneycontrolData(data) {
    return data.t.map((t, index) => ({
        time: t * 1000,
        open: data.o[index],
        high: data.h[index],
        low: data.l[index],
        close: data.c[index],
        volume: data.v[index]
    }))
}


// getMoneycontrolData('MGL', new Date('2025-03-20'), new Date('2025-03-21'), 30)
//     .then(processMoneycontrolData)
//     .then(console.log).catch(e => console.error(e?.response?.data || e.message))


/**
 * Fetch NIFTY50 stock data from Dhan API
 * @param {number} [pgno=0] - Page number for pagination
 * @returns {Promise<Object>} The stock data containing various financial metrics
 */
async function getDhanNIFTY50Data(pgno = 0) {
    try {
        const url = 'https://ow-scanx-analytics.dhan.co/customscan/fetchdt';
        
        const requestData = {
            data: {
                sort: "Mcap",
                sorder: "desc",
                count: 500,
                params: [
                    { field: "OgInst", op: "", val: "ES" },
                    { field: "Exch", op: "", val: "NSE" }
                ],
                fields: [
                    "Isin", "DispSym", "Mcap", "Pe", "DivYeild", "Revenue",
                    "Year1RevenueGrowth", "NetProfitMargin", "YoYLastQtrlyProfitGrowth",
                    "Year1ROCE", "EBIDTAMargin", "volume", "PricePerchng1year",
                    "PricePerchng3year", "PricePerchng5year", "Ind_Pe", "Pb", "DivYeild",
                    "Eps", "DaySMA50CurrentCandle", "DaySMA200CurrentCandle",
                    "DayRSI14CurrentCandle", "Year1ROCE", "Year1ROE", "Sym"
                ],
                pgno
            }
        };

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
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
        
        if (!response.data?.data) {
            throw new Error('Unexpected JSON structure or missing data');
        }
        
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching data from Dhan API:`, error?.response?.data || error.message);
        throw error;
    }
}

/**
 * Fetch historical stock data from Upstox API
 * @param {string} isin - The ISIN number of the stock
 * @param {string} [interval='day'] - Time interval ('day', 'week', 'month')
 * @param {string} [endDate] - End date in YYYY-MM-DD format
 * @returns {Promise<Object>} The historical stock data
 */
async function getUpstoxHistoricalData(isin, interval = 'day', endDate = '2024-12-02') {
    try {
        const requestId = `WUPW-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const url = `https://service.upstox.com/charts/v2/open/historical/IN/NSE_EQ|${isin}/${interval}/${endDate}/`;
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'x-request-id': requestId,
            'Origin': 'https://upstox.com',
            'Referer': 'https://upstox.com/',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
            'TE': 'trailers'
        };

        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        console.error(`Error fetching Upstox historical data:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Fetch stock data from NSE Charting API
 * @param {string} tradingSymbol - The trading symbol (e.g., "TCS-EQ")
 * @param {number} fromDate - Start timestamp in seconds
 * @param {number} toDate - End timestamp in seconds
 * @param {number} [timeInterval=15] - Time interval in minutes
 * @param {string} [chartPeriod='I'] - Chart period ('I' for intraday)
 * @returns {Promise<Object>} The stock data
 */
async function getNSEChartData(tradingSymbol, fromDate, toDate, timeInterval = 15, chartPeriod = 'I') {
    try {
        const url = 'https://charting.nseindia.com/Charts/ChartData/';
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Content-Type': 'application/json; charset=utf-8',
            'Origin': 'https://charting.nseindia.com',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'TE': 'trailers'
        };

        if (typeof toDate == 'object') toDate = new Date(toDate).getTime() / 1000
        if (typeof fromDate == 'object') fromDate = new Date(fromDate).getTime() / 1000

        const data = {
            exch: 'N',
            tradingSymbol: tradingSymbol + '-EQ',
            fromDate,
            toDate,
            timeInterval,
            chartPeriod,
            chartStart: 0
        };

        const response = await axios.post(url, data, { headers });
        return response.data;
    } catch (error) {
        console.error(`Error fetching NSE chart data for ${tradingSymbol}:`, error?.response?.data || error.message);
        throw error;
    }
}

const processNSEChartData = (data) => {
    return data.t.map((timestamp, index) => ({
        time: timestamp * 1000,
        open: data.o[index],
        high: data.h[index],
        low: data.l[index],
        close: data.c[index],
        volume: data.v[index]
    }))
}

const getMcIndicators = async (sym) => {

    let cleanedSym = sym.replace(/&/g, ' ')
    
    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&query=${cleanedSym}&type=1&format=json`, //&callback=suggest1`,
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0', 
            'Accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01', 
            'Accept-Language': 'en-US,en;q=0.5', 
            'Accept-Encoding': 'gzip, deflate, br, zstd', 
            'X-Requested-With': 'XMLHttpRequest', 
            'DNT': '1', 
            'Sec-GPC': '1', 
            'Connection': 'keep-alive', 
            'Referer': 'https://www.moneycontrol.com/', 
            'Cookie': '_w18g_consent=Y;', 
            'Sec-Fetch-Dest': 'empty', 
            'Sec-Fetch-Mode': 'cors', 
            'Sec-Fetch-Site': 'same-origin', 
            'Priority': 'u=0', 
            'TE': 'trailers'
        }
    };
    
    let result = await axios.request(config)

    if (result.data?.[0].pdt_dis_nm == 'No Result Available') {
        throw new Error(`MC Symbol not found for ${sym}`)
    }
    
    result = result.data.find(s => {
        const s1 = s.pdt_dis_nm.match(/\,(.*)\,/)?.[1]?.trim();
        return s1 === sym?.toUpperCase()
    })
    
    if (!result) {
        throw new Error(`MC Symbol not found for ${sym}`)
    }
    
    let mcId = result.sc_id
    
    config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://priceapi.moneycontrol.com/pricefeed/techindicator/D/${mcId}?fields=pivotLevels,sma,ema`,
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0', 
            'Accept': '*/*', 
            'Accept-Language': 'en-US,en;q=0.5', 
            'Accept-Encoding': 'gzip, deflate, br, zstd', 
            'Referer': 'https://www.moneycontrol.com/', 
            'Device-Type': 'web', 
            'Content-Type': 'application/json', 
            'Origin': 'https://www.moneycontrol.com', 
            'Connection': 'keep-alive', 
            'Sec-Fetch-Dest': 'empty', 
            'Sec-Fetch-Mode': 'cors', 
            'Sec-Fetch-Site': 'same-site', 
            'Priority': 'u=0', 
            'TE': 'trailers', 
            // 'Cookie': '_abck=8AB26665AA49AC3A38857313D3450C15~-1~YAAQlAUXApS0HPOTAQAAWTPA9A2S6tGBUAUZ1Zu8QQCVnDF9WFDiPWz3kbPcSaJGc7fbgrX/2rP4iLA4Uf0/PIRq7NG87S6pf+OqwD4Zvfo/pM40Ny346bmlTJDYdTgyefGTgeI3gqUvcdMTnTTd0DItTtOZyr0mYometox94SP5rtO8CCddlbl66p3xYRbLUz/IhwcyUOeQuqN+IuwRqFzNxv2DT+T1x7wnVHXhPC8F6n8X+ul31O28MbyNGa7M8yrU7+FhJuSX9SUUM29B8qsV5YAbe8UdilDSjOk2B+trQMAtHLCkXe98GUy6sf4bTHLaDF7Svfe+Z5QGLqLwNdqnqjEf0B1bO0LdzeLRSR5uou/tDsztU7C8RkR4P8Wy6k2IynWyoVoWyXorvY1tKlaBotfMzCrXIzmZh8wmAXGmSeYrh6TXkW0cH0Rf6oaYyUWYeX8ugN0uzyPSFREHGHn4lMm+GldOsHRm8Ata/9Hwh2/GJDUgWxOu/gn0GG8AZvYChwZG5Xjg1/ZaGFO/mBm5JZd6Upni4JuOksrci2iJdXCU7cvd/z+DcdKPXoZPC1fJ4fMQrWKmYVDYB3AhbWQY/11xhOhCFipTWk11W99cBUsczXxmXb4oVXc/tByBn55t0OkrMf2azg8C8xd6QH3wkARXMz2BPPLMQZwrPuOAyl/IVuyDqlQ1BqdkAeEwAWCWh+YbQkhXeawooaYGwOqiLgGEjQ==~-1~-1~-1; bm_sz=DEF3C5F454A3F1B31690CD060C1EDE89~YAAQlAUXApW0HPOTAQAAWTPA9BoPbHQ4lqtNW+CjNGbdSjDmrxUEyp7an4n6GeuM8wTjPA4D+HdmpnJF9xzxN7bk2866cfWcZOnjFdJD6JijWqgyKGtX4yQSPy5gmlqJJLFfUukPx6JwNwRZbow0j3oBL0wzXWm37ZBM23wsv9oWN/p9hTsWhC6kgvuohXkLQ/eiPhYKyBx4ayhU1/7gfETpjth7BfbLZxyK/hf2RvPUDgZq7TWbuUUN41bWwqhcFq5VkrlMvKmqVazBm/Wg2LxBptfO4OFIouGtSq1LGbE+9X6MD4MvCZtHXsaMSxSZVMtEK0NvOg8dfy3Fvg0ish3jb/HK7Cmsiu985dAJhR0iSNyAhCAIgqVXDqAjrGs/AQoATjMVZyxUlyqWshotR37ey26mimDUjdbpuxrX3XU=~3229233~4405559; gdpr_region=eu; gdpr_userpolicy_eu=1'
        }
    };
    
    result = await axios.request(config)
    return result.data.data //.pivotLevels
}

// getMcIndicators('LT').then(console.log)

// const dates = [
//     ['2024-11-29', '2024-12-02'],
//     ['2024-11-28', '2024-12-01'], 
//     ['2024-11-27', '2024-11-30'],
//     ['2024-11-26', '2024-11-29'],
//     ['2024-11-25', '2024-11-28'],
//     ['2024-11-24', '2024-11-27'],


// ];

// for (const [startDate, endDate] of dates) {
//     console.log(`Fetching data for ${startDate} to ${endDate}`);
//     const start = Date.now();
//     getNSEChartData('TCS', new Date(startDate), new Date(endDate))
//         .then(data => {
//             const duration = Date.now() - start;
//             console.log(`Completed in ${duration}ms`);
//             // console.log(data);
//         })
//         .catch(err => console.error(`Error fetching data for ${startDate}-${endDate}:`, err));
// }

module.exports = {
    getInstrumentToken,
    getDateStringIND,
    getDataFromYahoo,
    searchUpstoxStocks,
    processYahooData,
    getDhanNIFTY50Data,
    getUpstoxHistoricalData,
    getNSEChartData,
    processNSEChartData,
    getMcIndicators,
    getGrowwChartData,
    processGrowwData,
    getMoneycontrolData,
    processMoneycontrolData,
    memoize
};
