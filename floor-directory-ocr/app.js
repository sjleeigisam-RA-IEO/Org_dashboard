const cameraInput = document.querySelector("#cameraInput");
const imageInput = document.querySelector("#imageInput");
const runOcrButton = document.querySelector("#runOcrButton");
const clearButton = document.querySelector("#clearButton");
const enhanceToggle = document.querySelector("#enhanceToggle");
const dropZone = document.querySelector("#dropZone");
const emptyState = document.querySelector("#emptyState");
const previewCanvas = document.querySelector("#previewCanvas");
const rawText = document.querySelector("#rawText");
const resultBody = document.querySelector("#resultBody");
const rowCount = document.querySelector("#rowCount");
const fileMeta = document.querySelector("#fileMeta");
const statusText = document.querySelector("#statusText");
const statusPercent = document.querySelector("#statusPercent");
const progressBar = document.querySelector("#progressBar");
const buildingNameInput = document.querySelector("#buildingNameInput");
const saveSheetButton = document.querySelector("#saveSheetButton");
const sheetStatus = document.querySelector("#sheetStatus");

const previewContext = previewCanvas.getContext("2d", { willReadFrequently: true });
const buildingNameStorageKey = "floorDirectoryOcr.buildingName";
const maxOcrImageSide = 2400;
const googleSheetWebAppUrl =
  "https://script.google.com/macros/s/AKfycbx4WaX0l6o7I5BTTfHLC9f9t40_uSfYLAZB_80WsPsBsVOMlBgM2fFKCxDVXImg9Uw11w/exec";

let selectedFile = null;
let processedDataUrl = "";
let wordConfidenceByLine = new Map();
let visionWords = [];
let parsedRows = [];

cameraInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) {
    handleImageFile(file);
  }
});

imageInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) {
    handleImageFile(file);
  }
});

runOcrButton.addEventListener("click", runOcr);

clearButton.addEventListener("click", () => {
  selectedFile = null;
  processedDataUrl = "";
  wordConfidenceByLine = new Map();
  visionWords = [];
  parsedRows = [];
  rawText.value = "";
  cameraInput.value = "";
  imageInput.value = "";
  fileMeta.textContent = "촬영하거나 저장된 이미지를 선택하십시오.";
  runOcrButton.disabled = true;
  clearPreview();
  setStatus("대기 중", 0);
  renderParsedRows();
});

enhanceToggle.addEventListener("change", () => {
  if (selectedFile) {
    renderSelectedImage(selectedFile);
  }
});

buildingNameInput.value = localStorage.getItem(buildingNameStorageKey) || "";

buildingNameInput.addEventListener("input", () => {
  localStorage.setItem(buildingNameStorageKey, buildingNameInput.value.trim());
  updateSheetControls();
});

saveSheetButton.addEventListener("click", () => {
  saveToGoogleSheet();
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files || [];
  if (file && file.type.startsWith("image/")) {
    handleImageFile(file);
  }
});

async function handleImageFile(file) {
  selectedFile = file;
  fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
  runOcrButton.disabled = true;
  setStatus("이미지 준비 중", 15);
  await renderSelectedImage(file);
  runOcrButton.disabled = false;
  setStatus("OCR 실행 가능", 0);
}

async function renderSelectedImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxOcrImageSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  previewCanvas.width = width;
  previewCanvas.height = height;
  previewContext.fillStyle = "#ffffff";
  previewContext.fillRect(0, 0, width, height);
  previewContext.drawImage(bitmap, 0, 0, width, height);

  if (enhanceToggle.checked) {
    enhanceCanvas(previewContext, width, height);
  }

  processedDataUrl = previewCanvas.toDataURL("image/jpeg", 0.92);
  emptyState.hidden = true;
}

