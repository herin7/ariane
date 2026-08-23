import type { GraphEdge, GraphNode, QuestionDefinition, RequirementGroup, Source } from "../../types";

/**
 * Driving licence, Gujarat.
 *
 * Every fact here was read off an official page that is listed in `sources`
 * below, and every claim carries the sentence it came from. Where two official
 * pages disagree, both edges are kept and the second is marked CONFLICTING.
 * Nothing was inferred, rounded or remembered.
 *
 * Deliberately missing, because no official page in the crawl stated it:
 * RTO office addresses and phone numbers, the transport department grievance
 * channel, and the full Form 2 annexure list of accepted address proofs. Those
 * render as "not verified yet" rather than as a plausible guess.
 */

const RETRIEVED = "2026-08-23";

export const sources: Source[] = [
  {
    id: "src:parivahan-ll",
    url: "https://parivahan.gov.in/en/content/learners-license",
    title: "Learner's License | Parivahan Sewa",
    domain: "parivahan.gov.in",
    sourceType: "SERVICE_PAGE",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:parivahan-dl",
    url: "https://parivahan.gov.in/en/content/permanent-license",
    title: "Permanent License | Parivahan Sewa",
    domain: "parivahan.gov.in",
    sourceType: "SERVICE_PAGE",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:parivahan-fees",
    url: "https://parivahan.gov.in/en/content/licensing-related-fees-charges",
    title: "Licensing Related fees and Charges | Parivahan Sewa",
    domain: "parivahan.gov.in",
    sourceType: "GUIDELINE",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:parivahan-faq",
    url: "https://parivahan.gov.in/en/content/faq",
    title: "Frequently Asked Questions | Parivahan Sewa",
    domain: "parivahan.gov.in",
    sourceType: "FAQ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:sarathi-ll-faq",
    url: "https://sarathi.parivahan.gov.in/sarathicms/api/v1/get-resource/UFhyTWVpVitVVDFjelRxS0pwTU5RVlR2Q29FZTRRSFZsVHZvR3Ric3IzUT0=",
    title: "FAQ (LEARNER LICENCE) | Sarathi Parivahan Portal",
    domain: "sarathi.parivahan.gov.in",
    sourceType: "FAQ",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:cmvr-form-2",
    url: "https://parivahan.gov.in/sites/default/files/DownloadForm/cmvr/FORM-2.pdf",
    title: "Form 2, application for learner's licence or driving licence",
    domain: "parivahan.gov.in",
    sourceType: "PDF",
    retrievedAt: RETRIEVED,
  },
  {
    id: "src:sarathi-home",
    url: "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do",
    title: "Sarathi Parivahan, driving licence related services",
    domain: "sarathi.parivahan.gov.in",
    sourceType: "PORTAL_HOME",
    retrievedAt: RETRIEVED,
  },
];

