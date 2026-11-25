/**
 * ============================================================================
 * BACKEND GOOGLE APPS SCRIPT - SISTEM MADRASAH (MDTA ASY SYIFA AL MUSRI')
 * Terhubung ke:
 * - Google Sheets: Database Sistem MDTA (1AL5a6m1aIcJvODOlTZ1DzPghddz34bRT3bfOBfBxrqY)
 * - Google Drive : Sistem MDTA - Database & Dokumen (1mgtcD4ipQjBjiqL6omZjBnJyuz3QAT_6)
 * ============================================================================
 */

const CONFIG = {
  SPREADSHEET_ID: '1AL5a6m1aIcJvODOlTZ1DzPghddz34bRT3bfOBfBxrqY',
  DRIVE_ROOT_ID: '1mgtcD4ipQjBjiqL6omZjBnJyuz3QAT_6',
  FOLDER_ARSIP_ID: '1FtDyo6Nxq0iX5tv7iKeSWrT_XPToK0Nh',
  FOLDER_UPLOAD_AI_ID: '1x-F9wQThtTcXIz-XgDIMmXzBelMrQXot',
  FOLDER_LAPORAN_PDF_ID: '1neoKIVTmIhKV71sOzmANg3D7wy9Xutgy',
  GEMINI_MODEL: 'gemini-2.5-flash'
};

const PROGRAM_CATEGORIES = ['Diniyyah', 'Tahfidz', 'Tarikh', 'Wustho'];

const LOG_SETORAN_HEADERS = [
  'id_setoran',
  'tanggal',
  'jenis_laporan',
  'kelas',
  'periode',
  'id_guru',
  'nama_guru',
  'ringkasan',
  'waktu_submit'
];

const KELAS_SCHEDULE_COLUMNS = [
  'hari_mengajar',
  'jam_mulai',
  'jam_selesai',
  'override_tanggal',
  'override_status',
  'override_jam_mulai',
  'override_jam_selesai',
  'override_catatan'
];

const KELAS_HEADERS = [
  'id_kelas',
  'nama_kelas',
  'kategori_program',
  'tingkat',
  'keterangan',
  'status',
  'created_at'
].concat(KELAS_SCHEDULE_COLUMNS);

const USER_PROFILE_COLUMNS = [
  'no_wa',
  'alamat',
  'pendidikan_terakhir',
  'bidang_ajar',
  'bio',
  'foto_url'
];

const ABSENSI_GURU_HEADERS = [
  'id_absen_guru',
  'tanggal',
  'waktu_masuk',
  'id_guru',
  'nama_guru',
  'kelas',
  'kategori_program',
  'status',
  'materi_diajarkan',
  'keterangan',
  'status_cek',
  'catatan_kepsek'
];

const SANTRI_EXTRA_COLUMNS = [
  'nis',
  'nik',
  'tempat_lahir',
  'tanggal_lahir',
  'nama_ayah_kandung'
];

/**
 * Helper untuk merespons JSON dengan format standar
 */
function jsonResponse(success, data, message = '') {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: success,
      message: message,
      data: data,
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Helper parsing angka aman (mendukung desimal koma Indonesia "88,6")
 */
function parseNumSafe(val, fallback = 0) {
  if (typeof val === 'number') return isFinite(val) ? val : fallback;
  if (val === null || val === undefined || val === '') return fallback;
  const parsed = Number(String(val).trim().replace('%', '').replace(',', '.'));
  return isFinite(parsed) ? parsed : fallback;
}

/**
 * Helper mendeteksi nilai error spreadsheet (#ERROR!, #NAME?, dll) atau sel kosong
 */
function isSheetErrorValue(val) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  if (!s) return true;
  return /^#(ERROR!|NAME\?|VALUE!|REF!|DIV\/0!|N\/A|NUM!|NULL!)/i.test(s);
}

/**
 * Menghitung grade dan keterangan raport murni dalam JavaScript (tanpa rumus Sheets)
 */
function computeRaportGrade(nAkhir) {
  const score = parseNumSafe(nAkhir, 0);
  if (score >= 90) return { grade: 'A', keterangan: 'Sangat Baik' };
  if (score >= 80) return { grade: 'B', keterangan: 'Baik' };
  if (score >= 70) return { grade: 'C', keterangan: 'Cukup' };
  return { grade: 'D', keterangan: 'Kurang' };
}

/**
 * Menormalkan satu baris nilai raport termasuk memulihkan data lama #ERROR!
 */
function resolveRaportRowValues(r) {
  const nHarian = parseNumSafe(r.n_harian, 0);
  const nUas = parseNumSafe(r.n_uas, 0);
  const nHadir = parseNumSafe(r.n_kehadiran, 0);
  const bH = parseNumSafe(r.bobot_harian, 40);
  const bU = parseNumSafe(r.bobot_uas, 40);
  const bK = parseNumSafe(r.bobot_kehadiran, 20);
  const bSum = (bH + bU + bK) || 100;
  const computedAkhir = Math.round(((nHarian * bH + nUas * bU + nHadir * bK) / bSum) * 100) / 100;

  const rawAkhir = parseNumSafe(r.n_akhir, NaN);
  const nAkhir = (!isSheetErrorValue(r.n_akhir) && isFinite(rawAkhir))
    ? Math.round(rawAkhir * 100) / 100
    : computedAkhir;

  const computed = computeRaportGrade(nAkhir);
  const rawGrade = !isSheetErrorValue(r.grade) ? String(r.grade).trim().toUpperCase() : '';
  const grade = ['A', 'B', 'C', 'D'].indexOf(rawGrade) >= 0 ? rawGrade : computed.grade;
  const keterangan = !isSheetErrorValue(r.keterangan) ? String(r.keterangan).trim() : computed.keterangan;

  return {
    n_harian: nHarian,
    n_uas: nUas,
    n_kehadiran: nHadir,
    bobot_harian: bH,
    bobot_uas: bU,
    bobot_kehadiran: bK,
    n_akhir: nAkhir,
    grade: grade,
    keterangan: keterangan
  };
}

/**
 * Menghasilkan ID berurutan unik berdasarkan angka tertinggi yang ada + 1 (anti-timpa)
 */
function generateUniqueSequentialId(rows, fieldName, prefix, padLen, extraUsedSet) {
  const used = new Set(extraUsedSet || []);
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('^' + escapedPrefix + '(\\d+)$', 'i');
  let maxNum = 0;

  (rows || []).forEach(r => {
    const val = String(r[fieldName] || '').trim();
    if (!val) return;
    used.add(val);
    const m = val.match(pattern);
    if (m) {
      const num = parseInt(m[1], 10);
      if (isFinite(num) && num > maxNum) maxNum = num;
    }
  });

  used.forEach(val => {
    const m = String(val).match(pattern);
    if (m) {
      const num = parseInt(m[1], 10);
      if (isFinite(num) && num > maxNum) maxNum = num;
    }
  });

  let next = maxNum + 1;
  let candidate = prefix + String(next).padStart(padLen, '0');
  while (used.has(candidate)) {
    next++;
    candidate = prefix + String(next).padStart(padLen, '0');
  }
  if (extraUsedSet) {
    extraUsedSet.add(candidate);
  }
  return candidate;
}

/**
 * Helper format tanggal WIB yyyy-MM-dd dari Date atau string
 */
function formatDateOnlyWIB(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Jakarta', 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
  }
  return s;
}

/**
 * Helper format waktu WIB HH:mm:ss dari Date atau string
 */
function formatTimeOnlyWIB(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Jakarta', 'HH:mm:ss');
  }
  const s = String(val).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'Asia/Jakarta', 'HH:mm:ss');
  }
  return s;
}

const CACHE_TTL_SECONDS = 120;
const CACHE_VERSION_KEY = 'mdta_cache_ver';
const SYNC_TS_KEY = 'LAST_SYNC_TS';
const STATIC_CACHE_KEYS = [
  'mdta_getDashboard',
  'mdta_getSantri',
  'mdta_getUsers',
  'mdta_loginUsers',
  'mdta_getDokumenArsip',
  'mdta_getNilaiRaport',
  'mdta_getLogSetoran_all',
  'mdta_getKelas'
];

let _lastBumpTs = 0;
let _requestSpreadsheet = null;
let _requestSheetData = {};
let _requestEnsured = {};

function resetRequestContext() {
  _requestSpreadsheet = null;
  _requestSheetData = {};
  _requestEnsured = {};
}

function getSpreadsheet() {
  if (!_requestSpreadsheet) {
    _requestSpreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return _requestSpreadsheet;
}

function getScriptCacheSafe() {
  try {
    if (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function') {
      return CacheService.getScriptCache();
    }
  } catch (err) {
    // Abaikan jika CacheService tidak tersedia
  }
  return null;
}

function getCacheVersion() {
  const cache = getScriptCacheSafe();
  if (!cache) return '1';
  try {
    return cache.get(CACHE_VERSION_KEY) || '1';
  } catch (err) {
    return '1';
  }
}

function cacheGetJson(key) {
  const cache = getScriptCacheSafe();
  if (!cache) return null;
  try {
    const raw = cache.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function cachePutJson(key, data, ttlSeconds) {
  const cache = getScriptCacheSafe();
  if (!cache) return;
  try {
    const str = JSON.stringify(data);
    if (str.length < 95000) {
      cache.put(key, str, ttlSeconds || CACHE_TTL_SECONDS);
    }
  } catch (err) {
    // Abaikan error ukuran atau kuota cache
  }
}

function cachedRead(cacheKey, loaderFn) {
  const cached = cacheGetJson(cacheKey);
  if (cached !== null) return cached;
  const fresh = loaderFn();
  cachePutJson(cacheKey, fresh, CACHE_TTL_SECONDS);
  return fresh;
}

function getSyncVersionValue() {
  const cache = getScriptCacheSafe();
  if (!cache) return '0';
  try {
    return String(cache.get(SYNC_TS_KEY) || '0');
  } catch (err) {
    return '0';
  }
}

function bumpSyncVersion() {
  _requestSheetData = {};
  const cache = getScriptCacheSafe();
  const prevStored = cache ? Number(getSyncVersionValue() || 0) : 0;
  const baseMs = Math.max(_lastBumpTs, isFinite(prevStored) ? prevStored : 0);
  const nowMs = Date.now();
  const nextMs = nowMs <= baseMs ? baseMs + 1 : nowMs;
  _lastBumpTs = nextMs;
  const ts = String(nextMs);

  if (!cache) return ts;
  try {
    if (typeof cache.removeAll === 'function') {
      cache.removeAll(STATIC_CACHE_KEYS);
    } else if (typeof cache.remove === 'function') {
      STATIC_CACHE_KEYS.forEach(k => cache.remove(k));
    }
    const nextVer = ts + '_' + String(Math.floor(Math.random() * 1000));
    cache.put(CACHE_VERSION_KEY, nextVer, 21600);
    cache.put(SYNC_TS_KEY, ts, 21600);
  } catch (err) {
    // Abaikan jika gagal memperbarui cache sinkronisasi
  }
  return ts;
}

function invalidateScriptCache() {
  return bumpSyncVersion();
}

function isSchemaCached(key) {
  const cache = getScriptCacheSafe();
  if (!cache) return false;
  try {
    return cache.get('mdta_schema_ok_v2_' + key) === '1';
  } catch (err) {
    return false;
  }
}

function markSchemaCached(key) {
  const cache = getScriptCacheSafe();
  if (!cache) return;
  try {
    cache.put('mdta_schema_ok_v2_' + key, '1', 21600);
  } catch (err) {
    // Abaikan jika CacheService tidak tersedia
  }
}

function buildRowArrayForHeaders(headers, valuesByHeader, existingRow) {
  return headers.map(h => {
    if (valuesByHeader && Object.prototype.hasOwnProperty.call(valuesByHeader, h) && valuesByHeader[h] !== undefined) {
      return valuesByHeader[h];
    }
    if (existingRow && Object.prototype.hasOwnProperty.call(existingRow, h) && existingRow[h] !== undefined) {
      return existingRow[h];
    }
    return '';
  });
}

function batchWriteRows(sheet, rowUpdates) {
  if (!sheet || !Array.isArray(rowUpdates) || rowUpdates.length === 0) return;
  const sorted = rowUpdates
    .filter(u => u && u.rowIndex >= 2 && Array.isArray(u.values) && u.values.length > 0)
    .slice()
    .sort((a, b) => a.rowIndex - b.rowIndex);
  if (sorted.length === 0) return;

  let runStart = sorted[0].rowIndex;
  let runWidth = sorted[0].values.length;
  let runValues = [sorted[0].values];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (item.rowIndex === runStart + runValues.length && item.values.length === runWidth) {
      runValues.push(item.values);
    } else {
      sheet.getRange(runStart, 1, runValues.length, runWidth).setValues(runValues);
      runStart = item.rowIndex;
      runWidth = item.values.length;
      runValues = [item.values];
    }
  }
  sheet.getRange(runStart, 1, runValues.length, runWidth).setValues(runValues);
}

function batchAppendRows(sheet, rowsMatrix) {
  if (!sheet || !Array.isArray(rowsMatrix) || rowsMatrix.length === 0) {
    return sheet ? sheet.getLastRow() : 0;
  }
  const width = rowsMatrix.reduce((mx, r) => Math.max(mx, Array.isArray(r) ? r.length : 0), 0);
  if (width <= 0) return sheet.getLastRow();
  const normalized = rowsMatrix.map(r => {
    const arr = Array.isArray(r) ? r.slice(0, width) : [];
    while (arr.length < width) arr.push('');
    return arr;
  });
  const startRow = Math.max(2, sheet.getLastRow() + 1);
  const endRow = startRow + normalized.length - 1;
  if (typeof sheet.getMaxRows === 'function' && typeof sheet.insertRowsAfter === 'function') {
    const maxR = sheet.getMaxRows();
    if (endRow > maxR) {
      sheet.insertRowsAfter(maxR, endRow - maxR);
    }
  }
  sheet.getRange(startRow, 1, normalized.length, width).setValues(normalized);
  return endRow;
}

function batchWriteColumnValues(sheet, colIdx, totalDataRows, updates, allValuesByRow) {
  if (!sheet || colIdx <= 0 || !Array.isArray(updates) || updates.length === 0) return;
  if (updates.length > 3 && Array.isArray(allValuesByRow) && totalDataRows > 0 && allValuesByRow.length === totalDataRows) {
    const matrix = allValuesByRow.map(v => [v !== undefined ? v : '']);
    sheet.getRange(2, colIdx, totalDataRows, 1).setValues(matrix);
    return;
  }
  const sorted = updates
    .filter(u => u && u.rowIndex >= 2)
    .slice()
    .sort((a, b) => a.rowIndex - b.rowIndex);
  if (sorted.length === 0) return;

  let runStart = sorted[0].rowIndex;
  let runVals = [[sorted[0].value !== undefined ? sorted[0].value : '']];
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (item.rowIndex === runStart + runVals.length) {
      runVals.push([item.value !== undefined ? item.value : '']);
    } else {
      sheet.getRange(runStart, colIdx, runVals.length, 1).setValues(runVals);
      runStart = item.rowIndex;
      runVals = [[item.value !== undefined ? item.value : '']];
    }
  }
  sheet.getRange(runStart, colIdx, runVals.length, 1).setValues(runVals);
}

function deleteSheetRowIndices(sheet, rowIndices) {
  if (!sheet || !Array.isArray(rowIndices) || rowIndices.length === 0) return;
  const uniqueAsc = Array.from(new Set(rowIndices.filter(idx => idx >= 2))).sort((a, b) => a - b);
  if (uniqueAsc.length === 0) return;

  const runs = [];
  let start = uniqueAsc[0];
  let len = 1;
  for (let i = 1; i < uniqueAsc.length; i++) {
    if (uniqueAsc[i] === start + len) {
      len++;
    } else {
      runs.push({ start, len });
      start = uniqueAsc[i];
      len = 1;
    }
  }
  runs.push({ start, len });

  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    if (typeof sheet.deleteRows === 'function') {
      sheet.deleteRows(run.start, run.len);
    } else {
      for (let r = run.start + run.len - 1; r >= run.start; r--) {
        sheet.deleteRow(r);
      }
    }
  }
}

/**
 * Helper Auto-Schema batch: memastikan daftar kolom ada di baris header dalam 1 batch write
 */
function ensureColumns(sheet, columnNames) {
  const cleanCols = [];
  const seen = new Set();
  (Array.isArray(columnNames) ? columnNames : [columnNames]).forEach(col => {
    const name = String(col || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleanCols.push(name);
    }
  });
  if (!sheet || cleanCols.length === 0) return [];

  const sheetName = typeof sheet.getName === 'function' ? sheet.getName() : '';
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.appendRow(cleanCols);
    sheet.getRange(1, 1, 1, cleanCols.length).setFontWeight('bold');
    if (sheetName) delete _requestSheetData[sheetName];
    return cleanCols;
  }

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const existingSet = new Set(headers.map(h => h.toLowerCase()));
  const missing = cleanCols.filter(col => !existingSet.has(col.toLowerCase()));

  if (missing.length > 0) {
    const startCol = headers.length + 1;
    const neededTotal = headers.length + missing.length;
    if (typeof sheet.getMaxColumns === 'function') {
      let maxCols = sheet.getMaxColumns();
      if (neededTotal > maxCols) {
        if (typeof sheet.insertColumnsAfter === 'function') {
          sheet.insertColumnsAfter(maxCols, neededTotal - maxCols);
        } else if (typeof sheet.insertColumnAfter === 'function') {
          while (sheet.getMaxColumns() < neededTotal) {
            sheet.insertColumnAfter(sheet.getMaxColumns());
          }
        }
      }
    }
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]).setFontWeight('bold');
    if (sheetName) delete _requestSheetData[sheetName];
    return headers.concat(missing);
  }
  return headers;
}

/**
 * Helper Auto-Schema: memastikan kolom tertentu ada di baris header suatu sheet
 */
function ensureColumn(sheet, columnName) {
  const targetName = String(columnName || '').trim();
  if (!sheet || !targetName) return -1;
  const headers = ensureColumns(sheet, [targetName]);
  const idx = headers.findIndex(h => h.toLowerCase() === targetName.toLowerCase());
  return idx >= 0 ? idx + 1 : -1;
}

/**
 * Helper Auto-Schema: memastikan sheet beserta kolom header-nya ada
 */
