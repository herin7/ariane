import type {
  GraphEdge,
  GraphNode,
  QuestionDefinition,
  RequirementGroup,
  Source,
  SourceRef,
} from "../../types";

/**
 * EPF withdrawal: final settlement, pension withdrawal, advance and transfer.
 *
 * Same rule as the driving licence and certificates files. Every claim carries
 * the sentence it was read off, quoted exactly as the page prints it, and
 * nothing here was remembered, averaged or tidied up.
 *
 * What makes this journey different: the citizen is mostly not the bottleneck.
 * Almost every way a PF claim fails is somebody else's move. The employer has
 * to approve the bank and Aadhaar KYC with a digital signature, the employer
 * normally marks the date of exit, the employer certifies a profile
 * correction. So those are modelled as blocker nodes with the actor set to
 * EMPLOYER, not as documents you can go and fetch, and the escalation route
 * hangs off them. Filing the claim a second time does not move any of them.
 *
 * The big hole, stated up front: www.epfindia.gov.in refused every direct
 * connection on the day of the crawl (curl, Firecrawl and WebFetch all failed
 * against 164.100.160.96:443). Every epfindia.gov.in fact below was read from
 * an Internet Archive capture of the official page, not from a live fetch. The
 * two sub-domains unifiedportal-mem.epfindia.gov.in and
 * passbook.epfindia.gov.in were reachable live.
 *
 * Also deliberately missing, because no page in the crawl stated it:
 *
 *   - EPFO Gujarat office addresses and phone numbers. The official Contact
 *     page is a state, district and office search form that renders no static
 *     directory, so office:epfo_field_office carries no address. It says how
 *     to look yours up instead of inventing one.
 *   - Any claim that CPGRAMS sits above EPFiGMS. No official page says so. The
 *     only printed escalation above EPFiGMS is the Regional P.F. Commissioner
 *     in charge of grievances and the Nidhi Apke Nikat hearing, and those are
 *     what is modelled. CPGRAMS is attached to every service by the loader
 *     already, and nothing here claims it is a tier.
 *   - The 14470 toll free number. It appears only in a link description in the
 *     cached site map, never in a page body that could be quoted, so the only
 *     number here is 1800118005.
 *   - A "missing employer DSC" rejection reason worded as such. What is
 *     printed is the dependency: KYC must be approved by the employer using
 *     his Digital Signature Certificate.
 *   - The exact wording of the Joint Declaration circular on the correctable
 *     parameters. The circular PDF is a scanned image with no extractable
 *     text.
 *   - Anything current from MembersFAQ.pdf on its own. That PDF predates the
 *     Unified Portal and is partly superseded by the January 2025 self-update
 *     change, so its "the member cannot edit his details" line is kept only as
 *     one half of a CONFLICTING pair, never as the current rule.
 *   - Any fee. No page in the crawl prints a fee for any of these claims, so
 *     no payment node exists here. Absence of a fee node is not a claim that
 *     it is free.
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

// The quotes that carry more than one fact each, written once so the claims
// drawn out of them cannot drift apart from the sentence they came from.

const E_THREE_FORMS =
  "Member can apply for a. PF Final Settlement (Form19), b. Pension Withdrawal Benefit (Form10-C) and c. PF Part Withdrawal (Form31) from the Member Interface directly";

const E_UAN_ACTIVE =
  "The member should have activated his/her  Universal  Account  Number  and the mobile number used for activating UAN should be in the working  condition.";

const E_AADHAAR_SEEDED =
  "Member's AADHAAR details should be seeded in EPFO database and he should avail  OTP based facility for verifying eKYC from UIDAI while submitting the claim.";

const E_BANK_SEEDED = "Member's Bank Account along with IFSC code should be seeded in EPFO database.";

const E_KYC_MINIMUM = "Mobile, Aadhar and Bank account number";

const E_DOJ_DOE_AVAILABLE = "Date of Joining and Date of Exit of Member should be available in the EPFO Database.";

const E_NOT_WORKING_AND_TWO_MONTHS =
  "Member should not be working presently under any establishment coverable under PF Act. c. The Claim should be submitted  not before  two months after leaving Establishment.";

const E_10C_SERVICE_BAND =
  "Member's Total Service should be more than 6 months and less than 9.5 years in addition to the conditions mentioned under 3)  above for filing Pension Withdrawal Benefit Claim.";

const E_EMPLOYER_APPROVES_KYC =
  "Currently the member can submit 3 types of claims without attestation of Employer namely, Form-19, 10C and 31. However, the member must ensure that his UAN is activated and at least the bank account and Aadhaar KYC's in respect of his account are approved by the Employer using his Digital Signature Certificate.";

const E_EMPLOYER_MUST_APPROVE =
  "No, Employer need to approve the KYC of the employee. Employer can register for e-sign which is Aadhar based and then approve the details.";

const E_EMPLOYER_NOT_APPROVING =
  "In case your employer is not approving KYC details, you can directly approach administration or HR department with request. If it is taking more time you can escalate it to higher authority in the organization.\nIf no one is responding to your request you can approach EPF Grievance via https://epfigms.gov.in.";

const E_CLOSED_ESTABLISHMENT =
  "In respect of closed establishment, where the employee finds it difficult to get the attestation of the employer, the member can update the KYC by submitting a request to concerned field office duly attested by one of the authorized officials. The complete list of authorized officials is as prescribed in para 10.18 of the MAP Vol. II";

const E_MARK_EXIT =
  "i. Go to the https://unifiedportal-mem.epfindia.gov.in/memberinterface/ and login using your UAN and password\n2. ii. Click on tab “manage\" >> click “mark exit\". Under the “select employment”\ndropdown, select the previous PF account number linked to your UAN\n3. iii. Enter the date and reason of exit.\n4. iv. Then request for an OTP which will be sent to your Aadhaar-linked mobile number.\n5. v. After you enter the OTP, submit the request. It may be noted that once the date of exit is updated, it cannot be changed.";

const E_SELF_MARK_AFTER_60 =
  "After 60 Days from the date of leaving of services, the member can him self submit / update Date of Exit online through Member Portal.";

const E_DOE_UPDATE_RULE =
  "Yes, updation of date of exit of previous job/employment is mandatory for applying online transfer. The date of exit can be updated only after two months of leaving a job. Also, the date of exit can be any date in the month in which the last contribution was made by the previous employer.";

const E_SELF_UPDATE_2025 =
  "Under the revised procedure, the members whose Universal Account Number (UAN) has already been validated through Aadhaar can update their profile like name, date of birth, gender, nationality, father/mother's name, marital status, spouse name, date of joining and date of leaving themselves without the requirement of uploading any document.";

const E_MEMBER_CANNOT_EDIT =
  "No, the member cannot edit his details i.e. father's name, relationship, date of birth, date of joining, date of exit as available in the EPFO database.";

const E_ESCALATION_LADDER =
  "He can approach the Regional P.F. Commissioner in charge of grievances; file a complaint on the website using the EPFiGMS feature in the section ‘FOR EMPLOYEES’. The url for the grievance page is http://epfigms.gov.in/ or he can appear before the Commissioner in the ‘Nidhi Apke Nikat’ program being conducted on 10th of every month.";

const E_EPFIGMS_LODGE =
  "A complainant can lodge his/her grievance online on – https://epfigms.gov.in. If the complainant has UAN/Establishment/PPO number then he can directly enter his respective detail and fill his/her grievance category and description of grievance along with uploading supporting documents. Thereafter his grievance is forwarded to the concerned PF office which is linked to its UAN/Establishment/PPO number";

const E_CLAIM_STATUS_URL =
  "Please use the url https://passbook.epfindia.gov.in/MemClaimStatusUAN/ for checking your claim status.";

const E_UMANG_SERVICES =
  "Users can check their PF balance,Raise claim,Apply for Scheme Certificate,Apply for UAN, Seed UAN with Aadhaar,Check claim status,Search for establishment,View EPFO office address,Register Grievance and apply for Jeevan Pramaan certificate using this app.";

const E_HELPLINE =
  "For EPF Balance Enquiry : 1. Give a Missed call to 9966044425 or 2. SMS EPFOHO UAN < LAN > to 7738299899\n\nHelp Desk/Toll Free Number : 1800118005";

const E_OFFICE_LOOKUP =
  "Please visit https://www.epfindia.gov.in/site_en/Contact_us.php. Click on the Zonal office under which EPF Regional/District office falls >> Click on concerned Regional/District office to get their contact details.";

export const sources: Source[] = [
  // Every epfindia.gov.in source below was read from an Internet Archive
  // capture. The url is the official one it captured, which is the url a
  // citizen should be sent to.
  {
    id: "src:epfo-faq",
    url: "https://www.epfindia.gov.in/site_en/FAQ.php",
    title: "EPFO || Frequently Asked Questions",
    domain: "epfindia.gov.in",
    sourceType: "FAQ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfo-ocs-faq",
    url: "https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/OCS_FAQ_Eligibility_102017.pdf",
    title: "FAQs regarding ONLINE CLAIM SETTLEMENT",
    domain: "epfindia.gov.in",
    sourceType: "PDF",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfo-members-faq",
    url: "https://www.epfindia.gov.in/site_docs/PDFs/OTCP_PDFs/MembersFAQ.pdf",
    title: "Frequently Asked Questions (FAQs) - EPF members",
    domain: "epfindia.gov.in",
    sourceType: "PDF",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfo-which-claim-form",
    url: "https://www.epfindia.gov.in/site_en/WhichClaimForm.php",
    title: "EPFO || Which Claim Form(s) To Submit",
    domain: "epfindia.gov.in",
    sourceType: "SERVICE_PAGE",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfo-citizen-charter",
    url: "https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/CitizenCharter.pdf",
    title: "EPFO Citizens' Charter",
    domain: "epfindia.gov.in",
    sourceType: "PDF",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfo-pr-profile",
    url: "https://www.epfindia.gov.in/site_docs/PDFs/EPFO_PRESS_RELEASES/EPFOSimplifiesOnlineProcessForMemberProfileUpdation_19012025.pdf",
    title: "EPFO Simplifies Online Process for Member Profile Updation (PIB, Ministry of Labour & Employment)",
    domain: "epfindia.gov.in",
    sourceType: "PDF",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfigms",
    url: "https://epfigms.gov.in/",
    title: "EPFiGrievance Management System",
    domain: "epfigms.gov.in",
    sourceType: "GRIEVANCE_PAGE",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfigms-register",
    url: "https://epfigms.gov.in/Grievance/GrievanceMaster",
    title: "EPFiGMS - Register Grievance",
    domain: "epfigms.gov.in",
    sourceType: "GRIEVANCE_PAGE",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfo-member-portal",
    url: "https://unifiedportal-mem.epfindia.gov.in/memberinterface/",
    title: "EPFO Member e-SEWA (Member Interface, Unified Portal)",
    domain: "unifiedportal-mem.epfindia.gov.in",
    sourceType: "PORTAL_HOME",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:epfo-passbook",
    url: "https://passbook.epfindia.gov.in/MemberPassBook/login",
    title: "EPF Passbook & Claim Status",
    domain: "passbook.epfindia.gov.in",
    sourceType: "TRACKING_PAGE",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:umang-epfo",
    url: "https://web.umang.gov.in/landing/department/epfo.html",
    title: "EPFO - UMANG (Ministry of Electronics and Information Technology)",
    domain: "web.umang.gov.in",
    sourceType: "MOBILE_APP_INFO",
    retrievedAt: RETRIEVED,
  },
];

export const nodes: GraphNode[] = [
  // -- services ------------------------------------------------------------
  {
    id: "service:pf_final_settlement",
    type: "SERVICE",
    name: "Withdraw your PF (final settlement)",
    officialName: "PF Final Settlement (Form19)",
    aliases: [
      "pf",
      "pf_withdrawal",
      "pf withdrawal",
      "epf withdrawal",
      "provident fund withdrawal",
      "pf final settlement",
      "form 19",
      "form19",
    ],
    description:
      "The claim that empties your PF account after you leave a job. Filed from the member interface as Form 19. Most of the work is not the form, it is getting your employer and the EPFO database to agree that you have left.",
    jurisdictionId: "IN",
    metadata: {
      formNumber: "Form19",
      whyRequired:
        "Apply before 36 months from leaving the last job. After that no interest is paid and the account becomes inoperative.",
      whatToDo:
        "Log in to the member interface with your UAN, file the PF Final Settlement claim, and authenticate it with the OTP sent to your Aadhaar-linked mobile number. That OTP is your consent for UIDAI to share your e-KYC with EPFO.",
      timeline: "20 Days under the scheme, 7 Working Days as the Citizens' Charter standard",
    },
    sources: [
      { sourceId: "src:epfo-ocs-faq", evidence: E_THREE_FORMS, confidence: 0.97, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:epfo-ocs-faq",
        evidence:
          "Members applying online  are required to authenticate their claim submission using OTP sent to their UIDAI registered Mobile number giving consent to UIDAI to share their e-KYC (Aadhaar) credentials to EPFO.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-which-claim-form",
        evidence:
          "in case of not getting the job, apply for the settlement before 36 months from leaving the last job as no interest will be paid after 36 months and the account will become inoperative.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-citizen-charter",
        evidence: "| PF - Final Withdrawal (Settlement of Form-19) | 20 Days | 7 Working Days |",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:pf_pension_withdrawal",
    type: "SERVICE",
    name: "Withdraw your pension amount, or keep it going",
    officialName: "Pension Withdrawal Benefit (Form10-C)",
    aliases: ["form 10c", "form10c", "form 10-c", "pension withdrawal benefit", "scheme certificate"],
    description:
      "The pension side of the account, filed as Form 10C. It is two different things behind one form: take the withdrawal benefit now, or take a Scheme Certificate that keeps your pension membership alive so later service counts towards the ten years that earn a pension.",
    jurisdictionId: "IN",
    metadata: {
      formNumber: "Form10-C",
      whatToDo:
        "File Form 10C from the member interface. Decide first whether you want the money now or a Scheme Certificate that preserves the membership.",
    },
    sources: [
      { sourceId: "src:epfo-ocs-faq", evidence: E_THREE_FORMS, confidence: 0.97, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:epfo-which-claim-form",
        evidence:
          "You can apply for Withdrawal Benefit or Scheme Certificate through Form 10C for retaining the Pension Fund Membership. Retention of the membership will give advantage of adding any future period of membership under the Fund and attain eligible service of 10 years to get pension.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:pf_advance",
    type: "SERVICE",
    name: "Take a PF advance while still in the job",
    officialName: "PF Part Withdrawal (Form31)",
    aliases: ["form 31", "form31", "pf advance", "pf part withdrawal"],
    description:
      "A part withdrawal from the account you are still contributing to. No supporting document is uploaded: filing it online is itself treated as your self declaration. The online eligibility table shows this form when the date of exit is NOT in the database, which is the opposite of the settlement claim.",
    jurisdictionId: "IN",
    metadata: {
      formNumber: "Form31",
      whatToDo: "File the PF Part Withdrawal claim from the member interface. Do not gather documents for it, none are asked for.",
    },
    sources: [
      { sourceId: "src:epfo-ocs-faq", evidence: E_THREE_FORMS, confidence: 0.97, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:epfo-ocs-faq",
        evidence:
          "Member is not required to give any supporting document while preferring online PF Part Withdrawal case. Member's act of preferring the advance claim online will be taken as his self- declaration for having applied for the same.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        // The eligibility grid is printed as a broken table and reads badly.
        // What it shows is quoted as is, and the reading of it is ours.
        sourceId: "src:epfo-ocs-faq",
        evidence:
          "NO FAILD CONDITION NO 1. DOE NOT AVAILABLE\n1. DOE ,DOJ AVAILABLE\nWILL BE SHOWN 2. CD-DOJ TO BE AS PER\n2. CD-DOE>=2 MONTHS",
        confidence: 0.7,
        verificationStatus: "NORMALIZED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:pf_transfer",
    type: "SERVICE",
    name: "Transfer your old PF into your new account",
    officialName: "online Form-13",
    aliases: ["form 13", "form13", "pf transfer", "epf transfer"],
    description:
      "The alternative to withdrawing. Worth knowing about because the thing that blocks it is the same thing that blocks the settlement claim: if the old account does not even appear on the portal, the date of exit for that service is missing.",
    jurisdictionId: "IN",
    metadata: {
      whatToDo:
        "Update the date of exit for the previous employment first, then submit online Form-13 to move the old account into the current one.",
    },
    sources: [
      {
        sourceId: "src:epfo-faq",
        evidence:
          "Above situation occurs when Date of exit of previous service is not available in unified Portal. After updating date of exit, submit online Form-13 and transfer the previous account to current member account.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        // Printed for transfer claims specifically. Kept on the service so a
        // citizen sees why an employer can bounce it back.
        sourceId: "src:epfo-members-faq",
        evidence:
          "(c) The member details do not match with establishment records.\n(d) The signature of the member does not match with those available in office records.",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- eligibility ---------------------------------------------------------
  {
    id: "eligibility:pf_not_working_covered_establishment",
    type: "ELIGIBILITY",
    name: "You must not currently be working somewhere covered by the PF Act",
    jurisdictionId: "IN",
    metadata: { rule: { field: "currently_working_covered_establishment", operator: "EQ", value: false } },
    sources: cite("src:epfo-ocs-faq", E_NOT_WORKING_AND_TWO_MONTHS, 0.97),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:pf_two_months_since_leaving",
    type: "ELIGIBILITY",
    name: "At least two months must have passed since you left",
    description:
      "The claim cannot be submitted before two months after leaving the establishment. The FAQ adds that this wait is only for resignation, not for superannuation.",
    jurisdictionId: "IN",
    metadata: { rule: { field: "months_since_leaving", operator: "GTE", value: 2 } },
    sources: [
      {
        sourceId: "src:epfo-ocs-faq",
        evidence: E_NOT_WORKING_AND_TWO_MONTHS,
        confidence: 0.97,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-faq",
        evidence:
          "Only in the case of resignation from service (not superannuation) a member has to wait for a period of two months for withdrawal of the PF amount.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:pf_service_band_for_10c",
    type: "ELIGIBILITY",
    name: "For Form 10C online, your total service must be over 6 months and under 9.5 years",
    jurisdictionId: "IN",
    metadata: {
      rule: {
        all: [
          { field: "service_years", operator: "GT", value: 0.5 },
          { field: "service_years", operator: "LT", value: 9.5 },
        ],
      },
    },
    sources: cite("src:epfo-ocs-faq", E_10C_SERVICE_BAND, 0.96),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:pf_eligible_service_under_10_years",
    type: "ELIGIBILITY",
    name: "The withdrawal benefit itself needs less than 10 years of eligible service",
    description:
      "Past ten years of eligible service the money cannot be taken out at all and only a Scheme Certificate is issued.",
    jurisdictionId: "IN",
    metadata: { rule: { field: "service_years", operator: "LT", value: 10 } },
    sources: cite(
      "src:epfo-which-claim-form",
      "Withdrawal Benefit is not permitted since you have > 10 Years of eligible service. Only Scheme Certificate will be issued.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },

  // -- the blockers, and who actually has to move ---------------------------
  // These four are the reason PF claims fail. None of them is a document the
  // citizen can go and fetch, and none of them is fixed by filing again.
  {
    id: "verification:pf_employer_kyc_approval",
    type: "VERIFICATION",
    name: "Your employer has to approve your bank and Aadhaar KYC",
    description:
      "Form 19, 10C and 31 need no employer attestation, but they do need your bank account and Aadhaar KYC to have been approved by your employer with his Digital Signature Certificate. EPFO will not approve it in his place. If a second, unapproved bank KYC is sitting against your UAN, only the employer can reject that too.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "EMPLOYER",
      whyRequired:
        "Until the employer approves the KYC, the claim either will not open or is likely to be rejected. Filing it again does not move him.",
      whatToDo:
        "Ask your HR or administration department directly. If it is taking too long, escalate to a higher authority inside the organisation. If nobody responds, file it on EPFiGMS. If your employer's digital signature has expired he can register Aadhaar based e-Sign instead.",
      expectedOutput: "Bank account and Aadhaar KYC showing as approved against your UAN.",
    },
    sources: [
      {
        sourceId: "src:epfo-faq",
        evidence: E_EMPLOYER_APPROVES_KYC,
        confidence: 0.97,
        verificationStatus: "VERIFIED",
      },
      { sourceId: "src:epfo-faq", evidence: E_EMPLOYER_MUST_APPROVE, confidence: 0.97, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:epfo-faq",
        evidence:
          "Many important tasks like KYC attestation, transfer claim attestation etc are done online by the authorized persons of employer using their digital signatures or Aadhaar based e-Sign on EPFO portal.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      { sourceId: "src:epfo-faq", evidence: "Contact the employer to reject the pending KYC", confidence: 0.93, verificationStatus: "VERIFIED" },
      { sourceId: "src:epfo-faq", evidence: E_EMPLOYER_NOT_APPROVING, confidence: 0.96, verificationStatus: "VERIFIED" },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "verification:pf_date_of_exit_recorded",
    type: "VERIFICATION",
    name: "Your date of exit has to be in the EPFO database",
    description:
      "Normally the employer puts it there. If it is missing, the online Form 19 will not open and an old account will not show up for transfer. If it is there but wrong, or the reason of exit is wrong, only the employer can ask the PF office to correct it. What you can do yourself is mark it, but only after 60 days.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "EMPLOYER",
      whyRequired: "Date of Joining and Date of Exit of Member should be available in the EPFO Database.",
      whatToDo:
        "After 60 days from the day you left, mark the exit yourself on the member portal under Manage, Mark Exit. If a date is already recorded and it is wrong, or the reason of exit is wrong, contact your employer: only he can request the correction from the PF office.",
      expectedOutput: "A date of exit against the old member ID, in the month your employer last contributed.",
    },
    sources: [
      { sourceId: "src:epfo-ocs-faq", evidence: E_DOJ_DOE_AVAILABLE, confidence: 0.97, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:epfo-faq",
        evidence: "The Employer can make a request to the concerned PF Office for corrections.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-faq",
        evidence: "Contact employer to get the reason of exit rectified through the concerned PF Office.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      { sourceId: "src:epfo-faq", evidence: E_DOE_UPDATE_RULE, confidence: 0.96, verificationStatus: "VERIFIED" },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "verification:pf_date_of_joining_recorded",
    type: "VERIFICATION",
    name: "Your date of joining has to be in the EPFO database",
    description:
      "The one prerequisite even the advance claim has. A member cannot edit the date of joining held in the EPFO database, so if it is missing or wrong this is an employer job.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "EMPLOYER",
      whyRequired: "Member's Date of Joining should be available in the EPFO database.",
      whatToDo:
        "Ask your employer to request the correction from the concerned PF office. There is no counter you can do this at yourself.",
    },
    sources: [
      {
        sourceId: "src:epfo-ocs-faq",
        evidence: "Member's Date of Joining should be available in the EPFO database.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-faq",
        evidence: "The Employer can make a request to the concerned PF Office for corrections.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "verification:pf_employer_dsc_registered",
    type: "VERIFICATION",
    name: "Your employer's digital signature has to be registered with EPFO",
    description:
      "One step further back than the KYC approval. Before an employer can approve anything he needs a one time approval of his DSC or e-Sign from an EPFO regional office. A small or newly registered employer often has not done it.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "EMPLOYER",
      whatToDo:
        "Nothing you can do at the counter. The employer sends a one time registration request, duly signed, to the regional office.",
    },
    sources: [
      {
        sourceId: "src:epfo-members-faq",
        evidence: "The employer should have registered the digital signature certificate of his authorized signatories with EPFO.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-faq",
        evidence:
          "For using DSC/e-Sign, one time approval from Regional Offices of EPFO is required. The employers are required to send one time registration request to regional offices for approval, duly signed by the employer.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "verification:pf_employer_certifies_profile_update",
    type: "VERIFICATION",
    name: "Your employer has to certify the profile correction",
    description:
      "Employer approval of Joint Declarations used to add an average delay of nearly 28 days, which is the scale of the wait you are looking at.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "EMPLOYER",
      whatToDo:
        "Raise the correction request online, then chase the employer to approve it digitally. Nothing arrives at EPFO until he does.",
    },
    sources: [
      {
        sourceId: "src:epfo-pr-profile",
        evidence: "On an average this will eliminate a delay of nearly 28 days taken by employer to approve Joint Declarations (JDs).",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    // The only blocker in this file whose actor is the employer but whose
    // trigger is a choice the citizen made: a closed or unwanted bank account.
    id: "action:pf_change_bank_account_via_employer",
    type: "ACTION",
    name: "Get the bank account changed through your current employer",
    description:
      "Money goes to the account EPFO has on file. If that account is closed, or you want a different one, do not file the online claim first.",
    jurisdictionId: "IN",
    metadata: {
      blockedBy: "EMPLOYER",
      whyRequired: "The claim pays into the seeded account, so changing it has to happen before the claim, not after.",
      whatToDo: "Ask your current employer to get the bank account changed, and only then file the claim.",
    },
    sources: cite(
      "src:epfo-ocs-faq",
      "If the shown Bank Account is closed or if the member wants to use some other Bank Account, member should not prefer the online claim and first get the Bank Account changed through his current employer.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },

  // -- what the citizen can actually do ------------------------------------
  {
    id: "action:pf_activate_uan",
    type: "ACTION",
    name: "Activate your UAN",
    jurisdictionId: "IN",
    metadata: {
      whyRequired: "Nothing online opens until the UAN is activated and the mobile number used to activate it still works.",
      whatToDo:
        "Activate it on the member portal, or through the UMANG app, which also generates new UANs. Use a mobile number you still have.",
      expectedOutput: "A UAN you can log in with.",
    },
    sources: [
      { sourceId: "src:epfo-ocs-faq", evidence: E_UAN_ACTIVE, confidence: 0.97, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:epfo-member-portal",
        evidence: "Activate UAN\\\n\\\nActivate your UAN to access EPF services online",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-member-portal",
        evidence: "Dear Member, UAN activation for existing UANs and generation of new UANs can be done through the UMANG app.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:pf_link_kyc_to_uan",
    type: "ACTION",
    name: "Link your mobile, Aadhaar and bank account to your UAN",
    description:
      "The minimum set of details EPFO asks to be linked with the UAN for online services. The bank account has to carry its IFSC, and the Aadhaar has to be seeded so that the OTP eKYC works when you submit.",
    jurisdictionId: "IN",
    metadata: {
      whatToDo:
        "Enter them on the member portal under KYC. Entering them is your half of it. They do not count until your employer approves them.",
      expectedOutput: "Mobile, Aadhaar and bank account with IFSC sitting against your UAN, waiting for employer approval.",
    },
    sources: [
      { sourceId: "src:epfo-faq", evidence: E_KYC_MINIMUM, confidence: 0.92, verificationStatus: "VERIFIED" },
      { sourceId: "src:epfo-ocs-faq", evidence: E_AADHAAR_SEEDED, confidence: 0.96, verificationStatus: "VERIFIED" },
      { sourceId: "src:epfo-ocs-faq", evidence: E_BANK_SEEDED, confidence: 0.96, verificationStatus: "VERIFIED" },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:pf_seed_pan",
    type: "ACTION",
    name: "Get your PAN seeded in the EPFO database",
    description: "Only asked for on a final settlement where the service is under five years.",
    jurisdictionId: "IN",
    metadata: {
      whatToDo:
        "Add the PAN against your UAN before filing. The name on the PAN has to match the name in your PF record or the KYC will not complete.",
    },
    sources: [
      {
        sourceId: "src:epfo-ocs-faq",
        evidence:
          "Permanent Account Number (PAN) should be seeded in EPFO database for PF Final Settlement Claims in case his/her service is less than 5 years.",
        confidence: 0.95,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-faq",
        evidence: "The name as per Aadhaar and PAN must be same as that in PF records for KYC to be successfully completed.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:pf_mark_date_of_exit",
    type: "ACTION",
    name: "Mark your own date of exit on the member portal",
    officialName: "manage >> mark exit",
    description:
      "The one employer shaped problem you can solve yourself, and only after 60 days. Once the date of exit is updated it cannot be changed, so get it right the first time: it has to fall in the month your previous employer made his last contribution.",
    jurisdictionId: "IN",
    metadata: {
      whatToDo:
        "Log in to the member interface with your UAN and password, open Manage and then Mark Exit, pick the previous PF account from the select employment dropdown, enter the date and reason of exit, request the OTP that goes to your Aadhaar-linked mobile, and submit.",
      expectedOutput: "A date of exit recorded against the old member ID. It cannot be edited afterwards.",
      timeline: "Only possible 60 days after you leave",
    },
    sources: [
      { sourceId: "src:epfo-faq", evidence: E_MARK_EXIT, confidence: 0.95, verificationStatus: "VERIFIED" },
      { sourceId: "src:epfo-faq", evidence: E_SELF_MARK_AFTER_60, confidence: 0.96, verificationStatus: "VERIFIED" },
      { sourceId: "src:epfo-faq", evidence: E_DOE_UPDATE_RULE, confidence: 0.96, verificationStatus: "VERIFIED" },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:pf_merge_member_ids",
    type: "ACTION",
    name: "Merge your PF accounts into one",
    description:
      "The online claim screen prints a message telling you to do this before proceeding. The message is printed as a broken block of capitals, so what it is telling you to merge is our reading of it rather than a sentence off the page.",
    jurisdictionId: "IN",
    metadata: { whatToDo: "Merge the accounts into a single account before you go any further with the claim." },
    sources: derived("src:epfo-ocs-faq", "MSG2: ALL ACCOUNTS\nTO BE MERGED INTO\nSINGLE ACCOUNT\nBEFORE PROCEEDING", 0.75),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:pf_correct_uan_profile",
    type: "ACTION",
    name: "Correct your name or date of birth in the UAN",
    description:
      "Around 27% of the grievances EPF members file are about member profile or KYC issues, so this is not a rare corner. A mismatch between the UAN and your Aadhaar, PAN or bank details is likely to get the claim rejected, and the fix is a correction, not another claim.",
    jurisdictionId: "IN",
    metadata: {
      whyRequired: "The claim is likely to be rejected in case of mismatch.",
      whatToDo:
        "Raise the correction online from the member portal. A date of birth change needs a supporting document only when the date you are asking for differs from the Aadhaar date of birth by more than 3 years. For a name change after marriage the request goes with a copy of the marriage certificate or another document showing only the name changed.",
    },
    sources: [
      {
        sourceId: "src:epfo-faq",
        evidence: "Get the data in UAN corrected through joint declaration through the employer.The claim is likely to be rejected in case of mismatch.",
        confidence: 0.96,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-pr-profile",
        evidence: "At present, around 27% of the grievances filed by the members relate to member profile/KYC issues",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-faq",
        evidence:
          "In case you have requested for a change in date of birth which as per aadhar is having a difference of more than 3 years a document in support of the date of birth in Aadhar has to be uploaded.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:pf_kyc_via_field_office_attestation",
    type: "ACTION",
    name: "Get your KYC attested at the field office instead, if the establishment has closed",
    description:
      "The way out when there is no employer left to approve anything. The request goes to the concerned field office attested by one of the authorised officials listed in para 10.18 of the MAP Vol. II. The page does not reproduce that list, and neither does this graph.",
    jurisdictionId: "IN",
    metadata: {
      whatToDo:
        "Submit the KYC update request to your concerned EPFO field office, attested by one of the authorised officials. Ask the office which official on the para 10.18 list is easiest for you to reach.",
    },
    sources: cite("src:epfo-faq", E_CLOSED_ESTABLISHMENT, 0.95),
    lastVerifiedAt: RETRIEVED,
  },

  // -- documents -----------------------------------------------------------
  {
    id: "document_group:pf_bank_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of your bank account",
    description: "One of three, uploaded with the bank KYC. All three have to show your name, and the passbook page or statement has to show the account number and IFSC.",
    jurisdictionId: "IN",
    metadata: { requirementGroupId: "rg:pf_bank_proof" },
    sources: cite(
      "src:epfo-faq",
      "As per prevailing instructions it is mandatory to upload a cheque leaf containing the printed name of the member, or the first page of the bank Passbook or bank statement containing the name, account number and IFSC.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:pf_cheque_leaf",
    type: "DOCUMENT",
    name: "A cheque leaf with your name printed on it",
    officialName: "cheque leaf containing the printed name of the member",
    description: "Printed name, not handwritten. A cheque book from an account that prints no name will not do.",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite(
      "src:epfo-faq",
      "As per prevailing instructions it is mandatory to upload a cheque leaf containing the printed name of the member, or the first page of the bank Passbook or bank statement containing the name, account number and IFSC.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:pf_bank_passbook_first_page",
    type: "DOCUMENT",
    name: "The first page of your bank passbook",
    officialName: "the first page of the bank Passbook",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite(
      "src:epfo-faq",
      "As per prevailing instructions it is mandatory to upload a cheque leaf containing the printed name of the member, or the first page of the bank Passbook or bank statement containing the name, account number and IFSC.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:pf_bank_statement",
    type: "DOCUMENT",
    name: "A bank statement showing name, account number and IFSC",
    officialName: "bank statement containing the name, account number and IFSC",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: cite(
      "src:epfo-faq",
      "As per prevailing instructions it is mandatory to upload a cheque leaf containing the printed name of the member, or the first page of the bank Passbook or bank statement containing the name, account number and IFSC.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },

  // -- outputs -------------------------------------------------------------
  {
    id: "output:pf_settlement_payment",
    type: "OUTPUT",
    name: "Your PF, paid into the bank account EPFO has on file",
    description:
      "The pages never say in as many words where the money lands. What they say is that if the account shown is closed you must change it before claiming, which is where this comes from.",
    jurisdictionId: "IN",
    sources: derived(
      "src:epfo-ocs-faq",
      "If the shown Bank Account is closed or if the member wants to use some other Bank Account, member should not prefer the online claim and first get the Bank Account changed through his current employer.",
      0.8,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "output:pf_withdrawal_benefit",
    type: "OUTPUT",
    name: "The pension withdrawal benefit",
    officialName: "Withdrawal Benefit",
    jurisdictionId: "IN",
    sources: cite(
      "src:epfo-which-claim-form",
      "You can apply for Withdrawal Benefit or Scheme Certificate through Form 10C for retaining the Pension Fund Membership. Retention of the membership will give advantage of adding any future period of membership under the Fund and attain eligible service of 10 years to get pension.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "output:pf_scheme_certificate",
    type: "OUTPUT",
    name: "A Scheme Certificate",
    officialName: "Scheme Certificate",
    description:
      "Keeps your Pension Fund membership alive so that any later service adds up towards the ten years of eligible service that earn a pension.",
    jurisdictionId: "IN",
    sources: cite(
      "src:epfo-which-claim-form",
      "You can apply for Withdrawal Benefit or Scheme Certificate through Form 10C for retaining the Pension Fund Membership. Retention of the membership will give advantage of adding any future period of membership under the Fund and attain eligible service of 10 years to get pension.",
      0.94,
    ),
    lastVerifiedAt: RETRIEVED,
  },

  // -- where you actually do it -------------------------------------------
  {
    id: "portal:epfo_member_portal",
    type: "PORTAL",
    name: "EPFO Member e-SEWA",
    officialName: "Member Interface, Unified Portal",
    description: "Where all four claims are filed, where KYC is entered, and where you mark your own date of exit.",
    jurisdictionId: "IN",
    metadata: {
      url: "https://unifiedportal-mem.epfindia.gov.in/memberinterface/",
      channelType: "WEB",
    },
    sources: [
      { sourceId: "src:epfo-ocs-faq", evidence: E_THREE_FORMS, confidence: 0.97, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:epfo-member-portal",
        evidence: "Activate UAN\\\n\\\nActivate your UAN to access EPF services online",
        confidence: 0.9,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:epfo_claim_status",
    type: "PORTAL",
    name: "EPFO claim status",
    description: "The url EPFO itself gives out for checking where a claim has reached.",
    jurisdictionId: "IN",
    metadata: { url: "https://passbook.epfindia.gov.in/MemClaimStatusUAN/", channelType: "WEB" },
    sources: cite("src:epfo-faq", E_CLAIM_STATUS_URL, 0.96),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:epfo_passbook",
    type: "PORTAL",
    name: "EPF passbook",
    description:
      "Your account as EPFO holds it. Useful before you claim, to see the balance and which member IDs exist against your UAN.",
    jurisdictionId: "IN",
    metadata: { url: "https://passbook.epfindia.gov.in/MemberPassBook/login", channelType: "WEB" },
    sources: derived("src:epfo-passbook", E_HELPLINE, 0.75),
    lastVerifiedAt: RETRIEVED,
  },
  {
    // Modelled as a PORTAL, not a MOBILE_APP, on purpose: no page in the crawl
    // prints a Play Store or App Store id, and this file does not invent one.
    // The url is the official UMANG EPFO landing page.
    id: "portal:umang_epfo",
    type: "PORTAL",
    name: "UMANG, EPFO services",
    jurisdictionId: "IN",
    metadata: {
      url: "https://web.umang.gov.in/landing/department/epfo.html",
      channelType: "WEB",
      whatToDo:
        "Raise a claim, check claim status, seed your UAN with Aadhaar, view an EPFO office address or register a grievance from the same place. Track Claim shows the status only, never the money.",
    },
    sources: [
      { sourceId: "src:umang-epfo", evidence: E_UMANG_SERVICES, confidence: 0.93, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:umang-epfo",
        evidence: "Track the status (only the non financial details) of the claims raised against a member ID.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfigms",
        evidence: '"EPFiGMS is available in UMANG. Please lodge your grievances using UMANG Mobile Application and select EPFO Services"',
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "grievance:epfigms",
    type: "GRIEVANCE_CHANNEL",
    name: "EPFiGMS, the EPFO grievance portal",
    officialName: "EPFi Grievance Management System",
    description:
      "The route for the thing this journey is mostly about: an employer who will not act. Lodge it with your UAN and it is forwarded to the PF office your UAN is linked to. Grievances can be lodged from anywhere and land in the concerned office, of which there are now 135 across the country.",
    jurisdictionId: "IN",
    metadata: {
      url: "https://epfigms.gov.in",
      channelType: "GRIEVANCE_PORTAL",
      whatToDo:
        "Lodge it at https://epfigms.gov.in. Pick the status that matches what you hold, PF member if you have a UAN, and pick Others only if you have no UAN, PPO or establishment number. You can also lodge it from the UMANG app under EPFO Services.",
      timeline: "7 working days",
    },
    sources: [
      { sourceId: "src:epfo-faq", evidence: E_EPFIGMS_LODGE, confidence: 0.96, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:epfigms",
        evidence:
          "Grievances can be lodged at any place and will land in concerned office to which the grievances pertain. Grievances can be sent to Head office at New Delhi or to the field offices now 135 across the country.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfigms",
        evidence: "Grievance can be lodged by PF member, EPS Pensioner, Employer and Others\n\n- OTP verification\n\n- Online lodging of grievance/complaint based on UAN",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfigms-register",
        evidence:
          "For Speedy redress of your grievance, please select the appropriate Status if you have a UAN / PPO Number / Establishment Number. Others to be selected only when you do not have UAN / PPO Number/ Establishment Number.",
        confidence: 0.93,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:epfo-citizen-charter",
        evidence: "General time limit for settlement of any grievance shall be 7 working days.\n\n• In case of non-redressal, the grievance is escalated to the next higher authority.",
        confidence: 0.94,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "helpline:epfo",
    type: "HELPLINE",
    name: "EPFO help desk",
    jurisdictionId: "IN",
    metadata: {
      channelType: "PHONE",
      phoneNumbers: ["1800118005"],
      whatToDo:
        "For a balance you do not need the phone desk at all: give a missed call to 9966044425, or SMS EPFOHO UAN to 7738299899 from your registered mobile number.",
    },
    sources: [
      { sourceId: "src:epfo-passbook", evidence: E_HELPLINE, confidence: 0.95, verificationStatus: "VERIFIED" },
      {
        sourceId: "src:umang-epfo",
        evidence:
          "UAN activated Members may know their latest PF contribution and balance available with EPFO by sending an SMS at 7738299899 from registered mobile number.\nEPFOHO UAN to 7738299899.",
        confidence: 0.92,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    // No address and no phone number, on purpose. The official Contact page is
    // a search form and prints no static directory, so this node tells you how
    // to find yours rather than inventing one.
    id: "office:epfo_field_office",
    type: "OFFICE",
    name: "Your EPFO regional or district office",
    description:
      "The office your UAN is linked to. Where a closed-establishment KYC attestation goes, and where an employer sends a correction request.",
    jurisdictionId: "IN",
    metadata: {
      officeType: "EPFO Regional/District Office",
      channelType: "PHYSICAL_OFFICE",
      whatToDo:
        "Look yours up on the official Contact Us page: click the zonal office your regional or district office falls under, then the office itself, to get its contact details.",
    },
    sources: cite("src:epfo-faq", E_OFFICE_LOOKUP, 0.94),
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "office:regional_pf_commissioner",
    type: "OFFICE",
    name: "The Regional P.F. Commissioner in charge of grievances",
    description:
      "The only escalation above EPFiGMS that an official EPFO page actually prints. You can also appear before the Commissioner in person at the Nidhi Apke Nikat program, held on the 10th of every month.",
    jurisdictionId: "IN",
    metadata: {
      officeType: "EPFO Regional Office",
      channelType: "PHYSICAL_OFFICE",
      whatToDo:
        "If the PF is not settled, approach the Regional P.F. Commissioner in charge of grievances, or go to Nidhi Apke Nikat on the 10th of the month.",
    },
    sources: cite("src:epfo-faq", E_ESCALATION_LADDER, 0.95),
    lastVerifiedAt: RETRIEVED,
  },
];

/**
 * Four claims, one set of channels. Written once rather than four times over,
 * the way driving-licence.ts writes its RTO visit edges.
 */
