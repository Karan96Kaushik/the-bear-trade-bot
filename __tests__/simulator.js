const { getDataFromYahoo } = require("../kite/utils");

class ShortSellingSimulator {
    constructor(simulationParams) {
        const {
            stockSymbol, 
            sellPrice, 
            stopLossPrice, 
            targetPrice, 
            quantity, 
            updateStopLossFunction,
            startTime,
            endTime
        } = simulationParams;

        this.stockSymbol = stockSymbol;
        this.sellPrice = sellPrice;
        this.stopLossPrice = stopLossPrice;
        this.pnl = 0; // Profit and Loss
        this.updateStopLossFunction = updateStopLossFunction;
        this.startTime = startTime;
        this.endTime = endTime;
        this.quantity = quantity;

    }

    async fetchData() {
        try {
            const data = await getDataFromYahoo(this.stockSymbol, 1, '1m', this.startTime, this.endTime);
            if (!data.chart.result[0].timestamp) {
                throw new Error('No data found for the given time range');
            }
            return {
                indicators: data.chart.result[0].indicators.quote[0],
                timestamps: data.chart.result[0].timestamp
            };
        } catch (error) {
            console.error('Error fetching data:', error);
            throw error;
        }
    }

    simulateTrading(data) {
        const { open, high, low, close } = data.indicators;
        const { timestamps } = data;

        console.log(open.length, timestamps.length)

        for (let i = 0; i < open.length; i++) {

            if (this.updateStopLossFunction) {
                this.stopLossPrice = this.updateStopLossFunction(timestamps, i, high, low, open, close, this.stopLossPrice, timestamps);
            }

            // console.log(timestamps[i], high[i], low[i])

            if (!high[i] || !low[i] || !open[i] || !close[i]) {
                continue;
            }

            if (!this.position && this.sellPrice === 'MKT') {
                // Open a short position at the opening price
                this.position = open[i];
                console.log(`Shorted ${this.quantity} shares of ${this.stockSymbol} at ${open[i]}`);
            }

            if (!this.position && Number(this.sellPrice) && this.sellPrice <= low[i]) {
                // Open a short position at the opening price
                this.position = low[i];
                console.log(`Shorted ${this.quantity} shares of ${this.stockSymbol} at ${open[i]}`);
            }

            // Check for stop loss
            if (high[i] >= this.stopLossPrice) {
                this.pnl -= (this.stopLossPrice - this.position) * this.quantity;
                console.log(`Stop loss hit. Bought back at ${this.stopLossPrice}. P&L: ${this.pnl}`);
                this.position = null;
                break;
            }

            // Check for target price
            if (low[i] <= this.targetPrice) {
                this.pnl += (this.position - this.targetPrice) * this.quantity;
                console.log(`Target price hit. Bought back at ${this.targetPrice}. P&L: ${this.pnl}, Time${timestamps[i]}`);
                this.position = null;
                break;
            }
        }

        console.log('Closing position', 'close', close[close.length - 1])
        // Auto square-off at the end of the day
        if (this.position) {
            this.pnl += (this.position - close[close.length - 1]) * this.quantity;
            console.log(`Auto square-off at ${close[close.length - 1]}. Final P&L: ${this.pnl}`);
            this.position = null;
        }
    }

    async run() {
        const data = await this.fetchData();
        this.simulateTrading(data);
    }
}

const updateStopLossFunction = (timestamps, i, high, low, open, close, stopLossPrice) => {
    // console.log(i, i % 15 , i > 15)
    if (i % 15 === 0 && i > 15) {
        const thirtyMinutesAgo = timestamps[i] - 30 * 60;
        const now = timestamps[i];
        const last30MinData = high.filter((_, index) => {
            if (timestamps[index] <= now && timestamps[index] >= thirtyMinutesAgo) {
                return true;
            }
            return false;
        });
        // console.log('last30MinData', last30MinData.length)
        const highestPrice = Math.max(...last30MinData);
        return highestPrice;
    }
    return stopLossPrice;
}

const simulator = new ShortSellingSimulator({
    stockSymbol: 'GPIL', 
    sellPrice: 185, 
    stopLossPrice: 191, 
    targetPrice: 174, 
    quantity: 500,
    updateStopLossFunction,
    startTime: new Date('2024-10-18'),
    endTime: new Date('2024-10-19')
});

simulator.run();

