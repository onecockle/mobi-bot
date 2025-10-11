// =======================
// index.js (Render Starter 최적화 완성 버전)
// =======================

import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

// ---------------------------
// 전역 상태 관리
// ---------------------------
let runeCache = [];
let lastLoadedAt = null;
let isCrawlingNews = false;
let browserInstance = null;

// =======================
// 🧠 Puppeteer 브라우저 재사용
// =======================
async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
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
    console.log("✅ Puppeteer 브라우저 인스턴스 생성됨");
  }
  return browserInstance;
}

// =======================
// 🔄 룬 크롤링 (수동 전용)
// =======================
async function crawlRunes() {
  console.log("🔄 룬 크롤링 시작...");
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
  );

  await page.goto("https://mabimobi.life/runes?t=search", {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await new Promise((resolve) => setTimeout(resolve, 7000));

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

  runeCache = runeData;
  lastLoadedAt = new Date().toISOString();
  fs.writeFileSync("runes.json", JSON.stringify(runeData, null, 2));
  console.log(`✅ ${runeData.length}개의 룬 저장 완료`);
  await page.close();
  return runeData.length;
}

// =======================
// 📢 뉴스 크롤링 (자동 주기)
// =======================
const NEWS_URLS = {
  notice: "https://mabinogimobile.nexon.com/News/Notice",
  event: "https://mabinogimobile.nexon.com/News/Events?headlineId=2501",
  update: "https://mabinogimobile.nexon.com/News/Update",
  devnote: "https://mabinogimobile.nexon.com/News/Devnote",
  improvement: "https://mabinogimobile.nexon.com/News/Improvement",
};

async function crawlNews(type = "notice", limit = 5) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  const url = NEWS_URLS[type] || NEWS_URLS.notice;
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
        list.push({
          title: title.replace(/\s+/g, " "),
          link: a.href,
          date: date.trim(),
        });
      }
    });
    return list.slice(0, limit);
  }, limit);

  await page.close();
  console.log(`✅ [NEWS:${type}] ${items.length}개`);
  return items;
}

// 뉴스 캐시
let newsCache = {};

// 🔹 /news 엔드포인트
app.get("/news", async (req, res) => {
  const type = (req.query.type || "notice").toLowerCase();
  const limit = Math.min(parseInt(req.query.limit || "5", 10), 10);
  try {
    const data = newsCache[type] || [];
    res.json({ ok: true, type, count: data.length, news: data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 🔁 자동 뉴스 갱신
async function refreshNewsAll() {
  if (isCrawlingNews) return;
  isCrawlingNews = true;

  console.log("🕐 자동 뉴스 갱신 시작");
  for (const type of Object.keys(NEWS_URLS)) {
    try {
      newsCache[type] = await crawlNews(type, 5);
    } catch (err) {
      console.error(`❌ ${type} 뉴스 갱신 실패:`, err.message);
    }
  }
  console.log("✅ 모든 뉴스 갱신 완료");
  isCrawlingNews = false;
}

// 10분마다 자동 뉴스 갱신
setInterval(refreshNewsAll, 600000); // 600000ms = 10분
// 서버 시작 시 1회 실행
setTimeout(refreshNewsAll, 5000);

// =======================
// 🔹 룬 검색 엔드포인트
// =======================
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

// 🔹 수동 룬 크롤링
app.get("/admin/crawl-now", async (req, res) => {
  try {
    const count = await crawlRunes();
    res.json({ ok: true, count, message: `${count}개의 룬이 저장되었습니다.` });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 🔹 서버 상태
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    runes: runeCache.length,
    newsTypes: Object.keys(newsCache),
    lastLoadedAt,
  });
});

// =======================
// 🚀 서버 시작
// =======================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log("💤 룬은 수동 크롤링만, 뉴스는 자동 갱신으로 작동합니다.");
});
