import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    node: process.version,
    env: {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? "set" : "MISSING",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "MISSING",
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "set" : "MISSING",
      CONVEX_SITE_URL: process.env.CONVEX_SITE_URL || "MISSING",
    },
  });
}
