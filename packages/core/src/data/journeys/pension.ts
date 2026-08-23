import type {
  GraphEdge,
  GraphNode,
  QuestionDefinition,
  RequirementGroup,
  Source,
  SourceRef,
} from "../../types";

/**
 * Widow pension and old age pension in Gujarat.
 *
 * Four schemes, two of them central and two of them state, and they are kept
 * as four separate services on purpose. Ganga Swarupa is the Gujarat widow
 * pension, IGNWPS is the central one, Niradhar Vriddha is the Gujarat old age
 * pension and IGNOAPS is the central one. They have different minimum ages,
 * different income tests and different money, and merging them would have
 * meant deciding which page was right.
 *
 * Same rule as the driving licence, certificate and scholarship files. Every
 * claim carries the sentence it was read off, quoted exactly as the page
 * prints it, in Gujarati where the page is in Gujarati. Nothing here was
 * remembered, converted, averaged or tidied up.
 *
 * THE MONEY DOES NOT AGREE, AND THAT IS THE HEADLINE. Four official
 * government pages state four different monthly figures for the two central
 * schemes. Every figure below is stored with the page that printed it and
 * marked CONFLICTING. None was preferred, none was averaged, and no newer page
 * was allowed to overrule an older one. The payment nodes tell the citizen in
 * plain words that the government's own pages disagree and name the office
 * that can tell them what they will actually be paid, which is the Taluka
 * Mamlatdar, because the Mamlatdar is the officially printed sanctioning
 * authority for all of this. A citizen told "these pages disagree, ask this
 * counter" is better served than a citizen told one confident wrong number.
 *
 * The income and death certificates are not defined here. They are nodes in
 * the certificates journey and the services below point at the document ids
 * rather than at the services that issue them, so asking for a widow pension
 * pulls the whole income certificate journey in underneath it, in order,
 * without either file knowing about the other.
 *
 * The eleven documented gaps, stated up front, because missing means missing:
 *
 *  1. nsap.nic.in did not resolve in DNS on the research date for any variant,
 *     so every NSAP fact here was read from an Internet Archive capture of the
 *     official page rather than from the live site. It is cited as what it is.
 *  2. digitalgujarat.gov.in was unreachable (two attempts, both tunnel
 *     failures). Its source id is therefore not declared in this file at all
 *     and nothing is quoted from it. The Digital Gujarat portal appears here
 *     only because the official SJE page prints its URL, so there is no
 *     verified online service name, no application tracking screen and no
 *     online service fee for any pension in this graph.
 *  3. No official helpline number exists here for either Gujarat pension. The
 *     WCD Gujarat contact page carries only downloadable officer list PDFs and
 *     prints no phone number, so this file declares no HELPLINE node. A phone
 *     channel with no number is furniture.
 *  4. No official application tracking URL or status page for either Gujarat
 *     scheme or for NSAP could be retrieved, so there is no TRACK_AT edge
 *     anywhere below. The only officially printed redressal route found is the
 *     60 day appeal to the Provincial Officer on the state old age scheme, and
 *     that is modelled.
 *  5. The IGNWPS monthly amount conflicts across official sources: Rs. 200
 *     (nsap.nic.in), Rs. 300 and Rs. 500 by age band (myscheme.gov.in),
 *     Rs. 700 (anand.nic.in). Unresolved, all three kept.
 *  6. The IGNOAPS monthly amount also conflicts: Rs. 200 and Rs. 500 by band
 *     (nsap.nic.in) against Rs. 750 and Rs. 1000 including a Rs. 500 state
 *     share (sje.gujarat.gov.in). Unresolved, both kept. The research also
 *     records a second pair of figures inside the same anand.nic.in page, but
 *     no verbatim sentence for them was captured, so they are not asserted.
 *  7. No official page publishes the widow scheme under the older name "Vidhva
 *     Sahay Yojana". The department prints it as Ganga Swarupa, so that older
 *     name is not claimed as official anywhere below.
 *  8. The IGNWPS minimum age conflicts between central sources (40) and both
 *     the Gujarat widow scheme and the Anand IGNWPS page (18). Following the
 *     research, the state scheme and the central scheme are two distinct
 *     services rather than one reconciled one, and the central age rule itself
 *     is written to admit both figures rather than block a woman on a number
 *     the government has printed two ways.
 *  9. No official source states that the District Social Defence Officer
 *     receives pension applications, so no such office node exists. The
 *     officially printed receiving points are the Taluka Mamlatdar, the Jan
 *     Seva Kendra at the District Collector office, and the Gram Panchayat.
 * 10. myscheme.gov.in/schemes/ignoaps returns "Page not found", so there is no
 *     myScheme mirror of IGNOAPS here and IGNOAPS carries no UMANG channel,
 *     even though its sibling IGNWPS does. Symmetry is not evidence.
 * 11. The sje.gujarat.gov.in root domain failed to scrape, so only the two
 *     deep scheme pages are cited and there is no department landing page.
 *
 * Also deliberately absent because no retrieved sentence stated it: any
 * processing time or statutory deadline for any of the four schemes, any
 * application fee (the state old age form is stated free, nothing else is
 * stated at all), any required document list for the Niradhar Vriddha state
 * old age scheme, any office address or phone number other than the WCD
 * directorate address the WCD page prints in full, and the National Family
 * Benefit Scheme, which the NSAP page describes but which is a lump sum death
 * benefit rather than a pension and so is out of this journey's scope.
 */

const RETRIEVED = "2026-08-23";

const cite = (sourceId: string, evidence: string, confidence: number): SourceRef[] => [
  { sourceId, evidence, confidence, verificationStatus: "VERIFIED" },
];

/**
 * For claims we read out of a quote rather than off it. Confidence is lowered
 * from the research figure on purpose: the quote is as good as it ever was,
 * our reading of it is not.
 */
const derived = (sourceId: string, evidence: string, confidence: number): SourceRef[] => [
  { sourceId, evidence, confidence, verificationStatus: "NORMALIZED" },
];

/**
 * A figure another official page contradicts. Never resolved, never averaged.
 * Both sides of every disagreement below are stored this way.
 */
const conflicting = (sourceId: string, evidence: string, confidence: number): SourceRef => ({
  sourceId,
  evidence,
  confidence,
  verificationStatus: "CONFLICTING",
});

// The long sentences, quoted once each so the several facts drawn out of each
// one cannot drift apart from the sentence they came from. The Gujarati is the
// department's own text and is not translated in place.

const E_GANGA_NAME = "ગંગા સ્વરૂપા બહેનોને આર્થિક સહાય યોજના";

const E_GANGA_BENEFICIARY =
  "યોજનાનો ઉદ્દેશ / હેતુઃ | વિધવાઓનું આર્થિક સ્વાવલંબન |\n| લાભાર્થીનો પ્રકાર | વિધવા મહિલા |";

const E_GANGA_AGE = "આ યોજના હેઠળ ૧૮ વર્ષ કે તેથી વધુ ઉંમરની વિધવા મહિલા";

const E_GANGA_INCOME = "ગ્રામીણ વિસ્તાર માટે રૂ.૧,૨૦,૦૦૦ અને<br>શહેર વિસ્તાર માટે રૂ.૧,૫૦,૦૦૦";

const E_GSPSG_ELIGIBILITY =
  "The applicant must be a resident of Gujarat.\n\nThe applicant must be a widowed woman.\n\nThe applicant must be aged 18 years or above.\n\nThe applicant's annual income must not exceed ₹1,20,000/- in rural areas and ₹1,50,000/- in urban areas.";

const E_GANGA_AMOUNT = "માસિક રૂ. ૧૨૫૦ લાભાર્થીના પોસ્ટ ખાતામાં સીધી જમા થાય છે.";

const E_GSPSG_BENEFIT =
  "Eligible beneficiaries receive a monthly pension directly deposited into their Post Office accounts.";

const E_GANGA_MAMLATDAR =
  "ફોર્મમાં જણાવેલ પુરાવા અને વિગત સાથેનું ફોર્મ ભરી તાલુકા મામલતદારને રજુ કરવાનું હોય છે. મામલતદારશ્રી દ્વારા ચકાસણી કરી સહાય મંજુર કરવામાં આવે છે.";

