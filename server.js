import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();

// ================== 1. 核心配置 ==================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://bnxzymqifuyfcfaairrk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const transports = new Map();

// ================== 2. 跨域放行 ==================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("X-Accel-Buffering", "no"); 
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// ================== 3. 宫殿功能定义 ==================
const CATEGORIES = {
  all: '✨ 全部内容', diary: '📔 心情日记', album: '🖼️ 珍贵相册',
  memory_bank: '🧠 记忆库', timeline: '⏳ 时间线', promise: '💍 纪念日',
  key_memory: '🔑 关键记忆', core: '💎 核心法则', rp_event: '📖 剧情发展'
};

function initMcpForSession() {
  const server = new McpServer({ name: "朝灯的记忆宫殿", version: "10.0.0" });
  
  server.tool("save", {
    content: z.string(),
    category: z.enum(Object.keys(CATEGORIES)).default("memory_bank")
  }, async (args) => {
    const { error } = await supabase.from("memories").insert({ ...args, created_at: new Date().toISOString() });
    return { content: [{ type: "text", text: error ? "存入失败" : "已妥善封存" }] };
  });

  server.tool("search", { keyword: z.string().optional() }, async ({ keyword }) => {
    let query = supabase.from("memories").select("*").order("created_at", { ascending: false });
    if (keyword) query = query.ilike("content", `%${keyword}%`);
    const { data } = await query;
    return { content: [{ type: "text", text: JSON.stringify(data || []) }] };
  });

  return server;
}

// ================== 4. 网页 API ==================
app.post("/api/write", express.json({ limit: '50mb' }), async (req, res) => {
  const { content, category, imageUrl } = req.body;
  let final = content || "";
  if (imageUrl) final += `\n<br><img src="${imageUrl}" class="memory-img">`;
  await supabase.from("memories").insert({ content: final, category: category || "diary", created_at: new Date().toISOString() });
  res.json({ success: true });
});

app.get("/", async (req, res) => {
  const { data: memories } = await supabase.from("memories").select("*").order("created_at", { ascending: false });
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>朝灯的记忆宫殿</title><style>body{background:#0b0c10;color:#d1d5db;font-family:sans-serif;padding:40px;}.card{background:#15171e;padding:20px;border-radius:12px;margin-bottom:15px;border:1px solid #23262d;}.accent{color:#8e6aff;}</style></head><body><h1>🌙 朝灯的记忆宫殿</h1><div id="list">${(memories||[]).map(m=>`<div class="card"><span class="accent">${CATEGORIES[m.category]||m.category}</span><div>${m.content}</div></div>`).join('')}</div></body></html>`);
});

// ================== 5. 连接逻辑 (核心修复) ==================
app.get("/mcp", async (req, res) => {
  // 必须为每个连接创建独立的引擎实例，解决 Already connected 错误
  const mcpServer = initMcpForSession();
  const transport = new SSEServerTransport("/messages", res);
  
  const sid = transport.sessionId;
  transports.set(sid, { transport, mcpServer }); // 同时保存传输和引擎

  console.log(`[Connect] New Session: ${sid}`);
  
  await mcpServer.connect(transport);

  req.on("close", () => {
    transports.delete(sid);
    console.log(`[Disconnect] Session: ${sid}`);
  });
});

app.post("/messages", express.json(), async (req, res) => {
  const sid = req.query.sessionId;
  const session = transports.get(sid);
  if (session) {
    await session.transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Session Lost");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 宫殿底座在 ${PORT} 稳固开启`));
