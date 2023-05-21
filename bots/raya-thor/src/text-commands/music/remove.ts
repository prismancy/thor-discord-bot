import woof from '$services/woof';
import musicCommand from './command';

export default musicCommand(
  {
    aliases: ['rm'],
    desc: 'Removes songs from the queue. You may use `last` to refer to the last song in the queue and `n-m` to specify a range.',
    args: {
      ns: {
        type: 'words',
        desc: 'The song number to remove'
      }
    },
    permissions: ['vc']
  },
  async ({ message, args: { ns }, voice }) => {
    const queue = await voice.getQueue();

    const indices: number[] = [];
    for (const str of ns) {
      if (str === 'last') indices.push(queue.length - 1);
      else if (str.includes('-')) {
        const [startStr = '1', endStr = '1'] = str.split('-');
        const start = parseInt(startStr);
        const end = parseInt(endStr);
        for (let n = start; n <= end; n++) {
          indices.push(n - 2);
        }
      } else {
        const n = parseInt(str);
        indices.push(n - 2);
      }
    }
    console.log('indices:', indices);

    for (const i of indices) {
      if (isNaN(i) || i < 0 || i >= queue.length)
        return message.reply(`${woof()}, please provide a valid numbers`);
    }

    const { length } = queue;
    indices.forEach(i => queue.remove(i));
    return voice.send(
      `✂️ Removed ${indices.join(', ')}, total of ${
        length - queue.length
      } songs`
    );
  }
);
