import { generateNames } from "./naming";
import type { RadarSettings } from "./settings";
import { resolveModel } from "./settings";
import { normalizeLabel } from "./scoring";

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

function sanitizeLabel(value: string, maxLength: number) {
  return normalizeLabel(value.split(".")[0]).slice(0, maxLength);
}

export async function generateSmartNames(
  prompt: string,
  limit: number,
  options: { exclude?: string[]; tld?: string; batch?: number; settings: RadarSettings },
): Promise<{ names: string[]; provider: "openai" | "fallback"; model: string }> {
  const batch = Math.max(1, Math.min(options.batch ?? 1, 5));
  const settings = options.settings;
  const exclude = Array.from(new Set((options.exclude ?? []).map((value) => sanitizeLabel(value, settings.maxLength)).filter(Boolean))).slice(0, 500);
  const fallback = generateNames(prompt, limit, { exclude, batch, settings });
  const model = resolveModel(settings.model, batch);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { names: fallback, provider: "fallback", model };

  const radius = [
    "ULTRA-CLOSE: exact seed, shortest labels, edit distance 0-1, one-letter additions/deletions/substitutions. Literal similarity dominates.",
    "CLOSE: phonetic variants, keyboard neighbors, single edits, tasteful short neologisms. Stay visibly related to the seed.",
    "BRAND EXPANSION: brandable short variants, abbreviations, semantic neighbors and alternate spellings, while preserving a clear relationship.",
    "CREATIVE: explore short premium-sounding names, root blends and phonetic patterns without losing quality.",
    "DISCOVERY: search less obvious high-quality territory not covered earlier; never repeat and still prioritize short memorable names.",
  ][batch - 1];

  const expectedText = settings.expected.length
    ? `\nEXPECTED positive examples: ${settings.expected.join(", ")}. Infer their shared length, prefix/suffix, vowels, syllables and phonetic style; do not merely copy them.`
    : "";
  const exclusionText = exclude.length
    ? `\nSEEN_CANDIDATES — ABSOLUTE BAN ON REPEATS:\n${exclude.join(", ")}`
    : "";

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        reasoning: { effort: model.includes("luna") ? "low" : model.includes("terra") ? "medium" : "medium" },
        input: `DOMAIN RADAR AI — MASTER NAMING TASK\n\nQUERY: ${prompt}\nTARGET TLD: .${options.tld || "pl"}\nBATCH: ${batch}/5\nMODE: ${settings.mode}\nLANGUAGE: ${settings.language}\nLENGTH: ${settings.minLength}-${settings.maxLength} characters\nDIGITS: ${settings.noDigits ? "FORBIDDEN" : "allowed"}\nHYPHENS: ${settings.noHyphens ? "FORBIDDEN" : "allowed"}\n\nPRIORITY: SHORT → CLOSE → EASY TO PRONOUNCE → BRANDABLE → CREATIVE.\n${radius}\n\nIf QUERY has 1-3 characters, treat it primarily as a naming root, not a full word. Aggressively explore 2-4 character combinations around the root before longer names. If QUERY is longer, generate exact/minimal edits, shortenings, phonetic alternatives, keyboard-neighbor typos, vowel/consonant substitutions, brandable CVC/CVCV-style forms, semantic neighbors and short root combinations. Semantic ideas must never dominate closer short literal variants.\n\nEvery candidate must be unique, syntactically suitable as a domain label, easy to type, and not an obvious famous brand/trademark. Do not guess domain availability; availability is checked separately by RDAP. SEARCH DEEPER — NEVER REPEAT.${expectedText}${exclusionText}\n\nReturn exactly ${limit} labels only in the structured schema.`,
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
        max_output_tokens: 9000,
      }),
    });

    if (!response.ok) return { names: fallback, provider: "fallback", model };
    const payload = (await response.json()) as OpenAIResponse;
    const text = outputText(payload);
    if (!text) return { names: fallback, provider: "fallback", model };
    const parsed = JSON.parse(text) as { names?: string[] };
    const excluded = new Set(exclude);
    const aiNames = (parsed.names ?? [])
      .map((value) => sanitizeLabel(value, settings.maxLength))
      .filter((name) => name.length >= settings.minLength && name.length <= settings.maxLength && !excluded.has(name));
    const names = Array.from(new Set([...aiNames, ...fallback])).slice(0, limit);
    return { names, provider: aiNames.length ? "openai" : "fallback", model };
  } catch {
    return { names: fallback, provider: "fallback", model };
  }
}
