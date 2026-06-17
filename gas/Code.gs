/**
 * 旅團集會點名系統 — Google Apps Script 後端
 * 版本: 1.1.0
 * 
 * 架構：雙 Sheet 分離
 *   - 旅團主系統 Sheet（SOURCE_SHEET_ID）：只讀，含 Members/Branches/Patrols/SystemConfig
 *   - 點名系統 Sheet（本 Sheet）：讀寫，含 Config + AttendanceRecords
 * 
 * 部署方式：
 * 1. 新建一個 Google Sheet（命名如「第82旅 集會點名紀錄」）
 * 2. 在這個 Sheet 中建立「Config」工作表，填入：
 *    A1=SOURCE_SHEET_ID, B1=旅團主系統Sheet的ID（從網址複製）
 *    A2=TROOP_NAME,      B2=第82旅（選填，會覆蓋主系統名稱）
 * 3. 上方選單 → 擴充功能 → Apps Script → 貼上本程式碼
 * 4. 部署 → 網頁應用程式 → 執行身分：我 → 誰可以存取：任何人
 * 5. 複製 URL 給 Vercel 前端使用
 */

const SHEET_NAMES = {
  config: 'Config',               // 本 Sheet 配置
  attendance: 'AttendanceRecords', // 本 Sheet 點名紀錄（橫向矩陣）
  audit: 'AuditLog'               // 本 Sheet 操作紀錄（可選）
};

const SOURCE_SHEET_NAMES = {
  members: 'Members',       // 旅團主系統：成員名單
  branches: 'Branches',   // 旅團主系統：支部
  patrols: 'Patrols',     // 旅團主系統：小隊
  config: 'SystemConfig'  // 旅團主系統：配置
};

const STATUS_MAP = { 'P': '出席', 'A': '缺席', 'L': '遲到', 'E': '請假', 'S': '病假' };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* ========== 進入點 ========== */

function verifyUnit(e) {
  const config = readConfig(getCurrentSpreadsheet());
  const troopCode = config.TROOP_CODE || config.troopCode || '';
  const requestUnit = (e.parameter.u || '').toString().trim();
  
  // 如果沒有設定 TROOP_CODE，允許任何請求（向後兼容，不建議用於生產）
  if (!troopCode) return true;
  
  // 驗證：請求的 u 參數必須匹配本 Sheet 的 TROOP_CODE
  if (requestUnit !== troopCode) {
    throw new Error('Unauthorized: unit mismatch. This backend is configured for troop ' + troopCode + ', but received ' + requestUnit);
  }
  
  // 若配置了 API_KEY，驗證之（防止直接訪問 GAS URL）
  const apiKey = config.API_KEY || '';
  if (apiKey) {
    const requestKey = (e.parameter.api_key || '').toString().trim();
    if (requestKey !== apiKey) {
      throw new Error('Unauthorized: invalid API key');
    }
  }
  
  return true;
}

