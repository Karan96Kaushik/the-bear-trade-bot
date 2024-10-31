const { App } = require('@slack/bolt');
const { initialize_slack, sendMessageToChannel } = require('./slack-actions')
const express = require('express');
const { kiteSession } = require('./kite/setup');
const { initialize_server } = require('./express-server');
const { scheduleMISJobs } = require('./kite/scheduledJobs');
const { setupWs } = require('./kite/trader-ws');
const { connectToDatabase } = require('./modules/db');

const expressApp = express();

const log_level = 2 // 0 error; 1 log; 2 debug; 3 info; 4 warn;

console._log = console.log
console.error = log_level >= 0 ? (...l) => console._log('[ERROR]', ...l) : () => {}
console.log = log_level >= 1 ? (...l) => console._log('[LOG]', ...l) : () => {}
console.debug = log_level >= 2 ? (...l) => console._log('[DEBUG]', ...l) : () => {}
console.info = log_level >= 3 ? (...l) => console._log('[INFO]', ...l) : () => {}

const slack_app = new App({
	token: process.env.SLACK_BOT_TOKEN,
	signingSecret: process.env.SLACK_SIGNING_SECRET,
	socketMode: true, // Add this line
	appToken: process.env.SLACK_APP_TOKEN // Add this line
});

const run = async () => {
	await slack_app.start(process.env.SLACK_PORT || 3002)
	console.log('⚡️ Bolt slack_app is running!')
	expressApp.listen(process.env.EXPRESS_PORT || 9002, () => {console.log(`Express app is running on port ${process.env.EXPRESS_PORT || 9002}`)});

	initialize_slack(slack_app)
	initialize_server(expressApp)

	console.log("Connecting to database...")
	await connectToDatabase();


	await sendMessageToChannel('🚀 Starting app!')

	await kiteSession.authenticate()

	setupWs(kiteSession.state.apiKey, kiteSession.state.accessToken)

	if (!process.env.DISABLE_SLACK) {
		scheduleMISJobs()
	}

}

run()