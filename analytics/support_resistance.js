const { getDataFromYahoo, processYahooData, getDhanNIFTY50Data } = require('../kite/utils');

const PAGES = 10;
const DEFAULT_TOLERANCE = 0.02; // 2% tolerance by default

function findSupportResistanceLevels(df, windowSize = 20, minTouches = 2) {
    const highs = calculateRollingMax(df.map(d => d.high), windowSize);
    const lows = calculateRollingMin(df.map(d => d.low), windowSize);
    
    const resistanceLevels = [];
    const resistanceTouches = {};
    const supportLevels = [];
    const supportTouches = {};
    
    // Find resistance levels
    for (let i = windowSize; i < df.length - windowSize; i++) {
        if (highs[i] === df[i].high) {
            const priceLevel = df[i].high;
            const touches = df.slice(i - windowSize, i + windowSize)
                .filter(d => d.high >= priceLevel * 0.995 && d.high <= priceLevel * 1.005)
                .length;
            
            if (touches >= minTouches) {
                const roundedLevel = Math.round(priceLevel * 100) / 100;
                resistanceLevels.push(roundedLevel);
                resistanceTouches[roundedLevel] = touches;
            }
        }
    }
    
    // Find support levels
    for (let i = windowSize; i < df.length - windowSize; i++) {
        if (lows[i] === df[i].low) {
            const priceLevel = df[i].low;
            const touches = df.slice(i - windowSize, i + windowSize)
                .filter(d => d.low <= priceLevel * 1.005 && d.low >= priceLevel * 0.995)
                .length;
            
            if (touches >= minTouches) {
                const roundedLevel = Math.round(priceLevel * 100) / 100;
                supportLevels.push(roundedLevel);
                supportTouches[roundedLevel] = touches;
            }
        }
    }
    
    return {
        supportLevels: [...new Set(supportLevels)].sort((a, b) => a - b),
        resistanceLevels: [...new Set(resistanceLevels)].sort((a, b) => a - b),
        supportTouches,
        resistanceTouches
    };
}

function isNearLevel(price, level, tolerance) {
    return Math.abs(price - level) <= (level * tolerance);
}

async function scanSupportResistance(tolerance = DEFAULT_TOLERANCE) {
    const nearSupport = [];
    const nearResistance = [];
    let totalStocks = 0;
    let processedStocks = 0;
    const startTime = new Date();
    
    console.log(`Starting scan with tolerance: ${tolerance * 100}%`);
    
    try {
        let stocks = await getDhanNIFTY50Data();
        totalStocks = stocks.length;
        stocks = ['']
        
        for (const stock of stocks) {
            processedStocks++;
            const sym = stock.Sym;
            
            if (processedStocks % 10 === 0) {
                const elapsed = (new Date() - startTime) / 1000;
                const stocksPerSecond = processedStocks / elapsed;
                console.log(`Progress: ${processedStocks}/${totalStocks} stocks processed (${stocksPerSecond.toFixed(2)} stocks/sec)`);
            }
            
            try {
                console.log(`Processing ${sym}`)
                const yahooData = await getDataFromYahoo(sym, 60);
                const df = processYahooData(yahooData);
                
                if (!df || df.length === 0) continue;
                
                const currentPrice = df[df.length - 1].close;
                
                if (df[df.length - 1].volume < 100000) continue;
                
                const { supportLevels, resistanceLevels, supportTouches, resistanceTouches } = 
                    findSupportResistanceLevels(df);
                
                // Check support levels
                for (const level of supportLevels) {
                    console.log(`Checking support ${level}`, currentPrice, tolerance, sym, isNearLevel(currentPrice, level, tolerance))
                    if (isNearLevel(currentPrice, level, tolerance)) {
                        const distance = ((currentPrice - level) / level * 100).toFixed(2);
                        const touches = supportTouches[level];
                        console.log(`${sym}: Near support ${level} (${distance}% away, ${touches} touches)`);
                        nearSupport.push({
                            symbol: sym,
                            currentPrice,
                            supportLevel: level,
                            distance,
                            touches
                        });
                        break;
                    }
                }
                
                // Check resistance levels
                for (const level of resistanceLevels) {
                    if (isNearLevel(currentPrice, level, tolerance)) {
                        const distance = ((level - currentPrice) / level * 100).toFixed(2);
                        const touches = resistanceTouches[level];
                        nearResistance.push({
                            symbol: sym,
                            currentPrice,
                            resistanceLevel: level,
                            distance,
                            touches
                        });
                        break;
                    }
                }
                
            } catch (error) {
                console.error(`Error processing ${sym}:`, error);
                continue;
            }
        }
        
    } catch (error) {
        console.error('Error during scan:', error);
    }
    
    return { nearSupport, nearResistance };
}

// Helper functions
function calculateRollingMax(arr, window) {
    return arr.map((_, i) => 
        Math.max(...arr.slice(Math.max(0, i - window), Math.min(arr.length, i + window + 1)))
    );
}

function calculateRollingMin(arr, window) {
    return arr.map((_, i) => 
        Math.min(...arr.slice(Math.max(0, i - window), Math.min(arr.length, i + window + 1)))
    );
}


async function main(tolerance = DEFAULT_TOLERANCE) {
    console.log("Starting support/resistance scanner");
    const { nearSupport, nearResistance } = await scanSupportResistance(tolerance);
    
    
    console.log("Scan completed successfully");
}

module.exports = {
    scanSupportResistance,
    findSupportResistanceLevels,
    main
};

if (require.main === module) {
    main().catch(console.error);
} 