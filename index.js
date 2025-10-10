import express from "express";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 3000;

const TARGET_URL = "https://mabimobi.life/runes?t=search";
const DATA_FILE = path.join(process.cwd(), "runes.json");

// 메모리 캐시
let RUNES = [];
let lastLoadedAt = null;

// 헬퍼: 로컬 runes.json 로드
function loadLocalJSON() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      RUNES = JSON.parse(raw);
      lastLoadedAt = new Date().toISOString();
      console.log(`📦 로컬 runes.json 로드 완료: ${RUNES.length}개`);
    } else {
      console.log("⚠️ runes.json이 아직 없습니다. /admin/crawl-now 로 생성하세요.");
    }
  } catch (e) {
    console.error("❌ runes.json 로드 오류:", e.message);
  }
}
loadLocalJSON();

// 상태
app.get("/", (_req, res) => {
  res.send(
    "Kakao Rune Bot (Puppeteer ver) is running.<br>" +
      "GET /admin/crawl-now → 최신 룬 데이터 수집<br>" +
      "GET /runes?name=무한 → 룬 검색<br>" +
      `items=${RUNES.length}, lastLoadedAt=${lastLoadedAt ?? "N/A"}`
  );
});

// 🔥 핵심: Puppeteer로 크롤링
app.get("/admin/crawl-now", async (_req, res) => {
  console.log("🔄 Puppeteer 크롤링 시작...");
  let browser;
  try {
    browser = await puppeteer.launch({
       headless: "new",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-gpu",
    "--no-zygote",
    "--single-process",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check"
  ]
});

    const page = await browser.newPage();

    // 브라우저 헤더를 실제 유저처럼
    await page.setExtraHTTPHeaders({
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    );

    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Cloudflare가 로딩을 지연시키는 경우 대비: 실제 테이블 로드될 때까지 대기
    await page.waitForSelector("tr[data-slot='table-row']", { timeout: 60000 });

    // HTML 가져와서 cheerio로 파싱
    const html = await page.content();
    const $ = cheerio.load(html);
    const runes = [];

    $("tr[data-slot='table-row']").each((i, el) => {
      const name = $(el).find("td:nth-child(3) span:last-child").text().trim();
      const grade = $(el).find("td:nth-child(4)").text().trim();
      const desc = $(el).find("td:nth-child(5) span").text().trim();

      let img = $(el).find("img").attr("src") || "";
      if (img && img.startsWith("/")) img = "https://mabimobi.life" + img;

      if (name) {
        runes.push({ name, grade, desc, img });
      }
    });

    await browser.close();

    if (runes.length === 0) {
      throw new Error("룬 데이터를 하나도 찾지 못했습니다. 페이지 구조를 다시 확인하세요.");
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(runes, null, 2));
    RUNES = runes;
    lastLoadedAt = new Date().toISOString();

    console.log(`✅ ${RUNES.length}개의 룬을 저장했습니다.`);
    return res.json({ ok: true, count: RUNES.length, lastLoadedAt });
  } catch (e) {
    console.error("❌ 크롤링 실패:", e.message);
    if (browser) await browser.close().catch(() => {});
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// 룬 검색 API (띄어쓰기 무시, 부분일치)
function norm(s = "") {
  return s.replace(/\s+/g, "").toLowerCase();
}
app.get("/runes", (req, res) => {
  const q = (req.query.name || "").toString().trim();
  if (!q) return res.status(400).json({ ok: false, error: "name 쿼리를 넣어주세요" });

  const nq = norm(q);
  const hits = RUNES.filter(r => norm(r.name).includes(nq));

  if (hits.length === 0) return res.json({ ok: true, count: 0, items: [] });
  return res.json({
    ok: true,
    count: hits.length,
    items: hits.slice(0, 10) // 너무 많으면 10개만
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on :${PORT}`);
});
