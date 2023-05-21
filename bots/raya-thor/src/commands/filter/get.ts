import command from '$services/commands/slash';
import { getVoice } from '../../music/voice-manager';

export default command(
  {
    desc: 'See the currently selected filters',
    options: {}
  },
  i => {
    const { guildId } = i;
    if (!guildId) return;
    const voice = getVoice(guildId);

    return i.reply(
      `Filters: ${[...voice.stream.filters.values()]
        .map(filter => `\`${filter}\``)
        .join(', ')}`
    );
  }
);
