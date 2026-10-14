import type { Grader } from "./types";

export const NOW_ANCHOR = "2026-09-19T08:00:00.000Z";
export const NOW_MS = Date.parse(NOW_ANCHOR);
export const DAY = 86_400_000;

export const GRADERS: Grader[] = ["PSA", "CGC", "BGS", "SGC"];

export const GRADE_STEPS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

const LABELS: Record<Grader, Record<string, string>> = {
  PSA: {
    "10": "GEM MT",
    "9.5": "MINT+",
    "9": "MINT",
    "8.5": "NM-MT+",
    "8": "NM-MT",
    "7.5": "NM+",
    "7": "NM",
    "6.5": "EX-NM+",
    "6": "EX-MT",
  },
  CGC: {
    "10": "GEM MINT",
    "9.5": "MINT+",
    "9": "MINT",
    "8.5": "NM-MT+",
    "8": "NM-MT",
    "7.5": "NM+",
    "7": "NM",
    "6.5": "EX-NM+",
    "6": "EX-NM",
  },
  BGS: {
    "10": "PRISTINE",
    "9.5": "GEM MINT",
    "9": "MINT",
    "8.5": "NM-MT+",
    "8": "NM-MT",
    "7.5": "NM+",
    "7": "NM",
    "6.5": "EX-NM+",
    "6": "EX-NM",
  },
  SGC: {
    "10": "GEM",
    "9.5": "MINT+",
    "9": "MINT",
    "8.5": "NM-MT+",
    "8": "NM-MT",
    "7.5": "NM+",
    "7": "NM",
    "6.5": "EX-NM+",
    "6": "EX-NM",
  },
};

export function gradeLabel(grader: Grader, grade: number): string {
  return LABELS[grader][String(grade)] ?? "MINT";
}

const ADJ = [
  "abstract",
  "agile",
  "angelic",
  "azure",
  "brave",
  "bronze",
  "classic",
  "cosmic",
  "damaged",
  "deadly",
  "detailed",
  "devious",
  "diamond",
  "divine",
  "emerald",
  "epic",
  "ethereal",
  "fabled",
  "glowing",
  "golden",
  "grotesque",
  "heroic",
  "limited",
  "loyal",
  "playful",
  "premium",
  "pristine",
  "rare",
  "royal",
  "serene",
  "shadowy",
  "signed",
  "silver",
  "simple",
  "sparkling",
  "swift",
  "uncommon",
  "vintage",
  "whimsical",
  "wise",
];

const NOUN = [
  "angel",
  "artifact",
  "assassin",
  "battle",
  "beast",
  "booster",
  "chimera",
  "clash",
  "colossus",
  "defeat",
  "demon",
  "duel",
  "fandom",
  "fate",
  "goal",
  "griffin",
  "heritage",
  "journey",
  "knight",
  "loss",
  "memory",
  "music",
  "mythology",
  "pack",
  "power",
  "siren",
  "space",
  "sphinx",
  "titan",
  "treasure",
  "trophy",
  "vampire",
  "victory",
  "warfare",
  "warrior",
  "weakness",
  "werewolf",
  "zombie",
];

export const HANDLES = [
  "braveloss8738",
  "gaz560",
  "jsarn23",
  "carlitothegoat",
  "dougjudy",
  "tonymeatball",
  "dunc420",
  "mkm94",
  "roxrips",
  "exxempt",
  "silverpoke",
  "donk",
  "savagelife14",
  "telemarky",
  "profoakscards",
  "madik88",
  "pullpapi_rizz",
  "cardhunt18",
  "jswilf",
  "laoda",
  "un4givn",
  "tikiandy",
  "jonesyy",
  "typhoonsvault",
  "nachobiz",
  "supervoy",
  "tpd",
  "th3p1aymaker",
  "svtlightning",
  "treason666",
  "packsmagee",
  "enforcer91",
  "zfreak75",
  "fairtrades",
  "danimal4921",
  "bshaw71210",
  "mrrippermon",
  "jace1419",
];

export function syntheticHandle(rnd: () => number): string {
  const a = ADJ[Math.floor(rnd() * ADJ.length)];
  const n = NOUN[Math.floor(rnd() * NOUN.length)];
  const num = Math.floor(rnd() * 10999) + 1000;
  return `${a}${n}${num}`;
}

export const COMMENT_TEXT = [
  "Centering on this one is unreal.",
  "Grail. Congrats to whoever grabs it.",
  "FMV feels light, comps are trending up.",
  "Been hunting this exact parallel for months.",
  "Surface is clean under a loupe, no print lines.",
  "Vault it, don't ship it. This one only goes up.",
  "Bought the same cert number pop last week — solid buy.",
  "That edge wear is why it capped at this grade.",
  "Underrated card in this set honestly.",
  "Watching. If it dips 10% I'm in.",
];

export const NOTES = [
  "Strong eye appeal for the grade — corners are sharp and the holo pattern is centred cleanly. Population at this grade is thin relative to demand, which has kept sale prices tight to market value over the past quarter.",
  "Recent comps show steady appreciation with low volatility. The last three sales all cleared within 8% of each other, so this listing is priced inside the normal band.",
  "A softer grade on a widely collected subject. These tend to move fast at or below market value because they are the accessible entry point into the set.",
  "Low population parallel. Sales are infrequent, so market value carries wider error bars than a base card from the same set.",
  "Vintage cardboard with honest centring. Grader notes no evidence of trimming or restoration; the cert verifies against the grader registry.",
  "Modern chase card still inside its release window. Expect price discovery to continue as more copies are graded and the population report fills in.",
];
