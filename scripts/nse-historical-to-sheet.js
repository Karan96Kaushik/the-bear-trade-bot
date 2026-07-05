/**
 * Fetches 1 year of NSE security-wise historical prices (CSV) for a given scrip
 * and writes the data to a new sheet in the "Risk analyses" Google Spreadsheet.
 *
 * Usage:
 *   node scripts/nse-historical-to-sheet.js <SCRIP_SYMBOL> [SPREADSHEET_ID]
 *
 * Defaults:
 *   Spreadsheet ID defaults to the "Risk analyses" sheet if not passed.
 *
 * Environment variables (override default):
 *   RISK_ANALYSIS_SHEET_ID  - Spreadsheet ID of the "Risk analyses" sheet
 *
 * Example:
 *   node scripts/nse-historical-to-sheet.js TCS
 */

'use strict';

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { addSheet, updateSheetData } = require('../gsheets');

// ─── Configuration ────────────────────────────────────────────────────────────

// const DEFAULT_SPREADSHEET_ID = '1UQP4K5olCt8qfYpdNFGoJu3T0E357fH324kucK2IsNo';
const DEFAULT_SPREADSHEET_ID = '1sqs5gEtNU6yeNVRs0WLwN0XNCAwXI1PXwkWMI9tccRE'

const NSE_BASE_URL = 'https://www.nseindia.com';
const NSE_API_URL  = `${NSE_BASE_URL}/api/historicalOR/generateSecurityWiseHistoricalData`;

