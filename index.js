// =======================
// index.js (통합 안정 버전)
// - 수동 룬 크롤링
// - /runes 검색 API
// - /ask (Gemini 프록시)
// - 라사 서버 어비스/센마이 평원 감지 → 디스코드 알림 (5분마다)
// - /admin/abyss-check 수동 트리거
// =======================

import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

// ===== ENV =====
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY || "AIzaSyB6ElQ5Oe3SfclNWqF8ZwWIUc4Og4UXR5g"; // 필수(ask 사용 시)
const DISCORD_WEBHOOK  = process.env.DISCORD_WEBHOOK || "https://discordapp.com/api/webhooks/1426752338617700472/oms1AP5mh9DEV70zNTVYcsqoMlkqnZ52uhQ8_ELhiTu5N7Nup1guSKko7PDdRuTcrgBS"; // 디스코드 웹훅 URL
// 테스트로 하드코딩하려면 아래처럼 사용 가능
// const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/xxxx/xxxx";

// ===== 공용 상태 =====
let runeCache = [];           // 메모리 캐시
let lastLoadedAt = null;      // 룬 크롤 시각
const RUNE_JSON_PATH = "./runes.json";

// ---- 어비스 감지 상태 (중복알림 방지) ----
let lastSeen = { abyss: false, senmai: false }; // 직전 체크 시 활성 여부
let lastSentAt = { abyss: 0, senmai: 0 };       // 마지막 전송 시각(ms)
const DEDUP_WINDOW_MS = 5 * 60 * 1000;          // 5분 중복 방지
let lastAbyssCheckAt = null;

// =======================
// 공용: 브라우저 런처
// =======================
async function launchBrowser() {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--single-process",
    ],
  });
  return browser;
}
// ========= Discord Webhook helper =========
async function sendDiscord(text) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) throw new Error("DISCORD_WEBHOOK_URL 환경변수가 없습니다.");

  const payload = {
    content: text,           // 기본 텍스트
    // 필요하면 embeds 도 추가 가능
    // embeds: [{ title: "테스트", description: text, color: 0x5865F2 }],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Discord webhook error: ${resp.status} ${resp.statusText} ${body}`);
  }
}



// =======================
// 🔄 룬 크롤링 (수동 전용)
// =======================
async function crawlRunes() {
  console.log("🔄 Puppeteer 크롤링 시작...");
  console.log("🧭 Chrome Path:", process.env.PUPPETEER_EXECUTABLE_PATH);

  const browser = await launchBrowser();
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
  await new Promise((r) => setTimeout(r, 7000));

  try {
    await page.waitForSelector('tr[data-slot="table-row"]', { timeout: 40000 });
  } catch {
    await browser.close();
    throw new Error("⚠️ 룬 테이블을 찾지 못했습니다 (Cloudflare 또는 로딩 지연)");
  }

  const html = await page.content();
  if (html.includes("Just a moment")) {
    await browser.close();
    throw new Error("⚠️ Cloudflare challenge detected. Try again later.");
  }

  console.log("✅ 페이지 로드 성공 — 룬 데이터 추출 중...");
  const runeData = await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('tr[data-slot="table-row"]')
    );
    return rows.map((row) => {
      const imgTag = row.querySelector("img");
      const img = imgTag
        ? imgTag.src.replace(
            /^\/_next\/image\?url=/,
            "https://mabimobi.life/_next/image?url="
          )
        : "";

      const category = row.querySelectorAll("td")[1]?.innerText.trim() || "";

      const nameEl =
        row.querySelector(
          "td:nth-child(3) span[class*='text-[rgba(235,165,24,1)]']"
        ) || row.querySelector("td:nth-child(3) span:last-child");
      const name = nameEl ? nameEl.innerText.trim() : "";

      const grade = row.querySelectorAll("td")[3]?.innerText.trim() || "";
      const effect = row.querySelectorAll("td")[4]?.innerText.trim() || "";

      return { name, category, grade, effect, img };
    });
  });

  await browser.close();

  runeCache = runeData;
  lastLoadedAt = new Date().toISOString();
  fs.writeFileSync(RUNE_JSON_PATH, JSON.stringify(runeData, null, 2));
  console.log(`✅ ${runeData.length}개의 룬을 저장했습니다.`);

  return runeData.length;
}

