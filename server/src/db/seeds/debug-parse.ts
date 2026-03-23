import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const labels = [
    '2002 POKEMON JAPANESE McDONALD\'S 014 SLOWPOKE-HOLO',
    '2023 POKEMON JAPANESE SV-P PROMO 098 DETECTIVE PIKACHU',
    '2018 Pokemon Japanese Sun & Moon Tag Bolt 108 Full Art/Brock\'s Grit',
    '2018 Pokemon Japanese Sm Promo 290 Rowlet Munch: A Retrospective',
    '2023 Pokemon Japanese Sv1a-Triplet Beat 080 Magikarp Art Rare',
    '1999 Pokemon Base Set 4 Charizard',
  ];

  const userContent = labels.map((l, i) => `${i + 1}. ${l}`).join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `You are a Pokemon TCG card expert. Parse grading label strings into JSON.
For each label return: language (EN/JP), setCode (TCGdex ID e.g. base1, sv1a, SV-P), cardNumber (digits only), cardName, rarity, variant, confidence.
Return a JSON array.`,
    messages: [{ role: 'user', content: `Parse these labels:\n\n${userContent}\n\nReturn JSON array.` }],
  });

  const text = response.content.find(b => b.type === 'text')?.text ?? '';
  const json = text.match(/\[[\s\S]*\]/)?.[0];
  console.log(JSON.stringify(JSON.parse(json!), null, 2));
}
main().catch(console.error);
