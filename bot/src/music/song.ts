import youtube from "$lib/youtube";
import { parseTime } from "$src/lib/time";
import { getPlayDl } from "./play";
import {
	AudioResource,
	createAudioResource,
	StreamType,
} from "@discordjs/voice";
import { memo } from "@in5net/std/fn";
import chalk from "chalk-template";
import { EmbedBuilder, hideLinkEmbed, hyperlink } from "discord.js";
import got from "got";
import logger from "logger";
import { createRegExp, digit, oneOrMore } from "magic-regexp";
import { muse } from "musescore-metadata";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	type SoundCloudPlaylist,
	type SoundCloudTrack,
	type SpotifyAlbum,
	type SpotifyPlaylist,
	type SpotifyTrack,
} from "play-dl";
import prism from "prism-media";
import { z } from "zod";

interface SongJSON {
	title: string;
	duration: number; // Seconds
}

export interface Requester {
	uid: string;
	name: string;
}

interface StreamOptions {
	seek?: number;
	filters?: string[];
}

export interface Album<T extends Song> {
	name: string;
	songs: T[];
}

abstract class Song implements SongJSON {
	title: string;
	duration: number;
	requester: Requester;
	start = 0;

	abstract url: string;
	abstract iconURL: string;

	constructor({
		title,
		duration,
		requester,
	}: {
		title: string;
		duration: number;
		requester: Requester;
	}) {
		this.title = title;
		this.duration = duration;
		this.requester = requester;
	}

	getMarkdown() {
		return hyperlink(this.title, hideLinkEmbed(this.url));
	}

	getEmbed() {
		const { title, requester, iconURL } = this;
		return new EmbedBuilder().setTitle(title).setFooter({
			text: `Requested by ${requester.name}`,
			iconURL,
		});
	}

	abstract getResource(options: StreamOptions): Promise<AudioResource<Song>>;

	abstract log(): void;

	abstract toString(): string;

	abstract toJSON(): SongJSON;
}

function streamFileWithOptions(
	filePath: string,
	{ seek, filters }: StreamOptions = {},
) {
	const inputStream = createReadStream(filePath);

	const ffmpegArgs: string[] = [
		"-analyzeduration",
		"0",
		"-loglevel",
		"0",
		"-f",
		"s16le",
		"-ar",
		"48000",
		"-ac",
		"2",
	];
	if (seek) ffmpegArgs.push("-ss", seek.toString());
	if (filters?.length) ffmpegArgs.push("-af", filters.join(","));

	const transcoder = new prism.FFmpeg({
		args: ffmpegArgs,
	});

	const opusEncoder = new prism.opus.Encoder({
		rate: 48_000,
		channels: 2,
		frameSize: 960,
	});

	return inputStream.pipe(transcoder).pipe(opusEncoder);
}

const youtubeCachePath = new URL("../../../cache/youtube", import.meta.url)
	.pathname;

async function getYoutubeFile(id: string) {
	if (!existsSync(youtubeCachePath))
		mkdirSync(youtubeCachePath, { recursive: true });
	const filePath = join(youtubeCachePath, `${id}.opus`);

	if (!existsSync(filePath)) {
		const process = spawn(
			"yt-dlp",
			[
				"-x",
				"--audio-format",
				"opus",
				"-o",
				"%(id)s",
				`https://youtube.com/watch?v=${id}`,
			],
			{ cwd: youtubeCachePath },
		);
		await new Promise((resolve, reject) => {
			process.on("exit", resolve);
			process.on("error", reject);
		});
	}

	return filePath;
}

async function streamYoutubeFile(
	id: string,
	{ seek, filters }: StreamOptions = {},
) {
	const filePath = await getYoutubeFile(id);
	return streamFileWithOptions(filePath, { seek, filters });
}

interface Channel {
	id: string;
	title: string;
	thumbnail?: string;
}

interface YouTubeJSON extends SongJSON {
	type: "youtube";
	id: string;
	description?: string;
	time?: number;
	thumbnail?: string;
	channel?: Channel;
}

interface YouTubeAlbum extends Album<YouTubeSong> {
	description?: string;
}

const videosSchema = z.array(
	z.object({
		id: z.string(),
		title: z.coerce.string(),
		duration: z.object({
			seconds: z.number(),
		}),
		thumbnails: z.array(
			z.object({
				url: z.string(),
			}),
		),
	}),
);

