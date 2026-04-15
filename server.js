import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();

// ================== 配置 ==================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://bnxzymqifuyfcfaairrk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const transports = new Map();

// ================== CORS ==================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-mcp-protocol-version");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// ================== 核心逻辑 ==================
function calculateScore(memory) {
  const now = new Date();
  const created = new Date(memory.created_at);
  const daysPassed = (now - created) / (1000 * 60 * 60 * 24);
  let decayRate = 0.05;
  if (memory.category === "mood") decayRate = 0.03;
  if (memory.category?.startsWith("rp_")) decayRate = 0.02;
  return (memory.importance / 10) * Math.exp(-decayRate * daysPassed);
}

async function markRecalled(ids) {
  if (!ids?.length) return;
  await supabase.from("memories").update({ last_recalled: new Date().toISOString() }).in("id", ids);
}

// ================== MCP Server 设置 ==================
function setupMcpServer() {
  const server = new McpServer({ name: "朝灯的记忆库", version: "4.5.0" });

  // 1. 记忆保存
  server.tool("memory_save", {
    content: z.string().describe("记忆内容"),
    category: z.enum(["core", "daily", "diary", "milestone", "mood", "rp_character", "rp_event", "rp_relation", "rp_state"]).default("daily"),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10).default(5),
    mood: z.number().min(-1).max(1).default(0),
  }, async (args) => {
    const { error } = await supabase.from("memories").insert({ ...args, created_at: new Date().toISOString(), last_recalled: new Date().toISOString(), recall_count: 0 });
    return { content: [{ type: "text", text: error ? `保存失败：${error.message}` : `记忆已存入 [${args.category}]` }] };
  });

  // 2. 记忆读取
  server.tool("memory_read", {
    category: z.string().optional(),
    limit: z.number().min(1).max(50).default(10),
  }, async ({ category, limit }) => {
    let query = supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(limit);
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: `读取失败：${error.message}` }] };
    await markRecalled(data.map(m => m.id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // 3. 记忆搜索
  server.tool("memory_search", { keyword: z.string(), limit: z.number().default(10) }, async ({ keyword, limit }) => {
    const { data, error } = await supabase.from("memories").select("*").ilike("content", `%${keyword}%`).limit(limit);
    if (error) return { content: [{ type: "text", text: `搜索失败：${error.message}` }] };
    await markRecalled(data.map(m => m.id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // 4. 遗忘曲线浮现
  server.tool("memory_surface", { limit: z.number().default(5) }, async ({ limit }) => {
    const { data, error } = await supabase.from("memories").select("*");
    if (error) return { content: [{ type: "text", text: `提取失败：${error.message}` }] };
    const sorted = data.sort((a, b) => calculateScore(b) - calculateScore(a)).slice(0, limit);
    await markRecalled(sorted.map(m => m.id));
    return { content: [{ type: "text", text: "根据权重提取的回忆：\n" + JSON.stringify(sorted, null, 2) }] };
  });

  // 5. 统计
  server.tool("memory_stats", {}, async () => {
    const { data, error } = await supabase.from("memories").select("category");
    if (error) return { content: [{ type: "text", text: "统计失败" }] };
    const stats = data.reduce((acc, curr) => {
      acc[curr.category] = (acc[curr.category] || 0) + 1;
      return acc;
    }, { total: data.length });
    return { content: [{ type: "text", text: `统计：${JSON.stringify(stats, null, 2)}` }] };
  });

  // 6. RP 专用保存
  server.tool("rp_save", {
    type: z.enum(["character", "event", "relation", "state"]),
    character_name: z.string(),
    content: z.string(),
    importance: z.number().default(7)
  }, async ({ type, character_name, content, importance }) => {
    const { error } = await supabase.from("memories").insert({
      content: `[${character_name}] ${content}`,
      category: `rp_${type}`,
      tags: [character_name],
      importance,
      created_at: new Date().toISOString()
    });
    return { content: [{ type: "text", text: error ? "保存失败" : `RP记忆已记录 [${character_name}]` }] };
  });

  return server;
}

const mcpServer = setupMcpServer();

// ================== SSE 路由 ==================

// 建立 SSE 连接
app.get("/mcp", async (req, res) => {
  console.log("[SSE] GET /mcp - 尝试建立连接");
  const transport = new SSEServerTransport("/messages", res);
  
  const sid = transport.sessionId;
  transports.set(sid, transport);
  
  await mcpServer.connect(transport);
  console.log(`[SSE] Session 激活: ${sid}`);

  req.on("close", () => {
    transports.delete(sid);
    console.log(`[SSE] Session 关闭: ${sid}`);
  });
});

// 处理消息推送
app.post("/messages", express.json(), async (req, res) => {
  const sid = req.query.sessionId;
  const transport = transports.get(sid);

  if (!transport) {
    console.error(`[SSE] 找不到 Session: ${sid}`);
    return res.status(404).send("Session not found");
  }

  await transport.handlePostMessage(req, res);
});

// ================== 其他 ==================
app.get("/", (req, res) => {
  res.json({ status: "running", engine: "SSE (v4.5.0)", sessions: transports.size });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 记忆库 SSE 运行在端口 ${PORT}`));
