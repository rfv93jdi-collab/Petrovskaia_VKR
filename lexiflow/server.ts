import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const execFileAsync = promisify(execFile);

function getLLMostApiBaseUrl(): string {
  return (process.env.LLMOST_API_BASE_URL || "https://llmost.ru/api/v1").trim();
}

function getLLMostKey(): string {
  return (process.env.GEMINI_API_KEY || "").trim();
}

function getAnalyzeModel(): string {
  return (process.env.LLMOST_MODEL_ANALYZE || "openai/gpt-4").trim();
}

function getChatModel(): string {
  return (process.env.LLMOST_MODEL_CHAT || "openai/gpt-4").trim();
}

function decodeBase64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

function guessFileExtension(mimeType: string | undefined, fileName: string | undefined): string {
  if (fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext) return ext.replace(".", "");
  }
  if (!mimeType) return "bin";
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("docx")) return "docx";
  if (mimeType.includes("msword")) return "doc";
  return "bin";
}

function safeExtractJson(text: string): any {
  const trimmed = text.trim();
  const withoutFences = trimmed
    .replace(/```(?:json)?/g, "")
    .replace(/```/g, "")
    .trim();

  // We expect a JSON object from the model.
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? withoutFences.slice(start, end + 1) : withoutFences;
  return JSON.parse(candidate);
}