function ensureSheet(sheetName, headers) {
  const flagKey = 'sheet_' + sheetName;
  if (_requestEnsured[flagKey]) return _requestEnsured[flagKey];
  const ss = getSpreadsheet();
  const hdrs = Array.isArray(headers) ? headers.slice() : [];
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (hdrs.length > 0) {
      sheet.appendRow(hdrs);
      sheet.getRange(1, 1, 1, hdrs.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
      markSchemaCached(flagKey);
    }
    delete _requestSheetData[sheetName];
    _requestEnsured[flagKey] = sheet;
    return sheet;
  }

  if (sheet.getLastRow() === 0 && hdrs.length > 0) {
    sheet.appendRow(hdrs);
    sheet.getRange(1, 1, 1, hdrs.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    markSchemaCached(flagKey);
    delete _requestSheetData[sheetName];
    _requestEnsured[flagKey] = sheet;
    return sheet;
  }

  if (hdrs.length > 0 && !isSchemaCached(flagKey)) {
    ensureColumns(sheet, hdrs);
    if (sheet.getLastRow() > 0) {
      markSchemaCached(flagKey);
    }
  }
  _requestEnsured[flagKey] = sheet;
  return sheet;
}

function normalizeKelasName(val) {
  return String(val || '').trim().toLowerCase();
}

function parseKelasAmpu(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[;,]/);
  const seen = new Set();
  const out = [];
  list.forEach(item => {
    const clean = String(item || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  });
  return out;
}

function formatKelasAmpu(raw) {
  return parseKelasAmpu(raw).join(', ');
}

function isKelasAllowed(kelasVal, allowedList) {
  const targets = parseKelasAmpu(kelasVal).map(k => normalizeKelasName(k)).filter(Boolean);
  if (targets.length === 0 || !Array.isArray(allowedList) || allowedList.length === 0) return false;
  return allowedList.some(k => targets.indexOf(normalizeKelasName(k)) >= 0);
}

function normalizeKategoriProgram(raw, fallbackKelasName) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'tahfidz' || s === 'tahfiz') return 'Tahfidz';
  if (s === 'tarikh') return 'Tarikh';
  if (s === 'wustho' || s === 'wusto') return 'Wustho';
  if (s === 'diniyyah' || s === 'diniyah') return 'Diniyyah';
  const k = String(fallbackKelasName || '').trim().toLowerCase();
  if (/tahfi[dz]/i.test(k)) return 'Tahfidz';
  if (/tarikh/i.test(k)) return 'Tarikh';
  if (/wusth?o/i.test(k)) return 'Wustho';
  return 'Diniyyah';
}

function getKelasKategoriMap() {
  ensureKelasSheet();
  const map = {};
  getSheetData('Kelas').forEach(k => {
    const key = normalizeKelasName(k.nama_kelas);
    if (key) {
      map[key] = normalizeKategoriProgram(k.kategori_program, k.nama_kelas);
    }
  });
  return map;
}

function resolveKelasKategoriProgram(kelasName, explicitKategori) {
  const cleanExplicit = String(explicitKategori || '').trim();
  if (cleanExplicit) return normalizeKategoriProgram(cleanExplicit, kelasName);
  const kMap = getKelasKategoriMap();
  const key = normalizeKelasName(kelasName);
  if (key && kMap[key]) return kMap[key];
  return normalizeKategoriProgram('', kelasName);
}

function ensureSheetProgramColumn(sheetName) {
  const flagKey = 'prog_' + sheetName;
  if (_requestEnsured[flagKey]) return _requestEnsured[flagKey];
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    if (!(sheet.getLastRow() > 0 && isSchemaCached(flagKey))) {
      ensureColumns(sheet, ['kategori_program']);
      if (sheet.getLastRow() > 0) markSchemaCached(flagKey);
    }
  }
  _requestEnsured[flagKey] = sheet || true;
  return sheet;
}

const KELAS_DAY_ORDER = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function defaultHariMengajarForProgram(kategoriProgram) {
  const kat = normalizeKategoriProgram(kategoriProgram, '');
  return kat === 'Wustho' ? 'Sen,Sel,Rab,Kam,Jum,Sab,Min' : 'Sen,Sel,Rab,Kam,Jum';
}

function padTwoDigits(n) {
  const num = Number(n);
  return (num < 10 ? '0' : '') + String(num);
}

function normalizeTimeHHMM(val) {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date) {
    const hms = Utilities.formatDate(val, 'Asia/Jakarta', 'HH:mm:ss');
    return String(hms || '').slice(0, 5);
  }
  const s = String(val).trim();
  if (!s) return '';
  const directMatch = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
  if (directMatch) {
    const hh = parseInt(directMatch[1], 10);
    const mm = parseInt(directMatch[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return padTwoDigits(hh) + ':' + padTwoDigits(mm);
    }
    return '';
  }
  const isoParsed = new Date(s);
  if (!isNaN(isoParsed.getTime())) {
    const hms = Utilities.formatDate(isoParsed, 'Asia/Jakarta', 'HH:mm:ss');
    return String(hms || '').slice(0, 5);
  }
  return '';
}

function parseLegacyJadwalRange(rawJadwal) {
  const raw = String(rawJadwal || '').trim();
  if (!raw) return { jam_mulai: '', jam_selesai: '' };
  const matches = raw.match(/\d{1,2}[:.]\d{2}/g) || [];
  const start = matches[0] ? normalizeTimeHHMM(matches[0]) : '';
  const end = matches[1] ? normalizeTimeHHMM(matches[1]) : '';
  return { jam_mulai: start, jam_selesai: end };
}

function mapSingleHariToken(tok) {
  const clean = String(tok || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return '';
  if (clean.indexOf('sen') === 0) return 'Sen';
  if (clean.indexOf('sel') === 0) return 'Sel';
  if (clean.indexOf('rab') === 0) return 'Rab';
  if (clean.indexOf('kam') === 0) return 'Kam';
  if (clean.indexOf('jum') === 0) return 'Jum';
  if (clean.indexOf('sab') === 0) return 'Sab';
  if (clean.indexOf('min') === 0 || clean.indexOf('ahad') === 0) return 'Min';
  return '';
}

function normalizeHariMengajar(raw, kategoriProgram, allowEmpty) {
  const picked = {};
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[,;|]+/);

  list.forEach(item => {
    const part = String(item || '').trim();
    if (!part) return;
    const rangeParts = part.split(/\s*(?:-|s\/d|sd|hingga)\s*/i);
    if (rangeParts.length === 2) {
      const d1 = mapSingleHariToken(rangeParts[0]);
      const d2 = mapSingleHariToken(rangeParts[1]);
      const i1 = KELAS_DAY_ORDER.indexOf(d1);
      const i2 = KELAS_DAY_ORDER.indexOf(d2);
      if (i1 >= 0 && i2 >= i1) {
        for (let idx = i1; idx <= i2; idx++) {
          picked[KELAS_DAY_ORDER[idx]] = true;
        }
        return;
      }
    }
    part.split(/\s+/).forEach(word => {
      const mapped = mapSingleHariToken(word);
      if (mapped) picked[mapped] = true;
    });
  });

  const ordered = KELAS_DAY_ORDER.filter(d => Boolean(picked[d]));
  if (ordered.length === 0) {
    return allowEmpty ? '' : defaultHariMengajarForProgram(kategoriProgram);
  }
  return ordered.join(',');
}

function normalizeOverrideStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'libur') return 'Libur';
  if (s === 'ubah jam' || s === 'ubah_jam' || s === 'ganti jam') return 'Ubah Jam';
  return 'Normal';
}

function ensureAbsensiGuruSheet() {
  if (_requestEnsured.absensi_guru) return _requestEnsured.absensi_guru;
  const sheet = ensureSheet('Absensi_Guru', ABSENSI_GURU_HEADERS);
  _requestEnsured.absensi_guru = sheet;
  return sheet;
}

/**
 * Memastikan sheet Users memiliki kolom kelas_ampu dan profil guru
 */
function ensureUsersSchema() {
  if (_requestEnsured.users) return _requestEnsured.users;
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (sheet) {
    if (!(sheet.getLastRow() > 0 && isSchemaCached('users'))) {
      ensureColumns(sheet, ['kelas_ampu'].concat(USER_PROFILE_COLUMNS));
      if (sheet.getLastRow() > 0) markSchemaCached('users');
    }
  }
  _requestEnsured.users = sheet || true;
  return sheet;
}

/**
 * Memastikan sheet Santri memiliki kolom nis, nik, tempat_lahir, tanggal_lahir, dan nama_ayah_kandung
 */
function ensureSantriSchema() {
  if (_requestEnsured.santri) return _requestEnsured.santri;
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Santri');
  if (sheet) {
    if (!(sheet.getLastRow() > 0 && isSchemaCached('santri'))) {
      ensureColumns(sheet, SANTRI_EXTRA_COLUMNS);
      if (sheet.getLastRow() > 0) markSchemaCached('santri');
    }
  }
  _requestEnsured.santri = sheet || true;
  return sheet;
}

/**
 * Memastikan sheet Kelas tersedia dan melakukan sinkronisasi awal dari Santri/Users jika baru dibuat
 */
function ensureKelasSheet() {
  if (_requestEnsured.kelas) return _requestEnsured.kelas;
  const ss = getSpreadsheet();
  const existing = ss.getSheetByName('Kelas');
  const hadData = Boolean(existing && existing.getLastRow() > 1);
  if (hadData && isSchemaCached('kelas')) {
    _requestEnsured.kelas = existing;
    return existing;
  }
  const sheet = ensureSheet('Kelas', KELAS_HEADERS);
  if (!isSchemaCached('kelas_schedule')) {
    KELAS_SCHEDULE_COLUMNS.forEach(col => ensureColumn(sheet, col));
    markSchemaCached('kelas_schedule');
  }

  if (!hadData) {
    const uniqueMap = {};
    const santriSheet = ss.getSheetByName('Santri');
    if (santriSheet) {
      getSheetData('Santri').forEach(s => {
        const clean = String(s.kelas || '').trim();
        if (clean && !uniqueMap[clean.toLowerCase()]) {
          uniqueMap[clean.toLowerCase()] = clean;
        }
      });
    }
    const usersSheet = ss.getSheetByName('Users');
    if (usersSheet) {
      getSheetData('Users').forEach(u => {
        parseKelasAmpu(u.kelas_ampu).forEach(k => {
          if (k && !uniqueMap[k.toLowerCase()]) {
            uniqueMap[k.toLowerCase()] = k;
          }
        });
      });
    }

    const now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
    const sortedNames = Object.keys(uniqueMap).map(k => uniqueMap[k]).sort();
    const seedRows = sortedNames.map((namaKelas, idx) => {
      const katProg = normalizeKategoriProgram('', namaKelas);
      const rowObj = {
        id_kelas: 'KLS-' + String(idx + 1).padStart(3, '0'),
        nama_kelas: namaKelas,
        kategori_program: katProg,
        tingkat: '',
        keterangan: 'Sinkron otomatis dari data santri',
        status: 'aktif',
        created_at: now,
        hari_mengajar: defaultHariMengajarForProgram(katProg),
        jam_mulai: '',
        jam_selesai: '',
        override_tanggal: '',
        override_status: 'Normal',
        override_jam_mulai: '',
        override_jam_selesai: '',
        override_catatan: ''
      };
      return KELAS_HEADERS.map(h => rowObj[h] !== undefined ? rowObj[h] : '');
    });
    if (seedRows.length > 0) {
      batchAppendRows(sheet, seedRows);
    }
    delete _requestSheetData['Kelas'];
  }
  if (sheet && sheet.getLastRow() > 1) {
    markSchemaCached('kelas');
  }

  _requestEnsured.kelas = sheet;
  return sheet;
}

/**
 * Memastikan sheet Log_Setoran tersedia beserta header kolomnya
 */
function ensureLogSetoranSheet() {
  if (_requestEnsured.logSetoran) return _requestEnsured.logSetoran;
  const sheet = ensureSheet('Log_Setoran', LOG_SETORAN_HEADERS);
  _requestEnsured.logSetoran = sheet;
  return sheet;
}

function resolveGuruScope(ctx) {
  const c = ctx || {};
  const role = String(c.role || '').trim().toLowerCase();
  const idUser = String(c.id_user || c.id_guru || c.id_guru_piket || '').trim();
  const username = String(c.username || '').trim();

  if (!idUser && !username && role !== 'guru') {
    return { isGuru: false, user: null, id_user: '', username: '', kelas_ampu: [] };
  }

  const users = cachedRead('mdta_getUsers', () => handleGetUsers());
  let found = null;
  if (idUser) {
    found = users.find(u => String(u.id_user || '').trim() === idUser);
  }
  if (!found && username) {
    found = users.find(u => String(u.username || '').trim().toLowerCase() === username.toLowerCase());
  }

  if (found) {
    const foundRole = String(found.role || '').trim().toLowerCase();
    if (foundRole === 'admin') {
      return {
        isGuru: false,
        user: found,
        id_user: String(found.id_user || ''),
        username: String(found.username || ''),
        kelas_ampu: []
      };
    }
    return {
      isGuru: true,
      user: found,
      id_user: String(found.id_user || ''),
      username: String(found.username || ''),
      kelas_ampu: parseKelasAmpu(found.kelas_ampu)
    };
  }

  if (role === 'guru') {
    return {
      isGuru: true,
      user: null,
      id_user: idUser,
      username: username,
      kelas_ampu: parseKelasAmpu(c.kelas_ampu)
    };
  }

  return { isGuru: false, user: null, id_user: '', username: '', kelas_ampu: [] };
}

function filterRowsByGuruScope(rows, scope, kelasField) {
  const list = Array.isArray(rows) ? rows : [];
  if (!scope || !scope.isGuru) return list;
  if (!Array.isArray(scope.kelas_ampu) || scope.kelas_ampu.length === 0) return [];
  const field = kelasField || 'kelas';
  return list.filter(item => isKelasAllowed(item && item[field], scope.kelas_ampu));
}

function attachScopeContext(dataObj, rootPayload) {
  if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) return dataObj;
  const p = rootPayload || {};
  const merged = Object.assign({}, dataObj);
  if (!merged.role && p.role) merged.role = p.role;
  if (!merged.id_user && p.id_user) merged.id_user = p.id_user;
  if (!merged.username && p.username) merged.username = p.username;
  return merged;
}

/**
 * Helper untuk membaca seluruh baris sheet menjadi array of objects (dengan memoization per request)
 */
function getSheetData(sheetName, forceFresh) {
  if (!forceFresh && Object.prototype.hasOwnProperty.call(_requestSheetData, sheetName)) {
    return _requestSheetData[sheetName];
  }
  const ss = getSpreadsheet();
  if (sheetName === 'Users') ensureUsersSchema();
  if (sheetName === 'Santri') ensureSantriSchema();
  if (sheetName === 'Kelas') ensureKelasSheet();
  if (sheetName === 'Log_Setoran') ensureLogSetoranSheet();

  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + sheetName);
  const values = sheet.getDataRange().getValues();
  const mapped = values.length <= 1
    ? []
    : (function () {
        const headers = values[0].map(h => String(h).trim());
        return values.slice(1).map((row, idx) => {
          const obj = { _rowIndex: idx + 2 };
          headers.forEach((h, colIdx) => {
            obj[h] = row[colIdx];
          });
          return obj;
        });
      })();
  _requestSheetData[sheetName] = mapped;
  return mapped;
}

/**
 * Helper untuk mendapatkan header dan sheet object
 */
function getSheetAndHeaders(sheetName) {
  const ss = getSpreadsheet();
  if (sheetName === 'Users') ensureUsersSchema();
  if (sheetName === 'Santri') ensureSantriSchema();
  if (sheetName === 'Kelas') ensureKelasSheet();
  if (sheetName === 'Log_Setoran') ensureLogSetoranSheet();

  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + sheetName);
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  return { sheet, headers };
}

/**
 * Endpoint GET untuk pembacaan data cepat, pengecekan API, cache 120s, & bootstrap 1-request
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action ? params.action : 'ping';

    if (action === 'ping') {
      return jsonResponse(true, { status: 'online' }, 'API Sistem MDTA aktif.');
    }
    if (action === 'getSyncVersion') {
      const ts = getSyncVersionValue();
      return jsonResponse(true, { ts: ts, last_sync_ts: ts }, 'OK');
    }

    const ver = getCacheVersion();
    const scope = resolveGuruScope(params);
    const guruCacheSuffix = scope.isGuru
      ? '_g_' + (scope.id_user || scope.username || 'anon') + '_' + scope.kelas_ampu.join('|')
      : '';

    switch (action) {
      case 'getDashboard':
        return jsonResponse(true, cachedRead('mdta_getDashboard', () => handleGetDashboard()));
      case 'getUsers':
        return jsonResponse(true, cachedRead('mdta_getUsers', () => handleGetUsers()));
      case 'getKelas': {
        const klsCacheKey = scope.isGuru ? ('mdta_kelas_v' + ver + guruCacheSuffix) : 'mdta_getKelas';
        return jsonResponse(true, cachedRead(klsCacheKey, () => handleGetKelas(scope)));
      }
      case 'getSantri': {
        const sCacheKey = scope.isGuru ? ('mdta_santri_v' + ver + guruCacheSuffix) : 'mdta_getSantri';
        return jsonResponse(true, cachedRead(sCacheKey, () => handleGetSantri(scope)));
      }
      case 'getPresensi':
        return jsonResponse(true, filterRowsByGuruScope(getSheetData('Presensi'), scope, 'kelas'));
      case 'getRekapLaporan': {
        const rkKey = 'mdta_rekap_v' + ver + '_' + String(params.bulan || '') + '_' + String(params.tahun || '') +
          '_' + String(params.kategori_program || '').trim().toLowerCase() +
          '_' + String(params.semester || '').trim().toLowerCase() +
          '_' + String(params.tahun_ajaran || '').trim() + guruCacheSuffix;
        return jsonResponse(true, cachedRead(rkKey, () => handleGetRekapLaporan(params.bulan, params.tahun, scope, params)));
      }
      case 'getMonitoringGuru': {
        const monTgl = params.tanggal ? formatDateOnlyWIB(params.tanggal) : '';
        const monKey = 'mdta_monGuru_v' + ver + '_' + monTgl + '_' + String(params.bulan || '') +
          '_' + String(params.tahun || '') + '_' + String(params.id_guru || '').trim() + guruCacheSuffix;
        return jsonResponse(true, cachedRead(monKey, () => handleGetMonitoringGuru(params, scope)));
      }
      case 'getNilaiUAS': {
        const uasCacheKey = 'mdta_uas_v' + ver + guruCacheSuffix;
        return jsonResponse(true, cachedRead(uasCacheKey, () => filterRowsByGuruScope(getSheetData('Nilai_UAS'), scope, 'kelas')));
      }
      case 'getNilaiRaport': {
        const rptCacheKey = scope.isGuru ? ('mdta_nilaiRaport_v' + ver + guruCacheSuffix) : 'mdta_getNilaiRaport';
        return jsonResponse(true, cachedRead(rptCacheKey, () => handleGetNilaiRaport(scope)));
      }
      case 'getDokumenArsip':
        return jsonResponse(true, cachedRead('mdta_getDokumenArsip', () => getSheetData('Dokumen_Arsip')));
      case 'getLogSetoran': {
        const hasFilters = params.tanggal || params.jenis_laporan || params.id_guru || params.kelas;
        const rawLogs = hasFilters
          ? handleGetLogSetoran(params)
          : cachedRead('mdta_getLogSetoran_all', () => handleGetLogSetoran({}));
        const filteredLogs = scope.isGuru
          ? rawLogs.filter(l => isKelasAllowed(l.kelas, scope.kelas_ampu))
          : rawLogs;
        return jsonResponse(true, filteredLogs);
      }
      case 'getRekapKepsek': {
        const tglKey = formatDateOnlyWIB(params.tanggal) || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
        const klsKey = String(params.kelas || '').trim().toLowerCase();
        const cacheKey = 'mdta_rekapKepsek_v' + ver + '_' + tglKey + '_' + klsKey;
        return jsonResponse(true, cachedRead(cacheKey, () => handleGetRekapKepsek(params.tanggal, params.kelas)));
      }
      case 'getBootstrapData': {
        const roleKey = scope.isGuru ? 'guru' : String(params.role || 'admin').trim().toLowerCase();
        const tglKey = formatDateOnlyWIB(params.tanggal) || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
        const klsKey = String(params.kelas || '').trim().toLowerCase();
        const cacheKey = 'mdta_bootstrap_v' + ver + '_' + roleKey + '_' + tglKey + '_' + klsKey + guruCacheSuffix;
        return jsonResponse(true, cachedRead(cacheKey, () => handleGetBootstrapData(params, scope)));
      }
      default:
        return jsonResponse(false, null, 'Action GET tidak dikenali: ' + action);
    }
  } catch (err) {
    return jsonResponse(false, null, err.message);
  } finally {
    resetRequestContext();
  }
}

/**
 * Endpoint POST untuk login, mutasi data (CRUD), upload Drive, Impor AI, & Setoran Guru
 * Menggunakan text/plain JSON body agar bebas dari masalah CORS preflight
 */
