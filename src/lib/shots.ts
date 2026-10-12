import "server-only";
import { saveShots } from "./data";

// Screenshots the worker sends with a scan or a whole-site test: JPEG only,
// under an unguessable id, at most 200 per message.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveWorkerShots(scanId: string, list: unknown): Promise<number> {
  const shots = (Array.isArray(list) ? list : [])
    .filter((s): s is { id: string; data: string } => !!s && typeof s.id === "string" && UUID.test(s.id) && typeof s.data === "string" && s.data.length < 400_000)
    .slice(0, 200)
    .map((s) => ({ id: s.id.toLowerCase(), jpeg: Buffer.from(s.data, "base64") }))
    .filter((s) => s.jpeg[0] === 0xff && s.jpeg[1] === 0xd8); // JPEG only
  await saveShots(scanId, shots);
  return shots.length;
}
