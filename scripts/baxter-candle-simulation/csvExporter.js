const fs = require('fs');
const path = require('path');

function escapeCsvCell(value) {
	if (value === null || value === undefined) return '';
	const s = String(value);
	if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * @param {string} csvPath
 * @param {string[]} fields - column order
 * @param {Record<string, unknown>} row - flat object; keys should match fields
 */
function appendRow(csvPath, fields, row) {
	ensureDir(csvPath);
	const line = fields.map((f) => escapeCsvCell(row[f])).join(',') + '\n';
	const needsHeader = !fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0;
	if (needsHeader) {
		fs.appendFileSync(csvPath, fields.map(escapeCsvCell).join(',') + '\n', 'utf8');
	}
	fs.appendFileSync(csvPath, line, 'utf8');
}

/**
 * Pick only configured fields; missing keys become empty string.
 * @param {Record<string, unknown>} obj
 * @param {string[]} fields
 */
function pickFields(obj, fields) {
	const out = {};
	for (const f of fields) {
		out[f] = obj[f] !== undefined && obj[f] !== null ? obj[f] : '';
	}
	return out;
}

module.exports = {
	escapeCsvCell,
	appendRow,
	pickFields,
	ensureDir
};
