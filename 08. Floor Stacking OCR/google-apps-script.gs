var SHEET_NAME = "floor_directory_log";
var VISION_API_KEY_PROPERTY = "GOOGLE_VISION_API_KEY";
var VISION_API_KEY_PROPERTY_1 = "GOOGLE_VISION_API_KEY_1";
var VISION_API_KEY_PROPERTY_2 = "GOOGLE_VISION_API_KEY_2";
var OCR_MONTHLY_LIMIT_PER_KEY_PROPERTY = "OCR_MONTHLY_LIMIT_PER_KEY";
var DEFAULT_OCR_MONTHLY_LIMIT_PER_KEY = 990;
var OCR_USAGE_PROPERTY_PREFIX = "VISION_OCR_USAGE_";

function doGet() {
  var result = {};
  result.ok = true;
  result.message = "Floor directory OCR endpoint is running.";
  result.ocrEngine = "google_vision_document_text_detection";
  result.ocrQuota = getOcrQuotaStatus_();
  return json_(result);
}

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    if (payload.action === "ocr") {
      return handleOcr_(payload);
    }

    if (payload.action) {
      if (payload.action !== "save") {
        throw new Error("Unsupported action: " + payload.action);
      }
    }

    return handleSave_(payload);
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

function handleSave_(payload) {
    var sheet = getLogSheet_();
    ensureHeader_(sheet);
    sheet.appendRow(buildRow_(payload));

    var result = {};
    result.ok = true;
    result.sheetName = sheet.getName();
    result.row = sheet.getLastRow();
    return json_(result);
}

function handleOcr_(payload) {
  var imageData = "";
  var result;

  if (payload) {
    if (payload.imageData) {
      imageData = String(payload.imageData);
    }
  }

  if (imageData === "") {
    throw new Error("Missing imageData");
  }

  result = callVisionOcr_(imageData);
  return json_(result);
}

function callVisionOcr_(imageData) {
  var keyReservation = reserveVisionApiKey_();
  var apiKey = keyReservation.apiKey;
  var base64Image;
  var requestBody;
  var response;
  var statusCode;
  var responseText;
  var parsed;
  var visionResult;
  var result = {};

  base64Image = stripImageDataPrefix_(imageData);
  requestBody = {
    requests: [
      {
        image: {
          content: base64Image
        },
        features: [
          {
            type: "DOCUMENT_TEXT_DETECTION"
          }
        ],
        imageContext: {
          languageHints: ["ko", "en"]
        }
      }
    ]
  };

  response = UrlFetchApp.fetch(
    "https://vision.googleapis.com/v1/images:annotate?key=" + encodeURIComponent(apiKey),
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    }
  );

  statusCode = response.getResponseCode();
  responseText = response.getContentText();
  if (statusCode < 200) {
    throw new Error("Vision API request failed (" + statusCode + "): " + responseText);
  }
  if (statusCode >= 300) {
    throw new Error("Vision API request failed (" + statusCode + "): " + responseText);
  }

  parsed = JSON.parse(responseText);
  if (!parsed.responses) {
    throw new Error("Vision API returned an invalid response");
  }
  if (!parsed.responses[0]) {
    throw new Error("Vision API returned an empty response");
  }

  visionResult = parsed.responses[0];
  if (visionResult.error) {
    throw new Error(visionResult.error.message || JSON.stringify(visionResult.error));
  }

  result.ok = true;
  result.engine = "google_vision_document_text_detection";
  result.ocrQuota = buildClientQuotaResult_(keyReservation);
  result.rawText = extractVisionText_(visionResult);
  result.words = extractVisionWords_(visionResult.fullTextAnnotation);
  return result;
}

function reserveVisionApiKey_() {
  var lock = LockService.getScriptLock();
  var properties;
  var slots;
  var limit;
  var month;
  var i;
  var slot;
  var usageProperty;
  var used;

  lock.waitLock(10000);
  try {
    properties = PropertiesService.getScriptProperties();
    slots = getVisionApiKeySlots_(properties);
    limit = getOcrMonthlyLimit_(properties);
    month = getOcrUsageMonth_();

    for (i = 0; i < slots.length; i += 1) {
      slot = slots[i];
      if (!slot.apiKey) {
        continue;
      }

      usageProperty = getOcrUsagePropertyName_(slot.slot, month);
      used = getOcrUsageCount_(properties, usageProperty);
      if (used < limit) {
        used += 1;
        properties.setProperty(usageProperty, String(used));
        return {
          apiKey: slot.apiKey,
          slot: slot.slot,
          propertyName: slot.propertyName,
          month: month,
          used: used,
          limit: limit,
          remaining: Math.max(0, limit - used)
        };
      }
    }
  } finally {
    lock.releaseLock();
  }

  throw new Error(
    "No available Google Vision API key. Add GOOGLE_VISION_API_KEY_1 and GOOGLE_VISION_API_KEY_2, or raise OCR_MONTHLY_LIMIT_PER_KEY."
  );
}

function getOcrQuotaStatus_() {
  var properties = PropertiesService.getScriptProperties();
  var slots = getVisionApiKeySlots_(properties);
  var limit = getOcrMonthlyLimit_(properties);
  var month = getOcrUsageMonth_();
  var status = [];
  var i;
  var slot;
  var used;

  for (i = 0; i < slots.length; i += 1) {
    slot = slots[i];
    used = getOcrUsageCount_(properties, getOcrUsagePropertyName_(slot.slot, month));
    status.push({
      slot: slot.slot,
      propertyName: slot.propertyName,
      configured: slot.apiKey !== "",
      month: month,
      used: used,
      limit: limit,
      remaining: Math.max(0, limit - used)
    });
  }

  return status;
}

