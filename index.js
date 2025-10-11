// =======================
// index.js — 완벽 통합 안정 버전 (Render 호환)
// =======================

import express from "express";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

puppeteer.use(StealthPlugin());
const app = express();
const PORT = process.env.PORT || 10000;

// 절대경로 세팅
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNES_FILE = path.join(__dirname, "runes.json");

// 메모리 캐시
let runeCache = [];
let lastLoadedAt = null;

// =======================
// 🧩 유틸: 로드 / 저장
// =======================
function loadRunesFromDisk() {
  try {
    if (fs.existsSync(RUNES_FILE)) {
      const raw = fs.readFileSync(RUNES_FILE, "utf-8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        runeCache = arr;
        lastLoadedAt = new Date().toISOString();
        console.log(`📥 runes.json 로드 완료: ${runeCache.length}개`);
        return true;
      }
    }
  } catch (e) {
    console.warn("⚠️ runes.json 로드 실패:", e.message);
  }
  return false;
}

function saveRunesToDisk(list) {
  fs.writeFileSync(RUNES_FILE, JSON.stringify(list, null, 2), "utf-8");
  console.log(`💾 runes.json 저장 완료 (${list.length}개)`);
}

// 서버 시작 시 로드 시도
loadRunesFromDisk();

// =======================
// 🔄 룬 크롤링 함수
// =======================
async function crawlRunes() {
  console.log("🔄 Puppeteer 크롤링 시작...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--window-size=1280,720",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  );

  console.log("🌐 사이트 접속 중...");
  await page.goto("https://mabimobi.life/runes?t=search", {
    waitUntil: "networkidle2",
    timeout: 180000,
  });

  console.log("⏳ Cloudflare 대기중 (10초)...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  try {
    await page.waitForSelector("tr[data-slot='table-row']", { timeout: 60000 });
  } catch (e) {
    await browser.close();
    throw new Error("⚠️ 룬 테이블을 찾지 못했습니다 (Cloudflare 또는 구조 변경)");
  }

  console.log("✅ 페이지 로드 성공 — 룬 데이터 추출 중...");
  const runeData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr[data-slot='table-row']"));
    return rows.map((row) => {
      const imgTag = row.querySelector("img");
      const img = imgTag ? imgTag.src : "";
      const category = row.querySelectorAll("td")[1]?.innerText.trim() || "";
      const name = row.querySelector("td:nth-child(3) span")?.innerText.trim() || "";
      const grade = row.querySelectorAll("td")[3]?.innerText.trim() || "";
      const effect = row.querySelectorAll("td")[4]?.innerText.trim() || "";
      return { name, category, grade, effect, img };
    });
  });

  await browser.close();

  runeCache = runeData;
  lastLoadedAt = new Date().toISOString();
  saveRunesToDisk(runeData);

  console.log(`✅ ${runeData.length}개의 룬을 저장했습니다.`);
  return runeData.length;
}

// =======================
// 🧩 API 라우트
// =======================

// 수동 룬 크롤링
app.get("/admin/crawl-now", async (req, res) => {
  try {
    const count = await crawlRunes();
    res.json({ ok: true, count, message: `${count}개의 룬 데이터 저장 완료` });
  } catch (error) {
    console.error("❌ 크롤링 실패:", error);
    res.json({ ok: false, error: error.message });
  }
});

// 룬 검색
app.get("/runes", (req, res) => {
  const name = req.query.name?.trim();
  if (!name) return res.json({ ok: false, error: "name parameter required" });

  if (!runeCache.length) loadRunesFromDisk();

  const normalizedQuery = name.replace(/\s+/g, "").toLowerCase();
  const matches = runeCache.filter((r) =>
    r.name.replace(/\s+/g, "").toLowerCase().includes(normalizedQuery)
  );

  if (!matches.length) return res.json({ ok: false, error: "Not found" });

  const main = matches[0];
  res.json({ ok: true, rune: main, count: matches.length });
});

// 상태 확인
app.get("/health", (req, res) => {
  let diskCount = null;
  try {
    if (fs.existsSync(RUNES_FILE)) {
      const raw = fs.readFileSync(RUNES_FILE, "utf-8");
      const arr = JSON.parse(raw);
      diskCount = Array.isArray(arr) ? arr.length : null;
    }
  } catch (_) {}
  res.json({
    ok: true,
    memoryItems: runeCache.length,
    diskItems: diskCount,
    lastLoadedAt,
  });
});

// 디스크에서 강제 로드
app.get("/admin/reload-runes", (req, res) => {
  const ok = loadRunesFromDisk();
  res.json({ ok, memoryItems: runeCache.length, lastLoadedAt });
});

// =======================
// 📰 마비노기 모바일 뉴스 크롤링
// =======================
const NEWS_URLS = {
  notice: "https://mabinogimobile.nexon.com/News/Notice",
  event: "https://mabinogimobile.nexon.com/News/Events?headlineId=2501",
  update: "https://mabinogimobile.nexon.com/News/Update",
  devnote: "https://mabinogimobile.nexon.com/News/Devnote",
  improvement: "https://mabinogimobile.nexon.com/News/Improvement",
};

async function crawlNews(type = "notice", limit = 5) {
  const url = NEWS_URLS[type];
  if (!url) throw new Error("잘못된 뉴스 타입");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

  const items = await page.evaluate((limit) => {
    const anchors = Array.from(document.querySelectorAll("a"))
      .filter((a) => a.href && a.href.includes("mabinogimobile.nexon.com/News"))
      .map((a) => ({
        title: (a.innerText || "").trim().replace(/\s+/g, " "),
        link: a.href,
      }))
      .filter((x) => x.title && x.link)
      .slice(0, limit);
    return anchors;
  }, limit);

  await browser.close();
  console.log(`✅ [NEWS:${type}] ${items.length}개`);
  return items;
}

app.get("/news", async (req, res) => {
  const type = (req.query.type || "notice").toLowerCase();
  const limit = Math.min(parseInt(req.query.limit || "5", 10), 10);
  try {
    const news = await crawlNews(type, limit);
    res.json({ ok: true, type, count: news.length, news });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 뉴스 수동 전체 갱신
app.get("/admin/news-now", async (req, res) => {
  const results = {};
  for (const type of Object.keys(NEWS_URLS)) {
    try {
      results[type] = await crawlNews(type, 5);
    } catch (err) {
      results[type] = { error: err.message };
    }
  }
  res.json({ ok: true, updatedAt: new Date().toISOString(), results });
});

// =======================
// 🚀 서버 시작
// =======================
app.listen(PORT, async () => {
  console.log(`✅ Server running on :${PORT}`);
  console.log("💤 자동 크롤링 비활성화 — 수동 실행만 허용됩니다.");
});