export class YouTubeSong extends Song {
	id: string;
	description?: string;
	time?: number;
	thumbnail?: string;
	channel?: Channel;

	constructor({
		id,
		title,
		description,
		duration,
		time,
		thumbnail,
		channel,
		requester,
	}: {
		id: string;
		title: string;
		description?: string;
		duration: number;
		time?: number;
		thumbnail?: string;
		channel?: Channel;
		requester: Requester;
	}) {
		super({ title, duration, requester });
		this.id = id;
		this.description = description;
		this.time = time;
		this.thumbnail = thumbnail;
		this.channel = channel;
		this.start = time || 0;
	}

	get iconURL() {
		return "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/2560px-YouTube_full-color_icon_%282017%29.svg.png";
	}

	get url(): string {
		return `https://www.youtube.com/watch?v=${this.id}${
			this.time ? `&t=${this.time}` : ""
		}`;
	}

	get channelURL(): string {
		return `https://www.youtube.com/channel/${this.channel?.id}`;
	}

	log() {
		const { title, channel, url } = this;
		logger.debug(chalk`📺 {red [You{white Tube}]}
${title} (${url})
* channel: ${channel?.title}`);
	}

	toString(): string {
		return `📺 [YouTube] ${this.title} (${this.url})`;
	}

	toJSON(): YouTubeJSON {
		const { id, title, description, duration, time, thumbnail, channel } = this;
		return {
			type: "youtube",
			id,
			title,
			description,
			duration,
			time,
			thumbnail,
			channel,
		};
	}

	static fromJSON(
		{ id, title, description, duration, time, thumbnail, channel }: YouTubeJSON,
		requester: Requester,
	): YouTubeSong {
		return new YouTubeSong({
			id,
			title,
			description,
			duration,
			time,
			thumbnail,
			channel,
			requester,
		});
	}

	override getEmbed() {
		const { description, thumbnail, channel, url, channelURL } = this;
		const embed = super.getEmbed().setColor("Red").setURL(url);
		if (thumbnail) embed.setThumbnail(thumbnail);
		if (channel)
			embed.setAuthor({
				name: channel.title,
				url: channelURL || undefined,
				iconURL: channel.thumbnail || undefined,
			});
		const MAX_DESCRIPTION_LENGTH = 256;
		if (description)
			embed.setDescription(
				description.length > MAX_DESCRIPTION_LENGTH ?
					`${description.slice(0, MAX_DESCRIPTION_LENGTH)}...`
				:	description,
			);
		return embed;
	}

	static async fromId(id: string, requester: Requester): Promise<YouTubeSong> {
		try {
			const {
				basic_info: {
					title = "Unknown",
					short_description: description,
					thumbnail = [],
					duration = 0,
					channel,
				},
			} = await youtube.getBasicInfo(id);
			return new YouTubeSong({
				id,
				title,
				description,
				duration,
				thumbnail: thumbnail[0]?.url,
				channel:
					channel ?
						{
							id: channel.id,
							title: channel.name,
						}
					:	undefined,
				requester,
			});
		} catch (error) {
			logger.error(error);
			return new YouTubeSong({ id, title: "", duration: 0, requester });
		}
	}

	static async fromURL(
		url: string,
		requester: Requester,
	): Promise<YouTubeSong> {
		const play = await getPlayDl();
		const id = play.extractID(url);
		const song = await this.fromId(id, requester);
		const timeRegex = createRegExp("?t=", oneOrMore(digit).as("seconds"));
		const matches = url.match(timeRegex);
		if (matches?.groups.seconds)
			song.time = Number.parseInt(matches.groups.seconds);
		return song;
	}

	static async fromSearch(
		query: string,
		requester: Requester,
	): Promise<YouTubeSong> {
		const { videos } = await youtube.search(query, { type: "video" });
		const { id, title, description, duration, best_thumbnail } = z
			.object({
				id: z.string(),
				title: z.coerce.string(),
				description: z.string(),
				duration: z.object({
					seconds: z.number(),
				}),
				best_thumbnail: z.object({
					url: z.string(),
				}),
			})
			.parse(videos.first());
		return new YouTubeSong({
			id,
			title,
			description,
			duration: duration.seconds,
			thumbnail: best_thumbnail.url,
			requester,
		});
	}

