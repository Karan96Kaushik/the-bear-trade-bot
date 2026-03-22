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
	'baxter_orders.csv',
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
 * GET /api/files/:filename - Get CSV as JSON with optional pagination, search, and column filter
 * Query:
 *   ?raw=true — full file as text/csv (ignores pagination/search params)
 *   ?page=1&limit=50 — page of rows (default limit 50, max 500)
 *   ?q= — case-insensitive match in any column
 *   ?filterColumn=name&filterValue=x — additional filter on one column (must be a header)
 *   ?reverse=true — after filtering, reverse row order (file bottom first), then paginate
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

		const { headers, rows } = parseCSVContent(content);
		if (headers.length === 0 && rows.length === 0) {
			return res.json(emptyPagedResponse());
		}

		const page = Math.max(1, parsePositiveInt(req.query.page, 1));
		const limit = Math.min(500, Math.max(1, parsePositiveInt(req.query.limit, 50)));
		const q = String(req.query.q || '').trim().toLowerCase();
		const filterColumn = String(req.query.filterColumn || '').trim();
		const filterValue = String(req.query.filterValue || '').trim().toLowerCase();
		const reverse =
			req.query.reverse === 'true' ||
			req.query.reverse === '1';

		let filtered = rows;
		if (filterColumn && headers.includes(filterColumn) && filterValue) {
			filtered = filtered.filter(row =>
				String(row[filterColumn] ?? '').toLowerCase().includes(filterValue)
			);
		}
		if (q) {
			filtered = filtered.filter(row =>
				headers.some(h => String(row[h] ?? '').toLowerCase().includes(q))
			);
		}
		if (reverse) {
			filtered = filtered.slice().reverse();
		}

		const total = filtered.length;
		const totalPages = Math.max(1, Math.ceil(total / limit));
		const safePage = Math.min(page, totalPages);
		const start = (safePage - 1) * limit;
		const pageRows = filtered.slice(start, start + limit);

		res.json({
			headers,
			rows: pageRows,
			total,
			page: safePage,
			limit,
			totalPages,
		});
	} catch (error) {
		console.error('Error reading file:', error);
		res.status(500).json({ message: 'Failed to read file' });
	}
});

function parsePositiveInt(value, fallback) {
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

function emptyPagedResponse() {
	return { headers: [], rows: [], total: 0, page: 1, limit: 50, totalPages: 1 };
}

function parseCSVContent(content) {
	const lines = content.trim().split(/\r?\n/);
	if (lines.length === 0) {
		return { headers: [], rows: [] };
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
	return { headers, rows };
}

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
