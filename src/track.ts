// ==========================================
// 🎵 曲入力のパースと正規化
// ==========================================
// 🎵 /add の入力は次の 3 形式を受ける:
//   - Spotify トラック URL: https://open.spotify.com/track/<id>
//     (クエリ・ロケール付き可)
//   - Spotify URI:          spotify:track:<id>
//   - 自由テキスト:          曲名・アーティスト名など
// URL / URI からはトラック ID を抽出して正規化し、重複判定キーにする。

// Spotify のトラック ID は 22 文字の Base62
const TRACK_ID_PATTERN = "[A-Za-z0-9]{22}";
const URL_RE = new RegExp(
  `^https?://open\\.spotify\\.com/(?:intl-[a-z]{2}(?:-[a-z]{2})?/)?track/(${TRACK_ID_PATTERN})(?:[/?#].*)?$`,
  "i",
);
const URI_RE = new RegExp(`^spotify:track:(${TRACK_ID_PATTERN})$`, "i");

export interface ParsedTrackInput {
  // Spotify トラック ID (URL / URI 入力のときだけ)
  trackId: string | null;
  // 一覧表示用テキスト (トラックは正規化済み URL、自由入力は入力そのもの)
  text: string;
  // 重複判定キー: "spotify:<id>" または "text:<正規化テキスト>"
  key: string;
}

// 正規化済みの Spotify トラック URL
export function trackUrl(trackId: string): string {
  return `https://open.spotify.com/track/${trackId}`;
}

// 自由テキストの重複判定用正規化: 前後空白除去・連続空白の圧縮・小文字化
export function normalizeFreeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// 入力をパースする。空文字は null を返す (呼び出し側でエラーにする)
export function parseTrackInput(raw: string): ParsedTrackInput | null {
  const input = raw.trim();
  if (!input) return null;
  const urlMatch = URL_RE.exec(input);
  if (urlMatch) {
    const trackId = urlMatch[1];
    return { trackId, text: trackUrl(trackId), key: `spotify:${trackId}` };
  }
  const uriMatch = URI_RE.exec(input);
  if (uriMatch) {
    const trackId = uriMatch[1];
    return { trackId, text: trackUrl(trackId), key: `spotify:${trackId}` };
  }
  return { trackId: null, text: input, key: `text:${normalizeFreeText(input)}` };
}

// Spotify 検索ページの URL (フォールバック表示用)
export function spotifySearchUrl(text: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(text)}`;
}
