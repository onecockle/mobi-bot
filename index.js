// =======================
// index.js (GitHub JSON + 캐시 복원 + /runes + /ask)
// - GitHub의 runes.json 원격 로드 (수동 크롤링 제거)
// - 디스크 캐시(fallback) 자동 복원/저장
// - /runes: 이름 부분검색 API
// - /ask: Gemini 프록시 (룬 요약 일부 주입)
// - /admin/reload: GitHub에서 즉시 재로딩
// =======================

import express from "express";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

// ===== ENV =====
// 필요 시 Render → Environment에 설정 가능
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || ""; // 없으면 /ask 비활성 처리
const RUNE_JSON_URL =
  process.env.RUNE_JSON_URL ||
  "https://raw.githubusercontent.com/onecockle/mobi-bot/main/runes.json"; // <- 사용자의 GitHub 기본값

// ===== 상태/캐시 =====
let runeCache = [];
let lastLoadedAt = null;
const CACHE_FILE = "runes.json"; // 디스크 캐시 (fallback)

// =======================
// 공용: GitHub에서 룬 로드 (+디스크 저장)
// =======================
async function fetchRunesFromGitHub() {
  const res = await fetch(RUNE_JSON_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("JSON 형식 오류: 배열이 아님");
  }
  return data;
}

function loadRunesFromDisk() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function saveRunesToDisk(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.warn("⚠️ 디스크 캐시 저장 실패:", e.message);
  }
}

async function loadRunesOnStartup() {
  // 1) GitHub 시도 → 2) 실패 시 디스크 fallback
  try {
    const data = await fetchRunesFromGitHub();
    runeCache = data;
    lastLoadedAt = new Date().toISOString();
    saveRunesToDisk(data);
    console.log(`✅ GitHub에서 ${data.length}개 룬 로드 완료`);
  } catch (e) {
    console.warn("⚠️ GitHub 로드 실패:", e.message);
    const local = loadRunesFromDisk();
    if (local) {
      runeCache = local;
      lastLoadedAt = new Date().toISOString() + " (from-disk)";
      console.log(`💾 디스크 캐시에서 ${local.length}개 룬 복원`);
    } else {
      console.error("❌ 룬 데이터를 로드할 수 없습니다 (원격/로컬 모두 실패)");
    }
  }
}

// =======================
// 유틸: 부분검색 (공백/대소문자 무시)
// =======================
function norm(s = "") {
  return String(s).replace(/\s+/g, "").toLowerCase();
}

// =======================
// 라우트
// =======================

// 헬스
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    items: runeCache.length,
    lastLoadedAt,
    source: RUNE_JSON_URL,
  });
});

// 룬 검색 (이름 부분검색, 첫 매치 반환 + 총 매치수)
app.get("/runes", (req, res) => {
  const name = req.query.name?.trim();
  if (!name) return res.json({ ok: false, error: "name parameter required" });

  const q = norm(name);
  const matches = runeCache.filter((r) => norm(r.name).includes(q));

  if (matches.length === 0) {
    return res.json({ ok: false, error: "Not found" });
  }
  const main = matches[0];
  res.json({ ok: true, rune: main, count: matches.length });
});

// GitHub에서 즉시 재로딩 (수동 갱신)
app.get("/admin/reload", async (req, res) => {
  try {
    const data = await fetchRunesFromGitHub();
    runeCache = data;
    lastLoadedAt = new Date().toISOString();
    saveRunesToDisk(data);
    res.json({ ok: true, count: data.length, at: lastLoadedAt });
    console.log(`🔄 수동 재로딩 완료 — ${data.length}개`);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Gemini 프록시 (/ask)
// - GEMINI_API_KEY가 없으면 에러 반환
app.get("/ask", async (req, res) => {
  const question = req.query.question?.trim();
  if (!question) return res.json({ ok: false, error: "question parameter required" });
  if (!GEMINI_API_KEY) return res.json({ ok: false, error: "GEMINI_API_KEY is not set" });

  // 신화/전설 일부를 프롬프트에 보강(있으면)
  let mythicLegend = "";
  try {
    if (Array.isArray(runeCache) && runeCache.length > 0) {
      mythicLegend = runeCache
        .filter((r) => r.grade === "신화" || r.grade === "전설")
        .slice(0, 50)
        .map((r) => `${r.name}(${r.grade})`)
        .join(", ");
    }
  } catch {}

  const prompt = `
너는 '여정&동행 봇'이야. 마비노기 모바일 정보를 친근하게 알려줘.
룬에 관해 물으면 이름/분류/등급/효과를 정확히 설명해.
아래는 신화/전설 일부 목록이야(있으면 참고만 해):
${mythicLegend || "(데이터 없음)"}

답변은 100자 이내로 자연스럽게. 가끔 어미에 '뇽'을 붙여도 돼.
질문: ${question}
`.trim();

  try {
    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      GEMINI_API_KEY;

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const data = await resp.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    res.json({ ok: true, answer: answer || "응답이 없어요." });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// =======================
// 서버 시작
// =======================
app.listen(PORT, async () => {
  console.log(`✅ Server running on :${PORT}`);
  await loadRunesOnStartup();
  console.log("💤 자동 크롤링은 제거됨 — GitHub JSON만 사용합니다.");
});
