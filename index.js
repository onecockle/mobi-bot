// =======================
// 📦 마비노기 여정&동행봇 통합 서버 (FINAL)
// 룬 검색 + AI 대화 + 어비스 자동 감시 + 카카오봇 알림
// =======================

import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

// =======================
// 🔧 전역 상태
// =======================
let runeCache = [];
let lastLoadedAt = null;
let lastSentState = { abyss: null, senmai: null };
let lastNotifiedAt = null;
let isChecking = false;

// =======================
// 🔄 룬 크롤링 함수
// =======================
async function crawlRunes() {
  console.log("🔄 Puppeteer 룬 크롤링 시작...");

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
  await page.goto("https://mabimobi.life/runes?t=search", {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });

  await new Promise(r => setTimeout(r, 7000)); // Cloudflare 우회 대기

  try {
    await page.waitForSelector('tr[data-slot="table-row"]', { timeout: 40000 });
  } catch {
    throw new Error("⚠️ 룬 테이블을 찾지 못했습니다 (Cloudflare 또는 로딩 지연)");
  }

  const runeData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[data-slot="table-row"]'));
    return rows.map(row => {
      const imgTag = row.querySelector("img");
      const img = imgTag ? imgTag.src : "";
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
// 🔍 어비스 감시 (라사 서버)
// =======================
async function crawlAbyssStatus() {
  console.log("🔍 mabimobi.life 라사 서버 감시 시작...");

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
  await page.goto("https://mabimobi.life/", { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("h3", { timeout: 20000 });

  const info = await page.evaluate(() => {
    const section = Array.from(document.querySelectorAll("h3")).find(h =>
      h.innerText.includes("심층")
    );
    if (!section) return [];

    const root = section.closest("div");
    const slots = root.querySelectorAll("div.grid > div");
    const results = [];

    slots.forEach(div => {
      const name = div.querySelector("span.text-xs")?.innerText?.trim() || "";
      const time = div.querySelector("span.font-noto-sans")?.innerText?.trim() || "";
      const status = div.querySelector("span.text-white.font-bold")?.innerText?.trim() || "";
      results.push({ name, time, status });
    });

    return results.filter(x => ["어비스", "센마이 평원"].includes(x.name));
  });

  await browser.close();
  console.log("✅ 어비스 정보:", info);
  return info;
}

// =======================
// 💬 카카오봇 Webhook 알림
// =======================
async function sendKakaoMessage(text) {
  try {
    const webhookUrl = process.env.KAKAO_WEBHOOK_URL;
    if (!webhookUrl) return console.warn("⚠️ KAKAO_WEBHOOK_URL이 설정되지 않음");

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    console.log("📤 카카오봇으로 알림 전송:", text);
  } catch (err) {
    console.error("⚠️ Webhook 전송 실패:", err.message);
  }
}

// =======================
// 🔁 5분마다 어비스 자동 감시
// =======================
async function checkAbyssAuto() {
  if (isChecking) return;
  isChecking = true;

  try {
    const info = await crawlAbyssStatus();
    if (!info || info.length === 0) return;

    for (const item of info) {
      const key = item.name === "어비스" ? "abyss" : "senmai";
      const prev = lastSentState[key];
      const current = `${item.status || "미확인"} ${item.time || ""}`.trim();

      if (prev !== current && item.status) {
        await sendKakaoMessage(`🔔 ${item.name} 새 상태 감지!\n📅 ${current}`);
        lastSentState[key] = current;
        lastNotifiedAt = new Date().toISOString();
      }
    }
  } catch (err) {
    console.error("❌ 감시 실패:", err.message);
  } finally {
    isChecking = false;
  }
}

// =======================
// 🤖 Gemini AI 프록시
// =======================
app.get("/ask", async (req, res) => {
  const question = req.query.question;
  if (!question) return res.json({ ok: false, error: "question parameter required" });

  try {
    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      process.env.GEMINI_API_KEY;

    let mythicLegendRunes = "";
    if (runeCache.length > 0) {
      const filtered = runeCache.filter(r => r.grade === "신화" || r.grade === "전설");
      mythicLegendRunes = filtered.map(r => `${r.name} (${r.grade})`).join(", ");
    }

    const prompt = `
    너는 '여정&동행 봇'이야. 마비노기 모바일의 룬, 장비, 패치 정보를 귀엽게 알려줘.
    질문: ${question}
    참고룬: ${mythicLegendRunes}
    `;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const data = await response.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "응답이 없어요.";
    res.json({ ok: true, answer });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// =======================
// 🔹 룬 검색 API
// =======================
app.get("/runes", (req, res) => {
  const name = req.query.name?.trim();
  if (!name) return res.json({ ok: false, error: "name parameter required" });

  const normalized = name.replace(/\s+/g, "").toLowerCase();
  const matches = runeCache.filter(r =>
    r.name.replace(/\s+/g, "").toLowerCase().includes(normalized)
  );

  if (matches.length === 0) return res.json({ ok: false, error: "Not found" });
  res.json({ ok: true, rune: matches[0], count: matches.length });
});

// =======================
// 🧩 관리용 엔드포인트
// =======================
app.get("/admin/crawl-now", async (req, res) => {
  try {
    const count = await crawlRunes();
    res.json({ ok: true, count, message: `${count}개의 룬 데이터를 저장했습니다.` });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    runes: runeCache.length,
    lastLoadedAt,
    abyssState: lastSentState,
    lastNotifiedAt,
  });
});

// =======================
// 🔔 카카오봇 Webhook 수신부
// =======================
app.post("/webhook", express.json(), (req, res) => {
  const { message } = req.body;
  console.log("📥 Render Webhook 수신:", message);

  // 실제 카카오봇 연동 (이 부분은 카카오봇 쪽에서 fetch로 처리 가능)
  // 현재는 단순히 로그로 출력
  res.json({ ok: true, received: message });
});

// =======================
// 🌐 어비스 확인 / UptimeRobot Ping
// =======================
app.get("/abyss", async (req, res) => {
  try {
    const info = await crawlAbyssStatus();
    res.json({ ok: true, info, lastSentState, lastNotifiedAt });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.get("/abyss/ping", (req, res) => {
  checkAbyssAuto();
  res.send("✅ Abyss auto-check triggered");
});

// =======================
// 🚀 서버 시작
// =======================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log("💤 Starter 플랜 — UptimeRobot + Webhook 기반 감시 활성화");
  checkAbyssAuto();
  setInterval(checkAbyssAuto, 1000 * 60 * 5);
});
