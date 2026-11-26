/**
 * 運用管理（スプレッドシート・監視・通知・保守）
 * ※ 管理者のみ実行。公開Webアプリから呼び出される操作はない（SYS-01）。
 * ※ Script Properties のヘルパー（getProperty_ 等）は Code.gs に定義。
 */

const OPS_SHEETS = Object.freeze({
  "01_基本設定": ["設定キー", "値", "型", "説明", "更新日時"],

  "02_バージョン管理": ["バージョン", "公開日", "互換性", "状態"],

  "03_お知らせ": ["ID", "件名", "本文", "公開開始", "公開終了", "表示フラグ"],

  "04_メンテナンス": ["ID", "開始日時", "終了日時", "対象", "状態", "公開案内"],

  "05_API利用管理": ["集計日", "API名", "呼出数", "成功数", "失敗数", "制限到達"],

  "06_エラーログ": ["日時", "requestId", "エラー分類", "処理名", "安全な要約"],

  "07_稼働記録": ["確認日時", "サービス", "結果", "応答時間ms", "確認方法"],

  "08_利用統計": ["集計日", "機能名", "件数"],

  "09_機能管理": ["機能キー", "有効", "更新日時"],

  "10_障害管理": ["障害ID", "対象", "検知日時", "復旧日時", "状態", "公開案内"],

  "11_リリース履歴": ["バージョン", "日付", "変更概要", "確認結果"],
});

// 機能フラグの初期値（09_機能管理）
const DEFAULT_FEATURE_FLAGS = Object.freeze([
  ["service", true],
  ["search", true],
  ["geocode", true],
  // お気に入りIDの長期保存は規約確認後に TRUE にする（FAV-01）
  ["favorites", false],
]);

/* ========================================
   01. スプレッドシート取得
======================================== */

// URL全体が貼り付けられた場合も /d/〜/ の部分からIDを取り出す
function spreadsheetId_() {
  const raw = requireProperty_("SPREADSHEET_ID");

  const match = /\/d\/([A-Za-z0-9_-]{20,})/.exec(raw);

  return match ? match[1] : raw;
}

function spreadsheet_() {
  return SpreadsheetApp.openById(spreadsheetId_());
}

/* ========================================
   02. 初期セットアップ（管理者が一度だけ実行）
======================================== */

function setupOperations() {
  const ss = spreadsheet_();

  ss.setSpreadsheetTimeZone("Asia/Tokyo");

  Object.keys(OPS_SHEETS).forEach(function (name) {
    const headers = OPS_SHEETS[name];

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
  });

  const flags = ss.getSheetByName("09_機能管理");

  if (flags.getLastRow() < 2) {
    flags
      .getRange(2, 1, DEFAULT_FEATURE_FLAGS.length, 3)
      .setValues(
        DEFAULT_FEATURE_FLAGS.map(function (row) {
          return [row[0], row[1], new Date()];
        }),
      );
  }

  SpreadsheetApp.flush();
}

/* ========================================
   03. 安全な書き込み（数式注入の防止：OPS-D03）
======================================== */

function safeCell_(value) {
  if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(value)) {
    return "'" + value;
  }

  return value;
}

