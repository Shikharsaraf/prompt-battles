import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { room_id, user_id } = req.body;
  if (!room_id || !user_id) {
    return res.status(400).json({ error: "Missing params" });
  }

  // Host check
  const { data: host } = await supabaseAdmin
    .from("room_players")
    .select("is_host")
    .eq("room_id", room_id)
    .eq("user_id", user_id)
    .single();

  if (!host?.is_host) {
    return res.status(403).json({ error: "Only host allowed" });
  }

  // Read room
  const { data: room } = await supabaseAdmin
    .from("rooms")
    .select("current_round, total_rounds")
    .eq("id", room_id)
    .single();

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const nextRound = room.current_round + 1;

  // Game finished
  if (nextRound > room.total_rounds) {
    await supabaseAdmin
      .channel(`room-phase-${room_id}`)
      .send({
        type: "broadcast",
        event: "game_finished",
        payload: {},
      });

    return res.status(200).json({ finished: true });
  }

  // Update room
  await supabaseAdmin
    .from("rooms")
    .update({ current_round: nextRound })
    .eq("id", room_id);

  // Pick image
  const { data: images } = await supabaseAdmin
    .from("images")
    .select("id, url");

  const image = images![Math.floor(Math.random() * images!.length)];

  // Create round
  const { data: round } = await supabaseAdmin
    .from("rounds")
    .insert({
      room_id,
      round_number: nextRound,
      image_id: image.id,
    })
    .select()
    .single();

  // 🔥 SINGLE SOURCE OF TRUTH
  await supabaseAdmin
    .channel(`room-phase-${room_id}`)
    .send({
      type: "broadcast",
      event: "phase_update",
      payload: {
        phase: "submission",
        time: 60,
        image_url: image.url,
        round_id: round.id,
        round_number: nextRound,
      },
    });

  return res.status(200).json({ success: true });
}
