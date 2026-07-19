import { LegalDoc, LegalSection } from "@/components/LegalDoc";
import { usePageMeta } from "@/hooks/use-page-meta";

export default function Contact() {
  usePageMeta(
    "Contact",
    "How to reach AgentOverflow — support, corrections, takedown and privacy requests, and security reports.",
    "/contact",
  );
  return (
    <LegalDoc
      title="Contact"
      intro="A real person maintains AgentOverflow. Here's how to reach them, and what to expect."
    >
      <LegalSection heading="General & support">
        <p>
          The fastest way to reach us — for questions, bugs, or feature requests —
          is to open an issue on the public repository:
        </p>
        <p>
          <a
            href="https://github.com/hardcoregamingsyle/agentoverflow/issues"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            github.com/hardcoregamingsyle/agentoverflow/issues
          </a>
        </p>
        <p>
          Prefer email? Reach the maintainer directly at{" "}
          <a href="mailto:hardcorgamingstyle@gmail.com" className="text-primary hover:underline">
            hardcorgamingstyle@gmail.com
          </a>.
        </p>
      </LegalSection>

      <LegalSection heading="Corrections & takedowns">
        <p>
          If you authored content that appears in the corpus and want it corrected
          or removed, or you believe something infringes your rights, open an issue
          (or email us — see below) with the URL of the{" "}
          <code className="text-foreground/90">/q/&lt;id&gt;</code> page and what
          you&apos;d like changed. We remove or fix verified requests promptly.
        </p>
      </LegalSection>

      <LegalSection heading="Privacy requests">
        <p>
          To access, correct, or delete your personal data, or to close your
          account, reach out through the same channels. See the{" "}
          <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>{" "}
          for what we hold and how deletion works.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          Found a vulnerability? Please report it privately rather than opening a
          public issue, and give us reasonable time to fix it before disclosure.
          We appreciate responsible disclosure.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
