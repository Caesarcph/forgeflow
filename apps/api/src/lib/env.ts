import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "../../../..");

dotenv.config({ path: path.join(workspaceRoot, ".env") });
dotenv.config({ path: path.join(workspaceRoot, ".env.local"), override: true });

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  OPENCODE_BASE_URL: z.string().optional(),
  OPENCODE_API_KEY: z.string().optional(),
  OPENCODE_CLI_PATH: z.string().optional(),
  OPENCODE_CLI_TIMEOUT_MS: z.coerce.number().default(3600000),
  OPENCODE_INTAKE_TIMEOUT_MS: z.coerce.number().default(3600000),
  OPENCODE_HEALTHCHECK_TIMEOUT_MS: z.coerce.number().default(30000),
  DRY_RUN: z.coerce.boolean().default(false),
});

export const env = envSchema.parse(process.env);
