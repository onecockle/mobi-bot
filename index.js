// =======================
// index.js (통합 클라우드 릴레이 버전)
// - 룬 검색 / Gemini AI 유지
// - 라사 서버 어비스/센마이 감지 → Discord + Relay 서버 전송
// =======================

import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

// ===== ENV =====
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY || "AIzaSyB6ElQ5Oe3SfclNWqF8ZwWIUc4Og4UXR5g";
const DISCORD_WEBHOOK  = process.env.DISCORD_WEBHOOK || "https://discord.com/api/webhooks/1426752338617700472/oms1AP5mh9DEV70zNTVYcsqoMlkqnZ52uhQ8_ELhiTu5N7Nup1guSKko7PDdRuTcrgBS";
const RELAY_SERVER_URL = process.env.RELAY_SERVER_URL || "https://your-relay.onrender.com/relay"; // ✅ 클라우드 릴레이 서버 주소
const TARGET_ROOM      = process.env.TARGET_ROOM || "모비봇테스트"; // 카카오 전송방 이름

// ===== 캐시 =====
let runeCache = [];
let lastLoadedAt = null;
const RUNE_JSON_PATH = "./runes.json";

let lastSeen = { abyss: false, senmai: false };
let lastSentAt = { abyss: 0, senmai: 0 };
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
let lastAbyssCheckAt = null;

// =======================
// 공용 함수
// =======================
async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--single-process"],
  });
  return browser;
}

async function sendDiscord(text) {
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
  } catch (err) {
    console.error("⚠️ Discord 전송 실패:", err.message);
  }
}

async function sendRelayToKakao(text) {
  try {
    await fetch(RELAY_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: TARGET_ROOM, text }),
    });
    console.log("✅ Relay → Kakao 전송 완료:", text);
  } catch (err) {
    console.error("⚠️ Relay 서버 전송 실패:", err.message);
  }
}

// =======================
// 룬 검색 / Gemini 부분 유지
// =======================
// (기존 코드 그대로 유지 — 생략 가능)
// ... [당신의 기존 룬, /runes, /ask 코드 그대로 복사]

// =======================
// 🔔 라사 서버 어비스/센마이 감지
// =======================
async function checkAbyssAndNotify() {
  const browser = await launchBrowser();
  lastAbyssCheckAt = new Date().toISOString();

  try {
    const page = await browser.newPage();
    await page.goto("https://mabimobi.life/", { waitUntil: "domcontentloaded", timeout: 180000 });
    await new Promise((r) => setTimeout(r, 5000));

    // 서버 자동 전환 → 라사
    try {
      const btn = await page.$("button[role='combobox']");
      if (btn) {
        await btn.click();
        await new Promise((r) => setTimeout(r, 500));
        await page.evaluate(() => {
          const opts = Array.from(document.querySelectorAll("div[role='option'],button"));
          const rasa = opts.find((el) => el.innerText.includes("라사"));
          if (rasa) rasa.click();
        });
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) {
      console.log("⚠️ 서버 전환 오류(무시):", e.message);
    }

    const status = await page.evaluate(() => {
      const res = { server: "", abyss: false, senmai: false };
      res.server = document.querySelector("button[role='combobox'] span")?.innerText || "";
      const tiles = Array.from(document.querySelectorAll("div.grid div.w-full"));
      for (const tile of tiles) {
        const name = tile.innerText.trim();
        const active = !tile.className.includes("opacity-50");
        if (name.includes("어비스")) res.abyss = active;
        if (name.includes("센마이")) res.senmai = active;
      }
      return res;
    });

    console.log("🌍 감지 결과:", status);
    if (status.server !== "라사") return console.log("⚠️ 라사 서버 아님 — 무시");

    const now = Date.now();
    const alerts = [];

    if (status.abyss && (!lastSeen.abyss || now - lastSentAt.abyss > DEDUP_WINDOW_MS)) {
      lastSentAt.abyss = now;
      alerts.push("🟣 라사 어비스 구멍 감지됨!");
    }
    if (status.senmai && (!lastSeen.senmai || now - lastSentAt.senmai > DEDUP_WINDOW_MS)) {
      lastSentAt.senmai = now;
      alerts.push("🟡 라사 센마이평원 심구 감지됨!");
    }

    lastSeen.abyss = status.abyss;
    lastSeen.senmai = status.senmai;

    for (const msg of alerts) {
      await sendDiscord(msg);
      await sendRelayToKakao(msg);
    }

    if (alerts.length === 0) console.log("ℹ️ 새로운 알림 없음");
  } catch (e) {
    console.error("❌ 감지 오류:", e.message);
  } finally {
    await browser.close();
  }
}

// =======================
// 🚀 서버 시작
// =======================
app.listen(PORT, () => {
  console.log(`✅ Server running on :${PORT}`);
  console.log("🕒 어비스 감지 타이머 시작 (5분마다)");
  checkAbyssAndNotify();
  setInterval(checkAbyssAndNotify, 5 * 60 * 1000);
});

app.get("/", (req, res) => {
  res.json({ ok: true, lastAbyssCheckAt, lastSeen, lastSentAt });
});
