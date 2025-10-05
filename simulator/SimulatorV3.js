const getAverageMarketOrderPrice = (candle) => {
    const { open, high, low, close } = candle;
    return (open + high + low + close) / 4;
}

class Simulator {
    constructor(simulationParams) {
        const {
            stockSymbol, 
            triggerPrice, 
            stopLossPrice, 
            targetPrice, 
            quantity, 
            direction,
            // startTime,
            // endTime,
            yahooData,
            reEnterPosition,
            orderTime,
            cancelInMins,
            updateSL,
            updateSLInterval,
            updateSLFrequency,
            // marketOrder
            enableDoubleConfirmation,
            doubleConfirmationLookbackHours
        } = simulationParams;

        this.stockSymbol = stockSymbol;
        this.triggerPrice = triggerPrice;
        this.stopLossPrice = stopLossPrice;
        this.targetPrice = targetPrice;
        this.quantity = quantity;
        this.direction = direction
        this.orderTime = orderTime
        // this.startTime = startTime;
        // this.endTime = endTime;
        this.pnl = 0; // Profit and Loss
        this.position = null;
        this.tradeActions = []; // To store actions taken during simulation
        this.yahooData = yahooData;
        this.isPositionOpen = false;
        this.logAction = this.logAction.bind(this);
        this.reEnterPosition = reEnterPosition || false;
        this.cancelInMins = cancelInMins;
        this.updateSL = updateSL || false;
        this.updateSLInterval = updateSLInterval;
        this.updateSLFrequency = updateSLFrequency;
        this.placeAverageMarketPrice = true // placeAverageMarketPrice;
        this.enableDoubleConfirmation = enableDoubleConfirmation || false;
        this.doubleConfirmationLookbackHours = doubleConfirmationLookbackHours || 3;

        // Primarily for Lightyear simulation where trigger is placed at the start of the day (09:15)
        this.isDayStartOrder = new Date(this.orderTime).getUTCHours() == 3 && new Date(this.orderTime).getUTCMinutes() == 45;
    }

    logAction(time, action, price=0) {
        this.tradeActions.push({ time, action: String(action), price });
    }

    /**
     * Checks if a price condition is met in both the current candle and at least one more candle
     * within the lookback period (default 3 hours)
     * 
     * @param {number} currentIndex - Index of current candle in data array
     * @param {number} priceLevel - Price level to check against
     * @param {string} conditionType - Type of condition: 'trigger_bullish', 'trigger_bearish', 'stoploss_bullish', 'stoploss_bearish'
     * @param {Array} data - Array of candle data
     * @param {number} startTime - Earliest time to look back from (orderTime for triggers, trigger execution time for exits)
     * @returns {object} - {isConfirmed: boolean, confirmationCount: number, confirmationTimes: array}
     */
    checkDoubleConfirmation(currentIndex, priceLevel, conditionType, data, startTime) {
        if (!this.enableDoubleConfirmation) {
            return { isConfirmed: true, confirmationCount: 1, confirmationTimes: [] };
        }

        const currentCandle = data[currentIndex];
        const lookbackPeriodMs = this.doubleConfirmationLookbackHours * 60 * 60 * 1000;
        const lookbackStartTime = Math.max(
            currentCandle.time - lookbackPeriodMs,
            startTime  // Don't look back before the order was placed or position opened
        );
        
        // Count how many candles in the lookback period meet the condition
        let confirmationCount = 0;
        const confirmationTimes = [];

        // Start from current index and go backwards
        for (let i = currentIndex; i >= 0; i--) {
            const candle = data[i];
            
            // Stop if we've gone beyond the lookback period
            if (candle.time < lookbackStartTime) {
                break;
            }

            let conditionMet = false;

            switch (conditionType) {
                case 'trigger_bullish':
                    // For bullish trigger, check if high reached or exceeded trigger price
                    conditionMet = candle.high >= priceLevel;
                    break;
                    
                case 'trigger_bearish':
                    // For bearish trigger, check if low reached or went below trigger price
                    conditionMet = candle.low <= priceLevel;
                    break;
                    
                case 'stoploss_bullish':
                    // For bullish stop loss, check if low reached or went below stop loss
                    conditionMet = candle.low <= priceLevel;
                    break;
                    
                case 'stoploss_bearish':
                    // For bearish stop loss, check if high reached or exceeded stop loss
                    conditionMet = candle.high >= priceLevel;
                    break;

                default:
                    console.warn(`Unknown condition type: ${conditionType}`);
                    return { isConfirmed: false, confirmationCount: 0, confirmationTimes: [] };
            }

            if (conditionMet) {
                confirmationCount++;
                confirmationTimes.push(candle.time);
            }
        }

        const isConfirmed = confirmationCount >= 2;
        return { isConfirmed, confirmationCount, confirmationTimes };
    }