function doGet(e) {
  try {
    verifyUnit(e);
    const action = e.parameter.action;
    const currentSS = getCurrentSpreadsheet();
    const sourceSS = getSourceSpreadsheet(currentSS);
    ensureAttendanceSheet(currentSS);

    switch (action) {
      case 'getConfig':
        return jsonResponse(getTroopConfig(sourceSS, currentSS));
      case 'getBranches':
        return jsonResponse(getBranches(sourceSS));
      case 'getMembers':
        return jsonResponse(getMembers(sourceSS, e.parameter.branch, e.parameter.patrol));
      case 'getPatrols':
        return jsonResponse(getPatrols(sourceSS, e.parameter.branch));
      case 'getAttendance':
        return jsonResponse(getAttendanceForDate(currentSS, e.parameter.branch, e.parameter.date));
      case 'getMatrix':
        return jsonResponse(getAttendanceMatrix(currentSS, e.parameter.branch, e.parameter.days ? parseInt(e.parameter.days) : 30));
      case 'getMyAttendance':
        return jsonResponse(getMemberHistory(currentSS, e.parameter.ymNumber));
      case 'getMemberByCredentials':
        return jsonResponse(getMemberByCredentials(sourceSS, e.parameter.id, e.parameter.password));
      case 'getMemberDetail':
        return jsonResponse(getMemberDetail(currentSS, e.parameter.ymNumber, e.parameter.name));
      default:
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action }, 400);
    }
  } catch (err) {
    logAudit(getCurrentSpreadsheet(), 'ERROR', 'doGet', err.message);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

function doPost(e) {
  try {
    verifyUnit(e);
    const action = e.parameter.action;
    const currentSS = getCurrentSpreadsheet();
    const sourceSS = getSourceSpreadsheet(currentSS);
    ensureAttendanceSheet(currentSS);
    const payload = JSON.parse(e.postData.contents || '{}');

    switch (action) {
      case 'saveAttendance':
        const saveResult = saveAttendance(currentSS, payload);
        logAudit(currentSS, 'SAVE', payload.branch + ' ' + payload.date, 'saved ' + (payload.records || []).length + ' records');
        return jsonResponse(saveResult);
      case 'syncMembers':
        const syncResult = syncMembersFromSource(currentSS, sourceSS);
        logAudit(currentSS, 'SYNC', 'members', 'synced ' + (syncResult.synced || 0));
        return jsonResponse(syncResult);
      case 'initSheet':
        const initResult = initAttendanceSheet(currentSS, sourceSS);
        logAudit(currentSS, 'INIT', 'sheet', 'reset and synced ' + (initResult.synced || 0));
        return jsonResponse(initResult);
      default:
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action }, 400);
    }
  } catch (err) {
    logAudit(getCurrentSpreadsheet(), 'ERROR', 'doPost', err.message);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}

/* ========== 工具函式 ========== */

function jsonResponse(data, code) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function getCurrentSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSourceSpreadsheet(currentSS) {
  const config = readConfig(currentSS);
  const sourceId = config.SOURCE_SHEET_ID;
  if (!sourceId) {
    throw new Error('Config 工作表缺少 SOURCE_SHEET_ID。請在本 Sheet 的 Config 表中設定旅團主系統 Sheet 的 ID。');
  }
  try {
    return SpreadsheetApp.openById(sourceId);
  } catch (e) {
    throw new Error('無法連接到旅團主系統 Sheet（ID: ' + sourceId + '）。請確認 ID 正確，且部署者帳號有權限存取該 Sheet。');
  }
}

function readConfig(currentSS) {
  const sheet = currentSS.getSheetByName(SHEET_NAMES.config);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const config = {};
  data.forEach(row => {
    const key = String(row[0] || '').trim();
    if (key) config[key] = String(row[1] || '').trim();
  });
  return config;
}

function getSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { headers: [], rows: [], values: [] };
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length === 0) return { headers: [], rows: [], values: [] };
  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1);
  return { headers, rows, values };
}

