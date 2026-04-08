# Project Context

This is a javascript project using raw-http.

Middleware includes: custom, auth, cors.

High-impact files (most imported, changes here affect many other files):
- client/src/api/client.ts (imported by 14 files)
- server/db/index.js (imported by 13 files)
- server/middleware/auth.ts (imported by 11 files)
- client/src/components/ui/Toast.jsx (imported by 10 files)
- client/src/components/ui/Card.jsx (imported by 10 files)
- client/src/components/ui/Button.jsx (imported by 10 files)
- client/src/context/AuthContext.tsx (imported by 9 files)
- client/src/components/ui/Input.jsx (imported by 9 files)

Required environment variables (no defaults):
- CLIENT_ORIGIN (server/index.ts)

Read .codesight/wiki/index.md for orientation (WHERE things live). Then read actual source files before implementing. Wiki articles are navigation aids, not implementation guides.
Read .codesight/CODESIGHT.md for the complete AI context map including all routes, schema, components, libraries, config, middleware, and dependency graph.
