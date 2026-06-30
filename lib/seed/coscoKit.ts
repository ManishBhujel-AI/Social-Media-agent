import { createId } from "@paralleldrive/cuid2";
import type { BrandKitData, ClientPreferenceEntry } from "@/lib/brandKit/types";
import type { ContentReference } from "@/lib/content/references";

export const COSCO_PROJECT_ID = "cosco-hawaii";
export const COSCO_CONVERSATION_ID = "cosco-conversation";
export const COSCO_BRAND_KIT_DOMAIN = "coscohawaii.com";

const BUSINESS_SUMMARY = `Cosco Air Conditioning & Refrigeration ("Cosco Hawaii") is Hawaii's premier wholesale HVAC/R distributor, family owned and operated since 1961 and celebrating 65 years in 2026. They supply licensed AC and refrigeration contractors and technicians — not general consumers — across five island branches (Oahu Kalihi, Oahu Waipahu, Maui/Kahului, Kona, and Kauai/Lihue). They are Hawaii's #1 Daikin Premier Distributor and carry brands like Bohn, Tecumseh, SpeedClean, Zoomlock Max, and Kwikool, plus their own divisions: Cosco Custom Coils, the Hi Nitrogen Network, portable A/C rentals, and EPA/A2L/410A certification testing.

The audience is skilled tradespeople who value reliability, local stock (no mainland shipping delays), and time saved on the job. Messaging should lead with the contractor's real pain — salt, humidity, around-the-clock load, callbacks, downtime — and position Cosco as the local partner who keeps them moving. Wrap it in genuine Aloha: Cosco is a community fixture and treats customers as their "Hawaii HVAC 'ohana."`;

function pref(scope: ClientPreferenceEntry["scope"], note: string): ClientPreferenceEntry {
  return {
    id: createId(),
    date: "2026-06-26",
    scope,
    note,
  };
}

