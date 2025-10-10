import express from "express";
import fs from "fs";
import axios from "axios";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 마비노기 룬 목록 페이지
const TARGET_URL = "https://mabimobi.life/runes?t=search";

// 기본 루트 상태 확인용
app.get("/", (req, res) => {
  res.send("Kakao Rune Bot (Render 크롤링 버전) is running.<br>GET /admin/crawl-now 로 룬정보 갱신 가능");
});

// ✅ 크롤링 엔드포인트
app.get("/admin/crawl-now", async (req, res) => {
  try {
    console.log("🌀 마비노기 룬 목록 수집 중...");

    // Cloudflare 우회 User-Agent 헤더 설정
    const { data } = await axios.get(TARGET_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ko,en;q=0.9",
      },
      timeout: 20000,
    });

    const $ = cheerio.load(data);
    const runes = [];

    $("tr[data-slot='table-row']").each((i, el) => {
      const name = $(el).find("td:nth-child(3) span:last-child").text().trim();
      const grade = $(el).find("td:nth-child(4)").text().trim();
      const desc = $(el).find("td:nth-child(5) span").text().trim();

      let img = $(el).find("img").attr("src");
      if (img && img.startsWith("/"))
        img = "https://mabimobi.life" + img;

      if (name)
        runes.push({ name, grade, desc, img });
    });

    if (runes.length === 0) throw new Error("룬 데이터를 찾지 못했습니다.");

    fs.writeFileSync("runes.json", JSON.stringify(runes, null, 2));
    console.log(`✅ ${runes.length}개의 룬 정보를 저장했습니다.`);

    res.json({ ok: true, count: runes.length });
  } catch (err) {
    console.error("❌ 크롤링 오류:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 서버 시작
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
