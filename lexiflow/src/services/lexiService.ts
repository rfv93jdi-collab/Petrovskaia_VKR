export async function askLexi(riskTitle: string, riskDescription: string, userMessage: string) {
  try {
    const response = await fetch("/api/lexi-ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        riskTitle,
        riskDescription,
        userMessage,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return data?.error || "Извините, я временно не могу ответить. Попробуйте позже.";
    }

    return data?.answer || "Извините, я не получил ответа от системы.";
  } catch (error) {
    console.error("Lexi error:", error);
    return "Извините, я временно не могу ответить. Попробуйте позже.";
  }
}
