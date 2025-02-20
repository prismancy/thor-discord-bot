import { type MusescoreJSON, MusescoreSong } from "./musescore";
import { type SpotifyJSON, SpotifySong } from "./spotify";
import { type URLJSON, URLSong } from "./url";
import { type YouTubeJSON, YouTubeSong } from "./youtube";

export * from "./musescore";
export * from "./shared";
export * from "./spotify";
export * from "./url";
export * from "./youtube";

export type SongType = YouTubeSong | SpotifySong | MusescoreSong | URLSong;
export type PlaylistItem =
  | SongType
  | {
      type: "playlist";
      id: string;
      name: string;
      description?: string;
      songs: SongType[];
    }
  | {
      type: "group";
      id: string;
      name: string;
      songs: SongType[];
    };
export type SongJSONType = YouTubeJSON | SpotifyJSON | MusescoreJSON | URLJSON;
export interface YoutubePlaylistJSON {
  type: "playlist";
  id: string;
  name: string;
  description?: string;
  songs: SongJSONType[];
}
export interface SongGroupJSON {
  type: "group";
  name: string;
  songs: SongJSONType[];
}
export type PlaylistItemJSON =
  | SongJSONType
  | YoutubePlaylistJSON
  | SongGroupJSON;

export function fromJSON(json: SongJSONType): SongType {
  switch (json.type) {
    case "youtube": {
      return YouTubeSong.fromJSON(json);
    }

    case "spotify": {
      return SpotifySong.fromJSON(json);
    }

    case "musescore": {
      return MusescoreSong.fromJSON(json);
    }

    case "url": {
      return URLSong.fromJSON(json);
    }
  }
}
