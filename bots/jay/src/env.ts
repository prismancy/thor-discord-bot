import { z } from 'zod';

declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof EnvironmentVariables> {}
  }
}

const EnvironmentVariables = z.object({
  DEV: z.string().optional(),
  NAME: z.string(),
  PREFIX: z.string(),
  COLOR: z.string(),

  DISCORD_ID: z.string(),
  DISCORD_TOKEN: z.string(),

  OWNER_ID: z.string(),
  GUILD_ID: z.string(),

  WEBHOOK_URL: z.string(),
});

const result = EnvironmentVariables.safeParse(process.env);
if (result.success) console.log('✅ Environment variables verified');
else {
  console.error('❌ Environment variables not verified:', result.error);
  process.exit(1);
}
