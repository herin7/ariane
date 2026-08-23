import type {
  GraphEdge,
  GraphNode,
  QuestionDefinition,
  RequirementGroup,
  Source,
  SourceRef,
} from "../../types";

/**
 * Revenue certificates, Gujarat: income, caste and domicile.
 *
 * Same rule as the driving licence file. Every claim carries the sentence it
 * was read off, quoted exactly as the page prints it, and nothing here was
 * remembered, averaged or tidied up.
 *
 * The big hole, stated up front: digitalgujarat.gov.in is hard blocked and
 * returned nothing to the crawl, so the state portal's own required document
 * lists for these three services do not exist in this graph. What is here is
 * what the district NIC sites publish and verify, which is a different and
 * smaller thing. Rather than fill the gap from memory, the document lists below
 * are the ones Morbi publishes for the caste and domicile certificates and the
 * one Mahesana publishes for its combined widow and income certificate. Where a
 * single district's list has been widened to the state, the edge says so in its
 * note and is NORMALIZED rather than VERIFIED.
 *
 * Also deliberately missing, because no official page in the crawl stated it:
 * a statewide fee for any certificate other than Mahesana's Rs. 20, statutory
 * delivery timelines under the Gujarat Right of Citizens to Public Services Act
 * (both source pages failed to load), validity periods for the caste, SEBC,
 * Non-Creamy Layer and domicile certificates, any tracking URL or grievance URL
 * for a certificate application, counter hours for any office, the Vadodara Jan
 * Seva Kendra street address (it was in the researcher's notes but not in the
 * quoted sentence, so it is not here), and whether an Aadhaar card is required.
 * Aadhaar appears in none of the retrieved lists, so it is in none of these.
 */

const RETRIEVED = "2026-08-23";

const cite = (sourceId: string, evidence: string, confidence: number): SourceRef[] => [
  { sourceId, evidence, confidence, verificationStatus: "VERIFIED" },
];

/**
 * For claims we read out of a quote rather than off it. Confidence is lowered
 * from the research figure on purpose: the quote is as good as it ever was, our
 * reading of it is not.
 */
const derived = (sourceId: string, evidence: string, confidence: number): SourceRef[] => [
  { sourceId, evidence, confidence, verificationStatus: "NORMALIZED" },
];

// The long lists, quoted once each so the twenty odd facts drawn out of them
// cannot drift apart from the sentence they came from.
const E_RESIDENT_PROOF =
  "Resident Proof:\n\n- Ration Card\n- True Copy of Electricity Bill.\n- True Copy of Telephone Bill.\n- True Copy of Election Card.\n- True Copy of Passport\n- First Page Of Bank PassBook/Cancelled Cheque\n- Post Office Account Statement/Passbook\n- Driving License\n- Government Photo ID cards/ service photo identity card issued by PSU\n- Water bill (not older than 3 months)";

const E_IDENTITY_PROOF =
  "Identity Proof:\n\n- True Copy of Election Card.\n- True Copy Income Tax PAN Card.\n- True Copy of Passport\n- Driving License\n- Government Photo ID cards/ service photo identity card issued by PSU\n- Any Government Document having citizen photo\n- Photo ID issued by Recognized Educational Institution";

const E_CASTE_PROOF =
  "Caste Proof:\n\n- True Copy of School Leaving Certificate\n- Certificate of a caste of the family member with Pedhinamu (Family Tree issued by Talati) or Ration Card";

const E_RELATIONSHIP_PROOF =
  "Relationship Proof:\n\n- True Copy of School Leaving Certificate\n- An affidavit attached with the application.\n- True Copy of School Leaving Certificate of Father/Uncle/Aunts";

const E_DOMICILE_PROOFS =
  "Proofs Needed:\n\n- Panchnamu\n- Certificate of Talati.\n- Applicant Answer\n- Domicile by Birth (Birth Certificate)\n- Proof of Parent’s Job/Business\n- No Objection Certificate of Police Station\n- Character Certificate\n- Affidavit\n- Last 10 years residence proof\n- Identity Proof\n- Resident Proof";

const E_INCOME_EVIDENCE =
  "Certified copy of the evidence\n\n1. Applicant’s application\n2. Responding to the applicant’s Talati face-to-face\n3. Panchanamu\n4. Proof of residence (telephone bill / light bill / municipal tax bill, whatever one)\n5. Death Examples\n6. Example of age (example of a school living certificate / civil surgeon municipality or Talati)\n7. Income Proof\n8. Affidavit (as per Appendix 4/48)\n9. Copy of ration card";

const E_ATVT =
  "ATVT / Jan Seva Kendra caters following citizen centric services at all Taluka Mamlatdar / Panchayat Office of Devbhumi Dwarka District.\n\nAlso these services are made available online.";

const E_MORBI_CATEGORY =
  "- [Birth & Death Certificate](https://morbi.nic.in/service/death-certificate/ \"Birth & Death Certificate\")\n- [Domicile Certificate](https://morbi.nic.in/service/domicile-certificate/ \"Domicile Certificate\")\n- [Caste Certificate](https://morbi.nic.in/service/caste-certificate/ \"Caste Certificate\")";

const E_CASTE_VARIANTS =
  "- SEBC Certificate\n- SC/ST Caste Certificate\n- Non-Creamy Layer Certificate For Gujarat Government";

const E_NCL_VARIANTS =
  "- Non-Creamy layer Certificate For Gujarat Government\n- Non-Creamy layer Certificate For Central Government";

const E_EWS_PURPOSE =
  "- Economically Backward Certificate(Other than Job/Education Purpose)\n- Unreserved Economically Weaker Sections(For Job/Education Purpose)";

const E_ONLINE_AND_OFFLINE =
  "Citizen can apply for this services online and offline as well. All these applications are available on comman service portal Digital Gujarat portal. Citizen can also apply at Janseva Kendra.";

const E_INCOME_VALIDITY =
  "The State Government has approved the validity of the income certificate for three financial years from the date of issue. Accordingly, a candidate who has a valid income certificate need not have to issue it again for the next three years financial years.";

/**
 * The Mahesana list is the only officially published document list we have for
 * an income certificate anywhere in Gujarat, and it is published for the
 * combined widow and income certificate service in one district. Widening it to
 * the state is ours, not theirs, so every edge that carries it says so.
 */
const MAHESANA_LIST_NOTE = "From Mahesana district's published list. Confirm at your Jan Seva Kendra.";

/** Morbi publishes the caste and domicile lists. Same caveat, different district. */
const MORBI_LIST_NOTE = "From Morbi district's published list. Confirm at your Jan Seva Kendra.";