const E_GSPSG_OFFLINE = "Step 1: Obtain the application form from Taluka Mamlatdar's office.";

const E_GANGA_OFFICES =
  "નિયામકશ્રી, મહિલા કલ્યાણ , કમિશનર, મહિલા અને બાળ વિકાસની કચેરી બ્લોક નં.૨૦, ડૉ. જીવરાજ મહેતા ભવન, ગાંધીનગર.<br>જિલ્લા સ્તરે ઃ મામલતદારશ્રી, દહેજ પ્રતિબંધક અધિકારી સહ રક્ષણ અધિકારીની કચેરી";

const E_GANGA_DOCUMENTS =
  "વિધવા બહેનનો ફોટો, રેશન કાર્ડની નકલ, શાળા છોડ્‌યાનું પ્રમાણપત્ર, આવકનો દાખલો, પતિના મૃત્યુનો દાખલો, ચૂંટણી કાર્ડ/આધાર કાર્ડ, લાઈટ બીલ, જન્મ પ્રમાણપત્ર, વિધવા હોવા અંગેનો દાખલો";

const E_IGNWPS_SCHEME =
  "Indira Gandhi National Widow Pension Scheme (IGNWPS) is implemented by Ministry of Rural Development, Government of India. It is a non-contributory pension scheme to provide social security to widows of poor family (BPL) of the society.";

const E_IGNWPS_AMOUNT_MYSCHEME =
  "A pension of ₹ 300/- per month is provided to Widows between 40 years and 79 years. For persons who are 80 years and above, the pension is ₹ 500/- per month.";

const E_IGNWPS_ELIGIBILITY =
  "The applicant must be a widow in the age group of 40-79 years.\n\nThe applicant should belong to a household living below the poverty line according to the criteria prescribed by the Govt. of India";

const E_IGNWPS_EXCLUSIONS = "In case of remarriage of widow\n\nOnce the widow moves above poverty line";

const E_IGNWPS_AGE_PROOF =
  "Age Proof - For age, the birth certificate or school certificate may be relied on. In their absence ration card and EPIC may be considered. If there is no valid document, any Medical Officer of any government hospital may be authorized to issue the age certificate.";

const E_UMANG =
  "Step 01: Visit the official website of the UMANG portal, https://web.umang.gov.in/web_new/home";

const E_IGNWPS_AMOUNT_NSAP =
  "**Indira Gandhi National Widow Pension Scheme (IGNWPS):** BPL widows aged 40-59 years are entitled to a monthly pension of Rs. 200/-.";

const E_IGNOAPS_AMOUNT_NSAP =
  "**Indira Gandhi National Old Age Pension Scheme (IGNOAPS):** Under the scheme, BPL persons aged 60 years or above are entitled to a monthly pension of Rs. 200/- up to 79 years of age and Rs.500/- thereafter.";

const E_IGNOAPS_AGE_2011 =
  "the eligibility age for pension under IGNOAPS has been reduced to 60 years w.e.f. 1st April, 2011.";

const E_NSAP_IDENTIFICATION =
  "The Gram Panchayat / Municipalities are expected to play an active role in the identification of the beneficiaries under the three schemes.";

const E_NSAP_DISBURSEMENT =
  "Apart from the disbursal of benefits through the accounts of the beneficiaries in Banks or in Post Office Savings Banks or through Postal Money Order the assistance under NOAPS, may also be disbursed in public meetings such as Gram Sabha meetings in rural areas and by neighbourhood / mohalla committees in urban areas.";

const E_SJE_IGNOAPS_ELIGIBILITY =
  "(A) Elligibility Criteria:  \n1. 60 years or more  \n2. Member of family in 0 to 20 score of BPL list";

const E_SJE_IGNOAPS_PLACE =
  "(B) Place to give application: respective mamlatdar office, jansevaKendra of respective district collector offices";

const E_SJE_IGNOAPS_DOCUMENTS =
  "(C) Documents to be attached with application  \n1. Age Certificate  \n2. BPL Certificate";

const E_IGNOAPS_AMOUNT_SJE =
  "(D) Monthly Assistance: Rs.750/- for 60 to 79 age group and Rs. 1000/- for more than 80 years which also includes Rs. 500/- by State Government";

const E_SJE_IGNOAPS_MODE =
  "(E) Mode of assistance : By money order. Option to get finanicial assistance through Post Account or Bank Acccount pension by D.B.T. credit.";

const E_VRUDH_NAME = "Niradhar Vriddha Pension Yojana (State Government Scheme)";

const E_VRUDH_AGE = "Elderly people of 60 years or above under this scheme.";

const E_VRUDH_DISABILITY =
  "In case of a disabled person, disability of more than 75% and age limit of 45 years or above.";

const E_VRUDH_DESTITUTION =
  "Should not have a son or grandson of 21 years or above and if he is alive and is mentally unstable or disabled and is unable to earn or is suffering from a serious illness like cancer, T.B. then application can be made.";

const E_VRUDH_RESIDENCY = "Applicants who have been permanently residing in Gujarat for at least 10 years.";

const E_VRUDH_INCOME =
  "The annual income of the applicant should not exceed Rs. 1,20,000/- in rural areas and Rs. 1,50,000/- in urban areas.";

const E_VRUDH_BPL =
  "Applicants from rural areas should be included in the BPL list below the poverty line with a score of 0 to 20.";

const E_VRUDH_ONLINE =
  "Online application can be made from the Jan Seva Kendra, Mamlatdar Office, Gram Panchayat at the village level of the concerned district/taluka. https://www.digitalgujarat.gov.in/";

const E_VRUDH_FORM_FREE = "This application form can be obtained free of cost from the Mamlatdar's Office.";

const E_VRUDH_VCE = "At the village level (V.C.E.) the application can be made online from the Gram Panchayat.";

const E_VRUDH_AUTHORITY = "The authority to approve/reject has been delegated to the Mamlatdar.";

const E_VRUDH_APPEAL =
  "There is a provision to file an appeal application to the Provincial Officer within 60 days of the rejected application.";

const E_VRUDH_AMOUNT =
  "Monthly assistance of Rs. 1000/- is paid to the beneficiary aged 60 to 79 years and Rs. 1250/- to the beneficiary aged 80 years or more.";

const E_VRUDH_DBT = "Payment is made through DBT to the beneficiary's post or bank account.";

const E_ANAND_IGNOAPS =
  "It was launched by Ministry of Rural Development. All persons of 60 years and above (revised downwards from 65 in 2011) and belonging to below the poverty line category";

const E_ANAND_IGNOAPS_DOCS = "BPL Score card rated 0-16. Address proof. Age proof. Citizenship proof.";

const E_ANAND_IGNWPS =
  "Widow from BPL family aged 18 or above, get the amount of 700/- per month till she gets remarried or her son attend the age of 21.";

const E_ANAND_IGNWPS_DOCS = "BPL Score card rated. Address proof. Age proof. Citizenship proof.";

/** The one sentence a citizen should carry to the counter when the pages fight. */
const ASK_THE_MAMLATDAR =
  "Official government pages state different monthly amounts for this scheme. Every published figure is listed here with the page that printed it, and none has been picked as the right one. Ask your Taluka Mamlatdar, who is the officer who sanctions the assistance, what you will actually be paid.";

