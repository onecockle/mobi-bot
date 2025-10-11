// =======================
// index.js (수동 뉴스 + 수동 룬 안정 버전)
// =======================

import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

let runeCache = [];
let lastLoadedAt = null;

// =======================
// 🧠 Puppeteer 실행 함수
// =======================
async function createBrowser() {
  return await puppeteer.launch({
    headless: "false",
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
}

// =======================
// 🔮 룬 크롤링 (수동 전용)
// =======================
async function crawlRunes() {
  console.log("🔄 Puppeteer 크롤링 시작...");
  console.log("🧭 Chrome Path:", process.env.PUPPETEER_EXECUTABLE_PATH);

  const browser = await puppeteer.launch({
    headless: false, // 👈 반드시 false로 (탐지 방지)
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--single-process",
      "--window-size=1280,720",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  );

  // 💡 클라우드플레어 방어 회피용 헤더
  await page.setExtraHTTPHeaders({
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Referer": "https://www.google.com/",
  });

  console.log("🌐 사이트 접속 중...");
  await page.goto("https://mabimobi.life/runes?t=search", {
    waitUntil: "networkidle2",
    timeout: 180000,
  });

  // ⏳ Cloudflare 대기 (최소 15초)
  console.log("⏳ Cloudflare 체크 대기 중...");
  await new Promise((resolve) => setTimeout(resolve, 15000));

  // 💬 HTML 검사
  const html = await page.content();
  if (html.includes("Just a moment")) {
    console.error("⚠️ Cloudflare challenge still detected.");
    throw new Error("⚠️ Cloudflare 우회 실패 — 브라우저 탐지됨");
  }

  // 💡 테이블이 표시될 때까지 기다림
  try {
    await page.waitForSelector("tr[data-slot='table-row']", { timeout: 60000 });
  } catch (e) {
    const body = await page.content();
    fs.writeFileSync("debug_page.html", body);
    throw new Error("⚠️ 룬 테이블을 찾지 못했습니다 (Cloudflare 또는 구조 변경)");
  }

  console.log("✅ 페이지 로드 성공 — 룬 데이터 추출 중...");

  const runeData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr[data-slot='table-row']"));
    return rows.map((row) => {
      const imgTag = row.querySelector("img");
      const img = imgTag ? imgTag.src : "";
      const category = row.querySelectorAll("td")[1]?.innerText.trim() || "";
      const name =
        row.querySelector("td:nth-child(3) span")?.innerText.trim() || "";
      const grade = row.querySelectorAll("td")[3]?.innerText.trim() || "";
      const effect = row.querySelectorAll("td")[4]?.innerText.trim() || "";
      return { name, category, grade, effect, img };
    });
  });

  await browser.close();

  fs.writeFileSync("runes.json", JSON.stringify(runeData, null, 2));
  console.log(`✅ ${runeData.length}개의 룬을 저장했습니다.`);

  return runeData.length;
}

// =======================
// 📰 뉴스 크롤링 (수동 전용)
// =======================
const NEWS_URLS = {
  notice: "https://mabinogimobile.nexon.com/News/Notice",
  event: "https://mabinogimobile.nexon.com/News/Events?headlineId=2501",
  update: "https://mabinogimobile.nexon.com/News/Update",
  devnote: "https://mabinogimobile.nexon.com/News/Devnote",
  improvement: "https://mabinogimobile.nexon.com/News/Improvement",
};

async function crawlNews(type = "notice", limit = 5) {
  if (!Object.keys(NEWS_URLS).includes(type)) {
    throw new Error(`Invalid type: ${type}`);
  }

  const browser = await createBrowser();
  const page = await browser.newPage();
  const url = NEWS_URLS[type];

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  const items = await page.evaluate((limit) => {
    const list = [];
    document.querySelectorAll("a").forEach((a) => {
      const title = (a.innerText || "").trim();
      if (a.href.includes("mabinogimobile.nexon.com/News") && title.length > 3) {
        const date =
          a.closest("tr")?.querySelector(".date")?.innerText ||
          a.closest("li")?.querySelector(".date")?.innerText ||
          "";
        list.push({ title, link: a.href, date: date.trim() });
      }
    });
    return list.slice(0, limit);
  }, limit);

  await browser.close();
  console.log(`✅ [NEWS:${type}] ${items.length}개`);
  return items;
}

// =======================
// 🧩 API 라우트
// =======================

// 🔹 수동 룬 크롤링
app.get("/admin/crawl-now", async (req, res) => {
  try {
    const count = await crawlRunes();
    res.json({ ok: true, count, message: `${count}개의 룬 저장 완료` });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 🔹 수동 뉴스 크롤링 (모든 탭)
app.get("/admin/news-now", async (req, res) => {
  const results = {};
  try {
    for (const type of Object.keys(NEWS_URLS)) {
      results[type] = await crawlNews(type, 5);
    }
    res.json({
      ok: true,
      message: "✅ 모든 뉴스 데이터를 수동으로 갱신했습니다.",
      updatedAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 🔹 룬 검색
app.get("/runes", (req, res) => {
  const name = req.query.name?.trim();
  if (!name) return res.json({ ok: false, error: "name parameter required" });

  const normalizedQuery = name.replace(/\s+/g, "").toLowerCase();
  const matches = runeCache.filter((r) =>
    r.name.replace(/\s+/g, "").toLowerCase().includes(normalizedQuery)
  );

  if (!matches.length) return res.json({ ok: false, error: "Not found" });
  res.json({ ok: true, rune: matches[0], count: matches.length });
});

// 🔹 서버 상태
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    runeItems: runeCache.length,
    lastLoadedAt,
  });
});

// =======================
// 🚀 서버 시작
// =======================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log("📢 뉴스 및 룬 모두 수동 크롤링 전용 모드로 실행 중");
});
