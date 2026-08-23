import type { GraphEdge, GraphNode, Source } from "../types";

/**
 * Escalation, shared by every journey.
 *
 * These two channels are not tied to one department. CPGRAMS says so in as many
 * words ("connected to all the Ministries/Departments of Government of India
 * and States") and SWAGAT is the Gujarat wide programme. So instead of hanging
 * them off individual services by hand, the loader attaches them to every
 * SERVICE node it has. See `attachEscalation` at the bottom.
 *
 * Deliberately absent: any department specific grievance officer, any promised
 * resolution time, any SWAGAT hearing date. The SWAGAT page publishes the next
 * hearing date and it moves every month, so hardcoding it would be shipping a
 * fact with a shelf life of four weeks. The monthly application window is
 * stable and stated, so that is what we carry.
 */

export const sources: Source[] = [
  {
    id: "src:cpgrams",
    url: "https://pgportal.gov.in/",
    title: "Centralised Public Grievance Redress and Monitoring System",
    domain: "pgportal.gov.in",
    sourceType: "GRIEVANCE_PAGE",
    retrievedAt: "2026-08-23",
  },
  {
    id: "src:swagat",
    url: "https://swagat.gujarat.gov.in/",
    title: "SWAGAT online grievance redressal programme, Government of Gujarat",
    domain: "swagat.gujarat.gov.in",
    sourceType: "GRIEVANCE_PAGE",
    jurisdictionId: "IN-GJ",
    retrievedAt: "2026-08-23",
  },
];

export const nodes: GraphNode[] = [
  {
    id: "grievance:cpgrams",
    type: "GRIEVANCE_CHANNEL",
    name: "File a grievance on CPGRAMS",
    officialName: "Centralised Public Grievance Redress and Monitoring System",
    aliases: ["cpgrams", "pgportal", "public grievance portal"],
    description:
      "The national grievance portal. Use it when a government office has not acted and you need a tracked complaint with a registration number. Free to file.",
    metadata: {
      url: "https://pgportal.gov.in/",
      channelType: "GRIEVANCE_PORTAL",
      whatToDo:
        "Lodge the grievance on the portal, not by email. Keep the registration ID, it is the only way to track it. If the resolution is rated Poor you can file an appeal.",
      whyRequired:
        "Applying again does not restart a stalled file. A tracked grievance does, and it creates a record you can escalate on.",
      fee: "No fee",
    },
    sources: [
      {
        sourceId: "src:cpgrams",
        evidence:
          "an online platform available to the citizens 24x7 to lodge their grievances to the public authorities",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:cpgrams",
        evidence: "It is a single portal connected to all the Ministries/Departments of Government of India and States.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:cpgrams",
        evidence: "Any Grievance sent by email will not be attended to / entertained. Please lodge your grievance on this portal.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:cpgrams",
        evidence: "Government is not charging fee from the public for filing grievances.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:cpgrams",
        evidence: "provides appeal facility to the citizens if they are not satisfied with the resolution by the Grievance Officer",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:cpgrams",
        evidence: "If the rating is 'Poor' the option to file an appeal is enabled.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: "2026-08-23",
  },
  {
    id: "grievance:swagat",
    type: "GRIEVANCE_CHANNEL",
    name: "Take it to SWAGAT, the Gujarat grievance programme",
    officialName: "State Wide Attention on Grievances by Application of Technology",
    aliases: ["swagat", "સ્વાગત"],
    description:
      "Gujarat runs a tiered grievance hearing: gram panchayat, then taluka, then district collector, then the Chief Minister. You can also file online and track it with your mobile number.",
    jurisdictionId: "IN-GJ",
    metadata: {
      url: "https://swagat.gujarat.gov.in/",
      channelType: "GRIEVANCE_PORTAL",
      whatToDo:
        "File online, or hand the application in at your gram panchayat between the 1st and the 10th of the month. Track it by logging in with the mobile number you filed with.",
      phoneNumbers: ["+91 79 23250072", "70309 30344"],
      address:
        "Jansampark Ekam, Ground Floor, Swarnim Sankul 2, New Sachivalaya, Sector 10, Gandhinagar, Gujarat",
      timeline: "Applications are accepted at gram panchayat offices from the 1st to the 10th of every month.",
    },
    sources: [
      {
        sourceId: "src:swagat",
        evidence: "તલાટી કમ મંત્રીશ્રી દ્વારા દર મહિનાની ૧ થી ૧૦ તારીખ દરમિયાન ગ્રામ પંચાયત ખાતે અરજીઓ સ્વીકારવામાં આવે છે.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:swagat",
        evidence: "અરજી સંદર્ભે થયેલ કાર્યવાહીની સ્થિતિ જાણવા મોબાઈલ નંબરથી લોગીન કરવું.",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
      {
        sourceId: "src:swagat",
        evidence: "જનસંપર્ક એકમ, ગ્રાઉન્ડ ફ્લોર, સ્વર્ણિમ સંકુલ – ૨, નવું સચિવાલય, સેક્ટર ૧૦, ગાંધીનગર, ગુજરાત",
        confidence: 1,
        verificationStatus: "VERIFIED",
      },
    ],
    lastVerifiedAt: "2026-08-23",
  },
];

/** Nothing fixed yet. Every escalation edge is generated per service below. */
export const edges: GraphEdge[] = [];

/**
 * Every service gets both escalation routes. This is a generated edge rather
 * than a hand written one because the claim being made is general, and writing
 * it out per service would be forty copies of the same two sentences waiting to
 * drift apart.
 */
export function attachEscalation(serviceNodes: GraphNode[]): GraphEdge[] {
  return serviceNodes.flatMap((service): GraphEdge[] => [
    {
      id: `e:${service.id}_escalate_cpgrams`,
      from: service.id,
      to: "grievance:cpgrams",
      type: "ESCALATE_TO",
      verificationStatus: "VERIFIED",
      note: "Use this when the office has your file and nothing is moving.",
      sources: [
        {
          sourceId: "src:cpgrams",
          evidence: "It is a single portal connected to all the Ministries/Departments of Government of India and States.",
          confidence: 1,
          verificationStatus: "VERIFIED",
        },
      ],
    },
    {
      id: `e:${service.id}_escalate_swagat`,
      from: service.id,
      to: "grievance:swagat",
      type: "ESCALATE_TO",
      jurisdictionId: "IN-GJ",
      verificationStatus: "VERIFIED",
      note: "The Gujarat route. Often faster than the national one for a state office.",
      sources: [
        {
          sourceId: "src:swagat",
          evidence: "સીધી ઓનલાઈન ફરિયાદ નોંધાવો.",
          confidence: 1,
          verificationStatus: "VERIFIED",
        },
      ],
    },
  ]);
}