	static async fromPlaylistId(
		id: string,
		requester: Requester,
	): Promise<YouTubeAlbum> {
		const {
			info: { title = "", description },
			videos,
		} = await youtube.getPlaylist(id);
		const songs: YouTubeSong[] = [];
		for (const {
			id,
			title,
			duration: { seconds },
			thumbnails: [thumbnail],
		} of videosSchema.parse(videos)) {
			songs.push(
				new YouTubeSong({
					id,
					title: title.toString(),
					duration: seconds,
					thumbnail: thumbnail?.url,
					requester,
				}),
			);
		}

		return {
			name: title,
			description,
			songs,
		};
	}

	static async fromChannelId(
		id: string,
		requester: Requester,
	): Promise<YouTubeSong[]> {
		const channel = await youtube.getChannel(id);
		const { videos } = await channel.getVideos();
		const songs: YouTubeSong[] = [];
		for (const {
			id,
			title,
			duration: { seconds },
			thumbnails: [thumbnail],
		} of videosSchema.parse(videos)) {
			songs.push(
				new YouTubeSong({
					id,
					title: title.toString(),
					duration: seconds,
					thumbnail: thumbnail?.url,
					channel: {
						id,
						title: channel.title || "",
						thumbnail: channel.metadata.thumbnail?.[0]?.url || "",
					},
					requester,
				}),
			);
		}

		return songs;
	}

	async getResource({ seek, filters }: StreamOptions) {
		const stream = await streamYoutubeFile(this.id, {
			seek,
			filters,
		});
		const resource = createAudioResource(stream, {
			inputType: StreamType.Opus,
			metadata: this,
		});
		return resource;
	}
}

const SPOTIFY_SONG =
	/^(https:\/\/)?(open\.spotify\.com\/track\/)([\w-]{22}).*$/;
interface SpotifyJSON extends SongJSON {
	type: "spotify";
	id: string;
	ytId: string;
	thumbnail?: string;
	artist?: {
		name: string;
		id: string;
	};
	album?: {
		name: string;
		id: string;
	};
}

export class SpotifySong extends Song {
	id: string;
	ytId: string;
	artist?: {
		id: string;
		name: string;
	};

	thumbnail?: string;
	album?: {
		id: string;
		name: string;
	};

	constructor({
		id,
		title,
		ytId,
		duration,
		thumbnail,
		artist,
		album,
		requester,
	}: {
		id: string;
		title: string;
		ytId: string;
		duration: number;
		thumbnail?: string;
		artist?: {
			id: string;
			name: string;
		};
		album?: {
			id: string;
			name: string;
		};
		requester: Requester;
	}) {
		super({ title, duration, requester });
		this.id = id;
		this.ytId = ytId;
		this.thumbnail = thumbnail;
		this.artist = artist;
		this.album = album;
	}

	get iconURL() {
		return "https://cdn-icons-png.flaticon.com/512/2111/2111624.png";
	}

	static id2URL(id: string): string {
		return `https://open.spotify.com/track/${id}`;
	}

	static url2Id(url: string): string {
		return SPOTIFY_SONG.exec(url)?.[3] || "";
	}

	get url(): string {
		return SpotifySong.id2URL(this.id);
	}

	get artistURL(): string {
		return `https://open.spotify.com/artist/${this.artist?.id}`;
	}

	get albumURL(): string {
		const { album } = this;
		return album ? `https://open.spotify.com/album/${album.id}` : "";
	}

	get youtubeURL(): string {
		return `https://www.youtube.com/watch?v=${this.ytId}`;
	}

	log() {
		const { title, artist, album, url, artistURL, albumURL, youtubeURL } = this;
		logger.debug(chalk`🟢 {green [Spotify]}
${title} (${url})
* {red you{white tube}} url: ${youtubeURL}
* artist: ${artist?.name} (${artistURL})${
			album ?
				`
* album: ${album.name} (${albumURL})`
			:	""
		}`);
	}

	toString(): string {
		return `🟢 [Spotify] ${this.title} (${this.url})`;
	}

