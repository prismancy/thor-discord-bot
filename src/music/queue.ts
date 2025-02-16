import { createEmbed } from "$lib/embed";
import logger from "$lib/logger";
import { formatTime } from "$lib/time";
import db, { eq } from "$src/lib/database/drizzle";
import { queues } from "$src/lib/database/schema";
import { type SongType } from "./songs";
import type Voice from "./voice";
import { remove } from "@in5net/std/array";
import { shuffle } from "@in5net/std/random";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ButtonInteraction,
  type InteractionCollector,
  type TextChannel,
} from "discord.js";
import { TypedEmitter } from "tiny-typed-emitter";

const pageSize = 5;

const embed = createEmbed();
const backButton = new ButtonBuilder()
  .setCustomId("back")
  .setEmoji("⬅️")
  .setStyle(ButtonStyle.Primary);
const nextButton = new ButtonBuilder()
  .setCustomId("next")
  .setEmoji("➡️")
  .setStyle(ButtonStyle.Primary);
const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
  backButton,
  nextButton,
);

export default class Queue extends Array<SongType> {
  currentIndex = -1;
  loop = false;
  collector: InteractionCollector<ButtonInteraction<"cached">> | undefined;
  changeEmitter = new TypedEmitter<{
    change: () => any;
  }>();

  constructor(private readonly voice: Voice) {
    super();
  }

  get guildId() {
    return BigInt(this.voice.guildId);
  }

  get current() {
    return this[this.currentIndex];
  }

  private async write() {
    const { guildId } = this.voice;
    const voiceChannelId = this.voice.stream.channel?.id;
    if (!voiceChannelId) {
      return;
    }

    const where = eq(queues.guildId, guildId);
    const existingQueue = await db.query.queues.findFirst({
      columns: { guildId: true },
      where,
    });
    if (existingQueue) {
      await db
        .update(queues)
        .set({
          voiceChannelId,
          songs: this.map(x => x.toJSON()),
          index: this.currentIndex,
          seek: 0,
          loop: this.loop,
        })
        .where(where);
    } else {
      await db.insert(queues).values({
        guildId,
        voiceChannelId,
        songs: this.map(x => x.toJSON()),
        index: this.currentIndex,
        seek: 0,
        loop: this.loop,
      });
    }
  }

  set(songs: SongType[]) {
    super.push(...songs);
  }

  override push(...songs: SongType[]): number {
    const length = super.push(...songs);
    this.write().catch(console.error);
    return length;
  }

  dequeue(song?: SongType) {
    if (song) {
      remove(this, song);
    } else {
      this.shift();
    }
    this.changeEmitter.emit("change");
    this.write().catch(() => {});
  }

  clear() {
    this.length = 0;
    this.currentIndex = -1;
    this.changeEmitter.emit("change");
    this.write().catch(() => {});
  }

  reset() {
    this.clear();
    this.loop = false;
    this.changeEmitter.removeAllListeners();
    this.write().catch(() => {});
  }

  hasNext() {
    if (this.loop) {
      return !!this.length;
    }
    return this.currentIndex + 1 < this.length;
  }

  hasPrev() {
    if (this.loop) {
      return !!this.length;
    }
    return this.currentIndex - 1 >= 0;
  }

  next() {
    const { loop, length, changeEmitter } = this;
    this.currentIndex++;
    if (loop && this.currentIndex >= length) {
      this.currentIndex = 0;
    }
    changeEmitter.emit("change");
    this.write().catch(() => {});
    return this.current;
  }

  prev() {
    const { loop, length, changeEmitter } = this;
    this.currentIndex--;
    if (loop && this.currentIndex < 0) {
      this.currentIndex = length - 1;
    }
    changeEmitter.emit("change");
    this.write().catch(() => {});
    return this.current;
  }

  shuffle() {
    shuffle(this);
    this.currentIndex = 0;
    this.changeEmitter.emit("change");
    this.write().catch(() => {});
  }

  move(from: number, to: number) {
    if (from === to) {
      return;
    }
    const item = this.splice(from, 1)[0];
    if (item) {
      this.splice(to, 0, item);
    }
    this.changeEmitter.emit("change");
    this.write().catch(() => {});
  }

  remove(index: number) {
    const [song] = this.splice(index, 1);
    if (index < this.currentIndex) {
      this.currentIndex--;
    }
    this.changeEmitter.emit("change");
    this.write().catch(() => {});
    return song;
  }

  toggleLoop() {
    this.loop = !this.loop;
    this.write().catch(() => {});
  }

  async embed(channel: TextChannel, seconds?: number) {
    embed.setTitle(`Queue ${this.loop ? "🔁" : ""}`);

    let page = Math.floor(this.currentIndex / pageSize);

    const generateEmbed = () => {
      backButton.setDisabled(!page);
      nextButton.setDisabled(page * pageSize + pageSize >= this.length);
      embed.setFields().setFooter({
        text: `Page ${page + 1}/${Math.ceil(this.length / pageSize)}, total: ${
          this.length + (this.current ? 1 : 0)
        }`,
      });

      for (let i = page * pageSize; i < (page + 1) * pageSize; i++) {
        const song = this[i];
        if (!song) {
          break;
        }
        const { title, duration = Number.NaN } = song;
        if (i === this.currentIndex && seconds) {
          embed.addFields({
            name: `▶️ ${i + 1}. ${title}`,
            value: `${formatTime(seconds)}/${formatTime(duration)}`,
          });
        } else {
          embed.addFields({
            name: `${i + 1}. ${title}`,
            value: `${formatTime(duration)}`,
          });
        }
      }
    };

    generateEmbed();

    const message = await channel.send({ embeds: [embed], components: [row] });
    const send = async () => {
      generateEmbed();
      try {
        logger.info("Updating queue embed");
        await message.edit({ embeds: [embed], components: [row] });
      } catch (error) {
        logger.error(error);
        await channel.send("Failed to update queue embed, try `-queue` again");
        this.collector?.stop();
        this.collector = undefined;
        this.changeEmitter.removeAllListeners();
      }
    };

    this.changeEmitter.removeAllListeners();
    this.changeEmitter.on("change", send);

    this.collector?.stop();
    this.collector = message
      .createMessageComponentCollector({ componentType: ComponentType.Button })
      // eslint-disable-next-line ts/no-misused-promises
      .on("collect", async i => {
        const { customId } = i;
        if (customId === "back") {
          page--;
        } else if (customId === "next") {
          page++;
        }
        await send();
        await i.update({ files: [] }).catch();
      });
  }

  songEmbed(index: number) {
    const song = index ? this[index - 1] : this.current;
    if (!song) {
      return;
    }
    return song.getEmbed();
  }
}
