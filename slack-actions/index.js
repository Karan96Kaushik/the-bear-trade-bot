let slack_app

const initialize_slack = (app) => {

    slack_app = app

    app.use(async (data) => {
        const { logger, next, body, payload } = data
        logger.info('Received an event');
        await next();
    });

    app.message(async ({ message, say, logger }) => {
        logger.info(`Received message: ${message.text} in ch ${message.channel}`);
        //   if (message.channel === process.env.MONITORED_CHANNEL_ID) {
        logger.info(`Received message in monitored channel: ${message.text}`);
        
        if (message.text.toLowerCase().includes('urgent')) {
            await say({
                text: `<@${message.user}> I noticed you mentioned something urgent. How can I help?`,
                // thread_ts: message.ts // This will reply in a thread
                channel: message.channel
            });
        }
        
        //   }
    });
    
    app.event('app_mention', async ({ event, say, logger }) => {
        logger.info(`Received an app mention: ${event.text}`);
        if (event.text.toLowerCase().includes('pnl') || event.text.toLowerCase().includes('p&l')) {
            const { kiteSession } = require("../kite/setup");
            await kiteSession.authenticate(false, true)

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
            await sendMessageCSVToChannel('Positions', pos, event.channel)
        
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
        
            await sendMessageCSVToChannel('Holdings', hol, event.channel)
            console.log(event.channel)
        }
        else if (event.text.toLowerCase().includes('urgent')) {
            logger.info('Mention contains "urgent"');
            await say({
                text: `Hey there <@${event.user}>! I see you mentioned something urgent. How can I assist you?`,
                // thread_ts: event.ts
                channel: event.channel
            });
        } 
        else {
            logger.info('Mention does not contain "urgent"');
            await say({
                text: `Hello <@${event.user}>! How can I help you today? ` + event.text.toLowerCase(),
                thread_ts: event.ts
            });
        }
    });
    
    app.command('/search-messages', async ({ command, ack, respond, client, logger }) => {
        await ack();
        logger.info('Received /search-messages command');
        
        const [channelId, ...queryParts] = command.text.split(' ');
        const query = queryParts.join(' ');
        
        if (!channelId || !query) {
            await respond('Please provide both a channel ID and a search query.');
            return;
        }
        
        // /search-messages C07NC9XSRU5 ur
        
        console.log(`in:#${channelId} ${query}`)
        
        try {
            const result = await client.conversations.history({
                channel: channelId,
                limit: 100 // Adjust this number as needed
            });
            
            const filteredMessages = result.messages
            .filter(message => message.text.toLowerCase().includes(query))
            .slice(0, 5); // Limit to 5 results
            
            if (filteredMessages.length === 0) {
                await respond('No messages found matching the filter query.');
                return;
            }
            
            const messageList = filteredMessages.map((message, index) => {
                return `${index + 1}. "${message.text}" (ID: ${message.ts})`;
            }).join('\n');
            
            await respond(`Found messages:\n${messageList}\n\nTo delete a message, use /delete-message command with the channel ID and message ID.`);
        } catch (error) {
            logger.error(error);
            await respond('An error occurred while searching for messages.');
        }
    });
    
    app.command('/delete-message', async ({ command, ack, respond, client, logger }) => {
        await ack();
        logger.info('Received /delete-message command');
        
        const [channelId, messageId] = command.text.split(' ');
        
        console.log(channelId, messageId, 'DELETE')
        
        if (!channelId || !messageId) {
            await respond('Please provide both a channel ID and a message ID.');
            return;
        }
        
        try {
            await client.chat.delete({
                channel: channelId,
                ts: messageId
            });
            
            await respond(`Message with ID ${messageId} has been deleted from channel <#${channelId}>.`);
        } catch (error) {
            logger.error(error);
            await respond('An error occurred while trying to delete the message. Make sure you have the necessary permissions and the message ID is correct.');
        }
    });
    
    app.command('/send-to-channel', async ({ command, ack, respond, logger }) => {
        logger.info('Received /send-to-channel command');
        await ack();
        
        const [channelId, ...messageParts] = command.text.split(' ');
        const message = messageParts.join(' ');
        
        if (!channelId || !message) {
            await respond('Please provide both a channel ID and a message.');
            return;
        }
        
        await sendMessageToChannel(channelId, message);
        await respond(`Message sent to channel <#${channelId}>`);
    });
    
    app.command('/trade-stock', async ({ command, ack, respond, logger, say }) => {
        await ack();
        logger.info('Received /trade-stock command');
        
        try {
            await say({
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: "Let's trade!"
                        }
                    },
                    {
                        type: "input",
                        block_id: "stock_block",
                        label: {
                            type: "plain_text",
                            text: "Stock symbol to sell"
                        },
                        element: {
                            type: "plain_text_input",
                            action_id: "stock_input"
                        }
                    },
                    {
                        type: "input",
                        block_id: "count_block",
                        label: {
                            type: "plain_text",
                            text: "Count to sell"
                        },
                        element: {
                            type: "plain_text_input",
                            action_id: "count_input"
                        }
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    text: "Buy"
                                },
                                action_id: "submit_buy_button"
                            },
                            {
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    text: "Sell"
                                },
                                action_id: "submit_sell_button"
                            },
                        ]
                    }
                ],
                text: "Fallback text for clients that don't support interactive messages"
            });
        } catch (error) {
            logger.error(error);
            await respond('An error occurred while sending the interactive message.');
        }
    });
    
    app.action('submit_buy_button', async ({ body, ack, say, logger, client }) => {
        await ack();
        
        const stockValue = body.state.values.stock_block.stock_input.value;
        const countValue = body.state.values.count_block.count_input.value;
    
        const channelId = body.container.channel_id;
        const messageId = body.container.message_ts;
    
        try {
            // Delete the original message that initiated the action
            await client.chat.delete({
                channel: channelId,
                ts: messageId,
            });
    
            // Send a confirmation message
            await say(`You bought: ${stockValue} ${countValue}`);
        } catch (error) {
            logger.error(error);
            await say('An error occurred while processing your input.');
        }
    });
    
    app.action('submit_sell_button', async ({ body, ack, say, logger, client }) => {
        await ack();
        
        const stockValue = body.state.values.stock_block.stock_input.value;
        const countValue = body.state.values.count_block.count_input.value;
    
        const channelId = body.container.channel_id;
        const messageId = body.container.message_ts;
    
        try {
            // Delete the original message that initiated the action
            await client.chat.delete({
                channel: channelId,
                ts: messageId,
            });
    
            // Send a confirmation message
            await say(`You sold: ${stockValue} ${countValue}`);
        } catch (error) {
            logger.error(error);
            await say('An error occurred while processing your input.');
        }
    });
    
}


