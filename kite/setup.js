const { KiteConnect } = require('kiteconnect');
const fs = require('fs');
const path = require('path');
const { runRequests } = require('./login');
const { sendMessageToChannel } = require('../slack-actions');
// require('dotenv').config();

const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
// const requestToken = process.env.REQUEST_TOKEN;

const STATE_FILE = path.join(__dirname, 'traderState.json');

class KiteSetup {
    constructor()  {

        this.kc = new KiteConnect({ api_key: apiKey });
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

    saveState() {
        // Save the current state to the JSON file
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state));
    }

    async authenticate(re_authenticate, silent=false) {
        try {


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