async function runOcr() {
  if (!processedDataUrl) {
    return;
  }

  runOcrButton.disabled = true;
  setStatus("Google Vision OCR 전송 중", 10);

  try {
    const result = await requestGoogleVisionOcr();
    rawText.value = (result.rawText || "").trim();
    visionWords = result.words || [];
    wordConfidenceByLine = buildConfidenceMap({ words: visionWords });
    setStatus(formatOcrQuotaStatus(result.ocrQuota), 100);
    renderParsedRows();
  } catch (error) {
    console.error(error);
    setStatus(`OCR 실패: ${error.message || "원문 영역에 직접 붙여넣을 수 있습니다."}`, 0);
  } finally {
    runOcrButton.disabled = false;
  }
}

async function requestGoogleVisionOcr() {
  const response = await fetch(googleSheetWebAppUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "ocr",
      version: "floor-directory-ocr-v2",
      capturedAt: new Date().toISOString(),
      sourceName: selectedFile?.name || "camera-image",
      imageData: processedDataUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`Apps Script OCR request failed: ${response.status}`);
  }

  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("Apps Script가 JSON 응답을 반환하지 않았습니다.");
  }

  if (!result.ok) {
    throw new Error(result.error || "Google Vision OCR failed");
  }

  setStatus("Google Vision OCR 결과 정리 중", 85);
  return result;
}

function formatOcrQuotaStatus(ocrQuota) {
  if (!ocrQuota) {
    return "OCR 완료";
  }

  const slot = ocrQuota.slot || "?";
  const used = Number.isFinite(Number(ocrQuota.used)) ? Number(ocrQuota.used) : "?";
  const limit = Number.isFinite(Number(ocrQuota.limit)) ? Number(ocrQuota.limit) : "?";
  return `OCR 완료 (키 ${slot}: ${used}/${limit})`;
}

function enhanceCanvas(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const luminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (luminance - 128) * 1.65 + 128));
    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }

  context.putImageData(imageData, 0, 0);
}

function renderParsedRows() {
  const wordRows = parseDirectoryWords(visionWords);
  const textRows = parseDirectoryText(rawText.value, wordConfidenceByLine);
  parsedRows = scoreParsedRows(wordRows) >= scoreParsedRows(textRows) ? wordRows : textRows;
  rowCount.textContent = `${parsedRows.length}개 항목`;

  if (!parsedRows.length) {
    resultBody.innerHTML = `<tr class="placeholder-row"><td colspan="2">변환된 항목이 없습니다.</td></tr>`;
    updateSheetControls();
    return;
  }

  resultBody.innerHTML = parsedRows
    .map((row) => {
      return `<tr>
        <td>${escapeHtml(row.floor)}</td>
        <td>${escapeHtml(row.company)}</td>
      </tr>`;
    })
    .join("");
  updateSheetControls();
}

function parseDirectoryWords(words) {
  const positionedWords = normalizeVisionWords(words);
  if (positionedWords.length < 4) {
    return [];
  }

  const floorCandidates = dedupeFloorCandidates(collectFloorCandidates(positionedWords));
  if (floorCandidates.length < 2) {
    return [];
  }

  const floorRows = buildFloorRows(floorCandidates);
  const floorWordIndexes = new Set(floorCandidates.map((floor) => floor.wordIndex));
  const rows = [];

  for (const floorRow of floorRows) {
    const rowWords = positionedWords.filter((word) => {
      return (
        !floorWordIndexes.has(word.index) &&
        isTenantWord(word.text) &&
        word.bounds.centerY >= floorRow.top &&
        word.bounds.centerY < floorRow.bottom
      );
    });

    const floors = floorRow.floors.sort((a, b) => a.bounds.left - b.bounds.left);
    for (let index = 0; index < floors.length; index += 1) {
      const floor = floors[index];
      const nextFloor = floors[index + 1] || null;
      const leftLimit = floor.bounds.right + Math.max(6, floor.bounds.width * 0.12);
      const rightLimit = nextFloor ? nextFloor.bounds.left - Math.max(6, nextFloor.bounds.width * 0.12) : Infinity;
      const tenantWords = filterDominantRowWords(
        rowWords.filter((word) => word.bounds.left >= leftLimit && word.bounds.left < rightLimit)
      );
      const source = joinVisionWords(tenantWords);
      const company = cleanupTenant(source);

      if (!company || isNoiseLine(company)) {
        continue;
      }

      rows.push({
        floor: floor.floor,
        company,
        source,
        confidence: averageConfidence(tenantWords),
      });
    }
  }

  return mergeDuplicateRows(rows);
}