function appendRows_(sheetName, rows) {
  if (!Object.prototype.hasOwnProperty.call(OPS_SHEETS, sheetName)) {
    throw new Error("ERR_CONFIG");
  }

  if (!rows.length) return;

  const lock = LockService.getScriptLock();

  lock.waitLock(5000);

  try {
    const sheet = spreadsheet_().getSheetByName(sheetName);

    if (!sheet) {
      throw new Error("ERR_CONFIG");
    }

    const values = rows.map(function (row) {
      return row.map(safeCell_);
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function appendRow_(sheetName, row) {
  appendRows_(sheetName, [row]);
}

/* ========================================
   04. エラーログ（個人を識別しない情報のみ：SEC-07）
======================================== */

function writeSafeError_(requestId, action, errorCode) {
  // 入力ミスや利用制限は件数が多くなりやすいため記録しない
  if (errorCode === "ERR_INPUT" || errorCode === "ERR_RATE_LIMIT") return;

  const allowedActions = ["status", "search", "geocode", "favorites", "unknown"];

  const safeAction = allowedActions.indexOf(action) >= 0 ? action : "unknown";

  const safeCode = /^ERR_[A-Z_]+$/.test(errorCode) ? errorCode : "ERR_API";

  const safeId = /^[0-9a-f]{1,32}$/.test(requestId) ? requestId : "unknown";

  try {
    appendRow_("06_エラーログ", [new Date(), safeId, safeCode, safeAction, "リクエスト処理に失敗"]);
  } catch (error) {
    // ログの失敗でAPI応答を停止させない
    console.warn("ERR_LOG_WRITE");
  }
}

/* ========================================
   05. 管理者通知（MON-03）
======================================== */

function notifyAdmin_(subject, body) {
  const email = getProperty_("ADMIN_EMAIL");

  if (!email || MailApp.getRemainingDailyQuota() < 1) return false;

  try {
    MailApp.sendEmail({
      to: email,
      subject: "[Gourmet Map] " + subject,
      body: body,
    });

    return true;
  } catch (error) {
    console.warn("ERR_NOTIFICATION");

    return false;
  }
}

/* ========================================
   06. API利用量の集計（05_API利用管理）
======================================== */

function upsertUsageRow_(sheet, usage) {
  const limit = numberProperty_("DAILY_API_LIMIT", DEFAULTS.DAILY_API_LIMIT);

  const values = [
    usage.date,
    "外部API合計",
    usage.count,
    usage.success,
    usage.failure,
    usage.limitHit > 0 || usage.count >= limit ? "到達" : "",
  ];

  const rows = sheet.getDataRange().getValues();

  const index = rows.findIndex(function (row, i) {
    return i > 0 && String(row[0]) === usage.date && row[1] === "外部API合計";
  });

  if (index >= 0) {
    sheet.getRange(index + 1, 1, 1, values.length).setValues([values]);
  } else {
    const rowNumber = sheet.getLastRow() + 1;

    sheet.getRange(rowNumber, 1).setNumberFormat("@");
    sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  }
}

function recordApiUsage() {
  const props = properties_();

  const current = {
    date: props.getProperty("USAGE_DATE"),
    count: Number(props.getProperty("USAGE_COUNT") || "0"),
    success: Number(props.getProperty("USAGE_SUCCESS") || "0"),
    failure: Number(props.getProperty("USAGE_FAILURE") || "0"),
    limitHit: Number(props.getProperty("USAGE_LIMIT_HIT") || "0"),
  };

  let previous = null;

  try {
    previous = JSON.parse(props.getProperty("USAGE_PREV") || "null");
  } catch (error) {
    previous = null;
  }

  const lock = LockService.getScriptLock();

  lock.waitLock(5000);

  try {
    const sheet = spreadsheet_().getSheetByName("05_API利用管理");

    if (previous && previous.date) {
      upsertUsageRow_(sheet, previous);
      props.deleteProperty("USAGE_PREV");
    }

    if (current.date) {
      upsertUsageRow_(sheet, current);
    }

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // 上限接近の警告（PER-04）
  const limit = numberProperty_("DAILY_API_LIMIT", DEFAULTS.DAILY_API_LIMIT);

  if (current.date && current.count >= limit * 0.8) {
    const warnedKey = "USAGE_WARNED_" + current.date;

    if (!props.getProperty(warnedKey)) {
      props.setProperty(warnedKey, "1");

      notifyAdmin_(
        "API利用量の上限接近",
        "本日の外部API呼出数が上限の80%を超えました（" + current.count + " / " + limit + "）。",
      );
    }
  }
}

/* ========================================
   07. 機能別利用統計（08_利用統計：前日以前を転記）
======================================== */

function flushUsageStats_() {
  const props = properties_();

  const all = props.getProperties();

  const today = today_();

  const rows = [];

  const done = [];

  Object.keys(all).forEach(function (key) {
    const match = /^STAT_(\d{4}-\d{2}-\d{2})_([a-z]+)$/.exec(key);

    if (match && match[1] < today) {
      rows.push([match[1], match[2], Number(all[key]) || 0]);
      done.push(key);
    }

    // 前日分の警告フラグも削除
    if (/^USAGE_WARNED_/.test(key) && key.slice(13) < today) {
      done.push(key);
    }
  });

  if (rows.length) {
    appendRows_("08_利用統計", rows);
  }

  done.forEach(function (key) {
    props.deleteProperty(key);
  });
}

/* ========================================
   08. URLの検証
======================================== */

function monitoringUrl_(key) {
  const url = requireProperty_(key);

  if (key === "FRONTEND_URL") {
    if (!/^https:\/\/[a-z0-9-]+\.github\.io\/[a-zA-Z0-9_/-]*$/.test(url)) {
      throw new Error("ERR_CONFIG");
    }
  }

  if (key === "WEB_APP_URL") {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url)) {
      throw new Error("ERR_CONFIG");
    }
  }

  return url;
}

/* ========================================
   09. 稼働監視（MON-01／MON-02）
======================================== */

function monitorUrl_(service, key) {
  // 監視先URLが未設定の場合はスキップ（ステータス画面では「未確認」）
  if (!getProperty_(key)) return;

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
          result.ok === true && result.data && result.data.service === SERVICE_NAME
            ? "success"
            : "failure";
      } else {
        status = "success";
      }
    }
  } catch (error) {
    status = "failure";
  }

  appendRow_("07_稼働記録", [new Date(), service, status, Date.now() - started, "定期監視"]);

  updateIncident_(service, status);
}

