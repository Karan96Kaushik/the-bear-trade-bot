const { kiteSession } = require('./setup');
const { sendMessageToChannel } = require('../slack-actions');
const { readSheetData } = require('../gsheets');

const MAX_ORDER_VALUE = 200000;
const MIN_ORDER_VALUE = 0;
const MIN_SPREAD = 0.5;
const MAX_QUANTITY = 1000;
const MIN_QUANTITY = 1;
const MAX_DATA_AGE_MS = 5 * 60 * 1000; // 5 minutes

async function getLTPWithRetry(symbol, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const ltpData = await kiteSession.kc.getLTP([`NSE:${symbol}`]);
            const ltp = ltpData[`NSE:${symbol}`]?.last_price;
            
            if (!ltp || isNaN(ltp)) {
                throw new Error('LTP is null, undefined, or NaN');
            }
            
            return ltp;
        } catch (error) {
            if (attempt === maxRetries) {
                try {
                    const quote = await kiteSession.kc.getQuote([`NSE:${symbol}`]);
                    const fallbackLtp = quote[`NSE:${symbol}`]?.last_price;
                    if (fallbackLtp && !isNaN(fallbackLtp)) {
                        await sendMessageToChannel(`⚠️ Used quote fallback for LTP: ${symbol}`);
                        return fallbackLtp;
                    }
                } catch (quoteError) {
                    throw new Error(`Failed to get LTP after ${maxRetries} retries: ${error.message}`);
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    throw new Error(`Failed to get LTP for ${symbol} after all retries`);
}

async function readSheetDataWithRetry(range, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await readSheetData(range);
        } catch (error) {
            if (attempt === maxRetries) {
                throw new Error(`Failed to read sheet after ${maxRetries} retries: ${error.message}`);
            }
            await sendMessageToChannel(`⚠️ Sheet read attempt ${attempt}/${maxRetries} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }
}

async function authenticateWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await kiteSession.authenticate();
            return true;
        } catch (error) {
            if (attempt === maxRetries) {
                throw new Error(`Authentication failed after ${maxRetries} retries: ${error.message}`);
            }
            await sendMessageToChannel(`⚠️ Auth attempt ${attempt}/${maxRetries} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }
}

/** Sheet / API often use 0 or empty for "no take-profit"; skip target validation in that case. */
function hasConfiguredTargetPrice(targetPrice) {
    const n = Number(targetPrice);
    return Number.isFinite(n) && n !== 0;
}

function validatePrices(triggerPrice, stopLossPrice, quantity, ltp, symbol, direction, targetPrice) {
    const errors = [];
    
    const spread = Math.abs(triggerPrice - stopLossPrice);
    
    if (spread < MIN_SPREAD) {
        errors.push(`Spread too small: ${spread.toFixed(2)}. Min: ${MIN_SPREAD}`);
    }
    
    if (isNaN(quantity) || !isFinite(quantity)) {
        errors.push(`Invalid quantity: ${quantity}`);
    }
    
    if (quantity === 0) {
        errors.push('Quantity cannot be zero');
    }
    
    if (Math.abs(quantity) > MAX_QUANTITY) {
        errors.push(`Quantity ${Math.abs(quantity)} exceeds max ${MAX_QUANTITY}`);
    }
    
    if (Math.abs(quantity) < MIN_QUANTITY) {
        errors.push(`Quantity ${Math.abs(quantity)} below min ${MIN_QUANTITY}`);
    }
    
    if (ltp && !isNaN(ltp)) {
        const orderValue = Math.abs(quantity) * ltp;
        if (orderValue > MAX_ORDER_VALUE) {
            errors.push(`Order value ₹${orderValue.toFixed(2)} exceeds max ₹${MAX_ORDER_VALUE}`);
        }
        
        if (orderValue < MIN_ORDER_VALUE && MIN_ORDER_VALUE > 0) {
            errors.push(`Order value ₹${orderValue.toFixed(2)} below min ₹${MIN_ORDER_VALUE}`);
        }
    }
    
    if (isNaN(triggerPrice) || isNaN(stopLossPrice)) {
        errors.push(`Invalid price values: trigger=${triggerPrice}, sl=${stopLossPrice}`);
    }

    if (direction && hasConfiguredTargetPrice(targetPrice)) {
        const tp = Number(targetPrice);
        if (direction === 'BULLISH') {
            if (tp <= triggerPrice) {
                errors.push(`Target ${tp} must be above trigger ${triggerPrice} for BULLISH`);
            }
            if (tp <= stopLossPrice) {
                errors.push(`Target ${tp} must be above stop loss ${stopLossPrice} for BULLISH`);
            }
        } else if (direction === 'BEARISH') {
            if (tp >= triggerPrice) {
                errors.push(`Target ${tp} must be below trigger ${triggerPrice} for BEARISH`);
            }
            if (tp >= stopLossPrice) {
                errors.push(`Target ${tp} must be below stop loss ${stopLossPrice} for BEARISH`);
            }
        }
    }
    
    if (errors.length > 0) {
        const errorMsg = `Price validation failed for ${symbol}: ${errors.join('; ')}`;
        throw new Error(errorMsg);
    }
    
    return true;
}

function validateCircuitLimits(triggerPrice, stopLossPrice, direction, lower_circuit_limit, upper_circuit_limit, targetPrice) {
    const errors = [];
    const limitsKnown = Number.isFinite(lower_circuit_limit) && Number.isFinite(upper_circuit_limit);
    
    if (direction === 'BULLISH') {
        if (triggerPrice < lower_circuit_limit || triggerPrice > upper_circuit_limit) {
            errors.push(`Trigger price ${triggerPrice} outside circuit limits [${lower_circuit_limit}, ${upper_circuit_limit}]`);
        }
        if (stopLossPrice < lower_circuit_limit - 10) {
            errors.push(`Stop loss ${stopLossPrice} too far below lower circuit ${lower_circuit_limit}`);
        }
    } else if (direction === 'BEARISH') {
        if (triggerPrice < lower_circuit_limit || triggerPrice > upper_circuit_limit) {
            errors.push(`Trigger price ${triggerPrice} outside circuit limits [${lower_circuit_limit}, ${upper_circuit_limit}]`);
        }
        if (stopLossPrice > upper_circuit_limit + 10) {
            errors.push(`Stop loss ${stopLossPrice} too far above upper circuit ${upper_circuit_limit}`);
        }
    }

    if (limitsKnown && direction && hasConfiguredTargetPrice(targetPrice)) {
        const tp = Number(targetPrice);
        if (tp < lower_circuit_limit || tp > upper_circuit_limit) {
            errors.push(`Target price ${tp} outside circuit limits [${lower_circuit_limit}, ${upper_circuit_limit}]`);
        }
    }
    
    if (errors.length > 0) {
        throw new Error(`Circuit limit validation failed: ${errors.join('; ')}`);
    }
    
    return true;
}

function isDataStale(timestamp, maxAgeMs = MAX_DATA_AGE_MS) {
    if (!timestamp) return false;
    
    const dataAge = +new Date() - Number(timestamp);
    return dataAge > maxAgeMs;
}

function getDataAge(timestamp) {
    if (!timestamp) return null;
    return Math.round((+new Date() - Number(timestamp)) / 60000); // in minutes
}

async function calculateExtremePriceWithFallback(symbol, type, interval, ltp) {
    const { calculateExtremePrice } = require('./utils');
    
    try {
        const extremePrice = await calculateExtremePrice(symbol, type, interval);
        if (extremePrice && !isNaN(extremePrice)) {
            return extremePrice;
        }
    } catch (error) {
        await sendMessageToChannel(`⚠️ calculateExtremePrice failed for ${symbol}, using fallback`);
    }
    
    if (ltp && !isNaN(ltp)) {
        const margin = type === 'highest' ? ltp * 0.005 : -ltp * 0.005;
        const fallbackPrice = ltp + margin;
        await sendMessageToChannel(`📊 Using LTP-based fallback for ${symbol}: ${fallbackPrice.toFixed(2)}`);
        return fallbackPrice;
    }
    
    throw new Error(`Cannot calculate extreme price for ${symbol}, no valid fallback`);
}

module.exports = {
    getLTPWithRetry,
    readSheetDataWithRetry,
    authenticateWithRetry,
    validatePrices,
    validateCircuitLimits,
    isDataStale,
    getDataAge,
    calculateExtremePriceWithFallback,
    MAX_ORDER_VALUE,
    MIN_ORDER_VALUE,
    MIN_SPREAD,
    MAX_QUANTITY,
    MIN_QUANTITY,
    MAX_DATA_AGE_MS
};