	toJSON(): SpotifyJSON {
		const { id, ytId, title, duration, thumbnail, artist, album } = this;
		return {
			type: "spotify",
			id,
			ytId,
			title,
			duration,
			thumbnail,
			artist,
			album,
		};
	}

	static fromJSON(
		{ id, ytId, title, duration, thumbnail, artist, album }: SpotifyJSON,
		requester: Requester,
	): SpotifySong {
		return new SpotifySong({
			id,
			ytId,
			title,
			duration,
			thumbnail,
			artist,
			album,
			requester,
		});
	}

	override getEmbed() {
		const { thumbnail, artist, album, url, artistURL, albumURL } = this;
		const embed = super.getEmbed().setColor("Green").setURL(url);
		if (artist)
			embed.setAuthor({
				name: artist.name,
				url: artistURL,
			});
		if (thumbnail) embed.setThumbnail(thumbnail);
		if (album)
			embed.addFields({ name: "Album", value: `[${album.name}](${albumURL})` });
		return embed;
	}

	static async fromURL(
		url: string,
		requester: Requester,
	): Promise<SpotifySong> {
		const play = await getPlayDl();
		if (play.sp_validate(url) !== "track") throw new Error("Invalid URL");

		const {
			name,
			durationInSec: duration,
			thumbnail,
			artists: [artist],
			album,
		} = (await play.spotify(url)) as SpotifyTrack;
		let ytId = "";

		const { videos } = await youtube.search(`${name} ${artist?.name || ""}`, {
			type: "video",
		});
		const { id } = z.object({ id: z.string() }).parse(videos.first());
		ytId = id;

		return new SpotifySong({
			id: SpotifySong.url2Id(url),
			ytId,
			title: name,
			duration,
			thumbnail: thumbnail?.url,
			artist,
			album,
			requester,
		});
	}

	static async fromId(id: string, requester: Requester): Promise<SpotifySong> {
		const url = SpotifySong.id2URL(id);
		return this.fromURL(url, requester);
	}

	static async fromListURL(
		url: string,
		requester: Requester,
	): Promise<SpotifySong[]> {
		const play = await getPlayDl();
		const type = play.sp_validate(url);
		if (type !== "album" && type !== "playlist") return [];

		const spotify = (await play.spotify(url)) as SpotifyAlbum | SpotifyPlaylist;
		const tracks = await spotify.all_tracks();
		return Promise.all(
			tracks.map(async track => SpotifySong.fromId(track.id, requester)),
		);
	}

	async getResource({ seek, filters }: StreamOptions) {
		const stream = await streamYoutubeFile(this.ytId, {
			seek,
			filters,
		});
		const resource = createAudioResource(stream, {
			inputType: StreamType.Opus,
			metadata: this,
		});
		return resource;
	}
}

const playSC = memo(async () => {
	const play = await getPlayDl();
	const clientId = await play.getFreeClientID();
	await play.setToken({
		soundcloud: {
			client_id: clientId,
		},
	});
	return play;
});

interface SoundCloudJSON extends SongJSON {
	type: "soundcloud";
	url: string;
	thumbnail: string;
	user: {
		id: string;
		name: string;
		url: string;
	};
}
export class SoundCloudSong extends Song {
	url: string;
	thumbnail: string;
	user: {
		id: string;
		name: string;
		url: string;
	};

	constructor({
		url,
		title,
		duration,
		thumbnail,
		user,
		requester,
	}: {
		url: string;
		title: string;
		duration: number;
		thumbnail: string;
		user: {
			id: string;
			name: string;
			url: string;
		};
		requester: Requester;
	}) {
		super({ title, duration, requester });
		this.url = url;
		this.thumbnail = thumbnail;
		this.user = user;
	}

	get iconURL() {
		return "https://mpng.subpng.com/20190609/ibv/kisspng-logo-font-brand-clip-art-trademark-francesco-tristano-contact-5cfda0624d6629.175959541560125538317.jpg";
	}

	log() {
		const { title, url, user } = this;
		logger.debug(chalk`☁️ {orange [SoundCloud]}
${title} (${url})
* user: ${user.name} (${user.url})`);
	}

	toString(): string {
		return `☁️ [SoundCloud] ${this.title} (${this.url})`;
	}

	toJSON(): SoundCloudJSON {
		const { url, user, thumbnail, title, duration } = this;
		return { type: "soundcloud", url, user, thumbnail, title, duration };
	}

