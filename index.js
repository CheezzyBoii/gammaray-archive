//Credit: Bubbo
import "dotenv/config";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { createBareServer } from "@tomphttp/bare-server-node";
import chalk from "chalk";
import compression from "compression";
import express from "express";
import basicAuth from "express-basic-auth";
import { SocksProxyAgent } from "socks-proxy-agent";
import config from "./config.js";

const __dirname = process.cwd();
const app = express();
app.use(compression());

// Tor Proxy Agent
const torAgent = new SocksProxyAgent(
  config.tor.proxy || "socks5h://127.0.0.1:9050"
);

// 1. Direct Bare Server (Normal)
const bareServerDirect = createBareServer("/edu/", {
  ipLimit: 999999,
  maxSockets: 999999,
  httpAgent: http.globalAgent,
  httpsAgent: https.globalAgent,
});

// 2. Tor Bare Server (Onion)
const bareServerTor = createBareServer("/edu/", {
  ipLimit: 999999,
  maxSockets: 999999,
  httpAgent: torAgent,
  httpsAgent: torAgent,
});

app.use(express.json());

// --- CADDY SSL CHECK ROUTE ---
// This must stay ABOVE the basicAuth middleware so Caddy can reach it.
app.get("/check", (req, res) => {
  res.status(200).send("OK");
});

// Basic Auth Middleware
if (config.challenge !== false) {
  app.use(basicAuth({ users: config.users, challenge: true }));
}

// Helper to determine which server to use
const getBareServer = (req) => {
  const cookies = req.headers.cookie || "";
  const useTor = cookies.includes("ubx-tor-enabled=true");
  return useTor ? bareServerTor : bareServerDirect;
};

// Routes Bare Server requests through Express (Crucial for Vercel)
app.use((req, res, next) => {
  const bareServer = getBareServer(req);
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    next();
  }
});

// Static File Hosting
app.use(
  express.static(path.join(__dirname, "static"), {
    extensions: ["html", "htm"],
    index: "index.html",
  })
);

// 404 Handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "static", "404.html"));
});

// VPS-Specific Logic (Handles WebSockets/Upgrades)
if (!process.env.VERCEL) {
  const server = http.createServer();

  server.on("request", (req, res) => {
    const bareServer = getBareServer(req);
    if (bareServer.shouldRoute(req)) {
      bareServer.routeRequest(req, res);
    } else {
      app(req, res);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const bareServer = getBareServer(req);
    if (bareServer.shouldRoute(req)) {
      bareServer.routeUpgrade(req, socket, head);
    } else {
      socket.end();
    }
  });

  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => {
    console.log(chalk.green(`🌍 UBX v9.1.1 LIVE on port ${PORT}`));
  });
}

// Export for Vercel Serverless Functions
export default app;