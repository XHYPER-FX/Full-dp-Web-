const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const Jimp = require("jimp");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Folders
const uploadDir = path.join(__dirname, "uploads");
const sessionDir = path.join(__dirname, "sessions");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

// Multer
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("✅ Full DP Uploader Running on Render");
});

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ filename: req.file.filename });
});

app.get("/connect", async (req, res) => {
  const { phoneNumber, filename } = req.query;
  if (!phoneNumber || !filename)
    return res.status(400).json({ error: "Missing data" });

  const cleanNumber = phoneNumber.replace(/[^0-9]/g, "");
  const sessionFolder = path.join(sessionDir, `session-${cleanNumber}`);

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  try {
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      browser: ["Chrome", "Windows", "10"],
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      if (update.connection === "open") {
        try {
          const imgPath = path.join(uploadDir, filename);
          const img = await Jimp.read(imgPath);

          const min = Math.min(img.bitmap.width, img.bitmap.height);

          const buffer = await img
            .crop(0, 0, min, min)
            .resize(640, 640)
            .quality(90)
            .getBufferAsync(Jimp.MIME_JPEG);

          await sock.query({
            tag: "iq",
            attrs: { to: sock.user.id, type: "set", xmlns: "w:profile:picture" },
            content: [{ tag: "picture", attrs: { type: "image" }, content: buffer }]
          });

          console.log("✅ DP Updated");
        } catch (e) {
          console.error("DP Error:", e);
        }

        await sock.logout();
        setTimeout(() => {
          fs.rmSync(sessionFolder, { recursive: true, force: true });
        }, 3000);
      }
    });

    if (!sock.authState.creds.registered) {
      await delay(3000);
      const code = await sock.requestPairingCode(cleanNumber);
      const format = code?.match(/.{1,4}/g)?.join("-") || code;
      return res.json({ code: format });
    } else {
      return res.json({ error: "Session already exists, wait..." });
    }
  } catch (err) {
    console.error("Server Error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on port", PORT);
});

process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);
