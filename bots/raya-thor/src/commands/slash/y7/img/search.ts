import { env } from "node:process";
import command from "discord/commands/slash";
import db, { and, ne, icontains } from "database/drizzle";
import { y7Files } from "database/drizzle/schema";

export default command(
	{
		desc: "Search for an image from yyyyyyy.info",
		options: {
			file_name: {
				type: "string",
				desc: "The file name to search for",
				async autocomplete(search) {
					const results = await db.query.y7Files.findMany({
						columns: {
							name: true,
						},
						where: and(
							icontains(y7Files.name, search),
							ne(y7Files.extension, "gif"),
						),
						orderBy: y7Files.name,
						limit: 5,
					});
					return results.map(({ name }) => name);
				},
			},
		},
	},
	async (i, { file_name }) => {
		const url = `https://${env.FILES_DOMAIN}/y7/images/${file_name}`;
		return i.reply(url);
	},
);
