var SHEET_NAME = "floor_directory_log";

function doGet() {
  var result = {};
  result.ok = true;
  result.message = "Floor directory OCR sheet endpoint is running.";
  return json_(result);
}

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    var sheet = getLogSheet_();
    ensureHeader_(sheet);
    sheet.appendRow(buildRow_(payload));

    var result = {};
    result.ok = true;
    result.sheetName = sheet.getName();
    result.row = sheet.getLastRow();
    return json_(result);
  } catch (err) {
    var errorResult = {};
    var errorMessage = String(err);
    if (err) {
      if (err.message) {
        errorMessage = err.message;
      }
    }
    errorResult.ok = false;
    errorResult.error = String(errorMessage);
    return json_(errorResult);
  }
}

function parsePayload_(e) {
  var contents = "";
  if (e) {
    if (e.postData) {
      if (e.postData.contents) {
        contents = e.postData.contents;
      }
    }
  }

  if (contents === "") {
    throw new Error("Missing request body");
  }
  return JSON.parse(contents);
}

function getLogSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }
  return sheet;
}

function ensureHeader_(sheet) {
  var floors = getFloorKeys_();
  var headers = ["captured_at", "building_name", "source_name", "raw_text", "parsed_json"];
  var i;

  for (i = 0; i < floors.length; i += 1) {
    headers.push(floors[i]);
  }

  var firstCell = sheet.getRange(1, 1).getValue();
  var firstText = "";
  if (firstCell !== null) {
    if (firstCell !== undefined) {
      firstText = String(firstCell).trim();
    }
  }

  if (firstText === "") {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  ensureBuildingNameColumn_(sheet);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
}

function ensureBuildingNameColumn_(sheet) {
  var lastColumn = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var hasBuildingName = false;
  var i;

  for (i = 0; i < headers.length; i += 1) {
    if (String(headers[i]) === "building_name") {
      hasBuildingName = true;
    }
  }

  if (!hasBuildingName) {
    sheet.insertColumnAfter(1);
    sheet.getRange(1, 2).setValue("building_name");
  }
}

function buildRow_(payload) {
  var floors = getFloorKeys_();
  var floorValues = {};
  var rows = [];
  var capturedAt = new Date().toISOString();
  var buildingName = "";
  var sourceName = "";
  var rawText = "";
  var row = [];
  var i;

  if (payload) {
    if (payload.floors) {
      floorValues = payload.floors;
    }
    if (payload.rows) {
      rows = payload.rows;
    }
    if (payload.capturedAt) {
      capturedAt = payload.capturedAt;
    }
    if (payload.buildingName) {
      buildingName = payload.buildingName;
    }
    if (payload.sourceName) {
      sourceName = payload.sourceName;
    }
    if (payload.rawText) {
      rawText = payload.rawText;
    }
  }

  row.push(capturedAt);
  row.push(buildingName);
  row.push(sourceName);
  row.push(rawText);
  row.push(JSON.stringify(rows));

  for (i = 0; i < floors.length; i += 1) {
    if (floorValues[floors[i]]) {
      row.push(floorValues[floors[i]]);
    } else {
      row.push("");
    }
  }

  return row;
}

function getFloorKeys_() {
  var floors = [];
  var i;

  for (i = 5; i >= 1; i -= 1) {
    floors.push("B" + i);
  }

  for (i = 1; i <= 100; i += 1) {
    floors.push(i + "F");
  }

  return floors;
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
