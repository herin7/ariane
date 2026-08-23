import type {
  GraphEdge,
  GraphNode,
  QuestionDefinition,
  RequirementGroup,
  Source,
  SourceRef,
} from "../../types";

/**
 * Scholarships: the National Scholarship Portal schemes and the Gujarat ones.
 *
 * Same rule as the driving licence and certificate files. Every claim carries
 * the sentence it was read off, quoted exactly as the page prints it. Where two
 * official pages disagree, both are kept and both are marked CONFLICTING.
 * Nothing here was inferred, rounded or remembered.
 *
 * The income certificate and the caste certificate are not defined here. They
 * are nodes in the certificates journey, and the scholarship services point at
 * the document ids rather than at the services that issue them, so asking for a
 * scholarship pulls the whole income certificate journey in underneath it, in
 * order, without either file knowing about the other.
 *
 * The big hole, stated up front: digitalgujarat.gov.in and gssp.gujarat.gov.in
 * are both hard blocked and returned nothing to the crawl. So the Gujarat state
 * scholarship portal's own workflow is absent here. In particular there is no
 * Gujarat state required document list, no state application window for
 * AY 2026-27, and no institute verification step on the state schemes. The
 * research could not establish whether the state schemes have one, and an
 * invented verification step is worse than a missing one, so the Gujarat SJE
 * services below carry eligibility, the application portal and the implementing
 * office, and nothing else.
 *
 * Also deliberately missing, because no retrieved page stated it:
 * NSP opening and closing dates for FRESH applications in AY 2026-27 (only the
 * 1 June 2026 portal opening and the currently open CSSS renewal round are
 * evidenced), a domicile certificate anywhere in the NSP document lists (NSP
 * asks for Domicile State as a form selection, not as an upload, so the
 * document:domicile_certificate node is deliberately not wired to any
 * scholarship), the required document lists for the Gujarat SJE schemes
 * (BCK-6.1, NT/DNT, Merit-cum-Means), the top 20 percentile CSSS merit rule
 * (the claim states it but the retrieved sentence does not), the MYSY tuition
 * fee rupee caps and the BCK-6.1 group-wise allowance table (both are printed
 * as tables the crawl did not capture as text), and any helpline, tracking page
 * or grievance channel specific to Gujarat state scholarships.
 *
 * One more caveat worth carrying to the counter: the FAQs retrieved are the
 * 2025-26 editions, so the income certificate coverage period below is stated
 * for AY 2025-26 and will move.
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

// The long lists, quoted once each so the facts drawn out of them cannot drift
// apart from the sentence they came from.
const E_FRESH_UPLOADS =
  "FRESH: 12th Mark Sheet, Family Income Certificate, Category/ caste Certification for reserved category students, Disability Certificate (if applicable)";

const E_OTR_MANDATORY =
  "One Time Registration (OTR) is mandatory to avail scholarships. It is a unique number allotted to the candidate for the entire academic career and can be generated through National Scholarship Portal OTR Registration.";

const E_OTR_PREREQUISITES =
  "To create OTR, student should first keep the following documents ready: (a) Active mobile number, (b) Aadhaar number (in absence of Aadhaar Number, Aadhaar Enrollment ID), (c) Mobile number linked with Aadhaar.";

const E_INCOME_CERTIFICATE_ISSUER =
  "Income Certificate: Fresh applicants should upload latest family Income certificate for the year 2025-26 (Issued for the period from 1st April 2024 to 31st March 2025). and which should be issued by a competent authority to issue these certificates by the State Government (Certificate signed by Notary is not valid).";

const E_DBT =
  "Scholarship is disbursed through Direct Benefit Transfer (DBT) mode i.e. directly into the bank accounts of the beneficiary. The scholarship amount will be disbursed in the Aadhaar Seeded Bank Account.";

const E_INSTITUTE_VERIFICATION =
  "After finally submitting the applications on the portal students are advised to get their online application verified by the respective institutions before the cut-off date. Application which is not verified either by the institute or by the concerned State Higher Education Department /State Nodal Agency or by both will be treated as ‘Invalid’.";

const E_TOP_CLASS_DOCUMENTS =
  "Valid SC Certificate, Income Certificate, Aadhaar, Aadhaar-seeded bank account details, admission details, admission rank and fee details as prescribed on NSP.";

const E_MYSY_DOCUMENTS =
  "01. Income certificate.\n02. Adhaar Card.\n03. Self-declaration form.\n04. Certificate from the institute for new students.\n05. Renewal certificate from institute.\n06. Self-declaration for non-IT returns.\n07. 10th and 12th standard mark sheet.\n08. Admission letter and fee receipt.\n09. Bank account proof.\n10. Hostel admission letter and fee receipt.\n11. Affidavit (non-judicial stamp paper Rs 20).\n12. Recent passport-size photo.";

const E_MYSY_INCOME_VALIDITY =
  "The State Government has approved the validity of the income certificate for three financial years from the date of issue. Accordingly, a candidate who has a valid income certificate need not have to issue it again for the next three years financial years.";

const E_CSSS_RENEWAL_ROUND =
  "Renewal applications for the \"PM-USP – Central Sector Scheme Of Scholarship For College And University Students (CSSS) (Merit Based Scheme)\" and \"PM USP Special Scholarship Scheme For Jammu Kashmir And Ladakh (Merit Based Scheme)\" is currently open in NSP. Closing dates for student application is 31-10-2026 and closing date for institute verification is : 15-11-2026 and closing date for L2 verification is : 30/11/2026";

const E_CHECK_YOUR_STATUS =
  "You have to login under the option ‘Student Login’ by entering your Aadhaar number/ OTR number. After login, under the option ‘My Application’, you will be able to view the option ‘Check Your Status’ against your Application ID.";

const E_NSP_HELPDESK =
  "If you experience any technical issues, please contact the NSP Helpdesk:\n\nEmail: helpdesk@nsp.gov.in\n\nPhone: 0120-6619540 (Available from 8:00 AM to 8:00 PM on all days except government holidays)";

export const sources: Source[] = [
  // The two Gujarat state scholarship portals are not listed here. Every
  // digitalgujarat.gov.in path returned ERR_TUNNEL_CONNECTION_FAILED and
  // gssp.gujarat.gov.in failed to load twice. Nothing was read off either, and
  // a source nobody can quote is not a source.
  {
    id: "src:nsp-students",
    url: "https://scholarships.gov.in/Students",
    title: "NSP - Students | National Scholarship Portal",
    domain: "scholarships.gov.in",
    sourceType: "PORTAL_HOME",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:nsp-csss-faq",
    url: "https://scholarships.gov.in/public/schemeGuidelines/FAQ_DOHE_CSSS.pdf",
    title:
      "PM-USP Central Sector Scheme of Scholarship for College and University Students (CSSS) - FAQs 2025-26, Ministry of Education, Department of Higher Education",
    domain: "scholarships.gov.in",
    sourceType: "PDF",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:nsp-st-faq",
    url: "https://scholarships.gov.in/public/schemeGuidelines/tribalfellowshipfaq.pdf",
    title:
      "Annexure II - FAQs for Students for NSP A.Y-2025-26, National Fellowship and Scholarship for Higher Education of ST Students, Ministry of Tribal Affairs",
    domain: "scholarships.gov.in",
    sourceType: "PDF",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:nsp-topclass-faq",
    url: "https://scholarships.gov.in/public/schemeGuidelines/Top_Class_Education_Scheme_2018_FAQ.pdf",
    title: "Frequently Asked Questions (FAQs) Top Class Education Scheme for SC Students",
    domain: "scholarships.gov.in",
    sourceType: "PDF",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:nsp-eligibility",
    url: "https://scholarships.gov.in/scholarshipEligibility",
    title: "Scholarship Eligibility Check | National Scholarship Portal",
    domain: "scholarships.gov.in",
    sourceType: "SERVICE_PAGE",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:sje-bck61",
    url: "https://sje.gujarat.gov.in/dscw/schemes/1521?lang=english",
    title:
      "GOI's Post Matric Scholarship for SC Students (BCK-6.1) | Director, Scheduled Caste Welfare, Gujarat",
    domain: "sje.gujarat.gov.in",
    sourceType: "GUIDELINE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:sje-ntdnt",
    url: "https://sje.gujarat.gov.in/ddcw/schemes/2226?lang=english",
    title:
      "Educational scheme for Nomadic / De-notified Tribes students in self finance institutes | Director, Developing Castes Welfare, Gujarat",
    domain: "sje.gujarat.gov.in",
    sourceType: "GUIDELINE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:sje-mcm",
    url: "https://sje.gujarat.gov.in/ddcw/schemes/1492?lang=English",
    title:
      "Merit-cum-Means Scholarship (for Minority Communities) | Director, Developing Castes Welfare, Gujarat",
    domain: "sje.gujarat.gov.in",
    sourceType: "GUIDELINE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:sje-medeng",
    url: "https://sje.gujarat.gov.in/ddcw/schemes/1482?lang=english",
    title:
      "Financial Assistance to Purchase Medical and Engineering Books/Instruments | Director, Developing Castes Welfare, Gujarat",
    domain: "sje.gujarat.gov.in",
    sourceType: "GUIDELINE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
  {
    // The certificates journey cites the same page under src:myscheme-mysy.
    // Two ids for one URL is the price of each journey file standing on its
    // own, and it is cheaper than one file reaching into another.
    id: "src:mysy-myscheme",
    url: "https://www.myscheme.gov.in/schemes/mysy",
    title:
      "Mukhyamantri Yuva Swavalamban Yojana | myScheme, National Government Services Portal (NeGD, MeitY)",
    domain: "myscheme.gov.in",
    sourceType: "GUIDELINE",
    jurisdictionId: "IN-GJ",
    retrievedAt: RETRIEVED,
  },
];

export const nodes: GraphNode[] = [
  // -- services ------------------------------------------------------------
  {
    id: "service:nsp_scholarship",
    type: "SERVICE",
    name: "Scholarship on the National Scholarship Portal",
    officialName: "National Scholarship Portal",
    aliases: [
      "scholarship",
      "scholarships",
      "nsp",
      "national scholarship portal",
      "scholarship application",
      "post matric scholarship",
      "student scholarship",
    ],
    description:
      "The single application every central scholarship scheme is applied for through. You register once for an OTR number, fill one form, upload your documents, and then your institute and the Ministry verify it.",
    jurisdictionId: "IN",
    metadata: {
      whyRequired:
        "Every central scheme, and the Gujarat SC post matric scheme that follows the Government of India guidelines, is applied for here. Without a verified application on this portal there is no scholarship to disburse.",
      whatToDo:
        "Log in as a student with your Aadhaar or OTR number, select your Domicile State and the Post-Matric option to generate an Application ID, fill the form, and upload each document as a .pdf or .jpeg under 200 KB. Then chase your institute to verify it before the cut-off date.",
      expectedOutput:
        "A verified application, and the scholarship paid by Direct Benefit Transfer into your Aadhaar seeded bank account.",
      fee: "No fee. Applying on the National Scholarship Portal is free.",
      timeline: "The portal is open for academic year 2026-27 from 1 June 2026 onwards.",
    },
    sources: [
      {
        sourceId: "src:nsp-students",
        evidence: "The Portal is open for Academic year 2026-27 from 1'st June 2026 onwards.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-csss-faq",
        evidence: "No, application on the National Scholarship Portal is completely free of cost.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "The format of the file should be .pdf and .jpeg and the size of each document should not exceed more than 200 KB. Also please upload documents which are clearly visible.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_CHECK_YOUR_STATUS,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:nsp_otr",
    type: "SERVICE",
    name: "One Time Registration on the National Scholarship Portal",
    officialName: "One Time Registration (OTR)",
    aliases: ["otr", "one time registration", "nsp registration"],
    description:
      "A 14 digit number issued against your Aadhaar that lasts your whole academic career. You do this once, before any scholarship application.",
    jurisdictionId: "IN",
    metadata: {
      whyRequired:
        "One Time Registration (OTR) is mandatory to avail scholarships. No OTR means no application, for any scheme.",
      whatToDo:
        "Keep an active mobile number that is linked to your Aadhaar, and your Aadhaar number or Aadhaar Enrolment ID, then register on the OTR page.",
      expectedOutput: "A 14 digit OTR number, good for your entire academic career.",
    },
    sources: [
      {
        sourceId: "src:nsp-students",
        evidence: E_OTR_MANDATORY,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-students",
        evidence:
          "One Time Registration (OTR) is a unique 14-digit number issued based on the Aadhaar/Aadhaar Enrolment ID (EID) and is applicable for the entire academic career of the student.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:pm_usp_csss",
    type: "SERVICE",
    name: "PM-USP scholarship for college and university students",
    officialName:
      "PM-USP Central Sector Scheme of Scholarship for College and University Students (CSSS)",
    aliases: ["csss", "pm usp csss", "pm-usp csss", "central sector scheme of scholarship"],
    description:
      "The merit based central scholarship for college and university students, applied for on the National Scholarship Portal.",
    jurisdictionId: "IN",
    metadata: {
      expectedOutput:
        "Rs. 12,000 per annum at graduation level for the first three years, and Rs. 20,000 per annum at post-graduation level.",
      timeline:
        "The renewal round now open closes for student applications on 31-10-2026, institute verification on 15-11-2026 and L2 verification on 30/11/2026. No fresh application dates for AY 2026-27 are published yet.",
    },
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence:
          "The rate of scholarship is Rs. 12,000/- per annum at Graduation level for first three years of College and University courses and Rs. 20,000/- per annum at Post-Graduation level.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-students",
        evidence: E_CSSS_RENEWAL_ROUND,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:top_class_sc",
    type: "SERVICE",
    name: "Top Class Education Scheme for SC students",
    officialName: "Top Class Education Scheme for SC Students",
    aliases: ["top class", "top class education scheme", "top class scholarship"],
    description:
      "For Scheduled Caste students admitted to a notified institution on a full time course. The number of places is capped, so the institute's slot limit decides as much as your marks do.",
    jurisdictionId: "IN",
    metadata: {
      timeline:
        "Institute verification closes 31 October every year, or any other date notified by DBT Mission.",
    },
    sources: [
      {
        sourceId: "src:nsp-topclass-faq",
        evidence:
          "SC students with annual family income up to Rs.8.00 lakh, admitted in a full-time prescribed course in a notified institution, subject to the allotted slots.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-topclass-faq",
        evidence: "31 October every year or any other date notified by DBT Mission.",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:gujarat_post_matric_sc",
    type: "SERVICE",
    name: "Post Matric Scholarship for SC students in Gujarat",
    officialName: "GOI's Post Matric Scholarship for SC Students (CSS)",
    aliases: ["bck-6.1", "bck 6.1", "post matric scholarship sc gujarat"],
    description:
      "The Gujarat run version of the Government of India post matric scholarship for Scheduled Caste students. Scheme code BCK-6.1, applied for on Digital Gujarat.",
    jurisdictionId: "IN-GJ",
    metadata: {
      expectedOutput:
        "A group-wise academic allowance, plus approved tuition fee and approved other fees. A disability allowance is admissible if the student is disabled.",
    },
    sources: [
      {
        sourceId: "src:sje-bck61",
        evidence:
          "Student should be of Scheduled Caste.\n- Must full fill all conditions of Government of India's Post Matric Scholarship Scheme Guidelines.\n- Income Limit 2.50 Lakh.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:sje-bck61",
        evidence:
          "In addition to the above allowance, Approved tuition fee and Approved other fees are admissible, If the student is disabled then disability allowance is admissible.",
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:gujarat_nt_dnt_self_finance",
    type: "SERVICE",
    name: "Scholarship for Nomadic and De-notified Tribe students in self finance institutes",
    officialName:
      "Educational scheme for Nomadic / De-notified Tribes students in self finance institutes",
    aliases: ["nt dnt scholarship", "vichrati jati scholarship"],
    description:
      "For Nomadic and De-notified Tribe students studying in a self finance institute that is certified by the government.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:sje-ntdnt",
        evidence:
          "Student must be from Nomadic / De-notified Tribes\n- Annual income limit is Rs. 2,00,000/-\n- Studying in self finance institutes\n- Institutes must be certified by government.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:gujarat_mcm_minority",
    type: "SERVICE",
    name: "Merit-cum-Means scholarship for minority communities",
    officialName: "Merit-cum-Means Scholarship (for Minority Communities)",
    aliases: ["merit cum means", "mcm scholarship", "minority scholarship"],
    description:
      "For students of the six notified religious minorities on a professional course such as medicine or engineering. The form is filled on the minority affairs portal, not on Digital Gujarat.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:sje-mcm",
        evidence:
          "Muslim, Christian, Shikh, Buddh, Jain and Parsi (Religious minorities)\n- Annual income limit is Rs. 2,50,000/-\n- Online form is filled momascholarship.gov.in\n- For professional courses like Medical and Engineering.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:gujarat_med_eng_books",
    type: "SERVICE",
    name: "Help with buying medical and engineering books and instruments",
    officialName: "Financial Assistance to Purchase Medical and Engineering Books/Instruments",
    aliases: ["book assistance", "instrument assistance"],
    description:
      "A Gujarat grant towards the books and instruments a medical or engineering course makes you buy.",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:sje-medeng",
        evidence: "Student should be studying in Medical and Engineering\n- Annual Income Limit Rs. 2,50,000/-",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:mysy",
    type: "SERVICE",
    name: "Mukhyamantri Yuva Swavalamban Yojana (MYSY)",
    officialName: "Mukhyamantri Yuva Swavalamban Yojana",
    aliases: ["mysy", "yuva swavalamban", "cm scholarship gujarat"],
    description:
      "The Gujarat merit scholarship for students on self finance courses. It has its own portal and its own twelve document list, and it is the one Gujarat scheme with a published income certificate validity rule.",
    jurisdictionId: "IN-GJ",
    metadata: {
      expectedOutput:
        "A tuition fee grant applicable for self-finance courses, at 50% of the annual tuition fee. The rupee caps are printed as a table the crawl did not capture, so ask the portal for your course.",
      whatToDo:
        "Apply on the MYSY portal with all twelve documents. If you already hold a valid income certificate you do not need a new one, it stays valid for three financial years.",
    },
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence:
          "The candidates whose parents annual income is not more than Rs. 6,00,000/- per annum shall only be considered eligible for the said scheme.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:mysy-myscheme",
        evidence: "NOTE: Applicable for Self-Finance Courses. Amount of 50% of the annual Tuition Fee.",
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- eligibility ---------------------------------------------------------
  // Income ceilings differ per scheme, so each one is its own rule rather than
  // a shared "poor enough" node. A student can clear one and fail another.
  {
    id: "eligibility:csss_income_4_5_lakh",
    type: "ELIGIBILITY",
    name: "Family income up to Rs. 4.5 lakh per annum (PM-USP CSSS)",
    jurisdictionId: "IN",
    metadata: { rule: { field: "annual_family_income", operator: "LTE", value: 450000 } },
    sources: cite("src:nsp-csss-faq", "Having family income upto Rs. 4.5 lakh per annum", 0.95),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:csss_regular_course",
    type: "ELIGIBILITY",
    name: "On a regular course, not correspondence or distance mode",
    jurisdictionId: "IN",
    metadata: { rule: { field: "course_mode", operator: "EQ", value: "regular" } },
    sources: cite(
      "src:nsp-csss-faq",
      "Students pursuing regular course (not correspondence or distance mode)",
      0.9,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:csss_no_other_scholarship_and_not_diploma",
    type: "ELIGIBILITY",
    name: "Not on another scholarship, and not a diploma student",
    description:
      "PM-USP CSSS turns you down for either reason: any other scholarship or fee reimbursement, or a diploma course.",
    jurisdictionId: "IN",
    metadata: {
      rule: {
        all: [
          { field: "receiving_other_scholarship", operator: "EQ", value: false },
          { field: "course_type", operator: "NEQ", value: "diploma" },
        ],
      },
    },
    sources: cite(
      "src:nsp-csss-faq",
      "Not receiving any other scholarship or fee reimbursement of any kind\n\n• Diploma students are not eligible under the scheme.",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:csss_renewal_marks_and_attendance",
    type: "ELIGIBILITY",
    name: "At least 50% marks and at least 75% attendance",
    description: "The bar for keeping a PM-USP CSSS scholarship going year on year.",
    jurisdictionId: "IN",
    metadata: {
      rule: {
        all: [
          { field: "previous_year_marks_percent", operator: "GTE", value: 50 },
          { field: "attendance_percent", operator: "GTE", value: 75 },
        ],
      },
    },
    sources: cite(
      "src:nsp-csss-faq",
      "Student must secure at least 50% marks and maintain adequate attendance of at least 75%.",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:top_class_sc_income_8_lakh",
    type: "ELIGIBILITY",
    name: "Scheduled Caste with family income up to Rs. 8 lakh per annum",
    jurisdictionId: "IN",
    metadata: {
      rule: {
        all: [
          { field: "category", operator: "EQ", value: "sc" },
          { field: "annual_family_income", operator: "LTE", value: 800000 },
        ],
      },
    },
    sources: cite(
      "src:nsp-topclass-faq",
      "SC students with annual family income up to Rs.8.00 lakh, admitted in a full-time prescribed course in a notified institution, subject to the allotted slots.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:top_class_no_similar_scholarship",
    type: "ELIGIBILITY",
    name: "Not already on a similar Central or State scholarship",
    jurisdictionId: "IN",
    metadata: { rule: { field: "receiving_other_scholarship", operator: "EQ", value: false } },
    sources: cite(
      "src:nsp-topclass-faq",
      "No. A beneficiary cannot simultaneously avail similar scholarship from Central/State Government.",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:bck61_sc_income_2_5_lakh",
    type: "ELIGIBILITY",
    name: "Scheduled Caste with family income up to Rs. 2.5 lakh (BCK-6.1)",
    jurisdictionId: "IN-GJ",
    metadata: {
      rule: {
        all: [
          { field: "category", operator: "EQ", value: "sc" },
          { field: "annual_family_income", operator: "LTE", value: 250000 },
        ],
      },
    },
    sources: cite(
      "src:sje-bck61",
      "Student should be of Scheduled Caste.\n- Must full fill all conditions of Government of India's Post Matric Scholarship Scheme Guidelines.\n- Income Limit 2.50 Lakh.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:nt_dnt_income_2_lakh_self_finance",
    type: "ELIGIBILITY",
    name: "Nomadic or De-notified Tribe, income up to Rs. 2 lakh, in a self finance institute",
    jurisdictionId: "IN-GJ",
    metadata: {
      rule: {
        all: [
          { field: "category", operator: "EQ", value: "nt_dnt" },
          { field: "annual_family_income", operator: "LTE", value: 200000 },
          { field: "institute_type", operator: "EQ", value: "self_finance" },
        ],
      },
    },
    sources: cite(
      "src:sje-ntdnt",
      "Student must be from Nomadic / De-notified Tribes\n- Annual income limit is Rs. 2,00,000/-\n- Studying in self finance institutes\n- Institutes must be certified by government.",
      0.93,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:mcm_minority_income_2_5_lakh",
    type: "ELIGIBILITY",
    name: "Notified religious minority, income up to Rs. 2.5 lakh, professional course",
    jurisdictionId: "IN-GJ",
    metadata: {
      rule: {
        all: [
          {
            field: "religion",
            operator: "IN",
            value: ["muslim", "christian", "sikh", "buddhist", "jain", "parsi"],
          },
          { field: "annual_family_income", operator: "LTE", value: 250000 },
          { field: "course_type", operator: "IN", value: ["medical", "engineering"] },
        ],
      },
    },
    sources: cite(
      "src:sje-mcm",
      "Muslim, Christian, Shikh, Buddh, Jain and Parsi (Religious minorities)\n- Annual income limit is Rs. 2,50,000/-\n- Online form is filled momascholarship.gov.in\n- For professional courses like Medical and Engineering.",
      0.93,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:med_eng_books_income_2_5_lakh",
    type: "ELIGIBILITY",
    name: "Medical or engineering student with income up to Rs. 2.5 lakh",
    jurisdictionId: "IN-GJ",
    metadata: {
      rule: {
        all: [
          { field: "course_type", operator: "IN", value: ["medical", "engineering"] },
          { field: "annual_family_income", operator: "LTE", value: 250000 },
        ],
      },
    },
    sources: cite(
      "src:sje-medeng",
      "Student should be studying in Medical and Engineering\n- Annual Income Limit Rs. 2,50,000/-",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:mysy_income_6_lakh",
    type: "ELIGIBILITY",
    name: "Parents' annual income not more than Rs. 6 lakh (MYSY)",
    jurisdictionId: "IN-GJ",
    metadata: { rule: { field: "annual_family_income", operator: "LTE", value: 600000 } },
    sources: cite(
      "src:mysy-myscheme",
      "The candidates whose parents annual income is not more than Rs. 6,00,000/- per annum shall only be considered eligible for the said scheme.",
      0.93,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:mysy_std_12_percentile_80",
    type: "ELIGIBILITY",
    name: "Minimum 80 percentile in Std XII from a Gujarat board",
    description:
      "For a bachelor's degree. The research also records percentile rules for diploma routes, but only the degree sentence was retrieved in full, so only that one is a rule here.",
    jurisdictionId: "IN-GJ",
    metadata: { rule: { field: "class_12_percentile", operator: "GTE", value: 80 } },
    sources: cite(
      "src:mysy-myscheme",
      "For scholarship in Bachelor's degree programs, the candidates should have passed Std XII Science/ General stream from a recognized board from the state of Gujarat with a minimum 80 percentile in the board examination.",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:nsp_private_college_recognised",
    type: "ELIGIBILITY",
    name: "A private college counts, if it is recognised and on AISHE",
    description:
      "Deliberately carries no machine rule. Whether your college is AICTE or UGC recognised and listed on AISHE is a fact about the college, not about you, so it is checked on the AISHE portal rather than asked of you.",
    jurisdictionId: "IN",
    sources: cite(
      "src:nsp-csss-faq",
      "Yes, provided the private college is recognized by a regulatory body (like AICTE, UGC, etc.) and listed on the AISHE portal.",
      0.9,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  // The two nodes below are the two halves of a live contradiction between two
  // official pages. Neither carries a rule, so neither can silently disqualify
  // anybody. The contradiction itself is carried on the edges.
  {
    id: "eligibility:nsp_one_merit_plus_welfare",
    type: "ELIGIBILITY",
    name: "One merit-based scheme plus one or more welfare-based schemes",
    jurisdictionId: "IN",
    sources: cite(
      "src:nsp-students",
      "Students may apply for one merit-based scholarship scheme and one or more welfare-based scholarship schemes from AY 2026–27, as per scheme eligibility criteria.",
      0.93,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:nsp_single_scheme_only",
    type: "ELIGIBILITY",
    name: "One scholarship scheme only",
    jurisdictionId: "IN",
    sources: cite(
      "src:nsp-st-faq",
      "A student cannot apply for more than one Scholarship Scheme.",
      0.75,
    ),
    lastVerifiedAt: RETRIEVED,
  },

  // -- documents -----------------------------------------------------------
  // document:aadhaar and document:passport_photo come from the driving licence
  // journey, document:income_certificate, document:caste_certificate and
  // document:bank_passbook from the certificates journey. They are referenced
  // below, never redefined.
  {
    id: "document:otr_number",
    type: "DOCUMENT",
    name: "One Time Registration (OTR) number",
    aliases: ["otr number", "otr"],
    description: "A 14 digit number, issued once, good for your entire academic career.",
    jurisdictionId: "IN",
    sources: cite(
      "src:nsp-students",
      "One Time Registration (OTR) is a unique 14-digit number issued based on the Aadhaar/Aadhaar Enrolment ID (EID) and is applicable for the entire academic career of the student.",
      0.95,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:aadhaar_enrolment_id",
    type: "DOCUMENT",
    name: "Aadhaar Enrolment ID (EID)",
    aliases: ["eid", "aadhaar enrollment id", "enrolment slip"],
    description:
      "The slip you get while your Aadhaar is still being made. It gets you as far as applying, not as far as being paid.",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite(
      "src:nsp-csss-faq",
      "Yes, if you do not have an Aadhaar number, you may apply using your Aadhaar Enrollment ID, but update the Aadhaar on receiving the Aadhaar number, as Aadhaar is mandatory for final scholarship disbursal.",
      0.93,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:parent_aadhaar",
    type: "DOCUMENT",
    name: "Parent's Aadhaar",
    description:
      "Stands in for the student's own Aadhaar while the student is a minor. It stops working at 18.",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite(
      "src:nsp-csss-faq",
      "Yes, minor applicants can apply with their Parent’s Aadhaar but the applicant must submit their Aadhaar on attaining the age of 18 years.",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:mobile_linked_to_aadhaar",
    type: "DOCUMENT",
    name: "Active mobile number linked with Aadhaar",
    description:
      "Not a piece of paper, but the portal treats it as one. Change your number midway and you lose the thread of your own application.",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_OTR_PREREQUISITES,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "Yes, mobile number is compulsory for applying for Scholarship Scheme through National Scholarship Portal and it should remain same throughout the tenure of the scholarship.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:class_12_marksheet",
    type: "DOCUMENT",
    name: "Class 12 mark sheet",
    aliases: ["12th marksheet", "hsc marksheet", "std xii mark sheet"],
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_FRESH_UPLOADS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:class_10_marksheet",
    type: "DOCUMENT",
    name: "Class 10 mark sheet",
    aliases: ["10th marksheet", "ssc marksheet"],
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:previous_year_marksheet",
    type: "DOCUMENT",
    name: "Previous year mark sheet",
    description: "The renewal document. It is what a renewal application is mostly made of.",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite("src:nsp-csss-faq", "RENEWAL: Previous Year Mark Sheet", 0.92),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:disability_certificate",
    type: "DOCUMENT",
    name: "Disability certificate",
    jurisdictionId: "IN",
    sources: cite("src:nsp-csss-faq", "Disability Certificate (if applicable)", 0.9),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:bonafide_certificate",
    type: "DOCUMENT",
    name: "Bonafide student certificate",
    description:
      "Your institution writes it, on the format NSP prints inside the application form. You cannot produce this one yourself.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "INSTITUTE",
      whatToDo:
        "Take the format from the NSP application form to your college office and ask them to sign it.",
    },
    sources: cite(
      "src:nsp-st-faq",
      "Bonafide Student of the institution (as per the format given by NSP in application form)",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:top_class_admission_and_rank_details",
    type: "DOCUMENT",
    name: "Admission details, admission rank and fee details",
    description: "As prescribed on NSP for the Top Class Education Scheme.",
    jurisdictionId: "IN",
    sources: [
      {
        sourceId: "src:nsp-topclass-faq",
        evidence: E_TOP_CLASS_DOCUMENTS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:employer_income_certificate",
    type: "DOCUMENT",
    name: "Employer's income certificate",
    description:
      "For salaried parents under the Top Class scheme. Your parent's employer has to issue it, which puts the wait outside your control.",
    jurisdictionId: "IN",
    metadata: { blockedBy: "EMPLOYER" },
    sources: cite(
      "src:nsp-topclass-faq",
      "Self-employed parents: certificate by Revenue Officer not below Tehsildar. Salaried parents: employer certificate and Revenue Officer certificate for other income.",
      0.93,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:sibling_affidavit",
    type: "DOCUMENT",
    name: "Affidavit on siblings",
    description: "Top Class benefits stop at two siblings, and the affidavit is how that is checked.",
    jurisdictionId: "IN",
    sources: cite(
      "src:nsp-topclass-faq",
      "No. Benefits are restricted to two siblings. An affidavit is required.",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:mysy_institute_certificate",
    type: "DOCUMENT",
    name: "Institute certificate for MYSY",
    description:
      "A certificate from the institute for new students, or a renewal certificate from the institute if you are continuing. Either way the institute writes it.",
    jurisdictionId: "IN-GJ",
    metadata: { blockedBy: "INSTITUTE" },
    sources: cite(
      "src:mysy-myscheme",
      "04. Certificate from the institute for new students.\n05. Renewal certificate from institute.",
      0.88,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:mysy_self_declaration",
    type: "DOCUMENT",
    name: "Self-declaration form (MYSY)",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:mysy_non_it_return_declaration",
    type: "DOCUMENT",
    name: "Self-declaration for non-IT returns (MYSY)",
    jurisdictionId: "IN-GJ",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:admission_letter_and_fee_receipt",
    type: "DOCUMENT",
    name: "Admission letter and fee receipt",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:hostel_admission_letter_and_fee_receipt",
    type: "DOCUMENT",
    name: "Hostel admission letter and fee receipt",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:mysy_affidavit",
    type: "DOCUMENT",
    name: "Affidavit on non-judicial stamp paper of Rs 20 (MYSY)",
    jurisdictionId: "IN-GJ",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- things you do, and things done to you --------------------------------
  {
    id: "action:generate_application_id",
    type: "ACTION",
    name: "Generate your Application ID",
    description:
      "Select your Domicile State and the Post-Matric option from the drop-down menu. Until you do this you have no Application ID, and without an Application ID there is nothing to track.",
    jurisdictionId: "IN",
    metadata: {
      expectedOutput: "An Application ID.",
    },
    sources: cite(
      "src:nsp-csss-faq",
      "the students are required to select their Domicile State and the “Post-Matric” option from the drop-down menu.",
      0.9,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:check_institute_aishe_status",
    type: "ACTION",
    name: "Check your institute's AISHE status is ACTIVE",
    description:
      "Worth doing before you apply, not after. An INACTIVE institute means the money never leaves, however perfect your application is.",
    jurisdictionId: "IN",
    metadata: {
      couldBlock: ["An institute whose AISHE status is INACTIVE stops the payment."],
      url: "https://dcf.aishe.nic.in/aishenew/#/details/knowAisheCode",
    },
    sources: derived(
      "src:nsp-csss-faq",
      "the scholarship payment won’t be released to the students studying in the institutes whose Status is INACTIVE.",
      0.85,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:aadhaar_seed_bank_account",
    type: "ACTION",
    name: "Get your bank account Aadhaar seeded",
    description:
      "Linking your 12 digit Aadhaar to your bank account number. The scholarship is paid into the Aadhaar seeded account and nowhere else, so an unseeded account is a silent failure at the very end.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "BANK",
      whatToDo:
        "Visit the branch where you hold the account and submit the duly filled consent form.",
      couldBlock: ["Without seeding, the DBT payment has nowhere to land."],
    },
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence:
          "The Aadhaar Seeding means linking Aadhaar holder’s Unique 12-digit AADHAAR number with their Bank Account number for receiving Direct Benefit Transfers (DBT) provided under various Government schemes like, Scholarships.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-csss-faq",
        evidence:
          "The student has to visit the bank branch where she is holding an account and submit the duly filled consent form",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "verification:nsp_institute",
    type: "VERIFICATION",
    name: "Institute verification of your NSP application",
    description:
      "Your college has to verify the submitted application before the cut-off date. Unverified is treated as Invalid, which is the same as not having applied. If it comes back Defective the errors are yours to correct and resubmit. Rejected is final.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "INSTITUTE",
      couldBlock: [
        "An application not verified by the institute or the State Higher Education Department is treated as Invalid.",
      ],
      timeline:
        "The verification deadline is published on the NSP portal and communicated to your institute.",
    },
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_INSTITUTE_VERIFICATION,
        confidence: 0.96,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "If your application has been marked in Defective mode by your Institute, then your application is available at your level, you have to do the necessary Updation in your application form and click on SUBMIT Button and application will go online at your Institute level for verification.",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-csss-faq",
        evidence:
          "Defective: There are errors you can correct and resubmit.\n\nRejected: Your application is permanently disqualified due to non-fulfillment of eligibility or incorrect data.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "Deadline of verification of application at Institute/Ministry level is available on the NSP portal. Ministry communicates the same to your institute and you can check from your institute also.",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "verification:nsp_ministry",
    type: "VERIFICATION",
    name: "Ministry level final verification",
    description: "The second link in the chain. It only starts once your institute is done.",
    jurisdictionId: "IN",
    metadata: { blockedBy: "GOVERNMENT" },
    sources: cite(
      "src:nsp-st-faq",
      "After verification of application done by your institute, application comes at Ministry level for final verification.",
      0.93,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "verification:top_class_institute",
    type: "VERIFICATION",
    name: "Institute verification and slot check (Top Class)",
    description:
      "Beyond checking your documents, the institute also has to fit you inside its allotted slots, so a correct application can still miss out.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "INSTITUTE",
      timeline: "31 October every year, or any other date notified by DBT Mission.",
    },
    sources: [
      {
        sourceId: "src:nsp-topclass-faq",
        evidence:
          "Institutes verify applications, ensure slot limits, verify documents and forward eligible applications on NSP within prescribed timelines.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-topclass-faq",
        evidence: "31 October every year or any other date notified by DBT Mission.",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "output:scholarship_payment",
    type: "OUTPUT",
    name: "Scholarship paid into your bank account",
    description:
      "Paid by Direct Benefit Transfer into the Aadhaar seeded bank account, not into whichever account you happen to name.",
    jurisdictionId: "IN",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_DBT,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- where you do it, and who to shout at ---------------------------------
  // portal:digital_gujarat already exists in the certificates journey and is
  // referenced, not redefined.
  {
    id: "portal:nsp",
    type: "PORTAL",
    name: "National Scholarship Portal",
    aliases: ["nsp", "scholarships.gov.in"],
    jurisdictionId: "IN",
    metadata: { url: "https://scholarships.gov.in/Students" },
    sources: derived(
      "src:nsp-students",
      "The Portal is open for Academic year 2026-27 from 1'st June 2026 onwards.",
      0.88,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:nsp_otr",
    type: "PORTAL",
    name: "NSP One Time Registration",
    jurisdictionId: "IN",
    metadata: { url: "https://scholarships.gov.in/otr/#/register" },
    sources: derived("src:nsp-students", E_OTR_MANDATORY, 0.85),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:nsp_eligibility_checker",
    type: "PORTAL",
    name: "NSP scholarship eligibility check",
    description:
      "Asks your domicile state, parent annual income, parent profession, religion, community, disability, hosteller status and application type, then tells you which schemes you can apply for.",
    jurisdictionId: "IN",
    metadata: { url: "https://scholarships.gov.in/scholarshipEligibility" },
    sources: derived(
      "src:nsp-eligibility",
      "Domicile State/UT*\n\nChoose Your Option\n\nName\n\nGender*\n\nChoose Your Option\n\nDate of Birth*\n\nMarital Status*\n\nChoose Your Option\n\nParent Annual Income*\n\nParent Profession*",
      0.8,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:pfms_payment_status",
    type: "PORTAL",
    name: "PFMS Know Your Payment",
    description: "Where the disbursement shows up, which is not the same page as the application status.",
    jurisdictionId: "IN",
    metadata: { url: "https://pfms.nic.in/SitePages/KnowYourPayment_Dw_NewNew.aspx" },
    sources: derived("src:nsp-students", "Track your scholarship disbursement status on PFMS portal", 0.88),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:mysy",
    type: "PORTAL",
    name: "MYSY scholarship portal",
    aliases: ["mysy portal"],
    jurisdictionId: "IN-GJ",
    metadata: { url: "https://mysy.guj.nic.in/" },
    sources: derived(
      "src:mysy-myscheme",
      "Applicants need to visit the official website of MYSY scholarship.",
      0.85,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:moma_scholarship",
    type: "PORTAL",
    name: "Minority affairs scholarship portal",
    jurisdictionId: "IN",
    metadata: { url: "https://momascholarship.gov.in" },
    sources: derived(
      "src:sje-mcm",
      "Muslim, Christian, Shikh, Buddh, Jain and Parsi (Religious minorities)\n- Annual income limit is Rs. 2,50,000/-\n- Online form is filled momascholarship.gov.in\n- For professional courses like Medical and Engineering.",
      0.85,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "helpline:nsp",
    type: "HELPLINE",
    name: "NSP Helpdesk",
    jurisdictionId: "IN",
    metadata: {
      phoneNumbers: ["0120-6619540"],
      emails: ["helpdesk@nsp.gov.in"],
      workingHours: "8:00 AM to 8:00 PM on all days except government holidays",
    },
    sources: [
      {
        sourceId: "src:nsp-st-faq",
        evidence: E_NSP_HELPDESK,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "grievance:nsp_login_tab",
    type: "GRIEVANCE_CHANNEL",
    name: "Grievance Registration Tab inside your NSP login",
    description:
      "The scholarship specific grievance route, which sits inside your own login rather than on the public site.",
    jurisdictionId: "IN",
    metadata: { channelType: "GRIEVANCE_PORTAL" },
    sources: cite(
      "src:nsp-csss-faq",
      "The grievances need to be register on the Grievance Registration Tab available in their Login.",
      0.92,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "grievance:moe_scholarship_division",
    type: "GRIEVANCE_CHANNEL",
    name: "Scholarship Division, Ministry of Education",
    jurisdictionId: "IN",
    metadata: {
      channelType: "EMAIL",
      phoneNumbers: ["011-20862360"],
      emails: ["ns1-scholarship@gov.in"],
    },
    sources: cite("src:nsp-csss-faq", "Telephone: 011-20862360,\n\nEmail: ns1-scholarship@gov.in", 0.9),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "office:district_deputy_director_scw",
    type: "OFFICE",
    name: "District Deputy Director (SCW) Office",
    description: "The implementing office for the Gujarat SC post matric scholarship.",
    jurisdictionId: "IN-GJ",
    metadata: { officeType: "DISTRICT" },
    sources: cite("src:sje-bck61", "District Deputy Director(SCW) Office", 0.92),
    lastVerifiedAt: RETRIEVED,
  },
];

export const requirementGroups: RequirementGroup[] = [
  // Nothing here on purpose. The only either/or in the research is Aadhaar
  // versus Aadhaar Enrolment ID, and the page states it as a condition ("if you
  // do not have an Aadhaar number") rather than as a list of accepted
  // alternatives, so it is modelled as a conditional edge. Every other document
  // list retrieved for a scholarship is a flat mandatory list.
];

export const edges: GraphEdge[] = [
  // -- the spine: OTR, then the application, then two verifications ---------
  {
    id: "e:nsp_requires_otr",
    from: "service:nsp_scholarship",
    to: "document:otr_number",
    type: "REQUIRES",
    note: "One Time Registration comes first. Without an OTR number there is no application to make.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-students",
        evidence: E_OTR_MANDATORY,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:otr_produces_otr_number",
    from: "service:nsp_otr",
    to: "document:otr_number",
    type: "PRODUCES",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-students",
        evidence: E_OTR_MANDATORY,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:otr_requires_aadhaar",
    from: "service:nsp_otr",
    to: "document:aadhaar",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_OTR_PREREQUISITES,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:otr_requires_mobile",
    from: "service:nsp_otr",
    to: "document:mobile_linked_to_aadhaar",
    type: "REQUIRES",
    note: "The mobile number has to stay the same for the whole tenure of the scholarship, so use one you will keep.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_OTR_PREREQUISITES,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "Yes, mobile number is compulsory for applying for Scholarship Scheme through National Scholarship Portal and it should remain same throughout the tenure of the scholarship.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:otr_conditional_enrolment_id",
    from: "service:nsp_otr",
    to: "document:aadhaar_enrolment_id",
    type: "REQUIRES",
    condition: { field: "document:aadhaar", operator: "NOT_EXISTS" },
    note: "Only if you do not have an Aadhaar number yet. It gets you through the application, but Aadhaar is still mandatory before the money is released, so update it as soon as your Aadhaar arrives.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-csss-faq",
      "Yes, if you do not have an Aadhaar number, you may apply using your Aadhaar Enrollment ID, but update the Aadhaar on receiving the Aadhaar number, as Aadhaar is mandatory for final scholarship disbursal.",
      0.93,
    ),
  },
  {
    id: "e:nsp_conditional_parent_aadhaar",
    from: "service:nsp_scholarship",
    to: "document:parent_aadhaar",
    type: "REQUIRES",
    condition: { field: "age", operator: "LT", value: 18 },
    note: "Only while you are a minor. Once you turn 18 you have to submit your own Aadhaar.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-csss-faq",
      "Yes, minor applicants can apply with their Parent’s Aadhaar but the applicant must submit their Aadhaar on attaining the age of 18 years.",
      0.92,
    ),
  },
  {
    id: "e:nsp_requires_aadhaar",
    from: "service:nsp_scholarship",
    to: "document:aadhaar",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-st-faq",
      "Aadhaar is Mandatory for the Students in order to Register and fill-up the application form online.",
      0.95,
    ),
  },
  {
    id: "e:nsp_requires_application_id",
    from: "service:nsp_scholarship",
    to: "action:generate_application_id",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-csss-faq",
      "the students are required to select their Domicile State and the “Post-Matric” option from the drop-down menu.",
      0.9,
    ),
  },
  {
    id: "e:nsp_requires_class_12_marksheet",
    from: "service:nsp_scholarship",
    to: "document:class_12_marksheet",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_FRESH_UPLOADS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  // The cross journey link. It points at the document, not at the service that
  // issues it, which is what lets the certificates journey be pulled in whole
  // and put in front of this one without either file naming the other.
  {
    id: "e:nsp_conditional_income_certificate",
    from: "service:nsp_scholarship",
    to: "document:income_certificate",
    type: "REQUIRES",
    condition: { field: "application_type", operator: "NEQ", value: "renewal" },
    note: "Fresh applicants only. Renewal students are not asked for it. It has to come from a competent authority of the State Government, and a certificate signed by a Notary will be refused. The retrieved page is the AY 2025-26 edition, where the certificate had to cover 1 April 2024 to 31 March 2025, so check the current year's period on the portal.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_FRESH_UPLOADS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "For the first year the Income certificate should have been issued by the competent authority. For Renewal students Income certificate is not called for.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence: E_INCOME_CERTIFICATE_ISSUER,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "Fresh applicants should upload latest family Income certificate for the year 2025-26 (Issued for the period from 1st April 2024 to 31st March 2025).",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:nsp_conditional_caste_certificate",
    from: "service:nsp_scholarship",
    to: "document:caste_certificate",
    type: "REQUIRES",
    condition: { field: "category", operator: "IN", value: ["sc", "st", "obc", "sebc"] },
    note: "Reserved category students only. It has to be signed and stamped by a Competent Authority, and a certificate signed by a Notary is not valid.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: "Category/ caste Certification for reserved category students",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "ST Community/PVTG Certificate signed and stamped by Competent Authority (Certificate signed by Notary is not valid).",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:nsp_conditional_disability_certificate",
    from: "service:nsp_scholarship",
    to: "document:disability_certificate",
    type: "REQUIRES",
    condition: { field: "has_disability", operator: "EQ", value: true },
    note: "Only if you have a disability.",
    verificationStatus: "VERIFIED",
    sources: cite("src:nsp-csss-faq", "Disability Certificate (if applicable)", 0.9),
  },
  {
    id: "e:nsp_conditional_previous_marksheet",
    from: "service:nsp_scholarship",
    to: "document:previous_year_marksheet",
    type: "REQUIRES",
    condition: { field: "application_type", operator: "EQ", value: "renewal" },
    note: "Renewal applications only.",
    verificationStatus: "VERIFIED",
    sources: cite("src:nsp-csss-faq", "RENEWAL: Previous Year Mark Sheet", 0.92),
  },
  {
    id: "e:nsp_requires_bank_passbook",
    from: "service:nsp_scholarship",
    to: "document:bank_passbook",
    type: "REQUIRES",
    note: "A scan showing the account number and your name, both legible.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-st-faq",
      "Scanned Copy of the Passbook clearly showing the account number and name of the student",
      0.92,
    ),
  },
  {
    id: "e:nsp_requires_bonafide",
    from: "service:nsp_scholarship",
    to: "document:bonafide_certificate",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-st-faq",
      "Bonafide Student of the institution (as per the format given by NSP in application form)",
      0.92,
    ),
  },
  {
    id: "e:nsp_requires_photograph",
    from: "service:nsp_scholarship",
    to: "document:passport_photo",
    type: "REQUIRES",
    note: "On NSP each uploaded file must be a .pdf or .jpeg under 200 KB, which is a different cap from the one the transport portal applies.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-st-faq",
        evidence: "Student Photograph",
        confidence: 0.88,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:nsp-st-faq",
        evidence:
          "The format of the file should be .pdf and .jpeg and the size of each document should not exceed more than 200 KB. Also please upload documents which are clearly visible.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:nsp_requires_aadhaar_seeding",
    from: "service:nsp_scholarship",
    to: "action:aadhaar_seed_bank_account",
    type: "REQUIRES",
    note: "Do this early. The money is sent by DBT to the Aadhaar seeded account, so an unseeded account fails at the last step rather than the first.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_DBT,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:nsp_depends_on_aishe_status",
    from: "service:nsp_scholarship",
    to: "action:check_institute_aishe_status",
    type: "DEPENDS_ON",
    note: "Not a document, just a thing worth checking before you spend a week on the form.",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:nsp-csss-faq",
      "the scholarship payment won’t be released to the students studying in the institutes whose Status is INACTIVE.",
      0.85,
    ),
  },
  {
    id: "e:nsp_requires_recognised_college",
    from: "service:nsp_scholarship",
    to: "eligibility:nsp_private_college_recognised",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-csss-faq",
      "Yes, provided the private college is recognized by a regulatory body (like AICTE, UGC, etc.) and listed on the AISHE portal.",
      0.9,
    ),
  },
  {
    id: "e:nsp_next_institute_verification",
    from: "service:nsp_scholarship",
    to: "verification:nsp_institute",
    type: "NEXT",
    note: "Submitting is not finishing. Chase your institute before the cut-off date, because an unverified application is treated as Invalid.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_INSTITUTE_VERIFICATION,
        confidence: 0.96,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:institute_next_ministry_verification",
    from: "verification:nsp_institute",
    to: "verification:nsp_ministry",
    type: "NEXT",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-st-faq",
      "After verification of application done by your institute, application comes at Ministry level for final verification.",
      0.93,
    ),
  },
  {
    id: "e:nsp_produces_payment",
    from: "service:nsp_scholarship",
    to: "output:scholarship_payment",
    type: "PRODUCES",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_DBT,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
  },

  // -- the one-scheme-or-many contradiction ---------------------------------
  // Two government pages, two different answers, both current. We do not get to
  // pick, so the citizen gets both and is told to confirm before applying.
  {
    id: "e:nsp_one_merit_plus_welfare",
    from: "service:nsp_scholarship",
    to: "eligibility:nsp_one_merit_plus_welfare",
    type: "REQUIRES",
    note: "The National Scholarship Portal says that from AY 2026-27 you may hold one merit based scholarship plus one or more welfare based ones. The Ministry of Tribal Affairs FAQ says the opposite, that you cannot apply for more than one scheme at all. Both pages are live. Before you apply for a second scheme, confirm with the NSP helpdesk or your institute which rule applies to your scheme, and keep a record of the answer.",
    verificationStatus: "CONFLICTING",
    sources: [
      {
        sourceId: "src:nsp-students",
        evidence:
          "Students may apply for one merit-based scholarship scheme and one or more welfare-based scholarship schemes from AY 2026–27, as per scheme eligibility criteria.",
        confidence: 0.93,
        verificationStatus: "CONFLICTING",
      },
    ],
  },
  {
    id: "e:nsp_single_scheme_only",
    from: "service:nsp_scholarship",
    to: "eligibility:nsp_single_scheme_only",
    type: "REQUIRES",
    note: "The Ministry of Tribal Affairs scheme FAQ states flatly that a student cannot apply for more than one scholarship scheme. The National Scholarship Portal's own AY 2026-27 announcement allows one merit based plus one or more welfare based schemes. This one is the stricter of the two, so if you follow it you are safe either way, but you may be giving up money you were entitled to. Ask before you assume.",
    verificationStatus: "CONFLICTING",
    sources: [
      {
        sourceId: "src:nsp-st-faq",
        evidence: "A student cannot apply for more than one Scholarship Scheme.",
        confidence: 0.75,
        verificationStatus: "CONFLICTING",
      },
    ],
  },

  // -- channels, tracking, grievance ---------------------------------------
  {
    id: "e:nsp_apply_at_portal",
    from: "service:nsp_scholarship",
    to: "portal:nsp",
    type: "APPLY_AT",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-students",
      "The Portal is open for Academic year 2026-27 from 1'st June 2026 onwards.",
      0.94,
    ),
  },
  {
    id: "e:otr_apply_at_portal",
    from: "service:nsp_otr",
    to: "portal:nsp_otr",
    type: "APPLY_AT",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-students",
        evidence: E_OTR_MANDATORY,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:nsp_available_via_digilocker",
    from: "service:nsp_scholarship",
    to: "app:digilocker",
    type: "AVAILABLE_VIA",
    note: "You can pull your documents from DigiLocker instead of scanning and uploading each one.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-st-faq",
      "Upload all the mandatory documents or you can fetch your documents from Digi locker",
      0.88,
    ),
  },
  {
    id: "e:nsp_available_via_eligibility_checker",
    from: "service:nsp_scholarship",
    to: "portal:nsp_eligibility_checker",
    type: "AVAILABLE_VIA",
    note: "Run your details through this first and it will tell you which schemes you can actually apply for.",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:nsp-eligibility",
      "Domicile State/UT*\n\nChoose Your Option\n\nName\n\nGender*\n\nChoose Your Option\n\nDate of Birth*\n\nMarital Status*\n\nChoose Your Option\n\nParent Annual Income*\n\nParent Profession*",
      0.8,
    ),
  },
  {
    id: "e:nsp_track_at_portal",
    from: "service:nsp_scholarship",
    to: "portal:nsp",
    type: "TRACK_AT",
    note: "Log in as a student with your Aadhaar or OTR number, then My Application, then Check Your Status against your Application ID.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-csss-faq",
        evidence: E_CHECK_YOUR_STATUS,
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:nsp_track_payment_at_pfms",
    from: "service:nsp_scholarship",
    to: "portal:pfms_payment_status",
    type: "TRACK_AT",
    note: "Application status and payment status are two different pages. If the application says approved and no money has arrived, this is the page that knows why.",
    verificationStatus: "VERIFIED",
    sources: cite("src:nsp-students", "Track your scholarship disbursement status on PFMS portal", 0.93),
  },
  {
    id: "e:nsp_call_helpdesk",
    from: "service:nsp_scholarship",
    to: "helpline:nsp",
    type: "CALL_IF",
    note: "For technical trouble with the portal itself.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-st-faq",
        evidence: E_NSP_HELPDESK,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:nsp_escalate_to_login_grievance",
    from: "service:nsp_scholarship",
    to: "grievance:nsp_login_tab",
    type: "ESCALATE_TO",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-csss-faq",
      "The grievances need to be register on the Grievance Registration Tab available in their Login.",
      0.92,
    ),
  },
  {
    id: "e:csss_escalate_to_moe",
    from: "service:pm_usp_csss",
    to: "grievance:moe_scholarship_division",
    type: "ESCALATE_TO",
    verificationStatus: "VERIFIED",
    sources: cite("src:nsp-csss-faq", "Telephone: 011-20862360,\n\nEmail: ns1-scholarship@gov.in", 0.9),
  },

  // -- PM-USP CSSS ----------------------------------------------------------
  {
    id: "e:csss_depends_on_nsp",
    from: "service:pm_usp_csss",
    to: "service:nsp_scholarship",
    type: "DEPENDS_ON",
    note: "CSSS is not applied for anywhere else. It is one of the schemes inside the NSP application.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-students",
        evidence: E_CSSS_RENEWAL_ROUND,
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:csss_requires_income_ceiling",
    from: "service:pm_usp_csss",
    to: "eligibility:csss_income_4_5_lakh",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:nsp-csss-faq", "Having family income upto Rs. 4.5 lakh per annum", 0.95),
  },
  {
    id: "e:csss_requires_regular_course",
    from: "service:pm_usp_csss",
    to: "eligibility:csss_regular_course",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-csss-faq",
      "Students pursuing regular course (not correspondence or distance mode)",
      0.9,
    ),
  },
  {
    id: "e:csss_requires_no_other_scholarship",
    from: "service:pm_usp_csss",
    to: "eligibility:csss_no_other_scholarship_and_not_diploma",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-csss-faq",
      "Not receiving any other scholarship or fee reimbursement of any kind\n\n• Diploma students are not eligible under the scheme.",
      0.92,
    ),
  },
  {
    id: "e:csss_conditional_renewal_performance",
    from: "service:pm_usp_csss",
    to: "eligibility:csss_renewal_marks_and_attendance",
    type: "REQUIRES",
    condition: { field: "application_type", operator: "EQ", value: "renewal" },
    note: "The 50% marks and 75% attendance bar is what keeps a CSSS scholarship running year after year.",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:nsp-csss-faq",
      "Student must secure at least 50% marks and maintain adequate attendance of at least 75%.",
      0.85,
    ),
  },

  // -- Top Class Education Scheme for SC students ---------------------------
  {
    id: "e:topclass_depends_on_nsp",
    from: "service:top_class_sc",
    to: "service:nsp_scholarship",
    type: "DEPENDS_ON",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-topclass-faq",
        evidence: E_TOP_CLASS_DOCUMENTS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:topclass_requires_eligibility",
    from: "service:top_class_sc",
    to: "eligibility:top_class_sc_income_8_lakh",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-topclass-faq",
      "SC students with annual family income up to Rs.8.00 lakh, admitted in a full-time prescribed course in a notified institution, subject to the allotted slots.",
      0.94,
    ),
  },
  {
    id: "e:topclass_requires_no_similar_scholarship",
    from: "service:top_class_sc",
    to: "eligibility:top_class_no_similar_scholarship",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-topclass-faq",
      "No. A beneficiary cannot simultaneously avail similar scholarship from Central/State Government.",
      0.92,
    ),
  },
  {
    id: "e:topclass_requires_caste_certificate",
    from: "service:top_class_sc",
    to: "document:caste_certificate",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-topclass-faq",
        evidence: E_TOP_CLASS_DOCUMENTS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:topclass_requires_income_certificate",
    from: "service:top_class_sc",
    to: "document:income_certificate",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-topclass-faq",
        evidence: E_TOP_CLASS_DOCUMENTS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:topclass_requires_admission_details",
    from: "service:top_class_sc",
    to: "document:top_class_admission_and_rank_details",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:nsp-topclass-faq",
        evidence: E_TOP_CLASS_DOCUMENTS,
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:topclass_requires_sibling_affidavit",
    from: "service:top_class_sc",
    to: "document:sibling_affidavit",
    type: "REQUIRES",
    note: "Benefits stop at two siblings, and the affidavit is how that is established.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-topclass-faq",
      "No. Benefits are restricted to two siblings. An affidavit is required.",
      0.92,
    ),
  },
  {
    id: "e:topclass_requires_aadhaar_seeding",
    from: "service:top_class_sc",
    to: "action:aadhaar_seed_bank_account",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:nsp-topclass-faq", "Yes. Aadhaar-seeded bank account is mandatory for DBT.", 0.94),
  },
  {
    id: "e:topclass_conditional_employer_income_certificate",
    from: "service:top_class_sc",
    to: "document:employer_income_certificate",
    type: "REQUIRES",
    condition: { field: "parent_profession", operator: "EQ", value: "salaried" },
    note: "For salaried parents, the employer issues the certificate, and any other income needs a Revenue Officer certificate as well. If your parents are self employed the certificate comes from a Revenue Officer not below Tehsildar instead.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-topclass-faq",
      "Self-employed parents: certificate by Revenue Officer not below Tehsildar. Salaried parents: employer certificate and Revenue Officer certificate for other income.",
      0.93,
    ),
  },
  {
    id: "e:topclass_next_institute_verification",
    from: "service:top_class_sc",
    to: "verification:top_class_institute",
    type: "NEXT",
    note: "The institute also has to fit you inside its allotted slots, so being eligible is not the same as being selected.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:nsp-topclass-faq",
      "Institutes verify applications, ensure slot limits, verify documents and forward eligible applications on NSP within prescribed timelines.",
      0.93,
    ),
  },

  // -- Gujarat schemes ------------------------------------------------------
  // These carry eligibility, the portal and the office, and nothing more. The
  // state portals are blocked, so their document lists and their verification
  // steps, if any, are simply not known.
  {
    id: "e:bck61_requires_eligibility",
    from: "service:gujarat_post_matric_sc",
    to: "eligibility:bck61_sc_income_2_5_lakh",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:sje-bck61",
      "Student should be of Scheduled Caste.\n- Must full fill all conditions of Government of India's Post Matric Scholarship Scheme Guidelines.\n- Income Limit 2.50 Lakh.",
      0.94,
    ),
  },
  {
    id: "e:bck61_apply_at_digital_gujarat",
    from: "service:gujarat_post_matric_sc",
    to: "portal:digital_gujarat",
    type: "APPLY_AT",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:sje-bck61",
      "(Students have to apply online.)(Portal: https://www.digitalgujarat.gov.in)",
      0.93,
    ),
  },
  {
    id: "e:bck61_handled_by_dd_scw",
    from: "service:gujarat_post_matric_sc",
    to: "office:district_deputy_director_scw",
    type: "HANDLED_BY",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite("src:sje-bck61", "District Deputy Director(SCW) Office", 0.92),
  },
  {
    id: "e:nt_dnt_requires_eligibility",
    from: "service:gujarat_nt_dnt_self_finance",
    to: "eligibility:nt_dnt_income_2_lakh_self_finance",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "The institute has to be government certified as well, which is a fact about the college rather than about you.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:sje-ntdnt",
      "Student must be from Nomadic / De-notified Tribes\n- Annual income limit is Rs. 2,00,000/-\n- Studying in self finance institutes\n- Institutes must be certified by government.",
      0.93,
    ),
  },
  {
    id: "e:mcm_requires_eligibility",
    from: "service:gujarat_mcm_minority",
    to: "eligibility:mcm_minority_income_2_5_lakh",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:sje-mcm",
      "Muslim, Christian, Shikh, Buddh, Jain and Parsi (Religious minorities)\n- Annual income limit is Rs. 2,50,000/-\n- Online form is filled momascholarship.gov.in\n- For professional courses like Medical and Engineering.",
      0.93,
    ),
  },
  {
    id: "e:mcm_apply_at_moma",
    from: "service:gujarat_mcm_minority",
    to: "portal:moma_scholarship",
    type: "APPLY_AT",
    jurisdictionId: "IN-GJ",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:sje-mcm",
      "Muslim, Christian, Shikh, Buddh, Jain and Parsi (Religious minorities)\n- Annual income limit is Rs. 2,50,000/-\n- Online form is filled momascholarship.gov.in\n- For professional courses like Medical and Engineering.",
      0.85,
    ),
  },
  {
    id: "e:med_eng_books_requires_eligibility",
    from: "service:gujarat_med_eng_books",
    to: "eligibility:med_eng_books_income_2_5_lakh",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:sje-medeng",
      "Student should be studying in Medical and Engineering\n- Annual Income Limit Rs. 2,50,000/-",
      0.92,
    ),
  },

  // -- MYSY -----------------------------------------------------------------
  {
    id: "e:mysy_requires_income_ceiling",
    from: "service:mysy",
    to: "eligibility:mysy_income_6_lakh",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:mysy-myscheme",
      "The candidates whose parents annual income is not more than Rs. 6,00,000/- per annum shall only be considered eligible for the said scheme.",
      0.93,
    ),
  },
  {
    id: "e:mysy_requires_percentile",
    from: "service:mysy",
    to: "eligibility:mysy_std_12_percentile_80",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:mysy-myscheme",
      "For scholarship in Bachelor's degree programs, the candidates should have passed Std XII Science/ General stream from a recognized board from the state of Gujarat with a minimum 80 percentile in the board examination.",
      0.92,
    ),
  },
  {
    id: "e:mysy_requires_income_certificate",
    from: "service:mysy",
    to: "document:income_certificate",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "An income certificate you already hold stays valid for three financial years from the date it was issued, so you may not need a fresh one.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_INCOME_VALIDITY,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_aadhaar",
    from: "service:mysy",
    to: "document:aadhaar",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_self_declaration",
    from: "service:mysy",
    to: "document:mysy_self_declaration",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_non_it_declaration",
    from: "service:mysy",
    to: "document:mysy_non_it_return_declaration",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_institute_certificate",
    from: "service:mysy",
    to: "document:mysy_institute_certificate",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    note: "New students need a certificate from the institute, continuing students a renewal certificate. Either way you are waiting on the college, so ask early.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:mysy-myscheme",
      "04. Certificate from the institute for new students.\n05. Renewal certificate from institute.",
      0.88,
    ),
  },
  {
    id: "e:mysy_requires_class_10_marksheet",
    from: "service:mysy",
    to: "document:class_10_marksheet",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_class_12_marksheet",
    from: "service:mysy",
    to: "document:class_12_marksheet",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_admission_letter",
    from: "service:mysy",
    to: "document:admission_letter_and_fee_receipt",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_bank_proof",
    from: "service:mysy",
    to: "document:bank_passbook",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_affidavit",
    from: "service:mysy",
    to: "document:mysy_affidavit",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_requires_photo",
    from: "service:mysy",
    to: "document:passport_photo",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_conditional_hostel_documents",
    from: "service:mysy",
    to: "document:hostel_admission_letter_and_fee_receipt",
    type: "REQUIRES",
    jurisdictionId: "IN-GJ",
    condition: { field: "admission_in_other_taluka", operator: "EQ", value: true },
    note: "The hostel grant only applies when your admission is in another taluka, and that is when the hostel admission letter and fee receipt are asked for.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:mysy-myscheme",
        evidence: E_MYSY_DOCUMENTS,
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:mysy-myscheme",
        evidence: "| Grant Amount | Rs.1200/- Month |\n| Admission in | Admission should be in other Taluka |",
        confidence: 0.85,
        verificationStatus: "VERIFIED",
      },
    ],
  },
  {
    id: "e:mysy_apply_at_portal",
    from: "service:mysy",
    to: "portal:mysy",
    type: "APPLY_AT",
    jurisdictionId: "IN-GJ",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:mysy-myscheme",
      "Applicants need to visit the official website of MYSY scholarship.",
      0.9,
    ),
  },
];

export const questions: QuestionDefinition[] = [
  // One question per field any condition or eligibility rule above actually
  // uses. "age" is not repeated here, the driving licence journey already
  // defines it and the loader keeps the first definition.
  {
    field: "annual_family_income",
    label: "What is your family's total annual income?",
    help: "In rupees, per year, as it appears on your income certificate. Every scheme has a different ceiling, so this one answer decides several of them at once.",
    inputType: "NUMBER",
  },
  {
    field: "category",
    label: "Which category do you belong to?",
    help: "This decides whether a caste certificate is asked for, and which schemes are open to you.",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "sc", label: "Scheduled Caste" },
      { value: "st", label: "Scheduled Tribe" },
      { value: "obc", label: "Other Backward Class" },
      { value: "sebc", label: "Socially and Educationally Backward Class" },
      { value: "nt_dnt", label: "Nomadic or De-notified Tribe" },
      { value: "general", label: "General" },
    ],
  },
  {
    field: "religion",
    label: "What is your religion?",
    help: "Only relevant to the Merit-cum-Means scholarship for minority communities.",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "hindu", label: "Hindu" },
      { value: "muslim", label: "Muslim" },
      { value: "christian", label: "Christian" },
      { value: "sikh", label: "Sikh" },
      { value: "buddhist", label: "Buddhist" },
      { value: "jain", label: "Jain" },
      { value: "parsi", label: "Parsi" },
      { value: "other", label: "Other" },
    ],
  },
  {
    field: "course_type",
    label: "What kind of course are you on?",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "medical", label: "Medical" },
      { value: "engineering", label: "Engineering" },
      { value: "other_professional", label: "Another professional course" },
      { value: "general_degree", label: "General degree" },
      { value: "diploma", label: "Diploma" },
    ],
  },
  {
    field: "course_mode",
    label: "Is it a regular course, or correspondence or distance mode?",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "regular", label: "Regular" },
      { value: "distance", label: "Correspondence or distance" },
    ],
  },
  {
    field: "institute_type",
    label: "What kind of institute are you studying in?",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "self_finance", label: "Self finance" },
      { value: "government", label: "Government" },
      { value: "grant_in_aid", label: "Grant in aid" },
    ],
  },
  {
    field: "application_type",
    label: "Is this a fresh application or a renewal?",
    help: "Fresh applicants upload an income certificate and the Class 12 mark sheet. Renewal students upload last year's mark sheet instead, and are not asked for the income certificate again.",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "fresh", label: "Fresh" },
      { value: "renewal", label: "Renewal" },
    ],
  },
  {
    field: "parent_profession",
    label: "Are your parents salaried or self employed?",
    help: "Salaried parents need an income certificate from the employer. Self employed parents need one from a Revenue Officer not below Tehsildar.",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "salaried", label: "Salaried" },
      { value: "self_employed", label: "Self employed" },
    ],
  },
  {
    field: "has_disability",
    label: "Do you have a disability?",
    inputType: "BOOLEAN",
  },
  {
    field: "receiving_other_scholarship",
    label: "Are you already receiving another scholarship or fee reimbursement?",
    inputType: "BOOLEAN",
  },
  {
    field: "admission_in_other_taluka",
    label: "Is your admission in a taluka other than the one you live in?",
    help: "Only relevant to the MYSY hostel grant.",
    inputType: "BOOLEAN",
  },
  {
    field: "previous_year_marks_percent",
    label: "What percentage did you score last year?",
    inputType: "NUMBER",
  },
  {
    field: "attendance_percent",
    label: "What was your attendance percentage last year?",
    inputType: "NUMBER",
  },
  {
    field: "class_12_percentile",
    label: "What percentile did you get in the Std XII board exam?",
    help: "Percentile, not percentage. MYSY asks for at least 80.",
    inputType: "NUMBER",
  },
];