function looksLikeJsonObject(value: string): boolean {
  const t = value.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function sanitizeFallbackSource(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (looksLikeJsonObject(trimmed)) return "";
  if (isDegenerateModelValue(trimmed)) return "";
  return trimmed;
}

function isLowInformationText(value: string): boolean {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return true;

  // Typical PDF artefacts like "-- 1 of 1 --" should not be treated as content.
  const withoutPageMarkers = text
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, " ")
    .replace(/page\s*\d+\s*of\s*\d+/gi, " ")
    .replace(/[|_\-–—.=*~`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutPageMarkers) return true;

  const letters = (withoutPageMarkers.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
  const words = withoutPageMarkers.split(/\s+/).filter(Boolean);
  if (letters < 25 || words.length < 6) return true;

  return false;
}

function buildFallbackAnalysis(extractedText: string, modelText?: string): { clauses: string[]; risk: any } {
  const modelSource = sanitizeFallbackSource(modelText || "");
  const extractedSource = sanitizeFallbackSource(extractedText || "");
  const source = (modelSource || extractedSource).replace(/\s+/g, " ").trim();
  const parts = source
    .split(/[.!?;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const clauses = parts.slice(0, 5);

  return {
    clauses: clauses.length ? clauses : [source.slice(0, 180) || "Документ требует дополнительной проверки."],
    risk: {
      title: "Выявлены потенциальные юридические риски",
      description: source.slice(0, 700) || "Документ содержит условия, требующие правовой оценки.",
      severity: "Средний",
      recommendation: "Провести детальную юридическую проверку документа перед подписанием.",
      actionPlan: [
        "Проверить условия оплаты, ответственности и подсудности",
        "Согласовать правки с юристом",
        "Зафиксировать изменения в письменном виде",
      ],
    },
  };
}

function isDegenerateModelValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("not enough data") ||
    normalized.includes("not available") ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized.includes("insufficient data")
  );
}

function normalizeClauses(rawClauses: unknown): string[] {
  if (!Array.isArray(rawClauses)) return [];
  return rawClauses
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      const lower = s.toLowerCase();
      if (isDegenerateModelValue(lower)) return false;
      // Drop accidental nested JSON blobs instead of clauses.
      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) return false;
      return true;
    });
}

function normalizeRisk(rawRisk: unknown): Record<string, any> {
  if (!rawRisk || typeof rawRisk !== "object") return {};
  const risk = rawRisk as Record<string, any>;
  const title = typeof risk.title === "string" ? risk.title.trim() : "";
  const description = typeof risk.description === "string" ? risk.description.trim() : "";
  if (!title || !description) return {};
  if (isDegenerateModelValue(title) || isDegenerateModelValue(description)) {
    return {};
  }
  return risk;
}

async function callLLMostChatCompletion(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: any }>;
  temperature?: number;
}): Promise<string> {
  const apiKey = getLLMostKey();
  if (!apiKey) throw new Error("LLMost API key not configured (GEMINI_API_KEY is empty).");

  const url = `${getLLMostApiBaseUrl()}/chat/completions`;
  const body = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.2,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LLMost request failed (${resp.status}): ${text.slice(0, 600)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLMost returned empty message content.");
  return String(content);
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = (result.text || "").trim();
    if (text && !isLowInformationText(text)) return text;

    // Fallback: if PDF has no text (likely scanned), OCR rendered pages.
    // We intentionally limit number of pages to keep response time predictable.
    const screenshot = await parser.getScreenshot({
      scale: 1.5,
      first: 5,
      imageDataUrl: false,
      imageBuffer: true,
    });

    const pages = screenshot?.pages || [];
    const ocrChunks: string[] = [];
    for (const page of pages.slice(0, 5)) {
      if (page?.data) {
        const chunk = await extractTextFromImage(page.data, "image/png");
        if (chunk) ocrChunks.push(chunk);
      }
    }

    const ocrText = ocrChunks.join("\n\n").trim();
    if (!isLowInformationText(ocrText)) return ocrText;

    // If both machine text and OCR are weak, return the better of two.
    return ocrText.length > text.length ? ocrText : text;
  } finally {
    await parser.destroy();
  }
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value || "").trim();
}

async function extractTextFromDoc(buffer: Buffer): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lexiflow-antiword-"));
  const inputPath = path.join(tmpDir, "input.doc");

  try {
    await fs.promises.writeFile(inputPath, buffer);

    // antiword prints extracted text to stdout.
    try {
      const result = await execFileAsync("antiword", [inputPath], { timeout: 60_000 });
      const stdout = typeof result?.stdout === "string" ? result.stdout : String(result?.stdout ?? "");
      if (stdout.trim()) return stdout.trim();
    } catch (antiwordErr: any) {
      // Fallback path below.
      if (antiwordErr?.code === "ENOENT") {
        throw new Error("DOC extraction requires `antiword`, but it is not installed on this server.");
      }
    }

    // Fallback 1: mislabelled DOCX (zip container starts with PK).
    if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
      const docxText = await extractTextFromDocx(buffer).catch(() => "");
      if (docxText.trim()) return docxText.trim();
    }

    // Fallback 2: HTML/text content saved with .doc extension.
    const utf8 = buffer.toString("utf8");
    const sample = utf8.slice(0, 3000).toLowerCase();
    if (sample.includes("<html") || sample.includes("<body") || sample.includes("<p>")) {
      const htmlAsText = utf8
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
      if (htmlAsText) return htmlAsText;
    }

    // Fallback 3: basic RTF to plain text.
    if (sample.includes("{\\rtf")) {
      const rtfText = utf8
        .replace(/\\'[0-9a-fA-F]{2}/g, " ")
        .replace(/\\[a-zA-Z]+\d* ?/g, " ")
        .replace(/[{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (rtfText) return rtfText;
    }

    // Fallback 4: plain text files with wrong extension.
    const plain = utf8.replace(/\s+/g, " ").trim();
    if (plain) return plain;

    throw new Error("Unable to extract text from DOC file.");
  } catch (e: any) {
    throw e;
  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractTextFromImage(
  buffer: Buffer | Uint8Array,
  mimeType: string | undefined,
  fileName?: string
): Promise<string> {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const ext = guessFileExtension(mimeType, fileName);
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lexiflow-ocr-"));
  const inputPath = path.join(tmpDir, `input.${ext}`);
  const outBase = path.join(tmpDir, "out");
  const txtPath = `${outBase}.txt`;

  try {
    await fs.promises.writeFile(inputPath, buf);

    // Try Russian first, then English.
    const langsToTry = ["rus", "eng"];
    let lastErr: unknown;
    for (const lang of langsToTry) {
      try {
        await execFileAsync("tesseract", [inputPath, outBase, "-l", lang, "--dpi", "300"]);
        const txt = await fs.promises.readFile(txtPath, "utf8");
        if (txt.trim()) return txt.trim();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("OCR failed.");
  } finally {
    // Best-effort cleanup.
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractTextFromFileBody(body: {
  fileBase64: string;
  mimeType?: string;
  fileName?: string;
}): Promise<string> {
  const buffer = decodeBase64ToBuffer(body.fileBase64);
  const mimeType = body.mimeType?.toLowerCase();

  if (mimeType?.includes("pdf")) {
    return extractTextFromPdf(buffer);
  }

  if (mimeType?.startsWith("image/")) {
    return extractTextFromImage(buffer, mimeType, body.fileName);
  }

  if (
    mimeType?.includes("officedocument.wordprocessingml.document") ||
    mimeType?.includes("docx")
  ) {
    return extractTextFromDocx(buffer);
  }

  // DOC97/2003 -> text via antiword.
  if (mimeType?.includes("msword") || mimeType?.includes("doc")) {
    return extractTextFromDoc(buffer);
  }

  // If mimetype is missing, fall back to filename extension.
  const ext = (body.fileName ? path.extname(body.fileName).toLowerCase() : "").replace(".", "");
  if (ext === "pdf") return extractTextFromPdf(buffer);
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return extractTextFromImage(buffer, mimeType, body.fileName);
  if (ext === "docx") return extractTextFromDocx(buffer);
  if (ext === "doc") return extractTextFromDoc(buffer);

  throw new Error("Unsupported file type. Upload PDF, images (JPG/PNG), or DOCX.");
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Base64-файл может быть заметно больше исходного размера.
  app.use(express.json({ limit: "30mb" }));

  app.post("/api/analyze-document", async (req, res) => {
    try {
      const { text, context, fileBase64, mimeType, fileName } = req.body as {
        text?: string;
        context?: string;
        fileBase64?: string;
        mimeType?: string;
        fileName?: string;
      };

      const llmKey = getLLMostKey();
      if (!llmKey) return res.status(500).json({ error: "LLMost API key not configured (GEMINI_API_KEY is empty)." });

      const extractedText =
        typeof text === "string" && text.trim()
          ? text.trim()
          : typeof fileBase64 === "string"
            ? await extractTextFromFileBody({ fileBase64, mimeType, fileName })
            : "";

      if (!extractedText) {
        return res.status(400).json({ error: "No text to analyze. Provide `text` or a supported `fileBase64`." });
      }

      const analysisContext =
        typeof context === "string" && context.trim() ? context.trim() : "проверка юридических рисков в B2B договорах";

      const textForModel = extractedText.length > 12000 ? extractedText.slice(0, 12000) : extractedText;

      const prompt = `Проанализируй юридический документ для выявления рисков на основе контекста: ${analysisContext}.

Документ (текст):
${textForModel}

Верни ТОЛЬКО валидный JSON-объект (без Markdown и без комментариев) в формате:
{
  "clauses": ["пункт 1", "пункт 2", "..."],
  "risk": {
    "title": "Заголовок риска",
    "description": "Подробное описание риска на основе документа",
    "severity": "Критично" | "Высокий" | "Средний" | "Низкий",
    "recommendation": "Что нужно сделать, чтобы исправить",
    "actionPlan": ["шаг 1", "шаг 2", "..."]
  }
}`;

      const retryPrompt = `Повтори запрос. Верни ТОЛЬКО валидный JSON-объект без Markdown и без любых пояснений.
Начни ответ строго с '{ "clauses": ... }'. Если данных недостаточно, всё равно верни JSON с полями "clauses" и "risk".`;

      let lastParseError: unknown;
      let lastModelText = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const content = await callLLMostChatCompletion({
          model: getAnalyzeModel(),
          messages: [
            { role: "system", content: "Ты — эксперт по комплаенсу и юридическим рискам в B2B." },
            { role: "user", content: attempt === 0 ? prompt : retryPrompt },
          ],
          temperature: 0.2,
        });
        lastModelText = content;

        try {
          const parsed = safeExtractJson(content);
          const clauses = normalizeClauses(parsed?.clauses);
          const risk = normalizeRisk(parsed?.risk);

          if (!clauses.length || !risk?.title) {
            const fallback = buildFallbackAnalysis(extractedText, content);
            return res.json(fallback);
          }

          return res.json({ clauses, risk });
        } catch (e) {
          lastParseError = e;
        }
      }

      const fallback = buildFallbackAnalysis(extractedText, lastModelText);
      return res.json(fallback);
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: "Failed to analyze document" });
    }
  });

  app.post("/api/lexi-ask", async (req, res) => {
    try {
      const { riskTitle, riskDescription, userMessage } = req.body as {
        riskTitle: string;
        riskDescription: string;
        userMessage: string;
      };

      if (!riskTitle || !riskDescription || !userMessage) {
        return res.status(400).json({ error: "Missing riskTitle/riskDescription/userMessage." });
      }

      const systemInstruction = `Ты - экспертный ИИ-ассистент Лекси по риск-менеджменту в сфере B2B.
Твоя специализация: HR-комплаенс, информационная безопасность (ПДн и КТ), судебные и налоговые риски.

Контекст текущего риска:
Название: ${riskTitle}
Описание: ${riskDescription}

Твои задачи:
1. Объяснять сложные юридические последствия простым языком.
2. Давать конкретные пошаговые инструкции по исправлению ситуации (Action Plan).
3. Оценивать критичность ситуации.
4. Отвечать строго на русском языке, профессионально, но доступно.

Если пользователь спрашивает не по теме риска, вежливо верни его к обсуждению правовой безопасности бизнеса.`;

      const content = await callLLMostChatCompletion({
        model: getChatModel(),
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
      });

      res.json({ answer: content });
    } catch (error) {
      console.error("Lexi error:", error);
      res.status(500).json({ error: "Failed to get Lexi answer" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
