// =======================
// index.js (수동 크롤링 전용 안정 버전)
// =======================

import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

let runeCache = [];
let lastLoadedAt = null;

// =======================
// 🔄 룬 크롤링 함수
// =======================
async function crawlRunes() {
  console.log("🔄 Puppeteer 크롤링 시작...");
  console.log("🧭 Chrome Path:", process.env.PUPPETEER_EXECUTABLE_PATH);

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--single-process",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
  );

  console.log("🌐 사이트 접속 중...");
  await page.goto("https://mabimobi.life/runes?t=search", {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });

  // Cloudflare 회피 대기
  await new Promise((resolve) => setTimeout(resolve, 7000));

  // 룬 테이블 로드 대기
  try {
    await page.waitForSelector('tr[data-slot="table-row"]', { timeout: 40000 });
  } catch (e) {
    throw new Error("⚠️ 룬 테이블을 찾지 못했습니다 (Cloudflare 또는 로딩 지연)");
  }

  const html = await page.content();
  if (html.includes("Just a moment")) {
    throw new Error("⚠️ Cloudflare challenge detected. Try again later.");
  }

  console.log("✅ 페이지 로드 성공 — 룬 데이터 추출 중...");

  // ====== 룬 테이블 크롤링 ======
  const runeData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[data-slot="table-row"]'));
    return rows.map((row) => {
      const imgTag = row.querySelector("img");
      const img = imgTag
        ? imgTag.src.replace(/^\/_next\/image\?url=/, "https://mabimobi.life/_next/image?url=")
        : "";

      const category = row.querySelectorAll("td")[1]?.innerText.trim() || "";

      const nameEl =
        row.querySelector("td:nth-child(3) span[class*='text-[rgba(235,165,24,1)]']") ||
        row.querySelector("td:nth-child(3) span:last-child");
      const name = nameEl ? nameEl.innerText.trim() : "";

      const grade = row.querySelectorAll("td")[3]?.innerText.trim() || "";
      const effect = row.querySelectorAll("td")[4]?.innerText.trim() || "";

      return { name, category, grade, effect, img };
    });
  });

  await browser.close();

  runeCache = runeData;
  lastLoadedAt = new Date().toISOString();

  fs.writeFileSync("runes.json", JSON.stringify(runeData, null, 2));
  console.log(`✅ ${runeData.length}개의 룬을 저장했습니다.`);

  return runeData.length;
}

// =======================
// 🧩 API 라우트
// =======================

// 🔹 수동 크롤링 실행
app.get("/admin/crawl-now", async (req, res) => {
  try {
    const count = await crawlRunes();
    res.json({ ok: true, count, message: `${count}개의 룬 데이터가 새로 저장되었습니다.` });
  } catch (error) {
    console.error("❌ 크롤링 실패:", error);
    res.json({ ok: false, error: error.message });
  }
});

// 🔹 룬 검색
app.get("/runes", (req, res) => {
  const name = req.query.name?.trim();
  if (!name) return res.json({ ok: false, error: "name parameter required" });

  // 전체 소문자 / 공백 제거 버전
  const normalizedQuery = name.replace(/\s+/g, "").toLowerCase();

  // 모든 룬 이름에서 공백 제거 후 비교
  const matches = runeCache.filter((r) => {
    const normalizedRune = r.name.replace(/\s+/g, "").toLowerCase();
    return normalizedRune.includes(normalizedQuery);
  });

  if (matches.length === 0) {
    return res.json({ ok: false, error: "Not found" });
  }

  // 첫 번째 결과만 보내되, 여러 개면 목록도 같이 보여주기
  const main = matches[0];
  res.json({ ok: true, rune: main, count: matches.length });
});

// 🔹 서버 상태
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    items: runeCache.length,
    lastLoadedAt,
  });
});

// 🔹 Gemini AI 프록시
app.get("/ask", async (req, res) => {
  const question = req.query.question;
  if (!question) return res.json({ ok: false, error: "question parameter required" });

  try {
    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      process.env.GEMINI_API_KEY;

    let mythicLegendRunes = "";
    try {
      if (runeCache && runeCache.length > 0) {
        const filtered = runeCache.filter((r) => r.grade === "신화" || r.grade === "전설");
        if (filtered.length > 0) {
          mythicLegendRunes = filtered.map((r) => `${r.name} (${r.grade})`).join(", ");
        } else {
          mythicLegendRunes = "현재 신화/전설 등급 룬 데이터를 불러오지 못했뇽!";
        }
      }
    } catch (err) {
      console.warn("⚠️ runeCache 필터링 실패:", err.message);
    }

    const prompt = `
너는 'S봇'이라는 이름의 AI야.
마비노기 모바일 게임의 전문 지식을 가진 친구야. 게임 정보를 이해하고 답변할 수 있어.
아래는 현재 신화 및 전설 등급 룬 데이터야:
${mythicLegendRunes}

공식 정보처럼 정확하게 설명하되, 문장은 귀엽고 친근하게 써.
가끔 뇽체 써줘. (ex.반갑다뇽~!, 고맙다뇽)
게임, 생활, 취미 등 다양한 주제에서 짧게 대답해.
답변은 100자 이내로, 문체는 자연스럽고 너무 인위적이지 않게 써.
자신을 "AI 도우미", "마비노기 어시스턴트", "다육식물도감" 등으로 소개하지 않아.
질문이 게임과 관련 없더라도 대답해줘.
모르는 정보를 물어보면 퐉씨! 그런건 모른다뇽 라고 대답해도 돼. 다만, 자주 말하지마.

질문: ${question}
`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    const data = await response.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    const fallback = "퐉씨! 답하기 쉽게 물어보라뇽 💬";
    const finalAnswer = answer && answer.length > 10 ? answer : fallback;

    res.json({ ok: true, answer: finalAnswer });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// =======================
// 🚀 서버 시작
// =======================
app.listen(PORT, async () => {
  console.log(`✅ Server running on :${PORT}`);
  console.log("💤 자동 크롤링 비활성화됨 — 수동 실행만 허용됩니다.");
});