async function sendMessageCSVToChannel(title, data, channelId) {
	try {
        if (!slack_app)
            return console.log('[SLACK CSV]', data)

        if (Object.values(slack_channel_ids).includes(channelId)) console.log(channelId)
        else if (!channelId) channelId = slack_channel_ids['bot-status-updates']
        else if (process.env.NODE_ENV !== 'production') channelId = slack_channel_ids['dev-test']

        let headers = new Set(data.flatMap(d => Object.keys(d)))
        headers = [...headers]
        let csv_content = headers.join(',')
        csv_content = csv_content + '\n' + data.map(d => headers.map(h => d[h] || '').join(',')).join('\n')

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

	} catch (error) {
		console.error(`Error sending message: ${error}`);
	}
}

const slack_channel_ids = {
	'dev-test': 'C07NC9XSRU5',
	'action-alerts': 'C07Q5T2KFH6',
	'notif-details': 'C07G1LCGYRE',
	'notif-wide-search-details': 'C07GDA3LC7J',
	'notifications': 'C01SF61B0MC',
	'bot-status-updates': 'C07Q8C2TZPA',
    'bot-status-updates-2': 'C07SP6HL50B',
    'bot-status-updates-3': 'C08RQ6UFA91',
    'bot-status-updates-4': 'C09JYFX1UBW',
    'bot-status-updates-5': 'C09MR11KVJT'
}

async function sendMessageToChannel(channel_name='bot-status-updates-5', ...message) {
	try {

        if (!slack_app || process.env.NODE_ENV !== 'production')
            return console.log('[SLACK MSG]', channel_name, ...message)

        let channelId = slack_channel_ids[channel_name]

        if (!channelId) {
            channelId = slack_channel_ids['bot-status-updates-4']
            message.unshift(channel_name)
        }

        if (process.env.NODE_ENV !== 'production') channelId = slack_channel_ids['dev-test']
        message = message.map(s => typeof(s) == 'object' ? JSON.stringify(s, null, 4) : String(s))
        message = message.join(' ')
    
		await slack_app.client.chat.postMessage({
			channel: channelId,
			text: message
		});
		// console.info(`Message sent to channel ${channelId}`);
	} catch (error) {
		console.error(`Error sending message: ${error}`);
	}
}

module.exports = {
    initialize_slack,
    sendMessageToChannel,
    slack_channel_ids,
    sendMessageCSVToChannel

}