/**
 * ═══════════════════════════════════════════════════════════════
 * Google Apps Script Receiver for API Switchboard
 * ═══════════════════════════════════════════════════════════════
 *
 * SETUP INSTRUCTIONS (Web App Mode - Recommended):
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this entire code into the script editor
 * 4. Click Deploy > New Deployment
 * 5. Select type: "Web app"
 * 6. Set "Execute as": Me
 * 7. Set "Who has access": Anyone
 * 8. Click Deploy and copy the Web App URL
 * 9. Paste the URL into API Switchboard's Bulk Transport modal
 *
 * That's it! No GCP project or OAuth credentials needed.
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Web App endpoint - receives POST requests from API Switchboard.
 * This is the primary method used by Bulk Transport.
 *
 * @param {Object} e - The event object from the web app
 * @returns {ContentService.TextOutput} JSON response
 */
function doPost(e) {
  try {
    var jsonString = e.postData.contents;
    var result = receiveData(jsonString);
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, result: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Web App GET endpoint - health check / info.
 * Accepts optional ?sheet=SheetName query param to check a specific sheet.
 */
function doGet(e) {
  var sheetName = (e && e.parameter && e.parameter.sheet) || "API_Data";
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var rowCount = sheet ? sheet.getLastRow() : 0;
  return ContentService
    .createTextOutput(JSON.stringify({
      status: "ok",
      message: "API Switchboard receiver is ready",
      sheet: sheetName,
      rows: rowCount,
      supportsSheetName: true
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Main receiver function called by API Switchboard.
 * Parses incoming JSON data and writes it to a sheet.
 *
 * Supports two payload formats:
 *   1. Envelope: { sheetName: "Custom_Sheet", data: [...] }  → writes to named sheet
 *   2. Raw:      [...] or {...}                               → writes to "API_Data" (default)
 *
 * @param {string} jsonString - Stringified JSON from the API response
 * @returns {string} Status message
 */
function receiveData(jsonString) {
  try {
    var parsed = JSON.parse(jsonString);

    // Detect envelope format: { sheetName: "...", data: ... }
    var sheetName = "API_Data";
    var data = parsed;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && 'data' in parsed && 'sheetName' in parsed) {
      sheetName = String(parsed.sheetName || "API_Data").substring(0, 100);
      data = parsed.data;
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    // Create the sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    // Determine if data is an array of objects or a single object
    if (Array.isArray(data)) {
      return writeArrayData(sheet, data);
    } else if (typeof data === 'object' && data !== null) {
      return writeObjectData(sheet, data);
    } else {
      // Simple value - just append
      sheet.appendRow([new Date(), String(data)]);
      return "Appended simple value";
    }
  } catch (e) {
    return "Error: " + e.message;
  }
}

/**
 * Write an array of objects to the sheet.
 * Auto-creates headers from object keys and appends all rows.
 */
function writeArrayData(sheet, dataArray) {
  if (dataArray.length === 0) return "Empty array - nothing to write";

  // Collect all unique keys across all objects for headers
  var allKeys = [];
  dataArray.forEach(function(item) {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item).forEach(function(key) {
        if (allKeys.indexOf(key) === -1) {
          allKeys.push(key);
        }
      });
    }
  });

  // Add timestamp column
  var headers = ["_timestamp"].concat(allKeys);

  // Check if headers exist, if not write them
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(headers);
    // Bold the header row
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }

  // Write each data row
  var rows = dataArray.map(function(item) {
    var row = [new Date()];
    allKeys.forEach(function(key) {
      var val = item[key];
      if (typeof val === 'object' && val !== null) {
        row.push(JSON.stringify(val));
      } else {
        row.push(val !== undefined ? val : "");
      }
    });
    return row;
  });

  // Batch write for performance
  if (rows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  }

  return "Written " + rows.length + " rows with " + allKeys.length + " columns";
}

/**
 * Write a single object to the sheet.
 * Each key becomes a column, the values become a single row.
 */
function writeObjectData(sheet, dataObj) {
  var keys = Object.keys(dataObj);
  var headers = ["_timestamp"].concat(keys);

  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }

  var row = [new Date()];
  keys.forEach(function(key) {
    var val = dataObj[key];
    if (typeof val === 'object' && val !== null) {
      row.push(JSON.stringify(val));
    } else {
      row.push(val !== undefined ? val : "");
    }
  });

  sheet.appendRow(row);
  return "Written 1 row with " + keys.length + " columns";
}

/**
 * Utility: Clear all data from a sheet (keeps headers).
 * Call this manually or from Switchboard if needed.
 * @param {string} [sheetName="API_Data"] - Name of the sheet to clear
 */
function clearData(sheetName) {
  sheetName = sheetName || "API_Data";
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
    return "Cleared all data rows from " + sheetName;
  }
  return "Nothing to clear";
}

/**
 * Utility: Get the current row count.
 * @param {string} [sheetName="API_Data"] - Name of the sheet to check
 */
function getRowCount(sheetName) {
  sheetName = sheetName || "API_Data";
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return 0;
  return sheet.getLastRow();
}