const channelEdges = (serviceId: string, slug: string): GraphEdge[] => [
  {
    id: `e:${slug}_apply_at_member_portal`,
    from: serviceId,
    to: "portal:epfo_member_portal",
    type: "APPLY_AT",
    note: "Filed from the member interface directly. No employer attestation on the form itself.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_THREE_FORMS, 0.97),
  },
  {
    id: `e:${slug}_available_via_umang`,
    from: serviceId,
    to: "portal:umang_epfo",
    type: "AVAILABLE_VIA",
    verificationStatus: "VERIFIED",
    sources: cite("src:umang-epfo", E_UMANG_SERVICES, 0.93),
  },
  {
    id: `e:${slug}_track_at_claim_status`,
    from: serviceId,
    to: "portal:epfo_claim_status",
    type: "TRACK_AT",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_CLAIM_STATUS_URL, 0.96),
  },
  {
    id: `e:${slug}_call_helpline`,
    from: serviceId,
    to: "helpline:epfo",
    type: "CALL_IF",
    note: "For a balance question, use the missed call or the SMS instead. It is faster than the desk.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-passbook", E_HELPLINE, 0.95),
  },
  {
    id: `e:${slug}_escalate_to_epfigms`,
    from: serviceId,
    to: "grievance:epfigms",
    type: "ESCALATE_TO",
    note: "Nothing moving, or the employer will not act. Lodge it with your UAN and it goes to the PF office your UAN is linked to.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_EPFIGMS_LODGE, 0.96),
  },
];

