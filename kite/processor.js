const { getStockLoc, readSheetData, numberToExcelColumn, bulkUpdateCells, getOrderLoc, processMISSheetData } = require("../gsheets")
const { sendMessageToChannel } = require("../slack-actions")
const { kiteSession } = require("./setup")
const OrderLog = require('../models/OrderLog');

const MAX_ORDER_VALUE = 110000
const MIN_ORDER_VALUE = 0

const createBuyLimSLOrders = async (stock, order) => {
    await kiteSession.authenticate()

    await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol.trim(),
        transaction_type: "BUY",
        quantity: stock.quantity,
        order_type: "SL-M",    // Stop Loss Market
        product: "MIS",        // Intraday
        validity: "DAY",
        trigger_price: Number(stock.stopLossPrice.trim()),  // Stop-loss trigger price
        // guid: 'x' + stock.id + 'xSL' + (order.order_type == 'MANUAL' ? 'man' : ''),
    });
    await sendMessageToChannel('✅ Successfully placed SL-M buy order', stock.stockSymbol, stock.quantity)


    await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol,
        transaction_type: "BUY",
        quantity: Math.abs(stock.quantity),
        order_type: "LIMIT",    // Stop Loss Market
        product: "MIS",        // Intraday
        validity: "DAY",
        price: Number(stock.targetPrice.trim()),  // Stop-loss trigger price
        // guid: 'x' + stock.id + 'xLIM' + (order.order_type == 'MANUAL' ? 'man' : ''),
        // price: stock.targetPrice  // Stop-loss trigger price
    });
    await sendMessageToChannel('✅ Successfully placed LIMIT buy order', stock.stockSymbol, stock.quantity)

}

const processSuccessfulOrder = async (order) => {
    try {
        if (order.product == 'MIS' && order.status == 'COMPLETE') {

            try {
                await OrderLog.create({
                    bear_status: 'COMPLETED',
                    ...order
                });
            } catch (error) {
                await sendMessageToChannel('❌ Error logging order', error?.message)
                console.error('Error logging order', error)
            }

            await sendMessageToChannel('📬 Order update', 
                order.transaction_type, 
                order.tradingsymbol, 
                order.average_price, 
                order.filled_quantity, 
                order.product, 
                order.order_type, 
                order.status
            )

            console.log('📬 Order update', order)

            try {
                let stockData = await readSheetData('MIS-TEST!A1:W100')
                const rowHeaders = stockData.map(a => a[1])
                const colHeaders = stockData[0]
                const [row, col] = getStockLoc(order.tradingsymbol, 'Last Action', rowHeaders, colHeaders)
    
                const updates = [
                    {
                        range: 'MIS-TEST!' + numberToExcelColumn(col) + String(row), 
                        values: [[order.transaction_type + '-' + order.average_price]], 
                    },
                ];
        
                await bulkUpdateCells(updates)                
            } catch (error) {
                console.error(error)
                await sendMessageToChannel('🛑 Error updating sheet!', error.message)
            }

            if (order.transaction_type == 'SELL') {
                let stock = {}
                try {
                    let stockData = await readSheetData('MIS-TEST!A2:W100')
                    stockData = processMISSheetData(stockData)

                    stock = stockData.find(s => s.stockSymbol == order.tradingsymbol)

                    console.log('stock', stock)

                    if (stock.lastAction.includes('SELL')) {
                        await createBuyLimSLOrders(stock, order)
                    }
                } catch (error) {
                    await sendMessageToChannel('💥 Error buy orders', stock.stockSymbol, stock.quantity, error?.message)
                    console.error("💥 Error buy orders: ", stock.stockSymbol, stock.quantity, error?.message);
                }
            }
            // Check if it was a buy order and not placed by Admin Squareoff
            else if (order.transaction_type == 'BUY' && order.placed_by !== 'ADMINSQF') {
                // Closing opposite end order
                let orders = await kiteSession.kc.getOrders()
                orders = orders.filter(o => o.tradingsymbol == order.tradingsymbol && o.status == 'OPEN' && o.transaction_type == 'BUY')

                if (orders.length > 1)
                    await sendMessageToChannel('😱 Multiple pending buy orders found!!')
                else if (orders.length < 1)
                    await sendMessageToChannel('😱 Pending order not found!!')
                else {
                    await kiteSession.kc.cancelOrder('regular', orders[0].order_id)
                    
                    try {
                        await OrderLog.create({
                            bear_status: 'CANCELLED',
                            ...order,
                        });
                    } catch (error) {
                        await sendMessageToChannel('❌ Error logging order', error?.message)
                        console.error('Error logging order', error)
                    }

                    await sendMessageToChannel('📁 Closed order', order.tradingsymbol, order.order_type)
                }
            }
        }
        
    } catch (error) {
        console.error('Error processing message', error)
        await sendMessageToChannel('📛 Error processing order update', error.message)
    }
}

