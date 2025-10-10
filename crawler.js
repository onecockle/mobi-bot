// crawler.js
import axios from "axios";
import cheerio from "cheerio";
import fs from "fs";

const URL = "https://mabimobi.life/runes?t=search";

async function crawlRunes() {
  try {
    console.log("🌀 마비노기 룬 목록 수집 중...");

    const { data } = await axios.get(URL, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const runes = [];

    // 룬 목록 테이블의 각 행을 순회
    $("tr[data-slot='table-row']").each((i, el) => {
      const name = $(el).find("td:nth-child(3) span:last-child").text().trim();
      const grade = $(el).find("td:nth-child(4)").text().trim();
      const desc = $(el).find("td:nth-child(5) span").text().trim();

      // 이미지 경로는 절대경로로 변환
      let imgSrc = $(el).find("img").attr("src");
      if (imgSrc && imgSrc.startsWith("/")) {
        imgSrc = "https://mabimobi.life" + imgSrc;
      }

      if (name) {
        runes.push({ name, grade, desc, img: imgSrc });
      }
    });

    if (!runes.length) {
      throw new Error("룬 데이터를 찾을 수 없습니다. 페이지 구조가 바뀐 듯합니다.");
    }

    fs.writeFileSync("runes.json", JSON.stringify(runes, null, 2), "utf8");
    console.log(`✅ ${runes.length}개의 룬 정보를 저장했습니다.`);
  } catch (err) {
    console.error("⚠️ 오류 발생:", err.message);
  }
}

crawlRunes();