export const sources: Source[] = [
  // The two Digital Gujarat pages the district sites link to are not listed
  // here. Both returned ERR_TUNNEL_CONNECTION_FAILED, nothing was read off
  // them, and a source nobody can quote is not a source.
  {
    id: "src:ahd-income",
    url: "https://ahmedabad.nic.in/service/income-certificate/",
    title: "Income Certificate - Mamlatdar Office, Jan Seva Kendra (District Ahmedabad)",
    domain: "ahmedabad.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-AHMEDABAD",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:ahd-sebc",
    url: "https://ahmedabad.nic.in/service/sebc-certificate/",
    title: "SEBC Certificate | District Ahmedabad, Government of Gujarat",
    domain: "ahmedabad.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-AHMEDABAD",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:ahd-ncl",
    url: "https://ahmedabad.nic.in/service/non-creamy-layer-certificate-for-gujarat-government/",
    title: "Non-Creamy Layer Certificate For Gujarat Government | District Ahmedabad",
    domain: "ahmedabad.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-AHMEDABAD",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:morbi-caste",
    url: "https://morbi.nic.in/service/caste-certificate/",
    title: "Caste Certificate | District Morbi, Government of Gujarat",
    domain: "morbi.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-MORBI",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:morbi-domicile",
    url: "https://morbi.nic.in/service/domicile-certificate/",
    title: "Domicile Certificate | District Morbi, Government of Gujarat",
    domain: "morbi.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-MORBI",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:morbi-certificates",
    url: "https://morbi.nic.in/service-category/certificates/",
    title: "Certificates | District Morbi, Government of Gujarat",
    domain: "morbi.nic.in",
    sourceType: "OFFICE_DIRECTORY",
    jurisdictionId: "IN-GJ-MORBI",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:mahesana-income",
    url: "https://mahesana.nic.in/service/regarding-getting-a-widow-and-income-certificate/",
    title: "Regarding obtaining widow and income certificates | District Mahesana",
    domain: "mahesana.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-MEHSANA",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:dwarka-certificates",
    url: "https://devbhumidwarka.nic.in/service/certificates/",
    title: "Certificates | District Devbhumi Dwarka, Government of Gujarat",
    domain: "devbhumidwarka.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-DEVBHOOMI_DWARKA",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:banaskantha-certificates",
    url: "https://banaskantha.nic.in/service/certificate/",
    title: "Certificate | District Banaskantha, Government of Gujarat",
    domain: "banaskantha.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-BANASKANTHA",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:surendranagar-caste",
    url: "https://surendranagar.nic.in/service/caste-certificate/",
    title: "Caste Certificate | District Surendranagar, Government of Gujarat",
    domain: "surendranagar.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-SURENDRANAGAR",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:surat-caste",
    url: "https://surat.nic.in/service/caste-certificate/",
    title: "Caste Certificate | District Surat, Government of Gujarat",
    domain: "surat.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-SURAT",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:vadodara-residence",
    url: "https://vadodara.nic.in/service/residence-certificate/",
    title: "Domicile Certificate & Other Services - DIGITAL GUJARAT | District Vadodara",
    domain: "vadodara.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-VADODARA",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:surat-form-36",
    url: "https://surat.nic.in/form/income-certificate-form-no-36/",
    title: "Income Certificate : Form No. 36 | District Surat, Government of Gujarat",
    domain: "surat.nic.in",
    sourceType: "PDF",
    jurisdictionId: "IN-GJ-SURAT",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:myscheme-mysy",
    url: "https://www.myscheme.gov.in/schemes/mysy",
    title: "Mukhyamantri Yuva Swavalamban Yojana | myScheme (National Government Services Portal)",
    domain: "myscheme.gov.in",
    sourceType: "GUIDELINE",
    retrievedAt: RETRIEVED,
  },
];

