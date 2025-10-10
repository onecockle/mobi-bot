import axios from "axios";
import cheerio from "cheerio";
import fs from "fs";

const BASE = "https://mabimobi.life/runes?t=search";

async function crawlRunes() {
  console.log("🌀 룬 데이터 수집 중...");

  const { data } = await axios.get(BASE);
  const $ = cheerio.load(data);
  const runes = [];

  $("tr[data-slot='table-row']").each((i, el) => {
    const name = $(el).find("td:nth-child(3) span:last-child").text().trim();
    const grade = $(el).find("td:nth-child(4)").text().trim();
    const desc = $(el).find("td:nth-child(5) span").text().trim();
    const img = "https://mabimobi.life" + $(el).find("img").attr("src");
    runes.push({ name, grade, desc, img });
  });

  fs.writeFileSync("runes.json", JSON.stringify(runes, null, 2), "utf8");
  console.log(`✅ ${runes.length}개의 룬 정보를 저장했습니다.`);
}

crawlRunes();
