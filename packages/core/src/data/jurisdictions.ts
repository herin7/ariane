import type { Jurisdiction } from "../types.js";

/**
 * Jurisdiction is data, never a branch in engine code. Adding a state is
 * adding rows here plus edges scoped to them, and touching nothing else.
 *
 * Gujarat districts are seeded as the proving ground. The rest of India is
 * reachable through IN, which is where all national rules hang.
 */

const GJ_DISTRICTS: [string, string][] = [
  ["AHMEDABAD", "Ahmedabad"],
  ["AMRELI", "Amreli"],
  ["ANAND", "Anand"],
  ["ARAVALLI", "Aravalli"],
  ["BANASKANTHA", "Banaskantha"],
  ["BHARUCH", "Bharuch"],
  ["BHAVNAGAR", "Bhavnagar"],
  ["BOTAD", "Botad"],
  ["CHHOTA_UDEPUR", "Chhota Udepur"],
  ["DAHOD", "Dahod"],
  ["DANG", "Dang"],
  ["DEVBHOOMI_DWARKA", "Devbhoomi Dwarka"],
  ["GANDHINAGAR", "Gandhinagar"],
  ["GIR_SOMNATH", "Gir Somnath"],
  ["JAMNAGAR", "Jamnagar"],
  ["JUNAGADH", "Junagadh"],
  ["KHEDA", "Kheda"],
  ["KUTCH", "Kutch"],
  ["MAHISAGAR", "Mahisagar"],
  ["MEHSANA", "Mehsana"],
  ["MORBI", "Morbi"],
  ["NARMADA", "Narmada"],
  ["NAVSARI", "Navsari"],
  ["PANCHMAHAL", "Panchmahal"],
  ["PATAN", "Patan"],
  ["PORBANDAR", "Porbandar"],
  ["RAJKOT", "Rajkot"],
  ["SABARKANTHA", "Sabarkantha"],
  ["SURAT", "Surat"],
  ["SURENDRANAGAR", "Surendranagar"],
  ["TAPI", "Tapi"],
  ["VADODARA", "Vadodara"],
  ["VALSAD", "Valsad"],
];

export const jurisdictions: Jurisdiction[] = [
  { id: "IN", level: "COUNTRY", name: "India" },
  { id: "IN-GJ", parentId: "IN", level: "STATE", name: "Gujarat" },
  ...GJ_DISTRICTS.map(([id, name]): Jurisdiction => ({
    id: `IN-GJ-${id}`,
    parentId: "IN-GJ",
    level: "DISTRICT",
    name,
  })),
];
