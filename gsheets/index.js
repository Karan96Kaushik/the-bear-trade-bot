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
    let data = stockData.map(s => ({
        id: s[0], 
        stockSymbol: s[1]?.trim().toUpperCase(), 
        triggerPrice: s[2]?.trim().toLowerCase(), 
        stopLossPrice: s[3]?.trim(),
        targetPrice: s[4]?.trim(), 
        quantity: Number(s[5]?.trim()), 
        lastAction: s[6]?.trim(),
        ignore: s[7]?.trim(),
        reviseSL: s[8]?.trim(),
    })).filter(s => s.stockSymbol)
    return data.map(d => ({
        ...d,
        type: d.quantity < 0 ? 'BEARISH' : 'BULLISH',
        quantity: Math.abs(d.quantity),
    }))
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
    let row = rowHeaders.indexOf(stock) + 1;
    const col = colHeaders.indexOf(column);
    if (row < 1) {
        row = rowHeaders.indexOf(stock.toLowerCase()) + 1;
    }
    if (row < 1) {
        throw new Error('Stock not found in sheet!')
    }
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

async function appendRowsToMISD(stocks) {
    try {
        // Read existing data to determine the last row and ID
        let existingData = await readSheetData('MIS-ALPHA!A2:W1000');
        let lastRow = existingData.length + 2; // +2 because we start from A2
        let lastId = parseInt(existingData[existingData.length - 1]?.[0]?.split('TMD')?.[1]);
        if (isNaN(lastId))
            lastId = 0
        existingData = processMISSheetData(existingData);

        const rowsToAppend = [];

        for (const stock of stocks) {
            const newRowData = [
                stock.stockSymbol,
                stock.triggerPrice,
                stock.stopLossPrice,
                stock.targetPrice,
                stock.quantity,
                stock.lastAction,
                stock.ignore,
                stock.reviseSL
            ];

            const existingStock = existingData.find(d => d.quantity == stock.quantity && d.stockSymbol == stock.stockSymbol);
            if (existingStock && !existingStock.ignore) {
                console.warn(`Stock ${stock.stockSymbol} already exists with the same quantity. Skipping.`);
                continue;
            }

            lastId++;
            const newId = 'TMD' + lastId;
            
            // Prepare the new row data with the generated ID
            rowsToAppend.push([newId.toString(), ...newRowData]);
        }

        if (rowsToAppend.length === 0) {
            console.log('No new rows to append.');
            return;
        }

        // Append the new rows
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `MIS-ALPHA!A${lastRow}`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: rowsToAppend
            }
        });
        
        console.log(`${rowsToAppend.length} new rows appended successfully.`);
        return response.data;
    } catch (error) {
        console.error('Error appending rows to MIS-ALPHA sheet:', error);
        throw error;
    }
}


async function appendRowsToSheet(range, rowsToAppend, spreadsheetId=SPREADSHEET_ID) {
    try {
        // Append the new rows
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: rowsToAppend
            }
        });
        
        console.log(`${rowsToAppend.length} new rows appended successfully.`);
        return response.data;
    } catch (error) {
        console.error('Error appending rows to MIS-ALPHA sheet:', error);
        throw error;
    }
}

module.exports = {
    bulkUpdateCells,
    readSheetData,
    getStockLoc,
    numberToExcelColumn,
    processMISSheetData,
    getOrderLoc,
    appendRowsToMISD,
    appendRowsToSheet
}
