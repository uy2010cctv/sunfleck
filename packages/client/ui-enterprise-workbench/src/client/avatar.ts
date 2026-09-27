/** Deterministic published-profile avatar, shared by the workbench, room, and session header. */

/** Build the avatar image URL for one published profile seed. */
export function dicebearAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/10.x/lorelei/svg?seed=${encodeURIComponent(seed)}`
}
