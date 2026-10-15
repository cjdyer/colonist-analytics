// Labels for the numeric enums in colonist.io game settings. Values were read
// from colonist's own client bundle; unknown values fall back to "#<n>".

export const QUEUES: Record<number, string> = {
  4: "Ranked 4P",
  3: "Ranked 1v1",
  7: "Ranked Rush",
  5: "Ranked C&K",
  2: "Unranked 4P",
  1: "Unranked 1v1",
  6: "Shuffle",
  0: "Custom / Bots",
};
/** Display order for queue pickers. */
export const QUEUE_ORDER = [4, 3, 7, 5, 2, 1, 6, 0];

export const LEADERBOARD_MODES: Record<string, string> = {
  Classic4P: "Classic 4P",
  Classic1v1: "Classic 1v1",
  CitiesAndKnights4P: "Cities & Knights",
  Rush4P: "Rush 4P",
};

export const GAME_TYPES: Record<number, string> = {
  0: "Unknown",
  1: "Tutorial",
  2: "Bot game",
  3: "Custom room",
  5: "Matchmaking",
  6: "Ranked matchmaking",
  7: "Beginner",
  8: "Tournament",
};

export const DICE: Record<number, string> = { 0: "Random", 1: "Balanced" };

const MAP_NAMES = [
  "Classic", "Tutorial", "Classic (random)", "Classic 5-6P", "Classic 7-8P",
  "New Shores 3P", "New Shores 4P", "New Shores 5-6P", "Tutorial New Shores",
  "Four Islands 3P", "Four Islands 4P", "Six Islands 5-6P", "Tutorial Four Islands",
  "Fog Islands 3P", "Fog Islands 4P", "Fog Islands 5-6P", "Tutorial Fog Islands",
  "Through the Desert 3P", "Through the Desert 4P", "Through the Desert 5-6P",
  "Tutorial Through the Desert", "King of the Hill", "Earth", "Earth (Seafarers)",
  "USA", "UK", "UK (Seafarers)", "Diamond", "Gear", "Lakes", "Pond", "Twirl",
  "Shuffle Board", "Black Forest", "Volcano", "Circle", "Kite", "Romania",
  "Mini Base", "Monopoly", "Mountain of Riches", "Doggo", "Duel", "Trade Islands",
  "Trade Islands (Seafarers)", "Vietnam", "Turning Tides (Seafarers)",
  "Turning Tides", "Two Isles", "Jellyfish", "Gold Rush", "Istanbul",
  "Istanbul (Seafarers)", "Europe", "Europe (Seafarers)", "Stripes",
  "Monopoly Islands", "Monopoly Islands (Seafarers)",
];
export const mapName = (n: number) => MAP_NAMES[n] ?? `Map #${n}`;

/** Player colors: label + swatch. The swatch is entity identity (it is the
 *  color the player had in-game), always shown next to a text label. */
export const PLAYER_COLORS: Record<number, { name: string; hex: string }> = {
  1: { name: "Red", hex: "#e2463f" },
  2: { name: "Blue", hex: "#3a7bd5" },
  3: { name: "Orange", hex: "#ef8a2b" },
  4: { name: "Green", hex: "#3aa356" },
  5: { name: "Black", hex: "#3b3b3b" },
  6: { name: "Bronze", hex: "#a8703b" },
  7: { name: "Silver", hex: "#b8bcc2" },
  8: { name: "Gold", hex: "#d9b437" },
  9: { name: "White", hex: "#f2f2f2" },
  10: { name: "Purple", hex: "#8a5cc7" },
  11: { name: "Mystic Blue", hex: "#3fb7c9" },
  12: { name: "Pink", hex: "#e77fb0" },
};

export const label = (map: Record<number, string>, n: number) => map[n] ?? `#${n}`;
