import { EYES } from "./buddy-core.js";

export const ASCII_WIDTH = 14;
export const ASCII_HEIGHT = 6;

const EYE_PRESETS = [
  { en: "Slash", zh: "斜线眼", glyph: "." },
  { en: "Spark", zh: "星点眼", glyph: "*" },
  { en: "Sleepy", zh: "困困眼", glyph: "-" },
  { en: "Round", zh: "圆眼", glyph: "o" },
  { en: "At Sign", zh: "@眼", glyph: "@" },
  { en: "Dot", zh: "点点眼", glyph: "^" },
];

const EYE_PRESET_BY_VALUE = new Map(EYES.map((value, index) => [value, EYE_PRESETS[index] ?? EYE_PRESETS[0]]));

const EMPTY_LINE = " ".repeat(ASCII_WIDTH);

const SPRITES = {
  duck: [
    "",
    "     __",
    "  <({E} )___",
    "   (___/",
    "",
    "",
  ],
  goose: [
    "",
    "      __",
    "  ___({E}>",
    " /____/ ",
    "",
    "",
  ],
  blob: [
    "",
    "   .----.",
    "  / {E}  {E} \\\\",
    "  \\\\_----_/",
    "",
    "",
  ],
  cat: [
    "",
    "  /\\_/\\\\",
    " ( {E}  {E} )",
    "  >  ^  <",
    "",
    "",
  ],
  dragon: [
    "   /\\/\\\\",
    "  / {E}  {E}\\\\__",
    " <    ^    /",
    "  \\\\_/\\\\__/",
    "",
    "",
  ],
  octopus: [
    "",
    "   .----.",
    "  ( {E}  {E} )",
    " /\\/\\/\\/\\\\",
    "",
    "",
  ],
  owl: [
    "",
    "   /\\  /\\\\",
    "  (( {E})( {E}))",
    "    /__\\\\",
    "",
    "",
  ],
  penguin: [
    "",
    "   .--.",
    "  ({E}> <{E})",
    "  /|__|\\\\",
    "",
    "",
  ],
  turtle: [
    "",
    "   _____",
    " _/ {E}  {E} \\\\_",
    " \\\\_______/",
    "",
    "",
  ],
  snail: [
    "",
    "   _@__",
    "  / {E}  {E}\\\\_",
    " /______/ ",
    "",
    "",
  ],
  ghost: [
    "",
    "   .----.",
    "  / {E}  {E} \\\\",
    "  \\\\_ww__/",
    "",
    "",
  ],
  axolotl: [
    "  \\\\ | / /",
    "  ( {E}  {E} )",
    " /  --  \\\\",
    " \\\\_/  \\\\_/",
    "",
    "",
  ],
  capybara: [
    "",
    "  ________",
    " / {E}  {E}  __\\\\",
    "/_________/ ",
    "",
    "",
  ],
  cactus: [
    "    _ _",
    "  _| {E}|_",
    " | | {E}| |",
    " |_|_||_|",
    "",
    "",
  ],
  robot: [
    "",
    "   .----.",
    "   |{E}  {E}|",
    "   |----|",
    "",
    "",
  ],
  rabbit: [
    "   /\\/\\\\",
    "  ( {E}  {E} )",
    "  /  --  \\\\",
    " (_/    \\\\_)",
    "",
    "",
  ],
  mushroom: [
    "  .-^^^^-.",
    " (  {E}  {E}  )",
    "  \\\\____/",
    "   | || |",
    "",
    "",
  ],
  chonk: [
    "",
    "  /\\____/\\\\",
    " (  {E}  {E}  )",
    " (   --   )",
    "",
    "",
  ],
};

function padCenter(value, width) {
  const line = String(value ?? "");
  if (line.length >= width) {
    return line.slice(0, width);
  }

  const total = width - line.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return `${" ".repeat(left)}${line}${" ".repeat(right)}`;
}

function replaceEyes(line, eyeGlyph) {
  return line.replaceAll("{E}", eyeGlyph);
}

export function getEyePreset(value) {
  return EYE_PRESET_BY_VALUE.get(value) ?? EYE_PRESETS[0];
}

export function getEyeLabel(value, locale) {
  const preset = getEyePreset(value);
  return locale === "zh-CN" ? preset.zh : preset.en;
}

export function buildAsciiPortrait(bones) {
  const sprite = SPRITES[bones.species] ?? SPRITES.blob;
  const eyeGlyph = getEyePreset(bones.eye).glyph;
  const lines = sprite.map((line) => replaceEyes(line, eyeGlyph)).slice(0, ASCII_HEIGHT);

  if (bones.shiny) {
    lines[0] = "    *   *    ";
  }

  return lines.map((line) => padCenter(line, ASCII_WIDTH)).join("\n");
}
