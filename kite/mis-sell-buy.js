const { KiteConnect } = require('kiteconnect');
const fs = require('fs');
const path = require('path');
const { runRequests } = require('./login');
const { sendMessageToChannel } = require('../slack-actions');
// require('dotenv').config();

const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
const requestToken = process.env.REQUEST_TOKEN;

const STATE_FILE = path.join(__dirname, 'traderState.json');

const HOUR_SELL = process.env.NODE_ENV == 'production' ? 3 : 22
const MINUTE_SELL = process.env.NODE_ENV == 'production' ? 46 : 35

const HOUR_BUY = process.env.NODE_ENV == 'production' ? 10 : HOUR_SELL
const MINUTE_BUY = process.env.NODE_ENV == 'production' ? 0 : MINUTE_SELL + 1

console.debug(new Date)

class KiteTrader {
    constructor()  {

        this.kc = new KiteConnect({ api_key: apiKey });
        this.state = this.loadState()
        this.targetBuyPrice = null; // To hold target buy price
        this.state = this.loadState(); // Load previous state

    }

    loadState() {
        // Load state from the JSON file
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE);
            return JSON.parse(data);
        }
        return {};
    }

    saveState() {
        // Save the current state to the JSON file
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state));
    }

    async authenticate(req_token = requestToken) {
        try {

            if ( this.state.accessToken && new Date().toDateString() == this.state.tokenDateString ) {
                this.kc.setAccessToken(this.state.accessToken)
                return true
            }

            const response = await this.kc.generateSession(req_token, apiSecret);
            
            this.state.accessToken = response.access_token;
            this.state.tokenDateString = new Date().toDateString();
            this.saveState()

            this.kc.setAccessToken(this.accessToken);

            console.debug("Authentication successful. Access Token: ", this.accessToken);
            
            sendMessageToChannel("Authentication successful.")

            return true
        } catch (error) {
            console.error("Error generating session: ", error?.message);
                        
            if (error.message == 'Token is invalid or has expired.') {
                const generated_request_token = await runRequests()
                console.debug(generated_request_token, '---------')
                return this.authenticate(generated_request_token)
            }
        }
    }

    startCycle(stockSymbol, quantity, targetPrice) {

        if (!stockSymbol || !quantity || !targetPrice)
            throw new Error('Incomplete params')
        this.stockSymbol = stockSymbol
        this.quantity = quantity
        this.targetPrice = targetPrice


        this.state.stockSymbol = stockSymbol
        this.state.quantity = quantity
        this.state.targetPrice = targetPrice

        this.saveState()

        this.scheduleDailyOrders();

    }

    scheduleDailyOrders() {
        sendMessageToChannel("Starting daily order cycle")
        this.scheduleSellOrder();
        this.scheduleBuyOrder();
    }

    scheduleSellOrder() {
        const sellTime = new Date();
        sellTime.setHours(HOUR_SELL, MINUTE_SELL, 0, 0); // 9:00 AM

        const now = new Date();
        let delay = +sellTime - +now;
        // console.debug(sellTime, now, delay)

        if (delay < 0) {
            this.moveToNextWeekday(sellTime);
            delay = +sellTime - +now;
        }

        sendMessageToChannel('scheduling sell order', sellTime)

        setTimeout(() => {
            this.placeMarketSellOrder();
            this.placeTargetBuyOrder();
            this.state.sellOrderExecuted = true; // Mark sell order as executed
            this.saveState(); // Save the updated state
        }, delay);
    }

    scheduleBuyOrder() {
        const buyTime = new Date();
        buyTime.setHours(HOUR_BUY, MINUTE_BUY, 0, 0); // 3:00 PM

        const now = new Date();
        let delay = +buyTime - +now;

        // Check if it's already past 3:00 PM
        if (delay < 0) {
            // If it's past 3:00 PM today, set for the next weekday
            this.moveToNextWeekday(buyTime);
            delay = +buyTime - +now;
        }

        console.debug('setting buy order', buyTime)
        sendMessageToChannel('scheduling buy order', buyTime)

        // Schedule the buy order
        setTimeout(() => {
            if (!this.state.boughtAtMarket) {
                this.placeMarketBuyOrder(); // Check if a target buy was not placed
            } else {
                console.debug("Buy order was canceled due to target buy order being placed.");
            }

            // Reset the state for the next trading day
            this.resetState();
            this.scheduleDailyOrders(); // Reschedule for the next weekday
        }, delay);
    }

    moveToNextWeekday(date) {
        do {
            date.setDate(date.getDate() + 1);
        } while (date.getDay() === 0 || date.getDay() === 6); // Skip Sunday (0) and Saturday (6)
    }

    resetState() {
        this.state.sellOrderExecuted = false;
        this.state.boughtAtMarket = false; // Reset buy order flag for the next day
        this.targetBuyPrice = null; // Reset target price
        this.saveState(); // Save the reset state
    }

    // Method to place a market sell order
    async placeMarketSellOrder() {
        try {

            // console.debug('market sell order')
            // return
            const sellResponse = await this.kc.placeOrder("regular", {
                exchange: "NSE",
                tradingsymbol: this.stockSymbol,
                transaction_type: "SELL",
                quantity: this.quantity,
                order_type: "MARKET",
                product: "MIS",
                validity: "DAY"
            });

            sendMessageToChannel('sell order executed', sellTime)

            console.debug("Market Sell Order placed successfully: ", sellResponse);
        } catch (error) {
            sendMessageToChannel('Error setting sell order', error?.message)

            console.error("Error placing market sell order: ", error?.message);
        }
    }

    // Method to place a market buy order
    async placeMarketBuyOrder() {
        try {

            // console.debug('market buy order')
            // return
            const buyResponse = await this.kc.placeOrder("regular", {
                exchange: "NSE",
                tradingsymbol: this.stockSymbol,
                transaction_type: "BUY",
                quantity: this.quantity,
                order_type: "MARKET",
                product: "MIS",
                validity: "DAY"
            });
            sendMessageToChannel("Market Buy Order placed successfully: ", buyResponse);            
            // sendMessageToChannel('sell order executed', sellTime)
            console.debug("Market Buy Order placed successfully: ", buyResponse);            
            
        } catch (error) {
            sendMessageToChannel('Error placing market buy order', error?.message)
            console.error("Error placing market buy order: ", error?.message);
        }
    }

    // Method to place a target price buy order
    async placeTargetBuyOrder() {

        console.debug('target buy order')
        // return

        try {
            const targetResponse = await this.kc.placeOrder("regular", {
                exchange: "NSE",
                tradingsymbol: this.stockSymbol,
                transaction_type: "BUY",
                quantity: this.quantity,
                order_type: "LIMIT",
                price: this.targetPrice,
                product: "MIS",
                validity: "DAY"
            });
            sendMessageToChannel("Target Buy Order placed successfully: ", buyResponse);            
            // sendMessageToChannel('sell order executed', sellTime)
            console.debug("Target Price Buy Order placed successfully: ", targetResponse);
        } catch (error) {
            sendMessageToChannel('Error placing target buy order', error?.message)
            console.error("Error placing target buy order: ", error?.message);
        }
    }
}

let kt = new KiteTrader()

// const run = async () => {
//     await kt.startCycle('RELIANCE', 1, 1200)
// }
// run()
module.exports = KiteTrader;