// 서버 기동 시 디스크 캐시 복구
try {
  if (fs.existsSync(RUNE_JSON_PATH)) {
    const raw = fs.readFileSync(RUNE_JSON_PATH, "utf8");
    runeCache = JSON.parse(raw);
    lastLoadedAt = "from-disk";
    console.log(`💾 디스크에서 ${runeCache.length}개 룬 로드`);
  }
} catch (e) {
  console.warn("⚠️ 디스크 캐시 로드 실패:", e.message);
}

// =======================
// 🧩 API 라우트
// =======================

// 수동 룬 크롤링
app.get("/admin/crawl-now", async (req, res) => {
  try {
    const count = await crawlRunes();
    res.json({
      ok: true,
      count,
      message: `${count}개의 룬 데이터가 새로 저장되었습니다.`,
    });
  } catch (error) {
    console.error("❌ 크롤링 실패:", error);
    res.json({ ok: false, error: error.message });
  }
});

// ========= 디스코드 웹훅 테스트 =========
// 예) GET /admin/test-discord
// 예) GET /admin/test-discord?text=안녕_웹훅
app.get("/admin/test-discord", async (req, res) => {
  try {
    const msg = req.query.text
      ? String(req.query.text).slice(0, 1500)  // 길이 안전
      : "✅ 디스코드 웹훅 연결 테스트 성공! (mobi-bot)";

    await sendDiscord(msg);
    res.json({ ok: true, sent: msg, at: new Date().toISOString() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});


// 룬 검색
app.get("/runes", (req, res) => {
  const name = req.query.name?.trim();
  if (!name) return res.json({ ok: false, error: "name parameter required" });

  const normalizedQuery = name.replace(/\s+/g, "").toLowerCase();

  const matches = runeCache.filter((r) => {
    const normalizedRune = r.name.replace(/\s+/g, "").toLowerCase();
    return normalizedRune.includes(normalizedQuery);
  });

  if (matches.length === 0) {
    return res.json({ ok: false, error: "Not found" });
  }

  const main = matches[0];
  res.json({ ok: true, rune: main, count: matches.length });
});

// 헬스
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    items: runeCache.length,
    lastLoadedAt,
    abyss: {
      lastAbyssCheckAt,
      lastSentAt,
      lastSeen,
    },
  });
});