function findHeaderIdx(headers, names) {
  const lower = headers.map(h => String(h).trim().toLowerCase());
  for (const n of names) {
    const idx = lower.indexOf(n.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function logAudit(currentSS, action, target, detail) {
  try {
    let sheet = currentSS.getSheetByName(SHEET_NAMES.audit);
    if (!sheet) {
      sheet = currentSS.insertSheet(SHEET_NAMES.audit);
      sheet.appendRow(['時間', '動作', '對象', '詳情']);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#E5E7EB');
    }
    sheet.appendRow([new Date(), action, target, detail]);
  } catch (e) {
    // 忽略審計記錄失敗
  }
}

/* ========== 讀取旅團主系統（只讀） ========== */

function getTroopConfig(sourceSS, currentSS) {
  const { headers, rows } = getSheetData(sourceSS, SOURCE_SHEET_NAMES.config);
  const config = {};
  rows.forEach(row => {
    const key = String(row[0] || '').trim();
    if (key) config[key] = row[1];
  });
  
  // 如果本 Sheet 的 Config 有覆蓋設定，優先使用
  const localConfig = readConfig(currentSS);
  if (localConfig.TROOP_NAME) config.TROOP_NAME = localConfig.TROOP_NAME;
  if (localConfig.TROOP_CODE) config.TROOP_CODE = localConfig.TROOP_CODE;
  
  return config;
}

function getBranches(sourceSS) {
  const { headers, rows } = getSheetData(sourceSS, SOURCE_SHEET_NAMES.branches);
  if (!headers.length) return [];
  const list = [];
  const nameIdx = findHeaderIdx(headers, ['name', 'branch', '支部', 'branchName']);
  const enabledIdx = findHeaderIdx(headers, ['enabled', '啟用', 'active']);
  rows.forEach(row => {
    const name = nameIdx >= 0 ? row[nameIdx] : row[0];
    const enabled = enabledIdx >= 0 ? row[enabledIdx] : true;
    if (String(name).trim() && (enabled === true || enabled === 'TRUE' || enabled === 1 || enabled === '1' || enabledIdx < 0)) {
      list.push({ name: String(name).trim() });
    }
  });
  return list;
}

function getMembers(sourceSS, branchFilter, patrolFilter) {
  const { headers, rows } = getSheetData(sourceSS, SOURCE_SHEET_NAMES.members);
  if (!headers.length) return [];
  const list = [];
  const nameIdx = findHeaderIdx(headers, ['name', '姓名', 'memberName']);
  const branchIdx = findHeaderIdx(headers, ['branch', '支部', 'branchName']);
  const patrolIdx = findHeaderIdx(headers, ['patrol', '小隊', 'patrolName', '六']);
  const ymIdx = findHeaderIdx(headers, ['ymnumber', 'ymis', 'ymis號', 'ymnumber', 'memberid']);
  const emailIdx = findHeaderIdx(headers, ['email', '電郵', 'mail']);
  const roleIdx = findHeaderIdx(headers, ['role', '角色', '職位']);
  const pwdIdx = findHeaderIdx(headers, ['password', '密碼', 'pwd']);

  rows.forEach(row => {
    const name = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
    if (!name) return;
    const branch = branchIdx >= 0 ? String(row[branchIdx] || '').trim() : '';
    const patrol = patrolIdx >= 0 ? String(row[patrolIdx] || '').trim() : '';
    if (branchFilter && branch !== branchFilter) return;
    if (patrolFilter && patrol !== patrolFilter) return;
    list.push({
      name: name,
      branch: branch,
      patrol: patrol,
      ymNumber: ymIdx >= 0 ? String(row[ymIdx] || '').trim() : '',
      email: emailIdx >= 0 ? String(row[emailIdx] || '').trim() : '',
      role: roleIdx >= 0 ? String(row[roleIdx] || '').trim() : 'member',
      password: pwdIdx >= 0 ? String(row[pwdIdx] || '') : ''
    });
  });
  return list;
}

function getPatrols(sourceSS, branchFilter) {
  const { headers, rows } = getSheetData(sourceSS, SOURCE_SHEET_NAMES.patrols);
  if (!headers.length) return [];
  const list = [];
  const nameIdx = findHeaderIdx(headers, ['name', 'patrol', 'patrolName', '小隊', '六']);
  const branchIdx = findHeaderIdx(headers, ['branch', '支部', 'branchName']);
  const leaderIdx = findHeaderIdx(headers, ['leader', '隊長', 'patrolLeader', 'leaderName']);
  rows.forEach(row => {
    const name = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
    if (!name) return;
    const branch = branchIdx >= 0 ? String(row[branchIdx] || '').trim() : '';
    if (branchFilter && branch !== branchFilter) return;
    list.push({
      name: name,
      branch: branch,
      leader: leaderIdx >= 0 ? String(row[leaderIdx] || '').trim() : ''
    });
  });
  return list;
}

function getMemberByCredentials(sourceSS, id, password) {
  if (!id) return null;
  const members = getMembers(sourceSS);
  return members.find(m => {
    const idMatch = (m.ymNumber && m.ymNumber === id) || (m.email && m.email.toLowerCase() === id.toLowerCase());
    const pwdMatch = !password || (m.password && m.password === password);
    return idMatch && pwdMatch;
  }) || null;
}

/* ========== 點名系統 Sheet（本 Sheet）========== */

function ensureAttendanceSheet(currentSS) {
  let sheet = currentSS.getSheetByName(SHEET_NAMES.attendance);
  if (!sheet) {
    sheet = currentSS.insertSheet(SHEET_NAMES.attendance);
    // 初始化表頭：A=YMIS號, B=姓名, C=支部, D=小隊, E=角色, F=狀態
    sheet.appendRow(['YMIS號', '姓名', '支部', '小隊', '角色', '狀態']);
    const headerRange = sheet.getRange(1, 1, 1, 6);
    headerRange.setFontWeight('bold').setBackground('#E5E7EB');
    // 調整欄寬
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 100);
    sheet.setColumnWidth(4, 100);
    sheet.setColumnWidth(5, 80);
    sheet.setColumnWidth(6, 80);
  }
  return sheet;
}

function getAttendanceSheetData(currentSS) {
  const sheet = ensureAttendanceSheet(currentSS);
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length === 0) return { headers: [], rows: [] };
  return {
    headers: values[0].map(h => String(h).trim()),
    rows: values.slice(1),
    values: values
  };
}

function initAttendanceSheet(currentSS, sourceSS) {
  const sheet = ensureAttendanceSheet(currentSS);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clear();
  }
  // 重置表頭，保留前6列
  sheet.getRange(1, 7, 1, lastCol - 6).clear();
  return syncMembersFromSource(currentSS, sourceSS);
}

