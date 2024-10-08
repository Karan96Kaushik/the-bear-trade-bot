const { App } = require('@slack/bolt');
const { initialize_slack, sendMessageToChannel, slack_channel_ids } = require('../slack-actions');
const { kiteSession } = require('../kite/setup');
const { css } = require('googleapis/build/src/apis/css');

const slack_app = new App({
	token: process.env.SLACK_BOT_TOKEN,
	signingSecret: process.env.SLACK_SIGNING_SECRET,
	socketMode: true, // Add this line
	appToken: process.env.SLACK_APP_TOKEN // Add this line
});


async function sendMessageCSVToChannel(title, data) {
	try {
        let channelId
        if (!slack_app)
            return console.log('[SLACK CSV]', data)

        if (process.env.NODE_ENV !== 'production') channelId = slack_channel_ids['dev-test']

        let headers = new Set(data.flatMap(d => Object.keys(d)))
        headers = [...headers]
        // return console.log(headers)
        let csv_content = headers.join(',')
        csv_content = csv_content + '\n' + data.map(d => headers.map(h => d[h] || '').join(',')).join('\n')
        console.log(csv_content)

        try {
          await slack_app.client.files.uploadV2({
            channel_id: channelId,
            content: csv_content,
            filename: title + '.csv',
            title
          });
      
        } catch (error) {
            console.log(error)
          await respond('An error occurred while uploading the CSV file.');
        }

		// console.info(`Message sent to channel ${channelId}`);
	} catch (error) {
		console.error(`Error sending message: ${error}`);
	}
}

const checkValue = async () => {


    // console.log(hol.map(c=> [c.tradingsymbol, c.pnl]))
    // console.log(hol.reduce((p,c) => p+c.pnl,0))
    return [hol, pos]

}

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
    await sendMessageCSVToChannel('Positions', pos)

    let hol = await kiteSession.kc.getHoldings()
    hol = hol.map(s => ({
        'SYMBOL': s.tradingsymbol,
        'QTY': s.quantity,
        'LTP': s.last_price.toFixed(2),
        'P&L': s.pnl.toFixed(2),
    }))

    await sendMessageCSVToChannel('Holdings', hol)
      
}

run()