function healthCheck() {
  monitorUrl_("GitHub Pages", "FRONTEND_URL");

  monitorUrl_("Google Apps Script", "WEB_APP_URL");

  const started = Date.now();

  let sheetStatus = "failure";

  try {
    sheetStatus = spreadsheet_().getSheetByName("01_基本設定") ? "success" : "failure";
  } catch (error) {
    sheetStatus = "failure";
  }

  appendRow_("07_稼働記録", [new Date(), "Spreadsheet", sheetStatus, Date.now() - started, "シート確認"]);

  // 外部APIは通常通信の結果（サーキットブレーカー）を記録
  ["hotpepper", "geoapify"].forEach(function (name) {
    const status = circuitOpen_(name) ? "failure" : "success";

    appendRow_("07_稼働記録", [new Date(), name === "hotpepper" ? "ホットペッパーAPI" : "Geoapify", status, "", "通常通信の結果"]);
  });

  recordApiUsage();

  // ステータス画面のキャッシュを更新
  CacheService.getScriptCache().remove("status:v1");
}

/* ========================================
   10. 障害・復旧通知（重複通知の抑止）
======================================== */

function updateIncident_(service, status) {
  const key = "MONITOR_STATE_" + service;

  const idKey = "MONITOR_INCIDENT_" + service;

  const previous = getProperty_(key, "unknown");

  if (previous === status) return;

  if (status === "failure") {
    const incidentId = Utilities.getUuid();

    appendRow_("10_障害管理", [incidentId, service, new Date(), "", "障害", "接続状態を確認中"]);

    properties_().setProperty(idKey, incidentId);

    notifyAdmin_("障害検知", service + "の接続確認に失敗しました。");
  }

  if (status === "success" && previous === "failure") {
    const incidentId = getProperty_(idKey);

    const sheet = spreadsheet_().getSheetByName("10_障害管理");

    const rows = sheet.getDataRange().getValues();

    const index = rows.findIndex(function (row) {
      return row[0] === incidentId;
    });

    if (index > 0) {
      sheet.getRange(index + 1, 4, 1, 3).setValues([[new Date(), "復旧", "接続確認成功"]]);
    }

    properties_().deleteProperty(idKey);

    notifyAdmin_("復旧確認", service + "の接続を確認できました。");
  }

  properties_().setProperty(key, status);
}

/* ========================================
   11. ログの保存期間管理（OPS-D04）
======================================== */