/**
 * 同步成員：以旅團主系統為準，更新到點名表
 * 策略：
 *   - YMIS 號為主鍵
 *   - 主系統有、點名表無 → 新增（狀態=active）
 *   - 主系統無、點名表有 → 標記為 left（不刪除，保留歷史）
 *   - 兩邊都有 → 更新姓名/支部/小隊/角色
 */
function syncMembersFromSource(currentSS, sourceSS) {
  const members = getMembers(sourceSS);
  const data = getAttendanceSheetData(currentSS);
  const sheet = currentSS.getSheetByName(SHEET_NAMES.attendance);
  
  // 建立現有映射（YMIS號 → 行號）
  const existingMap = {}; // ymNumber -> { rowIndex, name, branch, patrol, role, status }
  data.rows.forEach((row, idx) => {
    const ym = String(row[0] || '').trim();
    if (ym) {
      existingMap[ym] = {
        rowIndex: idx + 2, // 1-based, 跳過表頭
        name: String(row[1] || '').trim(),
        branch: String(row[2] || '').trim(),
        patrol: String(row[3] || '').trim(),
        role: String(row[4] || '').trim(),
        status: String(row[5] || '').trim() || 'active'
      };
    }
  });
  
  let added = 0;
  let updated = 0;
  let leftMarked = 0;
  
  // 1. 處理主系統成員
  const activeYms = new Set();
  members.forEach(m => {
    const ym = m.ymNumber;
    if (!ym) return; // 跳過沒有 YMIS 的成員
    activeYms.add(ym);
    
    if (existingMap[ym]) {
      // 更新現有行（若資料有變）
      const ex = existingMap[ym];
      const needsUpdate = ex.name !== m.name || ex.branch !== m.branch || ex.patrol !== m.patrol || ex.role !== m.role;
      if (needsUpdate || ex.status === 'left') {
        sheet.getRange(ex.rowIndex, 2, 1, 4).setValues([[m.name, m.branch, m.patrol, m.role]]);
        if (ex.status === 'left') {
          sheet.getRange(ex.rowIndex, 6).setValue('active');
        }
        updated++;
      }
    } else {
      // 新增行
      sheet.appendRow([ym, m.name, m.branch, m.patrol, m.role, 'active']);
      added++;
    }
  });
  
  // 2. 標記已離隊
  Object.entries(existingMap).forEach(([ym, info]) => {
    if (!activeYms.has(ym) && info.status !== 'left') {
      sheet.getRange(info.rowIndex, 6).setValue('left');
      leftMarked++;
    }
  });
  
  return { ok: true, synced: added, updated: updated, leftMarked: leftMarked, totalMembers: members.length };
}

