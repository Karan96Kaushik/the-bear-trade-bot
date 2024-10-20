const { App } = require('@slack/bolt');
const { initialize_slack, sendMessageToChannel, slack_channel_ids, sendMessageCSVToChannel } = require('../slack-actions');
const { kiteSession } = require('../kite/setup');
const { css } = require('googleapis/build/src/apis/css');

const slack_app = new App({
	token: process.env.SLACK_BOT_TOKEN,
	signingSecret: process.env.SLACK_SIGNING_SECRET,
	socketMode: true, // Add this line
	appToken: process.env.SLACK_APP_TOKEN // Add this line
});


async function run() {

	await slack_app.start(process.env.SLACK_PORT || 3000)
    await kiteSession.authenticate()

    let pos = await kiteSession.kc.getPositions()
    pos = pos.net.map(s => ({
        'SYMBOL': s.tradingsymbol,
        'QTY': s.quantity,
        'LTP': s.last_price.toFixed(2),
        'P&L': s.pnl.toFixed(2),
    }))
    pos.push({
        'SYMBOL': '',
        'QTY': '',
        'LTP': '',
        'P&L': pos.reduce((p,c) => p+Number(c['P&L']), 0).toFixed(2),
    })
    await sendMessageCSVToChannel('Positions', pos)

    let hol = await kiteSession.kc.getHoldings()
    hol = hol.map(s => ({
        'SYMBOL': s.tradingsymbol,
        'QTY': s.quantity,
        'LTP': s.last_price.toFixed(2),
        'P&L': s.pnl.toFixed(2),
    }))

    hol.push({
        'SYMBOL': '',
        'QTY': '',
        'LTP': '',
        'P&L': hol.reduce((p,c) => p+Number(c['P&L']), 0).toFixed(2),
    })

    await sendMessageCSVToChannel('Holdings', hol)

    let ord = await kiteSession.kc.getOrders()
    ord = ord.map(s => ({
        'SYMBOL': s.tradingsymbol,
        'STATUS': s.status,
        'TYPE': s.order_type,
        'S/B': s.transaction_type,
    }))
    await sendMessageCSVToChannel('Orders', ord)

}

run()