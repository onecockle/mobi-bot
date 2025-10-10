import express from "express";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Kakao Rune Bot is running.<br>GET /runes?name= <br>POST /skill");
});

app.get("/runes", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync("runes.json", "utf8"));
    const name = req.query.name?.replace(/\s+/g, "").trim();
    const found = data.find(r => r.name.replace(/\s+/g, "") === name);
    if (!found) return res.json({ ok: false, error: "룬을 찾을 수 없습니다." });
    res.json({ ok: true, rune: found });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
