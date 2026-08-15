import { existsSync } from "node:fs";

import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer auto-loads .env files, so local development loads one
// explicitly (Node 24 ships `loadEnvFile`). `.env.local` wins when both exist,
// matching Next's own precedence.
//
// On Vercel neither file is present — the variables are already in the
// environment — so this must stay conditional. Loading unconditionally fails
// the build with `ENOENT: no such file or directory, open '.env.local'`.
const ENV_FILES = [".env.local", ".env"];

for (const file of ENV_FILES) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
