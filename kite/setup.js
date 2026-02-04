const { KiteConnect } = require('kiteconnect');
const fs = require('fs');
const path = require('path');
const { runRequests } = require('./login');
const { sendMessageToChannel } = require('../slack-actions');
// require('dotenv').config();

const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
// const requestToken = process.env.REQUEST_TOKEN;
const IS_DEV = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';

const STATE_FILE = path.join(__dirname, 'traderState.json');

// Mock KiteConnect for development environment
class MockKiteConnect {
    constructor() {
        this.accessToken = 'mock_access_token_dev';
    }

    setAccessToken(token) {
        this.accessToken = token;
    }

    async getProfile() {
        return {
            user_name: 'DEV_USER',
            user_id: 'dev_user_001',
            email: 'dev@example.com',
            phone: '+91-9999999999',
            broker: 'ZERODHA'
        };
    }

    async getOrders() {
        return [];
    }

    async getPositions() {
        return {
            net: [],
            day: []
        };
    }

    async getHoldings() {
        return [];
    }

    async getQuote(symbols) {
        // Return mock quotes for symbols
        const quotes = {};
        symbols.forEach(sym => {
            quotes[sym] = {
                instrument_token: 12345,
                tradingsymbol: sym,
                last_price: 100.0,
                bid: 99.95,
                ask: 100.05,
                volume: 1000000,
                timestamp: new Date().toISOString()
            };
        });
        return { data: { quotes } };
    }

    async placeOrder(orderParams) {
        return {
            order_id: `mock_order_${Date.now()}`,
            status: 'success',
            message: '[DEV MODE] Order placement mocked'
        };
    }

    async cancelOrder(order_id, variety = 'regular') {
        return {
            status: 'success',
            message: '[DEV MODE] Order cancellation mocked'
        };
    }

    async modifyOrder(order_id, orderParams, variety = 'regular') {
        return {
            status: 'success',
            message: '[DEV MODE] Order modification mocked'
        };
    }

    async getOrderHistory(order_id) {
        return [];
    }

    async getOrderTrades(order_id) {
        return [];
    }
}

class KiteSetup {
    constructor()  {
        this.isDev = IS_DEV;
        
        if (IS_DEV) {
            console.log('⚙️  [DEV MODE] Using MockKiteConnect - no real Kite API calls will be made');
            this.kc = new MockKiteConnect();
        } else {
            this.kc = new KiteConnect({ api_key: apiKey });
        }
        
        this.state = this.loadState()
        this.state.apiKey = apiKey

    }

    loadState() {
        // Load state from the JSON file
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE);
            return JSON.parse(data);
        }
        return {};
    }

    clearState() {
        this.state = {}
        this.saveState()
    }

    getKiteClient() {
        // Returns the current Kite client (either real or mock)
        return this.kc;
    }

    isDevMode() {
        return this.isDev;
    }

    saveState() {
        // Save the current state to the JSON file
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state));
    }

    async authenticate(re_authenticate, silent=false) {
        try {

            // In development mode, skip actual authentication
            if (this.isDev) {
                if (!silent) {
                    console.log('🪪 [DEV MODE] Authenticated as DEV_USER (mock)');
                }
                this.state.accessToken = 'mock_access_token_dev';
                this.state.tokenDateString = new Date().toDateString();
                this.saveState();
                return true;
            }

            if ( !re_authenticate && this.state.accessToken && new Date().toDateString() == this.state.tokenDateString ) {
                this.kc.setAccessToken(this.state.accessToken)
                // let holdings = await this.kc.getHoldings()
                // console.log(holdings)
                // let profile = await this.kc.getProfile()
                // console.log('🪪 Authenticated for ', profile.user_name)
                // if (!silent) {
                //     console.log(sendMessageToChannel)
                    // await sendMessageToChannel('🪪 Authenticated for ', profile.user_name)
                // }
                return true
            }

            this.clearState()

            const generated_request_token = await runRequests()
            // console.log(generated_request_token, apiSecret)
            const response = await this.kc.generateSession(generated_request_token, apiSecret);
            // let holdings = await this.kc.getHoldings()
            // console.log(holdings)

            console.log('response.access_token', response.access_token)
            
            this.state.accessToken = response.access_token;
            this.state.apiKey = apiKey
            this.state.tokenDateString = new Date().toDateString();
            this.saveState()

            console.log('this.state.accessToken', this.state.accessToken)

            this.kc.setAccessToken(this.state.accessToken);

            let profile = await this.kc.getProfile()
            await sendMessageToChannel('🪪 Authenticated for', profile.user_name)

            return true

        } catch (error) {
            console.error("❌ Error generating session: ", error?.message);
            if (re_authenticate > 3) {
                await sendMessageToChannel('💥 Failing Auth', error?.message)
            }
            else {
                return this.authenticate(re_authenticate + 1)
            }
        }
    }

}

// let kt = new KiteSetup()

// const run = async () => {
//     await kt.startCycle('RELIANCE', 1, 1200)
// }
// run()

const kiteSession = new KiteSetup();

module.exports = {
    kiteSession
};
