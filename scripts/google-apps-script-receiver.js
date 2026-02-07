/**
 * ═══════════════════════════════════════════════════════════════
 * Google Apps Script Receiver for API Switchboard
 * ═══════════════════════════════════════════════════════════════
 *
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this entire code into the script editor
 * 4. Save and deploy as API executable (not web app)
 * 5. Copy the Script ID from Project Settings
 * 6. Enter the Script ID in API Switchboard settings
 *
 * REQUIRED:
 * - Enable "Apps Script API" in your GCP project
 * - The Google account used in Switchboard must have edit access to the Sheet
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Main receiver function called by API Switchboard.
 * Parses incoming JSON data and writes it to the active sheet.
 *
 * @param {string} jsonString - Stringified JSON from the API response
 * @returns {string} Status message
 */
function receiveData(jsonString) {
  try {
    var data = JSON.parse(jsonString);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("API_Data");

    // Create the sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet("API_Data");
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
 * Utility: Clear all data from the API_Data sheet (keeps headers).
 * Call this manually or from Switchboard if needed.
 */
function clearData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("API_Data");
  if (sheet && sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
    return "Cleared all data rows";
  }
  return "Nothing to clear";
}

/**
 * Utility: Get the current row count.
 */
function getRowCount() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("API_Data");
  if (!sheet) return 0;
  return sheet.getLastRow();
}