	static fromJSON(
		{ url, title, duration, thumbnail, user }: SoundCloudJSON,
		requester: Requester,
	): SoundCloudSong {
		return new SoundCloudSong({
			url,
			title,
			duration,
			thumbnail,
			user,
			requester,
		});
	}

	override getEmbed() {
		const { user, thumbnail, url } = this;
		const embed = super
			.getEmbed()
			.setColor("Orange")
			.setURL(url)
			.setAuthor({
				name: user.name,
				url: user.url,
			})
			.setThumbnail(thumbnail);
		return embed;
	}

	static fromTrack(
		track: SoundCloudTrack,
		requester: Requester,
	): SoundCloudSong {
		const { url, name, durationInSec: duration, thumbnail, user } = track;
		return new SoundCloudSong({
			url,
			title: name,
			duration,
			thumbnail,
			user,
			requester,
		});
	}

	static async fromURL(
		url: string,
		requester: Requester,
	): Promise<SoundCloudSong> {
		const play = await playSC();
		if ((await play.so_validate(url)) !== "track")
			throw new Error("Invalid URL");

		const track = (await play.soundcloud(url)) as SoundCloudTrack;
		return this.fromTrack(track, requester);
	}

	static async fromId(
		id: string,
		requester: Requester,
	): Promise<SoundCloudSong> {
		const url = SpotifySong.id2URL(id);
		return this.fromURL(url, requester);
	}

	static async fromListURL(
		url: string,
		requester: Requester,
	): Promise<SoundCloudSong[]> {
		const play = await playSC();
		if ((await play.so_validate(url)) !== "playlist")
			throw new Error("Invalid URL");

		const playlist = (await play.soundcloud(url)) as SoundCloudPlaylist;
		const tracks = await playlist.all_tracks();
		return Promise.all(
			tracks.map(track => SoundCloudSong.fromTrack(track, requester)),
		);
	}

	async getResource({ seek, filters }: { seek?: number; filters?: string[] }) {
		const play = await playSC();
		const { stream } = await play.stream(this.url);
		const { default: ytdl } = await import("discord-ytdl-core");

		const ytdlStream = ytdl.arbitraryStream(stream, {
			opusEncoded: true,
			seek,
			encoderArgs: filters?.length ? ["-af", filters.join(",")] : undefined,
		});
		const resource = createAudioResource(ytdlStream, {
			metadata: this,
		});
		return resource;
	}
}

const musescoreCachePath = new URL("../../../cache/musescore", import.meta.url)
	.pathname;
async function getMusescoreFile(id: string, url: string) {
	if (!existsSync(musescoreCachePath))
		mkdirSync(musescoreCachePath, { recursive: true });
	const filePath = join(musescoreCachePath, `${id}.mp3`);

	if (!existsSync(filePath)) {
		const process = spawn("bunx", ["dl-librescore", "-i", url, "-t", "mp3"], {
			cwd: musescoreCachePath,
		});
		await new Promise((resolve, reject) => {
			process.on("exit", resolve);
			process.on("error", reject);
		});

		const fileNames = await readdir(musescoreCachePath);
		let mostRecentFileName = "";
		let mostRecentFileTime = 0;
		for (const fileName of fileNames) {
			const stats = await stat(join(musescoreCachePath, fileName));
			if (stats.ctimeMs > mostRecentFileTime) {
				mostRecentFileName = fileName;
				mostRecentFileTime = stats.ctimeMs;
			}
		}
		await rename(join(musescoreCachePath, mostRecentFileName), filePath);
	}

	return filePath;
}

async function streamMusescoreFile(
	id: string,
	url: string,
	{ seek, filters }: StreamOptions = {},
) {
	const filePath = await getMusescoreFile(id, url);
	return streamFileWithOptions(filePath, { seek, filters });
}

interface MusescoreJSON extends SongJSON {
	type: "musescore";
	id: string;
	url: string;
	description: string;
}
export class MusescoreSong extends Song {
	id: string;
	url: string;
	description: string;

	constructor({
		id,
		url,
		title,
		description,
		duration,
		requester,
	}: {
		id: string;
		url: string;
		title: string;
		description: string;
		duration: number;
		requester: Requester;
	}) {
		super({ title, duration, requester });
		this.id = id;
		this.url = url;
		this.description = description;
	}

