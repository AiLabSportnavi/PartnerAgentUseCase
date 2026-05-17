import { createStep } from "@mastra/core/workflows";
import { WorkflowInputSchema, EnhanceOutputSchema } from "../schemas";
import { buildSessionSummary } from "../sessionSummary";
import { buildEnhanceUserPrompt } from "../enhancePrompt";
import { preProcess } from "../../guardrails";

/**
 * Step 1: ENHANCE — Query Enhancement + Intent Classification
 *
 * One LLM call replaces the old router. It:
 * 1. Reads the session summary (what was shown, current focus)
 * 2. Rewrites vague messages into precise search queries
 * 3. Resolves references ("the second one", "dort")
 * 4. Classifies intent + extracts slots
 * 5. Detects non-search intents → provides static response
 *
 * Pre-process guard runs first to block injection attempts.
 */
export const enhanceStep = createStep({
  id: "enhance",
  inputSchema: WorkflowInputSchema,
  outputSchema: EnhanceOutputSchema,
  execute: async ({ inputData, mastra }) => {
    // 1. Pre-process guard: block injection before LLM sees it
    const guard = preProcess(inputData.message);
    if (guard.blocked) {
      return {
        enhancedQuery: "",
        intent: "injection" as const,
        confidence: "high" as const,
        slots: {},
        skipSearch: true,
        staticResponse: guard.safeResponse,
        language: "de",
        is_frustrated: false,
        userMessage: inputData.message,
      };
    }

    // 2. Build session summary from conversation history (pure code, <1ms)
    const summary = buildSessionSummary(
      inputData.conversationHistory || [],
    );

    // 3. Build the prompt: session summary + current message
    const userPrompt = buildEnhanceUserPrompt(
      inputData.message,
      summary.markdown,
    );

    // 4. Call enhance agent with structured output
    const enhanceAgent = mastra.getAgent("enhanceAgent");

    let output: any;
    try {
      const result = await enhanceAgent.generate(userPrompt, {
        structuredOutput: {
          schema: EnhanceOutputSchema.omit({ userMessage: true }),
        },
      });
      output = result.object;
    } catch {
      // If structured output fails, fall back to a plain generate + JSON parse
      const fallback = await enhanceAgent.generate(userPrompt);
      try {
        const jsonMatch = (fallback.text || "").match(/\{[\s\S]*\}/);
        output = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch {
        output = {};
      }
    }

    // Apply defaults for any missing fields
    return {
      enhancedQuery: output.enhancedQuery || inputData.message,
      intent: output.intent || "unknown",
      confidence: output.confidence || "low",
      slots: output.slots || {},
      skipSearch: output.skipSearch ?? false,
      staticResponse: output.staticResponse,
      language: output.language || "de",
      is_frustrated: output.is_frustrated ?? false,
      userMessage: inputData.message,
      queryVariants: output.queryVariants || [],
    };
  },
});
