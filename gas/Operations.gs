const OPS_SHEETS = Object.freeze({
  "01_基本設定": ["設定キー", "値", "型", "説明", "更新日時"],

  "02_バージョン管理": ["バージョン", "公開日", "互換性", "状態"],

  "03_お知らせ": ["ID", "件名", "本文", "公開開始", "公開終了", "表示フラグ"],

  "04_メンテナンス": ["ID", "開始日時", "終了日時", "対象", "状態", "公開案内"],

  "05_API利用管理": [
    "集計日",
    "API名",
    "呼出数",
    "成功数",
    "失敗数",
    "制限到達",
  ],

  "06_エラーログ": ["日時", "requestId", "エラー分類", "処理名", "安全な要約"],

  "07_稼働記録": ["確認日時", "サービス", "結果", "応答時間ms", "確認方法"],

  "08_利用統計": ["集計日", "機能名", "件数"],

  "09_機能管理": ["機能キー", "有効", "更新日時"],

  "10_障害管理": ["障害ID", "対象", "検知日時", "復旧日時", "状態", "公開案内"],

  "11_リリース履歴": ["バージョン", "日付", "変更概要", "確認結果"],
});

/* ========================================
   01. スプレッドシート取得
======================================== */

function spreadsheet_() {
  return SpreadsheetApp.openById(requireProperty_("SPREADSHEET_ID"));
}

/* ========================================
   02. 初期セットアップ
======================================== */

function setupOperations() {
  const ss = spreadsheet_();

  ss.setSpreadsheetTimeZone("Asia/Tokyo");

  for (const [name, headers] of Object.entries(OPS_SHEETS)) {
    let sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
    }

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    sheet.setFrozenRows(1);

    sheet
      .getRange(1, 1, 1, headers.length)
      .setBackground("#C2410C")
      .setFontColor("#FFFFFF")
      .setFontWeight("bold");

    sheet.autoResizeColumns(1, headers.length);
  }

  SpreadsheetApp.flush();
}

/* ========================================
   03. 安全な書き込み
======================================== */

function safeCell_(value) {
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(value)) {
    return "'" + value;
  }

  return value;
}

