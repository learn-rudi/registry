const TOKEN_ALIASES = Object.freeze({
  ave: "avenue",
  blvd: "boulevard",
  cir: "circle",
  ct: "court",
  dr: "drive",
  e: "east",
  hwy: "highway",
  ln: "lane",
  n: "north",
  oh: "oh",
  ohio: "oh",
  pike: "pike",
  pk: "pike",
  pl: "place",
  plz: "plaza",
  rd: "road",
  s: "south",
  st: "street",
  ter: "terrace",
  w: "west"
});

export function normalizeCincinnatiAddress(value) {
  return normalizedTokens(value).join(" ");
}

export function normalizeCincinnatiStreet(value) {
  if (typeof value !== "string") throw new Error("opencounter_address_invalid");
  return normalizedTokens(value.split(",")[0]).join(" ");
}

export function addressesReferToSameCincinnatiStreet(left, right) {
  const normalizedLeft = normalizeCincinnatiStreet(left);
  const normalizedRight = normalizeCincinnatiStreet(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function normalizedTokens(value) {
  if (typeof value !== "string") throw new Error("opencounter_address_invalid");
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES[token] ?? token);
}
