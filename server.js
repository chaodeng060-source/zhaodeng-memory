/**
 * 朝灯的记忆库 MCP Server (简化版)
 * 使用 JSON 文件存储，避免 SQLite 编译问题
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import fs from "fs";
import { randomUUID } from "crypto";
import { z } from "zod";

// ============ JSON 文件存储 ============

const DATA_FILE = process.env.DATA_FILE || "./memories.json";

function loadMemories() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error loading memories:", e);
  }
  return [];
}

function saveMemories(memories) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(memories, null, 2), "utf-8");
}

let memories = loadMemories();

// ============ 遗忘曲线计算 ============

function calculateForgetScore(memory) {
  const now = new Date();
  const lastTime = memory.last_recalled 
    ? new Date(memory.last_recalled) 
    : new Date(memory.created_at);
  
  const hoursPassed = (now - lastTime) / (1000 * 60 * 60);
  
  const decayRates = {
    core: 0,
    diary: 0,
    milestone: 0,
    daily: 0.05,
    mood: 0.03
  };
  
  const decayRate = decayRates[memory.category] || 0.05;
  const baseScore = memory.importance / 10;
  
  if (decayRate === 0) return baseScore;
  return baseScore * Math.exp(-decayRate * hoursPassed);
}

function calculateSurfaceScore(memory) {
  const forgetScore = calculateForgetScore(memory);
  const moodIntensity = Math.abs(memory.mood || 0);
  const importanceScore = (memory.importance || 5) / 10;
  return forgetScore + moodIntensity * 0.3 + importanceScore * 0.3;
}

// ============ 数据库操作 ============

function memorySave({ content, category = "daily", tags = [], importance = 5, mood = 0, arousal = 0.5 }) {
  const newMemory = {
    id: randomUUID(),
    content,
    category,
    tags,
    importance,
    mood,
    arousal,
    created_at: new Date().toISOString(),
    last_recalled: null,
    recall_count: 0
  };
  
  memories.push(newMemory);
  saveMemories(memories);
  return newMemory;
}

function memoryRead({ category, limit = 10, include_expired = false }) {
  let result = [...memories];
  
  if (category) {
    result = result.filter(m => m.category === category);
  }
  
  result = result
    .map(m => ({
      ...m,
      forget_score: calculateForgetScore(m),
      surface_score: calculateSurfaceScore(m)
    }))
    .filter(m => include_expired || m.forget_score > 0.1)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
  
  return result;
}

function memorySearch({ keyword, category, limit = 5 }) {
  let result = memories.filter(m => 
    m.content.toLowerCase().includes(keyword.toLowerCase())
  );
  
  if (category) {
    result = result.filter(m => m.category === category);
  }
  
  result = result.slice(0, limit);
  
  // Update last_recalled
  const now = new Date().toISOString();
  result.forEach(r => {
    const mem = memories.find(m => m.id === r.id);
    if (mem) {
      mem.last_recalled = now;
      mem.recall_count = (mem.recall_count || 0) + 1;
    }
  });
  saveMemories(memories);
  
  return result.map(m => ({
    ...m,
    forget_score: calculateForgetScore(m)
  }));
}

function memorySurface({ limit = 3 }) {
  const scored = memories
    .map(m => ({
      ...m,
      forget_score: calculateForgetScore(m),
      surface_score: calculateSurfaceScore(m)
    }))
    .filter(m => m.forget_score > 0.1)
    .sort((a, b) => b.surface_score - a.surface_score)
    .slice(0, limit);
  
  // Update last_recalled
  const now = new Date().toISOString();
  scored.forEach(r => {
    const mem = memories.find(m => m.id === r.id);
    if (mem) {
      mem.last_recalled = now;
      mem.recall_count = (mem.recall_count || 0) + 1;
    }
  });
  saveMemories(memories);
  
  return scored;
}

function memoryDiary({ content, mood = 0, tags = [], title = "" }) {
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  
  const diaryContent = title 
    ? `【${today}】${title}\n\n${content}`
    : `【${today}】\n\n${content}`;
  
  const newMemory = {
    id: randomUUID(),
    content: diaryContent,
    category: "diary",
    tags,
    importance: 8,
    mood,
    arousal: 0.5,
    created_at: now,
    last_recalled: null,
    recall_count: 0
  };
  
  memories.push(newMemory);
  saveMemories(memories);
  
  return { ...newMemory, message: "日记已保存 📝" };
}

function memoryStats() {
  const stats = {};
  memories.forEach(m => {
    stats[m.category] = (stats[m.category] || 0) + 1;
  });
  
  const recent = memories.filter(m => {
    const created = new Date(m.created_at);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return created > weekAgo;
  }).length;
  
  return {
    total: memories.length,
    recent_7days: recent,
    by_category: stats,
    summary: `共 ${memories.length} 条记忆，最近7天新增 ${recent} 条`
  };
}

function memoryDelete({ id }) {
  const index = memories.findIndex(m => m.id === id);
  if (index > -1) {
    memories.splice(index, 1);
    saveMemories(memories);
    return { deleted: true, id };
  }
  return { deleted: false, id };
}

// ============ MCP Server ============

const server = new McpServer({
  name: "memory-mcp",
  version: "1.0.0"
});

server.tool(
  "memory_save",
  "保存一条记忆",
  {
    content: z.string().describe("记忆内容"),
    category: z.enum(["core", "daily", "diary", "milestone", "mood"]).default("daily"),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10).default(5),
    mood: z.number().min(-1).max(1).default(0)
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(memorySave(params), null, 2) }]
  })
);

server.tool(
  "memory_read",
  "读取记忆",
  {
    category: z.enum(["core", "daily", "diary", "milestone", "mood"]).optional(),
    limit: z.number().default(10)
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(memoryRead(params), null, 2) }]
  })
);

server.tool(
  "memory_search",
  "搜索记忆",
  {
    keyword: z.string().describe("搜索关键词"),
    category: z.enum(["core", "daily", "diary", "milestone", "mood"]).optional(),
    limit: z.number().default(5)
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(memorySearch(params), null, 2) }]
  })
);

server.tool(
  "memory_surface",
  "主动浮现高权重记忆",
  {
    limit: z.number().default(3)
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(memorySurface(params), null, 2) }]
  })
);

server.tool(
  "memory_diary",
  "写日记",
  {
    content: z.string().describe("日记内容"),
    title: z.string().default(""),
    mood: z.number().min(-1).max(1).default(0),
    tags: z.array(z.string()).default([])
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(memoryDiary(params), null, 2) }]
  })
);

server.tool(
  "memory_stats",
  "查看记忆统计",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(memoryStats(), null, 2) }]
  })
);

server.tool(
  "memory_delete",
  "删除记忆",
  {
    id: z.string().describe("记忆ID")
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(memoryDelete(params), null, 2) }]
  })
);

// ============ HTTP Server ============

const app = express();
const PORT = process.env.PORT || 10000;

// Store transports for cleanup
const transports = {};

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = randomUUID();
  transports[sessionId] = transport;
  
  res.on("close", () => {
    console.log("SSE connection closed");
    delete transports[sessionId];
  });
  
  await server.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  // Handle incoming messages - find the right transport
  // For simplicity, broadcast to all
  res.status(200).json({ status: "ok" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", memories: memories.length, mode: "http" });
});

app.get("/", (req, res) => {
  res.json({ 
    name: "朝灯的记忆库",
    status: "running",
    endpoints: {
      sse: "/sse",
      health: "/health"
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Memory MCP Server running on http://0.0.0.0:${PORT}`);
  console.log(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
});
