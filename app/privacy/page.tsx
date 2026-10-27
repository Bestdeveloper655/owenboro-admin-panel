import type { Metadata } from "next";

/* Public Privacy Policy (no login), for the App Store, Play Store and
   anyone the app links to. The same text as the app's Privacy page
   (theowensboroapp/lib/presentation/pages/privacy_page); change both
   together. */

export const metadata: Metadata = {
  title: "Privacy Policy · The Owensboro App",
  description: "How The Owensboro App collects, uses and protects your information.",
};

type Block = { kind: "section" | "sub" | "p" | "li"; text: string };

const blocks: Block[] = [
  {
    kind: "p",
    text: "The Owensboro App LLC (“Company,” “we,” “us,” or “our”) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you download, install, and use The Owensboro App (the “App”).",
  },
  { kind: "section", text: "1. INFORMATION WE COLLECT" },
  { kind: "sub", text: "1.1 Personal Data Provided Directly by You" },
  {
    kind: "p",
    text: "To access social features, we collect your email address, phone number, chosen name, username, age, date of birth, and gender, alongside public bio text and group memberships.",
  },
  { kind: "sub", text: "1.2 Camera, Media, and Government ID Processing" },
  {
    kind: "li",
    text: "Profile Imagery: You grant the App permission to access your device’s local camera roll/gallery to upload public profile photos.",
  },
  {
    kind: "li",
    text: "Identity Verification (Government ID): To obtain a Blue Verification Checkmark, users may voluntarily submit a photograph of a valid government-issued photo ID (displaying a clear photo, name, date of birth, and gender).",
  },
  {
    kind: "li",
    text: "STRICT ZERO-STORAGE GUARANTEE FOR ID IMAGES: Images of submitted government-issued IDs are used solely for immediate manual review by a human administrator. UPON COMPLETION OF THE IDENTITY VERIFICATION CHECK, THE SUBMITTED ID IMAGE IS PERMANENTLY AND IMMEDIATELY DELETED FROM OUR ACTIVE SERVERS AND TEMPORARY STORAGE BUFFERS. WE DO NOT STORE, SHARE, RENT, OR SELL YOUR GOVERNMENT ID IMAGES TO ANY THIRD PARTY UNDER ANY CIRCUMSTANCES.",
  },
  {
    kind: "li",
    text: "Unstripped Photo Metadata Notice: The App does not strip EXIF/location metadata from standard profile photos uploaded to public profiles.",
  },
  { kind: "sub", text: "1.3 Technical Device and Analytics Data" },
  {
    kind: "p",
    text: "We collect basic device metrics (IP address, device model, OS version, crash logs) and analyze usage patterns via Google Analytics for Firebase. The App does not track real-time GPS locations.",
  },
  { kind: "section", text: "2. HOW WE USE YOUR INFORMATION" },
  {
    kind: "p",
    text: "We use your information to operate accounts, facilitate messaging, conduct manual verification, prevent fraud, and optimize systems.",
  },
  { kind: "sub", text: "Newsletters and Marketing Communications" },
  {
    kind: "p",
    text: "We store your email address and phone number to send official company newsletters, platform update announcements, community event notices, and promotional offerings. You may opt out of promotional emails at any time using the \"Unsubscribe\" link, or reply \"STOP\" to SMS text updates.",
  },
  { kind: "section", text: "3. SHARING AND DISCLOSURE OF DATA" },
  {
    kind: "p",
    text: "STRICT NO-SALE POLICY: We do not, and will never, sell, rent, or trade your personal data, contact information, profile pictures, or verification data to local businesses, advertisers, or third-party data brokers.",
  },
  { kind: "p", text: "Data is hosted on secure cloud infrastructure provided by Google Cloud / Firebase." },
  { kind: "section", text: "4. DATA RETENTION POLICY & ACCOUNT DELETION" },
  { kind: "sub", text: "4.1 Account Deletion Controls" },
  { kind: "p", text: "Users may initiate account deletion directly within the App settings interface at any time." },
  { kind: "sub", text: "4.2 Retention Overrides for Safety" },
  {
    kind: "li",
    text: "Government ID Photos: As stated in Section 1.2, government ID photos are deleted immediately after human verification and are NOT retained post-deletion.",
  },
  {
    kind: "li",
    text: "Live Verification Selfies: Live photos submitted for account moderation are retained securely on Firebase to prevent ban-evasion and account theft.",
  },
  {
    kind: "li",
    text: "Chat Logs: For reasons of public safety, legal compliance, and subpoena adherence, all chat logs and message histories are permanently retained in backend archives even after an account is deleted.",
  },
  { kind: "section", text: "5. INFORMATION SECURITY" },
  {
    kind: "p",
    text: "We implement administrative, technical, and physical security measures through Google Firebase to protect your data.",
  },
  { kind: "section", text: "6. CHILDREN'S PRIVACY FORUM" },
  { kind: "p", text: "Social features and account creation are strictly limited to individuals aged 18 and older." },
  { kind: "section", text: "7. CONTACT AND DATA ACCESS REQUESTS" },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-white text-neutral-800">
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          The Owensboro App — Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-neutral-500">Last Updated: July 22, 2026</p>

        <div className="mt-8 space-y-4 text-[15px] leading-7">
          {blocks.map((b, i) => {
            switch (b.kind) {
              case "section":
                return (
                  <h2 key={i} className="pt-4 text-lg font-bold text-neutral-900">
                    {b.text}
                  </h2>
                );
              case "sub":
                return (
                  <h3 key={i} className="font-semibold text-neutral-900">
                    {b.text}
                  </h3>
                );
              case "li":
                return (
                  <p key={i} className="relative pl-5 before:absolute before:left-1 before:content-['•']">
                    {b.text}
                  </p>
                );
              default:
                return <p key={i}>{b.text}</p>;
            }
          })}
          <address className="not-italic">
            The Owensboro App LLC
            <br />
            Attn: Privacy &amp; Data Operations
            <br />
            Owensboro, Daviess County, Kentucky
            <br />
            Legal Contact Email:{" "}
            <a className="text-sky-600 underline" href="mailto:theowensboroapp@gmail.com">
              theowensboroapp@gmail.com
            </a>
          </address>
        </div>
      </article>
    </main>
  );
}