    simulateTrading(data) {
        const direction = this.direction
        const triggerPrice = this.triggerPrice
        const targetPrice = this.targetPrice
        let stopLossPrice = this.stopLossPrice
        let openTriggerOrder = true


        if (!data.length) {
            console.log('No data', this.stockSymbol, new Date(this.orderTime).toISOString().split('T')[0])
            return;
        }

        // Primarily for Lightyear simulation where trigger is placed at the start of the day (09:15) and candle changes can be drastic
        let shouldPlaceMarketOrder = (!this.isDayStartOrder) || this.shouldPlaceMarketOrder(data[0].close, triggerPrice, targetPrice, direction)

        if (shouldPlaceMarketOrder) {
            this.tradeActions.push({ time: +new Date(this.orderTime), action: 'Trigger Placed', price: triggerPrice });
        }

        if (!shouldPlaceMarketOrder) {
            this.tradeActions.push({ time: +new Date(this.orderTime), action: 'Trigger Not Placed - too close to trigger price', price: triggerPrice });
        }
        else 
        for (let i = 1; i < data.length; i++) {
            
            const { time, open, high, low, close } = data[i];

            const avgMarketOrderPrice = getAverageMarketOrderPrice(data[i])

            if (time < +this.orderTime) continue;

            const currMinute = (time - data[0].time) / (1000 * 60);
            
            if (!high || !low || !open || !close) {
                continue;
            }

            if (!this.isPositionOpen) {
                if (this.cancelInMins && time > +this.orderTime && ((currMinute % this.cancelInMins) == 0) && openTriggerOrder) {
                    this.exitReason = 'cancelled'
                    this.tradeActions.push({ time, action: 'Cancelled', price: 0 });
                    openTriggerOrder = false
                    break;
                }
                
                // Check if trigger condition is met
                const triggerConditionMet = (direction == 'BULLISH' && high >= triggerPrice) || 
                                            (direction == 'BEARISH' && low <= triggerPrice);
                
                if (!this.isPositionOpen && time > +this.orderTime && triggerConditionMet) {
                    // Log that condition was met on current candle
                    if (this.enableDoubleConfirmation) {
                        this.tradeActions.push({ 
                            time, 
                            action: `Trigger Condition Met - Checking Confirmation`, 
                            price: triggerPrice 
                        });
                    }
                    
                    // Apply double confirmation check for trigger (look back from orderTime)
                    const conditionType = direction == 'BULLISH' ? 'trigger_bullish' : 'trigger_bearish';
                    const { isConfirmed, confirmationCount, confirmationTimes } = this.checkDoubleConfirmation(
                        i, 
                        triggerPrice, 
                        conditionType, 
                        data, 
                        +this.orderTime  // For triggers, look back from when order was placed
                    );
                    
                    if (isConfirmed) {
                        // Log successful confirmation
                        if (this.enableDoubleConfirmation) {
                            confirmationTimes.forEach(time => this.tradeActions.push({ 
                                time, 
                                action: `Trigger Confirmed (${confirmationCount} candles)`, 
                                price: triggerPrice 
                            }));
                        }
                        
                        if (i == 1) this.position = data[0].close;
                        else this.position = this.triggerPrice;
                        // else this.position = this.placeAverageMarketPrice ? avgMarketOrderPrice : this.triggerPrice;

                        this.startedAt = time
                        openTriggerOrder = false
                        this.isPositionOpen = true;
                        this.tradeActions.push({ time, action: 'Trigger Hit', price: this.position });
                        this.tradeActions.push({ time, action: 'Target Placed', price: targetPrice });
                        this.tradeActions.push({ time, action: 'Stop Loss Placed', price: stopLossPrice });
                    } else {
                        // Log failed confirmation
                        this.tradeActions.push({ 
                            time, 
                            action: `Trigger Confirmation Failed (${confirmationCount}/2 candles)`, 
                            price: triggerPrice 
                        });
                    }
                }
            }
            else {

                if (this.updateSL) {
                    if (currMinute % this.updateSLFrequency == 0) {
                        const intStart = currMinute-this.updateSLInterval < 0 ? 0 : currMinute-this.updateSLInterval
                        let pastData = data.slice(intStart, currMinute)
                        // let pastData = data.slice(i-this.updateSLInterval, i)
                        
                        if (direction == 'BULLISH') {
                            let newSL = Math.min(...pastData.map(d => d.low).filter(Boolean))
                            if (newSL > stopLossPrice) {
                                stopLossPrice = newSL
                                this.tradeActions.push({ time, action: 'Stop Loss Updated', price: stopLossPrice });
                            }
                        }
                        else {
                            let newSL = Math.max(...pastData.map(d => d.high).filter(Boolean))
                            if (newSL < stopLossPrice) {
                                stopLossPrice = newSL
                                this.tradeActions.push({ time, action: 'Stop Loss Updated', price: stopLossPrice });
                            }
                        }
                    }
                }
                
                // Check if stop loss condition is met
                const stopLossConditionMet = (direction == 'BEARISH' && stopLossPrice && high >= stopLossPrice) || 
                                             (direction == 'BULLISH' && stopLossPrice && low <= stopLossPrice);
                
                if (stopLossConditionMet) {
                    // Log that condition was met on current candle
                    if (this.enableDoubleConfirmation) {
                        this.tradeActions.push({ 
                            time, 
                            action: `Stop Loss Condition Met - Checking Confirmation`, 
                            price: stopLossPrice 
                        });
                    }
                    
                    // Apply double confirmation check for stop loss (look back from position entry)
                    const conditionType = direction == 'BULLISH' ? 'stoploss_bullish' : 'stoploss_bearish';
                    const { isConfirmed, confirmationCount, confirmationTimes } = this.checkDoubleConfirmation(
                        i, 
                        stopLossPrice, 
                        conditionType, 
                        data,
                        this.startedAt  // For stop loss, look back from when position was opened
                    );
                    
                    if (isConfirmed) {
                        // Log successful confirmation
                        if (this.enableDoubleConfirmation) {
                            confirmationTimes.forEach(time => this.tradeActions.push({ 
                                time, 
                                action: `Stop Loss Confirmed (${confirmationCount} candles)`, 
                                price: stopLossPrice 
                            }));
                        }
                        
                        const exitPrice = stopLossPrice
                        // const exitPrice = this.placeAverageMarketPrice ? avgMarketOrderPrice : stopLossPrice
                        this.pnl -= ((direction == 'BULLISH' ? this.position - exitPrice : exitPrice - this.position) * this.quantity)
                        this.tradeActions.push({ time, action: 'Stop Loss Hit', price: exitPrice });
                        this.exitTime = time
                        this.exitReason = 'stoploss'
                        this.isPositionOpen = false;
                        if (!this.reEnterPosition) {
                            break;
                        }
                    } else {
                        // Log failed confirmation
                        this.tradeActions.push({ 
                            time, 
                            action: `Stop Loss Confirmation Failed (${confirmationCount}/2 candles)`, 
                            price: stopLossPrice 
                        });
                    }
                }


                // Check if target condition is met
                const targetConditionMet = (direction == 'BEARISH' && low <= targetPrice) || 
                                          (direction == 'BULLISH' && high >= targetPrice);
                
                if (targetConditionMet) {
                    const exitPrice = targetPrice
                    // const exitPrice = this.placeAverageMarketPrice ? avgMarketOrderPrice : targetPrice
                    this.pnl += Math.abs((exitPrice - this.position) * this.quantity)
                    // this.pnl += (this.position - targetPrice) * this.quantity + 0.9;
                    this.tradeActions.push({ time, action: 'Target Hit', price: exitPrice });
                    this.exitTime = time
                    this.exitReason = 'target'
                    this.isPositionOpen = false;
                    if (!this.reEnterPosition) {
                        break;
                    }
                }
            }
        }

        if (this.isPositionOpen) {
            // 3:19 (assuming 5m data)
            const lastCandle = data[data.length - 3];
            // if ()
            this.pnl += (this.position - lastCandle.close) * this.quantity;
            this.tradeActions.push({ time: lastCandle.time, action: 'Auto Square-off', price: lastCandle.close });
            this.isPositionOpen = false;
            this.exitTime = lastCandle.time
            this.exitReason = 'squareoff'
        }

        this.data = data;
    }

    async run() {
        const data = this.yahooData;
        this.simulateTrading(data);
    }

    shouldPlaceMarketOrder(ltp, triggerPrice, targetPrice, direction) {
        const targetGain = direction === 'BULLISH' 
            ? targetPrice - triggerPrice
            : triggerPrice - targetPrice;

        if (targetGain < 0) {
            this.exitReason = 'below-target'
            return false;
        }

        if (
            !(direction == 'BEARISH' && ltp < triggerPrice) &&
            !(direction == 'BULLISH' && ltp > triggerPrice)
        ) {
            return true
        }

        if (direction === 'BULLISH') {
            return ltp > triggerPrice && ((targetPrice - ltp) / targetGain > 0.8);
        } else {
            return ltp < triggerPrice && ((ltp - targetPrice) / targetGain > 0.8);
        }
    }
}

module.exports =  { Simulator };
