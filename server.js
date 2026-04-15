import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();

// ================== 配置与初始化 ==================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://bnxzymqifuyfcfaairrk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 核心存储：用于存放 SSE 连接实例
const transports = new Map();

// ================== CORS 中间件 ==================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-mcp-protocol-version");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// ================== 逻辑函数 (保持原样) ==================
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

// ================== 创建 MCP Server 实例 ==================
function setupMcpServer() {
  const server = new McpServer({ name: "朝灯的记忆库", version: "4.5.0" });

  // 工具注册 (保留你原有的全部工具逻辑)
  server.tool("memory_save", {
    content: z.string(),
    category: z.enum(["core", "daily", "diary", "milestone", "mood", "rp_character", "rp_event", "rp_relation", "rp_state"]).default("daily"),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10).default(5),
    mood: z.number().min(-1).max(1).default(0),
  }, async (args) => {
    const { error } = await supabase.from("memories").insert({ ...args, created_at: new Date().toISOString() });
    return { content: [{ type: "text", text: error ? `失败: ${error.message}` : `记忆已保存: ${args.category}` }] };
  });

  server.tool("memory_read", { category: z.string().optional(), limit: z.number().default(10) }, async ({ category, limit }) => {
    let query = supabase.from("memories").select("*").order("created_at", { ascending: false }).limit(limit);
    if (category) query = query.eq("category", category);
    const { data } = await query;
    await markRecalled(data?.map(m => m.id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ... (此处省略其他 search, surface, diary, stats 工具，逻辑与你之前一致)
  // 为了篇幅直接保留核心逻辑，你复制时可以将之前的工具函数粘贴进来
  
  return server;
}

const mcpServer = setupMcpServer();

// ================== SSE 路由逻辑 ==================

// 1. 建立 SSE 连接通道
app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  
  transports.set(sessionId, transport);
  console.log(`[SSE] 新连接建立: ${sessionId}`);

  await mcpServer.connect(transport);

  // 连接关闭时清理
  req.on("close", () => {
    transports.delete(sessionId);
    console.log(`[SSE] 连接关闭: ${sessionId}`);
  });
});

// 2. 消息处理通道 (客户端通过此端点发送 POST 消息)
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);

  if (!transport) {
    return res.status(404).send("Session not found");
  }

  // SSE 内部逻辑：将 POST 请求转发给 transport 处理
  await transport.handlePostMessage(req, res);
});

// ================== 其他增强 ==================
app.get("/", (req, res) => res.json({ status: "active", engine: "SSE", sessions: transports.size }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 朝灯的记忆库 (SSE版) 运行在端口 ${PORT}`));