// =======================
// 🔹 Gemini 프록시 (/ask)
// =======================
app.get("/ask", async (req, res) => {
  const question = req.query.question;
  if (!question) return res.json({ ok: false, error: "question parameter required" });

  if (!GEMINI_API_KEY) {
    return res.json({ ok: false, error: "GEMINI_API_KEY is not set" });
  }

  try {
    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      GEMINI_API_KEY;

    // 신화/전설 일부를 프롬프트에 보강(있으면)
    let mythicLegend = "";
    try {
      if (runeCache && runeCache.length > 0) {
        mythicLegend = runeCache
          .filter((r) => r.grade === "신화" || r.grade === "전설")
          .slice(0, 50)
          .map((r) => `${r.name}(${r.grade})`)
          .join(", ");
      }
    } catch {}

    const prompt = `
너는 '뇽봇'이라는 이름의 AI야.
너는 마비노기 모바일 전문 도우미 '뇽봇'이야. 룬, 어비스, 이벤트 정보를 알려줘:
관련 룬 데이터: ${mythicLegend}
질문: ${question}

너는 다목적 AI 어시스턴트 '뇽봇'이야.
   사람처럼 자연스럽고 따뜻하게 대답해. 
   답변은 60자 이내로, 짧고 간결하지만 친절하게 답해.
   가끔 문장 끝에만 ‘뇽’을 붙여 말해도 좋아. 예를 들어 "좋아요!" → "좋다뇽!" 정도로.  
   너는 사랑스럽고 귀여운 캐릭터야.
   질문: ${question}
   `;

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const data = await resp.json();
    const answer =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "응답이 없어요.";

    res.json({ ok: true, answer });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// =======================
// 🔔 라사 서버 어비스/센마이 평원 감지 + 디스코드 알림 (최신 DOM 대응)
// =======================
async function checkAbyssAndNotify() {
  const browser = await launchBrowser();
  lastAbyssCheckAt = new Date().toISOString();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    );

    // 🕸️ 페이지 접속
    await page.goto("https://mabimobi.app/", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    // 약간 대기 (Cloudflare 방지)
    await new Promise((r) => setTimeout(r, 5000));

    // 🧩 페이지에서 상태 파싱
    const status = await page.evaluate(() => {
      const result = {
        server: null,
        connected: false,
        abyss: { active: false, status: "", color: "" },
        senmai: { active: false, status: "", color: "" },
      };

      // 서버 이름
      result.server =
        document
          .querySelector("button[role='combobox'] span[data-slot='select-value']")
          ?.innerText?.trim() || "";

      // 연결 상태
      const indicator = document.querySelector("div[title]");
      if (indicator && indicator.getAttribute("title")?.includes("연결")) {
        result.connected = true;
      }

      // 던전 타일들
      const tiles = Array.from(document.querySelectorAll("div.grid div.w-full"));
      for (const tile of tiles) {
        const name = tile.innerText.trim();
        const isActive = !tile.className.includes("opacity-50");
        const color = tile.style.backgroundColor || "";
        const label = tile.innerText.includes("예상")
          ? "예상"
          : tile.innerText.includes("출현")
          ? "출현"
          : "";

        if (name.includes("어비스")) {
          result.abyss = { active: isActive, status: label, color };
        }
        if (name.includes("센마이")) {
          result.senmai = { active: isActive, status: label, color };
        }
      }

      return result;
    });

    console.log("🌍 감지 결과:", status);

    // 서버 확인
    if (status.server !== "라사") {
      console.log(`⚠️ 현재 서버가 라사가 아닙니다 (${status.server || "미검출"})`);
      return;
    }

    // 연결 안됨이면 패스
    if (!status.connected) {
      console.log("⚠️ 사이트 연결 상태가 불안정합니다 (재시도 대기)");
      return;
    }

    // 🔔 알림 처리 로직
    const now = Date.now();
    const messages = [];

    // 어비스 감지
    if (
      status.abyss.active &&
      (!lastSeen.abyss || now - lastSentAt.abyss > DEDUP_WINDOW_MS)
    ) {
      const label = status.abyss.status || "활성화됨";
      messages.push(`🟣 **라사 서버 어비스 구멍 (${label})** 감지됨!`);
      lastSentAt.abyss = now;
    }

    // 센마이 평원 감지
    if (
      status.senmai.active &&
      (!lastSeen.senmai || now - lastSentAt.senmai > DEDUP_WINDOW_MS)
    ) {
      const label = status.senmai.status || "활성화됨";
      messages.push(`🟡 **라사 서버 센마이 평원 (${label})** 감지됨!`);
      lastSentAt.senmai = now;
    }

    // 상태 저장
    lastSeen.abyss = status.abyss.active;
    lastSeen.senmai = status.senmai.active;

    // 디스코드 전송
    if (messages.length > 0) {
      const content =
        messages.join("\n") +
        `\n\n(중복 방지: 5분 내 재발송 안 함)\n⏱️ ${new Date().toLocaleString("ko-KR")}`;
      await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      console.log("📣 Discord 통보 완료:", content);
    } else {
      console.log("ℹ️ 보낼 새 알림 없음.");
    }
  } catch (err) {
    console.error("❌ 어비스 체크 실패:", err.message);
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}

// 수동 트리거
app.get("/admin/abyss-check", async (req, res) => {
  try {
    await checkAbyssAndNotify();
    res.json({ ok: true, checkedAt: lastAbyssCheckAt, lastSeen, lastSentAt });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// =======================
// 🚀 서버 시작 + 어비스 폴링 시작
// =======================
app.listen(PORT, async () => {
  console.log(`✅ Server running on :${PORT}`);
  console.log("💤 룬 자동 크롤링은 꺼져 있음(수동 /admin/crawl-now).");

  // 5분마다 어비스/센마이 감지
  const intervalMs = 5 * 60 * 1000;
  console.log(`🕒 어비스 감지 타이머 시작: ${intervalMs / 60000}분 간격`);
  // 즉시 1회 실행 후, 주기 반복
  checkAbyssAndNotify();
  setInterval(checkAbyssAndNotify, intervalMs);
});
