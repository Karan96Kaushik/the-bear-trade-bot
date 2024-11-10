const { searchUpstoxStocks } = require('../kite/utils')
const { readSheetData } = require('../gsheets')

const run = async () => {

    let stockData = await readSheetData('HIGHBETA!A2:A150')
    let stockList = stockData.map(a => a[0])

    for (const stock of stockList) {
        // console.log(stock)
        const data = await searchUpstoxStocks(stock)
        if (data.length > 1) {
            console.log(data.map(a => a.tradingSymbol).join(', '))
        }
        else if (data.length == 1) {
            console.log(data[0].tradingSymbol)
        }
        else {
            console.log('NOT FOUND')
        }
        // return
    }
}

run()
// await searchUpstoxStocks(query)