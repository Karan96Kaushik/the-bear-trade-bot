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
            updateSLFrequency
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
        this.cancelInMins = cancelInMins || 5;
        this.updateSL = updateSL || false;
        this.updateSLInterval = updateSLInterval;
        this.updateSLFrequency = updateSLFrequency;
    }

    logAction(time, action, price=0) {
        this.tradeActions.push({ time, action: String(action), price });
    }

    simulateTrading(data) {
        const direction = this.direction
        const triggerPrice = this.triggerPrice
        const targetPrice = this.targetPrice
        let stopLossPrice = this.stopLossPrice
        let openTriggerOrder = true

        this.tradeActions.push({ time: +new Date(this.orderTime), action: 'Trigger Placed', price: triggerPrice });

        for (let i = 1; i < data.length; i++) {
            const { time, open, high, low, close } = data[i];

            if (time < +this.orderTime) continue;

            const currMinute = (time - data[0].time) / (1000 * 60);
            
            if (!high || !low || !open || !close) {
                continue;
            }

            if (!this.isPositionOpen) {

                if (!this.isPositionOpen && time > +this.orderTime && ((direction == 'BULLISH' && high >= triggerPrice) || (direction == 'BEARISH' && low <= triggerPrice))) {
                    this.position = this.triggerPrice;

                    this.startedAt = time
                    openTriggerOrder = false
                    this.isPositionOpen = true;
                    this.tradeActions.push({ time, action: 'Trigger Hit', price: triggerPrice });
                    this.tradeActions.push({ time, action: 'Target Placed', price: targetPrice });
                    this.tradeActions.push({ time, action: 'Stop Loss Placed', price: stopLossPrice });
                }

                if (this.cancelInMins && time > +this.orderTime && (i % this.cancelInMins == 0) && openTriggerOrder) {
                    this.tradeActions.push({ time, action: 'Cancelled', price: 0 });
                    openTriggerOrder = false
                    break;
                }
            }
            else {

                if (this.updateSL) {
                    if (currMinute % this.updateSLFrequency == 0) {
                        let pastData = data.slice(i-this.updateSLInterval, i)
                        
                        if (direction == 'BULLISH') {
                            let newSL = Math.min(...pastData.map(d => d.low))
                            if (newSL > stopLossPrice) {
                                stopLossPrice = newSL
                                this.tradeActions.push({ time, action: 'Stop Loss Updated', price: stopLossPrice });
                            }
                        }
                        else {
                            let newSL = Math.max(...pastData.map(d => d.high))
                            if (newSL < stopLossPrice) {
                                stopLossPrice = newSL
                                this.tradeActions.push({ time, action: 'Stop Loss Updated', price: stopLossPrice });
                            }
                        }
                    }
                }
                
                if ((direction == 'BEARISH' && stopLossPrice && high >= stopLossPrice) || (direction == 'BULLISH' && stopLossPrice && low <= stopLossPrice)) {
                    this.pnl -= direction == 'BEARISH' ? ((stopLossPrice - this.position) * this.quantity) : ((this.position - stopLossPrice) * this.quantity)
                    this.tradeActions.push({ time, action: 'Stop Loss Hit', price: stopLossPrice });
                    this.exitTime = time
                    this.isPositionOpen = false;
                    if (!this.reEnterPosition) {
                        break;
                    }
                }


                if ((direction == 'BEARISH' && low <= targetPrice) || (direction == 'BULLISH' && high >= targetPrice) ) {
                    this.pnl += direction == 'BEARISH' ? ((this.position - targetPrice) * this.quantity) : ((targetPrice - this.position) * this.quantity)
                    // this.pnl += (this.position - targetPrice) * this.quantity + 0.9;
                    this.tradeActions.push({ time, action: 'Target Hit', price: targetPrice });
                    this.exitTime = time
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
        }

        this.data = data;
    }

    async run() {
        const data = this.yahooData;
        this.simulateTrading(data);
    }
}

module.exports =  { Simulator };
