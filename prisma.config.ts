import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer auto-loads .env files. Node 24 ships loadEnvFile.
process.loadEnvFile(".env.local");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