function normalizeVisionWords(words) {
  return (words || [])
    .map((word, index) => ({
      index,
      text: String(word.text || "").trim(),
      confidence: word.confidence == null ? null : Number(word.confidence),
      bounds: normalizeBounds(word.bounds),
    }))
    .filter((word) => word.text && word.bounds);
}

function normalizeBounds(bounds) {
  if (!bounds) {
    return null;
  }

  const left = Number(bounds.left);
  const top = Number(bounds.top);
  const right = Number(bounds.right);
  const bottom = Number(bounds.bottom);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function collectFloorCandidates(words) {
  const candidates = [];

  for (const word of words) {
    const floor = floorFromWord(word.text);
    if (floor) {
      candidates.push({
        floor,
        wordIndex: word.index,
        bounds: word.bounds,
        confidence: word.confidence,
        synthetic: false,
      });
      continue;
    }

    candidates.push(...splitCompactFloorWord(word));
  }

  return candidates;
}

function floorFromWord(text) {
  const token = String(text || "")
    .toUpperCase()
    .replace(/[｜|]/g, "1")
    .replace(/[^0-9A-Z가-힣]/g, "");

  if (/^지하\d{1,2}$/.test(token)) {
    return `B${token.replace("지하", "")}`;
  }

  if (/^B\d{1,2}F?$/.test(token)) {
    return token.replace(/F$/, "");
  }

  if (/^\d{1,2}(F|FL|층)?$/.test(token)) {
    const number = Number(token.replace(/\D/g, ""));
    if (number >= 1 && number <= 100) {
      return `${number}F`;
    }
  }

  if (token === "RF" || token === "옥상") {
    return "RF";
  }

  return "";
}

function splitCompactFloorWord(word) {
  const digits = word.text.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 9 || !isDescendingDigitRun(digits)) {
    return [];
  }

  const step = word.bounds.height / digits.length;
  return digits.split("").map((digit, index) => {
    const top = word.bounds.top + step * index;
    const bottom = top + step;
    return {
      floor: `${Number(digit)}F`,
      wordIndex: word.index,
      bounds: {
        left: word.bounds.left,
        top,
        right: word.bounds.right,
        bottom,
        width: word.bounds.width,
        height: step,
        centerX: word.bounds.centerX,
        centerY: (top + bottom) / 2,
      },
      confidence: word.confidence,
      synthetic: true,
    };
  });
}

function isDescendingDigitRun(value) {
  for (let index = 1; index < value.length; index += 1) {
    if (Number(value[index - 1]) - Number(value[index]) !== 1) {
      return false;
    }
  }
  return true;
}

function dedupeFloorCandidates(candidates) {
  const byFloor = new Map();

  for (const candidate of candidates) {
    const existing = byFloor.get(candidate.floor);
    if (
      !existing ||
      (existing.synthetic && !candidate.synthetic) ||
      Number(candidate.confidence || 0) > Number(existing.confidence || 0)
    ) {
      byFloor.set(candidate.floor, candidate);
    }
  }

  return [...byFloor.values()].sort((a, b) => a.bounds.centerY - b.bounds.centerY);
}

function buildFloorBands(floors) {
  return floors.map((floor, index) => {
    const previous = floors[index - 1];
    const next = floors[index + 1];
    const top = previous ? (previous.bounds.centerY + floor.bounds.centerY) / 2 : floor.bounds.top - floor.bounds.height;
    const bottom = next ? (floor.bounds.centerY + next.bounds.centerY) / 2 : floor.bounds.bottom + floor.bounds.height;
    return {
      floor: floor.floor,
      centerY: floor.bounds.centerY,
      top,
      bottom,
    };
  });
}

