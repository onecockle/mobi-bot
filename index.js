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
  console.log("🔄 룬 크롤링 시작...");
  const browser = await createBrowser();
  const page = await browser.newPage();

  await page.goto("https://mabimobi.life/runes?t=search", {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await new Promise((resolve) => setTimeout(resolve, 12000));

  try {
    await page.waitForSelector('tr[data-slot="table-row"]', { timeout: 40000 });
  } catch {
    throw new Error("⚠️ 룬 테이블을 찾지 못했습니다 (Cloudflare 또는 로딩 지연)");
  }

  const runeData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[data-slot="table-row"]'));
    return rows.map((row) => {
      const img = row.querySelector("img")?.src || "";
      const category = row.querySelectorAll("td")[1]?.innerText.trim() || "";
      const name = row.querySelectorAll("td")[2]?.innerText.trim() || "";
      const grade = row.querySelectorAll("td")[3]?.innerText.trim() || "";
      const effect = row.querySelectorAll("td")[4]?.innerText.trim() || "";
      return { name, category, grade, effect, img };
    });
  });

  await browser.close();
  runeCache = runeData;
  lastLoadedAt = new Date().toISOString();
  fs.writeFileSync("runes.json", JSON.stringify(runeData, null, 2));
  console.log(`✅ ${runeData.length}개의 룬 저장 완료`);
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