export function buildCoscoBrandKit(): BrandKitData {
  return {
    businessName: "Cosco Hawaii (Cosco Air Conditioning & Refrigeration)",
    website: "coscohawaii.com",
    location:
      "Honolulu, Hawaii HQ. 5 branches: Oahu–Kalihi (2312 Kamehameha Hwy), Oahu–Waipahu (94-134 Leowaena St), Maui–Kahului (223 Lauo Loop), Kona–Kailua-Kona (73-5574 Olowalu St), Kauai–Lihue (1885 Haleukana St)",
    businessType: "a wholesale HVAC/R supply distributor",
    audience:
      "professional HVAC/R contractors and technicians in Hawaii (trade, not general consumers)",
    tone: 'bold, professional, practical, time-is-money — with warm local Aloha spirit; addresses customers as the "Hawaii HVAC \'ohana"',
    heritage: "Family owned and operated since 1961; celebrating 65 years in 2026 (1961–2026)",
    themeWords:
      "Hawaii summer, ocean, tropical island energy. Subtle palm-leaf silhouettes on edges, soft radial glow behind product, occasional hibiscus, gentle waves. Real Hawaii backdrops work great: Diamond Head, Waikiki, island mountains, turquoise water. Bold and clean, not cluttered.",
    contact: "808-845-2234 (main / Oahu-Kalihi)",
    contactStyle:
      "coral red #F04E30; phone icon AND number both the same coral red — never a white icon; placement flexible; a white brush-stroke behind it is OK when it aids visibility but should NOT be forced on every design",
    aspectRatio: "1:1 (1080×1080)",
    businessSummary: BUSINESS_SUMMARY,
    colors: [
      { name: "sky blue", hex: "#29B8E5" },
      { name: "deep navy", hex: "#0A1F5C" },
      { name: "coral red", hex: "#F04E30" },
      { name: "white", hex: "#FFFFFF" },
    ],
    avoidColors: ["yellow", "purple"],
    sources: {
      businessName: "site",
      website: "site",
      location: "site",
      businessType: "site",
      audience: "site",
      tone: "site",
      heritage: "site",
      themeWords: "site",
      contact: "site",
      contactStyle: "site",
      aspectRatio: "default",
      businessSummary: "site",
      colors: "site",
      avoidColors: "site",
    },
    skipped: {},
    clientPreferences: [
      pref("client", "Never use yellow or purple — anywhere, including text, fonts, accents. Client rejected both."),
      pref("client", "Contact phone: icon and number both coral red #F04E30; never a white icon. White brush-stroke behind it is fine when it helps visibility, but don't force it on every design (it made posts look repetitive)."),
      pref("client", "Bullet/supporting line on graphics should be regular weight, not bold (only the headline is heavy)."),
      pref("client", "Keep graphics from looking text-heavy — decide what goes on the image vs. the caption; push extra detail to the caption."),
      pref("client", "Hawaii backgrounds (Diamond Head, island mountains, turquoise water) are geographically authentic — use confidently."),
      pref("client", 'Caption voice: warm, celebratory, uses 🎉 emojis, "Hawaii HVAC \'ohana," references family-owned since 1961, clear logistics, ends with entry rules + hashtags; Aloha/mahalo spirit.'),
      pref("client", 'Logo: always use the attached logo file; the model has misspelled it as "COSO" — always verify the returned image says "COSCO."'),
      pref("client", "Phone number is optional on giveaway/event posts if asked to skip."),
      pref("product:Zoomlock Max", 'Never show torches, open flames, or brazing in the scene — the entire pitch is "no torch, no braze." (A brazing background once contradicted the headline.)'),
      pref("product:Zoomlock Max", "It's press-to-connect fittings; the kit may carry Rothenberger-branded tooling inside the case — that's expected, not an error."),
      pref("product:SpeedClean", "The CoilJet backpack unit is the hero and should be the largest product; CoilShot gun and steam cleaner are secondary. Don't let products overlap or sit on top of each other's hoses."),
      pref("product:Daikin", 'Lead with "Hawaii\'s #1 Daikin Premier Distributor"; emphasize local stock, no mainland lead times, on-island technical support.'),
      pref("product:Air Filter", "Never age, yellow, dirty, or alter the filter product image (the model once aged a clean filter)."),
      pref("topic:refrigerants", "R-32 and R-454B are current low-GWP refrigerants replacing R-410A (EPA AIM Act, 2025) — correct and timely to feature."),
      pref("topic:Summer Bites", "Free walk-in lunch (11AM–1PM, all locations) on raffle days, tied to the 65th anniversary. Kawaii sushi/noodle illustrations fit the fun tone. Strike through or drop dates already passed."),
    ],
    productNotes: {
      Daikin: "#1 Daikin Premier Distributor; Daikin Fit, VRV, ductless; local stock.",
      Bohn: "commercial refrigeration / evaporator unit coolers; emphasis on no-mainland-wait emergency replacements.",
      Tecumseh: "refrigeration compressors built for high ambient temps + continuous island load.",
      SpeedClean: "coil-cleaning tools; CoilJet hero (largest), CoilShot + steam cleaner secondary.",
      "Zoomlock Max": "press-fit fittings; NO torch/flame/braze imagery ever.",
      Kwikool: "portable A/C rentals (2–5 ton) for emergency cooling.",
      "Hi Nitrogen Network": "onsite N2 tank fills (Oahu & Kona), 60–250 cu ft.",
      "Cosco Custom Coils": "built-to-spec coils, 5-yr coating warranty, free estimates, expedited service.",
      "EPA/A2L/410A Certification":
        "monthly testing, Honolulu & Waipahu, $95/test, 10 spots/date (event posts: show these specifics on the graphic).",
      "65th Anniversary Giveaway Series 2026":
        'raffle days: May 22, Jun 5, Jun 19, Jul 2, Jul 17, Jul 31, Aug 7, Aug 21; different prizes each round; silver "CELEBRATING 65 YEARS 1961–2026" badge.',
    },
    secondaryContacts: [
      { branch: "Oahu (Kalihi)", phone: "808-845-2234", address: "2312 Kamehameha Hwy, Honolulu" },
      { branch: "Oahu (Waipahu)", phone: "808-757-7799", address: "94-134 Leowaena St, Waipahu" },
      { branch: "Maui", phone: "808-871-6285", address: "223 Lauo Loop, Kahului" },
      { branch: "Kona", phone: "808-326-2505", address: "73-5574 Olowalu St, Kailua-Kona" },
      { branch: "Kauai", phone: "808-632-2153", address: "1885 Haleukana St, Lihue" },
    ],
    settingsChangelog: [],
  };
}

export function buildCoscoCaptionCorpus(): string {
  return [
    `🎉 Summer Kick-Off is here, Hawaii HVAC 'ohana! Cosco Hawaii — family owned since 1961 — is celebrating 65 years with giveaways across all five branches. Stop by your island Cosco for your chance to win. Mahalo for building Hawaii with us!

How to enter: visit any Cosco branch during raffle hours, no purchase necessary. One entry per contractor per day.

#CoscoHawaii #HawaiiHVAC #Daikin #ACContractor #Honolulu #Aloha`,
    `🎉 Grocery Gold Rush time! Our Hawaii HVAC 'ohana knows downtime costs money — Cosco keeps you stocked local so you stay on the job. Family owned since 1961, celebrating 65 years in 2026.

Enter at any Cosco branch. See store for official rules.

#CoscoHawaii #HawaiiContractor #HVACLife #IslandStrong #Waipahu #Kahului`,
    `🎉 Summer Bites at Cosco! Free walk-in lunch 11AM–1PM at all locations on raffle days — part of our 65th anniversary thank-you to the Hawaii HVAC 'ohana. Grab a bite between jobs and say aloha to the team.

#CoscoHawaii #SummerBites #HawaiiHVAC #ContractorLife #Kona #Lihue`,
    `Celebrating 65 years of keeping Hawaii cool! 🎉 Cosco Hawaii has been family owned and operated since 1961 — your local wholesale HVAC/R partner with stock on-island, technical support, and Aloha spirit for every contractor in the 'ohana.

#CoscoHawaii #65Years #HawaiiHVAC #Daikin #Since1961 #IslandContractors`,
  ].join("\n\n---\n\n");
}

/** @deprecated Captions now live in captionCorpus */
export function buildCoscoContentReferences(): ContentReference[] {
  return [];
}