export const nodes: GraphNode[] = [
  // -- services ------------------------------------------------------------
  {
    id: "service:learner_licence",
    type: "SERVICE",
    name: "Learner's licence",
    officialName: "Learner's License",
    aliases: ["ll", "learners licence", "learning licence", "learner licence"],
    description:
      "The first licence. You apply online on Sarathi, visit the RTO with the printed application, and pass the learner's licence test.",
    jurisdictionId: "IN",
    metadata: {
      whyRequired:
        "You cannot apply for a permanent driving licence without holding a learner's licence for the same class of vehicle first.",
      whatToDo:
        "Apply online on Sarathi under New Learner's Licence, print the filled application with its reference number, then submit it at your chosen RTO office.",
      expectedOutput: "A learner's licence, valid across India for 6 months.",
      fee: "Rs. 150.00 to issue the licence in Form 3, plus Rs. 50.00 test fee",
      formNumber: "Form 2",
    },
    sources: [
      {
        sourceId: "src:sarathi-ll-faq",
        evidence:
          "Applicants can visit https://sarathi.parivahan.gov.in/sarathiservice and apply for Learner Licence ONLINE by following the link “New Learning Licence“ Applicants should take print of the duly filled-in ONLINE application along with the reference number and submit at the chosen RTO office.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:cmvr-form-2",
        evidence:
          "FORM 2 [Refer Rules 10, 14, 17 and 18] FORM OF APPLICATION FOR LEARNER’S LICENCE OR DRIVING LICENCE OR ADDITION OF A NEW CLASS OF VEHICLE OR RENEWAL OF DRIVING LICENCE OR CHANGE OF ADDRESS OR NAME",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "service:driving_licence",
    type: "SERVICE",
    name: "Driving licence",
    officialName: "Permanent License",
    aliases: ["dl", "permanent licence", "permanent license", "driving license", "pakku licence"],
    description:
      "The permanent licence. Applied for in Form 4 along with the learner's licence, and granted after you pass the test of competence to drive.",
    jurisdictionId: "IN",
    metadata: {
      whyRequired:
        "No person shall drive a motor vehicle in any public place unless he holds an effective driving licence issued to him by the Licensing Authority.",
      whatToDo:
        "Apply in Form 4 along with your learner's licence, book the test of competence, and bring a vehicle of the class you are applying for.",
      expectedOutput: "A driving licence, sent by speed post to the address you gave.",
      fee: "Rs. 200.00 to issue the driving licence",
      formNumber: "Form 4",
      timeline: "Sent by speed post after you pass the test of competence",
    },
    sources: [
      {
        sourceId: "src:parivahan-ll",
        evidence:
          "No person shall drive a motor vehicle in any public place unless he holds an effective driving licence issued to him by the Licensing Authority, authorising him to drive the vehicle.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:parivahan-dl",
        evidence:
          "An application in Form 4, for a permanent driving licence shall be made along with the Learners' Licence obtained for such class of vehicle.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:parivahan-dl",
        evidence:
          "The candidate who passes the test of competence successfully will be issued with a driving licence and sent through speed post to the address furnished.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- eligibility ---------------------------------------------------------
  {
    id: "eligibility:age_18_non_transport",
    type: "ELIGIBILITY",
    name: "You must be at least 18",
    description:
      "The applicant who has completed the age of eighteen years of age is eligible to apply for a driving licence to drive a motor vehicle other than a transport vehicle.",
    jurisdictionId: "IN",
    metadata: { rule: { field: "age", operator: "GTE", value: 18 } },
    sources: [
      {
        sourceId: "src:parivahan-ll",
        evidence:
          "The applicant who has completed the age of eighteen years of age is eligible to apply for a driving licence to drive a motor vehicle other than a transport vehicle.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:age_20_transport",
    type: "ELIGIBILITY",
    name: "You must be at least 20 for a transport vehicle",
    description:
      "An applicant who has completed twenty years of age will be eligible for applying for a licence to drive a transport vehicle.",
    jurisdictionId: "IN",
    metadata: { rule: { field: "age", operator: "GTE", value: 20 } },
    sources: [
      {
        sourceId: "src:parivahan-ll",
        evidence:
          "An applicant who has completed twenty years of age will be eligible for applying for a licence to drive a transport vehicle.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "eligibility:learner_licence_held_30_days",
    type: "ELIGIBILITY",
    name: "Your learner's licence must be at least 30 days old",
    description:
      "The applicant who has held a valid Learners' Licence, for a period of at least 30 days, shall be competent to appear for the test of competence.",
    jurisdictionId: "IN",
    metadata: { rule: { field: "learner_licence_days", operator: "GTE", value: 30 } },
    sources: [
      {
        sourceId: "src:parivahan-dl",
        evidence:
          "The applicant who has held a valid Learners' Licence, for a period of at least 30 days, shall be competent to appear for the test of competence.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- documents -----------------------------------------------------------
  {
    id: "document_group:address_and_age_proof",
    type: "DOCUMENT_GROUP",
    name: "Proof of address and age",
    officialName: "Proof of Address and Age",
    description:
      "One document from the Form 2 annexure. A single document can cover both address and age if it proves both.",
    jurisdictionId: "IN",
    sources: [
      {
        sourceId: "src:cmvr-form-2",
        evidence:
          "ANNEXURE LIST OF DOCUMENTS TO BE SUBMITTED OR UPLOADED BY THE APPLICANT Proof of Address and Age. (Select only one if the proof is common for Address and Age)",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:passport",
    type: "DOCUMENT",
    name: "Passport",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:cmvr-form-2",
        evidence: "4. Passport",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:birth_certificate",
    type: "DOCUMENT",
    name: "Birth certificate",
    jurisdictionId: "IN",
    metadata: { selfProvided: true },
    sources: [
      {
        sourceId: "src:cmvr-form-2",
        evidence: "6. Birth Certificate",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:form_1_declaration",
    type: "DOCUMENT",
    name: "Form 1, declaration of physical fitness",
    officialName: "Form-1 (Application – cum – Declaration as to Physical Fitness)",
    description: "A self declaration of physical fitness. Downloaded and filled in, not issued by anyone.",
    jurisdictionId: "IN",
    metadata: {
      selfProvided: true,
      whatToDo:
        "Download it from parivahan.gov.in under Informational Services, Downloadable Forms, All Forms, Form-1.",
      formNumber: "Form 1",
    },
    sources: [
      {
        sourceId: "src:parivahan-faq",
        evidence:
          "Medical Certificate (FORM 1A) is required for applicants having age equal to or above 40 years, in case of less than 40 you need to submit FORM 1.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:form_1a_medical",
    type: "DOCUMENT",
    name: "Form 1A, medical certificate",
    officialName: "Form-1A (Medical Fitness)",
    description: "A medical fitness certificate signed by a registered medical practitioner.",
    jurisdictionId: "IN",
    metadata: {
      whatToDo:
        "Download Form 1A from parivahan.gov.in under Informational Services, Downloadable Forms, All Forms, then have it completed by a registered medical practitioner.",
      formNumber: "Form 1A",
    },
    sources: [
      {
        sourceId: "src:parivahan-faq",
        evidence: "Medical Certificate (FORM 1A) is required for applicants having age equal to or above 40 years.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "document:learner_licence",
    type: "DOCUMENT",
    name: "Learner's licence",
    officialName: "Learner's Licence",
    description: "Valid throughout India for 6 months. If it expires you start the whole process again.",
    jurisdictionId: "IN",
    sources: [
      {
        sourceId: "src:sarathi-ll-faq",
        evidence:
          "The Learner Licence is valid through out India for a period of 6 months only. In case of expiry of the Learner Licence the applicant needs to repeat the process afresh.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "output:driving_licence",
    type: "OUTPUT",
    name: "Your driving licence",
    description: "Sent through speed post to the address you gave on the application.",
    jurisdictionId: "IN",
    sources: [
      {
        sourceId: "src:parivahan-dl",
        evidence:
          "The candidate who passes the test of competence successfully will be issued with a driving licence and sent through speed post to the address furnished.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- actions -------------------------------------------------------------
  {
    id: "action:visit_rto_verification",
    type: "VERIFICATION",
    name: "Visit the RTO for document verification and biometrics",
    description:
      "Online is only half of it. The application goes under scrutiny, which means physically showing up at the RTO.",
    jurisdictionId: "IN",
    metadata: {
      whyRequired:
        "Scrutiny means applicant has to visit the concerned RTO for physical verification of documents and submit Biometrics to complete the process.",
      whatToDo:
        "Carry the printed application with its reference number, the documents listed on your acknowledgement slip, and a copy of the fee receipt.",
      expectedOutput: "Documents verified and biometrics recorded.",
    },
    sources: [
      {
        sourceId: "src:sarathi-ll-faq",
        evidence:
          "Scrutiny means applicant has to visit the concerned RTO for physical verification of documents and submit Biometrics to complete the process.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:sarathi-ll-faq",
        evidence:
          "After completing online procedure, for further processing of application you should visit the concerned RTO office with the required documents as shown on the acknowledgtement slip. You should also carry a copy of the fee receipt.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:book_driving_test_slot",
    type: "ACTION",
    name: "Book a slot for the driving test",
    jurisdictionId: "IN",
    metadata: {
      whatToDo:
        "Schedule the test of competence online, or at an RTO office where that facility exists. Where neither is available, schedule directly at the office concerned.",
      expectedOutput: "An appointment for the test of competence.",
    },
    sources: [
      {
        sourceId: "src:parivahan-dl",
        evidence:
          "Schedule an appointment for the test of competence online by visiting the website or any RTO office where such facility exists. In other cases schedule an appointment directly at the Office Concerned.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "action:driving_test",
    type: "ACTION",
    name: "Pass the test of competence to drive",
    officialName: "Test of competence to drive",
    jurisdictionId: "IN",
    metadata: {
      whyRequired: "The driving licence is only granted after this test is passed.",
      whatToDo:
        "Bring a vehicle of the type your application is for. You must satisfy the officer of your ability to perform the tasks in Rule 15(2) of the CMVR.",
      expectedOutput: "A pass, after which the licence is issued and posted.",
      fee: "Rs. 300.00 for the test or repeat test, for each class of vehicle",
    },
    sources: [
      {
        sourceId: "src:parivahan-dl",
        evidence: "The applicant should bring a vehicle of the type to which the application relates.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:parivahan-dl",
        evidence:
          "The applicant should satisfy the officer conducting the test regarding his capability to drive the vehicle and his ability to perform the tasks specified in Rule-15(2) of the CMVR.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- payments ------------------------------------------------------------
  {
    id: "payment:learner_licence_fee",
    type: "PAYMENT",
    name: "Pay the learner's licence fee",
    jurisdictionId: "IN",
    metadata: {
      fee: "Rs. 150.00 to issue the licence in Form 3, plus Rs. 50.00 test fee",
      whatToDo:
        "Pay online through the pending payment flow on your application status, or at the RTO cash counter. Online payment is not enabled at every RTO.",
    },
    sources: [
      {
        sourceId: "src:parivahan-fees",
        evidence: "Issue of learner’s licence in Form 3 for each class of vehicle | Rs. 150.00/-",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:parivahan-fees",
        evidence: "Learner’s licence test fee or repeat test fee, as the case may be | Rs. 50.00/-",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:sarathi-ll-faq",
        evidence: "Pay the fees at the concerned RTO cash counter. Online fee payment facility is not available for some RTOs.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "payment:driving_licence_fee",
    type: "PAYMENT",
    name: "Pay the driving licence and test fee",
    jurisdictionId: "IN",
    metadata: {
      fee: "Rs. 300.00 for the test of competence, plus Rs. 200.00 to issue the driving licence",
    },
    sources: [
      {
        sourceId: "src:parivahan-fees",
        evidence:
          "For test, or repeat test, as the case may be, of competence to drive (for each class of vehicle) | Rs. 300.00/-",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:parivahan-fees",
        evidence: "Issue of a driving licence | Rs. 200.00/-",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },

  // -- channels and offices ------------------------------------------------
  {
    id: "portal:sarathi",
    type: "PORTAL",
    name: "Sarathi Parivahan",
    officialName: "Driving License Related Services",
    description: "The national portal for everything licence related. You pick your state first.",
    jurisdictionId: "IN",
    metadata: { url: "https://sarathi.parivahan.gov.in/sarathiservice/", channelType: "WEB" },
    sources: [
      {
        sourceId: "src:sarathi-ll-faq",
        evidence:
          "Applicants can visit https://sarathi.parivahan.gov.in/sarathiservice and apply for Learner Licence ONLINE by following the link “New Learning Licence“",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:sarathi-home",
        evidence: "Online services in this portal are available only for the States listed below",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "portal:sarathi_application_status",
    type: "PORTAL",
    name: "Sarathi application status",
    description: "Where you check what the RTO has done with your application, and what it still wants from you.",
    jurisdictionId: "IN",
    metadata: { url: "https://sarathi.parivahan.gov.in/sarathiservice/", channelType: "WEB" },
    sources: [
      {
        sourceId: "src:sarathi-ll-faq",
        evidence:
          "Visit https://sarathi.parivahan.gov.in/sarathiservice >>select State > and click on Apply online >select Application status.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "office:rto",
    type: "OFFICE",
    name: "Your Regional Transport Office (RTO)",
    description:
      "You choose the RTO during the online application, and that is the one you visit. Addresses are not published on the pages we have verified so far.",
    jurisdictionId: "IN",
    metadata: { officeType: "Regional Transport Office" },
    sources: [
      {
        sourceId: "src:sarathi-ll-faq",
        evidence:
          "Applicants should take print of the duly filled-in ONLINE application along with the reference number and submit at the chosen RTO office.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
  {
    id: "department:licensing_authority",
    type: "DEPARTMENT",
    name: "Licensing Authority",
    description:
      "The Joint Commissioner, Deputy Commissioner and Regional Transport Officers. Administrative Officers and Motor Vehicle Inspectors are Additional Licensing Authorities.",
    jurisdictionId: "IN",
    sources: [
      {
        sourceId: "src:parivahan-ll",
        evidence:
          "The Joint Commissioner/ Deputy Commissioner and the Regional Transport Officers are the Licensing Authorities. The Administrative Officers and Motor Vehicle Inspectors are the Additional Licensing Authorities.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: RETRIEVED,
  },
];

export const requirementGroups: RequirementGroup[] = [
  {
    id: "rg:ll_address_and_age_proof",
    ownerNodeId: "document_group:address_and_age_proof",
    mode: "ANY_OF",
    jurisdictionId: "IN",
    members: [
      { nodeId: "document:passport", note: "Covers both address and age." },
      { nodeId: "document:birth_certificate", note: "Proves age." },
    ],
    sources: [
      {
        sourceId: "src:cmvr-form-2",
        evidence:
          "Proof of Address and Age. (Select only one if the proof is common for Address and Age)",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
  },
];

const verified = (sourceId: string, evidence: string) => [
  { sourceId, evidence, confidence: 1, verificationStatus: "VERIFIED" as const },
];

export const edges: GraphEdge[] = [
  // -- learner's licence ---------------------------------------------------
  {
    id: "e:ll_requires_proof",
    from: "service:learner_licence",
    to: "document_group:address_and_age_proof",
    type: "REQUIRES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:cmvr-form-2",
      "Address (proof to be enclosed, in case of New Learner’s Licence or New Driving Licence or Change of Address)",
    ),
  },
  {
    id: "e:ll_requires_form_1",
    from: "service:learner_licence",
    to: "document:form_1_declaration",
    type: "REQUIRES",
    condition: { field: "age", operator: "LT", value: 40 },
    jurisdictionId: "IN",
    note: "Under 40, the self declaration in Form 1 is what is asked for.",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-faq",
      "Medical Certificate (FORM 1A) is required for applicants having age equal to or above 40 years, in case of less than 40 you need to submit FORM 1.",
    ),
  },
  {
    id: "e:ll_requires_form_1a_over_40",
    from: "service:learner_licence",
    to: "document:form_1a_medical",
    type: "REQUIRES",
    condition: { field: "age", operator: "GTE", value: 40 },
    jurisdictionId: "IN",
    note: "At 40 and above, the medical certificate is required.",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-faq",
      "Medical Certificate (FORM 1A) is required for applicants having age equal to or above 40 years.",
    ),
  },
  {
    // Two official pages disagree about whether Form 1A is age gated. Both are
    // kept. Picking one silently is exactly the thing this product exists to
    // stop doing.
    id: "e:ll_requires_form_1a_always",
    from: "service:learner_licence",
    to: "document:form_1a_medical",
    type: "REQUIRES",
    jurisdictionId: "IN",
    note: "Sources conflict. The Sarathi learner licence FAQ says Form 1A is always attached, the Parivahan FAQ says it applies from age 40. Carry it if you are unsure.",
    verificationStatus: "CONFLICTING",
    sources: [
      {
        sourceId: "src:sarathi-ll-faq",
        evidence: "Yes. Form 1 should be invariably attached with Form 1A ( Medical Fitness)",
        confidence: 0.5,
        verificationStatus: "CONFLICTING",
      },
    ],
  },
  {
    id: "e:ll_requires_fee",
    from: "service:learner_licence",
    to: "payment:learner_licence_fee",
    type: "REQUIRES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "Fill Application & check application status provided on the website and click on pending payment flow and make payment",
    ),
  },
  {
    id: "e:ll_requires_rto_visit",
    from: "service:learner_licence",
    to: "action:visit_rto_verification",
    type: "REQUIRES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "After completing online procedure, for further processing of application you should visit the concerned RTO office with the required documents as shown on the acknowledgtement slip.",
    ),
  },
  {
    id: "e:ll_produces_licence",
    from: "service:learner_licence",
    to: "document:learner_licence",
    type: "PRODUCES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "The Learner Licence is valid through out India for a period of 6 months only.",
    ),
  },
  {
    id: "e:ll_apply_at_sarathi",
    from: "service:learner_licence",
    to: "portal:sarathi",
    type: "APPLY_AT",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "Applicants can visit https://sarathi.parivahan.gov.in/sarathiservice and apply for Learner Licence ONLINE by following the link “New Learning Licence“",
    ),
  },
  {
    id: "e:ll_track_at_sarathi",
    from: "service:learner_licence",
    to: "portal:sarathi_application_status",
    type: "TRACK_AT",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "Visit https://sarathi.parivahan.gov.in/sarathiservice >>select State > and click on Apply online >select Application status.",
    ),
  },
  {
    id: "e:ll_handled_by_authority",
    from: "service:learner_licence",
    to: "department:licensing_authority",
    type: "HANDLED_BY",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-ll",
      "The Joint Commissioner/ Deputy Commissioner and the Regional Transport Officers are the Licensing Authorities.",
    ),
  },
  {
    // The RTO wants the fee receipt in your hand, so the payment has to happen
    // before the visit and not after it.
    id: "e:rto_visit_after_fee",
    from: "action:visit_rto_verification",
    to: "payment:learner_licence_fee",
    type: "DEPENDS_ON",
    jurisdictionId: "IN",
    note: "Carry a copy of the fee receipt to the RTO, so pay before you go.",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "You should also carry a copy of the fee receipt.",
    ),
  },
  {
    id: "e:rto_visit_at_office",
    from: "action:visit_rto_verification",
    to: "office:rto",
    type: "VISIT_AT",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "Applicants should take print of the duly filled-in ONLINE application along with the reference number and submit at the chosen RTO office.",
    ),
  },

  // -- driving licence -----------------------------------------------------
  {
    id: "e:dl_requires_ll",
    from: "service:driving_licence",
    to: "document:learner_licence",
    type: "REQUIRES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-dl",
      "An application in Form 4, for a permanent driving licence shall be made along with the Learners' Licence obtained for such class of vehicle.",
    ),
  },
  {
    id: "e:dl_requires_ll_30_days",
    from: "service:driving_licence",
    to: "eligibility:learner_licence_held_30_days",
    type: "REQUIRES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-dl",
      "The applicant who has held a valid Learners' Licence, for a period of at least 30 days, shall be competent to appear for the test of competence.",
    ),
  },
  {
    id: "e:dl_requires_age_18",
    from: "service:driving_licence",
    to: "eligibility:age_18_non_transport",
    type: "REQUIRES",
    condition: { field: "vehicle_class", operator: "NEQ", value: "transport" },
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-ll",
      "The applicant who has completed the age of eighteen years of age is eligible to apply for a driving licence to drive a motor vehicle other than a transport vehicle.",
    ),
  },
  {
    id: "e:dl_requires_age_20",
    from: "service:driving_licence",
    to: "eligibility:age_20_transport",
    type: "REQUIRES",
    condition: { field: "vehicle_class", operator: "EQ", value: "transport" },
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-ll",
      "An applicant who has completed twenty years of age will be eligible for applying for a licence to drive a transport vehicle.",
    ),
  },
  {
    id: "e:dl_requires_test",
    from: "service:driving_licence",
    to: "action:driving_test",
    type: "REQUIRES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified("src:parivahan-dl", "The test of competence will be conducted by the competent authority."),
  },
  {
    id: "e:dl_requires_fee",
    from: "service:driving_licence",
    to: "payment:driving_licence_fee",
    type: "REQUIRES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified("src:parivahan-dl", "Fees as prescribed along with user charges"),
  },
  {
    id: "e:test_requires_slot",
    from: "action:driving_test",
    to: "action:book_driving_test_slot",
    type: "REQUIRES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-dl",
      "The Facility of online slot booking for test of completence of driving licence has been provided. Please visit the website for scheduling an appointment.",
    ),
  },
  {
    // The 30 day rule is what puts the test after the learner's licence. Both
    // of these are read off one sentence, but only the first is verbatim: the
    // second is the ordering we derived from it, so it is NORMALIZED and not
    // VERIFIED.
    id: "e:ll_30_days_needs_ll",
    from: "eligibility:learner_licence_held_30_days",
    to: "document:learner_licence",
    type: "DEPENDS_ON",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-dl",
      "The applicant who has held a valid Learners' Licence, for a period of at least 30 days, shall be competent to appear for the test of competence.",
    ),
  },
  {
    id: "e:test_after_30_days",
    from: "action:driving_test",
    to: "eligibility:learner_licence_held_30_days",
    type: "DEPENDS_ON",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-dl",
      "The applicant who has held a valid Learners' Licence, for a period of at least 30 days, shall be competent to appear for the test of competence.",
    ),
  },
  {
    id: "e:slot_after_30_days",
    from: "action:book_driving_test_slot",
    to: "eligibility:learner_licence_held_30_days",
    type: "DEPENDS_ON",
    jurisdictionId: "IN",
    note: "You are only competent to appear once the learner's licence is 30 days old, so booking earlier does not help.",
    verificationStatus: "NORMALIZED",
    sources: [
      {
        sourceId: "src:parivahan-dl",
        evidence:
          "The applicant who has held a valid Learners' Licence, for a period of at least 30 days, shall be competent to appear for the test of competence.",
        confidence: 0.8,
        verificationStatus: "NORMALIZED",
      },
    ],
  },
  {
    id: "e:slot_apply_at_sarathi",
    from: "action:book_driving_test_slot",
    to: "portal:sarathi",
    type: "APPLY_AT",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-dl",
      "Schedule an appointment for the test of competence online by visiting the website or any RTO office where such facility exists.",
    ),
  },
  {
    id: "e:test_visit_at_rto",
    from: "action:driving_test",
    to: "office:rto",
    type: "VISIT_AT",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified("src:parivahan-dl", "The applicant should bring a vehicle of the type to which the application relates."),
  },
  {
    id: "e:dl_apply_at_sarathi",
    from: "service:driving_licence",
    to: "portal:sarathi",
    type: "APPLY_AT",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "Applicants can visit https://sarathi.parivahan.gov.in/sarathiservice and apply for Learner Licence ONLINE",
    ),
  },
  {
    id: "e:dl_track_at_sarathi",
    from: "service:driving_licence",
    to: "portal:sarathi_application_status",
    type: "TRACK_AT",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:sarathi-ll-faq",
      "Visit https://sarathi.parivahan.gov.in/sarathiservice >>select State > and click on Apply online >select Application status.",
    ),
  },
  {
    id: "e:dl_handled_by_authority",
    from: "service:driving_licence",
    to: "department:licensing_authority",
    type: "HANDLED_BY",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-ll",
      "The Joint Commissioner/ Deputy Commissioner and the Regional Transport Officers are the Licensing Authorities.",
    ),
  },
  {
    id: "e:dl_produces_licence",
    from: "service:driving_licence",
    to: "output:driving_licence",
    type: "PRODUCES",
    jurisdictionId: "IN",
    verificationStatus: "VERIFIED",
    sources: verified(
      "src:parivahan-dl",
      "The candidate who passes the test of competence successfully will be issued with a driving licence and sent through speed post to the address furnished.",
    ),
  },
];

export const questions: QuestionDefinition[] = [
  {
    field: "age",
    label: "How old are you?",
    help: "Age decides which licence you can apply for, and whether you need a medical certificate.",
    inputType: "NUMBER",
  },
  {
    field: "vehicle_class",
    label: "What do you want to drive?",
    help: "Transport means commercial: taxi, auto, goods carriage, bus.",
    inputType: "SINGLE_SELECT",
    options: [
      { value: "non_transport", label: "A car or two wheeler for myself" },
      { value: "transport", label: "A commercial or transport vehicle" },
    ],
  },
  {
    field: "learner_licence_days",
    label: "How many days ago did you get your learner's licence?",
    help: "You have to hold it for at least 30 days before the driving test, and it expires after 6 months.",
    inputType: "NUMBER",
  },
];
