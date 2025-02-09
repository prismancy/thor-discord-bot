<script lang="ts">
  import Modal from "$lib/Modal.svelte";
  import Button from "$src/lib/Button.svelte";
  import Icon from "$src/lib/Icon.svelte";
  import Input from "$src/lib/Input.svelte";
  import Item from "$src/lib/list/Item.svelte";
  import List from "$src/lib/list/List.svelte";
  import Textarea from "$src/lib/Textarea.svelte";

  import { goto } from "$app/navigation";
  import { formatTime } from "$lib/time";
  import type { PlaylistItemJSON, YoutubePlaylistJSON } from "$src/music/songs";
  import { deepEquals } from "@in5net/std/object";
  import { sum } from "@in5net/std/stats";
  import { nanoid } from "nanoid";
  import { dndzone } from "svelte-dnd-action";
  import { flip } from "svelte/animate";

  interface Props {
    id?: string;
    name?: string;
    songs?: PlaylistItemJSON[];
  }

  let { id = "", name = $bindable(""), songs = [] }: Props = $props();

  let items = $state(songs.map(item => ({ id: nanoid(), item })));

  const oldName = name;
  const oldItems = [...items];
  const canSave = $derived(name !== oldName || !deepEquals(items, oldItems));

  const flipDurationMs = 300;
  function handleDndCards(e: CustomEvent<{ items: typeof items }>) {
    ({ items } = e.detail);
  }

  let showAdd = $state(false);
  let query = $state("");
  async function add() {
    const response = await fetch(
      `/api/playlist/song/query?q=${encodeURIComponent(query)}`,
    );
    const result = await response.json();

    const { items: songs } = result;
    items = [...items, ...songs.map(item => ({ id: nanoid(), item }))];

    query = "";
    showAdd = false;
  }

  let selectedPlaylist: YoutubePlaylistJSON | undefined = $state();

  async function save() {
    const songs = items.map(x => x.item);
    if (id) {
      await fetch(`/api/playlist/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          songs,
        }),
      });
    } else {
      await fetch("/api/playlist", {
        method: "POST",
        body: JSON.stringify({
          name,
          songs,
        }),
      });
    }
    goto("/playlists");
  }
</script>

<Input label="Playlist name" bind:value={name} />

<div class="flex mb">
  <Button disabled={!canSave} onclick={save}>
    <Icon type="upload" />
    Save
  </Button>
  <Button onclick={() => (showAdd = true)}>
    <Icon type="playlist-add" />
    Add
  </Button>
</div>

<List>
  <div
    onconsider={handleDndCards}
    onfinalize={handleDndCards}
    use:dndzone={{ items, flipDurationMs }}
  >
    {#each items as { id, item }, i (id)}
      <div animate:flip={{ duration: flipDurationMs }}>
        {#if item.type === "playlist"}
          <Item
            icon="playlist"
            label="{i + 1}. PLAYLIST: {formatTime(
              sum(item.songs.map(x => x.duration)),
            )} - {item.name}"
          >
            <Button onclick={() => (selectedPlaylist = item)}>
              <Icon type="modal" />
              View songs
            </Button>
            <Button
              onclick={() =>
                window.open(
                  `https://youtube.com/playlist?list=${item.id}`,
                  "_blank",
                )}
            >
              <Icon type="external-link" />
            </Button>
            <Button onclick={() => (items = items.filter(x => x.id !== id))}>
              <Icon type="x" />
            </Button>
          </Item>
        {:else}
          <Item
            icon="music"
            label="{i + 1}. {formatTime(item.duration)} - {item.title}"
          >
            {#if item.type === "youtube"}
              <Button
                onclick={() =>
                  window.open(`https://youtu.be/${item.id}`, "_blank")}
              >
                <Icon type="external-link" />
              </Button>
            {/if}
            <Button onclick={() => (items = items.filter(x => x.id !== id))}>
              <Icon type="x" />
            </Button>
          </Item>
        {/if}
      </div>
    {/each}
  </div>
</List>

{#if showAdd}
  <Modal
    btnLabel="Save"
    disabled={!query}
    onaction={add}
    onclose={() => (showAdd = false)}
  >
    <Textarea label="Query" bind:value={query} />
  </Modal>
{/if}

{#if selectedPlaylist}
  <Modal onclose={() => (selectedPlaylist = undefined)}>
    <List title={selectedPlaylist.name}>
      {#each selectedPlaylist.songs as item, i}
        <Item
          disabled
          icon="music"
          label="{i + 1}. {formatTime(item.duration)} - {item.title}"
        >
          {#if item.type === "youtube"}
            <Button
              onclick={() =>
                window.open(`https://youtu.be/${item.id}`, "_blank")}
            >
              <Icon type="external-link" />
            </Button>
          {/if}
        </Item>
      {/each}
    </List>
  </Modal>
{/if}

<style>
  .flex {
    display: flex;
    gap: 8px;
  }
  .mb {
    margin-bottom: 8px;
  }
</style>