export const nodes: GraphNode[] = [
  // -- the three services --------------------------------------------------
  {
    id: "service:income_certificate",
    type: "SERVICE",
    name: "Income certificate",
    officialName: "Income Certificate",
    aliases: ["income certificate", "income proof certificate"],
    description:
      "The certificate that states your family income, asked for by scholarships, fee waivers and reserved category schemes. Applied for on Digital Gujarat or over the counter at the Jan Seva Kendra.",
    jurisdictionId: "IN-GJ",
    metadata: {
      whyRequired:
        "Scholarship schemes ask for a valid income certificate, and one issued now counts for the next three financial years, so it is worth getting before you need it.",
      whatToDo:
        "Apply on the Digital Gujarat citizen services portal, or hand the application in at the Jan Seva Kendra in your taluka Mamlatdar office. The document list below is the one Mahesana district publishes for its combined widow and income certificate. No other Gujarat page publishes one and the state portal could not be read, so treat it as the best guide available and confirm at your counter.",
      expectedOutput: "An income certificate, valid for three financial years from the date it is issued.",
      fee: "Rs. 20 in Mahesana district, for the combined widow and income certificate service.",
      timeline: "Mahesana district publishes a disposal time limit of 7 days.",
    },
    sources: [
      {
        sourceId: "src:ahd-income",
        evidence: "Visit: https://www.digitalgujarat.gov.in/Citizen/CitizenService.aspx",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:mahesana-income",
        evidence: "Disposal time limit is 7 days.",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:mahesana-income",
        evidence: "Fee Rs. 20/-",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:myscheme-mysy",
        evidence: E_INCOME_VALIDITY,
        confidence: 0.85,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:caste_certificate",
    type: "SERVICE",
    name: "Caste certificate",
    officialName: "Caste Certificate",
    aliases: ["caste certificate", "sc st certificate", "sebc certificate"],
    description:
      "In Gujarat this is not one certificate but three: the SEBC Certificate, the SC/ST Caste Certificate and the Non-Creamy Layer Certificate For Gujarat Government. Which one you need depends on your category and what you are applying for. The counter is the same for all of them.",
    jurisdictionId: "IN-GJ",
    metadata: {
      whatToDo:
        "Apply online on the Digital Gujarat portal, or in person at a Jan Seva Kendra. Take four kinds of proof with you: residence, identity, caste and relationship.",
      expectedOutput: "A caste certificate in whichever of the three forms applies to you.",
    },
    sources: [
      {
        sourceId: "src:surat-caste",
        evidence: E_CASTE_VARIANTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:surendranagar-caste",
        evidence: E_ONLINE_AND_OFFLINE,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:morbi-certificates",
        evidence: E_MORBI_CATEGORY,
        confidence: 0.85,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:domicile_certificate",
    type: "SERVICE",
    name: "Domicile certificate",
    officialName: "Domicile Certificate",
    aliases: ["domicile certificate", "residence certificate"],
    description:
      "Proof that Gujarat is where you live and have lived. The longest of the three: eleven separate proofs, one of which is a No Objection Certificate you have to get out of a police station, and another is ten years of residence evidence.",
    jurisdictionId: "IN-GJ",
    metadata: {
      whatToDo:
        "Collect all eleven proofs the district lists before you go. The Jan Seva Kendra is a single window, but it is a single window that wants the whole file at once.",
      couldBlock: ["document:police_noc", "document:talati_certificate"],
    },
    sources: [
      {
        sourceId: "src:morbi-domicile",
        evidence: E_DOMICILE_PROOFS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:morbi-certificates",
        evidence: E_MORBI_CATEGORY,
        confidence: 0.85,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:vadodara-residence",
        evidence: "JanSeva Kendra : It is Single window system for many services. This is one of them.",
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- the certificates the three services hand you ------------------------
  {
    id: "document:income_certificate",
    type: "DOCUMENT",
    name: "Income certificate",
    officialName: "Income Certificate",
    description:
      "Valid for three financial years from the date it is issued, so you do not have to get a fresh one for every application in that window.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:myscheme-mysy",
        evidence: E_INCOME_VALIDITY,
        confidence: 0.85,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:surat-form-36",
        evidence: "Income Certificate : Form No. 36",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:caste_certificate",
    type: "DOCUMENT",
    name: "Caste certificate",
    officialName: "Caste Certificate",
    description:
      "Issued as an SEBC Certificate, an SC/ST Caste Certificate or a Non-Creamy Layer Certificate For Gujarat Government. No official page in the crawl states how long any of them stay valid.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:morbi-certificates",
        evidence: E_MORBI_CATEGORY,
        confidence: 0.85,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:surat-caste",
        evidence: E_CASTE_VARIANTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:domicile_certificate",
    type: "DOCUMENT",
    name: "Domicile certificate",
    officialName: "Domicile Certificate",
    aliases: ["residence certificate"],
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:morbi-certificates",
        evidence: E_MORBI_CATEGORY,
        confidence: 0.85,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- the rest of the certificate family ----------------------------------
  // These exist because official pages name them, and because a citizen who
  // asks for "caste certificate" is often after one of these by name. They are
  // pointed at service:caste_certificate rather than out from it, so asking for
  // a caste certificate does not put four other certificates in your path.
  {
    id: "service:sebc_certificate",
    type: "SERVICE",
    name: "SEBC certificate",
    officialName: "SEBC Certificate",
    aliases: ["sebc", "sebc certificate", "socially and educationally backward class certificate"],
    description: "One of the three certificates Gujarat issues under the caste heading.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:surat-caste",
        evidence: E_CASTE_VARIANTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:ahd-sebc",
        evidence: "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380030",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:sc_st_caste_certificate",
    type: "SERVICE",
    name: "SC/ST caste certificate",
    officialName: "SC/ST Caste Certificate",
    aliases: ["sc certificate", "st certificate", "sc st caste certificate"],
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:surat-caste",
        evidence: E_CASTE_VARIANTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:non_creamy_layer_certificate_gujarat",
    type: "SERVICE",
    name: "Non-Creamy Layer certificate, for Gujarat Government purposes",
    officialName: "Non-Creamy layer Certificate For Gujarat Government",
    aliases: ["ncl certificate", "non creamy layer certificate"],
    description:
      "Gujarat issues two of these and they are not interchangeable. This is the one for state government purposes.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:dwarka-certificates",
        evidence: E_NCL_VARIANTS,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:ahd-ncl",
        evidence: "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380027",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:non_creamy_layer_certificate_central",
    type: "SERVICE",
    name: "Non-Creamy Layer certificate, for Central Government purposes",
    officialName: "Non-Creamy layer Certificate For Central Government",
    description:
      "The other one. If you take the state certificate to a central government application, or the other way round, it will not do.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:dwarka-certificates",
        evidence: E_NCL_VARIANTS,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:ews_certificate",
    type: "SERVICE",
    name: "Unreserved Economically Weaker Sections certificate",
    officialName: "Unreserved Economically Weaker Sections(For Job/Education Purpose)",
    aliases: ["ews certificate", "ews"],
    description: "The economically weaker sections certificate issued for a job or a course.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:dwarka-certificates",
        evidence: E_EWS_PURPOSE,
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:economically_backward_certificate",
    type: "SERVICE",
    name: "Economically Backward certificate",
    officialName: "Economically Backward Certificate(Other than Job/Education Purpose)",
    description: "The same ground, for every purpose that is not a job or a course.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:dwarka-certificates",
        evidence: E_EWS_PURPOSE,
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- eligibility ---------------------------------------------------------
  // The Dwarka page prints the purpose split in the certificate names
  // themselves. It is the only thing in this journey that decides which of two
  // services you actually want, so it is a rule and not a footnote.
  {
    id: "eligibility:purpose_job_or_education",
    type: "ELIGIBILITY",
    name: "The certificate must be for a job or a course",
    description:
      "The Unreserved Economically Weaker Sections certificate is the job and education one. For any other purpose, ask for the Economically Backward certificate instead.",
    jurisdictionId: "IN-GJ",
    metadata: { rule: { field: "certificate_purpose", operator: "IN", value: ["job", "education"] } },
    sources: [
      {
        sourceId: "src:dwarka-certificates",
        evidence: E_EWS_PURPOSE,
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:purpose_other_than_job_or_education",
    type: "ELIGIBILITY",
    name: "The certificate must be for something other than a job or a course",
    description:
      "The Economically Backward certificate is issued for purposes other than a job or education. If it is for a job or a course, the Unreserved Economically Weaker Sections certificate is the one you want.",
    jurisdictionId: "IN-GJ",
    metadata: { rule: { field: "certificate_purpose", operator: "NOT_IN", value: ["job", "education"] } },
    sources: [
      {
        sourceId: "src:dwarka-certificates",
        evidence: E_EWS_PURPOSE,
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- document groups -----------------------------------------------------
  // Four named proofs on the Morbi caste page, two on the Mahesana income page.
  // Every one of them is an "any one of" and modelling them as flat mandatory
  // lists would send someone after ten documents for a job one does.
  {
    id: "document_group:resident_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of where you live",
    officialName: "Resident Proof",
    description: "Any one of the ten the district lists. A water bill only counts if it is recent.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:morbi-caste", E_RESIDENT_PROOF, 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document_group:identity_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of who you are",
    officialName: "Identity Proof",
    description: "Any one of the seven the district lists.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:morbi-caste", E_IDENTITY_PROOF, 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document_group:caste_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of your caste",
    officialName: "Caste Proof",
    description:
      "Either your own school leaving certificate, or a family member's caste certificate backed up by a Pedhinamu or a ration card.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:morbi-caste", E_CASTE_PROOF, 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document_group:family_caste_evidence",
    type: "DOCUMENT_GROUP",
    name: "A family member's caste certificate, with a Pedhinamu or a ration card",
    description:
      "The second way to prove caste. The family member's certificate on its own is not enough, it has to come with something that shows they are your family.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:morbi-caste", E_CASTE_PROOF, 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document_group:pedhinamu_or_ration_card",
    type: "DOCUMENT_GROUP",
    name: "A Pedhinamu or a ration card",
    description: "Either one is accepted alongside the family member's caste certificate.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:morbi-caste", E_CASTE_PROOF, 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document_group:relationship_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of how you are related",
    officialName: "Relationship Proof",
    description: "Any one of three, and one of them is an affidavit you can swear yourself.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:morbi-caste", E_RELATIONSHIP_PROOF, 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document_group:income_residence_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of residence for the income certificate",
    officialName: "Proof of residence (telephone bill / light bill / municipal tax bill, whatever one)",
    description: "The page says whichever one you have, so bring whichever one you have.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:mahesana-income", "Proof of residence (telephone bill / light bill / municipal tax bill, whatever one)", 0.9),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document_group:income_age_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of age for the income certificate",
    officialName: "Example of age (example of a school living certificate / civil surgeon municipality or Talati)",
    jurisdictionId: "IN-GJ",
    sources: cite(
      "src:mahesana-income",
      "Example of age (example of a school living certificate / civil surgeon municipality or Talati)",
      0.88,
    ),
    lastVerifiedAt: RETRIEVED,
  },

  // -- documents -----------------------------------------------------------
  // document:passport, document:school_certificate, document:birth_certificate
  // and document:civil_surgeon_age_certificate are not redeclared here. They
  // already exist in the driving licence journey, they are the same pieces of
  // paper, and a citizen who tells us they hold one should not be asked for it
  // twice under a second id.
  {
    id: "document:ration_card",
    type: "DOCUMENT",
    name: "Ration card",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: [
      { sourceId: "src:morbi-caste", evidence: "Ration Card", confidence: 0.9, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:mahesana-income",
        evidence: "Copy of ration card",
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:electricity_bill",
    type: "DOCUMENT",
    name: "Electricity bill",
    officialName: "True Copy of Electricity Bill",
    aliases: ["light bill", "electricity bill", "power bill"],
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:morbi-caste",
        evidence: "True Copy of Electricity Bill.",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:mahesana-income",
        evidence: "Proof of residence (telephone bill / light bill / municipal tax bill, whatever one)",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:telephone_bill",
    type: "DOCUMENT",
    name: "Telephone bill",
    officialName: "True Copy of Telephone Bill",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:morbi-caste",
        evidence: "True Copy of Telephone Bill.",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:mahesana-income",
        evidence: "Proof of residence (telephone bill / light bill / municipal tax bill, whatever one)",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:municipal_tax_bill",
    type: "DOCUMENT",
    name: "Municipal tax bill",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite(
      "src:mahesana-income",
      "Proof of residence (telephone bill / light bill / municipal tax bill, whatever one)",
      0.9,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:water_bill",
    type: "DOCUMENT",
    name: "Water bill",
    officialName: "Water bill (not older than 3 months)",
    description: "The only document on the list with a shelf life. Anything older than three months is not accepted.",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "Water bill (not older than 3 months)", 0.92),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:election_card",
    type: "DOCUMENT",
    name: "Election card",
    officialName: "True Copy of Election Card",
    aliases: ["voter card", "epic", "election card", "voter id card"],
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "True Copy of Election Card.", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:pan_card",
    type: "DOCUMENT",
    name: "PAN card",
    officialName: "True Copy Income Tax PAN Card",
    aliases: ["pan", "pan card", "income tax pan card"],
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "True Copy Income Tax PAN Card.", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:bank_passbook",
    type: "DOCUMENT",
    name: "Bank passbook first page, or a cancelled cheque",
    officialName: "First Page Of Bank PassBook/Cancelled Cheque",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "First Page Of Bank PassBook/Cancelled Cheque", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:post_office_passbook",
    type: "DOCUMENT",
    name: "Post office account statement or passbook",
    officialName: "Post Office Account Statement/Passbook",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "Post Office Account Statement/Passbook", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:driving_licence",
    type: "DOCUMENT",
    name: "Driving licence",
    officialName: "Driving License",
    description: "Counts here as a document you already hold, both as residence proof and as identity proof.",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "Driving License", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:government_photo_id",
    type: "DOCUMENT",
    name: "Government or PSU photo identity card",
    officialName: "Government Photo ID cards/ service photo identity card issued by PSU",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "Government Photo ID cards/ service photo identity card issued by PSU", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:government_document_with_photo",
    type: "DOCUMENT",
    name: "Any government document with your photo on it",
    officialName: "Any Government Document having citizen photo",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "Any Government Document having citizen photo", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:educational_institution_photo_id",
    type: "DOCUMENT",
    name: "Photo identity card from a recognised educational institution",
    officialName: "Photo ID issued by Recognized Educational Institution",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "Photo ID issued by Recognized Educational Institution", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:family_member_caste_certificate",
    type: "DOCUMENT",
    name: "A family member's caste certificate",
    officialName: "Certificate of a caste of the family member",
    description:
      "Not your own. A parent's or a sibling's, which is why it has to come with a Pedhinamu or a ration card showing they are your family.",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: cite(
      "src:morbi-caste",
      "Certificate of a caste of the family member with Pedhinamu (Family Tree issued by Talati) or Ration Card",
      0.9,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:pedhinamu",
    type: "DOCUMENT",
    name: "Pedhinamu, the family tree issued by the Talati",
    officialName: "Pedhinamu (Family Tree issued by Talati)",
    aliases: ["pedhinamu", "family tree"],
    description: "The Talati issues it, so allow time. It is not something you can write out yourself.",
    jurisdictionId: "IN-GJ",
    metadata: { blockedBy: "GOVERNMENT" },
    sources: cite(
      "src:morbi-caste",
      "Certificate of a caste of the family member with Pedhinamu (Family Tree issued by Talati) or Ration Card",
      0.9,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:relatives_school_leaving_certificate",
    type: "DOCUMENT",
    name: "School leaving certificate of your father, uncle or aunt",
    officialName: "True Copy of School Leaving Certificate of Father/Uncle/Aunts",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-caste", "True Copy of School Leaving Certificate of Father/Uncle/Aunts", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:affidavit",
    type: "DOCUMENT",
    name: "Affidavit",
    description:
      "Sworn and attached to the application. The pages do not say before whom it must be sworn, so ask at the counter before you pay a notary.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:morbi-caste",
        evidence: "An affidavit attached with the application.",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      { sourceId: "src:morbi-domicile", evidence: "Affidavit", confidence: 0.88, verificationStatus: "VERIFIED" },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:affidavit_appendix_4_48",
    type: "DOCUMENT",
    name: "Affidavit in Appendix 4/48",
    officialName: "Affidavit (as per Appendix 4/48)",
    description: "The income certificate wants the affidavit in a specific format. Ask for Appendix 4/48 by name.",
    jurisdictionId: "IN-GJ",
    metadata: { formNumber: "Appendix 4/48" },
    sources: cite("src:mahesana-income", "Affidavit (as per Appendix 4/48)", 0.88),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:panchnamu",
    type: "DOCUMENT",
    name: "Panchnamu",
    aliases: ["panchnamu", "panchanamu"],
    description:
      "Listed by Morbi for the domicile certificate and by Mahesana for the income certificate. Neither page says who draws it up, so that is a question for the counter.",
    jurisdictionId: "IN-GJ",
    sources: [
      { sourceId: "src:morbi-domicile", evidence: "Panchnamu", confidence: 0.94, verificationStatus: "VERIFIED" },
      { sourceId: "src:mahesana-income", evidence: E_INCOME_EVIDENCE, confidence: 0.9, verificationStatus: "VERIFIED" },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:talati_certificate",
    type: "DOCUMENT",
    name: "Certificate from the Talati",
    officialName: "Certificate of Talati",
    description: "The Talati issues it, which means this one does not move until a government officer moves it.",
    jurisdictionId: "IN-GJ",
    metadata: { blockedBy: "GOVERNMENT" },
    sources: cite("src:morbi-domicile", "Certificate of Talati.", 0.92),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:applicant_answer",
    type: "DOCUMENT",
    name: "Applicant Answer",
    officialName: "Applicant Answer",
    description:
      "Listed by Morbi among the eleven proofs, with no further explanation on the page. It is passed through here exactly as printed rather than guessed at. Ask the Jan Seva Kendra what they want.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:morbi-domicile", E_DOMICILE_PROOFS, 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:parents_job_or_business_proof",
    type: "DOCUMENT",
    name: "Proof of your parent's job or business",
    officialName: "Proof of Parent’s Job/Business",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-domicile", "Proof of Parent’s Job/Business", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:police_noc",
    type: "DOCUMENT",
    name: "No Objection Certificate from the police station",
    officialName: "No Objection Certificate of Police Station",
    description:
      "A police station has to issue this. Reapplying for the domicile certificate does nothing while this is outstanding, the police station is the only thing that moves it.",
    jurisdictionId: "IN-GJ",
    metadata: { blockedBy: "GOVERNMENT" },
    sources: cite("src:morbi-domicile", "No Objection Certificate of Police Station", 0.92),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:character_certificate",
    type: "DOCUMENT",
    name: "Character certificate",
    officialName: "Character Certificate",
    description: "Listed among the eleven proofs. The page does not say who issues it.",
    jurisdictionId: "IN-GJ",
    sources: cite("src:morbi-domicile", "Character Certificate", 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:ten_year_residence_proof",
    type: "DOCUMENT",
    name: "Proof of residence covering the last 10 years",
    officialName: "Last 10 years residence proof",
    description:
      "Ten years, not the last bill. This is the item that turns the domicile certificate from an afternoon into a project, so start with it.",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: cite("src:morbi-domicile", "Last 10 years residence proof", 0.92),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:written_application",
    type: "DOCUMENT",
    name: "Your written application",
    officialName: "Applicant’s application",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: cite("src:mahesana-income", E_INCOME_EVIDENCE, 0.9),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:income_proof",
    type: "DOCUMENT",
    name: "Income proof",
    officialName: "Income Proof",
    description:
      "The Mahesana page lists it by name and does not say what counts as one, and the state portal that would say could not be read. Ask at the counter.",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: cite("src:mahesana-income", E_INCOME_EVIDENCE, 0.9),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:death_evidence",
    type: "DOCUMENT",
    name: "Death Examples",
    officialName: "Death Examples",
    description:
      "Item 5 of the Mahesana list, printed exactly as the page prints it. The page is a machine translation and says nothing more, and the service it belongs to is the combined widow and income certificate, so this is very likely the widow half. It is passed through untouched rather than guessed at.",
    jurisdictionId: "IN-GJ-MEHSANA",
    sources: cite("src:mahesana-income", E_INCOME_EVIDENCE, 0.9),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:local_authority_age_certificate",
    type: "DOCUMENT",
    name: "Age certificate from the municipality or the Talati",
    officialName: "civil surgeon municipality or Talati",
    description:
      "The Mahesana page runs the issuers together in one line, so which of them signs is a question for the counter.",
    jurisdictionId: "IN-GJ",
    sources: cite(
      "src:mahesana-income",
      "Example of age (example of a school living certificate / civil surgeon municipality or Talati)",
      0.88,
    ),
    lastVerifiedAt: RETRIEVED,
  },

  // -- actions and verifications -------------------------------------------
  {
    id: "action:income_certificate_form_36",
    type: "ACTION",
    name: "Fill in the income certificate form, Form No. 36",
    jurisdictionId: "IN-GJ",
    metadata: {
      formNumber: "Form No. 36",
      whatToDo:
        "Surat district publishes the income certificate form as Form No. 36. Fill it in before you go to the counter.",
      expectedOutput: "A completed application form to hand in with the evidence.",
    },
    sources: cite("src:surat-form-36", "Income Certificate : Form No. 36", 0.9),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "verification:talati_hearing",
    type: "VERIFICATION",
    name: "The Talati hears you in person and reports",
    officialName: "Responding to the applicant’s Talati face-to-face",
    description:
      "Listed as item 2 of the evidence, but it is not a document you can bring. The Talati has to see you and put in a report, and nothing in the file moves until that happens.",
    jurisdictionId: "IN-GJ",
    metadata: {
      blockedBy: "GOVERNMENT",
      whyRequired: "The income certificate is granted on the Talati's report, not on your word.",
      whatToDo:
        "Ask the Jan Seva Kendra when the Talati will see you, and go. Filing the application a second time does not move this.",
      expectedOutput: "The Talati's report on your file.",
    },
    sources: cite("src:mahesana-income", "Responding to the applicant’s Talati face-to-face", 0.85),
    lastVerifiedAt: RETRIEVED,
  },

  // -- channels, offices, helplines ----------------------------------------
  {
    id: "portal:digital_gujarat",
    type: "PORTAL",
    name: "Digital Gujarat citizen services",
    officialName: "Digital Gujarat",
    aliases: ["digital gujarat", "digitalgujarat"],
    description:
      "The common service portal for all of these certificates. Its own required document lists could not be read for this graph, so what you see here is what the district offices publish, and the portal may ask for more.",
    jurisdictionId: "IN-GJ",
    metadata: {
      url: "https://www.digitalgujarat.gov.in/Citizen/CitizenService.aspx",
      channelType: "WEB",
    },
    sources: [
      {
        sourceId: "src:ahd-income",
        evidence: "Visit: https://www.digitalgujarat.gov.in/Citizen/CitizenService.aspx",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:surendranagar-caste",
        evidence: E_ONLINE_AND_OFFLINE,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      { sourceId: "src:dwarka-certificates", evidence: E_ATVT, confidence: 0.93, verificationStatus: "VERIFIED" },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "office:mamlatdar_jan_seva_kendra",
    type: "OFFICE",
    name: "Your taluka Mamlatdar office, Jan Seva Kendra",
    officialName: "Respective Taluka Mamlatdar office",
    aliases: ["jan seva kendra", "janseva kendra", "atvt", "mamlatdar office"],
    description:
      "A single window counter, one per taluka, and the place all three certificates are actually handed over. No official page publishes counter hours for any of them, so none are shown here.",
    jurisdictionId: "IN-GJ",
    metadata: { officeType: "Mamlatdar office, Jan Seva Kendra", channelType: "PHYSICAL_OFFICE" },
    sources: [
      {
        sourceId: "src:dwarka-certificates",
        evidence: "Location : respective Mamlatdar / TDO Office | City : All Taluka",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:morbi-caste",
        evidence: "Location : Respective Taluka Mamlatdar office | City : Each Talukas",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:morbi-domicile",
        evidence: "Location : Respective Taluka Mamlatdar office | City : All Talukas",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:vadodara-residence",
        evidence: "JanSeva Kendra : It is Single window system for many services. This is one of them.",
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
      { sourceId: "src:dwarka-certificates", evidence: E_ATVT, confidence: 0.93, verificationStatus: "VERIFIED" },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "office:mamlatdar_ahmedabad",
    type: "OFFICE",
    name: "Mamlatdar Office, Jan Seva Kendra, Ahmedabad",
    officialName: "Mamlatdar Office, Jan Seva Kendra",
    // Two Ahmedabad district pages print two different PIN codes for the same
    // office name. Neither is corrected here. The address below is the one the
    // income certificate page prints, which is also the one the Non-Creamy
    // Layer page prints, and the SEBC page's figure is kept in the description
    // and marked CONFLICTING on its source below.
    description:
      "Two Ahmedabad district pages print two different PIN codes for this same office name: 380027 on the income certificate and Non-Creamy Layer pages, 380030 on the SEBC page. Both are published today and neither page corrects the other, so ring 07927551681 before you post anything.",
    jurisdictionId: "IN-GJ-AHMEDABAD",
    metadata: {
      officeType: "Mamlatdar office, Jan Seva Kendra",
      channelType: "PHYSICAL_OFFICE",
      address: "Mamlatdar Office, Jan Seva Kendra, Ahmedabad - 380027",
      phoneNumbers: ["07927551681", "18002335500"],
    },
    sources: [
      {
        sourceId: "src:ahd-income",
        evidence: "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380027",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:ahd-ncl",
        evidence: "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380027",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:ahd-sebc",
        evidence: "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380030",
        confidence: 0.9,
        verificationStatus: "CONFLICTING",
      },
      {
        sourceId: "src:ahd-income",
        evidence: "Phone : 07927551681 | Mobile : 18002335500",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "helpline:digital_gujarat",
    type: "HELPLINE",
    name: "Digital Gujarat Help Desk",
    description: "The number to call when the online application itself is the problem.",
    jurisdictionId: "IN-GJ",
    metadata: { channelType: "PHONE", phoneNumbers: ["18002335500"] },
    sources: [
      {
        sourceId: "src:banaskantha-certificates",
        evidence: "For any query regarding the online application you can contact to Digital Gujarat Help Desk on 18002335500.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:ahd-income",
        evidence: "Phone : 07927551681 | Mobile : 18002335500",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "helpline:mamlatdar_mahesana",
    type: "HELPLINE",
    name: "Mamlatdar office, Mahesana",
    description: "The Mahesana line and mailbox for the widow and income certificate service.",
    jurisdictionId: "IN-GJ-MEHSANA",
    metadata: {
      channelType: "PHONE",
      phoneNumbers: ["02762236386"],
      emails: ["mam-mehsana@gujarat.gov.in"],
    },
    sources: [
      {
        sourceId: "src:mahesana-income",
        evidence: "Phone : 02762236386 | Email : mam-mehsana[at]gujarat[dot]gov[dot]in",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "department:mamlatdar_or_tdo",
    type: "DEPARTMENT",
    name: "Mamlatdar or Taluka Development Officer",
    description:
      "Who grants these certificates. District pages word it three different ways, 'Mamlatdar Office', 'Mamlatdar / Taluka Development Officer' and 'respective Mamlatdar / TDO Office', and none of them draws a line between the two posts, so neither does this.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:mahesana-income",
        evidence: "According to Mamlatdar / Taluka Development Officer.",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:dwarka-certificates",
        evidence: "Location : respective Mamlatdar / TDO Office | City : All Taluka",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
];

export const requirementGroups: RequirementGroup[] = [
  {
    id: "rg:resident_proof",
    ownerNodeId: "document_group:resident_proof",
    mode: "ANY_OF",
    jurisdictionId: "IN-GJ",
    members: [
      { nodeId: "document:ration_card" },
      { nodeId: "document:electricity_bill", note: "The light bill counts." },
      { nodeId: "document:telephone_bill" },
      { nodeId: "document:election_card" },
      { nodeId: "document:passport" },
      { nodeId: "document:bank_passbook", note: "The first page, or a cancelled cheque." },
      { nodeId: "document:post_office_passbook" },
      { nodeId: "document:driving_licence" },
      { nodeId: "document:government_photo_id" },
      {
        nodeId: "document:water_bill",
        // The one conditional alternative on the list. Modelled as a condition
        // rather than a footnote so that a three month old water bill is ruled
        // out before someone queues with it.
        condition: { field: "water_bill_age_months", operator: "LTE", value: 3 },
        note: "Only if it is not older than 3 months.",
      },
    ],
    sources: cite("src:morbi-caste", E_RESIDENT_PROOF, 0.94),
  },
  {
    id: "rg:identity_proof",
    ownerNodeId: "document_group:identity_proof",
    mode: "ANY_OF",
    jurisdictionId: "IN-GJ",
    members: [
      { nodeId: "document:election_card" },
      { nodeId: "document:pan_card" },
      { nodeId: "document:passport" },
      { nodeId: "document:driving_licence" },
      { nodeId: "document:government_photo_id" },
      { nodeId: "document:government_document_with_photo" },
      { nodeId: "document:educational_institution_photo_id" },
    ],
    sources: cite("src:morbi-caste", E_IDENTITY_PROOF, 0.94),
  },
  {
    id: "rg:caste_proof",
    ownerNodeId: "document_group:caste_proof",
    mode: "ANY_OF",
    jurisdictionId: "IN-GJ",
    members: [
      { nodeId: "document:school_certificate", note: "Your own school leaving certificate." },
      {
        nodeId: "document_group:family_caste_evidence",
        note: "A family member's caste certificate, backed up by a Pedhinamu or a ration card.",
      },
    ],
    sources: cite("src:morbi-caste", E_CASTE_PROOF, 0.94),
  },
  {
    // The second caste proof is a bundle, not a single document. Modelling it
    // flat would let someone turn up with a cousin's certificate and nothing
    // linking them to it.
    id: "rg:family_caste_evidence",
    ownerNodeId: "document_group:family_caste_evidence",
    mode: "ALL_OF",
    jurisdictionId: "IN-GJ",
    members: [
      { nodeId: "document:family_member_caste_certificate" },
      { nodeId: "document_group:pedhinamu_or_ration_card" },
    ],
    sources: cite("src:morbi-caste", E_CASTE_PROOF, 0.94),
  },
  {
    id: "rg:pedhinamu_or_ration_card",
    ownerNodeId: "document_group:pedhinamu_or_ration_card",
    mode: "ANY_OF",
    jurisdictionId: "IN-GJ",
    members: [
      { nodeId: "document:pedhinamu", note: "The Talati issues it, so it takes time." },
      { nodeId: "document:ration_card", note: "Faster, if your name is on it." },
    ],
    sources: cite("src:morbi-caste", E_CASTE_PROOF, 0.94),
  },
  {
    id: "rg:relationship_proof",
    ownerNodeId: "document_group:relationship_proof",
    mode: "ANY_OF",
    jurisdictionId: "IN-GJ",
    members: [
      { nodeId: "document:school_certificate", note: "Your own school leaving certificate." },
      { nodeId: "document:affidavit", note: "Sworn and attached to the application." },
      { nodeId: "document:relatives_school_leaving_certificate" },
    ],
    sources: cite("src:morbi-caste", E_RELATIONSHIP_PROOF, 0.94),
  },
  {
    id: "rg:income_residence_proof",
    ownerNodeId: "document_group:income_residence_proof",
    mode: "ANY_OF",
    jurisdictionId: "IN-GJ",
    members: [
      { nodeId: "document:telephone_bill" },
      { nodeId: "document:electricity_bill", note: "The page calls it the light bill." },
      { nodeId: "document:municipal_tax_bill" },
    ],
    sources: cite(
      "src:mahesana-income",
      "Proof of residence (telephone bill / light bill / municipal tax bill, whatever one)",
      0.9,
    ),
  },
  {
    id: "rg:income_age_proof",
    ownerNodeId: "document_group:income_age_proof",
    mode: "ANY_OF",
    jurisdictionId: "IN-GJ",
    members: [
      { nodeId: "document:school_certificate", note: "The page calls it a school living certificate." },
      { nodeId: "document:civil_surgeon_age_certificate" },
      { nodeId: "document:local_authority_age_certificate" },
    ],
    sources: cite(
      "src:mahesana-income",
      "Example of age (example of a school living certificate / civil surgeon municipality or Talati)",
      0.88,
    ),
  },
];

/** One row of the Mahesana evidence list, widened to the state and labelled as such. */
const mahesanaRequires = (slug: string, to: string, note?: string): GraphEdge => ({
  id: `e:income_requires_${slug}`,
  from: "service:income_certificate",
  to,
  type: "REQUIRES",
  jurisdictionId: "IN-GJ",
  note: note ? `${note} ${MAHESANA_LIST_NOTE}` : MAHESANA_LIST_NOTE,
  verificationStatus: "NORMALIZED",
  sources: derived("src:mahesana-income", E_INCOME_EVIDENCE, 0.75),
});

/** One row of the Morbi domicile list. Same treatment, different district. */
const morbiDomicileRequires = (slug: string, to: string, evidence: string, note?: string): GraphEdge => ({
  id: `e:domicile_requires_${slug}`,
  from: "service:domicile_certificate",
  to,
  type: "REQUIRES",
  jurisdictionId: "IN-GJ",
  note: note ? `${note} ${MORBI_LIST_NOTE}` : MORBI_LIST_NOTE,
  verificationStatus: "NORMALIZED",
  sources: derived("src:morbi-domicile", evidence, 0.8),
});

export const edges: GraphEdge[] = [
  // -- income certificate --------------------------------------------------
  {
    id: "e:income_produces_certificate",
    from: "service:income_certificate",
    to: "document:income_certificate",
    type: "PRODUCES",
    jurisdictionId: "IN-GJ",
    note: "Once it is issued it counts for three financial years, so keep it.",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-mysy", E_INCOME_VALIDITY, 0.85),
  },
  {
    id: "e:income_requires_form_36",
    from: "service:income_certificate",
    to: "action:income_certificate_form_36",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "Surat district publishes Form No. 36 as the income certificate form. Other districts do not print a form number, so check what your counter hands you.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:surat-form-36", "Income Certificate : Form No. 36", 0.8),
  },
  mahesanaRequires("written_application", "document:written_application"),
  mahesanaRequires(
    "talati_hearing",
    "verification:talati_hearing",
    "The Talati has to see you in person and report on your file.",
  ),
  mahesanaRequires("panchnamu", "document:panchnamu"),
  mahesanaRequires("residence_proof", "document_group:income_residence_proof", "Any one of the three bills."),
  mahesanaRequires("age_proof", "document_group:income_age_proof", "Any one of the three."),
  mahesanaRequires("income_proof", "document:income_proof"),
  mahesanaRequires("affidavit_appendix_4_48", "document:affidavit_appendix_4_48"),
  mahesanaRequires("ration_card", "document:ration_card"),
  {
    // Scoped to Mahesana on purpose. The item belongs to the widow half of the
    // combined service and the page never explains it, so it is not widened to
    // the state the way the other eight items are.
    id: "e:income_requires_death_evidence",
    from: "service:income_certificate",
    to: "document:death_evidence",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ-MEHSANA",
    note: "Item 5 of the Mahesana list for the combined widow and income certificate. The page does not say what it is and this graph does not guess. Ask the Jan Seva Kendra.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:mahesana-income", E_INCOME_EVIDENCE, 0.7),
  },
  {
    id: "e:income_apply_at_digital_gujarat",
    from: "service:income_certificate",
    to: "portal:digital_gujarat",
    type: "APPLY_AT",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:ahd-income", "Visit: https://www.digitalgujarat.gov.in/Citizen/CitizenService.aspx", 0.95),
  },
  {
    id: "e:income_visit_jan_seva_kendra",
    from: "service:income_certificate",
    to: "office:mamlatdar_jan_seva_kendra",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ",
    note: "The same counter takes the application and hands the certificate back.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:dwarka-certificates",
        evidence: E_ATVT,
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:ahd-income",
        evidence: "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380027",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:income_visit_mamlatdar_ahmedabad",
    from: "service:income_certificate",
    to: "office:mamlatdar_ahmedabad",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ-AHMEDABAD",
    note: "In Ahmedabad district, this is the office the income certificate page names.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:ahd-income",
      "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380027",
      0.92,
    ),
  },
  {
    id: "e:income_handled_by_mamlatdar",
    from: "service:income_certificate",
    to: "department:mamlatdar_or_tdo",
    type: "HANDLED_BY",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:mahesana-income", "According to Mamlatdar / Taluka Development Officer.", 0.9),
  },
  {
    id: "e:income_call_digital_gujarat",
    from: "service:income_certificate",
    to: "helpline:digital_gujarat",
    type: "CALL_IF",
    jurisdictionId: "IN-GJ",
    note: "Call this one when the online application is the thing that is stuck.",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:banaskantha-certificates",
      "For any query regarding the online application you can contact to Digital Gujarat Help Desk on 18002335500.",
      0.85,
    ),
  },
  {
    id: "e:income_call_mamlatdar_mahesana",
    from: "service:income_certificate",
    to: "helpline:mamlatdar_mahesana",
    type: "CALL_IF",
    jurisdictionId: "IN-GJ-MEHSANA",
    verificationStatus: "VERIFIED",
    sources: cite("src:mahesana-income", "Phone : 02762236386 | Email : mam-mehsana[at]gujarat[dot]gov[dot]in", 0.9),
  },

  // -- caste certificate ---------------------------------------------------
  {
    id: "e:caste_produces_certificate",
    from: "service:caste_certificate",
    to: "document:caste_certificate",
    type: "PRODUCES",
    jurisdictionId: "IN-GJ",
    note: "Which of the three forms you get back depends on your category.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:surat-caste", E_CASTE_VARIANTS, 0.8),
  },
  {
    id: "e:caste_requires_resident_proof",
    from: "service:caste_certificate",
    to: "document_group:resident_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: `Any one of the ten. ${MORBI_LIST_NOTE}`,
    verificationStatus: "VERIFIED",
    sources: cite("src:morbi-caste", E_RESIDENT_PROOF, 0.94),
  },
  {
    id: "e:caste_requires_identity_proof",
    from: "service:caste_certificate",
    to: "document_group:identity_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: `Any one of the seven. ${MORBI_LIST_NOTE}`,
    verificationStatus: "VERIFIED",
    sources: cite("src:morbi-caste", E_IDENTITY_PROOF, 0.94),
  },
  {
    id: "e:caste_requires_caste_proof",
    from: "service:caste_certificate",
    to: "document_group:caste_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: `Either your own school leaving certificate or a family member's caste certificate with a Pedhinamu or ration card. ${MORBI_LIST_NOTE}`,
    verificationStatus: "VERIFIED",
    sources: cite("src:morbi-caste", E_CASTE_PROOF, 0.94),
  },
  {
    id: "e:caste_requires_relationship_proof",
    from: "service:caste_certificate",
    to: "document_group:relationship_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: `Any one of the three. ${MORBI_LIST_NOTE}`,
    verificationStatus: "VERIFIED",
    sources: cite("src:morbi-caste", E_RELATIONSHIP_PROOF, 0.94),
  },
  {
    id: "e:caste_apply_at_digital_gujarat",
    from: "service:caste_certificate",
    to: "portal:digital_gujarat",
    type: "APPLY_AT",
    jurisdictionId: "IN-GJ",
    note: "Online or over the counter, both are open.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:morbi-caste",
        evidence: "Visit: https://www.digitalgujarat.gov.in/Citizen/ServiceDescription.aspx",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:surendranagar-caste",
        evidence: E_ONLINE_AND_OFFLINE,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:caste_visit_jan_seva_kendra",
    from: "service:caste_certificate",
    to: "office:mamlatdar_jan_seva_kendra",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:morbi-caste",
        evidence: "Location : Respective Taluka Mamlatdar office | City : Each Talukas",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:surendranagar-caste",
        evidence: E_ONLINE_AND_OFFLINE,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:caste_handled_by_mamlatdar",
    from: "service:caste_certificate",
    to: "department:mamlatdar_or_tdo",
    type: "HANDLED_BY",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:dwarka-certificates", "Location : respective Mamlatdar / TDO Office | City : All Taluka", 0.9),
  },
  {
    id: "e:caste_call_digital_gujarat",
    from: "service:caste_certificate",
    to: "helpline:digital_gujarat",
    type: "CALL_IF",
    jurisdictionId: "IN-GJ",
    note: "Call this one when the online application is the thing that is stuck.",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:banaskantha-certificates",
      "For any query regarding the online application you can contact to Digital Gujarat Help Desk on 18002335500.",
      0.85,
    ),
  },

  // -- domicile certificate ------------------------------------------------
  {
    id: "e:domicile_produces_certificate",
    from: "service:domicile_certificate",
    to: "document:domicile_certificate",
    type: "PRODUCES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "NORMALIZED",
    sources: derived("src:morbi-certificates", E_MORBI_CATEGORY, 0.8),
  },
  morbiDomicileRequires("panchnamu", "document:panchnamu", "Panchnamu"),
  morbiDomicileRequires(
    "talati_certificate",
    "document:talati_certificate",
    "Certificate of Talati.",
    "The Talati issues this, so start it early.",
  ),
  morbiDomicileRequires("applicant_answer", "document:applicant_answer", E_DOMICILE_PROOFS),
  morbiDomicileRequires(
    "birth_certificate",
    "document:birth_certificate",
    "Domicile by Birth (Birth Certificate)",
    "This is how you show domicile by birth.",
  ),
  morbiDomicileRequires(
    "parents_job_proof",
    "document:parents_job_or_business_proof",
    "Proof of Parent’s Job/Business",
  ),
  morbiDomicileRequires(
    "police_noc",
    "document:police_noc",
    "No Objection Certificate of Police Station",
    "A police station has to issue this one. Nothing you do at the Jan Seva Kendra will speed it up.",
  ),
  morbiDomicileRequires("character_certificate", "document:character_certificate", "Character Certificate"),
  morbiDomicileRequires("affidavit", "document:affidavit", "Affidavit"),
  morbiDomicileRequires(
    "ten_year_residence_proof",
    "document:ten_year_residence_proof",
    "Last 10 years residence proof",
    "Ten years of it, not the latest bill. Start here, it is the long pole.",
  ),
  {
    // The domicile page names "Identity Proof" and "Resident Proof" but does
    // not say what counts. The list shown is the one the same district site
    // publishes for the caste certificate, which is our join and not theirs.
    id: "e:domicile_requires_identity_proof",
    from: "service:domicile_certificate",
    to: "document_group:identity_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "The domicile page asks for identity proof without saying what counts. The list of seven shown here is the one the same district publishes for the caste certificate, so treat it as a guide and confirm at the counter.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:morbi-domicile", E_DOMICILE_PROOFS, 0.75),
  },
  {
    id: "e:domicile_requires_resident_proof",
    from: "service:domicile_certificate",
    to: "document_group:resident_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "The domicile page asks for resident proof without saying what counts. The list of ten shown here is the one the same district publishes for the caste certificate, so treat it as a guide and confirm at the counter.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:morbi-domicile", E_DOMICILE_PROOFS, 0.75),
  },
  {
    id: "e:domicile_visit_jan_seva_kendra",
    from: "service:domicile_certificate",
    to: "office:mamlatdar_jan_seva_kendra",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ",
    note: "A single window, so everything goes in at one counter.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:morbi-domicile",
        evidence: "Location : Respective Taluka Mamlatdar office | City : All Talukas",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:vadodara-residence",
        evidence: "JanSeva Kendra : It is Single window system for many services. This is one of them.",
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:domicile_apply_at_digital_gujarat",
    from: "service:domicile_certificate",
    to: "portal:digital_gujarat",
    type: "APPLY_AT",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:dwarka-certificates", E_ATVT, 0.93),
  },
  {
    id: "e:domicile_handled_by_mamlatdar",
    from: "service:domicile_certificate",
    to: "department:mamlatdar_or_tdo",
    type: "HANDLED_BY",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:dwarka-certificates", "Location : respective Mamlatdar / TDO Office | City : All Taluka", 0.9),
  },
  {
    id: "e:domicile_call_digital_gujarat",
    from: "service:domicile_certificate",
    to: "helpline:digital_gujarat",
    type: "CALL_IF",
    jurisdictionId: "IN-GJ",
    note: "Call this one when the online application is the thing that is stuck.",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:banaskantha-certificates",
      "For any query regarding the online application you can contact to Digital Gujarat Help Desk on 18002335500.",
      0.85,
    ),
  },

  // -- the rest of the family ----------------------------------------------
  // Pointed inward at service:caste_certificate. An edge the other way would
  // put three certificates you did not ask for into your path.
  {
    id: "e:sebc_alternative_to_caste",
    from: "service:sebc_certificate",
    to: "service:caste_certificate",
    type: "ALTERNATIVE_TO",
    jurisdictionId: "IN-GJ",
    note: "SEBC is one of the three certificates Gujarat issues under the caste heading.",
    verificationStatus: "VERIFIED",
    sources: cite("src:surat-caste", E_CASTE_VARIANTS, 0.9),
  },
  {
    id: "e:sc_st_alternative_to_caste",
    from: "service:sc_st_caste_certificate",
    to: "service:caste_certificate",
    type: "ALTERNATIVE_TO",
    jurisdictionId: "IN-GJ",
    note: "SC/ST is one of the three certificates Gujarat issues under the caste heading.",
    verificationStatus: "VERIFIED",
    sources: cite("src:surat-caste", E_CASTE_VARIANTS, 0.9),
  },
  {
    id: "e:ncl_gujarat_alternative_to_caste",
    from: "service:non_creamy_layer_certificate_gujarat",
    to: "service:caste_certificate",
    type: "ALTERNATIVE_TO",
    jurisdictionId: "IN-GJ",
    note: "Non-Creamy Layer for Gujarat Government is the third of the three.",
    verificationStatus: "VERIFIED",
    sources: cite("src:surat-caste", E_CASTE_VARIANTS, 0.9),
  },
  {
    id: "e:ncl_central_alternative_to_ncl_gujarat",
    from: "service:non_creamy_layer_certificate_central",
    to: "service:non_creamy_layer_certificate_gujarat",
    type: "ALTERNATIVE_TO",
    jurisdictionId: "IN-GJ",
    note: "There are two Non-Creamy Layer certificates in Gujarat, one for state government purposes and one for central. Check which one the application in front of you wants before you queue.",
    verificationStatus: "VERIFIED",
    sources: cite("src:dwarka-certificates", E_NCL_VARIANTS, 0.92),
  },
  {
    id: "e:sebc_visit_mamlatdar_ahmedabad",
    from: "service:sebc_certificate",
    to: "office:mamlatdar_ahmedabad",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ-AHMEDABAD",
    note: "The SEBC page prints PIN 380030 for this office where the income certificate page prints 380027. Both are live, so ring first.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:ahd-sebc",
      "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380030",
      0.9,
    ),
  },
  {
    id: "e:ncl_gujarat_visit_mamlatdar_ahmedabad",
    from: "service:non_creamy_layer_certificate_gujarat",
    to: "office:mamlatdar_ahmedabad",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ-AHMEDABAD",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:ahd-ncl",
      "Location : Mamlatdar Office, Jan Seva Kendra | City : Ahmedabad | PIN Code : 380027",
      0.9,
    ),
  },
  {
    id: "e:ews_requires_job_or_education_purpose",
    from: "service:ews_certificate",
    to: "eligibility:purpose_job_or_education",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:dwarka-certificates", E_EWS_PURPOSE, 0.88),
  },
  {
    id: "e:economically_backward_requires_other_purpose",
    from: "service:economically_backward_certificate",
    to: "eligibility:purpose_other_than_job_or_education",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:dwarka-certificates", E_EWS_PURPOSE, 0.88),
  },
  {
    id: "e:ews_alternative_to_economically_backward",
    from: "service:ews_certificate",
    to: "service:economically_backward_certificate",
    type: "ALTERNATIVE_TO",
    condition: { field: "certificate_purpose", operator: "NOT_IN", value: ["job", "education"] },
    jurisdictionId: "IN-GJ",
    note: "Not for a job or a course? Then the Economically Backward certificate is the one to ask for.",
    verificationStatus: "VERIFIED",
    sources: cite("src:dwarka-certificates", E_EWS_PURPOSE, 0.88),
  },
  {
    id: "e:economically_backward_alternative_to_ews",
    from: "service:economically_backward_certificate",
    to: "service:ews_certificate",
    type: "ALTERNATIVE_TO",
    condition: { field: "certificate_purpose", operator: "IN", value: ["job", "education"] },
    jurisdictionId: "IN-GJ",
    note: "For a job or a course, the Unreserved Economically Weaker Sections certificate is the one to ask for.",
    verificationStatus: "VERIFIED",
    sources: cite("src:dwarka-certificates", E_EWS_PURPOSE, 0.88),
  },
];

/**
 * Two fields, because two things in the graph above turn on an answer. The
 * water bill's three month limit sits on a requirement group member, and the
 * purpose split sits on the two economically weaker sections eligibility rules.
 * Nothing else here is conditional, so nothing else is asked.
 */
export const questions: QuestionDefinition[] = [
  {
    field: "water_bill_age_months",
    label: "How many months ago was your water bill issued?",
    help: "A water bill only counts as proof of address if it is not older than three months. Skip this if you are using one of the other nine documents.",
    inputType: "NUMBER",
  },
  {
    field: "certificate_purpose",
    label: "What do you need the certificate for?",
    help: "A job or a course leads to one certificate, everything else leads to another.",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "job", label: "A job" },
      { value: "education", label: "A course or admission" },
      { value: "other", label: "Something else" },
    ],
  },
];
