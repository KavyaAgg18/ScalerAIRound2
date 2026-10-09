// Locations the console offers for geolocation routing.

export const CONTINENTS: Record<string, string> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
};

// ISO 3166-1 alpha-2 codes; names come from the browser so the list stays short.
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

const names = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

export const COUNTRIES: { code: string; name: string }[] = COUNTRY_CODES.map((code) => ({
  code,
  name: names?.of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name));

// Route 53 supports subdivisions for US states.
export const US_STATES =
  "AK AL AR AZ CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split(
    " ",
  );

/** Human label for a stored geolocation value ("*", "continent:EU", "country:US", "country:US/CA"). */
export function geoLabel(value: string | null): string {
  if (!value) return "-";
  if (value === "*") return "Default";
  const [kind, rest] = value.split(":");
  if (kind === "continent") return CONTINENTS[rest] ?? rest;
  const [country, sub] = rest.split("/");
  const name = COUNTRIES.find((c) => c.code === country)?.name ?? country;
  return sub ? `${name} (${sub})` : name;
}