function getAttendanceForDate(currentSS, branch, dateStr) {
  if (!dateStr || !DATE_PATTERN.test(dateStr)) return [];
  const data = getAttendanceSheetData(currentSS);
  if (!data.rows.length) return [];
  const headers = data.headers;
  
  let dateCol = -1;
  for (let i = 6; i < headers.length; i++) {
    if (String(headers[i]).trim() === dateStr) { dateCol = i; break; }
  }
  if (dateCol === -1) return []; // 尚未有此日期列
  
  const results = [];
  data.rows.forEach(row => {
    const rowBranch = String(row[2] || '').trim();
    const status = String(row[5] || '').trim();
    if (status === 'left') return; // 已離隊不顯示
    if (branch && rowBranch !== branch) return;
    results.push({
      ymNumber: String(row[0] || '').trim(),
      name: String(row[1] || '').trim(),
      branch: rowBranch,
      patrol: String(row[3] || '').trim(),
      role: String(row[4] || '').trim(),
      status: row[dateCol] || ''
    });
  });
  return results;
}

function saveAttendance(currentSS, payload) {
  const { branch, date, records } = payload;
  if (!branch || !date || !DATE_PATTERN.test(date)) {
    return { ok: false, error: 'Missing or invalid branch/date' };
  }
  if (!Array.isArray(records)) return { ok: false, error: 'Missing records' };
  
  const data = getAttendanceSheetData(currentSS);
  const headers = data.headers;
  const sheet = currentSS.getSheetByName(SHEET_NAMES.attendance);
  
  // 確保日期列存在
  let dateCol = -1;
  for (let i = 6; i < headers.length; i++) {
    if (String(headers[i]).trim() === date) { dateCol = i; break; }
  }
  if (dateCol === -1) {
    dateCol = headers.length;
    sheet.getRange(1, dateCol + 1).setValue(date).setFontWeight('bold').setBackground('#DBEAFE');
    headers.push(date);
  }
  
  // 建立 YMIS → 行號映射
  const ymRowMap = {};
  data.rows.forEach((row, idx) => {
    const ym = String(row[0] || '').trim();
    if (ym) ymRowMap[ym] = idx + 2;
  });
  
  let updated = 0;
  let created = 0;
  
  records.forEach(rec => {
    const ym = rec.ymNumber || '';
    const rowNum = ymRowMap[ym];
    if (rowNum) {
      sheet.getRange(rowNum, dateCol + 1).setValue(rec.status || '');
      updated++;
    } else {
      // 找不到 YMIS，用姓名+支部匹配（fallback）
      const fallbackKey = rec.name + '|' + branch;
      let found = false;
      data.rows.forEach((row, idx) => {
        if (found) return;
        const rName = String(row[1] || '').trim();
        const rBranch = String(row[2] || '').trim();
        if (rName === rec.name && rBranch === branch) {
          sheet.getRange(idx + 2, dateCol + 1).setValue(rec.status || '');
          found = true;
          updated++;
        }
      });
      if (!found) {
        // 新增行（無YMIS的邊緣情況）
        const newRow = ['', rec.name, branch, rec.patrol || '', rec.role || 'member', 'active'];
        while (newRow.length < headers.length) newRow.push('');
        newRow[dateCol] = rec.status || '';
        sheet.appendRow(newRow);
        created++;
      }
    }
  });
  
  return { ok: true, updated, created, date, branch };
}

