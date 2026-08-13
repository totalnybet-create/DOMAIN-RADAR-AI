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

export async function generateSmartNames(
  prompt: string,
  limit: number,
  options: { exclude?: string[]; tld?: string; batch?: number } = {},
): Promise<{ names: string[]; provider: "openai" | "fallback" }> {
  const exclude = Array.from(new Set((options.exclude ?? []).map(sanitizeLabel).filter(Boolean))).slice(0, 500);
  const fallback = generateNames(prompt, limit, { exclude, tld: options.tld });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { names: fallback, provider: "fallback" };

  try {
    const exclusionText = exclude.length ? `\nDo NOT repeat any of these previously generated names:\n${exclude.join(", ")}` : "";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
        input: `You are a senior naming strategist. The user may enter either a business description OR one seed word/name.\n\nInput: ${prompt}\nTarget TLD: .${options.tld || "pl"}\nBatch: ${options.batch || 1} of 5.\n\nGenerate exactly ${limit} UNIQUE brand/name candidates. If the input is a single word or short name, prioritize close lexical, phonetic, morphological and semantic variations of that exact word: natural prefixes/suffixes, tasteful spelling shifts, syllable blends, abbreviations and invented forms that still feel related. If it is a business description, use its vocabulary and associations. Make the set appropriate for the target TLD and noticeably different from earlier batches. Names must be 4-18 ASCII letters, no spaces, hyphens, numbers or extensions. Avoid famous brands and obvious trademarks.${exclusionText}\nReturn only the structured data.`,
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
        max_output_tokens: 6000,
      }),
    });

    if (!response.ok) return { names: fallback, provider: "fallback" };
    const payload = (await response.json()) as OpenAIResponse;
    const text = outputText(payload);
    if (!text) return { names: fallback, provider: "fallback" };
    const parsed = JSON.parse(text) as { names?: string[] };
    const excluded = new Set(exclude);
    const aiNames = (parsed.names ?? [])
      .map(sanitizeLabel)
      .filter((name) => name.length >= 4 && name.length <= 18 && !excluded.has(name));
    const names = Array.from(new Set([...aiNames, ...fallback])).slice(0, limit);
    return { names, provider: aiNames.length ? "openai" : "fallback" };
  } catch {
    return { names: fallback, provider: "fallback" };
  }
}
