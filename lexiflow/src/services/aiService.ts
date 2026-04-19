import { Risk } from "../types";

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

function normalizeAnalyzeResponse(data: any): { clauses: string[]; risk: Partial<Risk> } {
  let clauses: string[] = Array.isArray(data?.clauses)
    ? data.clauses.filter((c: unknown): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean)
    : [];
  let risk: Partial<Risk> = data?.risk && typeof data.risk === "object" ? data.risk : {};

  // Some model/provider responses occasionally return a nested JSON blob as first clause.
  if (clauses.length === 1) {
    const single = clauses[0];
    if ((single.startsWith("{") && single.endsWith("}")) || (single.startsWith("[") && single.endsWith("]"))) {
      try {
        const nested = JSON.parse(single);
        clauses = Array.isArray(nested?.clauses)
          ? nested.clauses.filter((c: unknown): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean)
          : clauses;
        if (nested?.risk && typeof nested.risk === "object") {
          risk = nested.risk;
        }
      } catch {
        // keep original values
      }
    }
  }

  // Drop known degenerate values to let UI use safe defaults.
  clauses = clauses.filter((c) => !isDegenerateModelValue(c));
  if (typeof risk.title === "string" && isDegenerateModelValue(risk.title)) risk = {};
  if (typeof risk.description === "string" && isDegenerateModelValue(risk.description)) risk = {};

  return { clauses, risk };
}

export async function analyzeDocument(
  file: File
): Promise<{ clauses: string[]; risk: Partial<Risk> }> {
  const base64Data = await fileToBase64(file);
  const mimeType = file.type || "application/pdf";

  const response = await fetch("/api/analyze-document", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileBase64: base64Data,
      mimeType,
      fileName: file.name,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Не удалось проанализировать документ");
  }

  return normalizeAnalyzeResponse(data);
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(",")[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
}
