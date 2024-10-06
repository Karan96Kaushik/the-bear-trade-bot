const { KiteConnect } = require('kiteconnect');
const fs = require('fs');
const path = require('path');
// require('dotenv').config();

const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
const requestToken = process.env.REQUEST_TOKEN;

const STATE_FILE = path.join(__dirname, 'traderState.json');

class KiteTrader {
    constructor() {

        this.kc = new KiteConnect({ api_key: apiKey });
        this.accessToken = process.env.ACCESS_TOKEN //null;

        if (this.accessToken)
            this.kc.setAccessToken(this.accessToken);

        this.targetBuyPrice = null; // To hold target buy price
        this.state = this.loadState(); // Load previous state
        // this.state.boughtAtMarket = false; // Flag to check if buy order is scheduled

        // Authenticate with Kite Connect
        // this.authenticate(apiSecret, requestToken);
    }


    async authenticate() {
        try {
            // console.log('auth')
            // return
            const response = await this.kc.generateSession(requestToken, apiSecret);
            this.accessToken = response.access_token;
            console.log(response)
            this.state.accessToken = response.access_token;
            this.saveState
            this.kc.setAccessToken(this.accessToken);
            console.log("Authentication successful. Access Token: ", this.accessToken);

            // Start the timers for orders
        } catch (error) {
            console.error("Error generating session: ", error);
        }
    }

    // Function to get orders
    async getOrders() {
        try {
            const orders = await this.kc.getOrders();
            const holdings = await this.kc.getHoldings();
            // console.log("Orders: ", orders);
            return {orders, holdings};
        } catch (error) {
            console.error("Error fetching orders: ", error);
        }
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
}

// let kt = new KiteTrader()

module.exports = KiteTrader;
