/**
 * Post-processing guard: validates LLM output after generation.
 * Detects system internal leaks and replaces with safe fallback.
 */

export interface PostProcessResult {
  passed: boolean;
  reason?: string;
  originalResponse: string;
  finalResponse: string;
}

// Patterns that should NEVER appear in agent responses
const LEAK_PATTERNS: RegExp[] = [
  // Internal tool/function names
  /\b(searchPartners|getPartnerDetails|getCityOverview|getMetadata|semanticSearchPartners)\b/,
  /\b(convexFetch|partnerAgent|smartAgent|intentClassifier|routerAgent|responseAgent)\b/,
  /\b(createTool|createWorkflow|createStep)\b/,

  // Model/infrastructure names
  /\b(gemini[\s-]*2|gpt-[34]|claude|openrouter)\b/i,
  /\b(mastra|convex)\b/i,
  /\b(pgvector|libsql|duckdb)\b/i,

  // Architecture internals
  /\b(system\s*prompt|system\s*instructions)\b/i,
  /\b(meine?\s*(prompt|anweisung(en)?))\b/i,
  /\b(vector\s*(store|database|db|index|embedding))\b/i,
  /\b(embedding\s*model)\b/i,
];

const FALLBACK =
  "Ich bin dein Sport Navi Assistent — ich helfe dir, Partner zu finden. Was suchst du?";

export function postProcess(response: string): PostProcessResult {
  // Check for system internal leaks
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(response)) {
      return {
        passed: false,
        reason: `leak_detected: ${pattern.source.slice(0, 50)}`,
        originalResponse: response,
        finalResponse: FALLBACK,
      };
    }
  }

  // Check for empty response
  if (!response || response.trim().length === 0) {
    return {
      passed: false,
      reason: "empty_response",
      originalResponse: response,
      finalResponse: FALLBACK,
    };
  }

  return {
    passed: true,
    originalResponse: response,
    finalResponse: response,
  };
}
