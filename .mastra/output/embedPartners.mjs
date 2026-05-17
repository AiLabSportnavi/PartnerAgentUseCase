import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';

let _embeddingModel = null;
function getEmbeddingModel() {
  if (!_embeddingModel) {
    const openrouter = createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1"
    });
    _embeddingModel = openrouter.embedding("openai/text-embedding-3-large");
  }
  return _embeddingModel;
}
async function embedSingle(text) {
  const result = await embed({ model: getEmbeddingModel(), value: text });
  return result.embedding;
}

export { embedSingle };
