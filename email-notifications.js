const nodemailer = require('nodemailer')
const { getDateStringIND } = require('./kite/utils')

/**
 * Gmail SMTP with account email + App Password (Google Account → Security → App passwords).
 * Plain account password only works if "Less secure app access" is enabled (deprecated).
 */
function buildTransporter() {
    const user = process.env.THE_BEAR_GMAIL_USER
    const pass = process.env.THE_BEAR_GMAIL_PASSWORD
    if (!user || !pass) {
        return null
    }
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
    })
}

/**
 * @param {object} order Kite order payload (COMPLETE MIS)
 */
async function sendCompletedOrderEmail(order) {
    const to = process.env.THE_BEAR_ORDER_EMAIL_TO || process.env.THE_BEAR_GMAIL_USER
    if (!to) {
        return
    }

    const transport = buildTransporter()
    if (!transport) {
        console.warn(
            'email-notifications: set GMAIL_USER and GMAIL_APP_PASSWORD to enable order emails'
        )
        return
    }

    const lines = [
        `Transaction: ${order.transaction_type ?? ''}`,
        `Symbol: ${order.tradingsymbol ?? ''}`,
        `Avg price: ${order.average_price ?? ''}`,
        `Filled qty: ${order.filled_quantity ?? ''}`,
        `Product: ${order.product ?? ''}`,
        `Order type: ${order.order_type ?? ''}`,
        `Status: ${order.status ?? ''}`,
        `Tag: ${order.tag ?? ''}`,
        `Order id: ${order.order_id ?? ''}`,
        `Timestamp: ${getDateStringIND(new Date(order.timestamp))}`,
    ]

    const subject = `[Bear Trade] ${order.tradingsymbol ?? ''} - ${order.transaction_type ?? ''} - ${getDateStringIND(new Date(order.timestamp))}`
    const text = lines.join('\n')

    console.log(to)

    await transport.sendMail({
        from: `"The Bear Trade Bot" <${process.env.THE_BEAR_GMAIL_USER}>`,
        to,
        subject,
        text,
    })
}

// sendCompletedOrderEmail({
//     transaction_type: 'BUY',
//     tradingsymbol: 'NIFTY',
//     average_price: 100,
//     filled_quantity: 100,
//     product: 'MIS',
//     order_type: 'MARKET',
//     status: 'COMPLETE',
//     timestamp: new Date(),
// })
// .then(console.log)
// .catch(console.error)


module.exports = { sendCompletedOrderEmail }
