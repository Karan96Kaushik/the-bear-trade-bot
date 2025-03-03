const axios = require('axios');
const fs = require('fs');

let defaultFilePath = 'nifty-list.csv'

function appendArrayToCSV(data, filePath=defaultFilePath) {
    const csvContent = data.map(row => row.join(',')).join('\n') + '\n';

    fs.appendFile(filePath, csvContent, 'utf8', (err) => {
        if (err) {
            console.error('Error appending to CSV file:', err);
        } else {
            console.log('Data successfully appended to CSV file.');
        }
    });
}

async function fetchStocks() {
    const url = 'https://ow-scanx-analytics.dhan.co/customscan/fetchdt';
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'content-type': 'application/json; charset=UTF-8',
        'Origin': 'https://dhan.co',
        'Referer': 'https://dhan.co/'
    };

    let pageNum = 1;
    let hasMoreData = true;

    while (hasMoreData) {
        const payload = {
            data: {
                sort: "Mcap",
                sorder: "desc",
                count: 20,
                params: [
                    { field: "OgInst", op: "", val: "ES" },
                    { field: "Exch", op: "", val: "NSE" }
                ],
                fields: ["Isin", "DispSym", "Mcap", "Pe", "DivYeild", "Revenue", "Year1RevenueGrowth", 
                        "NetProfitMargin", "YoYLastQtrlyProfitGrowth", "EBIDTAMargin", "volume", 
                        "PricePerchng1year", "PricePerchng3year", "PricePerchng5year", "Ind_Pe", 
                        "Pb", "DivYeild", "Eps", "DaySMA50CurrentCandle", "DaySMA200CurrentCandle", 
                        "DayRSI14CurrentCandle", "ROCE", "Roe", "Sym", "PricePerchng1mon", "PricePerchng3mon"],
                pgno: pageNum
            }
        };

        const rows = []

        try {
            const response = await axios.post(url, payload, { headers });
            const stocks = response.data.data;

            if (stocks && stocks.length > 0) {
                // Log stock names from current page
                stocks.forEach(stock => {
                    rows.push([stock.Sym])
                });
                pageNum++;
            } else {
                hasMoreData = false;
            }
        } catch (error) {
            console.error('Error fetching stocks:', error.message);
            hasMoreData = false;
        }
        
        appendArrayToCSV(rows)
    }
    
}

// Run the function
fetchStocks();