function getVisionApiKeySlots_(properties) {
  var key1 = String(properties.getProperty(VISION_API_KEY_PROPERTY_1) || "").trim();
  var key1PropertyName = VISION_API_KEY_PROPERTY_1;
  var legacyKey = String(properties.getProperty(VISION_API_KEY_PROPERTY) || "").trim();
  var key2 = String(properties.getProperty(VISION_API_KEY_PROPERTY_2) || "").trim();

  if (!key1) {
    key1 = legacyKey;
    if (legacyKey) {
      key1PropertyName = VISION_API_KEY_PROPERTY;
    }
  }

  return [
    {
      slot: 1,
      propertyName: key1PropertyName,
      apiKey: key1
    },
    {
      slot: 2,
      propertyName: VISION_API_KEY_PROPERTY_2,
      apiKey: key2
    }
  ];
}

function getOcrMonthlyLimit_(properties) {
  var value = Number(properties.getProperty(OCR_MONTHLY_LIMIT_PER_KEY_PROPERTY) || DEFAULT_OCR_MONTHLY_LIMIT_PER_KEY);
  if (!isFinite(value)) {
    return DEFAULT_OCR_MONTHLY_LIMIT_PER_KEY;
  }
  if (value <= 0) {
    return DEFAULT_OCR_MONTHLY_LIMIT_PER_KEY;
  }
  return Math.floor(value);
}

function getOcrUsageMonth_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Seoul", "yyyy_MM");
}

function getOcrUsagePropertyName_(slot, month) {
  return OCR_USAGE_PROPERTY_PREFIX + String(slot) + "_" + month;
}

function getOcrUsageCount_(properties, propertyName) {
  var value = Number(properties.getProperty(propertyName) || 0);
  if (!isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function buildClientQuotaResult_(reservation) {
  return {
    slot: reservation.slot,
    propertyName: reservation.propertyName,
    month: reservation.month,
    used: reservation.used,
    limit: reservation.limit,
    remaining: reservation.remaining
  };
}

function stripImageDataPrefix_(imageData) {
  return String(imageData).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function extractVisionText_(visionResult) {
  if (visionResult.fullTextAnnotation) {
    if (visionResult.fullTextAnnotation.text) {
      return visionResult.fullTextAnnotation.text;
    }
  }

  if (visionResult.textAnnotations) {
    if (visionResult.textAnnotations[0]) {
      if (visionResult.textAnnotations[0].description) {
        return visionResult.textAnnotations[0].description;
      }
    }
  }

  return "";
}

function extractVisionWords_(fullTextAnnotation) {
  var words = [];
  var pages;
  var pageIndex;
  var blockIndex;
  var paragraphIndex;
  var wordIndex;
  var symbolIndex;
  var page;
  var block;
  var paragraph;
  var word;
  var symbols;
  var text;
  var confidence;
  var bounds;

  if (!fullTextAnnotation) {
    return words;
  }
  if (!fullTextAnnotation.pages) {
    return words;
  }

  pages = fullTextAnnotation.pages;
  for (pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    page = pages[pageIndex];
    if (!page.blocks) {
      continue;
    }

    for (blockIndex = 0; blockIndex < page.blocks.length; blockIndex += 1) {
      block = page.blocks[blockIndex];
      if (!block.paragraphs) {
        continue;
      }

      for (paragraphIndex = 0; paragraphIndex < block.paragraphs.length; paragraphIndex += 1) {
        paragraph = block.paragraphs[paragraphIndex];
        if (!paragraph.words) {
          continue;
        }

        for (wordIndex = 0; wordIndex < paragraph.words.length; wordIndex += 1) {
          word = paragraph.words[wordIndex];
          symbols = word.symbols || [];
          text = "";
          for (symbolIndex = 0; symbolIndex < symbols.length; symbolIndex += 1) {
            if (symbols[symbolIndex].text) {
              text += symbols[symbolIndex].text;
            }
          }

          if (text === "") {
            continue;
          }

          confidence = null;
          if (word.confidence !== null) {
            if (word.confidence !== undefined) {
              confidence = Number(word.confidence) * 100;
            }
          }

          bounds = getVisionBounds_(word.boundingBox);

          words.push({
            text: text,
            confidence: confidence,
            bounds: bounds
          });
        }
      }
    }
  }

  return words;
}

function getVisionBounds_(boundingBox) {
  var result = {};
  var vertices;
  var i;
  var vertex;
  var x;
  var y;
  var minX = null;
  var minY = null;
  var maxX = null;
  var maxY = null;

  if (!boundingBox) {
    return null;
  }
  if (!boundingBox.vertices) {
    return null;
  }

  vertices = boundingBox.vertices;
  for (i = 0; i < vertices.length; i += 1) {
    vertex = vertices[i];
    x = Number(vertex.x || 0);
    y = Number(vertex.y || 0);

    if (minX === null) {
      minX = x;
      minY = y;
      maxX = x;
      maxY = y;
    } else {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (minX === null) {
    return null;
  }

  result.left = minX;
  result.top = minY;
  result.right = maxX;
  result.bottom = maxY;
  result.width = maxX - minX;
  result.height = maxY - minY;
  result.centerX = (minX + maxX) / 2;
  result.centerY = (minY + maxY) / 2;
  return result;
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
