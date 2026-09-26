import Link from "next/link";
import { ScanForm } from "@/components/ScanForm";
import { ScanShortcut } from "@/components/landing/ScanShortcut";
import { StoryEngineMount } from "@/components/landing/StoryEngineMount";
import { formatUsd, reportPriceCents } from "@/lib/pricing";
import { AA_LINE, SCORE, SEVERITY } from "@/lib/story/engine";
import s from "./landing.module.css";

// Copy is the approved landing copy (docs/superpowers/specs/2026-09-19-legible-design.md §6).
// Every animated value is rendered here in its final state; the story engine
// rewinds and plays it when scripts run.

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className={s.kicker}>
      <span className={s.kickerRule} aria-hidden="true" />
      {children}
    </span>
  );
}

// Headlines the engine splits into animated words. Assistive technology reads
// the plain sentence once; the animated copy is hidden from it.
function Split({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" data-split="">
        {text}
      </span>
    </>
  );
}

const SEVERITY_ROWS = [
  { name: "Critical", fill: "var(--color-accent-400)" },
  { name: "Serious", fill: "var(--color-accent-2-500)" },
  { name: "Moderate", fill: "var(--color-neutral-600)" },
];

export default function Home() {
  const total = SEVERITY.reduce((a, b) => a + b, 0);
  const price = formatUsd(reportPriceCents());
  return (
    <div id="story" data-a="root" className={s.root}>
      <StoryEngineMount rootId="story" />
      <div className={s.inner}>
        <div className={s.gateLayer} aria-hidden="true">
          <div data-a="gate" className={s.gate}>
            <span data-a="gpct" className={s.gatePct}>
              0%
            </span>
            <span className={s.gateTrack}>
              <span data-a="gbar" className={s.gateBar} />
            </span>
            <span className={s.gateCaption}>Preparing your read</span>
          </div>
        </div>

        <div className={s.bgLayer} aria-hidden="true">
          <div className={s.bgFrame}>
            <div data-a="base" className={s.base} />
            <canvas data-a="cv" className={s.canvas} />
            <div className={s.vignette} />
            <div data-a="scrim" className={s.scrim} />
            <div className={s.glow} />
            <div className={s.noise} />
            <div data-a="edge" className={s.edge}>
              01 — Launch
            </div>
          </div>
        </div>

        <div className={s.povLayer} aria-hidden="true">
          <div data-a="pov" className={s.pov}>
            <div className={s.povGlint} />
          </div>
        </div>

        <div className={s.content}>
          <header data-a="hdr" className={s.header}>
            <Link href="/" className={s.brand} aria-label="Legible, home">
              <span className={s.brandMark} aria-hidden="true">
                <span className={s.brandDot} />
              </span>
              <span className={s.brandName}>Legible</span>
            </Link>
            <span className={s.headerEnd}>
              <ScanShortcut className={s.shortcut} />
              <span data-a="idx" className={s.idx} aria-hidden="true">
                01 / 07
              </span>
            </span>
          </header>

          <main id="main">
            <section data-chap="" aria-labelledby="ch1-title" className={s.ch1}>
              <div className={s.w1}>
                <div data-reveal="">
                  <Kicker>01 · Launch</Kicker>
                </div>
                <h1 id="ch1-title" data-a="ink0" className={s.h1}>
                  <Split text="Every site claims to be accessible. Few are ever read as one." />
                </h1>
                <p data-reveal="" data-reveal-delay="2" className={s.lede}>
                  Legible tests your site against WCAG 2.1 AA and shows you exactly what to fix.
                </p>
                <span data-a="cue" data-reveal="" data-reveal-delay="4" className={s.cue} aria-hidden="true">
                  Scroll to launch
                </span>
              </div>
            </section>

            <section data-chap="" aria-labelledby="ch2-title" className={s.ch2}>
              <div className={s.w2}>
                <div data-reveal="">
                  <Kicker>02 · The mission</Kicker>
                </div>
                <h2 id="ch2-title" data-reveal="" data-reveal-delay="1" className={s.h2mission}>
                  What Legible is, and why the trip is worth taking.
                </h2>
                <p data-reveal="" data-reveal-delay="2" className={s.body2}>
                  Legible tests your home page and up to five linked pages against WCAG 2.1 AA. The report explains
                  each failure, who it affects and the code change that fixes it.
                </p>
                <ul className={s.cards}>
                  <li data-reveal="" data-reveal-delay="3" className={s.card}>
                    <span className={s.cardRule} aria-hidden="true" />
                    <span className={s.cardNum} aria-hidden="true">
                      01
                    </span>
                    <h3 className={s.cardTitle}>Readable findings</h3>
                    <p className={s.cardBody}>
                      Most scanners return rule IDs and raw code. Legible explains each failure in terms a site owner
                      understands.
                    </p>
                  </li>
                  <li data-reveal="" data-reveal-delay="4" className={s.card}>
                    <span className={s.cardRule} aria-hidden="true" />
                    <span className={s.cardNum} aria-hidden="true">
                      02
                    </span>
                    <h3 className={s.cardTitle}>Fixes in priority order</h3>
                    <p className={s.cardBody}>
                      Every failure comes with the affected element, the WCAG rule it breaks and corrected code, sorted
                      into must fix, should fix and nice to have.
                    </p>
                  </li>
                  <li data-reveal="" data-reveal-delay="5" className={s.card}>
                    <span className={s.cardRule} aria-hidden="true" />
                    <span className={s.cardNum} aria-hidden="true">
                      03
                    </span>
                    <h3 className={s.cardTitle}>A dated record</h3>
                    <p className={s.cardBody}>
                      Re-scan after each release and keep a dated history of your results against WCAG 2.1 AA.
                    </p>
                  </li>
                </ul>
              </div>
            </section>

            <section data-chap="" data-a="s2" aria-labelledby="ch3-title" className={s.ch3}>
              <div className={s.stick}>
                <div className={s.w3}>
                  <div data-reveal="">
                    <Kicker>03 · The read</Kicker>
                  </div>
                  <h2 id="ch3-title" data-reveal="" data-reveal-delay="1" className={s.h2quiet}>
                    What a screen reader hears on a typical checkout page.
                  </h2>
                  <p data-a="speech" className={s.speech}>
                    <Split text="“Link. Empty link. Button, unlabelled. Heading level four, inside nothing.”" />
                  </p>
                  <p data-reveal="" data-reveal-delay="2" className={s.body3}>
                    Up to six pages per scan. Every link, form label, image and colour pair is checked and traced to the
                    markup behind it.
                  </p>
                </div>
              </div>
            </section>

            <section data-chap="" data-a="sel" aria-labelledby="ch4-title" className={s.ch4}>
              <div className={s.stick}>
                <div className={s.w4}>
                  <div data-reveal="">
                    <Kicker>04 · The survey</Kicker>
                  </div>
                  <h2 id="ch4-title" data-reveal="" data-reveal-delay="1" className={s.h2survey}>
                    Stop on one button. This is everything a screen reader is told about it.
                  </h2>
                  <ul className={s.findings}>
                    {[
                      "Button has no accessible name",
                      "Icon has no text alternative",
                      "Label contrast is 2.3:1, below the 4.5:1 minimum",
                    ].map((label, i) => (
                      <li key={label} className={s.finding}>
                        <span data-a={`ln${i}`} className={s.findingLine} aria-hidden="true" />
                        <span data-a={`lb${i}`} className={s.findingLabel}>
                          {label}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p data-reveal="" data-reveal-delay="3" className={s.body4}>
                    One button, three failures. The report lists every failure like this one, with its fix.
                  </p>
                </div>
              </div>
            </section>

            <section data-chap="" data-a="s3" aria-labelledby="ch5-title" className={s.ch5}>
              <div className={s.stick}>
                <div className={s.w5}>
                  <div data-reveal="">
                    <Kicker>05 · The count</Kicker>
                  </div>
                  <h2 id="ch5-title" className={s.totalRow}>
                    <span data-a="total" className={s.total} aria-hidden="true">
                      {total}
                    </span>
                    <span className="sr-only">{total} </span>
                    <span className={s.totalCaption}>failures, not warnings</span>
                  </h2>
                  <ul className={s.bars}>
                    {SEVERITY_ROWS.map((row, i) => (
                      <li key={row.name} className={s.barRow}>
                        <span className={s.barName}>{row.name}</span>
                        <span className={s.barTrack} aria-hidden="true">
                          <span
                            data-a={`bar${i}`}
                            className={s.barFill}
                            style={{ background: row.fill, transform: `scaleX(${(SEVERITY[i] / total).toFixed(4)})` }}
                          />
                        </span>
                        <span data-a={`val${i}`} className={s.barValue} aria-hidden="true">
                          {SEVERITY[i]}
                        </span>
                        <span className="sr-only">{SEVERITY[i]}</span>
                      </li>
                    ))}
                  </ul>
                  <p data-reveal="" data-reveal-delay="2" className={s.body5}>
                    Twelve of them stop someone from finishing the form today. Everything else queues behind those.
                  </p>
                </div>
              </div>
            </section>

            <section data-chap="" data-a="s4" aria-labelledby="ch6-title" className={s.ch6}>
              <div className={s.stick}>
                <div className={s.w5}>
                  <div data-reveal="">
                    <Kicker>06 · The line</Kicker>
                  </div>
                  <h2 id="ch6-title" data-a="ink1" className={s.h2line}>
                    <Split text="AA is the line. You sit under it." />
                  </h2>
                  <div className={s.railWrap}>
                    <div
                      data-a="rail"
                      className={s.rail}
                      role="img"
                      aria-label={`A score of ${SCORE} out of 100 on a rail that ends at 0 failures. ${AA_LINE - SCORE} points to go.`}
                    >
                      <div className={s.railRule} />
                      <div
                        data-a="gap"
                        className={s.gap}
                        style={{ left: `${SCORE}%`, width: `${AA_LINE - SCORE}%` }}
                      />
                      <div className={s.aa} style={{ left: `${AA_LINE}%` }}>
                        <span className={s.aaLabel}>0 failures</span>
                      </div>
                      <div data-a="mark" className={s.mark} style={{ left: `${SCORE}%` }}>
                        <span className={s.markLine} />
                        <span data-a="gval" className={s.markValue}>
                          {SCORE}
                        </span>
                      </div>
                    </div>
                    <p data-a="gaplabel" className={s.gapLabel}>
                      32 points to go. Twelve fixes close most of the gap.
                    </p>
                  </div>
                  <p data-reveal="" data-reveal-delay="3" className={s.body6}>
                    AA is the level regulators cite. Every Legible report measures against it and lists the fixes that
                    close the gap fastest.
                  </p>
                </div>
              </div>
            </section>

            <section id="scan" data-chap="" data-a="s5" aria-labelledby="ch7-title" className={s.ch7}>
              <div className={s.stick7}>
                <div className={s.w7}>
                  <div data-reveal="">
                    <Kicker>07 · Landing</Kicker>
                  </div>
                  <h2 id="ch7-title" data-a="ink2" className={s.h2landing}>
                    <Split text="Enter your site and we will test it." />
                  </h2>
                  <p data-reveal="" data-reveal-delay="1" className={s.body7a}>
                    You landed. The free scan shows your score, your issue counts and two sample fixes.
                  </p>
                  <p data-reveal="" data-reveal-delay="2" className={s.body7b}>
                    The full report covers every failure with corrected code, for a one-time {price}.
                  </p>
                  <div data-reveal="" data-reveal-delay="3" style={{ margin: "38px 0 0", maxWidth: "30rem" }}>
                    <ScanForm />
                  </div>
                </div>
              </div>
            </section>
          </main>

          <footer data-a="foot" className={s.footer}>
            <span className={s.footerLead}>An independent audit. No overlay widgets.</span>
            <p className={s.footerText}>
              Legible identifies issues measured against WCAG 2.1 Level AA. Automated testing cannot detect every issue,
              so manual review is recommended.
            </p>
            <ul className={s.footerLinks}>
              <li>
                <Link href="/terms">Terms</Link>
              </li>
              <li>
                <Link href="/privacy">Privacy</Link>
              </li>
              <li>
                <Link href="/account">Your reports</Link>
              </li>
              <li>
                <Link href="/bot">About our scanner</Link>
              </li>
            </ul>
          </footer>
        </div>
      </div>
    </div>
  );
}
