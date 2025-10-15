// relay.js
import express from "express";
import fetch from "node-fetch";
const app = express();
app.use(express.json());

app.post("/relay", async (req, res) => {
  const { room, text } = req.body;
  console.log("📨 수신:", room, text);

  // 메신저봇R REST API 엔드포인트
  await fetch("http://192.168.0.3:8080/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room, text }),
  });

  res.json({ ok: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("🚀 Relay Server Ready on port", PORT));
