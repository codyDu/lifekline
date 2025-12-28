// api/chat.js
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // 1. 设置允许跨域（CORS），让你的手机能接收数据
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*"); // 允许任何来源，方便调试
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  // 处理预检请求
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // 2. 检查请求方法
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // 3. 获取前端发来的数据
    const { prompt, apiKey, modelName } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // 4. 调用 Google Gemini
    // 优先使用前端传来的 Key，如果没有则使用环境变量
    const finalApiKey = apiKey || process.env.GOOGLE_API_KEY;
    if (!finalApiKey) {
      return res.status(500).json({
        error: "No API Key provided and no server-side key configured."
      });
    }

    const genAI = new GoogleGenerativeAI(finalApiKey);

    // 使用前端传来的模型名，或者默认使用 gemini-3-pro-preview
    // 注意：gemini-pro 可能已过时
    const finalModel = modelName || "gemini-3-pro-preview";
    const model = genAI.getGenerativeModel({
      model: finalModel,
      generationConfig: { responseMimeType: "application/json" }
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 5. 返回结果
    return res.status(200).json({ result: text });
  } catch (error) {
    console.error("Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal Server Error" });
  }
}