function doPost(e) {
  let lock = null;
  let lockAcquired = false;
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = payload.action;

    if (action === 'login') {
      return jsonResponse(true, handleLogin(payload));
    }

    lock = LockService.getScriptLock();
    lock.waitLock(15000);
    lockAcquired = true;

    const rootScope = {
      role: payload.role,
      id_user: payload.id_user || payload.id_guru || payload.id_guru_piket,
      username: payload.username
    };

    switch (action) {
      case 'saveUser': {
        const res = handleSaveUser(payload.data);
        return jsonResponse(true, res, 'Data pengguna tersimpan.');
      }
      case 'deleteUser': {
        const res = handleDeleteById('Users', 'id_user', payload.id_user);
        const ts = invalidateScriptCache();
        if (res && typeof res === 'object') res.sync_ts = ts;
        return jsonResponse(true, res, 'Pengguna dihapus.');
      }
      case 'saveKelas': {
        const res = handleSaveKelas(payload.data);
        return jsonResponse(true, res, 'Data kelas tersimpan.');
      }
      case 'deleteKelas': {
        const res = handleDeleteKelas(payload);
        const ts = invalidateScriptCache();
        if (res && typeof res === 'object') res.sync_ts = ts;
        return jsonResponse(true, res, 'Kelas berhasil dihapus.');
      }
      case 'saveKelasMapping': {
        const res = handleSaveKelasMapping(payload.data);
        const ts = invalidateScriptCache();
        if (res && typeof res === 'object') res.sync_ts = ts;
        return jsonResponse(true, res, 'Pemetaan guru kelas berhasil disimpan.');
      }
      case 'saveKelasSantri': {
        const res = handleSaveKelasSantri(payload.data);
        return jsonResponse(true, res, 'Anggota santri kelas berhasil disimpan.');
      }
      case 'bulkMoveSantriKelas': {
        const res = handleBulkMoveSantriKelas(payload.data);
        const ts = invalidateScriptCache();
        if (res && typeof res === 'object') res.sync_ts = ts;
        return jsonResponse(true, res, 'Kelas santri berhasil diperbarui.');
      }
      case 'saveSantri': {
        const res = handleSaveSantri(payload.data);
        return jsonResponse(true, res, 'Data santri tersimpan.');
      }
      case 'deleteSantri': {
        const res = handleDeleteById('Santri', 'id_santri', payload.id_santri);
        const ts = invalidateScriptCache();
        if (res && typeof res === 'object') res.sync_ts = ts;
        return jsonResponse(true, res, 'Data santri dihapus.');
      }
      case 'savePresensi': {
        const res = handleSavePresensi(payload.data, rootScope);
        return jsonResponse(true, res, Array.isArray(payload.data) ? 'Presensi kelas berhasil disimpan.' : 'Presensi berhasil dicatat.');
      }
      case 'clearPresensiHarian': {
        const res = handleClearPresensiHarian(payload, rootScope);
        return jsonResponse(true, res, 'Log presensi harian berhasil dibersihkan.');
      }
      case 'saveNilaiUAS': {
        const res = handleSaveNilaiUAS(payload.data, rootScope);
        return jsonResponse(
          true,
          res,
          Array.isArray(payload.data)
            ? 'Semua nilai UAS berhasil disimpan.'
            : (res && res.updated ? 'Nilai UAS diperbarui.' : 'Nilai UAS tersimpan.')
        );
      }
      case 'deleteNilaiUAS': {
        const res = handleDeleteNilaiUAS(payload, rootScope);
        return jsonResponse(true, res, 'Nilai UAS berhasil dihapus.');
      }
      case 'saveNilaiRaport': {
        const res = handleSaveNilaiRaport(payload.data, rootScope);
        return jsonResponse(true, res, 'Nilai raport tersimpan.');
      }
      case 'uploadDokumenDrive': {
        const res = handleUploadDokumenDrive(payload.data);
        const ts = invalidateScriptCache();
        if (res && typeof res === 'object') res.sync_ts = ts;
        return jsonResponse(true, res, 'Dokumen berhasil diunggah ke Drive.');
      }
      case 'importNilaiAI': {
        const res = handleImportNilaiAI(payload.data);
        invalidateScriptCache();
        return jsonResponse(true, res, 'Analisis AI selesai.');
      }
      case 'submitLaporanGuru': {
        const res = handleSubmitLaporanGuru(attachScopeContext(payload.data, rootScope));
        return jsonResponse(true, res, 'Laporan guru berhasil dikirim ke Kepala Madrasah.');
      }
      case 'updateProfilGuru': {
        const res = handleUpdateProfilGuru(payload.data || payload, rootScope);
        return jsonResponse(true, res, 'Profil guru berhasil diperbarui.');
      }
      case 'saveAbsensiGuru': {
        const res = handleSaveAbsensiGuru(payload.data || payload, rootScope);
        return jsonResponse(true, res, 'Absensi dan laporan materi harian guru tersimpan.');
      }
      case 'verifikasiAbsensiGuru': {
        const res = handleVerifikasiAbsensiGuru(payload.data || payload, rootScope);
        return jsonResponse(true, res, 'Status pengecekan guru diperbarui.');
      }
      default:
        return jsonResponse(false, null, 'Action POST tidak dikenali: ' + action);
    }
  } catch (err) {
    return jsonResponse(false, null, err.message);
  } finally {
    resetRequestContext();
    if (lockAcquired && lock) lock.releaseLock();
  }
}

/* ============================================================================
 * HANDLER MODUL
 * ============================================================================ */

function handleLogin(payload) {
  const { username, password } = payload;
  if (!username || !password) throw new Error('Username dan kata sandi wajib diisi.');

  const users = cachedRead('mdta_loginUsers', () => {
    ensureUsersSchema();
    return getSheetData('Users');
  });
  const found = users.find(u =>
    String(u.username).trim() === String(username).trim() &&
    String(u.password) === String(password)
  );

  if (!found) throw new Error('Username atau kata sandi salah.');
  if (String(found.status_aktif).toLowerCase() !== 'aktif') {
    throw new Error('Akun Anda sedang nonaktif. Hubungi Administrator.');
  }

  const token = Utilities.base64EncodeWebSafe(found.id_user + ':' + Date.now());
  return {
    token: token,
    user: {
      id_user: found.id_user,
      username: found.username,
      nama_lengkap: found.nama_lengkap,
      role: found.role,
      kelas_ampu: parseKelasAmpu(found.kelas_ampu),
      no_wa: String(found.no_wa || ''),
      alamat: String(found.alamat || ''),
      pendidikan_terakhir: String(found.pendidikan_terakhir || ''),
      bidang_ajar: String(found.bidang_ajar || ''),
      bio: String(found.bio || ''),
      foto_url: String(found.foto_url || '')
    }
  };
}

function handleGetUsers() {
  ensureUsersSchema();
  return getSheetData('Users').map(u => {
    const kelasAmpu = parseKelasAmpu(u.kelas_ampu);
    return {
      id_user: u.id_user,
      username: u.username,
      nama_lengkap: u.nama_lengkap,
      role: u.role,
      status_aktif: u.status_aktif,
      kelas_ampu: kelasAmpu,
      kelas_ampu_text: kelasAmpu.join(', '),
      no_wa: String(u.no_wa || ''),
      alamat: String(u.alamat || ''),
      pendidikan_terakhir: String(u.pendidikan_terakhir || ''),
      bidang_ajar: String(u.bidang_ajar || ''),
      bio: String(u.bio || ''),
      foto_url: String(u.foto_url || ''),
      created_at: u.created_at
    };
  });
}

function handleGetNilaiRaport(scope) {
  const rows = filterRowsByGuruScope(getSheetData('Nilai_Raport'), scope, 'kelas')
    .filter(r => {
      const nama = String(r.nama_santri || '').trim();
      return Boolean(nama && nama !== '-');
    });
  return rows.map(r => {
    const resolved = resolveRaportRowValues(r);
    return {
      id_raport: String(r.id_raport || ''),
      id_santri: String(r.id_santri || ''),
      nama_santri: String(r.nama_santri || ''),
      kelas: String(r.kelas || ''),
      periode: String(r.periode || 'Ganjil 2026/2027'),
      n_harian: resolved.n_harian,
      n_uas: resolved.n_uas,
      n_kehadiran: resolved.n_kehadiran,
      bobot_harian: resolved.bobot_harian,
      bobot_uas: resolved.bobot_uas,
      bobot_kehadiran: resolved.bobot_kehadiran,
      n_akhir: resolved.n_akhir,
      grade: resolved.grade,
      keterangan: resolved.keterangan,
      updated_at: formatDateOnlyWIB(r.updated_at)
    };
  });
}

function handleGetDashboard() {
  const presensi = getSheetData('Presensi');
  const users = handleGetUsers();
  const santri = getSheetData('Santri');
  const todayWib = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');

  const summary = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0 };
  presensi.forEach(p => {
    if (formatDateOnlyWIB(p.tanggal) !== todayWib) return;
    if (Object.prototype.hasOwnProperty.call(summary, p.status)) summary[p.status]++;
  });

  const recentPresensi = presensi
    .slice()
    .reverse()
    .slice(0, 50)
    .map(p => Object.assign({}, p, {
      tanggal: formatDateOnlyWIB(p.tanggal),
      waktu: formatTimeOnlyWIB(p.waktu)
    }));
  return {
    tanggal: todayWib,
    summary: summary,
    total_santri: santri.length,
    total_presensi: presensi.length,
    riwayat_presensi: recentPresensi,
    daftar_pengguna: users
  };
}

function handleSaveUser(data) {
  ensureUsersSchema();
  const { sheet, headers } = getSheetAndHeaders('Users');
  const rows = getSheetData('Users');
  const now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const username = String((data && data.username) || '').trim();
  const namaLengkap = String((data && data.nama_lengkap) || '').trim();

  if (!username || !namaLengkap) {
    throw new Error('Nama lengkap dan username wajib diisi.');
  }

  const isEdit = Boolean(data && data.isEdit === true);
  const targetId = String((data && data.id_user) || '').trim();

  if (isEdit) {
    if (!targetId) {
      throw new Error('ID pengguna tidak valid untuk mode edit.');
    }
    let existing = rows.find(r => String(r.id_user || '').trim() === targetId);
    if (!existing) {
      const origUser = String((data && data.original_username) || targetId).trim().toLowerCase();
      existing = rows.find(
        r => String(r.id_user || '').trim() === '' && String(r.username || '').trim().toLowerCase() === origUser
      );
    }
    if (!existing) {
      throw new Error('Data pengguna yang akan diubah tidak ditemukan.');
    }

    const dupUsername = rows.some(
      r => r._rowIndex !== existing._rowIndex && String(r.username || '').trim().toLowerCase() === username.toLowerCase()
    );
    if (dupUsername) {
      throw new Error('Username "' + username + '" sudah dipakai oleh akun lain.');
    }

    const nextRole = String((data && data.role) || existing.role || 'guru').trim().toLowerCase();
    const rawKelasAmpu = data && data.kelas_ampu !== undefined ? data.kelas_ampu : existing.kelas_ampu;
    const kelasAmpuStr = nextRole === 'admin' ? '' : formatKelasAmpu(rawKelasAmpu);
    const finalId = String(existing.id_user || '').trim() || generateUniqueSequentialId(rows, 'id_user', 'USR-', 3);

    const updated = headers.map(h => {
      if (h === 'id_user') return finalId;
      if (h === 'username') return username;
      if (h === 'nama_lengkap') return namaLengkap;
      if (h === 'role') return nextRole;
      if (h === 'kelas_ampu') return kelasAmpuStr;
      if (h === 'password') return data.password ? String(data.password) : existing.password;
      if (h === 'created_at') return existing.created_at || now;
      return data[h] !== undefined ? data[h] : existing[h];
    });
    const statusAktif = (data && data.status_aktif) ? String(data.status_aktif).trim() : String(existing.status_aktif || 'aktif');
    sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([updated]);
    delete _requestSheetData['Users'];
    const syncTs = bumpSyncVersion();
    return {
      id_user: finalId,
      username: username,
      nama_lengkap: namaLengkap,
      role: nextRole,
      status_aktif: statusAktif,
      kelas_ampu: parseKelasAmpu(kelasAmpuStr),
      created_at: existing.created_at || now,
      updated: true,
      sync_ts: syncTs
    };
  }

  const dupNewUsername = rows.some(
    r => String(r.username || '').trim().toLowerCase() === username.toLowerCase()
  );
  if (dupNewUsername) {
    throw new Error('Username "' + username + '" sudah digunakan oleh akun lain. Gunakan username berbeda.');
  }

  const nextRole = (data && data.role) ? String(data.role).trim().toLowerCase() : 'guru';
  const statusAktifNew = (data && data.status_aktif) ? String(data.status_aktif).trim() : 'aktif';
  const kelasAmpuStr = nextRole === 'admin' ? '' : formatKelasAmpu(data && data.kelas_ampu);
  const newId = generateUniqueSequentialId(rows, 'id_user', 'USR-', 3);
  const newRowValues = {
    id_user: newId,
    username: username,
    password: (data && data.password) ? String(data.password) : '123456',
    nama_lengkap: namaLengkap,
    role: nextRole,
    status_aktif: statusAktifNew,
    kelas_ampu: kelasAmpuStr,
    created_at: now
  };
  sheet.appendRow(headers.map(h => newRowValues[h] !== undefined ? newRowValues[h] : ''));
  delete _requestSheetData['Users'];
  const syncTs = bumpSyncVersion();
  return {
    id_user: newId,
    username: username,
    nama_lengkap: namaLengkap,
    role: nextRole,
    status_aktif: statusAktifNew,
    kelas_ampu: parseKelasAmpu(kelasAmpuStr),
    created_at: now,
    created: true,
    sync_ts: syncTs
  };
}

/* ============================================================================
 * PEMETAAN & PENGELOLAAN KELAS TERPUSAT (Kelas, Users.kelas_ampu, Santri)
 * ============================================================================ */

function handleGetKelas(scope) {
  ensureKelasSheet();
  const list = getSheetData('Kelas')
    .map(k => {
      const nama = String(k.nama_kelas || '').trim();
      const katProg = normalizeKategoriProgram(k.kategori_program, nama);
      const legacy = parseLegacyJadwalRange(k.jadwal || k.jadwal_kelas || '');
      const jamMulai = normalizeTimeHHMM(k.jam_mulai) || legacy.jam_mulai;
      const jamSelesai = normalizeTimeHHMM(k.jam_selesai) || legacy.jam_selesai;
      const hariMengajar = normalizeHariMengajar(k.hari_mengajar, katProg, false);
      const overrideStatus = normalizeOverrideStatus(k.override_status);
      const overrideTanggal = formatDateOnlyWIB(k.override_tanggal);
      const overrideJamMulai = overrideStatus === 'Ubah Jam' ? normalizeTimeHHMM(k.override_jam_mulai) : '';
      const overrideJamSelesai = overrideStatus === 'Ubah Jam' ? normalizeTimeHHMM(k.override_jam_selesai) : '';
      const overrideCatatan = String(k.override_catatan || '').trim();
      const jadwalDisplay = String(k.jadwal || '').trim() || (jamMulai && jamSelesai ? (jamMulai + '-' + jamSelesai) : '');

      return {
        id_kelas: String(k.id_kelas || ''),
        nama_kelas: nama,
        kategori_program: katProg,
        tingkat: String(k.tingkat || '').trim(),
        keterangan: String(k.keterangan || '').trim(),
        status: String(k.status || 'aktif').trim().toLowerCase(),
        created_at: formatDateOnlyWIB(k.created_at),
        jadwal: jadwalDisplay,
        hari_mengajar: hariMengajar,
        jam_mulai: jamMulai,
        jam_selesai: jamSelesai,
        override_tanggal: overrideTanggal,
        override_status: overrideStatus,
        override_jam_mulai: overrideJamMulai,
        override_jam_selesai: overrideJamSelesai,
        override_catatan: overrideCatatan
      };
    })
    .filter(k => Boolean(k.nama_kelas));

  const scoped = (scope && scope.isGuru)
    ? list.filter(k => isKelasAllowed(k.nama_kelas, scope.kelas_ampu))
    : list;

  return scoped.sort((a, b) => a.nama_kelas.localeCompare(b.nama_kelas));
}