// 行は時系列で追記されるため、先頭から期限切れの行をまとめて削除
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

  let expired = 0;

  for (let i = 0; i < rows.length; i++) {
    const time = new Date(rows[i][0]).getTime();

    if (Number.isFinite(time) && time < cutoff) {
      expired = i + 1;
    } else if (Number.isFinite(time)) {
      break;
    }
  }

  if (expired > 0) {
    sheet.deleteRows(2, expired);
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
   12. バックアップ（MON-04／MON-07）
======================================== */

function backupManagementData() {
  const folder = DriveApp.getFolderById(requireProperty_("BACKUP_FOLDER_ID"));

  // フォルダの共有設定は別途手動確認する（一般公開しない）
  const stamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss");

  DriveApp.getFileById(spreadsheetId_()).makeCopy(
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

    if (file.getName().indexOf("GourmetMap_Backup_") === 0 && file.getDateCreated().getTime() < cutoff) {
      file.setTrashed(true);
    }
  }
}

/* ========================================
   13. 日次処理・レポート（MON-04）
======================================== */

function dailyMaintenance() {
  const results = [];

  function step(label, callback) {
    try {
      callback();
      results.push(label + "：実施");
    } catch (error) {
      results.push(label + "：失敗（" + (/^ERR_[A-Z_]+$/.test(error.message) ? error.message : "ERR_UNKNOWN") + "）");
    }
  }

  step("API利用量の集計", recordApiUsage);
  step("機能別利用統計の転記", flushUsageStats_);
  step("ログの期限削除", cleanupLogs);
  step("管理データのバックアップ", backupManagementData);
  step("古いバックアップの削除", cleanupBackups);

  const props = properties_();

  const body = [
    "グルメマップ 日次運用レポート",
    "",
    "集計日：" + (props.getProperty("USAGE_DATE") || "未集計"),
    "外部API呼出数：" + (props.getProperty("USAGE_COUNT") || "0"),
    "成功：" + (props.getProperty("USAGE_SUCCESS") || "0") + "／失敗：" + (props.getProperty("USAGE_FAILURE") || "0"),
    "",
    results.join("\n"),
    "",
    "詳細は管理用スプレッドシートをご確認ください。",
  ].join("\n");

  notifyAdmin_("日次レポート", body);
}

/* ========================================
   14. 設定の診断（管理者がエディタで実行）
   APIキーなどの値は表示せず、設定の有無と状態のみをログに出す
======================================== */

function diagnose() {
  const props = properties_();

  const lines = [];

  function present(key) {
    return props.getProperty(key) ? "設定済み" : "未設定";
  }

  CacheService.getScriptCache().removeAll(["status:v1", "flags:v1", "maintenance:v1"]);

  lines.push("【必須プロパティ】");
  ["HOTPEPPER_API_KEY", "GEOAPIFY_API_KEY", "SPREADSHEET_ID"].forEach(function (key) {
    lines.push("  " + key + "：" + present(key));
  });

  lines.push("【停止・機能フラグ】");
  ["SERVICE_STOPPED", "API_ENABLED", "FAVORITES_ENABLED", "CACHE_ENABLED", "DAILY_API_LIMIT"].forEach(function (key) {
    const value = props.getProperty(key);
    lines.push("  " + key + "：" + (value === null ? "未設定" : JSON.stringify(value)));
  });

  let sheetOk = false;

  try {
    const ss = spreadsheet_();
    sheetOk = true;
    const names = ss.getSheets().map(function (sheet) {
      return sheet.getName();
    });
    const missing = Object.keys(OPS_SHEETS).filter(function (name) {
      return names.indexOf(name) < 0;
    });
    lines.push("【スプレッドシート】接続：OK／不足シート：" + (missing.length ? missing.join("、") : "なし"));
  } catch (error) {
    const id = props.getProperty("SPREADSHEET_ID") ? spreadsheetId_() : "";

    lines.push("【スプレッドシート】接続：失敗");
    lines.push(
      "  IDの形式：" +
        (/^[A-Za-z0-9_-]{40,50}$/.test(id)
          ? "OK（" + id.length + "文字）"
          : "要確認（" + id.length + "文字。URLの /d/ と /edit の間の文字列のみを設定）"),
    );
    lines.push("  エラー内容：" + String(error && error.message ? error.message : error).slice(0, 200));
    lines.push("  確認：①IDの誤り ②このGASを実行しているアカウントにスプレッドシートの編集権限がない ③権限の承認が未完了（エディタで setupOperations を実行して承認）");
  }

  if (sheetOk) {
    lines.push("【09_機能管理の解釈結果】" + JSON.stringify(readFeatureFlags_()));
    lines.push("【04_メンテナンス】" + JSON.stringify(readMaintenance_()));
  }

  const reason = stopReason_();

  lines.push(
    "【判定】" +
      (reason
        ? "メンテナンス扱い（原因：" +
          {
            SERVICE_STOPPED: "Script Properties の SERVICE_STOPPED が有効",
            API_ENABLED: "Script Properties の API_ENABLED が無効（false 等）",
            FEATURE_FLAG_SERVICE: "シート「09_機能管理」の service が無効",
            MAINTENANCE_SHEET: "シート「04_メンテナンス」に実施中の予定がある",
          }[reason] +
          "）"
        : "稼働中（online）"),
  );

  lines.push("【本日の外部API呼出】" + (props.getProperty("USAGE_COUNT") || "0") + "／上限 " + numberProperty_("DAILY_API_LIMIT", DEFAULTS.DAILY_API_LIMIT));

  lines.push("【トリガー】" + ScriptApp.getProjectTriggers().map(function (trigger) {
    return trigger.getHandlerFunction();
  }).join("、"));

  lines.push("※ アプリから接続できない場合は「デプロイを管理」で「アクセスできるユーザー：全員」になっているか確認してください。");

  const report = lines.join(String.fromCharCode(10));

  console.log(report);

  return report;
}

/* ========================================
   15. 定期実行トリガー（管理者が一度だけ実行）
======================================== */

function setupTriggers() {
  const targets = ["healthCheck", "dailyMaintenance"];

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (targets.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("healthCheck").timeBased().everyMinutes(15).create();

  ScriptApp.newTrigger("dailyMaintenance")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone("Asia/Tokyo")
    .create();
}
