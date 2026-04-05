export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];

export const RARITY_WEIGHTS = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
};

export const SPECIES = [
  "duck",
  "goose",
  "blob",
  "cat",
  "dragon",
  "octopus",
  "owl",
  "penguin",
  "turtle",
  "snail",
  "ghost",
  "axolotl",
  "capybara",
  "cactus",
  "robot",
  "rabbit",
  "mushroom",
  "chonk",
];

export const SPECIES_EMOJI = {
  duck: "🦆",
  goose: "🪿",
  blob: "🫧",
  cat: "🐱",
  dragon: "🐉",
  octopus: "🐙",
  owl: "🦉",
  penguin: "🐧",
  turtle: "🐢",
  snail: "🐌",
  ghost: "👻",
  axolotl: "🦎",
  capybara: "🦫",
  cactus: "🌵",
  robot: "🤖",
  rabbit: "🐰",
  mushroom: "🍄",
  chonk: "😸",
};

export const EYES = ["·", "✦", "×", "◉", "@", "°"];

export const HATS = ["none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"];

export const STAT_NAMES = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];

export const RARITY_FLOOR = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
};

export const SALT = "friend-2026-401";

const UINT64_MASK = (1n << 64n) - 1n;
const WYHASH_SECRET = [
  0xa0761d6478bd642fn,
  0xe7037ed1a0b428dbn,
  0x8ebc6af09c88c6e3n,
  0x589965cc75374cc3n,
];

const textEncoder = new TextEncoder();

export const BUN_HASH_SELF_TESTS = [
  { input: "some data here", seed: 0n, expected: 11562320457524636935n },
  { input: "some data here", seed: 1234n, expected: 15724820720172937558n },
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toUint64(value) {
  return value & UINT64_MASK;
}

function readLittleEndian(bytes, offset, size) {
  let result = 0n;
  for (let index = 0; index < size; index += 1) {
    result |= BigInt(bytes[offset + index]) << BigInt(index * 8);
  }
  return result;
}

function multiply64(a, b) {
  const product = toUint64(a) * toUint64(b);
  return [product & UINT64_MASK, (product >> 64n) & UINT64_MASK];
}

function mix64(a, b) {
  const [low, high] = multiply64(a, b);
  return toUint64(low ^ high);
}

function smallKey(bytes) {
  const { length } = bytes;

  if (length >= 4) {
    const end = length - 4;
    const quarter = (length >> 3) << 2;
    return {
      a: toUint64((readLittleEndian(bytes, 0, 4) << 32n) | readLittleEndian(bytes, quarter, 4)),
      b: toUint64((readLittleEndian(bytes, end, 4) << 32n) | readLittleEndian(bytes, end - quarter, 4)),
    };
  }

  if (length > 0) {
    return {
      a: (BigInt(bytes[0]) << 16n) | (BigInt(bytes[length >> 1]) << 8n) | BigInt(bytes[length - 1]),
      b: 0n,
    };
  }

  return { a: 0n, b: 0n };
}

export function wyhash64(input, seed = 0n) {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  let state0 = toUint64(seed ^ mix64(seed ^ WYHASH_SECRET[0], WYHASH_SECRET[1]));
  let state1 = state0;
  let state2 = state0;
  let a = 0n;
  let b = 0n;

  if (bytes.length <= 16) {
    ({ a, b } = smallKey(bytes));
  } else {
    let offset = 0;

    if (bytes.length >= 48) {
      while (offset + 48 < bytes.length) {
        state0 = mix64(readLittleEndian(bytes, offset, 8) ^ WYHASH_SECRET[1], readLittleEndian(bytes, offset + 8, 8) ^ state0);
        state1 = mix64(
          readLittleEndian(bytes, offset + 16, 8) ^ WYHASH_SECRET[2],
          readLittleEndian(bytes, offset + 24, 8) ^ state1,
        );
        state2 = mix64(
          readLittleEndian(bytes, offset + 32, 8) ^ WYHASH_SECRET[3],
          readLittleEndian(bytes, offset + 40, 8) ^ state2,
        );
        offset += 48;
      }
      state0 = toUint64(state0 ^ state1 ^ state2);
    }

    while (offset + 16 < bytes.length) {
      state0 = mix64(readLittleEndian(bytes, offset, 8) ^ WYHASH_SECRET[1], readLittleEndian(bytes, offset + 8, 8) ^ state0);
      offset += 16;
    }

    a = readLittleEndian(bytes, bytes.length - 16, 8);
    b = readLittleEndian(bytes, bytes.length - 8, 8);
  }

  a = toUint64(a ^ WYHASH_SECRET[1]);
  b = toUint64(b ^ state0);

  const [low, high] = multiply64(a, b);
  return mix64(toUint64(low ^ WYHASH_SECRET[0] ^ BigInt(bytes.length)), toUint64(high ^ WYHASH_SECRET[1]));
}

export function hashStringBun(value) {
  return Number(wyhash64(value) & 0xffffffffn);
}

export function hashStringFnv(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashString(value, algorithm = "bun") {
  return algorithm === "fnv" ? hashStringFnv(value) : hashStringBun(value);
}

export function verifyBunHashCompatibility() {
  return BUN_HASH_SELF_TESTS.every((testCase) => wyhash64(testCase.input, testCase.seed) === testCase.expected);
}

function pick(rng, options) {
  return options[Math.floor(rng() * options.length)];
}

export function rollRarity(rng) {
  const totalWeight = Object.values(RARITY_WEIGHTS).reduce((total, value) => total + value, 0);
  let roll = rng() * totalWeight;

  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll < 0) {
      return rarity;
    }
  }

  return "common";
}

export function rollStats(rng, rarity) {
  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);

  while (dump === peak) {
    dump = pick(rng, STAT_NAMES);
  }

  const stats = {};

  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
      continue;
    }

    if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
      continue;
    }

    stats[name] = floor + Math.floor(rng() * 40);
  }

  return stats;
}

export function rollFrom(rng) {
  const rarity = rollRarity(rng);

  return {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === "common" ? "none" : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  };
}

export function rollUserId(userId, algorithm = "bun") {
  return rollFrom(mulberry32(hashString(`${userId}${SALT}`, algorithm)));
}

export function generateRandomId(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function matchesFilters(bones, filters = {}) {
  if (filters.species && bones.species !== filters.species) {
    return false;
  }

  if (filters.rarity && bones.rarity !== filters.rarity) {
    return false;
  }

  if (filters.eye && bones.eye !== filters.eye) {
    return false;
  }

  if (filters.hat && bones.hat !== filters.hat) {
    return false;
  }

  if (filters.shiny === "true" && bones.shiny !== true) {
    return false;
  }

  if (filters.shiny === "false" && bones.shiny !== false) {
    return false;
  }

  return true;
}

export function rarityLabel(rarity) {
  return rarity.toUpperCase();
}