	get iconURL() {
		return "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/2560px-YouTube_full-color_icon_%282017%29.svg.png";
	}

	log() {
		const { title, url } = this;
		logger.debug(chalk`📺 {blue [Musescore]}
${title} (${url})`);
	}

	toString(): string {
		return `🎼 [Musescore] ${this.title} (${this.url})`;
	}

	toJSON(): MusescoreJSON {
		const { id, url, title, description, duration } = this;
		return {
			type: "musescore",
			id,
			url,
			title,
			description,
			duration,
		};
	}

	static fromJSON(
		{ id, url, title, description, duration }: MusescoreJSON,
		requester: Requester,
	): MusescoreSong {
		return new MusescoreSong({
			id,
			url,
			title,
			description,
			duration,
			requester,
		});
	}

	override getEmbed() {
		const { url, description } = this;
		const embed = super.getEmbed().setColor("Blue").setURL(url);
		const MAX_DESCRIPTION_LENGTH = 256;
		if (description)
			embed.setDescription(
				description.length > MAX_DESCRIPTION_LENGTH ?
					`${description.slice(0, MAX_DESCRIPTION_LENGTH)}...`
				:	description,
			);
		return embed;
	}

	static async fromURL(
		url: string,
		requester: Requester,
	): Promise<MusescoreSong> {
		const metadata = await muse(url);
		return new MusescoreSong({
			id: metadata.id.toString(),
			url: metadata.url,
			title: metadata.title,
			description: metadata.description,
			duration: parseTime(metadata.duration),
			requester,
		});
	}

	async getResource({ seek, filters }: StreamOptions) {
		const stream = await streamMusescoreFile(this.id, this.url, {
			seek,
			filters,
		});
		const resource = createAudioResource(stream, {
			inputType: StreamType.Opus,
			metadata: this,
		});
		return resource;
	}
}

interface URLJSON extends SongJSON {
	type: "url";
	url: string;
}
export class URLSong extends Song {
	constructor(
		public url: string,
		requester: Requester,
	) {
		super({ title: url.split("/").pop() || url, duration: 0, requester });
	}

	get iconURL() {
		return "https://static.thenounproject.com/png/2391758-200.png";
	}

	log() {
		const { title, url } = this;
		logger.debug(chalk`🔗 {blue [URL]}
${title} (${url})`);
	}

	toString(): string {
		return `🔗 [URL] ${this.title} (${this.url})`;
	}

	toJSON(): URLJSON {
		const { url, title, duration } = this;
		return { type: "url", url, title, duration };
	}

	static fromJSON({ url }: URLJSON, requester: Requester): URLSong {
		return new URLSong(url, requester);
	}

	override getEmbed() {
		return super.getEmbed().setColor("Blue").setURL(this.url);
	}

	static fromURL(url: string, requester: Requester): URLSong {
		return new URLSong(url, requester);
	}

	async getResource({ seek, filters }: { seek?: number; filters?: string[] }) {
		const stream = got.stream(this.url);
		const { default: ytdl } = await import("discord-ytdl-core");

		const ytdlStream = ytdl.arbitraryStream(stream, {
			opusEncoded: true,
			seek,
			encoderArgs: filters?.length ? ["-af", filters.join(",")] : undefined,
		});
		const resource = createAudioResource(ytdlStream, {
			metadata: this,
		});
		return resource;
	}
}

export type SongType =
	| YouTubeSong
	| SpotifySong
	| SoundCloudSong
	| MusescoreSong
	| URLSong;
export type SongJSONType =
	| YouTubeJSON
	| SpotifyJSON
	| SoundCloudJSON
	| MusescoreJSON
	| URLJSON;

export function fromJSON(json: SongJSONType, requester: Requester): SongType {
	switch (json.type) {
		case "youtube": {
			return YouTubeSong.fromJSON(json, requester);
		}

		case "spotify": {
			return SpotifySong.fromJSON(json, requester);
		}

		case "soundcloud": {
			return SoundCloudSong.fromJSON(json, requester);
		}

		case "musescore": {
			return MusescoreSong.fromJSON(json, requester);
		}

		case "url": {
			return URLSong.fromJSON(json, requester);
		}
	}
}
