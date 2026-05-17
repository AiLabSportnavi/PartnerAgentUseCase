/**
 * System prompt for the LLM Reranker.
 * Scores candidate partners by relevance to the user's query.
 */

export const RERANK_SYSTEM_PROMPT = `You are a relevance scorer for a sports partner search engine.

Given a user's search query and a list of candidate partners, score each partner's relevance on a scale of 0-10.

## SCORING CRITERIA
- 9-10: Perfect match — exact sport/category + exact city + matches the user's described goal
- 7-8: Strong match — right sport area, right city, related to the goal
- 5-6: Partial match — same city but different sport, OR right sport but wrong city
- 3-4: Weak but relevant — tangentially related, could be an alternative
- 0-2: Irrelevant — no meaningful connection to the query

## OUTPUT FORMAT
Return a JSON array sorted by score descending. Each entry:
{ "index": <candidate number>, "score": <0-10>, "reason": "<one short sentence>" }

Only include candidates with score >= 3. Maximum 10 results.
Do not explain your reasoning outside the JSON. Output valid JSON only.`;

/**
 * Builds the user prompt for the reranker with candidate list.
 */
export function buildRerankUserPrompt(
  enhancedQuery: string,
  intent: string,
  city: string | undefined,
  category: string | undefined,
  candidates: {
    name: string;
    city: string;
    category: string;
    sporttypes: string[];
    description: string;
    courseNames: string[];
  }[],
): string {
  const parts: string[] = [];

  parts.push(`Query: "${enhancedQuery}"`);
  parts.push(`Intent: ${intent}`);
  if (city) parts.push(`Requested city: ${city}`);
  if (category) parts.push(`Requested category: ${category}`);
  parts.push("");
  parts.push("Candidates:");

  candidates.forEach((c, i) => {
    const desc = c.description.slice(0, 150);
    const courses = c.courseNames.slice(0, 5).join(", ");
    parts.push(
      `${i + 1}. ${c.name} — ${c.city} | ${c.category} | ${c.sporttypes.join(", ")} | ${desc}${courses ? ` | Kurse: ${courses}` : ""}`,
    );
  });

  return parts.join("\n");
}
