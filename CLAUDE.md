## Mastra AI Framework

This project uses Mastra AI (installed locally, not globally).

### Installed Packages (Superpowers Suite)
- `mastra` — CLI entry point (run via `npx mastra`)
- `@mastra/core` — Core framework: agents, tools, workflows, voice/TTS, evals, MCP
- `@mastra/memory` — Memory/context management for agents
- `@mastra/rag` — RAG (Retrieval Augmented Generation) utilities
- `@mastra/server` — HTTP server for exposing agents/workflows as APIs
- `@mastra/deployer` — Build, package, and deploy Mastra applications
- `@mastra/evals` — Evaluation framework for testing agent quality
- `@mastra/mcp` — Model Context Protocol integration
- `@mastra/pg` — PostgreSQL storage and vector provider
- `@mastra/loggers` — Logging transports (console, file, external)
- `@mastra/observability` — OpenTelemetry tracing and scoring

### CLI Usage
Run the Mastra CLI locally with: `npx mastra <command>`
- `npx mastra dev` — Start development server
- `npx mastra build` — Build for production
- `npx mastra deploy` — Deploy application
- `npx mastra init` — Initialize a new Mastra project structure

### Superpowers (from @mastra/core)
These capabilities are built into @mastra/core and available via subpath imports:
- **Agents** — `@mastra/core/agent` — LLM-powered agents with tool use
- **Tools** — `@mastra/core/tools` — Define custom tools for agents
- **Workflows** — `@mastra/core/workflows` — Multi-step orchestration
- **Voice/TTS** — `@mastra/core/tts` — Text-to-speech integration
- **MCP** — `@mastra/core/mcp` — Model Context Protocol client/server
- **Evals** — `@mastra/core/evals` — Quality evaluation metrics
- **Vector** — `@mastra/core/vector` — Vector store abstraction
- **Storage** — `@mastra/core/storage` — Persistent storage layer
- **Events** — `@mastra/core/events` — Event-driven architecture
- **Hooks** — `@mastra/core/hooks` — Lifecycle hooks
- **A2A** — `@mastra/core/a2a` — Agent-to-Agent communication protocol

### Documentation References
- Main docs: https://mastra.ai/docs
- **Skills (Build with AI)**: https://mastra.ai/docs/build-with-ai/skills
- Agents overview: https://mastra.ai/docs/agents/overview
- Agent tools: https://mastra.ai/docs/agents/using-tools
- Agent memory: https://mastra.ai/docs/agents/agent-memory
- Multi-agent systems: https://mastra.ai/docs/agents/multi-agent
- Tools overview: https://mastra.ai/docs/tools/overview
- MCP tools: https://mastra.ai/docs/tools/mcp-overview
- Dynamic tools: https://mastra.ai/docs/tools/dynamic-context
- Workflows overview: https://mastra.ai/docs/workflows/overview
- Workflow steps: https://mastra.ai/docs/workflows/steps
- Workflow control flow: https://mastra.ai/docs/workflows/control-flow
- RAG overview: https://mastra.ai/docs/rag/overview
- RAG chunking: https://mastra.ai/docs/rag/chunking
- RAG embeddings: https://mastra.ai/docs/rag/embeddings
- RAG retrieval: https://mastra.ai/docs/rag/retrieval
- Memory overview: https://mastra.ai/docs/memory/overview
- Memory threads: https://mastra.ai/docs/memory/threads
- Voice/TTS: https://mastra.ai/docs/voice/overview
- Evals overview: https://mastra.ai/docs/evals/overview
- Observability: https://mastra.ai/docs/observability/overview
- Integrations: https://mastra.ai/docs/integrations/overview
- Deployment: https://mastra.ai/docs/deployment/overview
- Local dev: https://mastra.ai/docs/local-dev/overview
- Examples: https://mastra.ai/docs/examples
- API Reference: https://mastra.ai/docs/reference
- GitHub: https://github.com/mastra-ai/mastra

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
