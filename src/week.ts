// ==========================================
// 📅 週キー (ISO 週 / Asia/Tokyo)
// ==========================================
// 📅 プールは「ISO 年 + 週番号」をキーに週単位で区切る。
// 週の定義は ISO 8601 (月曜始まり、第 1 木曜を含む週が第 1 週)、
// 暦日の判定は Asia/Tokyo で行う。JST は夏時間を持たないため、
// UTC + 9 時間の固定オフセットで安全に計算できる。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------
// 🗓️ JST の暦日への分解
// ------------------------------------------
export interface JstDate {
  year: number;
  // 1-12
  month: number;
  // 1-31
  day: number;
  // 0 = 月曜 .. 6 = 日曜 (ISO 式)
  isoWeekday: number;
  // JST での時 (0-23)
  hour: number;
  minute: number;
}

// 時刻 (UTC の instant) を JST の暦日・時刻に分解する
export function jstParts(instant: Date): JstDate {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS);
  const utcDay = shifted.getUTCDay(); // 0 = 日曜
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    isoWeekday: (utcDay + 6) % 7,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

// ------------------------------------------
// 🔑 ISO 週キー
// ------------------------------------------
// 暦日 (UTC 日付として表したもの) から ISO 週キー "YYYY-Www" を作る。
// ISO 週年は「その週の木曜が属する年」で決まる。
function isoWeekKeyOfUtcDate(utcDate: Date): string {
  const d = new Date(
    Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate()),
  );
  const isoDow = (d.getUTCDay() + 6) % 7; // 0 = 月曜
  // この週の木曜へ移動する
  const thursday = new Date(d.getTime() + (3 - isoDow) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  // ISO 年の最初の木曜 (1 月 4 日を含む週の木曜)
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const firstThursday = new Date(jan4.getTime() + (3 - jan4Dow) * DAY_MS);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

// 任意の時刻が属する ISO 週キー (JST 暦日基準)
export function weekKeyOf(instant: Date): string {
  const p = jstParts(instant);
  return isoWeekKeyOfUtcDate(new Date(Date.UTC(p.year, p.month - 1, p.day)));
}

// 週キーの妥当性チェック ("YYYY-Www" 形式)
export function isWeekKey(s: string): boolean {
  return /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(s);
}

// ------------------------------------------
// 📋 週次サマリの送信判定
// ------------------------------------------
// 月曜 9:00 (JST) に「終わったばかりの週」を 1 回だけサマリする。
// Bot が月曜に止まっていても、再開後の最初のチェックで未送信なら送る
// (キャッチアップ)。戻り値は「サマリすべき週キー」、不要なら null。
// lastSentWeekKey は guild ごとに保持する送信済みフラグ (週キーそのもの)。
export function summaryDueWeek(now: Date, lastSentWeekKey: string | null): string | null {
  const p = jstParts(now);
  // JST 暦日を UTC 日付として扱い、直近の「月曜 9:00」を求める
  const todayUtc = Date.UTC(p.year, p.month - 1, p.day);
  let mondayUtc = todayUtc - p.isoWeekday * DAY_MS;
  if (p.isoWeekday === 0 && p.hour * 60 + p.minute < 9 * 60) {
    // 月曜 9:00 より前なら、直近のサマリ時刻は先週の月曜 9:00
    mondayUtc -= 7 * DAY_MS;
  }
  // サマリ対象は、その月曜の前日 (日曜) が属する週 = 終わったばかりの週
  const sundayUtc = mondayUtc - DAY_MS;
  const targetKey = isoWeekKeyOfUtcDate(new Date(sundayUtc));
  return lastSentWeekKey === targetKey ? null : targetKey;
}