const NSE_HEADERS = {
    'User-Agent'              : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:151.0) Gecko/20100101 Firefox/151.0',
    'Accept'                  : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language'         : 'en-US,en;q=0.9',
    'Accept-Encoding'         : 'gzip, deflate, br, zstd',
    'Referer'                 : 'https://www.nseindia.com/report-detail/eq_security',
    'Connection'              : 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest'          : 'document',
    'Sec-Fetch-Mode'          : 'navigate',
    'Sec-Fetch-Site'          : 'same-origin',
    'Sec-Fetch-User'          : '?1',
    'Priority'                : 'u=0, i',
    'TE'                      : 'trailers',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[${new Date().toISOString()}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toISOString()}] ⚠  ${msg}`); }
function err(msg)  { console.error(`[${new Date().toISOString()}] ✖  ${msg}`); }

/** Format Date → DD-MM-YYYY (NSE API requirement) */
function toNseDateStr(date) {
    const dd   = String(date.getDate()).padStart(2, '0');
    const mm   = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

/** Sleep for ms milliseconds */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a single CSV line respecting quoted fields (handles commas inside quotes).
 */
function parseCsvLine(line) {
    const row = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            row.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    row.push(cur.trim());
    return row;
}

/**
 * Parse NSE CSV response into a 2D array (header row + data rows).
 * Trims whitespace from header names; preserves cell values as returned by NSE.
 */
function parseNseCsv(csvText) {
    log('Parsing NSE CSV response...');

    const trimmed = csvText.trim();
    if (!trimmed) {
        throw new Error('Empty CSV response from NSE');
    }

    if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<!doctype html')) {
        throw new Error(`NSE returned HTML instead of CSV. Preview: ${trimmed.slice(0, 300)}`);
    }

    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    log(`CSV contains ${lines.length} lines (including header)`);

    const rows = lines.map((line, idx) => {
        const parsed = parseCsvLine(line);
        if (idx === 0) {
            log(`CSV headers (${parsed.length} columns): ${parsed.map(h => h.trim()).join(' | ')}`);
        }
        return parsed.map(cell => cell.trim());
    });

    if (rows.length < 2) {
        throw new Error('CSV has no data rows (only header or empty)');
    }

    log(`Parsed ${rows.length - 1} data rows from CSV`);
    log(`First data row : ${rows[1].join(' | ')}`);
    log(`Last data row  : ${rows[rows.length - 1].join(' | ')}`);

    return rows;
}

// ─── NSE Data Fetching ───────────────────────────────────────────────────────

/**
 * Initialise a cookie-aware axios client and prime cookies by visiting the
 * NSE home page and the eq_security page (mimics browser behaviour).
 */
async function buildNseClient() {
    log('Building NSE HTTP client with cookie jar support...');
    const jar    = new CookieJar();
    const client = wrapper(axios.create({ jar, headers: NSE_HEADERS, timeout: 60000 }));

    log(`Visiting NSE homepage (${NSE_BASE_URL}) to initialise session cookies...`);
    try {
        await client.get(NSE_BASE_URL);
        log('Homepage visited successfully. Waiting 1 s before next request...');
    } catch (e) {
        warn(`Homepage visit failed (${e.message}). Continuing anyway – cookies may be incomplete.`);
    }
    await sleep(1000);

    log('Visiting eq_security page to pick up page-specific cookies...');
    try {
        await client.get(`${NSE_BASE_URL}/report-detail/eq_security`);
        log('eq_security page visited. Waiting 1 s before API call...');
    } catch (e) {
        warn(`eq_security visit failed (${e.message}). Continuing anyway.`);
    }
    await sleep(1000);

    return client;
}

/**
 * Fetches security-wise historical price/volume CSV from NSE for the last 1 year.
 *
 * Endpoint: /api/historicalOR/generateSecurityWiseHistoricalData
 * Type    : priceVolume
 * Series  : ALL
 * Format  : csv=true
 *
 * @param {string} symbol  NSE ticker e.g. "TCS"
 * @returns {Array<Array<string>>} 2D array — row 0 = headers, rest = data
 */
async function fetchNseHistoricalCsv(symbol) {
    log(`─────────────────────────────────────────────────────────`);
    log(`Starting NSE security-wise historical CSV fetch for: ${symbol}`);
    log(`Endpoint type : priceVolume  |  series : ALL  |  format : csv`);

    const client = await buildNseClient();

    const today      = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const fromDate = toNseDateStr(oneYearAgo);
    const toDate   = toNseDateStr(today);

    log(`Date range: ${fromDate}  →  ${toDate}`);

    const params = {
        from  : fromDate,
        to    : toDate,
        symbol,
        type  : 'priceVolume',
        series: 'ALL',
        csv   : 'true',
    };

    log(`API endpoint : ${NSE_API_URL}`);
    log(`Query params : ${JSON.stringify(params)}`);

    let response;
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            log(`HTTP GET attempt ${attempt}/${MAX_RETRIES} (expecting CSV)...`);
            response = await client.get(NSE_API_URL, {
                params,
                responseType: 'text',
                transformResponse: [(data) => data],
            });
            log(`Response received — HTTP ${response.status} ${response.statusText}`);
            log(`Content-Type : ${response.headers['content-type'] || 'unknown'}`);
            log(`Response size: ${response.data?.length ?? 0} bytes`);
            break;
        } catch (e) {
            const status = e.response?.status;
            err(`Attempt ${attempt} failed: ${e.message}${status ? ` (HTTP ${status})` : ''}`);
            if (attempt < MAX_RETRIES) {
                const delay = attempt * 3000;
                warn(`Retrying in ${delay / 1000} s...`);
                await sleep(delay);
                if (attempt === 1) {
                    log('Re-priming cookies before retry...');
                    try { await client.get(NSE_BASE_URL); } catch (_) {}
                    await sleep(1000);
                    try { await client.get(`${NSE_BASE_URL}/report-detail/eq_security`); } catch (_) {}
                    await sleep(1000);
                }
            } else {
                throw new Error(`NSE API request failed after ${MAX_RETRIES} attempts: ${e.message}`);
            }
        }
    }

    const sheetRows = parseNseCsv(response.data);
    log(`─────────────────────────────────────────────────────────`);
    return sheetRows;
}

// ─── Google Sheets ────────────────────────────────────────────────────────────

/**
 * Ensures a sheet named `sheetName` exists in the given spreadsheet,
 * then writes all rows starting at A1.
 */
async function writeToRiskAnalysisSheet(spreadsheetId, sheetName, rows) {
    log(`─────────────────────────────────────────────────────────`);
    log(`Target spreadsheet ID : ${spreadsheetId}`);
    log(`Target sheet (tab)    : ${sheetName}`);
    log(`Rows to write         : ${rows.length} (including header)`);

    log(`Step 1/2 — Ensuring sheet tab "${sheetName}" exists...`);
    await addSheet(spreadsheetId, sheetName);

    const range = `${sheetName}!A1`;
    log(`Step 2/2 — Writing data to range "${range}"...`);
    const result = await updateSheetData(spreadsheetId, range, rows);

    log(`Write complete. Updated ${result.updatedCells} cells in range ${result.updatedRange}.`);
    log(`─────────────────────────────────────────────────────────`);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Fetch NSE historical CSV and write to Risk analyses spreadsheet.
 * @param {string} symbol
 * @param {string} [spreadsheetId]
 * @returns {Promise<object>} summary of the operation
 */
async function runNseHistoricalToSheet(symbol, spreadsheetId) {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const targetSpreadsheetId = spreadsheetId?.trim() || process.env.RISK_ANALYSIS_SHEET_ID || DEFAULT_SPREADSHEET_ID;

    if (!normalizedSymbol) {
        throw new Error('Symbol is required');
    }

    log('═════════════════════════════════════════════════════════');
    log(`NSE Historical CSV → Google Sheets`);
    log(`Symbol        : ${normalizedSymbol}`);
    log(`Spreadsheet ID: ${targetSpreadsheetId}`);
    log(`Sheet tab     : ${normalizedSymbol}`);
    log('═════════════════════════════════════════════════════════');

    const sheetRows = await fetchNseHistoricalCsv(normalizedSymbol);
    const dataRowCount = sheetRows.length - 1;
    const headers = sheetRows[0];
    const dateColIdx = headers.findIndex(h => h.toLowerCase().includes('date'));
    const firstDate = dateColIdx >= 0 ? sheetRows[1][dateColIdx] : sheetRows[1][2];
    const lastDate  = dateColIdx >= 0 ? sheetRows[sheetRows.length - 1][dateColIdx] : sheetRows[sheetRows.length - 1][2];

    await writeToRiskAnalysisSheet(targetSpreadsheetId, normalizedSymbol, sheetRows);

    const summary = {
        symbol: normalizedSymbol,
        spreadsheetId: targetSpreadsheetId,
        sheetTab: normalizedSymbol,
        rowCount: dataRowCount,
        firstDate,
        lastDate,
        columns: headers,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`,
    };

    log('');
    log('✔  Done! Summary:');
    log(`   Symbol          : ${summary.symbol}`);
    log(`   Rows (excl. hdr): ${summary.rowCount}`);
    log(`   Date range      : ${summary.firstDate}  →  ${summary.lastDate}`);
    log(`   Columns         : ${summary.columns.join(', ')}`);
    log(`   Spreadsheet tab : ${summary.sheetTab}`);
    log(`   Spreadsheet URL : ${summary.spreadsheetUrl}`);
    log('═════════════════════════════════════════════════════════');

    return summary;
}

async function run() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        err('Usage: node scripts/nse-historical-to-sheet.js <SCRIP_SYMBOL> [SPREADSHEET_ID]');
        err('  SCRIP_SYMBOL  - NSE ticker symbol, e.g. TCS');
        err('  SPREADSHEET_ID - optional; defaults to Risk analyses sheet');
        err('                   (override via env var RISK_ANALYSIS_SHEET_ID)');
        process.exit(1);
    }

    const symbol        = args[0].trim().toUpperCase();
    const spreadsheetId = args[1]?.trim() || process.env.RISK_ANALYSIS_SHEET_ID || DEFAULT_SPREADSHEET_ID;

    try {
        await runNseHistoricalToSheet(symbol, spreadsheetId);
    } catch (e) {
        err(`Fatal error: ${e.message}`);
        console.error(e);
        process.exit(1);
    }
}

if (require.main === module) {
    run();
}

module.exports = {
    runNseHistoricalToSheet,
    fetchNseHistoricalCsv,
    writeToRiskAnalysisSheet,
    DEFAULT_SPREADSHEET_ID,
};
