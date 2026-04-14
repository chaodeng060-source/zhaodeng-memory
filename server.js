/**
 * 朝灯的记忆库 MCP Server
 * 基于遗忘曲线和情绪效价的轻量记忆管理系统
 * 
 * 分类说明：
 * - core: 长期不变（身份、规则、偏好）永不遗忘
 * - daily: 日常事件，3天后衰减
 * - diary: 每日日记，带情绪，永久保留
 * - milestone: 重要里程碑，永久保留
 * - mood: 情绪状态，7天后衰减
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { z } from "zod";

// ============ 数据库初始化 ============

const DB_PATH = process.env.DB_PATH || "./memory.db";
const db = new Database(DB_PATH);

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'daily',
    tags TEXT DEFAULT '[]',
    importance INTEGER DEFAULT 5,
    mood REAL DEFAULT 0,
    arousal REAL DEFAULT 0.5,
    created_at TEXT NOT NULL,
    last_recalled TEXT,
    recall_count INTEGER DEFAULT 0
  );
  
  CREATE INDEX IF NOT EXISTS idx_category ON memories(category);
  CREATE INDEX IF NOT EXISTS idx_created_at ON memories(created_at);
`);

// ============ 遗忘曲线计算 ============

/**
 * 计算记忆的遗忘分数
 * 公式：(重要度/10) * exp(-decay_rate * 小时数)
 * 被回忆一次，分数重置
 */
function calculateForgetScore(memory) {
  const now = new Date();
  const lastTime = memory.last_recalled 
    ? new Date(memory.last_recalled) 
    : new Date(memory.created_at);
  
  const hoursPassed = (now - lastTime) / (1000 * 60 * 60);
  
  // 不同分类的衰减率
  const decayRates = {
    core: 0,        // 永不遗忘
    diary: 0,       // 永不遗忘
    milestone: 0,   // 永不遗忘
    daily: 0.05,    // 约3天后显著衰减
    mood: 0.03      // 约7天后显著衰减
  };
  
  const decayRate = decayRates[memory.category] || 0.05;
  const baseScore = memory.importance / 10;
  
  if (decayRate === 0) {
    return baseScore; // 永不遗忘的分类
  }
  
  return baseScore * Math.exp(-decayRate * hoursPassed);
}

/**
 * 计算综合浮现分数
 * 综合排序：情绪强度 + 重要度 + 遗忘分数
 */
function calculateSurfaceScore(memory) {
  const forgetScore = calculateForgetScore(memory);
  const moodIntensity = Math.abs(memory.mood); // 情绪强度（不管正负）
  const importanceScore = memory.importance / 10;
  
  return forgetScore + moodIntensity * 0.3 + importanceScore * 0.3;
}

// ============ 数据库操作 ============

function saveMemory({ content, category = "daily", tags = [], importance = 5, mood = 0, arousal = 0.5 }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO memories (id, content, category, tags, importance, mood, arousal, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, content, category, JSON.stringify(tags), importance, mood, arousal, now);
  
  return { id, content, category, tags, importance, mood, arousal, created_at: now };
}

function readMemories({ category, limit = 10, include_expired = false }) {
  let query = "SELECT * FROM memories";
  const params = [];
  
  if (category) {
    query += " WHERE category = ?";
    params.push(category);
  }
  
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  
  const memories = db.prepare(query).all(...params);
  
  // 解析 tags 并计算遗忘分数
  return memories.map(m => ({
    ...m,
    tags: JSON.parse(m.tags || "[]"),
    forget_score: calculateForgetScore(m),
    surface_score: calculateSurfaceScore(m)
  })).filter(m => include_expired || m.forget_score > 0.1);
}

function searchMemories({ keyword, category, limit = 5 }) {
  let query = "SELECT * FROM memories WHERE content LIKE ?";
  const params = [`%${keyword}%`];
  
  if (category) {
    query += " AND category = ?";
    params.push(category);
  }
  
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  
  const memories = db.prepare(query).all(...params);
  
  // 更新 last_recalled
  const updateStmt = db.prepare(`
    UPDATE memories SET last_recalled = ?, recall_count = recall_count + 1 WHERE id = ?
  `);
  const now = new Date().toISOString();
  memories.forEach(m => updateStmt.run(now, m.id));
  
  return memories.map(m => ({
    ...m,
    tags: JSON.parse(m.tags || "[]"),
    forget_score: calculateForgetScore(m)
  }));
}

function surfaceMemories({ limit = 3 }) {
  // 获取所有未过期记忆
  const memories = db.prepare("SELECT * FROM memories").all();
  
  // 计算浮现分数并排序
  const scored = memories
    .map(m => ({
      ...m,
      tags: JSON.parse(m.tags || "[]"),
      forget_score: calculateForgetScore(m),
      surface_score: calculateSurfaceScore(m)
    }))
    .filter(m => m.forget_score > 0.1)
    .sort((a, b) => b.surface_score - a.surface_score)
    .slice(0, limit);
  
  // 更新 last_recalled
  const updateStmt = db.prepare(`
    UPDATE memories SET last_recalled = ?, recall_count = recall_count + 1 WHERE id = ?
  `);
  const now = new Date().toISOString();
  scored.forEach(m => updateStmt.run(now, m.id));
  
  return scored;
}

