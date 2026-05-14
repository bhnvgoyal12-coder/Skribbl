export const WORDS = [
  "apple", "banana", "guitar", "rocket", "pizza", "elephant", "castle", "bicycle",
  "rainbow", "volcano", "octopus", "pirate", "wizard", "dragon", "sandwich", "telescope",
  "umbrella", "snowman", "kangaroo", "lighthouse", "treasure", "skeleton", "submarine",
  "windmill", "penguin", "spider", "hamburger", "campfire", "tornado", "vampire",
  "robot", "balloon", "cactus", "dolphin", "earring", "fountain", "giraffe", "helmet",
  "iceberg", "jellyfish", "ketchup", "ladder", "mountain", "necklace", "octagon",
  "parachute", "quilt", "raccoon", "scarecrow", "tambourine", "ukulele", "vacuum",
  "waterfall", "xylophone", "yacht", "zebra", "anchor", "basket", "compass", "donut",
  "envelope", "flamingo", "glove", "hammock", "island", "jacket", "kite", "lantern",
  "mermaid", "ninja", "owl", "pancake", "queen", "rocket", "saxophone", "tractor"
];

export function pickWords(n = 3, pool = null) {
  const source = pool && pool.length >= n ? pool : WORDS;
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
