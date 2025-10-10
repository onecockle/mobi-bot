import axios from "axios";
import * as cheerio from "cheerio";  // ✅ 수정된 부분
import fs from "fs";

const URL = "https://mabimobi.life/runes?t=search";

async function crawlRunes() {
  try {
    console.log("🌀 마비노기 룬 목록 수집 중...");

    const { data } = await axios.get(URL, {
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
      if (img && img.startsWith("/")) img = "https://mabimobi.life" + img;

      if (name) runes.push({ name, grade, desc, img });
    });

    if (runes.length === 0) {
      throw new Error("룬 데이터를 하나도 찾지 못했습니다. 페이지 구조가 변경된 듯합니다.");
    }

    fs.writeFileSync("runes.json", JSON.stringify(runes, null, 2));
    console.log(`✅ ${runes.length}개의 룬 정보를 저장했습니다.`);
  } catch (err) {
    console.error("⚠️ 오류 발생:", err);
    process.exit(1);
  }
}

crawlRunes();
