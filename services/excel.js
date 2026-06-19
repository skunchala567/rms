'use strict';

const ExcelJS = require('exceljs');

/**
 * Build an .xlsx workbook buffer from columns + rows.
 * @param {string} sheetName
 * @param {{header:string, key:string, width?:number}[]} columns
 * @param {object[]} rows
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook(sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stay Back Route Management System';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName || 'Sheet1');

  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 20 }));

  // Header styling
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E40AF' },
  };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'left' };

  rows.forEach((r) => ws.addRow(r));

  // Thin borders
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Parse an uploaded Excel/CSV file buffer into an array of row objects.
 * Returns { headers: string[], rows: object[] } keyed by the header row.
 */
async function parseUpload(buffer, originalName) {
  const wb = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(originalName || '');

  if (isCsv) {
    const { Readable } = require('stream');
    const stream = Readable.from(buffer.toString('utf8'));
    await wb.csv.read(stream);
  } else {
    await wb.xlsx.load(buffer);
  }

  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const headers = [];
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, col) => {
    headers[col - 1] = String(cell.value == null ? '' : cell.value).trim();
  });

  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const obj = {};
    let hasValue = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      let v = row.getCell(idx + 1).value;
      if (v && typeof v === 'object' && 'text' in v) v = v.text; // rich text / hyperlink
      if (v && typeof v === 'object' && 'result' in v) v = v.result; // formula
      v = v == null ? '' : String(v).trim();
      if (v !== '') hasValue = true;
      obj[h] = v;
    });
    if (hasValue) rows.push({ __row: rowNumber, ...obj });
  });

  return { headers, rows };
}

module.exports = { buildWorkbook, parseUpload };
