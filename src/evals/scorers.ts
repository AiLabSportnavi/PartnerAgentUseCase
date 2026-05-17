import {
  createAnswerRelevancyScorer,
  createHallucinationScorer,
  createFaithfulnessScorer,
  createToolCallAccuracyScorerCode,
  createToneScorer,
  createPromptAlignmentScorerLLM,
} from "@mastra/evals/scorers/prebuilt";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Use the same cheap/fast model as LLM judge for evals
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// The judge model — evaluates agent responses
const judgeModel = openrouter("google/gemini-2.0-flash-001");

/**
 * Answer Relevancy: Does the response actually answer the question?
 * Score 0-1, higher is better.
 */
export const answerRelevancy = createAnswerRelevancyScorer({
  model: judgeModel,
});

/**
 * Hallucination: Does the response contain made-up facts?
 * Score 0-1, LOWER is better (0 = no hallucination).
 */
export const hallucination = createHallucinationScorer({
  model: judgeModel,
});

/**
 * Faithfulness: Does the response accurately represent the tool/context data?
 * Score 0-1, higher is better.
 */
export const faithfulness = createFaithfulnessScorer({
  model: judgeModel,
});

/**
 * Tool Call Accuracy: Did the agent call the right tools?
 * Code-based scorer (no LLM needed), checks tool was called.
 * Score 0-1, higher is better.
 */
export const toolCallAccuracy = createToolCallAccuracyScorerCode({
  expectedTool: "searchPartners",
});

/**
 * Prompt Alignment: Does the response follow the system prompt instructions?
 * Evaluates against the agent's system prompt automatically.
 * Score 0-1, higher is better.
 */
export const promptAlignment = createPromptAlignmentScorerLLM({
  model: judgeModel,
});

/**
 * All scorers bundled for the main experiment
 */
export const allScorers = [
  answerRelevancy,
  hallucination,
  faithfulness,
  promptAlignment,
];

/**
 * Trajectory scorers — evaluate tool usage patterns
 */
export const trajectoryScorers = [toolCallAccuracy];
