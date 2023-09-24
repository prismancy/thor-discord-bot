import { createEmbed } from "$services/embed";
import { and, eq, inArray, neon, not, sql } from "database/drizzle";
import { attachments, messages } from "database/drizzle/neon";
import {
	hyperlink,
	userMention,
	type BaseMessageOptions,
	type MessagePayload,
} from "discord.js";

export const types = ["image", "video", "audio"] as const;
export type Type = (typeof types)[number];
export const extensions: Record<Type, string[]> = {
	image: ["jpg", "jpeg", "png", "gif", "webp"],
	video: ["mp4", "mov", "mkv", "webm"],
	audio: ["mp3", "wav", "ogg"],
};

export async function getRandomFile(type?: Type) {
	const file = await neon.query.attachments.findFirst({
		where: and(
			inArray(attachments.ext, type ? extensions[type] : []),
			not(attachments.bot),
		),
		orderBy: sql`random()`,
	});
	return file;
}

export async function sendFile(
	replyable: {
		reply(options: MessagePayload | BaseMessageOptions): Promise<any>;
	},
	{ messageId, url, proxyUrl, ext }: (typeof attachments)["$inferSelect"],
) {
	if (!messageId) return;
	const message = await neon.query.messages.findFirst({
		columns: {
			createdAt: true,
			guildId: true,
			channelId: true,
			authorId: true,
		},
		where: eq(messages.id, messageId),
	});
	if (!message) return;
	const { createdAt, guildId, channelId, authorId } = message;

	const embed = createEmbed()
		.setFields(
			{
				name: "Sent by",
				value: userMention(authorId.toString()),
			},
			{
				name: "Where",
				value: hyperlink(
					"Original message",
					`https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
				),
				inline: true,
			},
		)
		.setTimestamp(createdAt);
	const extension = ext || "";
	if (extensions.image.includes(extension)) {
		embed.setImage(proxyUrl);
		return replyable.reply({
			embeds: [embed],
		});
	}

	return replyable.reply({
		embeds: [embed],
		files: [proxyUrl || url],
	});
}
