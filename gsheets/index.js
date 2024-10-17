const { google } = require('googleapis');
const path = require('path');

// Path to your service account key file
const SERVICE_ACCOUNT_FILE = path.join(__dirname, '../top-glass-226920-ff9fb14e6f4f.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
const SPREADSHEET_ID = '14FUaVzQfXqeGTd2HEKXMBwtofQNOebqiSdCK02GAYkA';
const READ_RANGE = 'Sheet1!A1:D50';
const READ_RANGE_TARGET = 'REPLICA!L1:W200';

// Create a JWT client using the service account credentials
const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_FILE,
    scopes: SCOPES,
});

// Create the sheets API client
const sheets = google.sheets({ version: 'v4', auth });

// Function to read sheet data
async function readSheetData(range=READ_RANGE) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range,
        });
        const rows = response.data.values || [];
        return rows; // Return the data
    } catch (error) {
        console.error('Error reading sheet data:', error);
        throw error;
    }
}

function processMISSheetData (stockData) {
    return stockData.map(s => ({
        id: s[0], 
        stockSymbol: s[1], 
        sellPrice: s[2], 
        stopLossPrice: s[3],
        targetPrice: s[4], 
        quantity: s[5], 
        lastAction: s[6],
        ignore: s[7],
        reviseSL: s[8],
    })).filter(s => s.stockSymbol)
}

async function bulkUpdateCells(updates) {
    const body = {
        valueInputOption: 'RAW',
        data: updates,
    };

    try {
        const result = await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: body,
        });
        return result.data;
    } catch (error) {
        console.error('Error updating cells:', error);
        throw error;
    }
}

function getStockLoc(stock, column, rowHeaders, colHeaders) {
    const row = rowHeaders.indexOf(stock) + 1;
    const col = colHeaders.indexOf(column);
    if (row < 1)
        throw new Error('Stock not found in sheet!')
    // const colPrice = col;
    // const colVol = col + 1; // Next column for volume
    return [row, col];
}

function getOrderLoc(id, column, rowHeaders, colHeaders) {
    const row = rowHeaders.indexOf(id);
    const col = colHeaders.indexOf(column);
    // const colPrice = col;
    // const colVol = col + 1; // Next column for volume
    return [row, col];
}

function numberToExcelColumn(n) {
    let column = "";
    n += 1; // Adjust for zero-based index
    while (n > 0) {
        n -= 1;
        column = String.fromCharCode((n % 26) + 65) + column; // A=65, B=66, ...
        n = Math.floor(n / 26);
    }
    return column;
}

async function appendRowToMISD(stock) {
    try {
        const newRowData = [
            stock.stockSymbol,
            stock.sellPrice,
            stock.stopLossPrice,
            stock.targetPrice,
            stock.quantity,
            stock.lastAction,
            stock.ignore,
            stock.reviseSL
        ]
        // Read existing data to determine the last row and ID
        let existingData = await readSheetData('MIS-D!A2:W');
        const lastRow = existingData.length + 2; // +2 because we start from A2
        const lastRowData = existingData[existingData.length - 1]
        existingData = processMISSheetData(existingData)
        const newId = 'TMD' + (parseInt(lastRowData[0].split('TMD')[1]) + 1);

        const existingStock = existingData.find(d => d.quantity == stock.quantity && d.stockSymbol == stock.stockSymbol)
        if (existingStock)
            throw new Error('Stock already exists with the same quantity!')
        
        // Prepare the new row data with the generated ID
        const rowToAppend = [newId.toString(), ...newRowData];
        
        // Append the new row
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `MIS-D!A${lastRow}`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [rowToAppend]
            }
        });
        
        console.log(`New row appended successfully. ID: ${newId}`);
        return response.data;
    } catch (error) {
        console.error('Error appending row to MIS-D sheet:', error);
        throw error;
    }
}

if (false)
readSheetData()
    .then(async data => {
        console.log('Sheet Data:', data);

        const rowHeaders = data.map(a => a[0])
        const colHeaders = data[0]

        const b = getStockLoc('DCXINDIA', '19 Sep 24', rowHeaders, colHeaders)
        let col1 = numberToExcelColumn(b.colPrice)
        let col2 = numberToExcelColumn(b.colVol)
        let c1 = String(col1) + String(b.row)
        let c2 = String(col2) + String(b.row)
        console.log(b, col1 + b.row, col2 + b.row, 'Test!' + c1, 'Test!' + c2)

        const updates = [
            {
                range: 'Test!' + c1, 
                values: [['Price']], 
            },
            {
                range: 'Test!' + c2, 
                values: [['Volume']], 
            },
        ];

        bulkUpdateCells(updates)
            .then(result => {
                console.log('Update Result:', result);
            })
            .catch(err => {
                console.error('Failed to update cells:', err);
            });
    })
    .catch(err => {
        console.error('Failed to read data:', err);
    });


module.exports = {
    bulkUpdateCells,
    readSheetData,
    getStockLoc,
    numberToExcelColumn,
    processMISSheetData,
    getOrderLoc,
    appendRowToMISD
}
