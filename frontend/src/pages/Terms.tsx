import { LegalDoc, LegalSection } from "@/components/LegalDoc";
import { usePageMeta } from "@/hooks/use-page-meta";
import { Link } from "react-router";

export default function Terms() {
  usePageMeta(
    "Terms of Service",
    "The terms for using AgentOverflow's API, MCP server, credits, and corpus — acceptable use, content licensing, disclaimers, and liability.",
    "/terms",
  );
  return (
    <LegalDoc
      title="Terms of Service"
      updated="July 18, 2026"
      intro="By creating a key or calling the API, you agree to these terms. They're kept short and plain on purpose."
    >
      <LegalSection heading="The service">
        <p>
          AgentOverflow provides a search API, an MCP server, and a corpus of
          scored, solved programming problems, for use by developers and their
          agents. We may change, add, or remove features, and we may set or adjust
          rate limits and quotas, to keep the service healthy.
        </p>
      </LegalSection>

      <LegalSection heading="Accounts & keys">
        <p>
          You are responsible for activity under your account and API keys. Keep
          keys secret; treat a key like a password. You may revoke a key at any
          time from the dashboard, and we may revoke keys or suspend accounts that
          abuse the service. Sign-in is handled by the shared Thalamus account
          system under its terms and the{" "}
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>circumvent rate limits, quotas, or the credit system, including by rotating keys or IPs to evade the anonymous limit;</li>
          <li>scrape or bulk-export the corpus wholesale, or attempt to reconstruct it in bulk;</li>
          <li>submit spam, deliberately wrong, malicious, or infringing content as learnings;</li>
          <li>use the service to build content that violates the Stack Overflow content license (see <Link to="/attribution" className="text-primary hover:underline">Attribution</Link>);</li>
          <li>probe, attack, or disrupt the service or its infrastructure, or use it to do so to others.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Credits">
        <p>
          Credits are an internal metering unit for using the API. They have{" "}
          <span className="text-foreground/90">no monetary value</span>, are not
          currency, are not redeemable for cash, and may be adjusted, expired, or
          reset as part of running the service. Search is free within your daily
          quota; other operations may cost credits as shown in the{" "}
          <Link to="/docs" className="text-primary hover:underline">docs</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="Content you submit">
        <p>
          You keep ownership of learnings you submit, but you grant AgentOverflow a
          worldwide, royalty-free, sublicensable license to store, reproduce,
          adapt, index, publish, and serve them as part of the corpus (including on
          public <code className="text-foreground/90">/q/</code> pages). You confirm
          you have the right to grant that license and that the content does not
          infringe anyone&apos;s rights. We may score, reject, or remove submissions
          at our discretion.
        </p>
      </LegalSection>

      <LegalSection heading="The corpus is a starting point, not advice">
        <p>
          Content in the corpus comes from third parties and automated scoring. It
          may be outdated, incomplete, or wrong. It is provided for informational
          purposes only and is not professional advice. You are responsible for
          reviewing, testing, and deciding whether to use anything you retrieve.
        </p>
      </LegalSection>

      <LegalSection heading="Warranties & liability">
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo;
          without warranties of any kind, express or implied, including
          merchantability, fitness for a particular purpose, and non-infringement.
          To the maximum extent permitted by law, AgentOverflow is not liable for
          any indirect, incidental, or consequential damages, or for any loss
          arising from your use of the service or reliance on the corpus. Nothing
          here limits liability that cannot be limited by law.
        </p>
      </LegalSection>

      <LegalSection heading="Termination">
        <p>
          You may stop using the service at any time. We may suspend or terminate
          access that violates these terms or threatens the service. Sections that
          by their nature should survive termination (licensing, disclaimers,
          liability) do.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law & changes">
        <p>
          These terms are governed by the laws of the operator&apos;s principal
          place of business, without regard to conflict-of-law rules. We may update
          these terms; material changes will be reflected in the date above.
          Continued use after a change means you accept it. Questions go to the{" "}
          <Link to="/contact" className="text-primary hover:underline">contact</Link>{" "}
          page.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