function appendRow_(sheetName, row) {
  if (!Object.hasOwn(OPS_SHEETS, sheetName)) {
    throw new Error("ERR_CONFIG");
  }

  const lock = LockService.getScriptLock();

  lock.waitLock(5000);

  try {
    const sheet = spreadsheet_().getSheetByName(sheetName);

    if (!sheet) {
      throw new Error("ERR_CONFIG");
    }

    sheet.appendRow(row.map(safeCell_));

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/* ========================================
   04. エラーログ
======================================== */

function writeSafeError_(requestId, action, errorCode) {
  const allowedActions = [
    "status",
    "search",
    "geocode",
    "favorites",
    "unknown",
  ];

  const safeAction = allowedActions.includes(action) ? action : "unknown";

  const safeCode = /^ERR_[A-Z_]+$/.test(errorCode) ? errorCode : "ERR_API";

  try {
    appendRow_("06_エラーログ", [
      new Date(),
      requestId,
      safeCode,
      safeAction,
      "リクエスト処理に失敗",
    ]);
  } catch {
    // ログの失敗でAPI応答を停止させない
    console.warn("ERR_LOG_WRITE");
  }
}

/* ========================================
   05. 管理者通知
======================================== */

function notifyAdmin_(subject, body) {
  const email = getProperty_("ADMIN_EMAIL");

  if (!email || MailApp.getRemainingDailyQuota() < 1) return false;

  try {
    MailApp.sendEmail({
      to: email,
      subject: "[Gourmet Map] " + subject,
      body,
    });

    return true;
  } catch {
    console.warn("ERR_NOTIFICATION");

    return false;
  }
}

/* ========================================
   06. API集計
======================================== */

function recordApiUsage() {
  const date = getProperty_("USAGE_DATE");

  const count = Number(getProperty_("USAGE_COUNT", "0"));

  if (!date || !Number.isSafeInteger(count)) {
    return;
  }

  const lock = LockService.getScriptLock();

  lock.waitLock(5000);

  try {
    const sheet = spreadsheet_().getSheetByName("05_API利用管理");

    const rows = sheet.getDataRange().getValues();

    const existingIndex = rows.findIndex(
      (row, index) =>
        index > 0 && String(row[0]) === date && row[1] === "外部API合計",
    );

    const limit = Number(getProperty_("DAILY_API_LIMIT", "100"));

    const values = [
      date,
      "外部API合計",
      count,
      "未集計",
      "未集計",
      count >= limit,
    ];

    if (existingIndex >= 0) {
      sheet
        .getRange(existingIndex + 1, 1, 1, values.length)
        .setValues([values]);
    } else {
      const rowNumber = sheet.getLastRow() + 1;

      sheet.getRange(rowNumber, 1).setNumberFormat("@");

      sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
    }

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/* ========================================
   07. URLの検証
======================================== */

function monitoringUrl_(key) {
  const url = requireProperty_(key);

  if (key === "FRONTEND_URL") {
    if (!/^https:\/\/[a-z0-9-]+\.github\.io\/[a-zA-Z0-9_/-]*$/.test(url)) {
      throw new Error("ERR_CONFIG");
    }
  }

  if (key === "WEB_APP_URL") {
    if (
      !/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(
        url,
      )
    ) {
      throw new Error("ERR_CONFIG");
    }
  }

  return url;
}

/* ========================================
   08. 稼働監視
======================================== */

function monitorUrl_(service, key) {
  const started = Date.now();

  let status = "failure";

  try {
    const response = UrlFetchApp.fetch(monitoringUrl_(key), {
      muteHttpExceptions: true,
      followRedirects: true,
    });

    if (response.getResponseCode() === 200) {
      if (key === "WEB_APP_URL") {
        const result = JSON.parse(response.getContentText());

        status =
          result.ok === true && result.data?.service === "Gourmet Map API"
            ? "success"
            : "failure";
      } else {
        status = "success";
      }
    }
  } catch {
    status = "failure";
  }

  appendRow_("07_稼働記録", [
    new Date(),
    service,
    status,
    Date.now() - started,
    "定期監視",
  ]);

  updateIncident_(service, status);
}

function healthCheck() {
  monitorUrl_("GitHub Pages", "FRONTEND_URL");

  monitorUrl_("Google Apps Script", "WEB_APP_URL");

  const started = Date.now();

  const sheet = spreadsheet_().getSheetByName("01_基本設定");

  appendRow_("07_稼働記録", [
    new Date(),
    "Spreadsheet",
    sheet ? "success" : "failure",
    Date.now() - started,
    "シート確認",
  ]);

  recordApiUsage();
}

/* ========================================
   09. 障害・復旧通知
======================================== */

function updateIncident_(service, status) {
  const key = "MONITOR_STATE_" + service;

  const idKey = "MONITOR_INCIDENT_" + service;

  const previous = getProperty_(key, "unknown");

  if (previous === status) return;

  if (status === "failure") {
    const incidentId = Utilities.getUuid();

    appendRow_("10_障害管理", [
      incidentId,
      service,
      new Date(),
      "",
      "障害",
      "接続状態を確認中",
    ]);

    properties_().setProperty(idKey, incidentId);

    notifyAdmin_("障害検知", service + "の接続確認に失敗しました。");
  }

  if (status === "success" && previous === "failure") {
    const incidentId = getProperty_(idKey);

    const sheet = spreadsheet_().getSheetByName("10_障害管理");

    const rows = sheet.getDataRange().getValues();

    const index = rows.findIndex((row) => row[0] === incidentId);

    if (index > 0) {
      sheet
        .getRange(index + 1, 4, 1, 3)
        .setValues([[new Date(), "復旧", "接続確認成功"]]);
    }

    properties_().deleteProperty(idKey);

    notifyAdmin_("復旧確認", service + "の接続を確認できました。");
  }

  properties_().setProperty(key, status);
}

/* ========================================
   10. ログの保存期間管理
======================================== */

function deleteExpiredRows_(name, days) {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("ERR_CONFIG");
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const sheet = spreadsheet_().getSheetByName(name);

  if (!sheet || sheet.getLastRow() < 2) {
    return;
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    const date = new Date(rows[i][0]);

    if (Number.isFinite(date.getTime()) && date.getTime() < cutoff) {
      sheet.deleteRow(i + 2);
    }
  }
}

function cleanupLogs() {
  const days = Number(getProperty_("LOG_RETENTION_DAYS", "90"));

  const statsDays = Number(getProperty_("STAT_RETENTION_DAYS", "365"));

  const lock = LockService.getScriptLock();

  lock.waitLock(5000);

  try {
    deleteExpiredRows_("06_エラーログ", days);
    deleteExpiredRows_("07_稼働記録", days);
    deleteExpiredRows_("05_API利用管理", statsDays);
    deleteExpiredRows_("08_利用統計", statsDays);
  } finally {
    lock.releaseLock();
  }
}

/* ========================================
   11. バックアップ
======================================== */

function backupManagementData() {
  const folder = DriveApp.getFolderById(requireProperty_("BACKUP_FOLDER_ID"));

  // フォルダの共有設定は別途手動確認する
  const stamp = Utilities.formatDate(
    new Date(),
    "Asia/Tokyo",
    "yyyyMMdd_HHmmss",
  );

  DriveApp.getFileById(requireProperty_("SPREADSHEET_ID")).makeCopy(
    "GourmetMap_Backup_" + stamp,
    folder,
  );
}

function cleanupBackups() {
  const folder = DriveApp.getFolderById(requireProperty_("BACKUP_FOLDER_ID"));

  const days = Number(getProperty_("BACKUP_RETENTION_DAYS", "30"));

  if (!Number.isInteger(days) || days < 1) {
    throw new Error("ERR_CONFIG");
  }

  const cutoff = Date.now() - days * 86400000;

  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();

    if (
      file.getName().startsWith("GourmetMap_Backup_") &&
      file.getDateCreated().getTime() < cutoff
    ) {
      file.setTrashed(true);
    }
  }
}

/* ========================================
   12. 日次レポート
======================================== */

function dailyMaintenance() {
  recordApiUsage();

  cleanupLogs();

  backupManagementData();

  cleanupBackups();

  const body = [
    "グルメマップ 日次運用レポート",
    "",
    "対象日：" + getProperty_("USAGE_DATE", "未集計"),
    "外部API呼出数：" + getProperty_("USAGE_COUNT", "0"),
    "",
    "ログ期限管理：実施",
    "管理データバックアップ：実施",
    "",
    "詳細は管理用スプレッドシートをご確認ください。",
  ].join("\n");

  notifyAdmin_("日次レポート", body);
}

/* ========================================
   13. 定期実行トリガー
======================================== */

function setupTriggers() {
  const targets = ["healthCheck", "dailyMaintenance"];

  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (targets.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger("healthCheck").timeBased().everyMinutes(15).create();

  ScriptApp.newTrigger("dailyMaintenance")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone("Asia/Tokyo")
    .create();
}
