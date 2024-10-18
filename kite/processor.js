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
        quantity: Number(stock.quantity.trim()),
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
        quantity: Number(stock.quantity.trim()),
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

            // Log the order update
            await OrderLog.create({
                orderId: order.order_id,
                action: 'UPDATED',
                orderDetails: order
            });

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
                let stockData = await readSheetData('MIS-D!A1:W100')
                const rowHeaders = stockData.map(a => a[1])
                const colHeaders = stockData[0]
                const [row, col] = getStockLoc(order.tradingsymbol, 'Last Action', rowHeaders, colHeaders)
    
                const updates = [
                    {
                        range: 'MIS-D!' + numberToExcelColumn(col) + String(row), 
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
                    let stockData = await readSheetData('MIS-D!A2:W100')
                    stockData = processMISSheetData(stockData)

                    stock = stockData.find(s => s.stockSymbol == order.tradingsymbol)

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
                    
                    // Log the order cancellation
                    await OrderLog.create({
                        orderId: orders[0].order_id,
                        action: 'CANCELLED',
                        orderDetails: orders[0]
                    });

                    await sendMessageToChannel('📁 Closed order', order.tradingsymbol, order.order_type)
                }
            }
        }
        
    } catch (error) {
        console.error('Error processing message', error)
        await sendMessageToChannel('📛 Error processing order update', error.message)
    }
}

const createSellOrders = async (stock) => {
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

        if (Number(stock.sellPrice) > ltp) {
            await sendMessageToChannel('🔔 Cannot place target sell order: LTP lower than Sell Price.', stock.stockSymbol, stock.quantity, "Sell Price:", stock.sellPrice, 'LTP: ', ltp)
            return
        }

        let orderResponse;
        if (stock.sellPrice?.trim() == 'MKT') {
            orderResponse = await kiteSession.kc.placeOrder("regular", {
                exchange: "NSE",
                tradingsymbol: stock.stockSymbol.trim(),
                transaction_type: "SELL",
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
                transaction_type: "SELL",
                quantity: Number(stock.quantity),
                order_type: "SL-M",
                trigger_price: Number(stock.sellPrice),
                product: "MIS",
                validity: "DAY",
            });
            await sendMessageToChannel('✅ Successfully placed SL-M SELL order', stock.stockSymbol, stock.quantity)
        }

        // Log the order placement
        await OrderLog.create({
            orderId: orderResponse.order_id,
            action: 'PLACED',
            orderDetails: {
                ...stock,
                order_id: orderResponse.order_id,
                ltp: ltp
            }
        });

    } catch (error) {
        await sendMessageToChannel('🚨 Error placing SELL order', stock.stockSymbol, stock.quantity, stock.sellPrice, error?.message)
        console.error("🚨 Error placing SELL order: ", stock.stockSymbol, stock.quantity, stock.sellPrice, error?.message);
        throw error
    }
}

module.exports = {
    processSuccessfulOrder,
    createSellOrders
}
