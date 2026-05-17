/**
 * Pre-processing guard: detects prompt injection and unsafe inputs
 * BEFORE the LLM sees the message. Fast regex-based — this is a narrow,
 * well-defined problem where regex excels (unlike intent classification).
 */

export interface PreProcessResult {
  blocked: boolean;
  reason?: string;
  safeResponse?: string;
  sanitizedInput?: string;
}

const INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction override
  /ignore\s*(all\s*)?(previous|prior|your|my)?\s*(instructions?|prompts?|rules?)/i,
  /forget\s*(all\s*)?(previous|prior|your)?\s*(instructions?|context)/i,
  /vergiss\s*(alles|alle|deine)/i,
  /override\s*(your|the)?\s*(instructions?|rules?|system)/i,

  // Role hijacking
  /\b(pretend|act\s+as|you\s+are\s+now|du\s+bist\s+(jetzt|nun)|sei\s+jetzt)\b/i,
  /\b(roleplay|role-play|role\s+play)\s*(as|:)/i,
  /\bnew\s+persona\b/i,

  // Known jailbreak patterns
  /\bDAN\b/,
  /\b(developer|admin|debug|sudo|root)\s+mode\b/i,
  /\bjailbreak\b/i,
  /\bdo\s+anything\s+now\b/i,

  // System prompt extraction
  /\bSYSTEM\s*:/i,
  /\[ADMIN/i,
  /\[(SYSTEM|INST|SYS)\]/i,
  /sag\s*(mir\s*)?(deine?|die)\s*(system|instructions?|prompt|regeln)/i,
  /\b(reveal|show|list|print|display|repeat|echo)\s*(your\s*)?(system|internal|tools?|prompt|instructions?|rules?)\b/i,
  /was\s*(sind|ist)\s*(dein|deine)\s*(system|prompt|anweisung)/i,
  /\b(zeig|gib)\s*(mir\s*)?(dein|deine)\s*(prompt|anweisung|regeln)\b/i,

  // Emotional manipulation for override
  /\b(or\s+(a|the)\s+(puppy|kitten|baby)|someone\s+will\s+die|emergency\s+override)\b/i,

  // Encoding/obfuscation attempts
  /\b(base64|rot13|hex)\s*(encode|decode|this|the|my)/i,
];

const SAFE_RESPONSES: Record<string, string> = {
  de: "Ich bin dein Sport Navi Assistent — ich helfe dir, Partner zu finden. Was suchst du?",
  en: "I'm your Sport Navi assistant — I help you find sport partners. What are you looking for?",
};

function detectLanguage(input: string): "de" | "en" {
  if (/[äöüß]|^(ich|was|wie|wo|der|die|das|ein|und|ist|bin|hab)\b/i.test(input)) {
    return "de";
  }
  return "en";
}

export function preProcess(input: string): PreProcessResult {
  const trimmed = input.trim();

  // Check injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      const lang = detectLanguage(trimmed);
      return {
        blocked: true,
        reason: `injection_detected: ${pattern.source.slice(0, 50)}`,
        safeResponse: SAFE_RESPONSES[lang],
      };
    }
  }

  // Block excessively long inputs (prompt stuffing)
  if (trimmed.length > 2000) {
    return {
      blocked: true,
      reason: "input_too_long",
      safeResponse: SAFE_RESPONSES.de,
    };
  }

  // Block base64-like encoded content blocks
  if (/[A-Za-z0-9+/]{100,}={0,2}/.test(trimmed)) {
    return {
      blocked: true,
      reason: "encoded_content_detected",
      safeResponse: SAFE_RESPONSES.de,
    };
  }

  return {
    blocked: false,
    sanitizedInput: trimmed,
  };
}
