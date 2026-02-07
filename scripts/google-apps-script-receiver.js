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
 * Web App GET endpoint - health check, info, and ID reading.
 *
 * Modes:
 *   Default (no action):  Health check / sheet info
 *   ?action=getIds:       Read IDs from a sheet column (paginated)
 *     &sheet=SheetName    Which sheet to read from
 *     &column=id          Which column header contains the IDs
 *     &start=0            Start index (0-based, for pagination)
 *     &limit=500          Max IDs to return per request
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "health";

  if (action === "getIds") {
    return handleGetIds(e);
  }

  // Default: health check
  var sheetName = (e && e.parameter && e.parameter.sheet) || "API_Data";
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var rowCount = sheet ? sheet.getLastRow() : 0;
  return ContentService
    .createTextOutput(JSON.stringify({
      status: "ok",
      message: "API Switchboard receiver is ready",
      sheet: sheetName,
      rows: rowCount,
      supportsSheetName: true,
      supportsMerge: true
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Read IDs from a column in a sheet (paginated).
 * Used by the "Enrich by ID" feature to know which IDs to iterate over.
 */
function handleGetIds(e) {
  try {
    var sheetName = (e.parameter && e.parameter.sheet) || "API_Data";
    var columnName = (e.parameter && e.parameter.column) || "id";
    var startIndex = parseInt(e.parameter && e.parameter.start || "0", 10);
    var limit = Math.min(parseInt(e.parameter && e.parameter.limit || "500", 10), 1000);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Sheet '" + sheetName + "' not found"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false, error: "Sheet is empty"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Find the column index by header name
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colIndex = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).trim() === columnName) {
        colIndex = h;
        break;
      }
    }

    if (colIndex === -1) {
      var availableHeaders = [];
      for (var j = 0; j < headers.length; j++) {
        if (headers[j] !== "") availableHeaders.push(String(headers[j]));
      }
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Column '" + columnName + "' not found in headers",
        availableHeaders: availableHeaders
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Read IDs from that column (skip header row)
    var totalRows = sheet.getLastRow() - 1; // minus header
    var readStart = startIndex + 2; // +1 for 1-index, +1 for header row
    var readCount = Math.min(limit, totalRows - startIndex);

    if (readCount <= 0) {
      return ContentService.createTextOutput(JSON.stringify({
        success: true, ids: [], total: totalRows, hasMore: false
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var values = sheet.getRange(readStart, colIndex + 1, readCount, 1).getValues();
    var ids = [];
    for (var i = 0; i < values.length; i++) {
      var val = String(values[i][0]);
      if (val && val !== "" && val !== "undefined" && val !== "null") {
        ids.push(val);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      ids: ids,
      total: totalRows,
      returned: ids.length,
      startIndex: startIndex,
      hasMore: (startIndex + readCount) < totalRows,
      nextStart: startIndex + readCount
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
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

      // Check for merge mode (used by Enrich by ID)
      if (parsed.mode === "merge" && parsed.keyColumn) {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName(sheetName);
        if (!sheet) {
          return "Error: Sheet '" + sheetName + "' not found for merge";
        }
        if (!Array.isArray(data)) {
          return "Error: merge mode requires data to be an array";
        }
        return mergeData(sheet, data, String(parsed.keyColumn));
      }
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
 * Merge enrichment data into existing rows by matching a key column.
 * Used by the "Enrich by ID" feature.
 *
 * - Finds existing rows by key column value
 * - Adds new column headers (if not already present)
 * - Writes enrichment data into matching rows
 *
 * @param {Sheet} sheet - The Google Sheet to merge into
 * @param {Array} dataArray - Array of objects to merge
 * @param {string} keyColumn - Name of the column to match on (e.g. "id")
 * @returns {string} Status message
 */
function mergeData(sheet, dataArray, keyColumn) {
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    return "Empty data array - nothing to merge";
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    return "Error: Sheet is empty, nothing to merge into";
  }

  // Step 1: Read existing headers
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var keyColIndex = -1;
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]).trim() === keyColumn) {
      keyColIndex = h;
      break;
    }
  }

  if (keyColIndex === -1) {
    var headerNames = [];
    for (var j = 0; j < headers.length; j++) {
      if (headers[j] !== "") headerNames.push(String(headers[j]));
    }
    return "Error: Key column '" + keyColumn + "' not found. Available: " + headerNames.join(", ");
  }

  // Step 2: Build keyValue -> rowIndex map
  var dataRows = lastRow - 1; // exclude header
  if (dataRows <= 0) return "Error: Sheet has headers but no data rows";

  var keyValues = sheet.getRange(2, keyColIndex + 1, dataRows, 1).getValues();
  var keyMap = {};
  for (var i = 0; i < keyValues.length; i++) {
    var key = String(keyValues[i][0]).trim();
    if (key && key !== "" && key !== "undefined" && key !== "null") {
      keyMap[key] = i + 2; // row index (1-indexed, skip header)
    }
  }

  // Step 3: Collect all column names from incoming data (excluding key column)
  var allNewKeys = [];
  for (var d = 0; d < dataArray.length; d++) {
    var item = dataArray[d];
    if (typeof item === 'object' && item !== null) {
      var itemKeys = Object.keys(item);
      for (var k = 0; k < itemKeys.length; k++) {
        var ik = itemKeys[k];
        if (ik === keyColumn) continue;
        // Check if this column already exists in headers
        var exists = false;
        for (var e = 0; e < headers.length; e++) {
          if (String(headers[e]).trim() === ik) { exists = true; break; }
        }
        if (!exists) {
          var alreadyNew = false;
          for (var n = 0; n < allNewKeys.length; n++) {
            if (allNewKeys[n] === ik) { alreadyNew = true; break; }
          }
          if (!alreadyNew) allNewKeys.push(ik);
        }
      }
    }
  }

  // Step 4: Add new headers if any
  if (allNewKeys.length > 0) {
    var newHeaderStart = lastCol + 1;
    var headerRange = sheet.getRange(1, newHeaderStart, 1, allNewKeys.length);
    headerRange.setValues([allNewKeys]);
    headerRange.setFontWeight("bold");
  }

  // Rebuild full header list (existing + new)
  var fullHeaders = [];
  for (var fh = 0; fh < headers.length; fh++) fullHeaders.push(String(headers[fh]).trim());
  for (var nh = 0; nh < allNewKeys.length; nh++) fullHeaders.push(allNewKeys[nh]);

  // Step 5: Write data to matching rows
  var matched = 0;
  var notFound = 0;

  for (var m = 0; m < dataArray.length; m++) {
    var mItem = dataArray[m];
    if (typeof mItem !== 'object' || mItem === null) continue;
    var itemKey = String(mItem[keyColumn] || "").trim();
    var rowIndex = keyMap[itemKey];

    if (!rowIndex) {
      notFound++;
      continue;
    }

    matched++;

    // Collect values for columns that have data
    var mKeys = Object.keys(mItem);
    for (var mk = 0; mk < mKeys.length; mk++) {
      var fieldKey = mKeys[mk];
      if (fieldKey === keyColumn) continue;

      // Find column index in full headers
      var colIdx = -1;
      for (var ci = 0; ci < fullHeaders.length; ci++) {
        if (fullHeaders[ci] === fieldKey) { colIdx = ci; break; }
      }
      if (colIdx === -1) continue;

      var val = mItem[fieldKey];
      if (typeof val === 'object' && val !== null) {
        val = JSON.stringify(val);
      }
      sheet.getRange(rowIndex, colIdx + 1).setValue(val !== undefined && val !== null ? val : "");
    }
  }

  return "Merged " + matched + " rows, " + notFound + " IDs not found, " + allNewKeys.length + " new columns added";
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