export const edges: GraphEdge[] = [
  // -- final settlement, Form 19 -------------------------------------------
  {
    id: "e:pf19_requires_not_working",
    from: "service:pf_final_settlement",
    to: "eligibility:pf_not_working_covered_establishment",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_NOT_WORKING_AND_TWO_MONTHS, 0.96),
  },
  {
    id: "e:pf19_requires_two_months",
    from: "service:pf_final_settlement",
    to: "eligibility:pf_two_months_since_leaving",
    type: "REQUIRES",
    note: "Two months from the day you left, not from the day the employer got round to the paperwork.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_NOT_WORKING_AND_TWO_MONTHS, 0.96),
  },
  {
    id: "e:pf19_requires_active_uan",
    from: "service:pf_final_settlement",
    to: "action:pf_activate_uan",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_UAN_ACTIVE, 0.97),
  },
  {
    id: "e:pf19_requires_kyc",
    from: "service:pf_final_settlement",
    to: "action:pf_link_kyc_to_uan",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_BANK_SEEDED, 0.96),
  },
  {
    id: "e:pf19_depends_on_employer_kyc",
    from: "service:pf_final_settlement",
    to: "verification:pf_employer_kyc_approval",
    type: "DEPENDS_ON",
    note: "This one is not yours to fix. Until the employer approves your bank and Aadhaar KYC with his digital signature, filing the claim again changes nothing.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_EMPLOYER_APPROVES_KYC, 0.97),
  },
  {
    id: "e:pf19_depends_on_date_of_exit",
    from: "service:pf_final_settlement",
    to: "verification:pf_date_of_exit_recorded",
    type: "DEPENDS_ON",
    note: "Normally the employer's job. After 60 days you can mark it yourself, once, and it cannot be changed afterwards.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_DOJ_DOE_AVAILABLE, 0.97),
  },
  {
    id: "e:pf19_depends_on_date_of_joining",
    from: "service:pf_final_settlement",
    to: "verification:pf_date_of_joining_recorded",
    type: "DEPENDS_ON",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_DOJ_DOE_AVAILABLE, 0.97),
  },
  {
    id: "e:pf19_requires_pan_under_five_years",
    from: "service:pf_final_settlement",
    to: "action:pf_seed_pan",
    type: "REQUIRES",
    condition: { field: "service_years", operator: "LT", value: 5 },
    note: "Only asked for when your service is under five years.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:epfo-ocs-faq",
      "Permanent Account Number (PAN) should be seeded in EPFO database for PF Final Settlement Claims in case his/her service is less than 5 years.",
      0.95,
    ),
  },
  {
    id: "e:pf19_requires_merged_accounts",
    from: "service:pf_final_settlement",
    to: "action:pf_merge_member_ids",
    type: "REQUIRES",
    condition: { field: "multiple_member_ids", operator: "EQ", value: true },
    verificationStatus: "NORMALIZED",
    sources: derived("src:epfo-ocs-faq", "MSG2: ALL ACCOUNTS\nTO BE MERGED INTO\nSINGLE ACCOUNT\nBEFORE PROCEEDING", 0.75),
  },
  {
    id: "e:pf19_requires_profile_correction",
    from: "service:pf_final_settlement",
    to: "action:pf_correct_uan_profile",
    type: "REQUIRES",
    condition: { field: "uan_details_mismatch", operator: "EQ", value: true },
    note: "Fix the mismatch first. A claim filed over one is likely to come back rejected.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:epfo-faq",
      "Get the data in UAN corrected through joint declaration through the employer.The claim is likely to be rejected in case of mismatch.",
      0.96,
    ),
  },
  {
    id: "e:pf19_requires_bank_change_first",
    from: "service:pf_final_settlement",
    to: "action:pf_change_bank_account_via_employer",
    type: "REQUIRES",
    condition: { field: "epfo_bank_account_closed", operator: "EQ", value: true },
    note: "Do not file the online claim first. Get the account changed, then claim.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:epfo-ocs-faq",
      "If the shown Bank Account is closed or if the member wants to use some other Bank Account, member should not prefer the online claim and first get the Bank Account changed through his current employer.",
      0.94,
    ),
  },
  {
    id: "e:pf19_produces_payment",
    from: "service:pf_final_settlement",
    to: "output:pf_settlement_payment",
    type: "PRODUCES",
    note: "It lands in the bank account seeded against your UAN, which is why a closed account has to be changed before you claim and not after.",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:epfo-ocs-faq",
      "If the shown Bank Account is closed or if the member wants to use some other Bank Account, member should not prefer the online claim and first get the Bank Account changed through his current employer.",
      0.8,
    ),
  },
  {
    id: "e:pf19_track_at_passbook",
    from: "service:pf_final_settlement",
    to: "portal:epfo_passbook",
    type: "TRACK_AT",
    note: "Before you claim, look at the passbook: it shows the balance and which member IDs sit under your UAN.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:epfo-passbook", E_HELPLINE, 0.75),
  },
  {
    id: "e:pf19_escalate_to_rpfc",
    from: "service:pf_final_settlement",
    to: "office:regional_pf_commissioner",
    type: "ESCALATE_TO",
    note: "If the amount has not been settled, this is the escalation EPFO itself prints, alongside EPFiGMS.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_ESCALATION_LADDER, 0.95),
  },
  ...channelEdges("service:pf_final_settlement", "pf19"),

  // -- pension withdrawal, Form 10C ----------------------------------------
  {
    id: "e:pf10c_requires_service_band",
    from: "service:pf_pension_withdrawal",
    to: "eligibility:pf_service_band_for_10c",
    type: "REQUIRES",
    note: "In addition to the Form 19 conditions, not instead of them.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_10C_SERVICE_BAND, 0.96),
  },
  {
    // Kept as a conflict on purpose. The online claim FAQ prints a 9.5 year
    // ceiling for filing online, the Which Claim Form page talks about ten
    // years of eligible service. Neither page is overruled here.
    id: "e:pf10c_requires_eligible_service",
    from: "service:pf_pension_withdrawal",
    to: "eligibility:pf_eligible_service_under_10_years",
    type: "REQUIRES",
    note: "Two official pages put the line in different places: the online claim FAQ says less than 9.5 years of total service, the Which Claim Form page talks about 10 years of eligible service. If you are anywhere between 9 and 10 years, ask your PF office which number applies to you before you file, because the two pages disagree.",
    verificationStatus: "CONFLICTING",
    sources: [
      { sourceId: "src:epfo-ocs-faq", evidence: E_10C_SERVICE_BAND, confidence: 0.96, verificationStatus: "CONFLICTING" },
      {
        sourceId: "src:epfo-which-claim-form",
        evidence:
          "You can apply for Withdrawal Benefit or Scheme Certificate through Form 10C for retaining the Pension Fund Membership. Retention of the membership will give advantage of adding any future period of membership under the Fund and attain eligible service of 10 years to get pension.",
        confidence: 0.94,
        verificationStatus: "CONFLICTING",
      },
    ],
  },
  {
    id: "e:pf10c_requires_not_working",
    from: "service:pf_pension_withdrawal",
    to: "eligibility:pf_not_working_covered_establishment",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_NOT_WORKING_AND_TWO_MONTHS, 0.96),
  },
  {
    id: "e:pf10c_requires_active_uan",
    from: "service:pf_pension_withdrawal",
    to: "action:pf_activate_uan",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_UAN_ACTIVE, 0.97),
  },
  {
    id: "e:pf10c_depends_on_employer_kyc",
    from: "service:pf_pension_withdrawal",
    to: "verification:pf_employer_kyc_approval",
    type: "DEPENDS_ON",
    note: "Same employer approval as Form 19. The form needs no attestation, the KYC behind it does.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_EMPLOYER_APPROVES_KYC, 0.97),
  },
  {
    id: "e:pf10c_depends_on_date_of_exit",
    from: "service:pf_pension_withdrawal",
    to: "verification:pf_date_of_exit_recorded",
    type: "DEPENDS_ON",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_DOJ_DOE_AVAILABLE, 0.97),
  },
  {
    id: "e:pf10c_produces_withdrawal_benefit",
    from: "service:pf_pension_withdrawal",
    to: "output:pf_withdrawal_benefit",
    type: "PRODUCES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:epfo-which-claim-form",
      "You can apply for Withdrawal Benefit or Scheme Certificate through Form 10C for retaining the Pension Fund Membership. Retention of the membership will give advantage of adding any future period of membership under the Fund and attain eligible service of 10 years to get pension.",
      0.94,
    ),
  },
  {
    id: "e:pf10c_produces_scheme_certificate",
    from: "service:pf_pension_withdrawal",
    to: "output:pf_scheme_certificate",
    type: "PRODUCES",
    note: "The other half of the same choice. Take the certificate instead of the cash if you expect to work again and want the years to count towards a pension.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:epfo-which-claim-form",
      "You can apply for Withdrawal Benefit or Scheme Certificate through Form 10C for retaining the Pension Fund Membership. Retention of the membership will give advantage of adding any future period of membership under the Fund and attain eligible service of 10 years to get pension.",
      0.94,
    ),
  },
  ...channelEdges("service:pf_pension_withdrawal", "pf10c"),

  // -- advance, Form 31 ----------------------------------------------------
  {
    id: "e:pf31_requires_active_uan",
    from: "service:pf_advance",
    to: "action:pf_activate_uan",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_UAN_ACTIVE, 0.97),
  },
  {
    id: "e:pf31_requires_kyc",
    from: "service:pf_advance",
    to: "action:pf_link_kyc_to_uan",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_AADHAAR_SEEDED, 0.96),
  },
  {
    id: "e:pf31_depends_on_employer_kyc",
    from: "service:pf_advance",
    to: "verification:pf_employer_kyc_approval",
    type: "DEPENDS_ON",
    note: "Still the employer, even though you have not left the job.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_EMPLOYER_APPROVES_KYC, 0.97),
  },
  {
    id: "e:pf31_depends_on_date_of_joining",
    from: "service:pf_advance",
    to: "verification:pf_date_of_joining_recorded",
    type: "DEPENDS_ON",
    note: "The advance asks for the date of joining, not the date of exit. You are not leaving.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", "Member's Date of Joining should be available in the EPFO database.", 0.95),
  },
  ...channelEdges("service:pf_advance", "pf31"),

  // -- transfer, Form 13 ---------------------------------------------------
  {
    id: "e:pf13_requires_active_uan",
    from: "service:pf_transfer",
    to: "action:pf_activate_uan",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-ocs-faq", E_UAN_ACTIVE, 0.97),
  },
  {
    id: "e:pf13_depends_on_date_of_exit",
    from: "service:pf_transfer",
    to: "verification:pf_date_of_exit_recorded",
    type: "DEPENDS_ON",
    note: "If the old account does not even appear on the transfer screen, this is why. The date of exit of the previous service is missing.",
    verificationStatus: "VERIFIED",
    sources: [
      {
        sourceId: "src:epfo-faq",
        evidence:
          "Above situation occurs when Date of exit of previous service is not available in unified Portal. After updating date of exit, submit online Form-13 and transfer the previous account to current member account.",
        confidence: 0.96,
        verificationStatus: "VERIFIED",
      },
      { sourceId: "src:epfo-faq", evidence: E_DOE_UPDATE_RULE, confidence: 0.96, verificationStatus: "VERIFIED" },
    ],
  },
  ...channelEdges("service:pf_transfer", "pf13"),

  // -- how the blockers actually come apart --------------------------------
  {
    id: "e:pf_employer_kyc_depends_on_your_kyc_entry",
    from: "verification:pf_employer_kyc_approval",
    to: "action:pf_link_kyc_to_uan",
    type: "DEPENDS_ON",
    note: "There is nothing for him to approve until you have entered it.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:epfo-faq", E_EMPLOYER_APPROVES_KYC, 0.85),
  },
  {
    id: "e:pf_employer_kyc_depends_on_dsc",
    from: "verification:pf_employer_kyc_approval",
    to: "verification:pf_employer_dsc_registered",
    type: "DEPENDS_ON",
    // Dropped once you say the establishment has closed: there is no employer
    // left whose signature could be registered, and the field office route
    // above replaces the whole approval.
    condition: { field: "establishment_closed", operator: "NEQ", value: true },
    note: "If your employer says he cannot approve it, this is usually the reason. His digital signature or e-Sign is not registered with EPFO yet.",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:epfo-faq",
      "For using DSC/e-Sign, one time approval from Regional Offices of EPFO is required. The employers are required to send one time registration request to regional offices for approval, duly signed by the employer.",
      0.85,
    ),
  },
  {
    id: "e:pf_employer_kyc_escalate_to_epfigms",
    from: "verification:pf_employer_kyc_approval",
    to: "grievance:epfigms",
    type: "ESCALATE_TO",
    note: "Ask HR, then escalate inside the organisation, and if nobody responds take it to EPF Grievance. That is EPFO's own printed order.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_EMPLOYER_NOT_APPROVING, 0.96),
  },
  {
    // Pointed outward from the blocker on purpose, unlike the inward
    // ALTERNATIVE_TO edges in certificates.ts. This is the escape hatch for the
    // citizen whose employer no longer exists, so it has to be walked into and
    // it has to make the compiler ask whether the establishment has closed.
    id: "e:pf_employer_kyc_via_field_office_if_closed",
    from: "verification:pf_employer_kyc_approval",
    to: "action:pf_kyc_via_field_office_attestation",
    type: "DEPENDS_ON",
    condition: { field: "establishment_closed", operator: "EQ", value: true },
    note: "If the establishment has closed there is no employer left to approve anything, and the field office takes an attested request instead. This replaces the employer approval, it does not wait for it.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_CLOSED_ESTABLISHMENT, 0.95),
  },
  {
    id: "e:pf_kyc_field_office_visit_at",
    from: "action:pf_kyc_via_field_office_attestation",
    to: "office:epfo_field_office",
    type: "VISIT_AT",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_CLOSED_ESTABLISHMENT, 0.95),
  },
  {
    id: "e:pf_date_of_exit_depends_on_mark_exit",
    from: "verification:pf_date_of_exit_recorded",
    to: "action:pf_mark_date_of_exit",
    type: "DEPENDS_ON",
    note: "The one employer shaped problem with a citizen shaped fix, and only after 60 days.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_SELF_MARK_AFTER_60, 0.96),
  },
  {
    id: "e:pf_date_of_exit_correction_at_field_office",
    from: "verification:pf_date_of_exit_recorded",
    to: "office:epfo_field_office",
    type: "VISIT_AT",
    note: "Only your employer can ask for a correction, and he asks this office. Going yourself will not get the date changed.",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", "The Employer can make a request to the concerned PF Office for corrections.", 0.94),
  },
  {
    id: "e:pf_mark_exit_apply_at_member_portal",
    from: "action:pf_mark_date_of_exit",
    to: "portal:epfo_member_portal",
    type: "APPLY_AT",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-faq", E_MARK_EXIT, 0.95),
  },
  {
    id: "e:pf_activate_uan_apply_at_member_portal",
    from: "action:pf_activate_uan",
    to: "portal:epfo_member_portal",
    type: "APPLY_AT",
    verificationStatus: "VERIFIED",
    sources: cite("src:epfo-member-portal", "Activate UAN\\\n\\\nActivate your UAN to access EPF services online", 0.9),
  },
  {
    id: "e:pf_activate_uan_available_via_umang",
    from: "action:pf_activate_uan",
    to: "portal:umang_epfo",
    type: "AVAILABLE_VIA",
    note: "The portal itself tells you to do it here, both for an existing UAN and for a new one.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:epfo-member-portal",
      "Dear Member, UAN activation for existing UANs and generation of new UANs can be done through the UMANG app.",
      0.94,
    ),
  },
  // Everything else on this journey happens after logging into the member
  // interface, and you cannot log in with a UAN nobody has activated. Without
  // these two edges the topological sort is free to put "activate your UAN"
  // after "log in and mark your date of exit", which is advice in the wrong
  // order. NORMALIZED because no page prints the sequence, it is read off the
  // fact that both quotes describe logging in with the UAN.
  {
    id: "e:pf_link_kyc_depends_on_active_uan",
    from: "action:pf_link_kyc_to_uan",
    to: "action:pf_activate_uan",
    type: "DEPENDS_ON",
    note: "Activate the UAN first. There is nothing to log into until you have.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:epfo-ocs-faq", E_UAN_ACTIVE, 0.8),
  },
  {
    id: "e:pf_mark_exit_depends_on_active_uan",
    from: "action:pf_mark_date_of_exit",
    to: "action:pf_activate_uan",
    type: "DEPENDS_ON",
    note: "You mark the exit from inside the member interface, so the UAN has to be active first.",
    verificationStatus: "NORMALIZED",
    sources: derived("src:epfo-faq", E_MARK_EXIT, 0.8),
  },
  {
    id: "e:pf_link_kyc_requires_bank_proof",
    from: "action:pf_link_kyc_to_uan",
    to: "document_group:pf_bank_proof",
    type: "REQUIRES",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:epfo-faq",
      "As per prevailing instructions it is mandatory to upload a cheque leaf containing the printed name of the member, or the first page of the bank Passbook or bank statement containing the name, account number and IFSC.",
      0.94,
    ),
  },
  {
    id: "e:pf_link_kyc_apply_at_member_portal",
    from: "action:pf_link_kyc_to_uan",
    to: "portal:epfo_member_portal",
    type: "APPLY_AT",
    verificationStatus: "NORMALIZED",
    sources: derived("src:epfo-faq", E_KYC_MINIMUM, 0.75),
  },
  {
    id: "e:pf_seed_pan_apply_at_member_portal",
    from: "action:pf_seed_pan",
    to: "portal:epfo_member_portal",
    type: "APPLY_AT",
    verificationStatus: "NORMALIZED",
    sources: derived(
      "src:epfo-ocs-faq",
      "Permanent Account Number (PAN) should be seeded in EPFO database for PF Final Settlement Claims in case his/her service is less than 5 years.",
      0.75,
    ),
  },
  {
    id: "e:pf_merge_member_ids_apply_at_member_portal",
    from: "action:pf_merge_member_ids",
    to: "portal:epfo_member_portal",
    type: "APPLY_AT",
    verificationStatus: "NORMALIZED",
    sources: derived("src:epfo-ocs-faq", "MSG2: ALL ACCOUNTS\nTO BE MERGED INTO\nSINGLE ACCOUNT\nBEFORE PROCEEDING", 0.7),
  },
  {
    // A real conflict between two official EPFO pages, kept as one. The 2018
    // members FAQ says the member cannot edit these fields at all. The January
    // 2025 press release says an Aadhaar validated member can edit exactly
    // these fields himself. Neither is thrown away and neither is averaged.
    id: "e:pf_correct_profile_apply_at_member_portal",
    from: "action:pf_correct_uan_profile",
    to: "portal:epfo_member_portal",
    type: "APPLY_AT",
    note: "Two official EPFO pages disagree about whether you can do this yourself. The older members FAQ says a member cannot edit his date of birth, date of joining or date of exit at all. A January 2025 press release says a member whose UAN is already Aadhaar validated can update exactly those fields himself with no document. Try it on the portal first. If the field is locked for you, it falls back to the employer route, and neither page is wrong for everyone.",
    verificationStatus: "CONFLICTING",
    sources: [
      { sourceId: "src:epfo-members-faq", evidence: E_MEMBER_CANNOT_EDIT, confidence: 0.9, verificationStatus: "CONFLICTING" },
      { sourceId: "src:epfo-pr-profile", evidence: E_SELF_UPDATE_2025, confidence: 0.95, verificationStatus: "CONFLICTING" },
    ],
  },
  {
    // Left unconditional rather than gated on a "UAN issued before 1-10-2017"
    // field, because gating it would be picking one page over the other.
    id: "e:pf_profile_fix_depends_on_employer_certification",
    from: "action:pf_correct_uan_profile",
    to: "verification:pf_employer_certifies_profile_update",
    type: "DEPENDS_ON",
    note: "Whether your employer has to sign off on the correction depends on which page you read. The 2025 press release says only a UAN obtained before 1 October 2017 needs employer certification. The FAQ, writing about a name change, says the member applies online and the employer digitally approves. Assume he is in the loop until your own portal screen tells you otherwise, and budget for the wait.",
    verificationStatus: "CONFLICTING",
    sources: [
      {
        sourceId: "src:epfo-pr-profile",
        evidence: "Only, in certain cases where UAN was obtained prior to 1-10-2017, the updation would require certification of employer only.",
        confidence: 0.94,
        verificationStatus: "CONFLICTING",
      },
      {
        sourceId: "src:epfo-faq",
        evidence:
          "Member has to apply online and employer will digitally approve the request. The correction request can be submitted online or offline (joint request) along with a copy of the marriage certificate or such other documents which can prove that only the name of the member has changed from before marriage.",
        confidence: 0.92,
        verificationStatus: "CONFLICTING",
      },
    ],
  },
  {
    id: "e:pf_epfigms_escalate_to_rpfc",
    from: "grievance:epfigms",
    to: "office:regional_pf_commissioner",
    type: "ESCALATE_TO",
    note: "Seven working days is the printed limit. If nothing has happened by then the grievance is meant to go up a level by itself, and this is the level.",
    verificationStatus: "VERIFIED",
    sources: cite(
      "src:epfo-citizen-charter",
      "General time limit for settlement of any grievance shall be 7 working days.\n\n• In case of non-redressal, the grievance is escalated to the next higher authority.",
      0.94,
    ),
  },
];

