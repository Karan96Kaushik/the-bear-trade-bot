const { getStockLoc, readSheetData, numberToExcelColumn, bulkUpdateCells, getOrderLoc } = require("../gsheets")
const { sendMessageToChannel } = require("../slack-actions")
const { kiteSession } = require("./setup")

const createBuyLimSLOrders = async (stock) => {
    await kiteSession.authenticate()

    await kiteSession.kc.getInstruments('NSE')

    await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol.trim(),
        transaction_type: "BUY",
        quantity: Number(stock.quantity.trim()),
        order_type: "SL-M",    // Stop Loss Market
        product: "MIS",        // Intraday
        validity: "DAY",
        trigger_price: Number(stock.stopLossPrice.trim()),  // Stop-loss trigger price
        guid: 'x' + stock.id + 'xSL',
    });
    sendMessageToChannel('✅ Successfully placed SL-M buy order', stock.stockSymbol, stock.quantity)


    await kiteSession.kc.placeOrder("regular", {
        exchange: "NSE",
        tradingsymbol: stock.stockSymbol,
        transaction_type: "BUY",
        quantity: Number(stock.quantity.trim()),
        order_type: "LIMIT",    // Stop Loss Market
        product: "MIS",        // Intraday
        validity: "DAY",
        price: Number(stock.targetPrice.trim()),  // Stop-loss trigger price
        guid: 'x' + stock.id + 'xLIM',
        // price: stock.targetPrice  // Stop-loss trigger price
    });
    sendMessageToChannel('✅ Successfully placed LIMIT buy order', stock.stockSymbol, stock.quantity)

}

const processSuccessfulOrder = async (order) => {
    try {
        if (order.product == 'MIS' && order.status == 'COMPLETE') {

            sendMessageToChannel('📬 Order update', 
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
                sendMessageToChannel('🛑 Error updating sheet!', error.message)
            }


            if (order.transaction_type == 'SELL') {
                let stock = {}
                try {
                    let stockData = await readSheetData('MIS-D!A2:W100')
                    stockData = processMISSheetData(stockData)

                    stock = stockData.find(s => s.stockSymbol == order.tradingsymbol)

                    if (stock.lastAction.includes('SELL')) {
                        await createBuyLimSLOrders(stock)
                    }
                } catch (error) {
                    sendMessageToChannel('💥 Error buy orders', stock.stockSymbol, stock.quantity, error?.message)
                    console.error("💥 Error buy orders: ", stock.stockSymbol, stock.quantity, error?.message);
                }
            }
            else if (order.transaction_type == 'BUY') {
                // Closing opposite end order
                let orders = await kiteSession.kc.getOrders()
                orders = orders.find(o => o.tradingsymbol == order.tradingsymbol && o.status == 'OPEN' && o.transaction_type == 'BUY')

                /* TODO
                    use order guid to find the order to cancel
                 */

                if (orders.length > 1)
                    sendMessageToChannel('😱 Multiple pending buy orders found!!')
                else if (orders.length == 1)
                    sendMessageToChannel('😱 Pending order not found!!')
                else {
                    await kiteSession.kc.cancelOrder('regular', orders[0].order_id)
                    sendMessageToChannel('📁 Closed order', order.tradingsymbol, order.order_type)
                }
            }
        }
        
    } catch (error) {
        console.error('Error processing message', error)
    }
}

module.exports = {
    processSuccessfulOrder
}