function getAttendanceMatrix(currentSS, branch, days) {
  const data = getAttendanceSheetData(currentSS);
  if (!data.rows.length) return { headers: [], rows: [] };
  const headers = data.headers;
  
  // 收集所有日期欄位（第7欄起，索引6）
  const allDates = [];
  for (let i = 6; i < headers.length; i++) {
    const h = String(headers[i]).trim();
    if (DATE_PATTERN.test(h)) allDates.push(h);
  }
  allDates.sort();
  const recentDates = days ? allDates.slice(-days) : allDates;
  
  const rows = [];
  data.rows.forEach(row => {
    const rowBranch = String(row[2] || '').trim();
    const status = String(row[5] || '').trim();
    if (status === 'left') return;
    if (branch && rowBranch !== branch) return;
    const obj = {
      YMIS號: String(row[0] || '').trim(),
      姓名: String(row[1] || '').trim(),
      支部: rowBranch,
      小隊: String(row[3] || '').trim()
    };
    recentDates.forEach(d => {
      const colIdx = headers.indexOf(d);
      obj[d] = colIdx >= 0 ? (row[colIdx] || '') : '';
    });
    rows.push(obj);
  });
  
  return { headers: ['YMIS號', '姓名', '支部', '小隊', ...recentDates], rows };
}

function getMemberHistory(currentSS, ymNumber) {
  if (!ymNumber) return [];
  const data = getAttendanceSheetData(currentSS);
  if (!data.rows.length) return [];
  const headers = data.headers;
  const dates = headers.slice(6).filter(h => DATE_PATTERN.test(String(h).trim()));
  
  const results = [];
  data.rows.forEach(row => {
    const ym = String(row[0] || '').trim();
    if (ym !== ymNumber) return;
    const record = {
      name: String(row[1] || '').trim(),
      branch: String(row[2] || '').trim(),
      patrol: String(row[3] || '').trim(),
      ymNumber: ym,
      dates: {}
    };
    dates.forEach(d => {
      const colIdx = headers.indexOf(d);
      record.dates[d] = colIdx >= 0 ? (row[colIdx] || '') : '';
    });
    results.push(record);
  });
  return results;
}

function getMemberDetail(currentSS, ymNumber, name) {
  // 領袖查詢個別成員詳情（同 getMemberHistory，但返回更完整格式）
  if (!ymNumber && !name) return { error: '需要提供 YMIS 號碼或姓名' };
  
  const data = getAttendanceSheetData(currentSS);
  if (!data.rows.length) return { error: '點名表尚未建立' };
  const headers = data.headers;
  const dates = headers.slice(6).filter(h => DATE_PATTERN.test(String(h).trim()));
  
  let targetRow = null;
  data.rows.forEach(row => {
    if (targetRow) return;
    const ym = String(row[0] || '').trim();
    const rName = String(row[1] || '').trim();
    if (ymNumber && ym === ymNumber) { targetRow = row; return; }
    if (!ymNumber && name && rName === name) { targetRow = row; return; }
  });
  
  if (!targetRow) return { error: '找不到該成員' };
  
  const record = {
    ymNumber: String(targetRow[0] || '').trim(),
    name: String(targetRow[1] || '').trim(),
    branch: String(targetRow[2] || '').trim(),
    patrol: String(targetRow[3] || '').trim(),
    role: String(targetRow[4] || '').trim(),
    status: String(targetRow[5] || '').trim(),
    dates: {}
  };
  dates.forEach(d => {
    const colIdx = headers.indexOf(d);
    record.dates[d] = colIdx >= 0 ? (targetRow[colIdx] || '') : '';
  });
  
  // 計算統計
  const stats = { P: 0, A: 0, L: 0, E: 0, S: 0, total: 0 };
  Object.values(record.dates).forEach(v => {
    if (v && stats[v] !== undefined) { stats[v]++; stats.total++; }
  });
  record.stats = stats;
  
  return record;
}
