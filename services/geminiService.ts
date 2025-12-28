import { UserInput, LifeDestinyResult, Gender } from "../types";
import { BAZI_SYSTEM_INSTRUCTION } from "../constants";

// Helper to determine stem polarity (保留这个辅助函数，因为生成提示词还需要它)
const getStemPolarity = (pillar: string): "YANG" | "YIN" => {
  if (!pillar) return "YANG"; // default
  const firstChar = pillar.trim().charAt(0);
  const yangStems = ["甲", "丙", "戊", "庚", "壬"];
  const yinStems = ["乙", "丁", "己", "辛", "癸"];

  if (yangStems.includes(firstChar)) return "YANG";
  if (yinStems.includes(firstChar)) return "YIN";
  return "YANG"; // fallback
};

export const generateLifeAnalysis = async (
  input: UserInput
): Promise<LifeDestinyResult> => {
  // 1. 【删除】这里不再需要检查 apiKey 和 apiBaseUrl 了
  // 因为 Key 现在保存在 Vercel 的服务器端，用户不需要提供

  const genderStr = input.gender === Gender.MALE ? "男 (乾造)" : "女 (坤造)";
  const startAgeInt = parseInt(input.startAge) || 1;

  // Calculate Da Yun Direction accurately
  const yearStemPolarity = getStemPolarity(input.yearPillar);
  let isForward = false;

  if (input.gender === Gender.MALE) {
    isForward = yearStemPolarity === "YANG";
  } else {
    isForward = yearStemPolarity === "YIN";
  }

  const daYunDirectionStr = isForward ? "顺行 (Forward)" : "逆行 (Backward)";

  const directionExample = isForward
    ? "例如：第一步是【戊申】，第二步则是【己酉】（顺排）"
    : "例如：第一步是【戊申】，第二步则是【丁未】（逆排）";

  // 2. 【保留】构建 Prompt 的逻辑完全保留
  // 我们依然要在前端把八字信息整理成一段话发给 AI
  const userPrompt = `
    请根据以下**已经排好的**八字四柱和**指定的大运信息**进行分析。
    
    【基本信息】
    性别：${genderStr}
    姓名：${input.name || "未提供"}
    出生年份：${input.birthYear}年 (阳历)
    
    【八字四柱】
    年柱：${input.yearPillar} (天干属性：${
    yearStemPolarity === "YANG" ? "阳" : "阴"
  })
    月柱：${input.monthPillar}
    日柱：${input.dayPillar}
    时柱：${input.hourPillar}
    
    【大运核心参数】
    1. 起运年龄：${input.startAge} 岁 (虚岁)。
    2. 第一步大运：${input.firstDaYun}。
    3. **排序方向**：${daYunDirectionStr}。
    
    【必须执行的算法 - 大运序列生成】
    请严格按照以下步骤生成数据：
    
    1. **锁定第一步**：确认【${input.firstDaYun}】为第一步大运。
    2. **计算序列**：根据六十甲子顺序和方向（${daYunDirectionStr}），推算出接下来的 9 步大运。
       ${directionExample}
    3. **填充 JSON**：
       - Age 1 到 ${startAgeInt - 1}: daYun = "童限"
       - Age ${startAgeInt} 到 ${startAgeInt + 9}: daYun = [第1步大运: ${
    input.firstDaYun
  }]
       - Age ${startAgeInt + 10} 到 ${startAgeInt + 19}: daYun = [第2步大运]
       - Age ${startAgeInt + 20} 到 ${startAgeInt + 29}: daYun = [第3步大运]
       - ...以此类推直到 100 岁。
    
    【特别警告】
    - **daYun 字段**：必须填大运干支（10年一变），**绝对不要**填流年干支。
    - **ganZhi 字段**：填入该年份的**流年干支**（每年一变，例如 2024=甲辰，2025=乙巳）。
    
    任务：
    1. 确认格局与喜忌。
    2. 生成 **1-100 岁 (虚岁)** 的人生流年K线数据。
    3. 在 \`reason\` 字段中提供流年详批。
    4. 生成带评分的命理分析报告。
    
    请严格按照系统指令生成 JSON 数据。
  `;

  try {
    // 3. 【修改核心】不再请求 Google，而是请求我们自己的 Vercel 后端
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
        // 注意：这里不需要 Authorization 头了，Key 在后端
      },
      body: JSON.stringify({
        // 我们把生成好的 prompt 和系统指令传给后端
        prompt: userPrompt,
        systemInstruction: BAZI_SYSTEM_INSTRUCTION,
        // Optional Overrides
        apiKey: input.apiKey,
        modelName: input.modelName
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`请求失败: ${response.status} - ${errText}`);
    }

    const jsonResponse = await response.json();

    // 后端返回的数据结构应该是 { result: "AI生成的JSON字符串" }
    const content = jsonResponse.result;

    if (!content) {
      throw new Error("模型未返回任何内容。");
    }

    // 4. 【解析】前端负责把 AI 返回的字符串解析成 JSON 对象
    // 注意：这里加一个 try-catch，防止 AI 返回的不是标准 JSON
    let data;
    try {
      // 有时候 AI 会包裹 ```json ... ```，我们需要清理一下
      // Robust JSON extraction: Find the first '{' and the last '}'
      const jsonStartIndex = content.indexOf("{");
      const jsonEndIndex = content.lastIndexOf("}");

      if (jsonStartIndex === -1 || jsonEndIndex === -1) {
        throw new Error("No JSON object found in response");
      }

      const cleanContent = content.substring(jsonStartIndex, jsonEndIndex + 1);
      data = JSON.parse(cleanContent);
    } catch (e) {
      console.error("JSON Parse Error:", e, content);
      throw new Error("AI 返回的数据格式无法解析，请重试。");
    }

    // 简单校验数据完整性
    if (!data.chartPoints || !Array.isArray(data.chartPoints)) {
      throw new Error("模型返回的数据格式不正确（缺失 chartPoints）。");
    }

    return {
      chartData: data.chartPoints,
      analysis: {
        bazi: data.bazi || [],
        summary: data.summary || "无摘要",
        summaryScore: data.summaryScore || 5,
        industry: data.industry || "无",
        industryScore: data.industryScore || 5,
        wealth: data.wealth || "无",
        wealthScore: data.wealthScore || 5,
        marriage: data.marriage || "无",
        marriageScore: data.marriageScore || 5,
        health: data.health || "无",
        healthScore: data.healthScore || 5,
        family: data.family || "无",
        familyScore: data.familyScore || 5
      }
    };
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
};
