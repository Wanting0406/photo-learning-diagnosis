# Miaoda Full Stack

- Node.js 22+, React 19, TypeScript, Vite 8, NestJS 10.
- Frontend: client/src; backend: server/modules; contracts: shared/api.interface.ts.
- Aliases: @ maps to client/src; @shared maps to shared.
- Use existing shadcn/ui components and Tailwind utilities.
- Use platform login, roles, user context, and axiosForBackend.
- Business records and attachments live in Feishu Bitable. No business database tables.
- Secrets are server-only; .env.local is ignored. Disable request/response body logging.
- Never edit server/main.ts or client/src/index.tsx.
- See AGENTS.md and docs/fullstack-integration-guide.md for the active architecture and deployment limits.
