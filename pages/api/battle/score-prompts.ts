import { GoogleGenAI } from "@google/genai";
import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { room_id, round_id, image_url } = req.body;

  if (!room_id || !round_id || !image_url) {
    return res.status(400).json({
      error: "Missing room_id, round_id or image_url",
    });
  }

  console.log("🔥 SCORE PROMPTS HIT", { room_id, round_id });

  /* ---------------- FETCH PROMPTS ---------------- */

  const { data: prompts, error: promptErr } = await supabaseAdmin
    .from("prompts")
    .select("id, prompt_text, user_id")
    .eq("round_id", round_id);

  if (promptErr) {
    return res.status(500).json({ error: promptErr.message });
  }

  if (!prompts || prompts.length === 0) {
    return res.status(400).json({ error: "No prompts found" });
  }

  const promptList = prompts
    .map(
      (p, i) =>
        `Prompt ${i + 1}:\nID: ${p.id}\nUser: ${p.user_id}\nText: "${p.prompt_text}"`,
    )
    .join("\n\n");

  /* ---------------- GEMINI PROMPT ---------------- */

  const instructions = `
Task: Given an image and multiple prompts, score each prompt 0–100 based on how well it matches the image.

Rules:
- Judge how likely the prompt would recreate a similar image in a text-to-image model
- Higher score = closer match
- Include constructive feedback with specific image details

Return ONLY valid JSON:
[
  {
    "user_id": "...",
    "prompt_id": "...",
    "score": 0-100,
    "reason": "short explanation"
  }
]
`;

  const contents = [
    {
      role: "user",
      parts: [
        { text: instructions },
        { fileData: { mimeType: "image/jpeg", fileUri: image_url } },
        { text: "Prompts:\n" + promptList },
      ],
    },
  ];

  /* ---------------- CALL GEMINI ---------------- */

  let geminiResult;

  try {
    geminiResult = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "Gemini API call failed: " + err.message,
    });
  }

  let text =
    geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";

  text = text.replace(/```json/g, "").replace(/```/g, "").trim();

  let evaluations: {
    user_id: string;
    prompt_id: string;
    score: number;
    reason: string;
  }[];

  try {
    evaluations = JSON.parse(text);
  } catch {
    return res.status(500).json({
      error: "Gemini did not return valid JSON",
      raw: text,
    });
  }

  /* ---------------- SAVE RESULTS ---------------- */

  for (const ev of evaluations) {
    // 1️⃣ Save per-round prompt score
    await supabaseAdmin
      .from("prompts")
      .update({
        scores: ev.score,
        justification: ev.reason,
      })
      .eq("id", ev.prompt_id);

    // 2️⃣ Ensure player exists (FK safety)
    await supabaseAdmin
      .from("room_players")
      .upsert(
        {
          room_id,
          user_id: ev.user_id,
          is_ready: false,
          is_host: false,
        },
        { onConflict: "room_id,user_id" },
      );

    // 3️⃣ Increment cumulative score
    const { error } = await supabaseAdmin.rpc(
      "increment_player_score",
      {
        p_room_id: room_id,
        p_user_id: ev.user_id,
        p_score: ev.score,
      },
    );

    if (error) {
      console.error("❌ increment_player_score failed", error);
    }
  }

  /* ---------------- BROADCAST RESULTS ---------------- */

// 1️⃣ Results ready (clients render leaderboard)
await supabaseAdmin
  .channel(`room-phase-${room_id}`)
  .send({
    type: "broadcast",
    event: "results_ready",
    payload: { round_id },
  });

// 2️⃣ Start intermission AFTER results (15s)
setTimeout(async () => {
  await supabaseAdmin
    .channel(`room-phase-${room_id}`)
    .send({
      type: "broadcast",
      event: "intermission",
      payload: {
        seconds: 15,
        round_id,
      },
    });
}, 500); // small delay so results UI mounts

// 3️⃣ API response
return res.status(200).json({
  success: true,
  evaluations,
});

}
