/**
 * ConfirmationTracker - Phase 1: Isolates confirmation count tracking
 * Prevents bugs from shared state and enables proper re-entry handling
 */
class ConfirmationTracker {
    constructor(requiredConfirmations = 1) {
        this.requiredConfirmations = requiredConfirmations;
        this.count = 0;
        this.history = [];
    }

    record(time, price) {
        this.count++;
        this.history.push({ time, price, confirmationNumber: this.count });
        return this.isConfirmed();
    }

    isConfirmed() {
        return this.count >= this.requiredConfirmations;
    }

    reset() {
        this.count = 0;
        this.history = [];
    }

    getHistory() {
        return [...this.history];
    }
}

/**
 * TradeAction - Phase 2: Centralized action logging with type safety
 * Eliminates string duplication and undefined variable references
 */
const TRADE_ACTIONS = {
    TRIGGER_PLACED: 'Trigger Placed',
    TRIGGER_NOT_PLACED: 'Trigger Not Placed - too close to trigger price',
    TRIGGER_CONFIRMATION: 'Trigger Confirmation',
    TRIGGER_HIT: 'Trigger Hit',
    TARGET_PLACED: 'Target Placed',
    STOPLOSS_PLACED: 'Stop Loss Placed',
    STOPLOSS_UPDATED: 'Stop Loss Updated',
    STOPLOSS_CONFIRMATION: 'Stop Loss Confirmation',
    STOPLOSS_HIT: 'Stop Loss Hit',
    TARGET_HIT: 'Target Hit',
    AUTO_SQUAREOFF: 'Auto Square-off',
    CANCELLED: 'Cancelled',
    CANCELLED_LTP_BELOW_KNIGHT: 'Cancelled - LTP below Knight'
};

const EXIT_REASONS = {
    TARGET: 'target',
    STOPLOSS: 'stoploss',
    CANCELLED: 'cancelled',
    CANCELLED_LTP_BELOW_KNIGHT: 'cancelled-ltp-below-knight',
    SQUAREOFF: 'squareoff',
    BELOW_TARGET: 'below-target'
};

/**
 * InputValidator - Phase 2: Validates constructor parameters
 * Provides clear error messages for invalid configurations
 */