function handleSaveKelas(data) {
  ensureKelasSheet();
  const { sheet, headers } = getSheetAndHeaders('Kelas');
  const rows = getSheetData('Kelas');
  const now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const namaKelas = String((data && data.nama_kelas) || '').trim();
  const kategoriProgram = normalizeKategoriProgram(data && data.kategori_program, namaKelas);
  const tingkat = String((data && data.tingkat) || '').trim();
  const keterangan = String((data && data.keterangan) || '').trim();
  const status = String((data && data.status) || 'aktif').trim().toLowerCase();

  const hariMengajar = normalizeHariMengajar(data && data.hari_mengajar, kategoriProgram, false);
  const legacyReq = parseLegacyJadwalRange(data && (data.jadwal || data.jadwal_kelas || ''));
  const jamMulai = normalizeTimeHHMM(data && data.jam_mulai) || legacyReq.jam_mulai;
  const jamSelesai = normalizeTimeHHMM(data && data.jam_selesai) || legacyReq.jam_selesai;
  if ((jamMulai && !jamSelesai) || (!jamMulai && jamSelesai)) {
    throw new Error('Lengkapi Jam Mulai dan Jam Selesai jadwal tetap.');
  }
  if (jamMulai && jamSelesai && jamSelesai <= jamMulai) {
    throw new Error('Jam Selesai jadwal tetap harus lebih akhir dari Jam Mulai.');
  }

  let overrideStatus = normalizeOverrideStatus(data && data.override_status);
  let overrideTanggal = formatDateOnlyWIB(data && data.override_tanggal);
  let overrideJamMulai = normalizeTimeHHMM(data && data.override_jam_mulai);
  let overrideJamSelesai = normalizeTimeHHMM(data && data.override_jam_selesai);
  let overrideCatatan = String((data && data.override_catatan) || '').trim();

  if (overrideStatus === 'Normal') {
    overrideTanggal = '';
    overrideJamMulai = '';
    overrideJamSelesai = '';
    overrideCatatan = '';
  } else {
    if (!overrideTanggal) {
      throw new Error('Tanggal berlaku penyesuaian sementara wajib diisi.');
    }
    if (overrideStatus === 'Ubah Jam') {
      if (!overrideJamMulai || !overrideJamSelesai) {
        throw new Error('Jam mulai dan jam selesai pengganti wajib diisi untuk status Ubah Jam.');
      }
      if (overrideJamSelesai <= overrideJamMulai) {
        throw new Error('Jam selesai pengganti harus lebih akhir dari jam mulai pengganti.');
      }
    } else {
      overrideJamMulai = '';
      overrideJamSelesai = '';
    }
  }

  if (!namaKelas) {
    throw new Error('Nama kelas wajib diisi.');
  }

  const isEdit = Boolean(data && data.isEdit === true);
  const targetId = String((data && data.id_kelas) || '').trim();

  if (isEdit) {
    if (!targetId) {
      throw new Error('ID kelas tidak valid untuk mode edit.');
    }
    let existing = rows.find(r => String(r.id_kelas || '').trim() === targetId);
    if (!existing && data && data.original_nama_kelas) {
      const origNorm = normalizeKelasName(data.original_nama_kelas);
      existing = rows.find(r => normalizeKelasName(r.nama_kelas) === origNorm);
    }
    if (!existing) {
      throw new Error('Data kelas yang akan diubah tidak ditemukan.');
    }

    const dup = rows.some(
      r => r._rowIndex !== existing._rowIndex && normalizeKelasName(r.nama_kelas) === normalizeKelasName(namaKelas)
    );
    if (dup) {
      throw new Error('Nama kelas "' + namaKelas + '" sudah terdaftar.');
    }

    const oldName = String(existing.nama_kelas || '').trim();
    const updated = headers.map(h => {
      if (h === 'id_kelas') return existing.id_kelas;
      if (h === 'nama_kelas') return namaKelas;
      if (h === 'kategori_program') return kategoriProgram;
      if (h === 'tingkat') return tingkat;
      if (h === 'keterangan') return keterangan;
      if (h === 'status') return status;
      if (h === 'created_at') return existing.created_at || now;
      if (h === 'hari_mengajar') return hariMengajar;
      if (h === 'jam_mulai') return jamMulai;
      if (h === 'jam_selesai') return jamSelesai;
      if (h === 'override_tanggal') return overrideTanggal;
      if (h === 'override_status') return overrideStatus;
      if (h === 'override_jam_mulai') return overrideJamMulai;
      if (h === 'override_jam_selesai') return overrideJamSelesai;
      if (h === 'override_catatan') return overrideCatatan;
      return existing[h] !== undefined ? existing[h] : '';
    });
    sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([updated]);
    delete _requestSheetData['Kelas'];

    // Cascade rename ke Santri & Users.kelas_ampu bila nama kelas berubah (batch write)
    if (oldName && normalizeKelasName(oldName) !== normalizeKelasName(namaKelas)) {
      const santriMeta = getSheetAndHeaders('Santri');
      const santriKelasCol = santriMeta.headers.findIndex(h => h.toLowerCase() === 'kelas') + 1;
      if (santriKelasCol > 0) {
        const santriRows = getSheetData('Santri');
        const santriUpdates = [];
        const santriColValues = santriRows.map(s => {
          if (normalizeKelasName(s.kelas) === normalizeKelasName(oldName)) {
            santriUpdates.push({ rowIndex: s._rowIndex, value: namaKelas });
            return namaKelas;
          }
          return s.kelas !== undefined ? s.kelas : '';
        });
        batchWriteColumnValues(santriMeta.sheet, santriKelasCol, santriRows.length, santriUpdates, santriColValues);
        delete _requestSheetData['Santri'];
      }

      ensureUsersSchema();
      const usersMeta = getSheetAndHeaders('Users');
      const kelasAmpuCol = usersMeta.headers.findIndex(h => h.toLowerCase() === 'kelas_ampu') + 1;
      if (kelasAmpuCol > 0) {
        const userRows = getSheetData('Users');
        const userUpdates = [];
        const userColValues = userRows.map(u => {
          const list = parseKelasAmpu(u.kelas_ampu);
          let changed = false;
          const replaced = list.map(k => {
            if (normalizeKelasName(k) === normalizeKelasName(oldName)) {
              changed = true;
              return namaKelas;
            }
            return k;
          });
          if (changed) {
            const formatted = formatKelasAmpu(replaced);
            userUpdates.push({ rowIndex: u._rowIndex, value: formatted });
            return formatted;
          }
          return u.kelas_ampu !== undefined ? u.kelas_ampu : '';
        });
        batchWriteColumnValues(usersMeta.sheet, kelasAmpuCol, userRows.length, userUpdates, userColValues);
        delete _requestSheetData['Users'];
      }
    }

    const syncTs = bumpSyncVersion();
    return {
      id_kelas: existing.id_kelas,
      nama_kelas: namaKelas,
      kategori_program: kategoriProgram,
      tingkat: tingkat,
      keterangan: keterangan,
      status: status,
      created_at: formatDateOnlyWIB(existing.created_at || now),
      hari_mengajar: hariMengajar,
      jam_mulai: jamMulai,
      jam_selesai: jamSelesai,
      jadwal: jamMulai && jamSelesai ? (jamMulai + '-' + jamSelesai) : '',
      override_tanggal: overrideTanggal,
      override_status: overrideStatus,
      override_jam_mulai: overrideJamMulai,
      override_jam_selesai: overrideJamSelesai,
      override_catatan: overrideCatatan,
      renamed_from: normalizeKelasName(oldName) !== normalizeKelasName(namaKelas) ? oldName : '',
      updated: true,
      sync_ts: syncTs
    };
  }

  const dupNew = rows.some(r => normalizeKelasName(r.nama_kelas) === normalizeKelasName(namaKelas));
  if (dupNew) {
    throw new Error('Nama kelas "' + namaKelas + '" sudah terdaftar.');
  }

  const newId = generateUniqueSequentialId(rows, 'id_kelas', 'KLS-', 3);
  const newRowValues = {
    id_kelas: newId,
    nama_kelas: namaKelas,
    kategori_program: kategoriProgram,
    tingkat: tingkat,
    keterangan: keterangan,
    status: status || 'aktif',
    created_at: now,
    hari_mengajar: hariMengajar,
    jam_mulai: jamMulai,
    jam_selesai: jamSelesai,
    override_tanggal: overrideTanggal,
    override_status: overrideStatus,
    override_jam_mulai: overrideJamMulai,
    override_jam_selesai: overrideJamSelesai,
    override_catatan: overrideCatatan
  };
  sheet.appendRow(headers.map(h => newRowValues[h] !== undefined ? newRowValues[h] : ''));
  delete _requestSheetData['Kelas'];
  const syncTs = bumpSyncVersion();
  return {
    id_kelas: newId,
    nama_kelas: namaKelas,
    kategori_program: kategoriProgram,
    tingkat: tingkat,
    keterangan: keterangan,
    status: status || 'aktif',
    created_at: now,
    hari_mengajar: hariMengajar,
    jam_mulai: jamMulai,
    jam_selesai: jamSelesai,
    jadwal: jamMulai && jamSelesai ? (jamMulai + '-' + jamSelesai) : '',
    override_tanggal: overrideTanggal,
    override_status: overrideStatus,
    override_jam_mulai: overrideJamMulai,
    override_jam_selesai: overrideJamSelesai,
    override_catatan: overrideCatatan,
    created: true,
    sync_ts: syncTs
  };
}

function handleDeleteKelas(payload) {
  ensureKelasSheet();
  const { sheet } = getSheetAndHeaders('Kelas');
  const rows = getSheetData('Kelas');
  const targetId = String((payload && payload.id_kelas) || '').trim();
  const targetName = String((payload && payload.nama_kelas) || '').trim();

  let found = null;
  if (targetId) {
    found = rows.find(r => String(r.id_kelas || '').trim() === targetId);
  }
  if (!found && targetName) {
    found = rows.find(r => normalizeKelasName(r.nama_kelas) === normalizeKelasName(targetName));
  }
  if (!found) {
    throw new Error('Data kelas tidak ditemukan.');
  }

  const namaKelas = String(found.nama_kelas || '').trim();
  const santriInClass = getSheetData('Santri').filter(
    s => normalizeKelasName(s.kelas) === normalizeKelasName(namaKelas)
  );
  if (santriInClass.length > 0) {
    throw new Error(
      'Kelas "' + namaKelas + '" masih memiliki ' + santriInClass.length +
      ' santri. Pindahkan santri ke kelas lain terlebih dahulu sebelum menghapus kelas.'
    );
  }

  sheet.deleteRow(found._rowIndex);
  delete _requestSheetData['Kelas'];

  ensureUsersSchema();
  const usersMeta = getSheetAndHeaders('Users');
  const kelasAmpuCol = usersMeta.headers.findIndex(h => h.toLowerCase() === 'kelas_ampu') + 1;
  if (kelasAmpuCol > 0) {
    const userRows = getSheetData('Users');
    const userUpdates = [];
    const userColValues = userRows.map(u => {
      const list = parseKelasAmpu(u.kelas_ampu);
      const filtered = list.filter(k => normalizeKelasName(k) !== normalizeKelasName(namaKelas));
      if (filtered.length !== list.length) {
        const formatted = formatKelasAmpu(filtered);
        userUpdates.push({ rowIndex: u._rowIndex, value: formatted });
        return formatted;
      }
      return u.kelas_ampu !== undefined ? u.kelas_ampu : '';
    });
    batchWriteColumnValues(usersMeta.sheet, kelasAmpuCol, userRows.length, userUpdates, userColValues);
    delete _requestSheetData['Users'];
  }

  return { deletedId: String(found.id_kelas || targetId), nama_kelas: namaKelas };
}

