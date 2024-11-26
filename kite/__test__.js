const { createOrders } = require('./processor')

const run = async () => {
    const res = await createOrders({
        stockSymbol: 'TATAMOTORS',
        type: 'BULLISH',
        quantity: 1,
        triggerPrice: "mkt",
        targetPrice: 784,
        stopLossPrice: 775
    })

    console.log(res)
}

run()