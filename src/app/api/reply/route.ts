/**
 * Writes the simulated buyer or seller's chat replies with an LLM, so answers to
 * questions like "Any flaws on the slab?" fit the slab being discussed.
 *
 * Talks to an OpenAI-compatible chat completions endpoint configured in
 * .env.local (SOC_LLM_BASE_URL, SOC_LLM_API_KEY, SOC_LLM_MODEL). The key stays
 * on the server. Without config it returns 503 and the client uses a canned line.
 */

interface ReplyRequest {
  role: "seller" | "buyer";
  name: string;
  slab: {
    title: string;
    grader: string;
    grade: number;
    gradeLabel: string;
    certNumber: string;
    asking: number;
  };
  pendingOffer?: string;
  messages: { from: "them" | "me" | "system"; text: string }[];
}

const MAX_MESSAGES = 14;
const MAX_TEXT = 400;

export async function POST(request: Request) {
  const baseUrl = process.env.SOC_LLM_BASE_URL;
  const apiKey = process.env.SOC_LLM_API_KEY;
  const model = process.env.SOC_LLM_MODEL;
  if (!baseUrl || !apiKey || !model) {
    return Response.json({ error: "LLM not configured" }, { status: 503 });
  }

  let body: ReplyRequest;
  try {
    body = (await request.json()) as ReplyRequest;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!body?.slab || !Array.isArray(body.messages) || !["seller", "buyer"].includes(body.role)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const usd = (n: number) => `$${Number(n).toFixed(2)}`;
  const s = body.slab;
  const system = [
    `You are ${clip(body.name, 40)}, a ${body.role} chatting one-to-one on Pokechain, a marketplace for graded Pokémon card slabs, much like Carousell in Singapore.`,
    `The slab: ${clip(s.title, 200)}. ${s.grader} ${s.grade} (${clip(s.gradeLabel, 20)}), cert ${clip(s.certNumber, 20)}.`,
    `Seller asking price ${usd(s.asking)}. It sits in the Delaware vault, insured, and ownership moves as an on-chain token, so nothing is shipped during the deal.`,
    body.pendingOffer
      ? `An offer is already sent through the app and waiting: ${clip(body.pendingOffer, 160)}. Don't ask for it to be sent again; at most hint it could be edited.`
      : "There is no offer on the table right now; to make one the buyer uses the app's Make offer button.",
    body.role === "seller"
      ? "You own the slab. Answer the buyer's question honestly and specifically: invent small, believable condition details (centering, surface, edges, case scuffs) consistent with the grade. You may say whether the price is negotiable, but never accept, decline or name a final deal in text; the buyer must send an offer through the app."
      : "You are interested in buying the slab. Reply to the seller naturally. Never claim a deal is done; offers go through the app.",
    "Write like a real collector texting: one or two short sentences, casual, no emoji, no markdown, no greeting if the chat is already going.",
  ].join("\n");

  const messages = body.messages.slice(-MAX_MESSAGES).map((m) =>
    m.from === "system"
      ? { role: "system" as const, content: `(app notice) ${clip(m.text, MAX_TEXT)}` }
      : { role: m.from === "me" ? ("user" as const) : ("assistant" as const), content: clip(m.text, MAX_TEXT) },
  );

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...messages],
        max_tokens: 120,
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return Response.json({ error: `LLM returned ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return Response.json({ error: "Empty reply" }, { status: 502 });
    return Response.json({ text: clip(text.replace(/^["']|["']$/g, ""), 300) });
  } catch {
    return Response.json({ error: "LLM unreachable" }, { status: 502 });
  }
}

function clip(text: string, max: number): string {
  const t = String(text ?? "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
