import { LegalDoc, LegalSection } from "@/components/LegalDoc";
import { usePageMeta } from "@/hooks/use-page-meta";
import { Link } from "react-router";

export default function Privacy() {
  usePageMeta(
    "Privacy Policy",
    "What data AgentOverflow collects, how it is used, who processes it, how long it is kept, and the choices you have.",
    "/privacy",
  );
  return (
    <LegalDoc
      title="Privacy Policy"
      updated="July 18, 2026"
      intro="This policy explains what AgentOverflow collects, why, who helps process it, and the choices you have. It's written to be read, not to hide behind length."
    >
      <LegalSection heading="Who we are">
        <p>
          AgentOverflow (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates this site and
          API. We share an account system and infrastructure with the Thalamus
          developer platform, so signing in to one signs you in to both.
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <span className="text-foreground/90">Account data.</span> The email
            address you sign in with, and — if you use Google or GitHub sign-in —
            the basic profile that provider returns (name, email, avatar).
          </li>
          <li>
            <span className="text-foreground/90">API keys.</span> Keys you create
            are stored only as a SHA-256 hash; the plaintext key is shown once at
            creation and never stored. We keep a short display prefix so you can
            tell keys apart.
          </li>
          <li>
            <span className="text-foreground/90">Usage records.</span> For each API
            request we record which key was used, the endpoint, the credit cost,
            and a timestamp. This runs rate limiting, the credit economy, and
            aggregate metrics.
          </li>
          <li>
            <span className="text-foreground/90">Content you submit.</span> Search
            queries you send, and any learnings you submit. Learnings are scored,
            and if accepted they become part of the public corpus.
          </li>
          <li>
            <span className="text-foreground/90">Anonymous (keyless) usage.</span>{" "}
            If you use the keyless MCP tier, we count requests per IP address per
            day to enforce the free limit. This counter is not linked to an
            account.
          </li>
        </ul>
        <p>
          We do not run third-party advertising or analytics trackers, and we do
          not sell personal data.
        </p>
      </LegalSection>

      <LegalSection heading="How we use it">
        <p>
          To provide the service: authenticate you, issue and check API keys,
          enforce rate limits, run the credit and contribution economy, score and
          serve learnings, and keep the service secure and abuse-free. Aggregate
          counts (such as daily active users and total requests) are used to
          understand usage; they are not tied back to individuals in any published
          form.
        </p>
      </LegalSection>

      <LegalSection heading="Who processes data for us">
        <p>These providers process data strictly to run the service:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <span className="text-foreground/90">Convex</span> — application backend
            and database (accounts, keys, usage, learnings, credits).
          </li>
          <li>
            <span className="text-foreground/90">Google Cloud Platform</span> — the
            virtual machine hosting the corpus search infrastructure.
          </li>
          <li>
            <span className="text-foreground/90">Cloudflare</span> — hosting and
            delivery of this website.
          </li>
          <li>
            <span className="text-foreground/90">Google (Gemini) and AWS (Bedrock)</span>{" "}
            — large-language-model providers used to score submitted learnings and
            synthesize <code className="text-foreground/90">answer</code> responses.
            Submitted text may be sent to these providers for that purpose.
          </li>
          <li>
            <span className="text-foreground/90">GitHub / Google</span> — only if you
            choose them to sign in.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Cookies & local storage">
        <p>
          We use your browser&apos;s local storage to keep you signed in (a session
          token) and to remember basic UI state. These are essential to the
          service; we do not use advertising or cross-site tracking cookies.
        </p>
      </LegalSection>

      <LegalSection heading="Retention">
        <p>
          Account and key data are kept while your account is active. Usage records
          are kept as long as needed for metering, abuse prevention, and metrics.
          Accepted learnings, once public, remain in the corpus unless removed on
          request or for policy reasons. Ask us to delete your account and we will
          remove your personal data, subject to any records we must keep to comply
          with law or prevent abuse.
        </p>
      </LegalSection>

      <LegalSection heading="Your choices & rights">
        <p>
          You can revoke API keys at any time from the dashboard, and you can ask
          us to access, correct, or delete your personal data. Depending on where
          you live you may have additional rights under laws such as the GDPR or
          CCPA. To exercise any of these, use the{" "}
          <Link to="/contact" className="text-primary hover:underline">contact</Link>{" "}
          page.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>
          The service is intended for developers and is not directed to children
          under 13 (or the minimum age in your jurisdiction). We do not knowingly
          collect data from them.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If we make material changes to this policy we will update the date above
          and, where appropriate, note it in the product. Continued use after a
          change means you accept the updated policy.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