const createOrders = async (stock) => {
    try {
        if (stock.ignore)
            return console.log('IGNORING', stock.stockSymbol)

        await kiteSession.authenticate()

        const sym = `NSE:${stock.stockSymbol}`
        let ltp = await kiteSession.kc.getLTP([sym]);
        ltp = ltp[sym].last_price
        let order_value = Number(stock.quantity) * Number(ltp)

        if (order_value > MAX_ORDER_VALUE || order_value < MIN_ORDER_VALUE)
            throw new Error(`Order value ${order_value} not within limits!`)

        if (stock.type == 'DOWN' && Number(stock.triggerPrice) > ltp) {
            await sendMessageToChannel('🔔 Cannot place target sell order: LTP lower than Sell Price.', stock.stockSymbol, stock.quantity, "Sell Price:", stock.triggerPrice, 'LTP: ', ltp)
            return
        }
        if (stock.type == 'UP' && Number(stock.triggerPrice) < ltp) {
            await sendMessageToChannel('🔔 Cannot place target buy order: LTP higher than Trigger Price.', stock.stockSymbol, stock.quantity, "Trigger Price:", stock.triggerPrice, 'LTP: ', ltp)
            return
        }

        let orderResponse;
        if (stock.triggerPrice?.trim() == 'MKT') {
            orderResponse = await kiteSession.kc.placeOrder("regular", {
                exchange: "NSE",
                tradingsymbol: stock.stockSymbol.trim(),
                transaction_type: stock.type == "DOWN" ? "SELL" : "BUY",
                quantity: Number(stock.quantity),
                order_type: "MARKET",
                product: "MIS",
                validity: "DAY"
            });
            await sendMessageToChannel('✅ Successfully placed Market SELL order', stock.stockSymbol, stock.quantity)
        }
        else {
            orderResponse = await kiteSession.kc.placeOrder("regular", {
                exchange: "NSE",
                tradingsymbol: stock.stockSymbol.trim(),
                transaction_type: stock.type == "DOWN" ? "SELL" : "BUY",
                quantity: Number(stock.quantity),
                order_type: stock.type == "DOWN" ? "SL-M" : "LIMIT",
                ...(stock.type == "DOWN" 
                    ? { trigger_price: Number(stock.triggerPrice) }
                    : { price: Number(stock.triggerPrice) }
                ),
                product: "MIS",
                validity: "DAY",
            });
            await sendMessageToChannel('✅ Successfully placed SL-M SELL order', stock.stockSymbol, stock.quantity)
        }

        try {
            await OrderLog.create({
                bear_action: 'PLACED',
                ...orderResponse
            });
        } catch (error) {
            await sendMessageToChannel('❌ Error logging order', error?.message)
            console.error('Error logging order', error)
        }


    } catch (error) {
        await sendMessageToChannel('🚨 Error placing SELL order', stock.stockSymbol, stock.quantity, stock.triggerPrice, error?.message)
        console.error("🚨 Error placing SELL order: ", stock.stockSymbol, stock.quantity, stock.triggerPrice, error?.message);
        await OrderLog.create({
            bear_action: 'FAILED - PLACE',
            tradingsymbol: stock.stockSymbol,
            quantity: stock.quantity,
            trigger_price: stock.triggerPrice,
            error: error?.message,
        });
        throw error
    }
}

module.exports = {
    processSuccessfulOrder,
    createOrders
}
