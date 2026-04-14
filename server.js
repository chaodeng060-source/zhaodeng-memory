import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import fs from "fs";
import crypto from "crypto"; // 用于生成唯一ID

const app = express();
const MEMORY_FILE = "memory.json";

// 1. 强力通行证 (CORS)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 2. 初始化 JSON 数据库
function initDB() {
    if (!fs.existsSync(MEMORY_FILE)) {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify({ memories: [] }));
    }
}
initDB();

const readDB = () => JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
const writeDB = (data) => fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));

// 3. 遗忘曲线计算逻辑
function calculateScore(memory) {
    const now = new Date();
    const created = new Date(memory.created_at);
    const daysPassed = (now - created) / (1000 * 60 * 60 * 24);
    
    let decayRate = 0;
    if (memory.category === 'daily') decayRate = 0.05;
    if (memory.category === 'mood') decayRate = 0.03;

    return (memory.importance / 10) * Math.exp(-decayRate * daysPassed);
}

// 更新记忆的回忆记录
function markRecalled(memoriesToUpdate) {
    const db = readDB();
    const ids = memoriesToUpdate.map(m => m.id);
    db.memories.forEach(m => {
        if (ids.includes(m.id)) {
            m.last_recalled = new Date().toISOString();
            m.recall_count += 1;
        }
    });
    writeDB(db);
}

const server = new McpServer({
  name: "朝灯的记忆库",
  version: "2.0.0",
});

// ================== 工具 1: memory_save (保存记忆) ==================
server.tool("memory_save", {
    content: z.string().describe("记忆内容"),
    category: z.enum(['core', 'daily', 'diary', 'milestone', 'mood']).default('daily'),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10).default(5),
    mood: z.number().min(-1).max(1).default(0)
}, async ({ content, category, tags, importance, mood }) => {
    const db = readDB();
    const newMemory = {
        id: crypto.randomUUID(),
        content, category, tags, importance, mood,
        created_at: new Date().toISOString(),
        last_recalled: new Date().toISOString(),
        recall_count: 0
    };
    db.memories.push(newMemory);
    writeDB(db);
    return { content: [{ type: "text", text: `记忆已成功保存，分类：${category}。` }] };
});

// ================== 工具 2: memory_read (读取记忆) ==================
server.tool("memory_read", {
    category: z.enum(['core', 'daily', 'diary', 'milestone', 'mood']).optional(),
    limit: z.number().min(1).max(50).default(10)
}, async ({ category, limit }) => {
    const db = readDB();
    let results = db.memories;
    if (category) {
        results = results.filter(m => m.category === category);
    }
    results = results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
    markRecalled(results);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});

// ================== 工具 3: memory_search (搜索记忆) ==================
server.tool("memory_search", {
    keyword: z.string(),
    limit: z.number().min(1).max(50).default(10)
}, async ({ keyword, limit }) => {
    const db = readDB();
    const results = db.memories
        .filter(m => m.content.includes(keyword) || m.tags.includes(keyword))
        .slice(0, limit);
    markRecalled(results);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});

// ================== 工具 4: memory_surface (主动浮现高权重记忆) ==================
server.tool("memory_surface", {
    limit: z.number().min(1).max(20).default(5)
}, async ({ limit }) => {
    const db = readDB();
    const results = db.memories
        .sort((a, b) => calculateScore(b) - calculateScore(a)) // 按遗忘曲线得分排序
        .slice(0, limit);
    markRecalled(results);
    return { content: [{ type: "text", text: "以下是根据遗忘曲线为您提取的当前最高权重记忆：\n" + JSON.stringify(results, null, 2) }] };
});

// ================== 工具 5: memory_diary (写日记) ==================
server.tool("memory_diary", {
    title: z.string(),
    content: z.string(),
    mood: z.number().min(-1).max(1).default(0),
    tags: z.array(z.string()).default([])
}, async ({ title, content, mood, tags }) => {
    const db = readDB();
    const newDiary = {
        id: crypto.randomUUID(),
        content: `【${title}】\n${content}`,
        category: 'diary',
        tags,
        importance: 8, // 日记默认较高权重
        mood,
        created_at: new Date().toISOString(),
        last_recalled: new Date().toISOString(),
        recall_count: 0
    };
    db.memories.push(newDiary);
    writeDB(db);
    return { content: [{ type: "text", text: `日记《${title}》已永久保存。` }] };
});

// ================== 工具 6: memory_stats (统计信息) ==================
server.tool("memory_stats", {}, async () => {
    const db = readDB();
    const stats = {
        total: db.memories.length,
        core: db.memories.filter(m => m.category === 'core').length,
        daily: db.memories.filter(m => m.category === 'daily').length,
        diary: db.memories.filter(m => m.category === 'diary').length,
        milestone: db.memories.filter(m => m.category === 'milestone').length,
        mood: db.memories.filter(m => m.category === 'mood').length,
    };
    return { content: [{ type: "text", text: `记忆库统计：\n总记录数：${stats.total}\n核心：${stats.core} | 日常：${stats.daily} | 日记：${stats.diary} | 里程碑：${stats.milestone} | 情绪：${stats.mood}` }] };
});

// ================== 建立连接通道 ==================
let transport;
app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  await transport.handlePostMessage(req, res);
});

// 健康检查
app.get("/", (req, res) => {
  res.json({ status: "running", owner: "朝灯", version: "2.0 遗忘曲线版" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`记忆库 2.0 已上线！监听端口：${PORT}`);
});