export const sources: Source[] = [
  // digitalgujarat.gov.in is deliberately not listed. Both scrape attempts
  // failed with ERR_TUNNEL_CONNECTION_FAILED, nothing was read off it, and a
  // source nobody can quote is not a source. It survives in this graph only as
  // the URL the SJE page prints, cited to the SJE page.
  {
    id: "src:wcd-ganga",
    url: "https://wcd.gujarat.gov.in/initiativedetails?id=231",
    title:
      "Ganga Swarupa Pension Scheme - Women and Child Development Department, Government of Gujarat",
    domain: "wcd.gujarat.gov.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:myscheme-gspsg",
    url: "https://www.myscheme.gov.in/schemes/gspsg",
    title: "Ganga Swarupa Pension Scheme, Gujarat - myScheme",
    domain: "myscheme.gov.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:myscheme-ignwps",
    url: "https://www.myscheme.gov.in/schemes/ignwps",
    title: "Indira Gandhi National Widow Pension Scheme - myScheme",
    domain: "myscheme.gov.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:sje-vrudh",
    url: "https://sje.gujarat.gov.in/dsd/schemes/2212?lang=english",
    title:
      "Finacial assistance to destitute older persons (Scheme of State Government) - Director, Social Defence, Social Justice & Empowerment Department, Government of Gujarat",
    domain: "sje.gujarat.gov.in",
    sourceType: "GUIDELINE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:sje-ignoaps",
    url: "https://sje.gujarat.gov.in/dsd/showpage.aspx?contentid=2208&lang=English",
    title: "Indira Gandhi National old pension (vayvandana scheme) - Director, Social Defence, Government of Gujarat",
    domain: "sje.gujarat.gov.in",
    sourceType: "GUIDELINE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
  {
    // Read from an Internet Archive capture. nsap.nic.in did not resolve in DNS
    // on the research date for any variant of the hostname.
    id: "src:nsap-about",
    url: "https://nsap.nic.in/circular.do?method=aboutus",
    title: "About Us - National Social Assistance Programme (NSAP), Ministry of Rural Development",
    domain: "nsap.nic.in",
    sourceType: "GUIDELINE",
    jurisdictionId: "IN",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:anand-ignoaps",
    url: "https://anand.nic.in/scheme/indira-gandhi-national-old-age-pension-scheme/",
    title: "Indira Gandhi National Old Age Pension Scheme - District Anand, Government of Gujarat",
    domain: "anand.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-ANAND",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:anand-ignwps",
    url: "https://anand.nic.in/schemes/indira-gandhi-national-widow-pension-scheme/",
    title: "Indira Gandhi National Widow Pension Scheme - District Anand, Government of Gujarat",
    domain: "anand.nic.in",
    sourceType: "SERVICE_PAGE",
    jurisdictionId: "IN-GJ-ANAND",
    retrievedAt: RETRIEVED,
  },
  // The WCD contact page is not listed either. It was fetched, but it carries
  // only downloadable officer list PDFs and prints no phone number, so there
  // was nothing on it to quote and no helpline node to build from it.
];

export const nodes: GraphNode[] = [
  // -------------------------------------------------------------------------
  // The four schemes. Kept apart because the pages keep them apart.
  // -------------------------------------------------------------------------
  {
    id: "service:widow_pension",
    type: "SERVICE",
    name: "Widow pension, Gujarat (Ganga Swarupa)",
    officialName: E_GANGA_NAME,
    // "Vidhva Sahay Yojana" is here as a search term only. No official page in
    // the crawl calls the scheme that, and nothing below claims it does, but
    // it is what a great many people still type, and refusing to answer them
    // over a naming quibble would be its own kind of dishonest.
    aliases: [
      "ganga swarupa",
      "ganga swarupa pension scheme",
      "widow pension gujarat",
      "vidhva sahay yojana",
      "vidhva sahay",
    ],
    description:
      "The Gujarat state pension for widows, run by the Women and Child Development Department. Open from age 18, unlike the central widow pension, and it does not require a BPL card, only an income below the ceiling.",
    jurisdictionId: "IN-GJ",
    metadata: {
      whyRequired: "Monthly income support for a widow who has no other pension.",
      whatToDo:
        "Get the application form from your Taluka Mamlatdar's office, fill it in with the proofs listed here and hand it back to the Taluka Mamlatdar. The Mamlatdar checks it and sanctions the assistance.",
      expectedOutput:
        "Rs. 1250 a month credited directly into your post office account. Only the department's own page prints that figure, so confirm it at the counter.",
      fee: "No fee for this scheme is printed on any page retrieved for this graph. Ask before you pay anything.",
    },
    sources: [
      ...cite("src:wcd-ganga", E_GANGA_NAME, 0.96),
      ...cite("src:myscheme-gspsg", "The applicant must be a widowed woman.", 0.95),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:old_age_pension",
    type: "SERVICE",
    name: "Old age pension, Gujarat (Niradhar Vriddha)",
    officialName: E_VRUDH_NAME,
    aliases: ["niradhar vriddha", "niradhar vriddha pension yojana", "old age pension gujarat"],
    description:
      "The Gujarat state pension for destitute older people, run by the Director of Social Defence. It has a destitution test the central scheme does not have: a son or grandson aged 21 or over who can earn disqualifies you.",
    jurisdictionId: "IN-GJ",
    metadata: {
      whyRequired: "Monthly income support for an older person with nobody able to support them.",
      whatToDo:
        "The form is free at the Mamlatdar's Office. You can also apply online from a Jan Seva Kendra, the Mamlatdar Office, or your Gram Panchayat, where the village computer entrepreneur files it for you. The Mamlatdar approves or rejects. If you are rejected, you have 60 days to appeal to the Provincial Officer.",
      expectedOutput:
        "Rs. 1000 a month if you are 60 to 79, Rs. 1250 a month if you are 80 or more, paid by DBT into your post office or bank account.",
      fee: "The application form itself is free at the Mamlatdar's Office. No other fee is printed on any page retrieved for this graph.",
    },
    sources: [
      ...cite("src:sje-vrudh", E_VRUDH_NAME, 0.94),
      ...cite("src:sje-vrudh", E_VRUDH_AGE, 0.94),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:ignwps",
    type: "SERVICE",
    name: "Widow pension, central (IGNWPS)",
    officialName: "Indira Gandhi National Widow Pension Scheme (IGNWPS)",
    aliases: ["ignwps", "indira gandhi national widow pension scheme"],
    description:
      "The central widow pension, run by the Ministry of Rural Development for widows of families below the poverty line. Separate from the Gujarat Ganga Swarupa scheme, with a different minimum age and different money.",
    jurisdictionId: "IN",
    metadata: {
      whyRequired: "Monthly central income support for a widow in a household below the poverty line.",
      whatToDo: `Apply through the UMANG portal, or at your Mamlatdar office or Gram Panchayat, which are the bodies expected to identify beneficiaries. ${ASK_THE_MAMLATDAR}`,
      expectedOutput:
        "The published figures do not agree. myScheme prints Rs. 300 a month for ages 40 to 79 and Rs. 500 for 80 and above, the NSAP page prints Rs. 200 a month for ages 40 to 59, and the Anand district page prints Rs. 700 a month. All three are official. None has been picked here.",
      fee: "No fee for this scheme is printed on any page retrieved for this graph.",
    },
    sources: [...cite("src:myscheme-ignwps", E_IGNWPS_SCHEME, 0.95)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:ignoaps",
    type: "SERVICE",
    name: "Old age pension, central (IGNOAPS)",
    officialName: "Indira Gandhi National Old Age Pension Scheme (IGNOAPS)",
    aliases: ["ignoaps", "indira gandhi national old age pension scheme", "vayvandana"],
    description:
      "The central old age pension, run by the Ministry of Rural Development for people aged 60 and above below the poverty line. Gujarat's Social Defence directorate lists it as the vayvandana scheme and tops it up from state funds.",
    jurisdictionId: "IN",
    metadata: {
      whyRequired: "Monthly central income support for an older person in a household below the poverty line.",
      whatToDo: `Give the application at your respective Mamlatdar office or at the Jan Seva Kendra of your district collector office. ${ASK_THE_MAMLATDAR}`,
      expectedOutput:
        "The published figures do not agree. Gujarat's Social Defence page prints Rs. 750 a month for ages 60 to 79 and Rs. 1000 for over 80, of which Rs. 500 is the state's own share. The central NSAP page prints Rs. 200 a month up to 79 and Rs. 500 after that. Both are official. Neither has been picked here.",
      fee: "No fee for this scheme is printed on any page retrieved for this graph.",
    },
    sources: [
      ...cite("src:sje-ignoaps", E_SJE_IGNOAPS_ELIGIBILITY, 0.93),
      ...cite("src:anand-ignoaps", E_ANAND_IGNOAPS, 0.9),
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -------------------------------------------------------------------------
  // Eligibility. This is the journey. Every rule below is a real condition, so
  // the compiler works out which questions to ask and, when the answer is
  // wrong, which named rule stopped the citizen.
  // -------------------------------------------------------------------------
  {
    id: "eligibility:widow",
    type: "ELIGIBILITY",
    name: "You must be a widow",
    description:
      "Both widow pensions are for widowed women. The Gujarat page states the beneficiary type as a widowed woman and states the objective as the economic self reliance of widows.",
    metadata: { rule: { field: "is_widow", operator: "EQ", value: true } },
    sources: [
      ...cite("src:wcd-ganga", E_GANGA_BENEFICIARY, 0.95),
      ...cite("src:myscheme-gspsg", "The applicant must be a widowed woman.", 0.95),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:age_18_plus",
    type: "ELIGIBILITY",
    name: "You must be 18 or older",
    description: "The Gujarat widow pension is open to a widow aged 18 years or above.",
    jurisdictionId: "IN-GJ",
    metadata: { rule: { field: "age", operator: "GTE", value: 18 } },
    sources: [
      ...cite("src:wcd-ganga", E_GANGA_AGE, 0.95),
      ...cite("src:myscheme-gspsg", "The applicant must be aged 18 years or above.", 0.95),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:income_under_120000_rural",
    type: "ELIGIBILITY",
    name: "In a rural area, your annual income must be Rs. 1,20,000 or less",
    description:
      "The Gujarat widow pension income ceiling for rural areas. The department page prints it in Gujarati and the national myScheme mirror prints the same two figures in English.",
    jurisdictionId: "IN-GJ",
    metadata: { rule: { field: "annual_family_income", operator: "LTE", value: 120000 } },
    sources: [
      ...cite("src:wcd-ganga", E_GANGA_INCOME, 0.95),
      ...cite("src:myscheme-gspsg", E_GSPSG_ELIGIBILITY, 0.95),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:income_under_150000_urban",
    type: "ELIGIBILITY",
    name: "In an urban area, your annual income must be Rs. 1,50,000 or less",
    description: "The Gujarat widow pension income ceiling for urban areas.",
    jurisdictionId: "IN-GJ",
    metadata: { rule: { field: "annual_family_income", operator: "LTE", value: 150000 } },
    sources: [
      ...cite("src:wcd-ganga", E_GANGA_INCOME, 0.95),
      ...cite("src:myscheme-gspsg", E_GSPSG_ELIGIBILITY, 0.95),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:ignwps_age",
    type: "ELIGIBILITY",
    name: "You must be at least 18, and the official pages disagree about whether it is really 40",
    description:
      "The central widow pension prints two different minimum ages. myScheme states an age group of 40 to 79, the NSAP page states 40 to 59, and the Anand district page states 18 or above. The rule here admits anyone 18 or over rather than refuse a woman on a number the government has published three ways. If you are between 18 and 40, apply anyway and make the office tell you which rule they are using. The Gujarat Ganga Swarupa scheme is open from 18 either way.",
    metadata: { rule: { field: "age", operator: "GTE", value: 18 } },
    sources: [
      conflicting("src:myscheme-ignwps", E_IGNWPS_ELIGIBILITY, 0.9),
      conflicting("src:nsap-about", E_IGNWPS_AMOUNT_NSAP, 0.85),
      conflicting("src:anand-ignwps", E_ANAND_IGNWPS, 0.8),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:bpl_household",
    type: "ELIGIBILITY",
    name: "Your household must be below the poverty line",
    description:
      "The central widow pension is for widows of poor families, and the household must be below the poverty line by the criteria the Government of India prescribes. The pension also stops once the widow moves above the poverty line.",
    metadata: { rule: { field: "is_bpl", operator: "EQ", value: true } },
    sources: [
      ...cite(
        "src:myscheme-ignwps",
        "The applicant should belong to a household living below the poverty line according to the criteria prescribed by the Govt. of India",
        0.9,
      ),
      ...cite("src:myscheme-ignwps", E_IGNWPS_SCHEME, 0.95),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:not_remarried",
    type: "ELIGIBILITY",
    name: "You must not have remarried",
    description:
      "The central widow pension stops on remarriage. The Anand district page adds that it runs until she remarries or her son attains the age of 21, which no other retrieved page repeats, so only the remarriage rule is enforced here.",
    metadata: { rule: { field: "has_remarried", operator: "EQ", value: false } },
    sources: [
      ...cite("src:myscheme-ignwps", "In case of remarriage of widow", 0.92),
      ...derived("src:anand-ignwps", E_ANAND_IGNWPS, 0.75),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:age_60_plus",
    type: "ELIGIBILITY",
    name: "You must be 60 or older",
    description:
      "Both old age pensions start at 60. The central age was reduced to 60 with effect from 1 April 2011 and the Gujarat state scheme uses the same floor.",
    metadata: { rule: { field: "age", operator: "GTE", value: 60 } },
    sources: [
      ...cite("src:nsap-about", E_IGNOAPS_AGE_2011, 0.93),
      ...cite("src:sje-vrudh", E_VRUDH_AGE, 0.94),
      ...cite("src:sje-ignoaps", E_SJE_IGNOAPS_ELIGIBILITY, 0.93),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:disabled_75_and_age_45",
    type: "ELIGIBILITY",
    name: "If you are disabled, more than 75 percent disability and age 45 or above",
    description:
      "The Gujarat state old age pension opens fifteen years early for a disabled applicant, at 45 instead of 60, if the disability is more than 75 percent.",
    jurisdictionId: "IN-GJ",
    metadata: {
      rule: {
        all: [
          { field: "disability_percentage", operator: "GT", value: 75 },
          { field: "age", operator: "GTE", value: 45 },
        ],
      },
    },
    sources: [...cite("src:sje-vrudh", E_VRUDH_DISABILITY, 0.92)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:gujarat_resident_10_years",
    type: "ELIGIBILITY",
    name: "You must have lived in Gujarat for at least 10 years",
    description:
      "The Gujarat state old age pension is for applicants permanently residing in Gujarat for at least 10 years. This is a separate and harder test than simply living in Gujarat now, and the state widow pension does not have it.",
    jurisdictionId: "IN-GJ",
    metadata: { rule: { field: "years_resident_in_gujarat", operator: "GTE", value: 10 } },
    sources: [...cite("src:sje-vrudh", E_VRUDH_RESIDENCY, 0.93)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:no_earning_son_or_grandson",
    type: "ELIGIBILITY",
    name: "You must not have a son or grandson aged 21 or over who can support you",
    description:
      "The destitution test on the Gujarat state old age pension. A son or grandson of 21 or above disqualifies you, unless he is mentally unstable, disabled, unable to earn, or suffering a serious illness such as cancer or T.B., in which case you can still apply. Answer no if the only such son or grandson falls into one of those exceptions.",
    jurisdictionId: "IN-GJ",
    metadata: {
      rule: { field: "has_earning_son_or_grandson_21_plus", operator: "EQ", value: false },
    },
    sources: [...cite("src:sje-vrudh", E_VRUDH_DESTITUTION, 0.92)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:old_age_income_or_bpl",
    type: "ELIGIBILITY",
    name: "Your income must be under the ceiling, or your family must be on the BPL list",
    description:
      "The Gujarat state old age pension page prints two money tests next to each other: an annual income ceiling of Rs. 1,20,000 in rural areas and Rs. 1,50,000 in urban areas, and a rural BPL score of 0 to 20. It does not say whether the BPL score replaces the income test or adds to it. Meeting either one is treated as passing here, because guessing in the direction that turns a citizen away would be the worse guess. The counter may read it the other way.",
    jurisdictionId: "IN-GJ",
    metadata: {
      rule: {
        any: [
          {
            all: [
              { field: "area_type", operator: "EQ", value: "rural" },
              { field: "annual_family_income", operator: "LTE", value: 120000 },
            ],
          },
          {
            all: [
              { field: "area_type", operator: "EQ", value: "urban" },
              { field: "annual_family_income", operator: "LTE", value: 150000 },
            ],
          },
          { field: "bpl_score", operator: "LTE", value: 20 },
        ],
      },
    },
    sources: [
      ...derived("src:sje-vrudh", E_VRUDH_INCOME, 0.9),
      ...derived("src:sje-vrudh", E_VRUDH_BPL, 0.88),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:bpl_score_0_to_20",
    type: "ELIGIBILITY",
    name: "Your family must score 0 to 20 on the BPL list",
    description:
      "The Gujarat eligibility rule for the central old age pension. The Anand district page states the BPL score card must be rated 0 to 16 rather than 0 to 20, which is the tighter of the two, so check which list your taluka is working from.",
    metadata: { rule: { field: "bpl_score", operator: "LTE", value: 20 } },
    sources: [
      ...cite("src:sje-ignoaps", E_SJE_IGNOAPS_ELIGIBILITY, 0.93),
      conflicting("src:anand-ignoaps", E_ANAND_IGNOAPS_DOCS, 0.88),
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -------------------------------------------------------------------------
  // Documents. The ration card, election card, Aadhaar, light bill, birth
  // certificate, school leaving certificate and income certificate are not
  // declared here. They already exist in the certificate and driving licence
  // journeys and are pointed at by id, which is how asking for a widow pension
  // pulls the income certificate journey in underneath it.
  // -------------------------------------------------------------------------
  {
    id: "document:widow_photograph",
    type: "DOCUMENT",
    name: "Photograph of the widow",
    description: "First item on the department's own list for the Ganga Swarupa form.",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: [...derived("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.9)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:husband_death_certificate",
    type: "DOCUMENT",
    name: "Your husband's death certificate",
    description:
      "The proof of the death itself. No page retrieved for this graph says which office issues it or how long it takes, so that part of the journey stops here.",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: [...derived("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.9)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:widowhood_certificate",
    type: "DOCUMENT",
    name: "Certificate that you are a widow",
    description:
      "A separate certificate from the death certificate, listed as its own item on the department's list. Mahesana district issues a combined widow and income certificate, which may be the same paper under another name, but no retrieved page says so.",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: [...derived("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.9)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:bpl_certificate",
    type: "DOCUMENT",
    name: "BPL certificate or BPL score card",
    officialName: "BPL Certificate",
    aliases: ["bpl card", "bpl score card", "below poverty line certificate"],
    description:
      "Proof that your household is on the below poverty line list. Gujarat's Social Defence page calls it a BPL Certificate and the Anand district page calls it a BPL Score card rated 0-16. No retrieved page says which office issues it.",
    metadata: { selfProvided: true },
    sources: [
      ...cite("src:sje-ignoaps", E_SJE_IGNOAPS_DOCUMENTS, 0.93),
      ...cite("src:anand-ignoaps", E_ANAND_IGNOAPS_DOCS, 0.88),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:medical_officer_age_certificate",
    type: "DOCUMENT",
    name: "Age certificate from a government hospital Medical Officer",
    description:
      "The last resort for age proof on the central widow pension, for a citizen who holds no valid document at all. Any Medical Officer of any government hospital may be authorised to issue it.",
    metadata: { selfProvided: true },
    sources: [...cite("src:myscheme-ignwps", E_IGNWPS_AGE_PROOF, 0.9)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:citizenship_proof",
    type: "DOCUMENT",
    name: "Citizenship proof",
    description:
      "Listed as its own line on the Anand district pension pages. Neither page says which documents count as citizenship proof, so no list is invented here. Ask the counter.",
    jurisdictionId: "IN-GJ-ANAND",
    metadata: { selfProvided: true },
    sources: [...cite("src:anand-ignoaps", E_ANAND_IGNOAPS_DOCS, 0.88)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:pension_address_proof",
    type: "DOCUMENT",
    name: "Address proof",
    description:
      "Listed as its own line on the Anand district pension pages, without a list of what counts. The certificate journey's resident proof list is a different department's list and is deliberately not borrowed for it.",
    jurisdictionId: "IN-GJ-ANAND",
    metadata: { selfProvided: true },
    sources: [...cite("src:anand-ignoaps", E_ANAND_IGNOAPS_DOCS, 0.88)],
    lastVerifiedAt: RETRIEVED,
  },

  // -------------------------------------------------------------------------
  // The two either-or bundles.
  // -------------------------------------------------------------------------
  {
    id: "document_group:election_card_or_aadhaar",
    type: "DOCUMENT_GROUP",
    name: "Election card or Aadhaar card",
    description: "The department's list prints these two as one slash-separated item, so either one does.",
    jurisdictionId: "IN-GJ",
    metadata: { requirementGroupId: "rg:election_card_or_aadhaar" },
    sources: [...cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document_group:pension_age_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of your age",
    description:
      "The central widow pension spells out a preference order rather than a flat list: birth certificate or school certificate first, ration card and election card only in their absence, and a government Medical Officer's certificate if you have no valid document at all. The order is kept in the notes on each alternative.",
    metadata: { requirementGroupId: "rg:pension_age_proof" },
    sources: [...cite("src:myscheme-ignwps", E_IGNWPS_AGE_PROOF, 0.9)],
    lastVerifiedAt: RETRIEVED,
  },

  // -------------------------------------------------------------------------
  // Offices, channels and the one department. The Taluka Mamlatdar office and
  // the Digital Gujarat portal are reused from the certificates journey.
  // -------------------------------------------------------------------------
  {
    id: "office:wcd_directorate_gandhinagar",
    type: "OFFICE",
    name: "Directorate of Women Welfare, Gandhinagar",
    officialName: "Commissioner, Women and Child Development",
    description:
      "The state level implementing office for the Ganga Swarupa widow pension. You do not apply here, the Taluka Mamlatdar does that. This is who owns the scheme when the taluka cannot answer you.",
    jurisdictionId: "IN-GJ",
    metadata: {
      officeType: "State directorate",
      address: "Block No. 20, Dr. Jivraj Mehta Bhavan, Gandhinagar",
      channelType: "PHYSICAL_OFFICE",
    },
    sources: [...cite("src:wcd-ganga", E_GANGA_OFFICES, 0.95)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "office:gram_panchayat",
    type: "OFFICE",
    name: "Your Gram Panchayat",
    description:
      "At village level the application can be filed online from the Gram Panchayat by the village computer entrepreneur. Gram Panchayats and municipalities are also the bodies expected to identify who qualifies for the central schemes, so being known here matters. No page retrieved for this graph prints an address or a phone number for any individual Gram Panchayat.",
    jurisdictionId: "IN-GJ",
    metadata: { officeType: "Gram Panchayat", channelType: "PHYSICAL_OFFICE" },
    sources: [
      ...cite("src:sje-vrudh", E_VRUDH_VCE, 0.92),
      ...cite("src:nsap-about", E_NSAP_IDENTIFICATION, 0.92),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "office:provincial_officer",
    type: "OFFICE",
    name: "The Provincial Officer, for appeals",
    description:
      "If your Gujarat state old age pension application is rejected, this is the appeal. You have 60 days from the rejection. No page retrieved for this graph prints an address, a phone number or a form number for the appeal, so ask the Mamlatdar who rejected you.",
    jurisdictionId: "IN-GJ",
    metadata: { officeType: "Appellate authority", channelType: "PHYSICAL_OFFICE" },
    sources: [...cite("src:sje-vrudh", E_VRUDH_APPEAL, 0.94)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:umang",
    type: "PORTAL",
    name: "UMANG portal",
    officialName: "UMANG",
    aliases: ["umang"],
    description:
      "The online route into the central widow pension. You log in with your mobile number and an OTP and search for NSAP. Nothing in this graph says the central old age pension can be applied for the same way, so it is not claimed for it.",
    metadata: { url: "https://web.umang.gov.in/web_new/home", channelType: "WEB" },
    sources: [...cite("src:myscheme-ignwps", E_UMANG, 0.88)],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "department:ministry_of_rural_development",
    type: "DEPARTMENT",
    name: "Ministry of Rural Development, Government of India",
    description: "Owns both central pensions under the National Social Assistance Programme.",
    metadata: { officeType: "Central ministry" },
    sources: [
      ...cite("src:myscheme-ignwps", E_IGNWPS_SCHEME, 0.95),
      ...cite("src:anand-ignoaps", E_ANAND_IGNOAPS, 0.9),
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -------------------------------------------------------------------------
  // The decision, and what comes out of it.
  // -------------------------------------------------------------------------
  {
    id: "verification:mamlatdar_sanction",
    type: "VERIFICATION",
    name: "The Mamlatdar checks your form and sanctions the assistance",
    description:
      "The Mamlatdar verifies the form and sanctions the assistance, and the authority to approve or reject has been delegated to the Mamlatdar. Nobody else in this graph can approve it and no retrieved page publishes how long it takes.",
    jurisdictionId: "IN-GJ",
    metadata: {
      blockedBy: "GOVERNMENT",
      whyRequired: "No pension is paid until the Mamlatdar sanctions it.",
      whatToDo:
        "Nothing, until they decide. Reapplying will not speed it up. The state old age pension is the only one of these schemes that publishes an appeal, to the Provincial Officer within 60 days of a rejection. For the others, go back to the Mamlatdar who decided.",
      timeline: "No processing time is published on any page retrieved for this graph.",
    },
    sources: [
      ...cite("src:wcd-ganga", E_GANGA_MAMLATDAR, 0.96),
      ...cite("src:sje-vrudh", E_VRUDH_AUTHORITY, 0.95),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "output:ganga_swarupa_pension",
    type: "OUTPUT",
    name: "Rs. 1250 a month in your post office account",
    description:
      "The Gujarat widow pension is credited straight into the beneficiary's post office account. Only the department's own page prints the figure. The national mirror confirms the post office route without repeating the amount.",
    jurisdictionId: "IN-GJ",
    sources: [
      ...cite("src:wcd-ganga", E_GANGA_AMOUNT, 0.95),
      ...cite("src:myscheme-gspsg", E_GSPSG_BENEFIT, 0.94),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "output:niradhar_vriddha_pension",
    type: "OUTPUT",
    name: "Rs. 1000 a month, or Rs. 1250 from age 80, by DBT",
    description:
      "The Gujarat state old age pension. This is the only one of the four amounts in this journey that no other official page contradicts.",
    jurisdictionId: "IN-GJ",
    sources: [
      ...cite("src:sje-vrudh", E_VRUDH_AMOUNT, 0.94),
      ...cite("src:sje-vrudh", E_VRUDH_DBT, 0.94),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "output:ignwps_pension",
    type: "OUTPUT",
    name: "A monthly widow pension, amount disputed between official pages",
    description: `Three official government pages print three different figures for this one scheme: Rs. 300 a month for ages 40 to 79 and Rs. 500 from 80 on myScheme, Rs. 200 a month for ages 40 to 59 on the NSAP page, and Rs. 700 a month on the Anand district page. All three are recorded below against the page that printed them. None has been chosen, averaged or overruled by the newer one. ${ASK_THE_MAMLATDAR}`,
    metadata: {
      whatToDo: ASK_THE_MAMLATDAR,
    },
    sources: [
      // Not averaged, not picked, not ranked by recency. Three pages, three
      // numbers, three citations.
      conflicting("src:myscheme-ignwps", E_IGNWPS_AMOUNT_MYSCHEME, 0.85),
      conflicting("src:nsap-about", E_IGNWPS_AMOUNT_NSAP, 0.85),
      conflicting("src:anand-ignwps", E_ANAND_IGNWPS, 0.8),
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "output:ignoaps_pension",
    type: "OUTPUT",
    name: "A monthly old age pension, amount disputed between official pages",
    description: `Two official government pages print different figures for this one scheme: Gujarat's Social Defence directorate prints Rs. 750 a month for ages 60 to 79 and Rs. 1000 for over 80, of which Rs. 500 is the state's own share, while the central NSAP page prints Rs. 200 a month up to 79 and Rs. 500 after that. Both are recorded below against the page that printed them, and neither has been chosen. Payment is by money order, or into a post office or bank account by DBT credit if you ask for that, or in some places handed over at a Gram Sabha meeting. ${ASK_THE_MAMLATDAR}`,
    metadata: {
      whatToDo: ASK_THE_MAMLATDAR,
    },
    sources: [
      // Same rule. The state page is not preferred for being closer, and the
      // central page is not preferred for being central.
      conflicting("src:sje-ignoaps", E_IGNOAPS_AMOUNT_SJE, 0.92),
      conflicting("src:nsap-about", E_IGNOAPS_AMOUNT_NSAP, 0.88),
      ...cite("src:sje-ignoaps", E_SJE_IGNOAPS_MODE, 0.92),
      ...cite("src:nsap-about", E_NSAP_DISBURSEMENT, 0.9),
    ],
    lastVerifiedAt: RETRIEVED,
  },
];

export const edges: GraphEdge[] = [
  // -------------------------------------------------------------------------
  // Ganga Swarupa, the Gujarat widow pension.
  // -------------------------------------------------------------------------
  {
    id: "e:widow_pension_requires_widow",
    from: "service:widow_pension",
    to: "eligibility:widow",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_BENEFICIARY, 0.95),
  },
  {
    id: "e:widow_pension_requires_age_18",
    from: "service:widow_pension",
    to: "eligibility:age_18_plus",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_AGE, 0.95),
  },
  {
    id: "e:widow_pension_requires_income_rural",
    from: "service:widow_pension",
    to: "eligibility:income_under_120000_rural",
    type: "REQUIRES",
    condition: { field: "area_type", operator: "EQ", value: "rural" },
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-gspsg", E_GSPSG_ELIGIBILITY, 0.95),
  },
  {
    id: "e:widow_pension_requires_income_urban",
    from: "service:widow_pension",
    to: "eligibility:income_under_150000_urban",
    type: "REQUIRES",
    condition: { field: "area_type", operator: "EQ", value: "urban" },
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-gspsg", E_GSPSG_ELIGIBILITY, 0.95),
  },
  {
    id: "e:widow_pension_requires_photo",
    from: "service:widow_pension",
    to: "document:widow_photograph",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    id: "e:widow_pension_requires_ration_card",
    from: "service:widow_pension",
    to: "document:ration_card",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "A copy, not the original, on the department's own list.",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    id: "e:widow_pension_requires_school_certificate",
    from: "service:widow_pension",
    to: "document:school_certificate",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "The school leaving certificate. Listed alongside the birth certificate, not instead of it.",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    // The cross journey pull. This points at the document, not at the service
    // that issues it, so the whole income certificate journey arrives
    // underneath this one without either file naming the other.
    id: "e:widow_pension_requires_income_certificate",
    from: "service:widow_pension",
    to: "document:income_certificate",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "If you do not already hold one, getting it is a journey of its own and it starts before this one.",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    id: "e:widow_pension_requires_husband_death_certificate",
    from: "service:widow_pension",
    to: "document:husband_death_certificate",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    id: "e:widow_pension_requires_election_card_or_aadhaar",
    from: "service:widow_pension",
    to: "document_group:election_card_or_aadhaar",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    id: "e:widow_pension_requires_electricity_bill",
    from: "service:widow_pension",
    to: "document:electricity_bill",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "The light bill. The department's list does not say how recent it has to be.",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    id: "e:widow_pension_requires_birth_certificate",
    from: "service:widow_pension",
    to: "document:birth_certificate",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    id: "e:widow_pension_requires_widowhood_certificate",
    from: "service:widow_pension",
    to: "document:widowhood_certificate",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    id: "e:widow_pension_next_mamlatdar_sanction",
    from: "service:widow_pension",
    to: "verification:mamlatdar_sanction",
    type: "NEXT",
    jurisdictionId: "IN-GJ",
    note: "You hand the form in, then the Mamlatdar verifies it and sanctions the assistance.",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_MAMLATDAR, 0.96),
  },
  {
    id: "e:widow_pension_visit_mamlatdar",
    from: "service:widow_pension",
    to: "office:mamlatdar_jan_seva_kendra",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ",
    note: "Both the form and the completed application go through the Taluka Mamlatdar.",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-gspsg", E_GSPSG_OFFLINE, 0.93),
  },
  {
    id: "e:widow_pension_handled_by_wcd",
    from: "service:widow_pension",
    to: "office:wcd_directorate_gandhinagar",
    type: "HANDLED_BY",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_OFFICES, 0.95),
  },
  {
    id: "e:widow_pension_produces_pension",
    from: "service:widow_pension",
    to: "output:ganga_swarupa_pension",
    type: "PRODUCES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:wcd-ganga", E_GANGA_AMOUNT, 0.95),
  },

  // -------------------------------------------------------------------------
  // Niradhar Vriddha, the Gujarat old age pension.
  // -------------------------------------------------------------------------
  {
    // The two age rules are mutually exclusive by condition, the same way the
    // driving licence file splits transport from non transport.
    id: "e:old_age_pension_requires_age_60",
    from: "service:old_age_pension",
    to: "eligibility:age_60_plus",
    type: "REQUIRES",
    condition: { field: "has_disability", operator: "NEQ", value: true },
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_AGE, 0.94),
  },
  {
    id: "e:old_age_pension_requires_disability_route",
    from: "service:old_age_pension",
    to: "eligibility:disabled_75_and_age_45",
    type: "REQUIRES",
    condition: { field: "has_disability", operator: "EQ", value: true },
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_DISABILITY, 0.92),
  },
  {
    id: "e:old_age_pension_requires_10_year_residence",
    from: "service:old_age_pension",
    to: "eligibility:gujarat_resident_10_years",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_RESIDENCY, 0.93),
  },
  {
    id: "e:old_age_pension_requires_no_earning_son",
    from: "service:old_age_pension",
    to: "eligibility:no_earning_son_or_grandson",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_DESTITUTION, 0.92),
  },
  {
    id: "e:old_age_pension_requires_income_or_bpl",
    from: "service:old_age_pension",
    to: "eligibility:old_age_income_or_bpl",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "NORMALIZED",
    sources: derived("src:sje-vrudh", E_VRUDH_INCOME, 0.9),
  },
  {
    id: "e:old_age_pension_next_mamlatdar_sanction",
    from: "service:old_age_pension",
    to: "verification:mamlatdar_sanction",
    type: "NEXT",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_AUTHORITY, 0.95),
  },
  {
    // The portal node itself belongs to the certificates journey and carries
    // its own sources. The evidence here is only that this official page
    // prints that URL as the online route, which is all anybody can say about
    // it: the portal was unreachable throughout the research.
    id: "e:old_age_pension_apply_digital_gujarat",
    from: "service:old_age_pension",
    to: "portal:digital_gujarat",
    type: "APPLY_AT",
    jurisdictionId: "IN-GJ",
    note: "The scheme page prints this as the online route, but the portal could not be reached during research, so no service name, fee or tracking screen is claimed for it here.",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_ONLINE, 0.94),
  },
  {
    id: "e:old_age_pension_visit_mamlatdar",
    from: "service:old_age_pension",
    to: "office:mamlatdar_jan_seva_kendra",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ",
    note: "The form is free here, and this is also where the online application can be filed for you.",
    verificationStatus: "VERIFIED",
    sources: [
      ...cite("src:sje-vrudh", E_VRUDH_FORM_FREE, 0.93),
      ...cite("src:sje-vrudh", E_VRUDH_ONLINE, 0.94),
    ],
  },
  {
    id: "e:old_age_pension_visit_gram_panchayat",
    from: "service:old_age_pension",
    to: "office:gram_panchayat",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ",
    note: "In a village, the computer entrepreneur at the Gram Panchayat files it online for you.",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_VCE, 0.92),
  },
  {
    id: "e:old_age_pension_escalate_provincial_officer",
    from: "service:old_age_pension",
    to: "office:provincial_officer",
    type: "ESCALATE_TO",
    jurisdictionId: "IN-GJ",
    note: "60 days from the rejection, and no longer.",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_APPEAL, 0.94),
  },
  {
    id: "e:old_age_pension_produces_pension",
    from: "service:old_age_pension",
    to: "output:niradhar_vriddha_pension",
    type: "PRODUCES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-vrudh", E_VRUDH_AMOUNT, 0.94),
  },

  // -------------------------------------------------------------------------
  // IGNWPS, the central widow pension.
  // -------------------------------------------------------------------------
  {
    id: "e:ignwps_requires_widow",
    from: "service:ignwps",
    to: "eligibility:widow",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-ignwps", E_IGNWPS_SCHEME, 0.95),
  },
  {
    id: "e:ignwps_requires_age",
    from: "service:ignwps",
    to: "eligibility:ignwps_age",
    type: "REQUIRES",
    note: "The published minimum age is 40 on two central pages and 18 on the Anand district page. Nothing here picks between them.",
    verificationStatus: "CONFLICTING",
    sources: [
      conflicting("src:myscheme-ignwps", E_IGNWPS_ELIGIBILITY, 0.9),
      conflicting("src:anand-ignwps", E_ANAND_IGNWPS, 0.8),
    ],
  },
  {
    id: "e:ignwps_requires_bpl",
    from: "service:ignwps",
    to: "eligibility:bpl_household",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:myscheme-ignwps",
      "The applicant should belong to a household living below the poverty line according to the criteria prescribed by the Govt. of India",
      0.9,
    ),
  },
  {
    id: "e:ignwps_requires_not_remarried",
    from: "service:ignwps",
    to: "eligibility:not_remarried",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-ignwps", E_IGNWPS_EXCLUSIONS, 0.92),
  },
  {
    id: "e:ignwps_requires_age_proof",
    from: "service:ignwps",
    to: "document_group:pension_age_proof",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-ignwps", E_IGNWPS_AGE_PROOF, 0.9),
  },
  {
    id: "e:ignwps_requires_bpl_certificate",
    from: "service:ignwps",
    to: "document:bpl_certificate",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ-ANAND",
    note: "From the Anand district list. It is the only published document list for this scheme in the research, so it is scoped to Anand rather than widened to the state.",
    verificationStatus: "VERIFIED",
    sources: cite("src:anand-ignwps", E_ANAND_IGNWPS_DOCS, 0.87),
  },
  {
    id: "e:ignwps_requires_address_proof",
    from: "service:ignwps",
    to: "document:pension_address_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ-ANAND",
    note: "From the Anand district list.",
    verificationStatus: "VERIFIED",
    sources: cite("src:anand-ignwps", E_ANAND_IGNWPS_DOCS, 0.87),
  },
  {
    id: "e:ignwps_requires_citizenship_proof",
    from: "service:ignwps",
    to: "document:citizenship_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ-ANAND",
    note: "From the Anand district list.",
    verificationStatus: "VERIFIED",
    sources: cite("src:anand-ignwps", E_ANAND_IGNWPS_DOCS, 0.87),
  },
  {
    id: "e:ignwps_apply_umang",
    from: "service:ignwps",
    to: "portal:umang",
    type: "APPLY_AT",
    note: "Log in with your mobile number and an OTP, then search for NSAP.",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-ignwps", E_UMANG, 0.88),
  },
  {
    id: "e:ignwps_visit_gram_panchayat",
    from: "service:ignwps",
    to: "office:gram_panchayat",
    type: "VISIT_AT",
    note: "Not stated as an application counter for this scheme. The Gram Panchayat is stated to be the body that identifies who qualifies, which is a different and earlier thing.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:nsap-about", E_NSAP_IDENTIFICATION, 0.85),
  },
  {
    id: "e:ignwps_handled_by_mord",
    from: "service:ignwps",
    to: "department:ministry_of_rural_development",
    type: "HANDLED_BY",
    verificationStatus: "VERIFIED",
    sources: cite("src:myscheme-ignwps", E_IGNWPS_SCHEME, 0.95),
  },
  {
    id: "e:ignwps_produces_pension",
    from: "service:ignwps",
    to: "output:ignwps_pension",
    type: "PRODUCES",
    note: "How much is disputed between three official pages. See the amounts on this node.",
    verificationStatus: "CONFLICTING",
    sources: [
      conflicting("src:myscheme-ignwps", E_IGNWPS_AMOUNT_MYSCHEME, 0.85),
      conflicting("src:nsap-about", E_IGNWPS_AMOUNT_NSAP, 0.85),
      conflicting("src:anand-ignwps", E_ANAND_IGNWPS, 0.8),
    ],
  },

  // -------------------------------------------------------------------------
  // IGNOAPS, the central old age pension, as Gujarat runs it.
  // -------------------------------------------------------------------------
  {
    id: "e:ignoaps_requires_age_60",
    from: "service:ignoaps",
    to: "eligibility:age_60_plus",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-ignoaps", E_SJE_IGNOAPS_ELIGIBILITY, 0.93),
  },
  {
    id: "e:ignoaps_requires_bpl_score",
    from: "service:ignoaps",
    to: "eligibility:bpl_score_0_to_20",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-ignoaps", E_SJE_IGNOAPS_ELIGIBILITY, 0.93),
  },
  {
    id: "e:ignoaps_requires_age_certificate",
    from: "service:ignoaps",
    to: "document_group:pension_age_proof",
    type: "REQUIRES",
    note: "Gujarat's page asks for an age certificate without saying what counts. The alternatives listed here are the central widow pension's list, borrowed because it is the only one the research has, so confirm at the counter.",
    verificationStatus: "NORMALIZED",
    sources: [
      ...cite("src:sje-ignoaps", E_SJE_IGNOAPS_DOCUMENTS, 0.93),
      ...derived("src:myscheme-ignwps", E_IGNWPS_AGE_PROOF, 0.8),
    ],
  },
  {
    id: "e:ignoaps_requires_bpl_certificate",
    from: "service:ignoaps",
    to: "document:bpl_certificate",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-ignoaps", E_SJE_IGNOAPS_DOCUMENTS, 0.93),
  },
  {
    id: "e:ignoaps_requires_address_proof",
    from: "service:ignoaps",
    to: "document:pension_address_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ-ANAND",
    note: "From the Anand district list, which asks for more than the state page does.",
    verificationStatus: "VERIFIED",
    sources: cite("src:anand-ignoaps", E_ANAND_IGNOAPS_DOCS, 0.88),
  },
  {
    id: "e:ignoaps_requires_citizenship_proof",
    from: "service:ignoaps",
    to: "document:citizenship_proof",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ-ANAND",
    note: "From the Anand district list, which asks for more than the state page does.",
    verificationStatus: "VERIFIED",
    sources: cite("src:anand-ignoaps", E_ANAND_IGNOAPS_DOCS, 0.88),
  },
  {
    id: "e:ignoaps_visit_mamlatdar",
    from: "service:ignoaps",
    to: "office:mamlatdar_jan_seva_kendra",
    type: "VISIT_AT",
    jurisdictionId: "IN-GJ",
    note: "Your respective Mamlatdar office, or the Jan Seva Kendra at your district collector office.",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-ignoaps", E_SJE_IGNOAPS_PLACE, 0.94),
  },
  {
    id: "e:ignoaps_visit_gram_panchayat",
    from: "service:ignoaps",
    to: "office:gram_panchayat",
    type: "VISIT_AT",
    note: "Not stated as an application counter for this scheme. The Gram Panchayat is stated to be the body that identifies who qualifies.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:nsap-about", E_NSAP_IDENTIFICATION, 0.85),
  },
  {
    id: "e:ignoaps_handled_by_mord",
    from: "service:ignoaps",
    to: "department:ministry_of_rural_development",
    type: "HANDLED_BY",
    verificationStatus: "VERIFIED",
    sources: cite("src:anand-ignoaps", E_ANAND_IGNOAPS, 0.9),
  },
  {
    id: "e:ignoaps_produces_pension",
    from: "service:ignoaps",
    to: "output:ignoaps_pension",
    type: "PRODUCES",
    note: "How much is disputed between the state page and the central page. See the amounts on this node.",
    verificationStatus: "CONFLICTING",
    sources: [
      conflicting("src:sje-ignoaps", E_IGNOAPS_AMOUNT_SJE, 0.92),
      conflicting("src:nsap-about", E_IGNOAPS_AMOUNT_NSAP, 0.88),
    ],
  },
];

export const requirementGroups: RequirementGroup[] = [
  {
    id: "rg:election_card_or_aadhaar",
    ownerNodeId: "document_group:election_card_or_aadhaar",
    mode: "ANY_OF",
    jurisdictionId: "IN-GJ",
    members: [{ nodeId: "document:election_card" }, { nodeId: "document:aadhaar" }],
    sources: cite("src:wcd-ganga", E_GANGA_DOCUMENTS, 0.95),
  },
  {
    // The page states a preference order, not a flat list of equals, so the
    // order survives in the member notes rather than being flattened away.
    id: "rg:pension_age_proof",
    ownerNodeId: "document_group:pension_age_proof",
    mode: "ANY_OF",
    members: [
      { nodeId: "document:birth_certificate", note: "Relied on first." },
      { nodeId: "document:school_certificate", note: "Relied on first, equally with the birth certificate." },
      { nodeId: "document:ration_card", note: "Considered only in the absence of a birth or school certificate." },
      {
        nodeId: "document:election_card",
        note: "The EPIC. Considered only in the absence of a birth or school certificate.",
      },
      {
        nodeId: "document:medical_officer_age_certificate",
        note: "Only if you have no valid document at all. Any Medical Officer of any government hospital may be authorised to issue it.",
      },
    ],
    sources: cite("src:myscheme-ignwps", E_IGNWPS_AGE_PROOF, 0.9),
  },
];

export const questions: QuestionDefinition[] = [
  // One question per field a condition or an eligibility rule above actually
  // reads. "age" and "annual_family_income" are not repeated here: the driving
  // licence and scholarship journeys already define them and the loader keeps
  // the first definition. Neither is "has_disability", which the scholarship
  // journey defines and the old age disability route reuses.
  {
    field: "is_widow",
    label: "Are you a widow?",
    help: "Both widow pensions are for widowed women. The state one is open from age 18, the central one is disputed between 18 and 40.",
    inputType: "BOOLEAN",
  },
  {
    field: "area_type",
    label: "Do you live in a rural or an urban area?",
    help: "The income ceiling is Rs. 1,20,000 a year in rural areas and Rs. 1,50,000 in urban areas, so this changes which limit applies to you.",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "rural", label: "Rural" },
      { value: "urban", label: "Urban" },
    ],
  },
  {
    field: "is_bpl",
    label: "Is your household on the below poverty line list?",
    help: "The central pensions are only for BPL households. The Gujarat state schemes use an income ceiling instead.",
    inputType: "BOOLEAN",
  },
  {
    field: "bpl_score",
    label: "What is your family's BPL score?",
    help: "It is on your BPL card. Gujarat asks for 0 to 20 for the central old age pension, and the Anand district page asks for 0 to 16, so the two do not agree.",
    inputType: "NUMBER",
  },
  {
    field: "has_remarried",
    label: "Have you remarried?",
    help: "The central widow pension stops on remarriage.",
    inputType: "BOOLEAN",
  },
  {
    field: "disability_percentage",
    label: "What percentage disability is on your certificate?",
    help: "More than 75 percent opens the Gujarat old age pension from 45 instead of 60.",
    inputType: "NUMBER",
  },
  {
    field: "years_resident_in_gujarat",
    label: "How many years have you lived in Gujarat?",
    help: "The state old age pension needs at least 10 years of permanent residence. Living here now is not enough on its own.",
    inputType: "NUMBER",
  },
  {
    field: "has_earning_son_or_grandson_21_plus",
    label: "Do you have a son or grandson aged 21 or over who is able to support you?",
    help: "Answer no if he is mentally unstable, disabled, unable to earn, or suffering a serious illness such as cancer or T.B. The scheme page treats those as exceptions and you can still apply.",
    inputType: "BOOLEAN",
  },
];
