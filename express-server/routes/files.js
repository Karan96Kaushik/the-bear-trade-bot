const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');

// Hardcoded allowlist of filenames that can be listed and served
const ALLOWED_FILES = [
	'baxter_debug.csv',
	'slack-messages.csv',
	'baxter_trades.csv',
	'baxter_orders_debug.csv',
	'sample_export.csv',
];

/**
 * GET /api/files - List available CSV files
 */
router.get('/', (req, res) => {
	try {
		const files = ALLOWED_FILES.filter(name => {
			const filepath = path.join(LOGS_DIR, name);
			return fs.existsSync(filepath);
		});
		res.json({ files });
	} catch (error) {
		console.error('Error listing files:', error);
		res.status(500).json({ message: 'Failed to list files' });
	}
});

/**
 * POST /api/files/:filename/empty - Truncate the file (empty its contents)
 */
router.post('/:filename/empty', (req, res) => {
	try {
		const { filename } = req.params;

		if (!ALLOWED_FILES.includes(filename)) {
			return res.status(404).json({ message: 'File not found' });
		}

		const filepath = path.join(LOGS_DIR, filename);
		if (!fs.existsSync(filepath)) {
			return res.status(404).json({ message: 'File not found' });
		}

		fs.writeFileSync(filepath, '', 'utf8');
		res.json({ success: true, message: 'File emptied' });
	} catch (error) {
		console.error('Error emptying file:', error);
		res.status(500).json({ message: 'Failed to empty file' });
	}
});

/**
 * GET /api/files/:filename - Get CSV file content as JSON (parsed rows) or raw text
 * Query: ?raw=true for raw CSV string
 */
router.get('/:filename', (req, res) => {
	try {
		const { filename } = req.params;
		const raw = req.query.raw === 'true' || req.query.raw === '1';

		if (!ALLOWED_FILES.includes(filename)) {
			return res.status(404).json({ message: 'File not found' });
		}

		const filepath = path.join(LOGS_DIR, filename);
		if (!fs.existsSync(filepath)) {
			return res.status(404).json({ message: 'File not found' });
		}

		const content = fs.readFileSync(filepath, 'utf8');

		if (raw) {
			res.type('text/csv').send(content);
			return;
		}

		// Parse CSV to array of objects for the frontend
		const lines = content.trim().split(/\r?\n/);
		if (lines.length === 0) {
			return res.json({ headers: [], rows: [] });
		}

		const headers = parseCSVLine(lines[0]);
		const rows = lines.slice(1).map(line => {
			const values = parseCSVLine(line);
			const row = {};
			headers.forEach((h, i) => {
				row[h] = values[i] !== undefined ? values[i] : '';
			});
			return row;
		});

		res.json({ headers, rows });
	} catch (error) {
		console.error('Error reading file:', error);
		res.status(500).json({ message: 'Failed to read file' });
	}
});

function parseCSVLine(line) {
	const result = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (c === ',' && !inQuotes) {
			result.push(current.trim());
			current = '';
		} else {
			current += c;
		}
	}
	result.push(current.trim());
	return result;
}

module.exports = router;