function buildFloorRows(floors) {
  const sortedFloors = [...floors].sort((a, b) => a.bounds.centerY - b.bounds.centerY || a.bounds.left - b.bounds.left);
  const rowTolerance = Math.max(10, median(sortedFloors.map((floor) => floor.bounds.height)) * 0.75);
  const rows = [];

  for (const floor of sortedFloors) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow.centerY - floor.bounds.centerY) <= rowTolerance) {
      lastRow.floors.push(floor);
      lastRow.centerY =
        lastRow.floors.reduce((sum, item) => sum + item.bounds.centerY, 0) / lastRow.floors.length;
    } else {
      rows.push({
        centerY: floor.bounds.centerY,
        floors: [floor],
      });
    }
  }

  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const next = rows[index + 1];
    const rowHeight = Math.max(...row.floors.map((floor) => floor.bounds.height));
    return {
      centerY: row.centerY,
      top: previous ? (previous.centerY + row.centerY) / 2 : row.centerY - rowHeight,
      bottom: next ? (row.centerY + next.centerY) / 2 : row.centerY + rowHeight,
      floors: row.floors,
    };
  });
}

function findFloorBand(centerY, bands) {
  return bands.find((band) => centerY >= band.top && centerY < band.bottom) || null;
}

function isTenantWord(text) {
  const cleaned = cleanupTenant(text);
  return (
    cleaned.length >= 2 &&
    /[가-힣A-Za-z]/.test(cleaned) &&
    !floorFromWord(cleaned) &&
    !isCompactFloorText(cleaned) &&
    !isNoiseLine(cleaned)
  );
}

function isCompactFloorText(text) {
  const digits = String(text || "").replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 9 && isDescendingDigitRun(digits);
}

function filterDominantRowWords(words) {
  if (words.length <= 2) {
    return words.sort(compareWordPosition);
  }

  const maxHeight = Math.max(...words.map((word) => word.bounds.height));
  return words
    .filter((word) => word.bounds.height >= maxHeight * 0.38)
    .sort(compareWordPosition);
}

function joinVisionWords(words) {
  return words.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
}

