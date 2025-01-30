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
            orderTime
        } = simulationParams;

        // console.log('simulationParams', simulationParams);

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
    }

    logAction(time, action, price=0) {
        this.tradeActions.push({ time, action: String(action), price });
    }

    simulateTrading(data) {
        const direction = this.direction
        const triggerPrice = this.triggerPrice
        const targetPrice = this.targetPrice
        const stopLossPrice = this.stopLossPrice

        for (let i = 1; i < data.length; i++) {
            const { time, open, high, low, close } = data[i];
            
            if (!high || !low || !open || !close) {
                continue;
            }

            if (!this.isPositionOpen) {
                if (!this.isPositionOpen && time > +this.orderTime && ((direction == 'BULLISH' && high >= triggerPrice) || (direction == 'BEARISH' && low <= triggerPrice))) {
                    this.position = this.triggerPrice;

                    this.startedAt = time

                    this.isPositionOpen = true;
                    this.tradeActions.push({ time, action: 'Trigger Hit', price: triggerPrice });
                }
            }
            else {
                if ((direction == 'BEARISH' && stopLossPrice && high >= stopLossPrice) || (direction == 'BULLISH' && stopLossPrice && low <= stopLossPrice)) {
                    this.pnl -= direction == 'BEARISH' ? ((stopLossPrice - this.position) * this.quantity) : ((this.position - stopLossPrice) * this.quantity)
                    this.tradeActions.push({ time, action: 'Stop Loss Hit', price: stopLossPrice });
                    this.isPositionOpen = false;
                    if (!this.reEnterPosition) {
                        break;
                    }
                }

                if ((direction == 'BEARISH' && low <= targetPrice) || (direction == 'BULLISH' && high >= targetPrice) ) {
                    this.pnl += direction == 'BEARISH' ? ((this.position - targetPrice) * this.quantity) : ((targetPrice - this.position) * this.quantity)
                    // this.pnl += (this.position - targetPrice) * this.quantity + 0.9;
                    this.tradeActions.push({ time, action: 'Target Hit', price: targetPrice });
                    this.isPositionOpen = false;
                    if (!this.reEnterPosition) {
                        break;
                    }
                }
            }
        }

        if (this.isPositionOpen) {
            const lastCandle = data[data.length - 1];
            // if ()
            this.pnl += (this.position - lastCandle.close) * this.quantity;
            this.tradeActions.push({ time: lastCandle.time, action: 'Auto Square-off', price: lastCandle.close });
            this.isPositionOpen = false;
        }

        this.data = data;
    }

    async run() {
        const data = this.yahooData;
        this.simulateTrading(data);
    }
}

module.exports =  { Simulator };