export const requirementGroups: RequirementGroup[] = [
  {
    id: "rg:pf_bank_proof",
    ownerNodeId: "document_group:pf_bank_proof",
    mode: "ANY_OF",
    jurisdictionId: "IN",
    members: [
      { nodeId: "document:pf_cheque_leaf", note: "Only if your name is printed on it." },
      { nodeId: "document:pf_bank_passbook_first_page", note: "It has to show the account number and the IFSC." },
      { nodeId: "document:pf_bank_statement", note: "It has to show the account number and the IFSC." },
    ],
    sources: cite(
      "src:epfo-faq",
      "As per prevailing instructions it is mandatory to upload a cheque leaf containing the printed name of the member, or the first page of the bank Passbook or bank statement containing the name, account number and IFSC.",
      0.94,
    ),
  },
];

export const questions: QuestionDefinition[] = [
  {
    field: "service_years",
    label: "How many years were you in this job?",
    help: "EPFO's own pages say 'total service' on one page and 'eligible service' on another, so give the length of your PF membership and check the number against your passbook if you are near a cut off.",
    inputType: "NUMBER",
  },
  {
    field: "months_since_leaving",
    label: "How many months since you left?",
    help: "Counted from the day you actually stopped working, not from the day the paperwork was done.",
    inputType: "NUMBER",
  },
  {
    field: "currently_working_covered_establishment",
    label: "Are you working right now in a place that deducts PF?",
    help: "If you are, a final settlement is not open to you, though a transfer or an advance may be.",
    inputType: "BOOLEAN",
  },
  {
    field: "uan_details_mismatch",
    label: "Do your name, date of birth or bank details differ between your UAN and your Aadhaar, PAN or bank?",
    help: "Even a small difference. Around 27% of member grievances are about exactly this.",
    inputType: "BOOLEAN",
  },
  {
    field: "epfo_bank_account_closed",
    label: "Is the bank account EPFO has on file closed, or do you want the money somewhere else?",
    inputType: "BOOLEAN",
  },
  {
    field: "multiple_member_ids",
    label: "Do you have more than one PF account under your UAN?",
    help: "Old jobs leave old member IDs behind. Your passbook lists them.",
    inputType: "BOOLEAN",
  },
  {
    field: "establishment_closed",
    label: "Has the company you worked for shut down?",
    help: "If there is no employer left to approve your KYC, the field office can take an attested request instead.",
    inputType: "BOOLEAN",
  },
];
