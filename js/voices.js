/* Choosing a good read-aloud voice. A web page can't know which voices sound human, or whether they are
   female, so this ranks them by what the voices say about themselves ("Natural", "Premium", a familiar name). */

const QUALITY = /natural|neural|premium|enhanced|wavenet|studio|siri|online/i;           // the newer, smoother kinds
const FEMALE = /\b(aria|jenny|sonia|libby|emma|michelle|ava|allison|samantha|susan|zoe|karen|moira|tessa|serena|fiona|victoria|joanna|salli|kendra|kimberly|ivy|amy|olivia|nicole|natasha|claire|catherine|shelley|sandy|flo|ellen|nicky|zira|hazel|heera|neerja|female|woman)\b|google us english/i;
const MALE = /\b(alex|daniel|fred|tom|david|mark|guy|ryan|james|george|oliver|thomas|rishi|aaron|arthur|gordon|eddy|reed|rocko|evan|male|man|boy|davis|eric|roger|steffan|brian)\b/i;
const ROBOTIC = /espeak|festival|compact/i;                                                // old, flat-sounding engines

const text = (v) => `${v.name || ""} ${v.voiceURI || ""}`;
export const isEnglish = (v) => /^en/i.test(v.lang || "");

export function scoreVoice(v) {
  let s = 0;
  const t = text(v);
  if (isEnglish(v)) s += 50;
  s += { "en-us": 6, "en-gb": 4, "en-au": 3, "en-ca": 3, "en-ie": 2 }[(v.lang || "").toLowerCase().replace("_", "-")] || 0;
  if (QUALITY.test(t)) s += 30;
  if (/premium/i.test(t)) s += 10;
  if (FEMALE.test(t)) s += 20;
  if (MALE.test(t)) s -= 40;
  if (ROBOTIC.test(t)) s -= 15;
  if (/google/i.test(t)) s += 8;                                                           // Google's voices are the smoother ones on Chrome and Android
  if (/network/i.test(t)) s += typeof navigator !== "undefined" && navigator.onLine === false ? -30 : 12;   // Android's online voices sound better, but need a connection
  return s;
}
export const rankVoices = (list) => [...list].sort((a, b) => scoreVoice(b) - scoreVoice(a) || (a.name || "").localeCompare(b.name || ""));
export const bestVoice = (list) => rankVoices(list.filter(isEnglish))[0] || null;

/* a star on the voices most likely to sound smooth and warm */
export const recommended = (v, list) => isEnglish(v) && !MALE.test(text(v)) && (QUALITY.test(text(v)) || rankVoices(list.filter(isEnglish))[0] === v);
export const voiceLabel = (v, list) => `${recommended(v, list) ? "★ " : ""}${v.name} (${v.lang})`;
