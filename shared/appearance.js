// Character appearance: which body, skin tone, hair, and closet items a player wears. One shared
// definition so the dashboard UI, the renderer (characters.js) and the server's validation can't
// disagree about what's a legal option. Pure data + a sanitizer — no three.js here, this file is
// imported by Node too.

export const CHARACTERS = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
];

// White -> black, with the natural shades in between (light to dark). Used as swatches AND as
// the anchor stops of the continuous skin slider.
export const SKIN_TONES = [
  '#fbeee4', '#f5dcc6', '#eecaa8', '#e2b38a', '#d29a6c', '#bd8155',
  '#a26840', '#875132', '#6c3f27', '#52301e', '#3a2116', '#241510',
];

export const HAIR_COLORS = [
  '#15110e', '#2b1d14', '#4a3020', '#6b4429', '#8f5a2f', '#b5793a',
  '#d2a85c', '#e8d9a8', '#9a9a98', '#e4e4e2', '#a52a2a', '#2f5fa8',
];

export const CLOTH_COLORS = [
  '#1c1c1c', '#3a3f44', '#e9e9e4', '#556b2f', '#2f4a2f', '#1f3a5f',
  '#3d6ea8', '#a12b2b', '#c56a1c', '#b09a6a', '#c9a66b', '#6b4a8a',
];

// Item slots. `id: 'none'` = nothing worn in that slot. Which body region each item covers is
// renderer knowledge (characters.js); this is only the menu.
export const SLOTS = {
  hair: [
    { id: 'none', label: 'Bald' },
    { id: 'buzzed', label: 'Buzz Cut' },
    { id: 'parted', label: 'Side Part' },
    { id: 'long', label: 'Long' },
    { id: 'buns', label: 'Buns' },
  ],
  beard: [
    { id: 'none', label: 'Clean' },
    { id: 'beard', label: 'Beard' },
  ],
  top: [
    { id: 'none', label: 'Bare' },
    { id: 'tank', label: 'Tank Top' },
    { id: 'tee', label: 'T-Shirt' },
    { id: 'longsleeve', label: 'Long Sleeve' },
    { id: 'camojacket', label: 'Camo Jacket' },
  ],
  bottom: [
    { id: 'none', label: 'Briefs' },
    { id: 'shorts', label: 'Shorts' },
    { id: 'pants', label: 'Pants' },
    { id: 'camopants', label: 'Camo Pants' },
  ],
  shoes: [
    { id: 'none', label: 'Barefoot' },
    { id: 'sneakers', label: 'Sneakers' },
    { id: 'boots', label: 'Combat Boots' },
  ],
  gloves: [
    { id: 'none', label: 'None' },
    { id: 'gloves', label: 'Gloves' },
  ],
  head: [
    { id: 'none', label: 'None' },
    { id: 'beanie', label: 'Beanie' },
    { id: 'helmet', label: 'Helmet' },
  ],
};

export const DEFAULT_APPEARANCE = {
  character: 'male',
  skin: '#bd8155',
  hair: 'buzzed', hairColor: '#2b1d14',
  beard: 'none',
  top: 'tee', topColor: '#556b2f',
  bottom: 'pants', bottomColor: '#3a3f44',
  shoes: 'boots', shoesColor: '#1c1c1c',
  gloves: 'none', glovesColor: '#1c1c1c',
  head: 'none', headColor: '#3a3f44',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
const pick = (slot, v, fallback) => (SLOTS[slot].some((o) => o.id === v) ? v : fallback);

// Anything from the network/DB/localStorage goes through here: unknown ids and malformed colors
// fall back to defaults rather than throwing, so a bad or outdated record can never break a
// client's render or the server.
export function sanitizeAppearance(a) {
  const d = DEFAULT_APPEARANCE;
  const src = a && typeof a === 'object' ? a : {};
  return {
    character: CHARACTERS.some((c) => c.id === src.character) ? src.character : d.character,
    skin: hex(src.skin, d.skin),
    hair: pick('hair', src.hair, d.hair), hairColor: hex(src.hairColor, d.hairColor),
    beard: pick('beard', src.beard, d.beard),
    top: pick('top', src.top, d.top), topColor: hex(src.topColor, d.topColor),
    bottom: pick('bottom', src.bottom, d.bottom), bottomColor: hex(src.bottomColor, d.bottomColor),
    shoes: pick('shoes', src.shoes, d.shoes), shoesColor: hex(src.shoesColor, d.shoesColor),
    gloves: pick('gloves', src.gloves, d.gloves), glovesColor: hex(src.glovesColor, d.glovesColor),
    head: pick('head', src.head, d.head), headColor: hex(src.headColor, d.headColor),
  };
}

// Deterministic look for players with no saved appearance (guests): spreads the hair/top/skin
// choices by id so a lobby of guests doesn't look like clones.
export function guestAppearance(id) {
  const n = Math.abs(Number(id) || 0);
  return sanitizeAppearance({
    character: n % 2 ? 'female' : 'male',
    skin: SKIN_TONES[(n * 5) % SKIN_TONES.length],
    hairColor: HAIR_COLORS[(n * 7) % HAIR_COLORS.length],
    topColor: CLOTH_COLORS[(n * 3) % CLOTH_COLORS.length],
    bottomColor: CLOTH_COLORS[(n * 3 + 1) % CLOTH_COLORS.length],
  });
}
