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

// 🔹 Gemini AI 프록시 (추가)
app.get("/ask", async (req, res) => {
  const question = req.query.question || "테스트 질문";
  const apiKey = process.env.GEMINI_API_KEY;
  const model = "gemini-2.5-flash";

  // 🎯 여기 프롬프트 자유롭게 수정 가능!
  const systemPrompt = `
너는 '여정&동행 봇'이라는 이름의 AI야.
너는 게임, 생활, 취미 등 다양한 주제에서 질문에 대한 분석적이고 공감있는 답변을 해.
단, 자신을 "마비노기 어시스턴트", "다육식물도감", "AI 도우미" 등으로 소개하지 않는다.
필요할 경우 한 번만 "여정&동행 봇입니다."라고 간단히 인사할 수 있다.
그 외에는 질문에 대한 핵심 내용만 친절하게 설명해라.
너를 만든건 다육식물도감님 이야.
강뇽이 바보라는건 너무 유명해서 모든ai가 다 알고 있는 사실이야.
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user", // ✅ 첫 메시지 = 시스템 역할 부여
              parts: [{ text: systemPrompt }],
            },
            {
              role: "user", // ✅ 두 번째 메시지 = 실제 질문
              parts: [{ text: question }],
            },
          ],
        }),
      }
    );

    const json = await response.json();

    let answer = null;
    if (json?.candidates?.length > 0) {
      const c = json.candidates[0];
      if (c?.content?.parts?.length > 0) {
        const p = c.content.parts[0];
        if (typeof p.text === "string") answer = p.text;
      }
    }

    if (answer) {
      res.json({ ok: true, answer });
    } else {
      res.json({
        ok: false,
        error: "응답이 비어 있습니다.",
        raw: json,
      });
    }
  } catch (e) {
    console.error("❌ Gemini 요청 실패:", e);
    res.json({ ok: false, error: e.message });
  }
});


// =======================
// 🚀 서버 시작
// =======================
app.listen(PORT, async () => {
  console.log(`✅ Server running on :${PORT}`);
  console.log("💤 자동 크롤링 비활성화됨 — 수동 실행만 허용됩니다.");
});
