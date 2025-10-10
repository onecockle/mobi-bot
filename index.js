// index.js
import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

let runeCache = [];
let lastLoadedAt = null;

// =======================
// 🔄 크롤링 함수
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

  // Cloudflare 회피용 대기 (기존 waitForTimeout 제거)
  await new Promise((resolve) => setTimeout(resolve, 7000)); // 7초 대기

  // "룬" 테이블이 나타날 때까지 최대 30초 대기
  try {
    await page.waitForSelector("table tbody tr", { timeout: 30000 });
  } catch (e) {
    throw new Error("⚠️ 룬 테이블을 찾지 못했습니다 (Cloudflare 또는 로딩 지연)");
  }

  // HTML 확인
  const html = await page.content();
  if (html.includes("Just a moment")) {
    throw new Error("Cloudflare challenge detected. Try again later.");
  }

  console.log("✅ 페이지 로드 성공 — 룬 데이터 추출 중...");

  // ====== 룬 테이블 크롤링 ======
  const runeData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    return rows.map((row) => {
      const img = row.querySelector("img")?.src || "";
      const category = row.children[1]?.innerText.trim();
      const name = row.children[2]?.innerText.trim();
      const grade = row.children[3]?.innerText.trim();
      const effect = row.children[4]?.innerText.trim();
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

// 수동 크롤링 갱신
app.get("/admin/crawl-now", async (req, res) => {
  try {
    const count = await crawlRunes();
    res.json({ ok: true, count });
  } catch (error) {
    console.error("❌ 크롤링 실패:", error);
    res.json({ ok: false, error: error.message });
  }
});

// 룬 검색
app.get("/runes", (req, res) => {
  const name = req.query.name?.trim();
  if (!name) return res.json({ ok: false, error: "name parameter required" });

  const result = runeCache.find((r) => r.name.includes(name));
  if (!result) return res.json({ ok: false, error: "Not found" });

  res.json({ ok: true, rune: result });
});

// 서버 상태
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    items: runeCache.length,
    lastLoadedAt,
  });
});

// 서버 시작
app.listen(PORT, async () => {
  console.log(`✅ Server running on :${PORT}`);
  try {
    await crawlRunes();
  } catch (err) {
    console.error("⚠️ 초기 크롤 실패:", err.message);
  }
});
