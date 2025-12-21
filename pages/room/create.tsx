"use client";

import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function CreateRoom() {
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [title, setTitle] = useState("");
	const [userId, setUserId] = useState<string | null>(null);
const [totalRounds, setTotalRounds] = useState<number>(3);

	useEffect(() => {
		supabase.auth.getSession().then(({ data }) => {
			if (!data.session) router.push("/auth");
			setUserId(data.session?.user?.id || null);
		});
	}, []);

	const createRoom = async () => {
		if (!userId) return;

		setLoading(true);

		const res = await fetch("/api/room/create", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      user_id: userId,
      total_rounds: totalRounds, // 👈 ADD THIS LINE
    }),
		});

		const json = await res.json(); //hello

		if (json.roomId) router.push(`/room/${json.roomId}`);

		setLoading(false);
	};

	return (
		<div className="flex flex-col gap-4 max-w-md mx-auto mt-20">
			<input
				className="border rounded p-2"
				placeholder="Enter room name..."
				value={title}
				onChange={(e) => setTitle(e.target.value)}
			/>

			<Button onClick={createRoom} disabled={loading}>
				{loading ? "Creating..." : "Create Room"}
			</Button>
			<label className="text-sm text-gray-400 mb-1">
  Number of Rounds
</label>

<input
  type="number"
  min={1}
  max={10}
  step={1}
  value={totalRounds}
  onChange={(e) => {
    const value = Number(e.target.value);

    // hard clamp (extra safety)
    if (Number.isNaN(value)) return;
    if (value < 1) return setTotalRounds(1);
    if (value > 10) return setTotalRounds(10);

    setTotalRounds(value);
  }}
  className="
    w-24
    bg-[#FFFFFF]
    border border-gray-700
    rounded-xl
    px-4 py-2
    text-center
    text-lg
    focus:outline-none
    focus:ring-2
    focus:ring-indigo-500
  "
/>

		</div>
		
	);
}