function averageConfidence(words) {
  const values = words.map((word) => word.confidence).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareWordPosition(a, b) {
  if (Math.abs(a.bounds.centerY - b.bounds.centerY) > Math.max(a.bounds.height, b.bounds.height) * 0.7) {
    return a.bounds.centerY - b.bounds.centerY;
  }
  return a.bounds.left - b.bounds.left;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  return sorted[Math.floor(sorted.length / 2)];
}

function scoreParsedRows(rows) {
  return rows.reduce((score, row) => {
    const floorNumber = /^\d+F$/.test(row.floor) ? Number(row.floor.slice(0, -1)) : 0;
    const floorPenalty = floorNumber > 30 ? 2 : 0;
    const companyPenalty = /\d{3,}/.test(row.company) ? 1 : 0;
    return score + 1 - floorPenalty - companyPenalty;
  }, 0);
}

function parseDirectoryText(text, confidenceMap) {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  let currentFloor = "";

  for (const line of lines) {
    const floorParts = splitPackedFloorLine(line);
    const targetLines = floorParts.length > 1 ? floorParts : [line];

    for (const targetLine of targetLines) {
      const floorMatch = extractFloor(targetLine);

      if (floorMatch) {
        currentFloor = floorMatch.floor;
        addCompanies(rows, currentFloor, floorMatch.rest, targetLine, confidenceMap);
        continue;
      }

      if (isNoiseLine(targetLine)) {
        continue;
      }

      if (currentFloor && looksLikeTenantLine(targetLine)) {
        addCompanies(rows, currentFloor, targetLine, targetLine, confidenceMap);
      }
    }
  }

  return mergeDuplicateRows(rows);
}

function normalizeText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[|｜]/g, " ")
    .replace(/[·ㆍ•]/g, " / ")
    .replace(/[：]/g, ":")
    .replace(/[–—]/g, "-")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractFloor(line) {
  const cleaned = line.replace(/^[^\w가-힣]+/, "").trim();
  const bareFloor = cleaned.match(/^(?:[1-9]|[1-9][0-9])$/);
  if (bareFloor) {
    return { floor: normalizeFloorLabel(bareFloor[0]), rest: "" };
  }

  const match = cleaned.match(
    /^(지하\s*\d{1,2}|B\s*\d{1,2}\s*F?|B\d{1,2}F?|[0-9]{1,2}\s*(?:F|FL|층)|[0-9]{1,2}\s+(?=[가-힣A-Za-z(㈜])|RF(?![A-Za-z0-9가-힣])|R\s*F|옥상|로비|LOBBY)\s*[:.\-]?\s*(.*)$/i
  );

  if (!match) {
    return null;
  }

  const floor = normalizeFloorLabel(match[1]);
  const rest = cleanupTenant(match[2] || "");

  if (!floor) {
    return null;
  }

  return { floor, rest };
}

function normalizeFloorLabel(value) {
  const token = value.toUpperCase().replace(/\s+/g, "");

  if (/^지하\d{1,2}$/.test(token)) {
    return `B${token.replace("지하", "")}`;
  }

  if (/^B\d{1,2}F?$/.test(token)) {
    return token.replace(/F$/, "");
  }

  if (/^\d{1,2}(F|FL|층)?$/.test(token)) {
    const number = Number(token.replace(/\D/g, ""));
    if (number < 1 || number > 80) {
      return "";
    }
    return `${number}F`;
  }

  if (token === "RF" || token === "R" || token === "옥상") {
    return "RF";
  }

  if (token === "로비" || token === "LOBBY") {
    return "1F";
  }

  return "";
}

function splitPackedFloorLine(line) {
  const packedPattern = /(지하\s*\d{1,2}|B\s*\d{1,2}|B\d{1,2}|[0-9]{1,2}\s*(?:F|FL|층)|RF|R\s*F|옥상|로비|LOBBY)\s*[:.\-]?\s*/gi;
  const matches = [...line.matchAll(packedPattern)];

  if (matches.length < 2) {
    return [];
  }

  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? line.length;
    return line.slice(start, end).trim();
  });
}

function addCompanies(rows, floor, rawTenantText, source, confidenceMap) {
  const tenantText = cleanupTenant(rawTenantText);
  if (!tenantText || isNoiseLine(tenantText)) {
    return;
  }

  const companies = tenantText
    .split(/\s*[,，/]\s*|\s{3,}/)
    .map(cleanupTenant)
    .filter((company) => company && !isNoiseLine(company));

  for (const company of companies) {
    rows.push({
      floor,
      company,
      source,
      confidence: getLineConfidence(source, confidenceMap),
    });
  }
}

