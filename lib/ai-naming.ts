import { generateNames } from "./naming";

type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function outputText(response: OpenAIResponse): string {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function sanitizeLabel(value: string) {
  return value
    .split(".")[0]
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 18);
}

export async function generateSmartNames(prompt: string, limit: number): Promise<{ names: string[]; provider: "openai" | "fallback" }> {
  const fallback = generateNames(prompt, limit);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { names: fallback, provider: "fallback" };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
        input: `You are a senior brand strategist and domain naming specialist.\n\nBusiness idea: ${prompt}\n\nGenerate exactly ${limit} strong brand names for this business. Avoid boring literal keyword domains. Use sector vocabulary, associations, memorable invented words, premium-sounding compounds and names that can grow beyond one product. Names must be easy to pronounce in Polish or internationally, 4-14 ASCII letters, without spaces, hyphens, numbers or domain extensions. Do not imitate famous brands or obvious trademarks. Return only the requested structured data.`,
        text: {
          format: {
            type: "json_schema",
            name: "domain_brand_candidates",
            strict: true,
            schema: {
              type: "object",
              properties: {
                names: {
                  type: "array",
                  items: { type: "string" },
                  minItems: limit,
                  maxItems: limit,
                },
              },
              required: ["names"],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 1800,
      }),
    });

    if (!response.ok) return { names: fallback, provider: "fallback" };
    const payload = (await response.json()) as OpenAIResponse;
    const text = outputText(payload);
    if (!text) return { names: fallback, provider: "fallback" };
    const parsed = JSON.parse(text) as { names?: string[] };
    const aiNames = (parsed.names ?? [])
      .map(sanitizeLabel)
      .filter((name) => name.length >= 4 && name.length <= 14);
    const names = Array.from(new Set([...aiNames, ...fallback])).slice(0, limit);
    return { names, provider: aiNames.length ? "openai" : "fallback" };
  } catch {
    return { names: fallback, provider: "fallback" };
  }
}
