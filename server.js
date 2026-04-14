import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import fs from "fs";

const app = express();
const MEMORY_FILE = "memory.json";

// 确保记忆文件存在
if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ diary: [] }));
}

// 1. 核心修复：强力通行证 (CORS)，让 Claude 能顺利进门
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const server = new McpServer({
  name: "朝灯的记忆库",
  version: "1.0.0",
});

// 2. 注册工具：让 Claude 能看见并使用这个功能
server.tool("get_memory_status", {}, async () => {
  const data = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
  return {
    content: [{ type: "text", text: `记忆库已就绪，当前存有 ${data.diary.length} 条记录。` }]
  };
});

// 3. 建立连接通道
let transport;
app.get("/sse", async (req, res) => {
  console.log("收到连接请求...");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  await transport.handlePostMessage(req, res);
});

// 健康检查：防止 Render 报错
app.get("/", (req, res) => {
  res.json({ status: "running", owner: "朝灯", message: "记忆库大门常打开" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务已启动，端口：${PORT}`);
});
