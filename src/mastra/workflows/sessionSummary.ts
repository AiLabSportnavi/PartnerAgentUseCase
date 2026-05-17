/**
 * Session Summary Builder — pure TypeScript, no LLM, <1ms.
 *
 * Reads the structured conversation history (messages + retrieved partners)
 * and produces a human-readable markdown briefing for the enhance LLM.
 *
 * This replaces dumping 20 raw messages into the prompt. The LLM gets:
 * - Current Focus (city, category, mode) — stated explicitly
 * - What Was Shown (numbered partners per turn) — resolves "the second one"
 * - Last 3 raw messages — preserves tone and exact wording
 */

import type { ConversationEntry } from "./schemas";

export interface SessionSummary {
  markdown: string;
  currentCity: string | undefined;
  currentCategory: string | undefined;
  turnCount: number;
}

export function buildSessionSummary(
  history: ConversationEntry[],
): SessionSummary {
  if (history.length === 0) {
    return {
      markdown: "(No previous conversation — this is the first message.)",
      currentCity: undefined,
      currentCategory: undefined,
      turnCount: 0,
    };
  }

  // ── Extract state from history ──
  let currentCity: string | undefined;
  let currentCategory: string | undefined;
  let turnCount = 0;

  // Track which partners the user interacted with (asked about, clicked, etc.)
  const interactedPartnerIds = new Set<string>();

  // Build turn data (pairs of user + assistant messages)
  const turns: {
    turnNumber: number;
    userMessage: string;
    assistantMessage: string;
    partners: { id: string; name: string; city: string }[];
  }[] = [];

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];

    if (entry.role === "assistant") {
      turnCount++;
      const partners = entry.retrievedPartners || [];

      // Track city from retrieved partners
      if (partners.length > 0 && partners[0].city) {
        currentCity = partners[0].city;
      }

      // Try to detect city from message content if no partners
      if (!currentCity && entry.content) {
        const cityMatch = entry.content.match(/in\s+(Dortmund|Bielefeld|Essen|Düsseldorf|Köln|Hamburg|Berlin|München|Bochum|Herne|Paderborn|Gütersloh|Münster)/i);
        if (cityMatch) currentCity = cityMatch[1];
      }

      // Find the user message before this assistant message
      const userMsg =
        i > 0 && history[i - 1].role === "user"
          ? history[i - 1].content
          : "";

      turns.push({
        turnNumber: turnCount,
        userMessage: userMsg,
        assistantMessage: entry.content.slice(0, 150),
        partners,
      });
    }
  }

  // Detect current category from recent messages
  const recentUserMessages = history
    .filter((e) => e.role === "user")
    .map((e) => e.content);
  const lastUserMsg = recentUserMessages[recentUserMessages.length - 1] || "";

  // Simple category detection from recent messages
  const categoryPatterns: [RegExp, string][] = [
    [/yoga|pilates/i, "yoga"],
    [/fitness|gym|pumpen|muckibude/i, "fitness"],
    [/schwimm|swimming|pool|baden/i, "swimming"],
    [/massage|wellness|entspann/i, "massage"],
    [/kletter|climbing|boulder/i, "climbing"],
    [/box|boxing|kickbox/i, "boxing"],
    [/sauna/i, "sauna"],
    [/ems/i, "ems"],
    [/outdoor|laufen|joggen/i, "outdoor"],
    [/tennis|squash|racket/i, "racket"],
  ];

  for (const [pattern, cat] of categoryPatterns) {
    if (pattern.test(lastUserMsg)) {
      currentCategory = cat;
      break;
    }
  }

  // Detect which partners the user asked about (mentioned by number or name)
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === "user") {
      const msg = history[i].content.toLowerCase();
      // Check for ordinal references in the NEXT turn's partners
      const nextAssistant = history
        .slice(0, i)
        .reverse()
        .find((e) => e.role === "assistant" && e.retrievedPartners?.length);
      if (nextAssistant?.retrievedPartners) {
        if (/\b(erst|first|nr\.?\s*1|den ersten|#1)\b/i.test(msg)) {
          interactedPartnerIds.add(nextAssistant.retrievedPartners[0]?.id);
        }
        if (/\b(zweit|second|nr\.?\s*2|den zweiten|#2)\b/i.test(msg)) {
          interactedPartnerIds.add(nextAssistant.retrievedPartners[1]?.id);
        }
        if (/\b(dritt|third|nr\.?\s*3|den dritten|#3)\b/i.test(msg)) {
          interactedPartnerIds.add(nextAssistant.retrievedPartners[2]?.id);
        }
      }
    }
  }

  // Detect user mode
  let userMode = "browsing";
  if (interactedPartnerIds.size > 0) userMode = "exploring details";
  if (
    recentUserMessages.some((m) =>
      /hilft nicht|nein|falsch|stimmt nicht/i.test(m),
    )
  ) {
    userMode = "frustrated";
  }

  // ── Build markdown ──
  const parts: string[] = [];

  // Section 1: Current Focus
  parts.push("## Session Context\n");
  parts.push("### Current Focus");
  if (currentCity) parts.push(`- City: ${currentCity}`);
  if (currentCategory) parts.push(`- Category: ${currentCategory}`);
  parts.push(`- Mode: ${userMode} (${turnCount} turns so far)`);
  parts.push("");

  // Section 2: What Was Shown (reverse chronological, last 5 turns max)
  if (turns.length > 0) {
    parts.push("### What Was Shown (most recent first)");
    const recentTurns = turns.slice(-5).reverse();
    for (const turn of recentTurns) {
      if (turn.partners.length === 1) {
        parts.push(
          `Turn ${turn.turnNumber}: Partner details for ${turn.partners[0].name} (${turn.partners[0].city})`,
        );
      } else {
        parts.push(
          `Turn ${turn.turnNumber}: ${turn.partners.length} partners:`,
        );
        turn.partners.forEach((p, idx) => {
          const annotation = interactedPartnerIds.has(p.id)
            ? " ← user asked about this one"
            : "";
          parts.push(`  ${idx + 1}. ${p.name} — ${p.city}${annotation}`);
        });
      }
    }
    parts.push("");
  }

  // Section 3: Last 3 raw messages
  const lastN = history.slice(-3);
  if (lastN.length > 0) {
    parts.push("### Recent Messages");
    for (const entry of lastN) {
      const role = entry.role === "user" ? "User" : "Assistant";
      const content =
        entry.content.length > 200
          ? entry.content.slice(0, 200) + "..."
          : entry.content;
      parts.push(`${role}: "${content}"`);
    }
  }

  return {
    markdown: parts.join("\n"),
    currentCity,
    currentCategory,
    turnCount,
  };
}
