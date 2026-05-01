const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");

const PORT = 3000;
const DATA_DIR = process.env.DATA_DIR || "./data";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, "users.json");
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");

// --------- Helpers ----------
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --------- WhatsApp Sessions ----------
const sessions = {};

async function startWhatsApp(userId) {
  const sessionPath = path.join(DATA_DIR, "sessions", userId);
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  sessions[userId] = sock;

  return sock;
}

// --------- Server ----------
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    const html = fs.readFileSync("index.html");
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(html);
  }

  if (req.method === "POST" && req.url === "/signup") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const { username, password } = JSON.parse(body);

      let users = readUsers();
      if (users.find(u => u.username === username)) {
        return res.end(JSON.stringify({ error: "User exists" }));
      }

      users.push({
        id: crypto.randomUUID(),
        username,
        password: hashPassword(password)
      });

      writeUsers(users);
      res.end(JSON.stringify({ success: true }));
    });
  }

  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const { username, password } = JSON.parse(body);
      const users = readUsers();

      const user = users.find(
        u => u.username === username && u.password === hashPassword(password)
      );

      if (!user) {
        return res.end(JSON.stringify({ error: "Invalid login" }));
      }

      res.end(JSON.stringify({ success: true, userId: user.id }));
    });
  }

  if (req.method === "POST" && req.url === "/connect") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      const { userId } = JSON.parse(body);
      await startWhatsApp(userId);
      res.end(JSON.stringify({ status: "QR generated in terminal" }));
    });
  }

  if (req.method === "POST" && req.url === "/send") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      const { userId, numbers, message, delay } = JSON.parse(body);

      const sock = sessions[userId];
      if (!sock) {
        return res.end(JSON.stringify({ error: "Not connected" }));
      }

      for (let num of numbers) {
        try {
          await sock.sendMessage(num + "@s.whatsapp.net", { text: message });
          await new Promise(r => setTimeout(r, delay));
        } catch (e) {
          console.log("Error:", e.message);
        }
      }

      res.end(JSON.stringify({ success: true }));
    });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
