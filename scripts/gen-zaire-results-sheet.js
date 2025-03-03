const { calculateExtremePrice } = require('../kite/scheduledJobs');
const { appendRowsToSheet, readSheetData } = require('../gsheets');
const { getDateStringIND } = require('../kite/utils');
const { scanZaireStocks } = require('../analytics');

/*
    Run this script to generate results for Zaire for defined days and times

*/ 

const sheetID = '17eVGOMlgO8M62PrD8JsPIRcavMmPz-KH7c8QW1edzZE'

async function genZaireReport() {
    try {

        const times = ['04:01', '04:16'];
        // const dates = ['2024-11-12'];
        // const dates = ['2024-11-12', '2024-11-13', '2024-11-14'];
        const dates = ['2024-11-19'];
        const timestamp = getDateStringIND(new Date());

        const results = [];

        results.push(['timestamp', 'sym', 'high', 'low', 'open', 'close', 'sma44', 'direction'])

        for (const date of dates) {
            for (const time of times) {
                try {
                    let niftyList = await readSheetData('HIGHBETA!B2:B150')
                    niftyList = niftyList.map(stock => stock[0]).filter(a => a !== 'NOT FOUND')
                    const timestamp = getDateStringIND(new Date(`${date}T${time}:00Z`))
                    const selectedStocks = await scanZaireStocks(niftyList, new Date(`${date}T${time}:00Z`));
                    console.log(timestamp)
                    results.push(
                        ...selectedStocks.map(a => [timestamp, a.sym, a.high, a.low, a.open, a.close, a.sma44, a.direction])
                    );

                } catch (error) {
                    console.error(`Error processing ${date} ${time}:`, error);
                }
            }
        }
        // Append to Google Sheets
        await appendRowsToSheet('Nov19-01!A1:H1000', results, sheetID);
        console.log('Successfully logged extreme prices for', timestamp);

    } catch (error) {
        console.error('Error in genZaireReport:', error);
    }
}

// Run the function
genZaireReport(); 