function handleSaveKelasMapping(data) {
  const namaKelas = String((data && data.nama_kelas) || '').trim();
  if (!namaKelas) throw new Error('Nama kelas untuk pemetaan wajib diisi.');

  ensureUsersSchema();
  const { sheet, headers } = getSheetAndHeaders('Users');
  const colIdx = headers.findIndex(h => h.toLowerCase() === 'kelas_ampu') + 1;
  if (colIdx <= 0) throw new Error('Kolom kelas_ampu tidak ditemukan pada sheet Users.');

  const rows = getSheetData('Users');
  const targetGuruIds = new Set(
    (Array.isArray(data && data.guru_ids) ? data.guru_ids : [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );

  const updates = [];
  const allColValues = rows.map(u => {
    const role = String(u.role || '').trim().toLowerCase();
    if (role === 'admin') return u.kelas_ampu !== undefined ? u.kelas_ampu : '';

    const uid = String(u.id_user || '').trim();
    const uname = String(u.username || '').trim();
    const shouldAssign = (uid && targetGuruIds.has(uid)) || (uname && targetGuruIds.has(uname));

    const currentList = parseKelasAmpu(u.kelas_ampu);
    const hasClass = isKelasAllowed(namaKelas, currentList);
    let nextList = currentList;

    if (shouldAssign && !hasClass) {
      nextList = currentList.concat([namaKelas]);
    } else if (!shouldAssign && hasClass) {
      nextList = currentList.filter(k => normalizeKelasName(k) !== normalizeKelasName(namaKelas));
    } else {
      return u.kelas_ampu !== undefined ? u.kelas_ampu : '';
    }

    const formatted = formatKelasAmpu(nextList);
    updates.push({ rowIndex: u._rowIndex, value: formatted });
    return formatted;
  });

  batchWriteColumnValues(sheet, colIdx, rows.length, updates, allColValues);
  delete _requestSheetData['Users'];
  return { nama_kelas: namaKelas, updatedCount: updates.length };
}

function handleSaveKelasSantri(data) {
  const rawKelas = String((data && data.nama_kelas) || '').trim();
  if (!rawKelas) throw new Error('Nama kelas untuk pengaturan anggota santri wajib diisi.');

  ensureKelasSheet();
  const officialKelas = getSheetData('Kelas').find(
    k => normalizeKelasName(k.nama_kelas) === normalizeKelasName(rawKelas)
  );
  const namaKelas = officialKelas ? String(officialKelas.nama_kelas || rawKelas).trim() : rawKelas;

  ensureSantriSchema();
  const { sheet, headers } = getSheetAndHeaders('Santri');
  const kelasCol = headers.findIndex(h => h.toLowerCase() === 'kelas') + 1;
  if (kelasCol <= 0) throw new Error('Kolom kelas tidak ditemukan pada sheet Santri.');

  const targetSantriIds = new Set(
    (Array.isArray(data && data.santri_ids) ? data.santri_ids : [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );

  const rows = getSheetData('Santri');
  const targetNorm = normalizeKelasName(namaKelas);
  const updates = [];

  const allColValues = rows.map(s => {
    const sid = String(s.id_santri || '').trim();
    if (!sid) return s.kelas !== undefined ? s.kelas : '';

    const shouldAssign = targetSantriIds.has(sid);
    const currentList = parseKelasAmpu(s.kelas);
    const hasClass = isKelasAllowed(namaKelas, currentList);
    let nextList = currentList;

    if (shouldAssign && !hasClass) {
      nextList = currentList.concat([namaKelas]);
    } else if (!shouldAssign && hasClass) {
      nextList = currentList.filter(k => normalizeKelasName(k) !== targetNorm);
    } else {
      return s.kelas !== undefined ? s.kelas : '';
    }

    const formatted = formatKelasAmpu(nextList);
    updates.push({ rowIndex: s._rowIndex, value: formatted });
    return formatted;
  });

  batchWriteColumnValues(sheet, kelasCol, rows.length, updates, allColValues);
  delete _requestSheetData['Santri'];
  const syncTs = bumpSyncVersion();
  return { nama_kelas: namaKelas, updatedCount: updates.length, sync_ts: syncTs };
}

function handleBulkMoveSantriKelas(data) {
  const ids = Array.isArray(data && data.ids)
    ? data.ids.map(x => String(x || '').trim()).filter(Boolean)
    : [];
  const targetKelas = String((data && (data.target_kelas || data.kelas)) || '').trim();

  if (ids.length === 0) throw new Error('Pilih minimal satu santri untuk dipindahkan.');
  if (!targetKelas) throw new Error('Kelas tujuan wajib dipilih.');

  ensureKelasSheet();
  const officialKelas = getSheetData('Kelas').find(
    k => normalizeKelasName(k.nama_kelas) === normalizeKelasName(targetKelas)
  );
  if (!officialKelas) {
    throw new Error('Kelas tujuan "' + targetKelas + '" belum terdaftar pada daftar kelas resmi.');
  }
  const canonicalKelas = String(officialKelas.nama_kelas || targetKelas).trim();

  const { sheet, headers } = getSheetAndHeaders('Santri');
  const kelasCol = headers.findIndex(h => h.toLowerCase() === 'kelas') + 1;
  if (kelasCol <= 0) throw new Error('Kolom kelas tidak ditemukan pada sheet Santri.');

  const idSet = new Set(ids);
  const rows = getSheetData('Santri');
  const updates = [];

  const allColValues = rows.map(s => {
    const sid = String(s.id_santri || '').trim();
    if (sid && idSet.has(sid)) {
      updates.push({ rowIndex: s._rowIndex, value: canonicalKelas });
      return canonicalKelas;
    }
    return s.kelas !== undefined ? s.kelas : '';
  });

  batchWriteColumnValues(sheet, kelasCol, rows.length, updates, allColValues);
  delete _requestSheetData['Santri'];
  return { updatedCount: updates.length, target_kelas: canonicalKelas };
}

function formatSantriTextCols(sheet, headers, rowIndex, valuesByHeader) {
  if (!sheet || !Array.isArray(headers) || !rowIndex || rowIndex < 2) return;
  ['nis', 'nik', 'no_wa_ortu', 'tanggal_lahir'].forEach(colName => {
    const colIdx = headers.findIndex(h => h.toLowerCase() === colName) + 1;
    if (colIdx <= 0) return;
    const cell = sheet.getRange(rowIndex, colIdx, 1, 1);
    if (typeof cell.setNumberFormat === 'function') {
      cell.setNumberFormat('@');
    }
    if (valuesByHeader && valuesByHeader[colName] !== undefined) {
      cell.setValue(valuesByHeader[colName]);
    }
  });
}

function handleGetSantri(scope) {
  ensureSantriSchema();
  const rows = filterRowsByGuruScope(getSheetData('Santri'), scope, 'kelas');
  return rows.map(s => ({
    id_santri: String(s.id_santri || '').trim(),
    nama_lengkap: String(s.nama_lengkap || ''),
    nama_ayah_kandung: String(s.nama_ayah_kandung || '').trim(),
    nis: String(s.nis || '').trim(),
    nik: String(s.nik || '').trim(),
    tempat_lahir: String(s.tempat_lahir || '').trim(),
    tanggal_lahir: formatDateOnlyWIB(s.tanggal_lahir),
    kelas: String(s.kelas || '').trim(),
    no_wa_ortu: String(s.no_wa_ortu || '').trim(),
    qr_token: String(s.qr_token || '').trim(),
    status: String(s.status || 'aktif').trim(),
    created_at: formatDateOnlyWIB(s.created_at)
  }));
}

function handleSaveSantri(data) {
  ensureSantriSchema();
  const { sheet, headers } = getSheetAndHeaders('Santri');
  const rows = getSheetData('Santri');
  const now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const namaLengkap = String((data && data.nama_lengkap) || '').trim();

  if (!namaLengkap) {
    throw new Error('Nama lengkap santri wajib diisi.');
  }

  const nisVal = data && data.nis !== undefined ? String(data.nis || '').trim() : undefined;
  const nikVal = data && data.nik !== undefined ? String(data.nik || '').replace(/\s+/g, '').trim() : undefined;
  const tempatLahirVal = data && data.tempat_lahir !== undefined ? String(data.tempat_lahir || '').trim() : undefined;
  const tanggalLahirVal = data && data.tanggal_lahir !== undefined ? formatDateOnlyWIB(data.tanggal_lahir) : undefined;
  const namaAyahVal = data && data.nama_ayah_kandung !== undefined ? String(data.nama_ayah_kandung || '').trim() : undefined;

  const isEdit = Boolean(data && data.isEdit === true);
  const targetId = String((data && data.id_santri) || '').trim();

  if (isEdit) {
    if (!targetId) {
      throw new Error('ID santri tidak valid untuk mode edit.');
    }
    const existing = rows.find(r => String(r.id_santri || '').trim() === targetId);
    if (!existing) {
      throw new Error('Data santri yang akan diubah tidak ditemukan.');
    }

    const finalQrToken = String((data && data.qr_token) || '').trim() ||
      String(existing.qr_token || '').trim() ||
      ('QR-MDTA-' + existing.id_santri.replace(/[^a-zA-Z0-9]/g, ''));

    const finalNis = nisVal !== undefined ? nisVal : String(existing.nis || '').trim();
    const finalNik = nikVal !== undefined ? nikVal : String(existing.nik || '').replace(/\s+/g, '').trim();
    const finalTempatLahir = tempatLahirVal !== undefined ? tempatLahirVal : String(existing.tempat_lahir || '').trim();
    const finalTanggalLahir = tanggalLahirVal !== undefined ? tanggalLahirVal : formatDateOnlyWIB(existing.tanggal_lahir);
    const finalNamaAyah = namaAyahVal !== undefined ? namaAyahVal : String(existing.nama_ayah_kandung || '').trim();

    const updated = headers.map(h => {
      if (h === 'id_santri') return existing.id_santri;
      if (h === 'nama_lengkap') return namaLengkap;
      if (h === 'nis') return finalNis;
      if (h === 'nik') return finalNik;
      if (h === 'tempat_lahir') return finalTempatLahir;
      if (h === 'tanggal_lahir') return finalTanggalLahir;
      if (h === 'nama_ayah_kandung') return finalNamaAyah;
      if (h === 'qr_token') return finalQrToken;
      if (h === 'created_at') return existing.created_at || now;
      return data[h] !== undefined ? data[h] : existing[h];
    });
    formatSantriTextCols(sheet, headers, existing._rowIndex, null);
    sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([updated]);
    delete _requestSheetData['Santri'];
    const syncTs = bumpSyncVersion();
    return {
      id_santri: existing.id_santri,
      nama_lengkap: namaLengkap,
      kelas: data && data.kelas !== undefined ? String(data.kelas || '').trim() : String(existing.kelas || '').trim(),
      no_wa_ortu: data && data.no_wa_ortu !== undefined ? String(data.no_wa_ortu || '').trim() : String(existing.no_wa_ortu || '').trim(),
      status: data && data.status !== undefined ? String(data.status || 'aktif').trim() : String(existing.status || 'aktif').trim(),
      created_at: formatDateOnlyWIB(existing.created_at || now),
      nis: finalNis,
      nik: finalNik,
      tempat_lahir: finalTempatLahir,
      tanggal_lahir: finalTanggalLahir,
      nama_ayah_kandung: finalNamaAyah,
      qr_token: finalQrToken,
      updated: true,
      sync_ts: syncTs
    };
  }

  const idSantri = generateUniqueSequentialId(rows, 'id_santri', 'S-', 3);
  const existingQr = new Set(rows.map(r => String(r.qr_token || '').trim()).filter(Boolean));
  let qrToken = String((data && data.qr_token) || '').trim() ||
    ('QR-MDTA-' + idSantri.replace(/[^a-zA-Z0-9]/g, ''));
  if (existingQr.has(qrToken)) {
    qrToken = 'QR-MDTA-' + idSantri.replace(/[^a-zA-Z0-9]/g, '') + '-' + String(Date.now()).slice(-4);
  }

  const newRowValues = {
    id_santri: idSantri,
    nama_lengkap: namaLengkap,
    kelas: String((data && data.kelas) || '').trim(),
    no_wa_ortu: String((data && data.no_wa_ortu) || '').trim(),
    qr_token: qrToken,
    status: String((data && data.status) || 'aktif').trim(),
    created_at: now,
    nis: nisVal || '',
    nik: nikVal || '',
    tempat_lahir: tempatLahirVal || '',
    tanggal_lahir: tanggalLahirVal || '',
    nama_ayah_kandung: namaAyahVal || ''
  };
  const newRowArr = buildRowArrayForHeaders(headers, newRowValues, null);
  const nextRowIdx = Math.max(2, sheet.getLastRow() + 1);
  formatSantriTextCols(sheet, headers, nextRowIdx, null);
  batchAppendRows(sheet, [newRowArr]);
  delete _requestSheetData['Santri'];
  const syncTs = bumpSyncVersion();
  return {
    id_santri: idSantri,
    nama_lengkap: newRowValues.nama_lengkap,
    kelas: newRowValues.kelas,
    no_wa_ortu: newRowValues.no_wa_ortu,
    status: newRowValues.status,
    created_at: now,
    nis: newRowValues.nis,
    nik: newRowValues.nik,
    tempat_lahir: newRowValues.tempat_lahir,
    tanggal_lahir: newRowValues.tanggal_lahir,
    nama_ayah_kandung: newRowValues.nama_ayah_kandung,
    qr_token: qrToken,
    created: true,
    sync_ts: syncTs
  };
}

function writeSheetKategoriProgramCell(sheetName, rowIndex, katProgram) {
  if (!sheetName || !rowIndex || rowIndex < 2) return;
  const sheet = ensureSheetProgramColumn(sheetName);
  if (!sheet || typeof sheet.getRange !== 'function') return;
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const colIdx = headers.findIndex(h => h.toLowerCase() === 'kategori_program') + 1;
  if (colIdx > 0) {
    sheet.getRange(rowIndex, colIdx).setValue(katProgram);
  }
}

function handleSavePresensi(data, rootScope) {
  const isBatch = Array.isArray(data);
  const rawItems = isBatch ? data : [data];
  if (rawItems.length === 0) {
    throw new Error('Daftar presensi yang dikirim kosong.');
  }

  ensureSheetProgramColumn('Presensi');
  const { sheet, headers } = getSheetAndHeaders('Presensi');
  const rows = getSheetData('Presensi');
  const santriList = getSheetData('Santri');
  const kelasKatMap = getKelasKategoriMap();
  const lookupKategori = (kelasName, explicitKat) => {
    const cleanExp = String(explicitKat || '').trim();
    if (cleanExp) return normalizeKategoriProgram(cleanExp, kelasName);
    const key = normalizeKelasName(kelasName);
    if (key && kelasKatMap[key]) return kelasKatMap[key];
    return normalizeKategoriProgram('', kelasName);
  };

  const scopeBase = (rootScope && (rootScope.role || rootScope.id_user || rootScope.username))
    ? rootScope
    : (isBatch ? (rawItems[0] || {}) : (data || {}));
  const scope = resolveGuruScope(attachScopeContext(isBatch ? {} : (data || {}), scopeBase));

  if (scope.isGuru && scope.kelas_ampu.length === 0) {
    throw new Error('Akun guru Anda belum dipetakan ke kelas mana pun. Hubungi Kepala Madrasah / Admin untuk mengatur kelas ampu.');
  }

  // Validasi seluruh item terlebih dahulu agar batch bersifat atomik
  const prepared = rawItems.map(rawItem => {
    const item = rawItem || {};
    const santri = santriList.find(s =>
      (item.id_santri && String(s.id_santri).trim() === String(item.id_santri).trim()) ||
      (item.qr_token && String(s.qr_token).trim().toLowerCase() === String(item.qr_token).trim().toLowerCase()) ||
      (item.nama_santri && String(s.nama_lengkap).trim().toLowerCase() === String(item.nama_santri).trim().toLowerCase())
    );
    if (!santri) {
      throw new Error('Data santri tidak ditemukan di database.');
    }
    if (scope.isGuru && !isKelasAllowed(santri.kelas, scope.kelas_ampu)) {
      throw new Error(
        'Akses ditolak: Santri "' + santri.nama_lengkap + '" berada di ' + (santri.kelas || 'Tanpa Kelas') +
        ', di luar kelas ampu Anda (' + scope.kelas_ampu.join(', ') + ').'
      );
    }
    return { item, santri };
  });

  const usedIds = new Set(rows.map(r => String(r.id_presensi || '').trim()).filter(Boolean));
  const now = new Date();
  const defaultTanggal = Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd');
  const defaultWaktu = Utilities.formatDate(now, 'Asia/Jakarta', 'HH:mm:ss');

  let createdCount = 0;
  let updatedCount = 0;
  const savedItems = [];
  const rowUpdates = [];
  const rowsToAppend = [];
  const nextAppendRowBase = Math.max(2, sheet.getLastRow() + 1);

  prepared.forEach(({ item, santri }) => {
    const tanggal = formatDateOnlyWIB(item.tanggal) || defaultTanggal;
    const waktu = formatTimeOnlyWIB(item.waktu) || defaultWaktu;
    const status = String(item.status || 'Hadir').trim() || 'Hadir';
    const metode = String(item.metode || 'Manual').trim() || 'Manual';
    const catatan = String(item.catatan || '').trim();
    const sId = String(santri.id_santri || '').trim();
    const sNama = String(santri.nama_lengkap || '').trim();
    const sNamaKey = sNama.toLowerCase();
    const santriClasses = parseKelasAmpu(santri.kelas);
    const requestedClasses = parseKelasAmpu(item.kelas);
    const requestedSingle = requestedClasses.length > 1
      ? ((scope.isGuru ? requestedClasses.find(k => isKelasAllowed(k, scope.kelas_ampu)) : null) || requestedClasses[0])
      : (requestedClasses[0] || '');
    const scopedSantriKelas = scope.isGuru
      ? santriClasses.find(k => isKelasAllowed(k, scope.kelas_ampu))
      : santriClasses[0];
    const targetKelas = requestedSingle || scopedSantriKelas || '';
    const targetKelasKey = normalizeKelasName(targetKelas);
    const katProg = lookupKategori(targetKelas, item.kategori_program);

    const existing = rows.find(r => {
      if (formatDateOnlyWIB(r.tanggal) !== tanggal) return false;
      const rKelasKey = normalizeKelasName(r.kelas);
      if (targetKelasKey && rKelasKey && rKelasKey !== targetKelasKey) return false;
      const rId = String(r.id_santri || '').trim();
      if (sId && rId && rId === sId) return true;
      return Boolean(sNamaKey && String(r.nama_santri || '').trim().toLowerCase() === sNamaKey);
    });

    if (existing) {
      const finalId = String(existing.id_presensi || '').trim() || generateUniqueSequentialId(rows, 'id_presensi', 'PRS-', 4, usedIds);
      const idGuruPiket = item.id_guru_piket !== undefined && item.id_guru_piket !== '' ? item.id_guru_piket : (existing.id_guru_piket || '');
      const namaGuruPiket = item.nama_guru_piket !== undefined && item.nama_guru_piket !== '' ? item.nama_guru_piket : (existing.nama_guru_piket || '');
      const rowValues = buildRowArrayForHeaders(headers, {
        id_presensi: finalId,
        tanggal: tanggal,
        waktu: waktu,
        id_santri: santri.id_santri,
        nama_santri: santri.nama_lengkap,
        kelas: targetKelas,
        status: status,
        id_guru_piket: idGuruPiket,
        nama_guru_piket: namaGuruPiket,
        metode: metode,
        catatan: catatan,
        kategori_program: katProg
      }, existing);
      if (existing._appendIdx !== undefined) {
        rowsToAppend[existing._appendIdx] = rowValues;
      } else {
        rowUpdates.push({ rowIndex: existing._rowIndex, values: rowValues });
      }
      existing.kategori_program = katProg;
      existing.id_presensi = finalId;
      existing.tanggal = tanggal;
      existing.waktu = waktu;
      existing.id_santri = santri.id_santri;
      existing.nama_santri = santri.nama_lengkap;
      existing.kelas = targetKelas;
      existing.status = status;
      existing.id_guru_piket = idGuruPiket;
      existing.nama_guru_piket = namaGuruPiket;
      existing.metode = metode;
      existing.catatan = catatan;
      updatedCount++;
      savedItems.push({
        id_presensi: finalId,
        tanggal: tanggal,
        waktu: waktu,
        id_santri: santri.id_santri,
        santri: santri.nama_lengkap,
        nama_santri: santri.nama_lengkap,
        kelas: targetKelas,
        status: status,
        metode: metode,
        catatan: catatan,
        updated: true
      });
    } else {
      const newId = generateUniqueSequentialId(rows, 'id_presensi', 'PRS-', 4, usedIds);
      const idGuruPiket = item.id_guru_piket || '';
      const namaGuruPiket = item.nama_guru_piket || '';
      const rowValues = buildRowArrayForHeaders(headers, {
        id_presensi: newId,
        tanggal: tanggal,
        waktu: waktu,
        id_santri: santri.id_santri,
        nama_santri: santri.nama_lengkap,
        kelas: targetKelas,
        status: status,
        id_guru_piket: idGuruPiket,
        nama_guru_piket: namaGuruPiket,
        metode: metode,
        catatan: catatan,
        kategori_program: katProg
      }, null);
      const appendIdx = rowsToAppend.length;
      rowsToAppend.push(rowValues);
      rows.push({
        _appendIdx: appendIdx,
        _rowIndex: nextAppendRowBase + appendIdx,
        id_presensi: newId,
        tanggal: tanggal,
        waktu: waktu,
        id_santri: santri.id_santri,
        nama_santri: santri.nama_lengkap,
        kelas: targetKelas,
        status: status,
        id_guru_piket: idGuruPiket,
        nama_guru_piket: namaGuruPiket,
        metode: metode,
        catatan: catatan,
        kategori_program: katProg
      });
      createdCount++;
      savedItems.push({
        id_presensi: newId,
        tanggal: tanggal,
        waktu: waktu,
        id_santri: santri.id_santri,
        santri: santri.nama_lengkap,
        nama_santri: santri.nama_lengkap,
        kelas: targetKelas,
        status: status,
        metode: metode,
        catatan: catatan,
        updated: false
      });
    }
  });

  batchWriteRows(sheet, rowUpdates);
  batchAppendRows(sheet, rowsToAppend);

  delete _requestSheetData['Presensi'];
  const syncTs = bumpSyncVersion();

  if (!isBatch) {
    return Object.assign({}, savedItems[0], {
      savedCount: 1,
      createdCount: createdCount,
      updatedCount: updatedCount,
      items: savedItems,
      sync_ts: syncTs
    });
  }

  return {
    savedCount: savedItems.length,
    createdCount: createdCount,
    updatedCount: updatedCount,
    items: savedItems,
    sync_ts: syncTs
  };
}

function handleClearPresensiHarian(payload, rootScope) {
  const src = (payload && payload.data && typeof payload.data === 'object') ? payload.data : (payload || {});
  const targetTanggal = formatDateOnlyWIB(src.tanggal || (payload && payload.tanggal)) ||
    Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const rawKelas = String(src.kelas || (payload && payload.kelas) || '').trim();
  const hasKelasFilter = Boolean(rawKelas && rawKelas.toLowerCase() !== 'semua kelas');

  const scope = resolveGuruScope(attachScopeContext(src, rootScope));
  if (scope.isGuru) {
    if (scope.kelas_ampu.length === 0) {
      throw new Error('Akun guru Anda belum dipetakan ke kelas mana pun.');
    }
    if (hasKelasFilter && !isKelasAllowed(rawKelas, scope.kelas_ampu)) {
      throw new Error(
        'Akses ditolak: Anda hanya dapat membersihkan log presensi kelas ampu Anda (' + scope.kelas_ampu.join(', ') + ').'
      );
    }
  }

  const { sheet } = getSheetAndHeaders('Presensi');
  const rows = getSheetData('Presensi');
  const matches = rows.filter(r => {
    if (formatDateOnlyWIB(r.tanggal) !== targetTanggal) return false;
    if (scope.isGuru && !isKelasAllowed(r.kelas, scope.kelas_ampu)) return false;
    if (hasKelasFilter && normalizeKelasName(r.kelas) !== normalizeKelasName(rawKelas)) return false;
    return true;
  });

  deleteSheetRowIndices(sheet, matches.map(r => r._rowIndex));

  const ss = getSpreadsheet();
  const logSheet = ss.getSheetByName('Log_Setoran');
  if (logSheet) {
    const logRows = getSheetData('Log_Setoran');
    const logMatches = logRows.filter(l => {
      if (String(l.jenis_laporan || '').trim().toLowerCase() !== 'absensi harian') return false;
      if (formatDateOnlyWIB(l.tanggal) !== targetTanggal) return false;
      const k = String(l.kelas || '').trim();
      if (scope.isGuru) {
        if (!k || k.toLowerCase() === 'semua kelas') return false;
        if (!isKelasAllowed(k, scope.kelas_ampu)) return false;
      }
      if (hasKelasFilter && normalizeKelasName(k) !== normalizeKelasName(rawKelas)) return false;
      return true;
    });
    deleteSheetRowIndices(logSheet, logMatches.map(l => l._rowIndex));
  }

  delete _requestSheetData['Presensi'];
  delete _requestSheetData['Log_Setoran'];
  const syncTs = bumpSyncVersion();

  return {
    deletedCount: matches.length,
    tanggal: targetTanggal,
    kelas: hasKelasFilter ? rawKelas : (scope.isGuru ? scope.kelas_ampu.join(', ') : 'Semua Kelas'),
    sync_ts: syncTs
  };
}

function handleGetRekapLaporan(bulan, tahun, scope, params) {
  ensureSheetProgramColumn('Presensi');
  const santriList = filterRowsByGuruScope(getSheetData('Santri'), scope, 'kelas');
  const presensi = filterRowsByGuruScope(getSheetData('Presensi'), scope, 'kelas');
  const targetBulan = bulan ? String(bulan).padStart(2, '0') : null;
  const targetTahun = tahun ? String(tahun) : null;
  const targetKategori = params && params.kategori_program
    ? normalizeKategoriProgram(params.kategori_program)
    : '';
  const targetSemester = params && params.semester ? String(params.semester).trim().toLowerCase() : '';
  const targetTahunAjaran = params && params.tahun_ajaran ? String(params.tahun_ajaran).trim() : '';
  const isGuruScope = Boolean(scope && scope.isGuru);
  const allowedClasses = isGuruScope && Array.isArray(scope.kelas_ampu) ? scope.kelas_ampu : [];
  const kelasKatMap = getKelasKategoriMap();

  let semStart = '';
  let semEnd = '';
  if (targetSemester && targetTahunAjaran) {
    const yrs = targetTahunAjaran.match(/\d{4}/g) || [];
    const y1 = Number(yrs[0] || targetTahun || new Date().getFullYear());
    const y2 = Number(yrs[1] || (y1 + 1));
    if (targetSemester === 'genap') {
      semStart = y2 + '-01-01';
      semEnd = y2 + '-06-31';
    } else {
      semStart = y1 + '-07-01';
      semEnd = y1 + '-12-31';
    }
  }

  const filteredPresensi = presensi.filter(p => {
    const tglStr = formatDateOnlyWIB(p.tanggal);
    if (!tglStr) return false;
    if (semStart && semEnd) {
      return tglStr >= semStart && tglStr <= semEnd;
    }
    const parts = tglStr.split('-');
    if (targetTahun && parts[0] !== targetTahun) return false;
    if (targetBulan && parts[1] !== targetBulan) return false;
    return true;
  });

  const entryMap = new Map();
  const santriById = new Map();

  santriList.forEach(s => {
    const sid = String(s.id_santri || '').trim();
    if (sid) santriById.set(sid, s);
    let classes = parseKelasAmpu(s.kelas);
    if (isGuruScope) {
      classes = classes.filter(k => isKelasAllowed(k, allowedClasses));
    }
    if (classes.length === 0) classes = ['Tanpa Kelas'];
    classes.forEach(klsName => {
      const kKey = normalizeKelasName(klsName) || 'tanpa kelas';
      const katProg = kelasKatMap[kKey] || normalizeKategoriProgram('', klsName);
      if (targetKategori && katProg !== targetKategori) return;
      const compositeKey = katProg + '::' + kKey + '::' + (sid || String(s.nama_lengkap || '').trim().toLowerCase());
      if (!entryMap.has(compositeKey)) {
        entryMap.set(compositeKey, {
          id_santri: sid,
          nama_lengkap: s.nama_lengkap,
          kelas: klsName,
          kelasKey: kKey,
          kategori_program: katProg
        });
      }
    });
  });

  filteredPresensi.forEach(p => {
    const sid = String(p.id_santri || '').trim();
    const klsName = String(p.kelas || '').trim() || 'Tanpa Kelas';
    const kKey = normalizeKelasName(klsName) || 'tanpa kelas';
    if (isGuruScope && !isKelasAllowed(klsName, allowedClasses)) return;
    const katProg = p.kategori_program
      ? normalizeKategoriProgram(p.kategori_program, klsName)
      : (kelasKatMap[kKey] || normalizeKategoriProgram('', klsName));
    if (targetKategori && katProg !== targetKategori) return;
    const compositeKey = katProg + '::' + kKey + '::' + (sid || String(p.nama_santri || '').trim().toLowerCase());
    if (!entryMap.has(compositeKey)) {
      const sRef = sid ? santriById.get(sid) : null;
      entryMap.set(compositeKey, {
        id_santri: sid,
        nama_lengkap: (sRef && sRef.nama_lengkap) || p.nama_santri || '-',
        kelas: klsName,
        kelasKey: kKey,
        kategori_program: katProg
      });
    }
  });

  const out = [];
  entryMap.forEach(entry => {
    const logs = filteredPresensi.filter(p => {
      const pSid = String(p.id_santri || '').trim();
      const pKelasKey = normalizeKelasName(p.kelas) || 'tanpa kelas';
      const pKat = p.kategori_program
        ? normalizeKategoriProgram(p.kategori_program, p.kelas)
        : (kelasKatMap[pKelasKey] || normalizeKategoriProgram('', p.kelas));
      const matchSantri = entry.id_santri
        ? pSid === entry.id_santri
        : String(p.nama_santri || '').trim().toLowerCase() === String(entry.nama_lengkap || '').trim().toLowerCase();
      return matchSantri && pKelasKey === entry.kelasKey && pKat === entry.kategori_program;
    });

    const count = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0 };
    logs.forEach(l => {
      if (Object.prototype.hasOwnProperty.call(count, l.status)) count[l.status]++;
    });
    const total = count.Hadir + count.Sakit + count.Izin + count.Alpa;
    const persentase = total > 0 ? Math.round((count.Hadir / total) * 100) : 0;

    out.push({
      id_santri: entry.id_santri,
      nama_lengkap: entry.nama_lengkap,
      kelas: entry.kelas,
      kategori_program: entry.kategori_program,
      hadir: count.Hadir,
      sakit: count.Sakit,
      izin: count.Izin,
      alpa: count.Alpa,
      total: total,
      persentase: persentase
    });
  });

  return out;
}

function handleSaveNilaiUAS(data, rootScope) {
  const isBatch = Array.isArray(data);
  const rawItems = isBatch ? data : [data];
  if (rawItems.length === 0) {
    throw new Error('Tidak ada data nilai UAS untuk disimpan.');
  }

  ensureSheetProgramColumn('Nilai_UAS');
  const { sheet, headers } = getSheetAndHeaders('Nilai_UAS');
  const rows = getSheetData('Nilai_UAS');
  const santriList = getSheetData('Santri');
  const kelasKatMap = getKelasKategoriMap();
  const lookupKategori = (kelasName, explicitKat) => {
    const cleanExp = String(explicitKat || '').trim();
    if (cleanExp) return normalizeKategoriProgram(cleanExp, kelasName);
    const key = normalizeKelasName(kelasName);
    if (key && kelasKatMap[key]) return kelasKatMap[key];
    return normalizeKategoriProgram('', kelasName);
  };

  const scopeBase = (rootScope && (rootScope.role || rootScope.id_user || rootScope.username))
    ? rootScope
    : (isBatch ? (rawItems[0] || {}) : (data || {}));
  const scope = resolveGuruScope(attachScopeContext(isBatch ? {} : (data || {}), scopeBase));

  if (scope.isGuru && scope.kelas_ampu.length === 0) {
    throw new Error('Akun guru Anda belum dipetakan ke kelas mana pun.');
  }

  function findExistingUasRow(item, matched, targetKelas, targetPeriode) {
    const incomingId = String((item && item.id_uas) || '').trim();
    if (incomingId) {
      const byId = rows.find(r => String(r.id_uas || '').trim() === incomingId);
      if (byId) return byId;
    }
    const targetIdSantri = String((item && item.id_santri) || (matched && matched.id_santri) || '').trim();
    const targetNama = String((item && item.nama_santri) || (matched && matched.nama_lengkap) || '').trim().toLowerCase();
    const targetKelasKey = normalizeKelasName(targetKelas);
    if (!targetIdSantri && !targetNama) return null;

    return rows.find(r => {
      const rPeriode = String(r.periode || 'Ganjil 2026/2027').trim();
      if (rPeriode !== targetPeriode) return false;
      const rKelasKey = normalizeKelasName(r.kelas || '');
      if (targetIdSantri && String(r.id_santri || '').trim() === targetIdSantri) {
        return !targetKelasKey || !rKelasKey || rKelasKey === targetKelasKey;
      }
      return (
        targetNama &&
        String(r.nama_santri || '').trim().toLowerCase() === targetNama &&
        rKelasKey === targetKelasKey
      );
    }) || null;
  }

  // Validasi atomik seluruh item sebelum menulis
  const prepared = rawItems.map(rawItem => {
    const item = rawItem || {};
    const matched = santriList.find(s =>
      (item.id_santri && String(s.id_santri).trim() === String(item.id_santri).trim()) ||
      (item.nama_santri && String(s.nama_lengkap).trim().toLowerCase() === String(item.nama_santri).trim().toLowerCase())
    );
    const targetPeriode = String(item.periode || 'Ganjil 2026/2027').trim() || 'Ganjil 2026/2027';
    const tentativeKelas = String(item.kelas || (matched && matched.kelas) || '').trim();
    const existing = findExistingUasRow(item, matched, tentativeKelas, targetPeriode);
    const targetKelas = String(tentativeKelas || (existing && existing.kelas) || '').trim();
    const namaSantri = String(item.nama_santri || (matched && matched.nama_lengkap) || (existing && existing.nama_santri) || '').trim();

    if (!namaSantri) {
      throw new Error('Nama santri pada data nilai UAS wajib diisi.');
    }

    if (scope.isGuru) {
      if (!targetKelas || !isKelasAllowed(targetKelas, scope.kelas_ampu)) {
        throw new Error(
          'Akses ditolak: Anda hanya dapat menyimpan nilai UAS untuk kelas ampu Anda (' + scope.kelas_ampu.join(', ') + ').'
        );
      }
      if (existing && existing.kelas && !isKelasAllowed(existing.kelas, scope.kelas_ampu)) {
        throw new Error(
          'Akses ditolak: Anda hanya dapat memperbarui nilai UAS untuk kelas ampu Anda (' + scope.kelas_ampu.join(', ') + ').'
        );
      }
    }

    return { item, matched, targetKelas, targetPeriode, namaSantri };
  });

  const usedIds = new Set(rows.map(r => String(r.id_uas || '').trim()).filter(Boolean));
  const now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  let createdCount = 0;
  let updatedCount = 0;
  const savedItems = [];
  const rowUpdates = [];
  const rowsToAppend = [];
  const nextAppendRowBase = Math.max(2, sheet.getLastRow() + 1);

  prepared.forEach(({ item, matched, targetKelas, targetPeriode, namaSantri }) => {
    const existing = findExistingUasRow(item, matched, targetKelas, targetPeriode);
    const resolvedIdSantri = String(item.id_santri || (matched ? matched.id_santri : '') || (existing ? existing.id_santri : '') || '').trim();
    const resolvedSkema = String(item.skema_soal || (existing ? existing.skema_soal : '') || '');
    const pgBenar = Number(item.pg_benar || 0);
    const essayBenar = Number(item.essay_benar || 0);
    const setengahBenar = Number(item.setengah_benar || 0);
    const nilaiUas = Number(item.nilai_uas || 0);
    const idGuru = String(item.id_guru || (existing ? existing.id_guru : '') || (scope.id_user || ''));
    const katProg = lookupKategori(targetKelas, item.kategori_program);

    if (existing) {
      const finalId = String(existing.id_uas || '').trim() || generateUniqueSequentialId(rows, 'id_uas', 'UAS-', 3, usedIds);
      const rowValues = buildRowArrayForHeaders(headers, {
        id_uas: finalId,
        id_santri: resolvedIdSantri,
        nama_santri: namaSantri,
        kelas: targetKelas,
        periode: targetPeriode,
        skema_soal: resolvedSkema,
        pg_benar: pgBenar,
        essay_benar: essayBenar,
        setengah_benar: setengahBenar,
        nilai_uas: nilaiUas,
        id_guru: idGuru,
        updated_at: now,
        kategori_program: katProg
      }, existing);
      if (existing._appendIdx !== undefined) {
        rowsToAppend[existing._appendIdx] = rowValues;
      } else {
        rowUpdates.push({ rowIndex: existing._rowIndex, values: rowValues });
      }
      existing.kategori_program = katProg;
      existing.id_uas = finalId;
      existing.id_santri = resolvedIdSantri;
      existing.nama_santri = namaSantri;
      existing.kelas = targetKelas;
      existing.periode = targetPeriode;
      existing.skema_soal = resolvedSkema;
      existing.pg_benar = pgBenar;
      existing.essay_benar = essayBenar;
      existing.setengah_benar = setengahBenar;
      existing.nilai_uas = nilaiUas;
      existing.id_guru = idGuru;
      existing.updated_at = now;
      updatedCount++;
      savedItems.push({
        id_uas: finalId,
        id_santri: resolvedIdSantri,
        nama_santri: namaSantri,
        kelas: targetKelas,
        periode: targetPeriode,
        skema_soal: resolvedSkema,
        pg_benar: pgBenar,
        essay_benar: essayBenar,
        setengah_benar: setengahBenar,
        nilai_uas: nilaiUas,
        id_guru: idGuru,
        updated_at: now,
        updated: true
      });
    } else {
      const newId = generateUniqueSequentialId(rows, 'id_uas', 'UAS-', 3, usedIds);
      const rowValues = buildRowArrayForHeaders(headers, {
        id_uas: newId,
        id_santri: resolvedIdSantri,
        nama_santri: namaSantri,
        kelas: targetKelas,
        periode: targetPeriode,
        skema_soal: resolvedSkema,
        pg_benar: pgBenar,
        essay_benar: essayBenar,
        setengah_benar: setengahBenar,
        nilai_uas: nilaiUas,
        id_guru: idGuru,
        updated_at: now,
        kategori_program: katProg
      }, null);
      const appendIdx = rowsToAppend.length;
      rowsToAppend.push(rowValues);
      rows.push({
        _appendIdx: appendIdx,
        _rowIndex: nextAppendRowBase + appendIdx,
        id_uas: newId,
        id_santri: resolvedIdSantri,
        nama_santri: namaSantri,
        kelas: targetKelas,
        periode: targetPeriode,
        skema_soal: resolvedSkema,
        pg_benar: pgBenar,
        essay_benar: essayBenar,
        setengah_benar: setengahBenar,
        nilai_uas: nilaiUas,
        id_guru: idGuru,
        updated_at: now,
        kategori_program: katProg
      });
      createdCount++;
      savedItems.push({
        id_uas: newId,
        id_santri: resolvedIdSantri,
        nama_santri: namaSantri,
        kelas: targetKelas,
        periode: targetPeriode,
        skema_soal: resolvedSkema,
        pg_benar: pgBenar,
        essay_benar: essayBenar,
        setengah_benar: setengahBenar,
        nilai_uas: nilaiUas,
        id_guru: idGuru,
        updated_at: now,
        updated: false
      });
    }
  });

  batchWriteRows(sheet, rowUpdates);
  batchAppendRows(sheet, rowsToAppend);

  delete _requestSheetData['Nilai_UAS'];
  const syncTs = bumpSyncVersion();

  if (!isBatch) {
    return {
      id_uas: savedItems[0].id_uas,
      updated: savedItems[0].updated,
      savedCount: 1,
      createdCount: createdCount,
      updatedCount: updatedCount,
      items: savedItems,
      sync_ts: syncTs
    };
  }

  return {
    savedCount: savedItems.length,
    createdCount: createdCount,
    updatedCount: updatedCount,
    items: savedItems,
    sync_ts: syncTs
  };
}

function handleDeleteNilaiUAS(payload, rootScope) {
  const targetId = String((payload && (payload.id_uas || (payload.data && payload.data.id_uas))) || '').trim();
  if (!targetId) {
    throw new Error('ID nilai UAS tidak valid.');
  }
  const { sheet } = getSheetAndHeaders('Nilai_UAS');
  const rows = getSheetData('Nilai_UAS');
  const found = rows.find(r => String(r.id_uas || '').trim() === targetId);
  if (!found) {
    throw new Error('Data nilai UAS tidak ditemukan.');
  }

  const scope = resolveGuruScope(attachScopeContext(payload || {}, rootScope));
  if (scope.isGuru) {
    if (scope.kelas_ampu.length === 0) {
      throw new Error('Akun guru Anda belum dipetakan ke kelas mana pun.');
    }
    if (!found.kelas || !isKelasAllowed(found.kelas, scope.kelas_ampu)) {
      throw new Error(
        'Akses ditolak: Anda hanya dapat menghapus nilai UAS untuk kelas ampu Anda (' + scope.kelas_ampu.join(', ') + ').'
      );
    }
  }

  sheet.deleteRow(found._rowIndex);
  delete _requestSheetData['Nilai_UAS'];
  const syncTs = bumpSyncVersion();
  return { deletedId: targetId, sync_ts: syncTs };
}

function handleSaveNilaiRaport(items, metaCtx) {
  ensureSheetProgramColumn('Nilai_Raport');
  const { sheet, headers } = getSheetAndHeaders('Nilai_Raport');
  const rows = getSheetData('Nilai_Raport');
  const list = Array.isArray(items) ? items : [items];
  const scope = resolveGuruScope(metaCtx || (list[0] || {}));

  if (scope.isGuru) {
    if (scope.kelas_ampu.length === 0) {
      throw new Error('Akun guru Anda belum dipetakan ke kelas mana pun.');
    }
    list.forEach(item => {
      const k = String((item && item.kelas) || '').trim();
      if (!k || !isKelasAllowed(k, scope.kelas_ampu)) {
        throw new Error(
          'Akses ditolak: Nilai raport santri "' + ((item && item.nama_santri) || '-') +
          '" berada di luar kelas ampu Anda (' + scope.kelas_ampu.join(', ') + ').'
        );
      }
    });
  }

  const kelasKatMap = getKelasKategoriMap();
  const lookupKategori = (kelasName, explicitKat) => {
    const cleanExp = String(explicitKat || '').trim();
    if (cleanExp) return normalizeKategoriProgram(cleanExp, kelasName);
    const key = normalizeKelasName(kelasName);
    if (key && kelasKatMap[key]) return kelasKatMap[key];
    return normalizeKategoriProgram('', kelasName);
  };

  const now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const usedIds = new Set(rows.map(r => String(r.id_raport || '').trim()).filter(Boolean));
  const savedItems = [];
  const rowUpdates = [];
  const rowsToAppend = [];
  const nextAppendRowBase = Math.max(2, sheet.getLastRow() + 1);

  list.forEach(item => {
    const incomingId = String((item && item.id_raport) || '').trim();
    const targetPeriode = String((item && item.periode) || 'Ganjil 2026/2027').trim();
    const targetIdSantri = String((item && item.id_santri) || '').trim();
    const targetNama = String((item && item.nama_santri) || '').trim().toLowerCase();
    const targetKelasKey = normalizeKelasName((item && item.kelas) || '');

    let existing = incomingId ? rows.find(r => String(r.id_raport || '').trim() === incomingId) : null;
    if (!existing && (targetIdSantri || targetNama)) {
      existing = rows.find(r => {
        const rPeriode = String(r.periode || 'Ganjil 2026/2027').trim();
        if (rPeriode !== targetPeriode) return false;
        const rKelasKey = normalizeKelasName(r.kelas || '');
        if (targetIdSantri && String(r.id_santri || '').trim() === targetIdSantri) {
          return !targetKelasKey || !rKelasKey || rKelasKey === targetKelasKey;
        }
        return (
          targetNama &&
          String(r.nama_santri || '').trim().toLowerCase() === targetNama &&
          rKelasKey === targetKelasKey
        );
      }) || null;
    }

    let newId = existing ? existing.id_raport : '';
    if (!newId) {
      if (incomingId && !usedIds.has(incomingId)) {
        usedIds.add(incomingId);
        newId = incomingId;
      } else {
        newId = generateUniqueSequentialId(rows, 'id_raport', 'RPT-', 3, usedIds);
      }
    }

    const nHarian = parseNumSafe(item.n_harian, 0);
    const nUas = parseNumSafe(item.n_uas, 0);
    const nKehadiran = parseNumSafe(item.n_kehadiran, 0);
    const bHarian = parseNumSafe(item.bobot_harian, 40);
    const bUas = parseNumSafe(item.bobot_uas, 40);
    const bKehadiran = parseNumSafe(item.bobot_kehadiran, 20);
    const totalBobot = (bHarian + bUas + bKehadiran) || 100;
    const nAkhir = Math.round(((nHarian * bHarian + nUas * bUas + nKehadiran * bKehadiran) / totalBobot) * 100) / 100;
    const pred = computeRaportGrade(nAkhir);
    const katProg = lookupKategori(item.kelas || '', item.kategori_program);

    const rowObj = {
      id_raport: newId,
      id_santri: item.id_santri || '',
      nama_santri: item.nama_santri,
      kelas: item.kelas || '',
      periode: targetPeriode,
      n_harian: nHarian,
      n_uas: nUas,
      n_kehadiran: nKehadiran,
      bobot_harian: bHarian,
      bobot_uas: bUas,
      bobot_kehadiran: bKehadiran,
      n_akhir: nAkhir,
      grade: pred.grade,
      keterangan: pred.keterangan,
      updated_at: now,
      kategori_program: katProg
    };
    const rowValues = buildRowArrayForHeaders(headers, rowObj, existing || null);

    if (existing) {
      if (existing._appendIdx !== undefined) {
        rowsToAppend[existing._appendIdx] = rowValues;
      } else {
        rowUpdates.push({ rowIndex: existing._rowIndex, values: rowValues });
      }
      existing.kategori_program = katProg;
      existing.id_raport = newId;
      existing.id_santri = item.id_santri || '';
      existing.nama_santri = item.nama_santri;
      existing.kelas = item.kelas || '';
      existing.periode = targetPeriode;
      existing.n_harian = nHarian;
      existing.n_uas = nUas;
      existing.n_kehadiran = nKehadiran;
      existing.n_akhir = nAkhir;
      existing.grade = pred.grade;
      existing.keterangan = pred.keterangan;
      existing.updated_at = now;
    } else {
      const appendIdx = rowsToAppend.length;
      rowsToAppend.push(rowValues);
      rows.push(Object.assign({ _appendIdx: appendIdx, _rowIndex: nextAppendRowBase + appendIdx }, rowObj));
    }

    savedItems.push({
      id_raport: newId,
      id_santri: item.id_santri || '',
      nama_santri: item.nama_santri,
      kelas: item.kelas || '',
      periode: targetPeriode,
      n_akhir: nAkhir,
      grade: pred.grade
    });
  });

  batchWriteRows(sheet, rowUpdates);
  batchAppendRows(sheet, rowsToAppend);

  delete _requestSheetData['Nilai_Raport'];
  const syncTs = bumpSyncVersion();
  return { savedCount: list.length, items: savedItems, sync_ts: syncTs };
}

function handleDeleteById(sheetName, idColumn, idValue) {
  const { sheet } = getSheetAndHeaders(sheetName);
  const rows = getSheetData(sheetName);
  const target = String(idValue || '').trim();
  if (!target) throw new Error('ID data tidak valid.');

  let found = rows.find(r => String(r[idColumn] || '').trim() === target);
  if (!found && sheetName === 'Users') {
    found = rows.find(r => String(r.id_user || '').trim() === '' && String(r.username || '').trim() === target);
  }
  if (!found) throw new Error('Data tidak ditemukan.');
  sheet.deleteRow(found._rowIndex);
  delete _requestSheetData[sheetName];
  return { deletedId: target };
}

function handleUploadDokumenDrive(data) {
  const { filename, mimeType, base64Content, kategori, judul, diunggah_oleh } = data;
  if (!base64Content || !filename) throw new Error('File tidak lengkap.');

  let targetFolderId = CONFIG.FOLDER_ARSIP_ID;
  if (kategori === 'Impor AI') targetFolderId = CONFIG.FOLDER_UPLOAD_AI_ID;
  if (kategori === 'Laporan PDF') targetFolderId = CONFIG.FOLDER_LAPORAN_PDF_ID;

  const decoded = Utilities.base64Decode(base64Content);
  const blob = Utilities.newBlob(decoded, mimeType || 'application/pdf', filename);
  const file = DriveApp.getFolderById(targetFolderId).createFile(blob);

  const { sheet } = getSheetAndHeaders('Dokumen_Arsip');
  const rows = getSheetData('Dokumen_Arsip');
  const newId = 'DOK-' + String(rows.length + 1).padStart(3, '0');
  const now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');

  sheet.appendRow([
    newId,
    judul || filename,
    kategori || 'Arsip Resmi',
    file.getId(),
    file.getUrl(),
    diunggah_oleh || 'System',
    now
  ]);

  return {
    id_dokumen: newId,
    drive_id: file.getId(),
    drive_url: file.getUrl()
  };
}

/**
 * Proxy Aman untuk Asisten Impor Nilai AI (Gemini 2.5 Flash)
 */
function handleImportNilaiAI(data) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum diatur pada Script Properties Apps Script.');
  }

  let uploadedFileInfo = null;
  if (data.base64Content && data.filename) {
    uploadedFileInfo = handleUploadDokumenDrive({
      filename: data.filename,
      mimeType: data.mimeType,
      base64Content: data.base64Content,
      kategori: 'Impor AI',
      judul: 'Sumber Impor Nilai AI - ' + data.filename,
      diunggah_oleh: data.diunggah_oleh || 'Guru'
    });
  }

  const prompt = 'Ekstrak daftar nilai santri dari input berikut menjadi array JSON dengan properti tepat: nama_lengkap (string), n_harian (number 0-100), n_uas (number 0-100), n_kehadiran (number 0-100). Jika nilai tidak tersedia isi 0.\n\nTeks mentah:\n' + (data.rawText || '');

  const parts = [{ text: prompt }];
  if (data.base64Content && data.mimeType) {
    parts.push({
      inline_data: {
        mime_type: data.mimeType,
        data: data.base64Content
      }
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: parts }],
      generationConfig: { responseMimeType: 'application/json' }
    }),
    muteHttpExceptions: true
  });

  const resJson = JSON.parse(response.getContentText());
  if (resJson.error) throw new Error('Gemini API Error: ' + resJson.error.message);

  const rawOutput = resJson.candidates[0].content.parts[0].text;
  return {
    extracted: JSON.parse(rawOutput),
    archive_record: uploadedFileInfo
  };
}