function saveDiary({ content, mood = 0, tags = [], title = "" }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  
  // 日记格式：带日期标题
  const diaryContent = title 
    ? `【${today}】${title}\n\n${content}`
    : `【${today}】\n\n${content}`;
  
  const stmt = db.prepare(`
    INSERT INTO memories (id, content, category, tags, importance, mood, arousal, created_at)
    VALUES (?, ?, 'diary', ?, 8, ?, 0.5, ?)
  `);
  
  stmt.run(id, diaryContent, JSON.stringify(tags), mood, now);
  
  return { 
    id, 
    content: diaryContent, 
    category: "diary", 
    tags, 
    importance: 8, 
    mood, 
    created_at: now,
    message: "日记已保存 📝"
  };
}

function getStats() {
  const stats = db.prepare(`
    SELECT 
      category,
      COUNT(*) as count,
      AVG(importance) as avg_importance,
      AVG(mood) as avg_mood
    FROM memories
    GROUP BY category
  `).all();
  
  const total = db.prepare("SELECT COUNT(*) as total FROM memories").get();
  const recent = db.prepare(`
    SELECT COUNT(*) as count FROM memories 
    WHERE created_at > datetime('now', '-7 days')
  `).get();
  
  return {
    total: total.total,
    recent_7days: recent.count,
    by_category: stats,
    summary: `共 ${total.total} 条记忆，最近7天新增 ${recent.count} 条`
  };
}

function deleteMemory({ id }) {
  const stmt = db.prepare("DELETE FROM memories WHERE id = ?");
  const result = stmt.run(id);
  return { deleted: result.changes > 0, id };
}

// ============ MCP Server 设置 ============

const server = new McpServer({
  name: "memory-mcp",
  version: "1.0.0",
  description: "朝灯的记忆库 - 基于遗忘曲线的轻量记忆管理系统"
});

// 工具定义
server.tool(
  "memory_save",
  "保存一条记忆",
  {
    content: z.string().describe("记忆内容（必填）"),
    category: z.enum(["core", "daily", "diary", "milestone", "mood"]).default("daily").describe("分类：core(永久)/daily(日常)/diary(日记)/milestone(里程碑)/mood(情绪)"),
    tags: z.array(z.string()).default([]).describe("标签，如 ['工作', '开心']"),
    importance: z.number().min(1).max(10).default(5).describe("重要度 1-10"),
    mood: z.number().min(-1).max(1).default(0).describe("情绪效价 -1(难过) 到 1(开心)"),
    arousal: z.number().min(0).max(1).default(0.5).describe("唤醒度 0(平静) 到 1(激动)")
  },
  async (params) => {
    const result = saveMemory(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "memory_read",
  "读取记忆（按分类）",
  {
    category: z.enum(["core", "daily", "diary", "milestone", "mood"]).optional().describe("分类过滤，不填则返回全部"),
    limit: z.number().default(10).describe("返回数量上限"),
    include_expired: z.boolean().default(false).describe("是否包含已衰减的记忆")
  },
  async (params) => {
    const memories = readMemories(params);
    return {
      content: [{ type: "text", text: JSON.stringify(memories, null, 2) }]
    };
  }
);

server.tool(
  "memory_search",
  "搜索记忆（关键词）",
  {
    keyword: z.string().describe("搜索关键词"),
    category: z.enum(["core", "daily", "diary", "milestone", "mood"]).optional().describe("分类过滤"),
    limit: z.number().default(5).describe("返回数量上限")
  },
  async (params) => {
    const memories = searchMemories(params);
    return {
      content: [{ type: "text", text: JSON.stringify(memories, null, 2) }]
    };
  }
);

server.tool(
  "memory_surface",
  "主动浮现高权重记忆（不需要关键词，自动按情绪+重要度+遗忘分数排序）",
  {
    limit: z.number().default(3).describe("返回数量上限")
  },
  async (params) => {
    const memories = surfaceMemories(params);
    return {
      content: [{ type: "text", text: JSON.stringify(memories, null, 2) }]
    };
  }
);

server.tool(
  "memory_diary",
  "写日记（特殊格式，自动添加日期，永久保存）",
  {
    content: z.string().describe("日记内容"),
    title: z.string().default("").describe("日记标题（可选）"),
    mood: z.number().min(-1).max(1).default(0).describe("今日心情 -1(难过) 到 1(开心)"),
    tags: z.array(z.string()).default([]).describe("标签")
  },
  async (params) => {
    const result = saveDiary(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "memory_stats",
  "查看记忆统计信息",
  {},
  async () => {
    const stats = getStats();
    return {
      content: [{ type: "text", text: JSON.stringify(stats, null, 2) }]
    };
  }
);

server.tool(
  "memory_delete",
  "删除一条记忆",
  {
    id: z.string().describe("记忆ID")
  },
  async (params) => {
    const result = deleteMemory(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

// ============ 启动服务器 ============

const PORT = process.env.PORT || 8888;
const MODE = process.env.MODE || "http"; // "stdio" or "http"

if (MODE === "stdio") {
  // Claude Desktop 本地模式
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Memory MCP Server running in stdio mode");
} else {
  // HTTP 模式（用于远程连接）
  const app = express();
  
  // SSE endpoint for MCP
  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    await server.connect(transport);
  });
  
  app.post("/messages", express.json(), async (req, res) => {
    // Handle MCP messages
    res.status(200).json({ status: "ok" });
  });
  
  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", mode: "http", port: PORT });
  });
  
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Memory MCP Server running on http://0.0.0.0:${PORT}`);
    console.log(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
  });
}
