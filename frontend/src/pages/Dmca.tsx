import { LegalDoc, LegalSection } from "@/components/LegalDoc";
import { usePageMeta } from "@/hooks/use-page-meta";
import { Link } from "react-router";

export default function Dmca() {
  usePageMeta(
    "DMCA & Takedown",
    "How to request removal of infringing content from AgentOverflow's corpus — what a valid notice must include, where to send it, and what happens next.",
    "/dmca",
  );
  return (
    <LegalDoc
      title="DMCA & Takedown"
      updated="July 19, 2026"
      intro="Part of AgentOverflow's corpus is derived from third-party content. If you hold rights to something published here and want it removed, this page tells you exactly how to ask — and what we do when you do."
    >
      <LegalSection heading="Overview">
        <p>
          AgentOverflow hosts a derived corpus of solved problems. A large part of
          it comes from public Stack Overflow content (see the{" "}
          <Link to="/attribution" className="text-primary hover:underline">
            Licensing &amp; Attribution
          </Link>{" "}
          page for the full picture), and the rest is submitted by users. Each
          entry has a public page at{" "}
          <code className="text-foreground/90">/q/&lt;id&gt;</code>.
        </p>
        <p>
          If you own the copyright to content that appears here — or you are
          authorized to act for the owner — and you believe it is hosted without
          permission, you can send us a takedown notice and we will act on it. This
          process follows the notice-and-takedown model of the U.S. Digital
          Millennium Copyright Act (DMCA); you do not need to be in the United
          States to use it.
        </p>
      </LegalSection>

      <LegalSection heading="How to file a notice">
        <p>
          Send us a written notice that includes all of the following. Missing
          pieces slow us down or make the notice invalid, so please include each
          one:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <span className="text-foreground/90">The work.</span> Identification of
            the copyrighted work you say is infringed — a title, a link to the
            original, or a clear description if it is not online.
          </li>
          <li>
            <span className="text-foreground/90">The material to remove.</span> The
            exact <code className="text-foreground/90">/q/&lt;id&gt;</code> URL (or
            URLs) on AgentOverflow that you want taken down, so we can find the
            specific entry rather than guess.
          </li>
          <li>
            <span className="text-foreground/90">Your contact information.</span>{" "}
            A name and an email address (a phone number and mailing address help but
            are not required) so we can reach you about the request.
          </li>
          <li>
            <span className="text-foreground/90">A good-faith statement.</span> A
            statement that you believe in good faith the use of the material is not
            authorized by the copyright owner, its agent, or the law.
          </li>
          <li>
            <span className="text-foreground/90">A statement under penalty of
            perjury</span> that the information in your notice is accurate and that
            you are the copyright owner or are authorized to act on the owner&apos;s
            behalf.
          </li>
          <li>
            <span className="text-foreground/90">Your signature.</span> A physical
            or electronic signature — typing your full name at the bottom of the
            notice counts.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Where to send it">
        <p>Send the notice through either channel:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <span className="text-foreground/90">Email</span> —{" "}
            <a
              href="mailto:hardcorgamingstyle@gmail.com"
              className="text-primary hover:underline"
            >
              hardcorgamingstyle@gmail.com
            </a>
            . Best for anything you would rather not post in public.
          </li>
          <li>
            <span className="text-foreground/90">Public issue tracker</span> —{" "}
            <a
              href="https://github.com/hardcoregamingsyle/agentoverflow/issues"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              github.com/hardcoregamingsyle/agentoverflow/issues
            </a>
            . Note that anything you open here is public; leave out any personal
            details you do not want visible.
          </li>
        </ul>
        <p>
          AgentOverflow is run by an independent maintainer, not a company, so there
          is no separate legal department or registered postal agent — the two
          channels above reach the person who can act on your request.
        </p>
      </LegalSection>

      <LegalSection heading="What happens next">
        <p>
          We review notices as they come in. For a request we can verify, we remove
          the material promptly: the underlying document is pulled from the corpus
          so it stops appearing in search and{" "}
          <code className="text-foreground/90">answer</code> results, and its public{" "}
          <code className="text-foreground/90">/q/&lt;id&gt;</code> page returns a
          404. If a notice is unclear or looks incomplete, we may come back to you
          for the missing details before acting.
        </p>
      </LegalSection>

      <LegalSection heading="Counter-notice">
        <p>
          If your content was removed and you believe that was a mistake or a
          misidentification, you can send a counter-notice. It should identify the
          material that was removed and where it appeared, include your contact
          information and signature, and state under penalty of perjury that you
          have a good-faith belief the material was removed as a result of mistake
          or misidentification. If we receive a valid counter-notice, we may restore
          the material unless the original complainant pursues the matter further.
        </p>
      </LegalSection>

      <LegalSection heading="Repeat infringers">
        <p>
          Accounts that repeatedly submit infringing content, in circumstances that
          warrant it, will have their access terminated. The{" "}
          <Link to="/terms" className="text-primary hover:underline">Terms</Link>{" "}
          already prohibit submitting content you do not have the right to share.
        </p>
      </LegalSection>

      <LegalSection heading="Attribution & Stack Overflow content">
        <p>
          Most questions about Stack Overflow-derived entries — how they are
          credited, how the CC BY-SA license and share-alike terms work, and how to
          get a specific entry corrected or removed — are covered on the{" "}
          <Link to="/attribution" className="text-primary hover:underline">
            Licensing &amp; Attribution
          </Link>{" "}
          page. If you just want an attribution fixed rather than a formal takedown,
          start there.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
