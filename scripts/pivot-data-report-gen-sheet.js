const { getDataFromYahoo, processYahooData, getDateStringIND, getMcIndicators } = require("../kite/utils");
const { appendRowsToSheet, readSheetData } = require("../gsheets");
const { addMovingAverage, scanZaireStocks, countMATrendRising, 
    countMATrendFalling, checkMARising, checkMAFalling, checkUpwardTrend, 
    checkDownwardTrend, printTrendEmojis, isBullishCandle,
    addRSI} = require("../analytics");
// const { sendMessageToChannel } = require("./slack-actions");

// const sheetID = '17eVGOMlgO8M62PrD8JsPIRcavMmPz-KH7c8QW1edzZE'
const DEBUG = false

const interval = '15m'
let sheetName = 'Pivot-Data'

// sheetName = '5Dec-15m-Notif'

//let sheetRange = 'SimulationTest!E2:E550'
let sheetRange = 'SimulationTest!H2:H550'

async function getPivotData(startTime, endTime) {
    try {

        let niftyList = await readSheetData(sheetRange)  
        niftyList = niftyList.map(stock => stock[0]).filter(Boolean)

        console.log('---')

        const rows = [
        ];

        for (const stock of niftyList) {
            try {

                const indicators = await getMcIndicators(stock)

                // console.log(indicators.pivotLevels)

                const classic = indicators.pivotLevels.find(p => p.key == 'Classic').pivotLevel
                const fibonacci = indicators.pivotLevels.find(p => p.key == 'Fibonacci').pivotLevel
                const camarilla = indicators.pivotLevels.find(p => p.key == 'Camarilla').pivotLevel

                const data = [
                    stock,
                    getDateStringIND(new Date()).split(' ')[0],
                    classic.pivotPoint,
                    classic.s1,
                    classic.s2,
                    classic.s3,
                    classic.r1,
                    classic.r2,
                    classic.r3,
                    fibonacci.pivotPoint,
                    fibonacci.s1,
                    fibonacci.s2,
                    fibonacci.s3,
                    fibonacci.r1,
                    fibonacci.r2,
                    fibonacci.r3,
                    camarilla.pivotPoint,
                    camarilla.s1,
                    camarilla.s2,
                    camarilla.s3,
                    camarilla.r1,
                    camarilla.r2,
                    camarilla.r3,
                ]

                rows.push(data)

            } catch (error) {
                console.log(`Error processing ${stock}:`, error?.response?.data || error?.message);
                console.trace(error);
            }
        }

        // Update Google Sheet
        await appendRowsToSheet(sheetName + '!A1:Z', rows);
        // await sendMessageToChannel('✅ Successfully updated daily stats sheet');

    } catch (error) {
        console.trace('Error in get:', error?.response?.data || error?.message);
        // await sendMessageToChannel('❌ Error updating daily stats:', error.message);
    }
}

const run = async () => {

    const headers = [
        [
            'Timestamp',
            'Sym',
            'Classic Pivot Point',
            'Classic S1',
            'Classic S2',
            'Classic S3',
            'Classic R1',
            'Classic R2',
            'Classic R3',
            'Fibonacci Pivot Point',
            'Fibonacci S1',
            'Fibonacci S2',
            'Fibonacci S3',
            'Fibonacci R1',
            'Fibonacci R2',
            'Fibonacci R3',
            'Camarilla Pivot Point',
            'Camarilla S1',
            'Camarilla S2',
            'Camarilla S3',
            'Camarilla R1',
            'Camarilla R2',
            'Camarilla R3'
        ]
    ]

    await appendRowsToSheet(sheetName + '!A1:Z', headers);

    getPivotData()
}

if (require.main === module) {
    run()
}

module.exports = {
    getPivotData
}