/* ============================================================================
 * REKAPAN & PELAPORAN GURU KE KEPALA MADRASAH (Log_Setoran)
 * ============================================================================ */

function handleSubmitLaporanGuru(data) {
  if (!data || !data.jenis_laporan) {
    throw new Error('Jenis laporan (Absensi Harian atau Nilai Raport) wajib diisi.');
  }

  const scope = resolveGuruScope(data);
  const kelasVal = String(data.kelas || 'Semua Kelas').trim();
  if (scope.isGuru) {
    if (scope.kelas_ampu.length === 0) {
      throw new Error('Akun guru Anda belum dipetakan ke kelas mana pun.');
    }
    if (kelasVal.toLowerCase() === 'semua kelas' || !isKelasAllowed(kelasVal, scope.kelas_ampu)) {
      throw new Error(
        'Akses ditolak: Anda hanya dapat mengirim laporan untuk kelas ampu Anda (' + scope.kelas_ampu.join(', ') + ').'
      );
    }
  }

  const sheet = ensureLogSetoranSheet();
  const rows = getSheetData('Log_Setoran');
  const now = new Date();
  const tanggal = formatDateOnlyWIB(data.tanggal) || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd');
  const waktuSubmit = data.waktu_submit || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
  const newId = generateUniqueSequentialId(rows, 'id_setoran', 'STR-', 4);
  const ringkasanStr = typeof data.ringkasan === 'string'
    ? data.ringkasan
    : JSON.stringify(data.ringkasan || {});

  const record = [
    newId,
    tanggal,
    String(data.jenis_laporan).trim(),
    kelasVal,
    String(data.periode || '').trim(),
    String(data.id_guru || '').trim(),
    String(data.nama_guru || 'Guru Piket').trim(),
    ringkasanStr,
    waktuSubmit
  ];

  sheet.appendRow(record);
  delete _requestSheetData['Log_Setoran'];
  bumpSyncVersion();

  return {
    id_setoran: newId,
    tanggal: tanggal,
    jenis_laporan: record[2],
    kelas: record[3],
    periode: record[4],
    id_guru: record[5],
    nama_guru: record[6],
    ringkasan: ringkasanStr,
    waktu_submit: waktuSubmit
  };
}

