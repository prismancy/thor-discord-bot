import { env } from "node:process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pino, { type TransportTargetOptions } from "pino";

const dev = env.NODE_ENV === "development";

const logsPath = new URL("../../logs", import.meta.url).pathname;
if (!existsSync(logsPath)) mkdirSync(logsPath);

const destination = join(
	logsPath,
	`${new Date().toISOString().replaceAll(":", "-")}.log`
);
const targets: TransportTargetOptions[] = [
	{
		level: "debug",
		target: "pino/file",
		options: {
			destination,
		},
	},
	dev
		? {
				level: "debug",
				target: "pino-pretty",
				options: {
					colorize: true,
				},
		  }
		: {
				level: "trace",
				target: "cloud-pine",
				options: {
					cloudLoggingOptions: {
						skipInit: true,
						sync: true,
					},
				},
		  },
];

const logger = pino({
	transport: { targets },
});
export default logger;