class InputValidator {
    static validate(params) {
        const errors = [];

        // Required parameters
        if (!params.stockSymbol) errors.push('stockSymbol is required');
        if (typeof params.triggerPrice !== 'number' || params.triggerPrice <= 0) {
            errors.push('triggerPrice must be a positive number');
        }
        if (typeof params.stopLossPrice !== 'number' || params.stopLossPrice <= 0) {
            errors.push('stopLossPrice must be a positive number');
        }
        if (typeof params.quantity !== 'number' || params.quantity <= 0) {
            errors.push('quantity must be a positive number');
        }
        if (!['BULLISH', 'BEARISH'].includes(params.direction)) {
            errors.push('direction must be BULLISH or BEARISH');
        }
        if (!Array.isArray(params.yahooData)) {
            errors.push('yahooData must be an array');
        }
        if (!params.orderTime) {
            errors.push('orderTime is required');
        }

        // Optional parameter validation
        if (params.targetPrice && typeof params.targetPrice !== 'number') {
            errors.push('targetPrice must be a number');
        }
        if (params.cancelInMins && typeof params.cancelInMins !== 'number') {
            errors.push('cancelInMins must be a number');
        }
        if (params.updateSLInterval && typeof params.updateSLInterval !== 'number') {
            errors.push('updateSLInterval must be a number');
        }
        if (params.updateSLFrequency && typeof params.updateSLFrequency !== 'number') {
            errors.push('updateSLFrequency must be a number');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

/**
 * Helper function to calculate average market order price
 */
const getAverageMarketOrderPrice = (candle) => {
    const { open, high, low, close } = candle;
    return close;
    // return (open + high + low + close) / 4;
};

/**
 * Main Simulator class - Refactored for better maintainability
 * Maintains 100% backward compatibility with existing API
 */
class Simulator {
    constructor(simulationParams) {
        // Validate input parameters
        const validation = InputValidator.validate(simulationParams);
        if (!validation.isValid) {
            throw new Error(`Invalid simulator parameters: ${validation.errors.join(', ')}`);
        }

        const {
            stockSymbol,
            triggerPrice,
            stopLossPrice,
            targetPrice,
            quantity,
            direction,
            yahooData,
            reEnterPosition,
            orderTime,
            cancelInMins,
            updateSL,
            updateSLInterval,
            updateSLFrequency,
            enableTriggerDoubleConfirmation,
            doubleConfirmationLookbackHours,
            enableStopLossDoubleConfirmation,
            placeAverageMarketPrice // Now configurable (Phase 2)
        } = simulationParams;

        // Determine required confirmations - fixed duplicate logic bug
        const triggerConfirmations = enableTriggerDoubleConfirmation ? 2 : 1;
        const stopLossConfirmations = enableStopLossDoubleConfirmation ? 2 : 1;

        // Initialize confirmation trackers (Phase 1)
        this.triggerTracker = new ConfirmationTracker(triggerConfirmations);
        this.stopLossTracker = new ConfirmationTracker(stopLossConfirmations);

        // Public API properties (backward compatible)
        this.stockSymbol = stockSymbol;
        this.triggerPrice = triggerPrice;
        this.stopLossPrice = stopLossPrice;
        this.initialStopLoss = stopLossPrice; // Store initial SL (The Knight) for LTP cancellation
        this.targetPrice = targetPrice;
        this.quantity = quantity;
        this.direction = direction;
        this.orderTime = orderTime;
        this.pnl = 0; // Profit and Loss
        this.position = null;
        this.tradeActions = []; // To store actions taken during simulation
        this.yahooData = yahooData;
        this.isPositionOpen = false;
        this.startedAt = null; // When position was opened
        this.exitTime = null; // When position was closed
        this.exitReason = null; // Reason for exit

        // Configuration properties
        this.reEnterPosition = reEnterPosition || false;
        this.cancelInMins = cancelInMins;
        this.updateSL = updateSL || false;
        this.updateSLInterval = updateSLInterval;
        this.updateSLFrequency = updateSLFrequency;
        this.placeAverageMarketPrice = placeAverageMarketPrice !== undefined ? placeAverageMarketPrice : true;
        this.enableTriggerDoubleConfirmation = enableTriggerDoubleConfirmation || false;
        this.enableStopLossDoubleConfirmation = enableStopLossDoubleConfirmation || false;
        this.doubleConfirmationLookbackHours = doubleConfirmationLookbackHours || 3;

        // Primarily for Lightyear simulation where trigger is placed at the start of the day (09:15)
        this.isDayStartOrder =
            new Date(this.orderTime).getUTCHours() === 3 &&
            new Date(this.orderTime).getUTCMinutes() === 45;

        // Bind methods
        this.logAction = this.logAction.bind(this);
    }

    /**
     * Log a trade action with timestamp and price
     * @private
     */
    logAction(time, action, price = 0) {
        this.tradeActions.push({ time, action: String(action), price });
    }

    /**
     * Execute the full trading simulation
     */
    async run() {
        const data = this.yahooData;
        this.simulateTrading(data);
    }

    /**
     * Core simulation logic
     * @private
     */
    simulateTrading(data) {
        const direction = this.direction;
        const triggerPrice = this.triggerPrice;
        const targetPrice = this.targetPrice;
        let stopLossPrice = this.stopLossPrice;
        let openTriggerOrder = true;

        if (!data.length) {
            console.log(
                'No data',
                this.stockSymbol,
                new Date(this.orderTime).toISOString().split('T')[0]
            );
            return;
        }

        // Primarily for Lightyear simulation where trigger is placed at the start of the day (09:15) and candle changes can be drastic
        const shouldPlaceMarketOrder =
            !this.isDayStartOrder ||
            this.shouldPlaceMarketOrder(data[0].close, triggerPrice, targetPrice, direction);

        if (shouldPlaceMarketOrder) {
            this.logAction(+new Date(this.orderTime), TRADE_ACTIONS.TRIGGER_PLACED, triggerPrice);
        } else {
            this.logAction(
                +new Date(this.orderTime),
                TRADE_ACTIONS.TRIGGER_NOT_PLACED,
                triggerPrice
            );
            return; // Exit early if market order shouldn't be placed
        }

        // Main trading loop
        for (let i = 1; i < data.length; i++) {
            const { time, open, high, low, close } = data[i];

            if (time < +this.orderTime) continue;

            // Skip incomplete candles
            if (!high || !low || !open || !close) {
                continue;
            }

            const currMinute = (time - data[0].time) / (1000 * 60);
            const avgMarketOrderPrice = getAverageMarketOrderPrice(data[i]);

            if (!this.isPositionOpen) {
                // === ENTRY LOGIC ===

                // Check for LTP-based cancellation (Baxter strategy - cancel if LTP drops below Knight)
                if (
                    this.direction === 'BULLISH' &&
                    close < this.initialStopLoss &&
                    openTriggerOrder &&
                    time > +this.orderTime
                ) {
                    this.exitReason = EXIT_REASONS.CANCELLED_LTP_BELOW_KNIGHT;
                    this.logAction(
                        time,
                        TRADE_ACTIONS.CANCELLED_LTP_BELOW_KNIGHT,
                        close
                    );
                    openTriggerOrder = false;
                    break;
                }

                // Time-based cancellation (original logic)
                if (
                    this.cancelInMins &&
                    time > +this.orderTime &&
                    currMinute % this.cancelInMins === 0 &&
                    openTriggerOrder
                ) {
                    this.exitReason = EXIT_REASONS.CANCELLED;
                    this.logAction(time, TRADE_ACTIONS.CANCELLED, 0);
                    openTriggerOrder = false;
                    break;
                }

                // Check if trigger condition is met
                const triggerConditionMet =
                    (direction === 'BULLISH' && high >= triggerPrice) ||
                    (direction === 'BEARISH' && low <= triggerPrice);

                if (!this.isPositionOpen && time > +this.orderTime && triggerConditionMet) {
                    // Record confirmation with Phase 1 tracker
                    const isConfirmed = this.triggerTracker.record(time, triggerPrice);

                    const confirmationCount = this.triggerTracker.count;
                    const requiredConfirmations = this.triggerTracker.requiredConfirmations;

                    this.logAction(
                        time,
                        `${TRADE_ACTIONS.TRIGGER_CONFIRMATION} (${confirmationCount}/${requiredConfirmations} hits)`,
                        triggerPrice
                    );

                    if (isConfirmed) {
                        // Determine entry price
                        if (i === 1) {
                            this.position = data[0].close;
                        } else {
                            this.position = this.placeAverageMarketPrice
                                ? avgMarketOrderPrice
                                : this.triggerPrice;
                        }

                        this.startedAt = time;
                        openTriggerOrder = false;
                        this.isPositionOpen = true;

                        this.logAction(time, TRADE_ACTIONS.TRIGGER_HIT, this.position);
                        this.logAction(time, TRADE_ACTIONS.TARGET_PLACED, targetPrice);
                        this.logAction(time, TRADE_ACTIONS.STOPLOSS_PLACED, stopLossPrice);
                    }
                }
            } else {
                // === POSITION MANAGEMENT ===

                // Update trailing stop loss
                if (this.updateSL && currMinute % this.updateSLFrequency === 0) {
                    const intStart = currMinute - this.updateSLInterval < 0 ? 0 : currMinute - this.updateSLInterval;
                    const pastData = data.slice(intStart, currMinute);

                    if (direction === 'BULLISH') {
                        const newSL = Math.min(...pastData.map(d => d.low).filter(Boolean));
                        if (newSL > stopLossPrice) {
                            stopLossPrice = newSL;
                            this.logAction(time, TRADE_ACTIONS.STOPLOSS_UPDATED, stopLossPrice);
                        }
                    } else {
                        const newSL = Math.max(...pastData.map(d => d.high).filter(Boolean));
                        if (newSL < stopLossPrice) {
                            stopLossPrice = newSL;
                            this.logAction(time, TRADE_ACTIONS.STOPLOSS_UPDATED, stopLossPrice);
                        }
                    }
                }

                // Check if stop loss condition is met
                const stopLossConditionMet =
                    (direction === 'BEARISH' && stopLossPrice && high >= stopLossPrice) ||
                    (direction === 'BULLISH' && stopLossPrice && low <= stopLossPrice);

                if (stopLossConditionMet) {
                    // Record confirmation with Phase 1 tracker
                    const isConfirmed = this.stopLossTracker.record(time, stopLossPrice);

                    const confirmationCount = this.stopLossTracker.count;
                    const requiredConfirmations = this.stopLossTracker.requiredConfirmations;

                    this.logAction(
                        time,
                        `${TRADE_ACTIONS.STOPLOSS_CONFIRMATION} (${confirmationCount}/${requiredConfirmations} hits)`,
                        stopLossPrice
                    );

                    if (isConfirmed) {
                        // FIXED: Removed undefined variable references (confirmationTimes, confirmationCount)
                        // Phase 2: ConfirmationTracker now provides proper history tracking
                        const exitPrice = this.placeAverageMarketPrice
                            ? avgMarketOrderPrice
                            : stopLossPrice;

                        this.pnl -=
                            (direction === 'BULLISH'
                                ? this.position - exitPrice
                                : exitPrice - this.position) * this.quantity;

                        this.logAction(time, TRADE_ACTIONS.STOPLOSS_HIT, exitPrice);
                        this.exitTime = time;
                        this.exitReason = EXIT_REASONS.STOPLOSS;
                        this.isPositionOpen = false;

                        if (!this.reEnterPosition) {
                            break;
                        } else {
                            // Reset confirmation tracker for re-entry
                            this.stopLossTracker.reset();
                        }
                    }
                }

                // Check if target condition is met
                const targetConditionMet =
                    targetPrice &&
                    ((direction === 'BEARISH' && low <= targetPrice) ||
                        (direction === 'BULLISH' && high >= targetPrice));

                if (targetConditionMet) {
                    const exitPrice = targetPrice;

                    this.pnl += Math.abs((exitPrice - this.position) * this.quantity);

                    this.logAction(time, TRADE_ACTIONS.TARGET_HIT, exitPrice);
                    this.exitTime = time;
                    this.exitReason = EXIT_REASONS.TARGET;
                    this.isPositionOpen = false;

                    if (!this.reEnterPosition) {
                        break;
                    }
                }
            }
        }

        // Auto square-off at end of trading day
        if (this.isPositionOpen) {
            const lastCandle = data[data.length - 3];
            if (lastCandle) {
                this.pnl += (this.position - lastCandle.close) * this.quantity;
                this.logAction(lastCandle.time, TRADE_ACTIONS.AUTO_SQUAREOFF, lastCandle.close);
                this.isPositionOpen = false;
                this.exitTime = lastCandle.time;
                this.exitReason = EXIT_REASONS.SQUAREOFF;
            }
        }

        this.data = data;
    }

    /**
     * Determine if a market order should be placed (Lightyear strategy specific)
     * @private
     */
    shouldPlaceMarketOrder(ltp, triggerPrice, targetPrice, direction) {
        const targetGain =
            direction === 'BULLISH'
                ? targetPrice - triggerPrice
                : triggerPrice - targetPrice;

        if (targetGain < 0) {
            this.exitReason = EXIT_REASONS.BELOW_TARGET;
            return false;
        }

        if (
            !(direction === 'BEARISH' && ltp < triggerPrice) &&
            !(direction === 'BULLISH' && ltp > triggerPrice)
        ) {
            return true;
        }

        if (direction === 'BULLISH') {
            return ltp > triggerPrice && (targetPrice - ltp) / targetGain > 0.8;
        } else {
            return ltp < triggerPrice && (ltp - targetPrice) / targetGain > 0.8;
        }
    }
}

module.exports = { Simulator };
