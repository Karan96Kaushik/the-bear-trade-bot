const { calculateExtremePrice } = require('../kite/scheduledJobs');
const { appendRowsToSheet, readSheetData } = require('../gsheets');
const { getDateStringIND } = require('../kite/utils');
const { scanZaireStocks, addMovingAverage } = require('../analytics');
const OrderLog = require('../models/OrderLog');
const { connectToDatabase } = require('../modules/db');
const { getDataFromYahoo, processYahooData } = require('../kite/utils');

const SPREADSHEET_ID = '17eVGOMlgO8M62PrD8JsPIRcavMmPz-KH7c8QW1edzZE'
/*
    Run this script to generate results for Zaire for defined days and times

*/ 

async function generateMIS() {
    try {

        console.log("Connecting to database...")
        await connectToDatabase();

        // const times = ['04:15'];
        const times = ['04:01', '04:16'];
        // const dates = ['2024-11-12'];
        // const dates = ['2024-11-12', '2024-11-13', '2024-11-14'];
        const dates = ['2024-11-19'];

        const timestamp = getDateStringIND(new Date());

        let results = [];

        const allOrders = await OrderLog.find({
            // bear_status: 'COMPLETED',
            timestamp: {
                $gte: new Date('2024-11-18'), // Replace with your desired date
                $lt: new Date('2024-11-19')   // This gets orders for the entire day of March 20th
            }
        })
        .sort({ timestamp: 1 });

        allOrders.sort((a, b) => a.tradingsymbol.localeCompare(b.tradingsymbol));

        const completedOrders = allOrders.filter(a => a.bear_status === 'COMPLETED');

        // for (const order of completedOrders) {
        //     const placeOrder = allOrders.find(o => o.order_id === order.order_id && o.bear_status.includes('PLACE'));
        //     if (!placeOrder) {
        //         console.log(order.tradingsymbol)
        //         console.log(allOrders.filter(o => o.tradingsymbol === order.tradingsymbol).map(o => [o.bear_status, o.order_id, order.order_id]))
        //         console.log(allOrders.filter(o => o.order_id === order.order_id).map(o => [o.timestamp, o.bear_status]))
        //     }
        // }
        // return

        results.push(...completedOrders.map(a => [
            allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('PLACE'))?.timestamp || a.timestamp,
            (allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('PLACE'))?.timestamp && getDateStringIND(allOrders.find(o => o.order_id === a.order_id && o.bear_status.includes('PLACE'))?.timestamp)) || getDateStringIND(a.timestamp), 
            a.tradingsymbol, 
            a.quantity, 
            a.price || a.average_price, 
            a.order_type, 
            a.transaction_type,
            !a.tag ? '?' : a.tag?.includes('zaire') ? 'zaire' : 'sheet',
            (a.tag?.includes('trigger') && (a.transaction_type === 'SELL' ? 'BEARISH' : 'BULLISH')) || ''
        ]))
        results = await Promise.all(results.map(async a => {
            const sym = a[2]
            const timestamp = new Date(a.shift())
            const timestamp2 = new Date(timestamp)
            if (a[6] === 'zaire') {
                let df = await getDataFromYahoo(sym, 5, '15m', timestamp.setDate(timestamp.getDate() - 5), timestamp2);
                df = processYahooData(df);
                df = addMovingAverage(df, 'close', 44, 'sma44');
                return [
                    ...a, 
                    df[df.length - 2].high, 
                    df[df.length - 2].low,
                    df[df.length - 2].open,
                    df[df.length - 2].close,
                    df[df.length - 2].volume,
                    df[df.length - 2].sma44
                ]
            }
            return a
        }))
        // console.table(results)
        results.unshift(['Timestamp', 'Trading Symbol', 'Quantity', 'Price', 'Order Type', 'Transaction Type', 'Source', 'Direction', 'High', 'Low', 'Open', 'Close', 'Volume', 'SMA44'])
        
        await appendRowsToSheet('Nov18!A1:M1000', results, SPREADSHEET_ID);
        console.log('Successfully logged extreme prices for', timestamp);

    } catch (error) {
        console.error('Error in generateMIS:', error);
    }
}

// Run the function
generateMIS(); 