function handleGetLogSetoran(params) {
  ensureLogSetoranSheet();
  const rows = getSheetData('Log_Setoran');
  const filterTanggal = params && params.tanggal ? formatDateOnlyWIB(params.tanggal) : '';
  const filterJenis = params && params.jenis_laporan ? String(params.jenis_laporan).trim().toLowerCase() : '';
  const filterGuru = params && params.id_guru ? String(params.id_guru).trim() : '';
  const filterKelas = params && params.kelas ? String(params.kelas).trim() : '';

  return rows
    .map(r => ({
      id_setoran: String(r.id_setoran || ''),
      tanggal: formatDateOnlyWIB(r.tanggal),
      jenis_laporan: String(r.jenis_laporan || ''),
      kelas: String(r.kelas || ''),
      periode: String(r.periode || ''),
      id_guru: String(r.id_guru || ''),
      nama_guru: String(r.nama_guru || ''),
      ringkasan: String(r.ringkasan || ''),
      waktu_submit: String(r.waktu_submit || '')
    }))
    .filter(r => {
      if (filterTanggal && r.tanggal !== filterTanggal) return false;
      if (filterJenis && r.jenis_laporan.toLowerCase() !== filterJenis) return false;
      if (filterGuru && r.id_guru !== filterGuru) return false;
      if (filterKelas && normalizeKelasName(r.kelas) !== normalizeKelasName(filterKelas)) return false;
      return true;
    })
    .reverse();
}

function handleGetRekapKepsek(tanggalParam, kelasParam) {
  ensureKelasSheet();
  ensureUsersSchema();
  ensureLogSetoranSheet();
  const now = new Date();
  const targetTanggal = formatDateOnlyWIB(tanggalParam) || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd');
  const targetKelas = String(kelasParam || '').trim();
  const isAllClasses = !targetKelas || targetKelas.toLowerCase() === 'semua kelas';

  const officialKelasList = handleGetKelas(null);
  const usersList = handleGetUsers();
  const santriList = getSheetData('Santri');
  const presensiList = getSheetData('Presensi');
  const raportList = getSheetData('Nilai_Raport');
  const uasList = getSheetData('Nilai_UAS');
  const logList = getSheetData('Log_Setoran').map(r => ({
    id_setoran: String(r.id_setoran || ''),
    tanggal: formatDateOnlyWIB(r.tanggal),
    jenis_laporan: String(r.jenis_laporan || ''),
    kelas: String(r.kelas || 'Semua Kelas'),
    periode: String(r.periode || ''),
    id_guru: String(r.id_guru || ''),
    nama_guru: String(r.nama_guru || ''),
    ringkasan: String(r.ringkasan || ''),
    waktu_submit: String(r.waktu_submit || '')
  }));

  const santriById = {};
  const santriByName = {};
  const kelasCountMap = {};
  const classNameSet = {};

  function registerClassName(rawName) {
    const clean = String(rawName || '').trim();
    if (!clean || clean.toLowerCase() === 'semua kelas' || clean.toLowerCase() === 'tanpa kelas') return;
    const key = clean.toLowerCase();
    if (!classNameSet[key]) classNameSet[key] = clean;
  }

  officialKelasList.forEach(k => {
    if (String(k.status || 'aktif').toLowerCase() !== 'nonaktif') {
      registerClassName(k.nama_kelas);
    }
  });

  santriList.forEach(s => {
    const id = String(s.id_santri || '').trim();
    const nama = String(s.nama_lengkap || '').trim();
    if (id) santriById[id] = s;
    if (nama) santriByName[nama.toLowerCase()] = s;
    if (String(s.status || 'aktif').toLowerCase() === 'aktif') {
      parseKelasAmpu(s.kelas).forEach(k => {
        registerClassName(k);
        kelasCountMap[k] = (kelasCountMap[k] || 0) + 1;
      });
    }
  });

  presensiList.forEach(p => {
    if (formatDateOnlyWIB(p.tanggal) === targetTanggal) registerClassName(p.kelas);
  });
  raportList.forEach(r => registerClassName(r.kelas));
  uasList.forEach(u => registerClassName(u.kelas));

  const daftarKelas = Object.keys(classNameSet).map(key => classNameSet[key]).sort();

  const guruMapByKelas = {};
  daftarKelas.forEach(k => {
    const gurus = usersList
      .filter(u =>
        String(u.role || '').trim().toLowerCase() === 'guru' &&
        String(u.status_aktif || 'aktif').trim().toLowerCase() === 'aktif' &&
        isKelasAllowed(k, u.kelas_ampu)
      )
      .map(u => ({
        id_user: String(u.id_user || ''),
        nama_lengkap: String(u.nama_lengkap || u.username || ''),
        username: String(u.username || ''),
        foto_url: String(u.foto_url || '')
      }));
    guruMapByKelas[k] = gurus;
  });

  const userById = {};
  usersList.forEach(u => {
    const uid = String(u.id_user || '').trim();
    if (uid) userById[uid] = u;
  });

  // 1. Setoran Absensi Harian pada tanggal terpilih
  const setoranAbsensiHariIni = logList
    .filter(l => l.jenis_laporan.toLowerCase() === 'absensi harian' && l.tanggal === targetTanggal)
    .reverse();

  const setoranSemuaKelas = setoranAbsensiHariIni.find(
    l => !l.kelas || l.kelas.toLowerCase() === 'semua kelas'
  );

  const statusSetoranHariIni = daftarKelas
    .filter(k => isAllClasses || normalizeKelasName(k) === normalizeKelasName(targetKelas))
    .map(k => {
      const exact = setoranAbsensiHariIni.find(l => normalizeKelasName(l.kelas) === normalizeKelasName(k));
      const matched = exact || setoranSemuaKelas || null;
      const gurus = guruMapByKelas[k] || [];
      return {
        kelas: k,
        jumlah_santri: kelasCountMap[k] || 0,
        guru_pengampu: gurus,
        nama_guru_pengampu: gurus.length > 0 ? gurus.map(g => g.nama_lengkap).join(', ') : 'Belum dipetakan',
        sudah_setor: Boolean(matched),
        id_setoran: matched ? matched.id_setoran : '',
        nama_guru: matched ? matched.nama_guru : '',
        waktu_submit: matched ? matched.waktu_submit : '',
        ringkasan: matched ? matched.ringkasan : ''
      };
    });

  // 2. Agregat & daftar santri tidak hadir pada tanggal terpilih
  const presensiFiltered = presensiList.filter(p => {
    const tgl = formatDateOnlyWIB(p.tanggal);
    if (tgl !== targetTanggal) return false;
    if (!isAllClasses && normalizeKelasName(p.kelas) !== normalizeKelasName(targetKelas)) return false;
    return true;
  });

  const agregat = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, total: presensiFiltered.length };
  const santriTidakHadir = [];
  const riwayatTanggal = [];

  presensiFiltered.forEach(p => {
    const st = String(p.status || 'Hadir');
    if (Object.prototype.hasOwnProperty.call(agregat, st)) {
      agregat[st]++;
    }
    const santriRef = santriById[String(p.id_santri || '').trim()] ||
      santriByName[String(p.nama_santri || '').trim().toLowerCase()] || null;
    const item = {
      id_presensi: String(p.id_presensi || ''),
      tanggal: formatDateOnlyWIB(p.tanggal),
      waktu: formatTimeOnlyWIB(p.waktu),
      id_santri: String(p.id_santri || ''),
      nama_santri: String(p.nama_santri || '-'),
      kelas: String(p.kelas || '-'),
      status: st,
      metode: String(p.metode || 'Manual'),
      id_guru_piket: String(p.id_guru_piket || ''),
      nama_guru_piket: String(p.nama_guru_piket || '-'),
      catatan: String(p.catatan || ''),
      no_wa_ortu: santriRef ? String(santriRef.no_wa_ortu || '') : ''
    };
    riwayatTanggal.push(item);
    if (st === 'Sakit' || st === 'Izin' || st === 'Alpa') {
      santriTidakHadir.push(item);
    }
  });

  const setoranAbsensiFiltered = setoranAbsensiHariIni.filter(l =>
    isAllClasses || !l.kelas || l.kelas.toLowerCase() === 'semua kelas' || normalizeKelasName(l.kelas) === normalizeKelasName(targetKelas)
  );

  // 3. Rekap Nilai Otomatis (Nilai_Raport + Nilai_UAS per kelas & periode)
  const nilaiGroups = {};
  raportList.forEach(r => {
    const k = String(r.kelas || 'Tanpa Kelas').trim();
    const per = String(r.periode || 'Ganjil 2026/2027').trim();
    if (!isAllClasses && normalizeKelasName(k) !== normalizeKelasName(targetKelas)) return;
    const key = k + '||' + per;
    if (!nilaiGroups[key]) {
      nilaiGroups[key] = { kelas: k, periode: per, rows: [] };
    }
    const resolved = resolveRaportRowValues(r);

    nilaiGroups[key].rows.push({
      id_raport: String(r.id_raport || ''),
      id_santri: String(r.id_santri || ''),
      nama_santri: String(r.nama_santri || '-'),
      kelas: k,
      periode: per,
      jenis_nilai: 'Nilai Raport',
      n_harian: resolved.n_harian,
      n_uas: resolved.n_uas,
      n_kehadiran: resolved.n_kehadiran,
      bobot_harian: resolved.bobot_harian,
      bobot_uas: resolved.bobot_uas,
      bobot_kehadiran: resolved.bobot_kehadiran,
      n_akhir: resolved.n_akhir,
      grade: resolved.grade,
      keterangan: resolved.keterangan,
      updated_at: formatDateOnlyWIB(r.updated_at)
    });
  });

  const setoranNilaiList = logList
    .filter(l => l.jenis_laporan.toLowerCase() === 'nilai raport')
    .reverse();

  setoranNilaiList.forEach(s => {
    const k = s.kelas || 'Semua Kelas';
    const per = s.periode || 'Ganjil 2026/2027';
    if (!isAllClasses && k.toLowerCase() !== 'semua kelas' && normalizeKelasName(k) !== normalizeKelasName(targetKelas)) return;
    if (k.toLowerCase() === 'semua kelas') return;
    const key = k + '||' + per;
    if (!nilaiGroups[key]) {
      nilaiGroups[key] = { kelas: k, periode: per, rows: [] };
    }
  });

  const rekapRaport = Object.keys(nilaiGroups).map(key => {
    const g = nilaiGroups[key];
    const matchedLog = setoranNilaiList.find(s =>
      (normalizeKelasName(s.kelas) === normalizeKelasName(g.kelas) || !s.kelas || s.kelas.toLowerCase() === 'semua kelas') &&
      (!s.periode || s.periode === g.periode)
    );
    const classGurus = guruMapByKelas[g.kelas] || [];
    const fallbackGuruName = classGurus.length > 0
      ? classGurus.map(x => x.nama_lengkap).join(', ')
      : 'Guru Pengampu';
    let latestUpdatedAt = '';
    g.rows.forEach(item => {
      if (item.updated_at && (!latestUpdatedAt || item.updated_at > latestUpdatedAt)) {
        latestUpdatedAt = item.updated_at;
      }
    });
    const logTanggal = matchedLog ? matchedLog.tanggal : '';
    const effectiveTanggal = (logTanggal && (!latestUpdatedAt || logTanggal > latestUpdatedAt))
      ? logTanggal
      : (latestUpdatedAt || logTanggal || '-');

    const jumlahSantri = g.rows.length;
    const totalNilai = g.rows.reduce((sum, item) => sum + item.n_akhir, 0);
    const rataRata = jumlahSantri > 0 ? Math.round((totalNilai / jumlahSantri) * 100) / 100 : 0;
    const jumlahTuntas = g.rows.filter(item => ['A', 'B', 'C'].includes(item.grade.toUpperCase())).length;
    const jumlahPerluBimbingan = jumlahSantri - jumlahTuntas;

    return {
      id_setoran: matchedLog ? matchedLog.id_setoran : '',
      jenis_nilai: 'Nilai Raport',
      kelas: g.kelas,
      periode: g.periode,
      status_setoran: matchedLog ? 'Sudah Disetor' : 'Tersimpan',
      id_guru: matchedLog ? matchedLog.id_guru : '',
      nama_guru: matchedLog ? matchedLog.nama_guru : fallbackGuruName,
      tanggal_setor: effectiveTanggal,
      waktu_submit: matchedLog ? matchedLog.waktu_submit : '',
      ringkasan: matchedLog ? matchedLog.ringkasan : '',
      jumlah_santri: jumlahSantri,
      rata_rata: rataRata,
      jumlah_tuntas: jumlahTuntas,
      jumlah_perlu_bimbingan: jumlahPerluBimbingan,
      detail_nilai: g.rows
    };
  });

  const uasGroups = {};
  uasList.forEach(u => {
    const k = String(u.kelas || 'Tanpa Kelas').trim() || 'Tanpa Kelas';
    const per = String(u.periode || 'Ganjil 2026/2027').trim();
    if (!isAllClasses && normalizeKelasName(k) !== normalizeKelasName(targetKelas)) return;
    const key = k + '||' + per;
    if (!uasGroups[key]) {
      uasGroups[key] = { kelas: k, periode: per, rowMap: {}, order: [], latestDate: '', latestGuruId: '' };
    }
    const g = uasGroups[key];
    const score = Math.round(parseNumSafe(u.nilai_uas, 0) * 100) / 100;
    const pred = computeRaportGrade(score);
    const updatedAt = formatDateOnlyWIB(u.updated_at);
    const idGuru = String(u.id_guru || '').trim();
    const dedupKey = String(u.id_santri || '').trim() ||
      String(u.nama_santri || '').trim().toLowerCase() ||
      ('row_' + u._rowIndex);

    if (!Object.prototype.hasOwnProperty.call(g.rowMap, dedupKey)) {
      g.order.push(dedupKey);
    }
    g.rowMap[dedupKey] = {
      id_uas: String(u.id_uas || ''),
      id_santri: String(u.id_santri || ''),
      nama_santri: String(u.nama_santri || '-'),
      kelas: k,
      periode: per,
      jenis_nilai: 'Nilai UAS',
      skema_soal: String(u.skema_soal || '-'),
      pg_benar: parseNumSafe(u.pg_benar, 0),
      essay_benar: parseNumSafe(u.essay_benar, 0),
      setengah_benar: parseNumSafe(u.setengah_benar, 0),
      n_harian: null,
      n_uas: score,
      n_kehadiran: null,
      n_akhir: score,
      grade: pred.grade,
      keterangan: pred.keterangan,
      id_guru: idGuru,
      updated_at: updatedAt
    };

    if (updatedAt && (!g.latestDate || updatedAt >= g.latestDate)) {
      g.latestDate = updatedAt;
      if (idGuru) g.latestGuruId = idGuru;
    } else if (!g.latestGuruId && idGuru) {
      g.latestGuruId = idGuru;
    }
  });

  const rekapUas = Object.keys(uasGroups).map(key => {
    const g = uasGroups[key];
    const uasRows = g.order.map(dk => g.rowMap[dk]);
    const uasCount = uasRows.length;
    const uasSum = uasRows.reduce((sum, item) => sum + item.n_akhir, 0);
    const uasAvg = uasCount > 0 ? Math.round((uasSum / uasCount) * 100) / 100 : 0;
    const uasTuntas = uasRows.filter(item => ['A', 'B', 'C'].includes(item.grade.toUpperCase())).length;

    const guruById = g.latestGuruId && userById[g.latestGuruId];
    const classGurus = guruMapByKelas[g.kelas] || [];
    const resolvedUasGuruName = guruById
      ? String(guruById.nama_lengkap || guruById.username || 'Guru Pengampu')
      : (classGurus.length > 0 ? classGurus.map(x => x.nama_lengkap).join(', ') : 'Guru Pengampu');

    return {
      id_setoran: '',
      jenis_nilai: 'Nilai UAS',
      kelas: g.kelas,
      periode: g.periode,
      status_setoran: 'Tersimpan',
      id_guru: g.latestGuruId || '',
      nama_guru: resolvedUasGuruName,
      tanggal_setor: g.latestDate || '-',
      waktu_submit: '',
      ringkasan: '',
      jumlah_santri: uasCount,
      rata_rata: uasAvg,
      jumlah_tuntas: uasTuntas,
      jumlah_perlu_bimbingan: uasCount - uasTuntas,
      detail_nilai: uasRows
    };
  });

  const rekapNilai = rekapRaport.concat(rekapUas);

  // 4. Laporan Terstruktur Per Kelas
  const laporanPerKelas = statusSetoranHariIni.map(stItem => {
    const k = stItem.kelas;
    const classRiwayat = riwayatTanggal.filter(r => normalizeKelasName(r.kelas) === normalizeKelasName(k));
    const classAbsent = santriTidakHadir.filter(r => normalizeKelasName(r.kelas) === normalizeKelasName(k));
    const classAgregat = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, total: classRiwayat.length };
    const metodeAbsensi = { qr: 0, manual: 0 };
    classRiwayat.forEach(r => {
      if (Object.prototype.hasOwnProperty.call(classAgregat, r.status)) classAgregat[r.status]++;
      if (String(r.metode || '').trim().toLowerCase() === 'qr') metodeAbsensi.qr++;
      else metodeAbsensi.manual++;
    });
    const classNilai = rekapNilai.filter(n => normalizeKelasName(n.kelas) === normalizeKelasName(k));
    const totalNilaiSantri = classNilai.reduce((s, n) => s + Number(n.jumlah_santri || 0), 0);
    const totalTuntas = classNilai.reduce((s, n) => s + Number(n.jumlah_tuntas || 0), 0);
    const totalBimbingan = classNilai.reduce((s, n) => s + Number(n.jumlah_perlu_bimbingan || 0), 0);
    const weightedSum = classNilai.reduce((s, n) => s + Number(n.rata_rata || 0) * Number(n.jumlah_santri || 0), 0);
    const avgNilai = totalNilaiSantri > 0
      ? Math.round((weightedSum / totalNilaiSantri) * 100) / 100
      : (classNilai[0] ? Number(classNilai[0].rata_rata || 0) : 0);

    return {
      kelas: k,
      kategori_program: resolveKelasKategoriProgram(k),
      jumlah_santri: stItem.jumlah_santri,
      guru_pengampu: stItem.guru_pengampu,
      nama_guru_pengampu: stItem.nama_guru_pengampu,
      status_setoran: {
        sudah_setor: stItem.sudah_setor,
        id_setoran: stItem.id_setoran,
        nama_guru: stItem.nama_guru,
        waktu_submit: stItem.waktu_submit,
        ringkasan: stItem.ringkasan
      },
      agregat_absensi: classAgregat,
      metode_absensi: metodeAbsensi,
      santri_tidak_hadir: classAbsent,
      riwayat_absensi: classRiwayat.slice().reverse(),
      rekap_nilai: classNilai,
      ringkasan_nilai: {
        jumlah_santri: totalNilaiSantri,
        rata_rata: avgNilai,
        jumlah_tuntas: totalTuntas,
        jumlah_perlu_bimbingan: totalBimbingan,
        status_setoran: classNilai.some(n => n.status_setoran === 'Sudah Disetor')
          ? 'Sudah Disetor'
          : (classNilai.length > 0 ? 'Draft' : 'Belum Ada Nilai'),
        periode: classNilai[0] ? classNilai[0].periode : '-',
        nama_guru: classNilai[0] ? classNilai[0].nama_guru : stItem.nama_guru_pengampu
      }
    };
  });

  return {
    tanggal: targetTanggal,
    kelas_filter: targetKelas,
    daftar_kelas: daftarKelas,
    status_setoran_hari_ini: statusSetoranHariIni,
    absensi_harian: {
      tanggal: targetTanggal,
      agregat: agregat,
      setoran: setoranAbsensiFiltered,
      santri_tidak_hadir: santriTidakHadir,
      riwayat: riwayatTanggal.slice().reverse()
    },
    rekap_nilai: rekapNilai,
    laporan_per_kelas: laporanPerKelas,
    sync_ts: getSyncVersionValue()
  };
}

