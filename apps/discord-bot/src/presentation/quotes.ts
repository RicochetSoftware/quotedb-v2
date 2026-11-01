import { AttachmentBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js'

export interface DisplayQuote {
  quote: string
  author: string
  date: string
}
export function renderQuotes(
  quotes: DisplayQuote[],
  title: string,
  site: string,
  botName: string,
  page?: number,
) {
  const blocks = quotes.map(
    (q) =>
      `***“${escapeMarkdown(q.quote.slice(0, 520))}${q.quote.length > 520 ? '…' : ''}”***\n— ${escapeMarkdown(q.author.slice(0, 120))}\n${q.date}`,
  )
  const description = blocks.join('\n\n') || 'No quotes found.'
  const embed = new EmbedBuilder()
    .setColor(0xd8c3a5)
    .setTitle(title)
    .setDescription(description.slice(0, 4000))
    .setFooter({
      text: `${botName} • Quotes from ${new URL(site).host}${page ? ` • Page ${page}` : ''}`,
    })
    .setTimestamp(quotes.length === 1 ? new Date(`${quotes[0]?.date}T00:00:00Z`) : new Date())
  const needsFile =
    description.length > 4000 || quotes.some((q) => q.quote.length > 520 || q.author.length > 120)
  return {
    embeds: [embed],
    allowedMentions: { parse: [] as never[], repliedUser: false },
    files: needsFile
      ? [
          new AttachmentBuilder(
            Buffer.from(quotes.map((q) => `${q.quote}\n— ${q.author} (${q.date})`).join('\n\n')),
            { name: 'quotes.txt' },
          ),
        ]
      : [],
  }
}