function cleanupTenant(value) {
  return value
    .replace(/^[\s:.\-[\]{}]+/, "")
    .replace(/[\s:.\-]+$/, "")
    .replace(/\bTEL\b.*$/i, "")
    .replace(/\bOPEN\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isNoiseLine(line) {
  const compact = line.replace(/\s/g, "").toUpperCase();
  if (!compact) {
    return true;
  }

  const noiseWords = [
    "층별현황",
    "층별안내",
    "입주사안내",
    "BUILDINGDIRECTORY",
    "DIRECTORY",
    "FLOORGUIDE",
    "FLOORINFORMATION",
    "안내",
    "현황판",
  ];

  return noiseWords.includes(compact) || /^[0-9.\-:]+$/.test(compact);
}

function looksLikeTenantLine(line) {
  const cleaned = cleanupTenant(line);
  return cleaned.length >= 2 && /[가-힣A-Za-z0-9]/.test(cleaned) && !extractFloor(cleaned);
}

function mergeDuplicateRows(rows) {
  const seen = new Set();
  const merged = [];

  for (const row of rows) {
    const key = `${row.floor}|${row.company}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(row);
  }

  return merged.sort(compareFloorDesc);
}

function compareFloorDesc(a, b) {
  return floorOrder(b.floor) - floorOrder(a.floor);
}

function floorOrder(floor) {
  if (floor === "RF") {
    return 1000;
  }

  if (/^B\d+$/.test(floor)) {
    return -Number(floor.slice(1));
  }

  if (/^\d+F$/.test(floor)) {
    return Number(floor.slice(0, -1));
  }

  return 0;
}

function buildConfidenceMap(data) {
  const map = new Map();
  const words = data.words || [];

  for (const word of words) {
    const text = (word.text || "").trim();
    if (!text) {
      continue;
    }

    const key = normalizeForConfidence(text);
    if (!key) {
      continue;
    }

    const entry = map.get(key) || { total: 0, count: 0 };
    entry.total += Number(word.confidence || 0);
    entry.count += 1;
    map.set(key, entry);
  }

  return map;
}

function getLineConfidence(source, confidenceMap) {
  if (!confidenceMap.size) {
    return null;
  }

  const tokens = normalizeForConfidence(source).split(" ").filter(Boolean);
  let total = 0;
  let count = 0;

  for (const token of tokens) {
    const entry = confidenceMap.get(token);
    if (entry) {
      total += entry.total / entry.count;
      count += 1;
    }
  }

  return count ? total / count : null;
}

function normalizeForConfidence(value) {
  return value
    .replace(/[^\w가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function saveToGoogleSheet() {
  const buildingName = buildingNameInput.value.trim();

  if (!buildingName) {
    setSheetStatus("건물명을 입력하십시오.");
    buildingNameInput.focus();
    return;
  }

  if (!parsedRows.length) {
    setSheetStatus("저장할 표 항목이 없습니다.");
    return;
  }

  saveSheetButton.disabled = true;
  setSheetStatus("구글시트로 전송 중입니다.");

  try {
    await fetch(googleSheetWebAppUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(buildSheetPayload()),
    });
    setSheetStatus("전송 완료. Apps Script CORS 제한으로 브라우저에서는 응답을 확인하지 않습니다.");
  } catch (error) {
    console.error(error);
    setSheetStatus("전송 실패. Web App URL과 배포 권한을 확인하십시오.");
  } finally {
    updateSheetControls();
  }
}

function buildSheetPayload() {
  return {
    action: "save",
    version: "floor-directory-ocr-v1",
    capturedAt: new Date().toISOString(),
    buildingName: buildingNameInput.value.trim(),
    sourceName: selectedFile?.name || "manual-input",
    rawText: rawText.value,
    rows: parsedRows,
    floors: groupRowsByFloor(parsedRows),
  };
}

function groupRowsByFloor(rows) {
  const grouped = Object.fromEntries(getSheetFloorKeys().map((floor) => [floor, ""]));
  const buckets = new Map();

  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(grouped, row.floor)) {
      continue;
    }

    const companies = buckets.get(row.floor) || new Set();
    companies.add(row.company);
    buckets.set(row.floor, companies);
  }

  for (const [floor, companies] of buckets.entries()) {
    grouped[floor] = [...companies].join(", ");
  }

  return grouped;
}

function getSheetFloorKeys() {
  const basementFloors = Array.from({ length: 5 }, (_, index) => `B${5 - index}`);
  const aboveGroundFloors = Array.from({ length: 100 }, (_, index) => `${index + 1}F`);
  return [...basementFloors, ...aboveGroundFloors];
}

function updateSheetControls() {
  saveSheetButton.disabled = !parsedRows.length || !buildingNameInput.value.trim();
}

function setSheetStatus(message) {
  sheetStatus.textContent = message;
}

function setStatus(message, percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  statusText.textContent = message;
  statusPercent.textContent = `${clamped}%`;
  progressBar.style.width = `${clamped}%`;
}

function clearPreview() {
  previewCanvas.width = 1200;
  previewCanvas.height = 840;
  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  emptyState.hidden = false;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

clearPreview();
renderParsedRows();
updateSheetControls();