function handleGetPresensiByDate(tanggalParam, scope) {
  const targetTanggal = formatDateOnlyWIB(tanggalParam) || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  return filterRowsByGuruScope(getSheetData('Presensi'), scope, 'kelas')
    .filter(p => formatDateOnlyWIB(p.tanggal) === targetTanggal)
    .map(p => Object.assign({}, p, {
      tanggal: formatDateOnlyWIB(p.tanggal),
      waktu: formatTimeOnlyWIB(p.waktu)
    }))
    .reverse();
}

function getOrCreateProfilGuruFolder() {
  const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_ID);
  const iter = rootFolder.getFoldersByName('Profil_Guru');
  if (iter.hasNext()) return iter.next();
  return rootFolder.createFolder('Profil_Guru');
}

function handleUpdateProfilGuru(data, rootScope) {
  ensureUsersSchema();
  const { sheet, headers } = getSheetAndHeaders('Users');
  const rows = getSheetData('Users');
  const targetId = String((data && data.id_user) || (rootScope && rootScope.id_user) || '').trim();
  const targetUsername = String((data && data.username) || (rootScope && rootScope.username) || '').trim().toLowerCase();

  const existing = rows.find(u =>
    (targetId && String(u.id_user || '').trim() === targetId) ||
    (targetUsername && String(u.username || '').trim().toLowerCase() === targetUsername)
  );
  if (!existing) {
    throw new Error('Akun pengguna tidak ditemukan untuk pembaruan profil.');
  }

  let fotoUrl = data && data.foto_url !== undefined ? String(data.foto_url || '').trim() : String(existing.foto_url || '').trim();
  if (data && data.foto_base64) {
    const rawB64 = String(data.foto_base64 || '');
    const match = rawB64.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = (match && match[1]) || String(data.foto_mime || 'image/jpeg');
    const b64Payload = match ? match[2] : rawB64;
    const ext = mimeType.indexOf('png') >= 0 ? 'png' : 'jpg';
    const fileName = 'profil_' + (existing.id_user || existing.username) + '_' + Date.now() + '.' + ext;
    const blob = Utilities.newBlob(Utilities.base64Decode(b64Payload), mimeType, fileName);
    const folder = getOrCreateProfilGuruFolder();
    const file = folder.createFile(blob);
    if (typeof file.setSharing === 'function') {
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) {
        // Abaikan bila domain membatasi sharing publik
      }
    }
    fotoUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400';
  }

  const nextNama = data && data.nama_lengkap !== undefined && String(data.nama_lengkap).trim()
    ? String(data.nama_lengkap).trim()
    : String(existing.nama_lengkap || '').trim();
  const nextNoWa = data && data.no_wa !== undefined ? String(data.no_wa || '').trim() : String(existing.no_wa || '');
  const nextAlamat = data && data.alamat !== undefined ? String(data.alamat || '').trim() : String(existing.alamat || '');
  const nextPendidikan = data && data.pendidikan_terakhir !== undefined ? String(data.pendidikan_terakhir || '').trim() : String(existing.pendidikan_terakhir || '');
  const nextBidang = data && data.bidang_ajar !== undefined ? String(data.bidang_ajar || '').trim() : String(existing.bidang_ajar || '');
  const nextBio = data && data.bio !== undefined ? String(data.bio || '').trim() : String(existing.bio || '');

  const updatedRow = headers.map(h => {
    if (h === 'nama_lengkap') return nextNama;
    if (h === 'no_wa') return nextNoWa;
    if (h === 'alamat') return nextAlamat;
    if (h === 'pendidikan_terakhir') return nextPendidikan;
    if (h === 'bidang_ajar') return nextBidang;
    if (h === 'bio') return nextBio;
    if (h === 'foto_url') return fotoUrl;
    return existing[h] !== undefined ? existing[h] : '';
  });

  sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([updatedRow]);
  delete _requestSheetData['Users'];
  const syncTs = bumpSyncVersion();

  return {
    id_user: existing.id_user,
    username: existing.username,
    nama_lengkap: nextNama,
    no_wa: nextNoWa,
    alamat: nextAlamat,
    pendidikan_terakhir: nextPendidikan,
    bidang_ajar: nextBidang,
    bio: nextBio,
    foto_url: fotoUrl,
    sync_ts: syncTs
  };
}

function handleSaveAbsensiGuru(data, rootScope) {
  ensureAbsensiGuruSheet();
  const { sheet } = getSheetAndHeaders('Absensi_Guru');
  const rows = getSheetData('Absensi_Guru');
  const now = new Date();
  const tanggal = formatDateOnlyWIB(data && data.tanggal) || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd');
  const waktuMasuk = formatTimeOnlyWIB(data && data.waktu_masuk) || Utilities.formatDate(now, 'Asia/Jakarta', 'HH:mm:ss');
  const idGuru = String((data && data.id_guru) || (rootScope && rootScope.id_user) || '').trim();
  const namaGuru = String((data && data.nama_guru) || '').trim();
  const kelas = String((data && data.kelas) || '').trim();
  const kategoriProgram = resolveKelasKategoriProgram(kelas, data && data.kategori_program);
  const status = String((data && data.status) || 'Hadir Mengajar').trim();
  const materiDiajarkan = String((data && data.materi_diajarkan) || '').trim();
  const keterangan = String((data && data.keterangan) || '').trim();

  if (!idGuru && !namaGuru) throw new Error('Identitas guru wajib diisi.');
  if (!kelas) throw new Error('Pilih kelas terlebih dahulu.');
  if (!materiDiajarkan && status === 'Hadir Mengajar') {
    throw new Error('Laporan materi yang diajarkan hari ini wajib diisi.');
  }

  const kelasNorm = normalizeKelasName(kelas);
  const existing = rows.find(r =>
    formatDateOnlyWIB(r.tanggal) === tanggal &&
    ((idGuru && String(r.id_guru || '').trim() === idGuru) ||
      (namaGuru && String(r.nama_guru || '').trim().toLowerCase() === namaGuru.toLowerCase())) &&
    normalizeKelasName(r.kelas) === kelasNorm
  );

  const usedIds = new Set(rows.map(r => String(r.id_absen_guru || '').trim()).filter(Boolean));
  const idAbsen = existing ? String(existing.id_absen_guru || '').trim() : generateUniqueSequentialId(rows, 'id_absen_guru', 'ABG-', 4, usedIds);
  const statusCek = existing && existing.status_cek ? String(existing.status_cek) : 'Belum Dicek';
  const catatanKepsek = existing && existing.catatan_kepsek ? String(existing.catatan_kepsek) : '';

  const rowValues = [
    idAbsen,
    tanggal,
    waktuMasuk,
    idGuru,
    namaGuru,
    kelas,
    kategoriProgram,
    status,
    materiDiajarkan,
    keterangan,
    statusCek,
    catatanKepsek
  ];

  if (existing) {
    sheet.getRange(existing._rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  delete _requestSheetData['Absensi_Guru'];
  const syncTs = bumpSyncVersion();
  return {
    id_absen_guru: idAbsen,
    tanggal: tanggal,
    waktu_masuk: waktuMasuk,
    id_guru: idGuru,
    nama_guru: namaGuru,
    kelas: kelas,
    kategori_program: kategoriProgram,
    status: status,
    materi_diajarkan: materiDiajarkan,
    keterangan: keterangan,
    status_cek: statusCek,
    catatan_kepsek: catatanKepsek,
    updated: Boolean(existing),
    sync_ts: syncTs
  };
}

function handleVerifikasiAbsensiGuru(data, rootScope) {
  const scope = resolveGuruScope(rootScope || {});
  if (scope.isGuru) {
    throw new Error('Hanya Kepala Madrasah / Admin yang dapat memverifikasi absensi guru.');
  }
  ensureAbsensiGuruSheet();
  const { sheet, headers } = getSheetAndHeaders('Absensi_Guru');
  const rows = getSheetData('Absensi_Guru');
  const targetId = String((data && data.id_absen_guru) || '').trim();
  if (!targetId) throw new Error('ID absensi guru wajib diisi.');

  const existing = rows.find(r => String(r.id_absen_guru || '').trim() === targetId);
  if (!existing) throw new Error('Catatan absensi guru tidak ditemukan.');

  const nextStatusCek = String((data && data.status_cek) || 'Sudah Dicek').trim();
  const nextCatatan = data && data.catatan_kepsek !== undefined ? String(data.catatan_kepsek || '').trim() : String(existing.catatan_kepsek || '');

  const updatedRow = headers.map(h => {
    if (h === 'status_cek') return nextStatusCek;
    if (h === 'catatan_kepsek') return nextCatatan;
    return existing[h] !== undefined ? existing[h] : '';
  });

  sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([updatedRow]);
  delete _requestSheetData['Absensi_Guru'];
  const syncTs = bumpSyncVersion();
  return {
    id_absen_guru: targetId,
    status_cek: nextStatusCek,
    catatan_kepsek: nextCatatan,
    sync_ts: syncTs
  };
}

function handleGetMonitoringGuru(params, scope) {
  ensureAbsensiGuruSheet();
  ensureUsersSchema();
  const p = params || {};
  const targetTanggal = p.tanggal ? formatDateOnlyWIB(p.tanggal) : '';
  const targetBulan = p.bulan ? String(p.bulan).padStart(2, '0') : '';
  const targetTahun = p.tahun ? String(p.tahun) : '';
  const targetGuruId = String(p.id_guru || (scope && scope.isGuru ? scope.id_user : '') || '').trim();

  const rows = getSheetData('Absensi_Guru')
    .map(r => ({
      id_absen_guru: String(r.id_absen_guru || ''),
      tanggal: formatDateOnlyWIB(r.tanggal),
      waktu_masuk: formatTimeOnlyWIB(r.waktu_masuk),
      id_guru: String(r.id_guru || ''),
      nama_guru: String(r.nama_guru || ''),
      kelas: String(r.kelas || ''),
      kategori_program: normalizeKategoriProgram(r.kategori_program, r.kelas),
      status: String(r.status || 'Hadir Mengajar'),
      materi_diajarkan: String(r.materi_diajarkan || ''),
      keterangan: String(r.keterangan || ''),
      status_cek: String(r.status_cek || 'Belum Dicek'),
      catatan_kepsek: String(r.catatan_kepsek || '')
    }))
    .filter(r => {
      if (targetGuruId && r.id_guru !== targetGuruId) return false;
      if (targetTanggal && r.tanggal !== targetTanggal) return false;
      if (!targetTanggal && (targetBulan || targetTahun)) {
        const parts = String(r.tanggal || '').split('-');
        if (targetTahun && parts[0] !== targetTahun) return false;
        if (targetBulan && parts[1] !== targetBulan) return false;
      }
      return true;
    })
    .reverse();

  return {
    absensi_guru: rows,
    gurus: handleGetUsers().filter(u => String(u.role || '').toLowerCase() === 'guru')
  };
}

function handleGetBootstrapData(params, scope) {
  const activeScope = scope || resolveGuruScope(params);
  const isGuruOnly = Boolean(activeScope && activeScope.isGuru);
  const targetTanggal = formatDateOnlyWIB(params && params.tanggal) || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const targetKelas = params && params.kelas;
  const accountActive = activeScope && activeScope.user
    ? String(activeScope.user.status_aktif || 'aktif').trim().toLowerCase() === 'aktif'
    : true;
  const userProfile = activeScope && activeScope.user
    ? {
        id_user: String(activeScope.user.id_user || ''),
        username: String(activeScope.user.username || ''),
        nama_lengkap: String(activeScope.user.nama_lengkap || ''),
        role: String(activeScope.user.role || ''),
        kelas_ampu: parseKelasAmpu(activeScope.user.kelas_ampu),
        no_wa: String(activeScope.user.no_wa || ''),
        alamat: String(activeScope.user.alamat || ''),
        pendidikan_terakhir: String(activeScope.user.pendidikan_terakhir || ''),
        bidang_ajar: String(activeScope.user.bidang_ajar || ''),
        bio: String(activeScope.user.bio || ''),
        foto_url: String(activeScope.user.foto_url || '')
      }
    : null;

  const monitoringToday = handleGetMonitoringGuru(
    { tanggal: targetTanggal, id_guru: isGuruOnly ? activeScope.id_user : '' },
    activeScope
  );

  if (isGuruOnly) {
    const allLogs = handleGetLogSetoran({});
    return {
      account_active: accountActive,
      user_profile: userProfile,
      absensi_guru_hari_ini: monitoringToday.absensi_guru,
      dashboard: null,
      rekap_kepsek: null,
      kelas: handleGetKelas(activeScope),
      kelas_ampu: activeScope.kelas_ampu,
      santri: handleGetSantri(activeScope),
      users: [],
      nilai_raport: handleGetNilaiRaport(activeScope),
      nilai_uas: filterRowsByGuruScope(getSheetData('Nilai_UAS'), activeScope, 'kelas'),
      dokumen_arsip: [],
      log_setoran: allLogs.filter(l => isKelasAllowed(l.kelas, activeScope.kelas_ampu)),
      presensi_hari_ini: handleGetPresensiByDate(targetTanggal, activeScope),
      sync_ts: getSyncVersionValue(),
      fetched_at: new Date().toISOString()
    };
  }

  return {
    account_active: accountActive,
    user_profile: userProfile,
    absensi_guru_hari_ini: monitoringToday.absensi_guru,
    dashboard: handleGetDashboard(),
    rekap_kepsek: handleGetRekapKepsek(targetTanggal, targetKelas),
    kelas: handleGetKelas(null),
    kelas_ampu: [],
    santri: handleGetSantri(null),
    users: handleGetUsers(),
    nilai_raport: handleGetNilaiRaport(null),
    nilai_uas: getSheetData('Nilai_UAS'),
    dokumen_arsip: getSheetData('Dokumen_Arsip'),
    log_setoran: handleGetLogSetoran({}),
    presensi_hari_ini: [],
    sync_ts: getSyncVersionValue(),
    fetched_at: new Date().toISOString()
  };
}
