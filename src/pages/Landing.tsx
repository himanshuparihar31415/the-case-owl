import React, { useEffect, useRef, useState } from 'react';
import './Landing.css';

interface LandingProps {
  onOpenAuth: () => void;
}

const OwlMark = () => (
  <svg className="owl-mini" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="19" fill="#13294A" />
    <circle cx="13.5" cy="17" r="5.2" fill="#fff" />
    <circle cx="26.5" cy="17" r="5.2" fill="#fff" />
    <circle cx="13.5" cy="17" r="2.4" fill="#1BA6E1" />
    <circle cx="26.5" cy="17" r="2.4" fill="#1BA6E1" />
    <path d="M20 22l-2.4 3h4.8z" fill="#1BA6E1" />
  </svg>
);

// Phrases the owl "catches" as you move over it.
const CATCH_PHRASES = [
  'missed structure', 'weak frame', 'no hypothesis', 'unvalidated number',
  'vague recommendation', 'lost the thread', 'filler creeping in', 'rushed the math',
  'no prioritisation', 'skipped validation', 'that pause cost you', 'guessed, didn’t check',
];

interface Tag { id: number; x: number; y: number; text: string }

export default function Landing({ onOpenAuth }: LandingProps) {
  const owlRef = useRef<SVGSVGElement>(null);
  const pLRef = useRef<SVGCircleElement>(null);
  const pRRef = useRef<SVGCircleElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastSpawn = useRef(0);
  const idRef = useRef(0);
  const [navScrolled, setNavScrolled] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);

  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Pupils track the cursor.
  useEffect(() => {
    if (reduceMotion) return;
    const onMove = (e: MouseEvent) => {
      const owl = owlRef.current, pL = pLRef.current, pR = pRRef.current;
      if (!owl || !pL || !pR) return;
      const r = owl.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.42;
      const ang = Math.atan2(e.clientY - cy, e.clientX - cx);
      const d = 6, dx = Math.cos(ang) * d, dy = Math.sin(ang) * d;
      pL.setAttribute('transform', `translate(${dx},${dy})`);
      pR.setAttribute('transform', `translate(${dx},${dy})`);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [reduceMotion]);

  const onStageMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduceMotion || !stageRef.current) return;
    const now = Date.now();
    if (now - lastSpawn.current < 480) return;
    lastSpawn.current = now;
    const rect = stageRef.current.getBoundingClientRect();
    const id = ++idRef.current;
    const tag: Tag = {
      id,
      x: e.clientX - rect.left + (Math.random() * 40 - 20),
      y: e.clientY - rect.top + (Math.random() * 20 - 10),
      text: CATCH_PHRASES[Math.floor(Math.random() * CATCH_PHRASES.length)],
    };
    setTags((t) => [...t, tag]);
    window.setTimeout(() => setTags((t) => t.filter((z) => z.id !== id)), 1600);
  };

  return (
    <div className="owl-landing">
      {/* NAV */}
      <nav className={`nav${navScrolled ? ' scrolled' : ''}`}>
        <div className="wrap nav-in">
          <div className="brand"><OwlMark /> The Case Owl</div>
          <div className="nav-r">
            <a className="signin" onClick={onOpenAuth}>Sign in</a>
            <a className="btn btn-navy" href="#reps">Take the chair</a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">Voice-based case interview practice</span>
            <h1>Sit across from a partner. <span className="cy">As many times as it takes.</span></h1>
            <p className="lead">The Case Owl runs the real case interview by voice — then shows you, <b>to the second</b>, where you lost the room. Practise until the chair feels like nothing.</p>
            <div className="hero-cta">
              <a className="btn btn-navy" href="#reps">Take the chair <span className="ar">→</span></a>
              <a className="btn btn-out" href="#sees">See what it catches</a>
            </div>
            <div className="hero-tag"><i></i> Nothing you say gets past the owl.</div>
          </div>

          <div className="owl-stage" ref={stageRef} onMouseMove={onStageMove}>
            <svg className="owl" ref={owlRef} viewBox="0 0 260 260">
              <ellipse cx="130" cy="150" rx="92" ry="98" fill="#13294A" />
              <path d="M58 70 q6 -34 30 -40 q-8 26 -8 46z" fill="#13294A" />
              <path d="M202 70 q-6 -34 -30 -40 q8 26 8 46z" fill="#13294A" />
              <circle cx="130" cy="118" r="78" fill="#1C3354" />
              <circle className="eye" cx="98" cy="110" r="34" fill="#F4F6FA" />
              <circle className="eye" cx="162" cy="110" r="34" fill="#F4F6FA" />
              <circle className="iris" cx="98" cy="110" r="17" />
              <circle className="iris" cx="162" cy="110" r="17" />
              <circle className="pupil" ref={pLRef} cx="98" cy="110" r="8" />
              <circle className="pupil" ref={pRRef} cx="162" cy="110" r="8" />
              <circle cx="93" cy="105" r="3" fill="#fff" opacity=".9" />
              <circle cx="157" cy="105" r="3" fill="#fff" opacity=".9" />
              <path d="M130 132 l-11 16 h22 z" fill="#1BA6E1" />
            </svg>
            <span className="watching"><i></i> Watching</span>
            {tags.map((t) => (
              <span key={t.id} className="owl-tag" style={{ left: t.x, top: t.y }}>{t.text}</span>
            ))}
          </div>
        </div>
      </header>

      {/* STAKES */}
      <section className="dark dark-glow sec stakes">
        <div className="wrap sec-narrow">
          <span className="eyebrow">The math nobody tells you</span>
          <h2 style={{ marginTop: 14 }}>A handful of interviews decide <span className="cy">years</span> of your career.</h2>
          <p>The top firms accept around 1 in 100. You&apos;ll get a few rounds, a few cases each, and no second takes. The people who make it aren&apos;t smarter. They&apos;ve just done it more.</p>
          <div className="stakes-row">
            <div className="s"><div className="v">~<span className="cy">1%</span></div><div className="l">acceptance rate</div></div>
            <div className="s"><div className="v">3–4</div><div className="l">interviews, total</div></div>
            <div className="s"><div className="v">0</div><div className="l">do-overs</div></div>
          </div>
        </div>
      </section>

      {/* STUCK */}
      <section className="sec stuck">
        <div className="wrap">
          <span className="eyebrow">Why practice stops working</span>
          <h2>Your friends say <span className="q">&ldquo;that was great.&rdquo;</span><br />The interviewer won&apos;t.</h2>
          <p className="sub">You can drill a hundred cases and still not improve — because nobody tells you the exact thing that&apos;s holding you back. Real feedback is too expensive, too rare, and far too polite.</p>
        </div>
      </section>

      {/* OWL SEES */}
      <section className="sec sees" id="sees" style={{ background: 'var(--bg-2)' }}>
        <div className="wrap">
          <span className="eyebrow" style={{ display: 'block', textAlign: 'center' }}>The owl misses nothing</span>
          <h2 style={{ marginTop: 14 }}>It doesn&apos;t flatter you. It just sees everything.</h2>
          <p className="lead">Every word, every pause, every number you waved past — caught, timestamped, and handed back to you.</p>
          <div className="obs">
            <div className="ob">
              <div className="t mono">02:08</div>
              <div><div className="said">&ldquo;I&apos;m assuming 50 million are diabetic.&rdquo;</div><div className="caught"><b>Caught:</b> a load-bearing assumption, never validated. <span className="g">Better:</span> anchor it to a real figure first.</div></div>
            </div>
            <div className="ob">
              <div className="t mono">04:14</div>
              <div><div className="said">&ldquo;will check the historical trend…&rdquo;</div><div className="caught"><b>Caught:</b> dropped subject — small slips read as nerves. <span className="g">Better:</span> &ldquo;I will check the historical trend.&rdquo;</div></div>
            </div>
            <div className="ob">
              <div className="t mono">08:18</div>
              <div><div className="said">…four seconds of silence.</div><div className="caught"><b>Caught:</b> a long pause and a fragmented answer when the pressure rose.</div></div>
            </div>
            <div className="ob">
              <div className="t mono">— pace</div>
              <div><div className="said">&ldquo;like&rdquo; × 9 · &ldquo;basically&rdquo; × 1 · 116 wpm</div><div className="caught"><b>Caught:</b> filler and pace that quietly cost you executive presence.</div></div>
            </div>
          </div>
        </div>
      </section>

      {/* RECEIPTS */}
      <section className="sec receipts">
        <div className="wrap">
          <span className="eyebrow">And then</span>
          <h2 style={{ marginTop: 14, fontSize: 'clamp(28px,4vw,46px)' }}>It hands you the receipts.</h2>
          <div className="glimpse">
            <div className="gt mono">thecaseowl.com / your-report</div>
            <div className="gb">
              <div className="gscore"><span className="v">5.2<small>/10</small></span><span className="st">Needs practice</span></div>
              <div className="gsub">Borderline · Advanced market-entry · 8 competencies scored</div>
              <div className="gline"><span className="nm">Structuring</span><span className="sv">4/10</span></div>
              <div className="gline"><span className="nm">Communication</span><span className="sv">4/10</span></div>
              <div className="gline"><span className="nm">Problem understanding</span><span className="sv ok">6/10</span></div>
              <div className="gline"><span className="nm">Next rep · P0</span><span className="sv ok">Fix structuring</span></div>
            </div>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 15, marginTop: 26 }}>A full debrief, a tagged transcript, and the one thing to fix first — every single session.</p>
        </div>
      </section>

      {/* REPS / PRICING */}
      <section className="dark dark-glow sec reps" id="reps">
        <div className="wrap">
          <span className="eyebrow" style={{ display: 'block', textAlign: 'center' }}>Pricing</span>
          <h2 style={{ marginTop: 14 }}>How many reps before the real one?</h2>
          <p className="lead">The candidates who walk in calm have already heard exactly where they slip. Cancel anytime.</p>
          <div className="price">
            <div className="pc">
              <div className="tier">Starter</div>
              <div className="sub">Find your gaps before committing a season.</div>
              <div className="pp">₹1,499<span className="per">/mo + GST</span></div>
              <ul><li><span className="ck">✓</span> 5 scored interviews / month</li><li><span className="ck">✓</span> Core case types</li><li><span className="ck">✓</span> Full report + transcript</li></ul>
              <button className="btn btn-out-light" onClick={onOpenAuth}>Choose Starter</button>
            </div>
            <div className="pc feat">
              <div className="badge">Most reps</div>
              <div className="tier">Pro</div>
              <div className="sub">Unlimited reps for an active interview season.</div>
              <div className="pp">₹3,999<span className="per">/mo + GST</span></div>
              <ul><li><span className="ck">✓</span> Unlimited interviews</li><li><span className="ck">✓</span> All firm styles + exhibits</li><li><span className="ck">✓</span> Full dashboard + trends</li><li><span className="ck">✓</span> Weak-spot targeting</li></ul>
              <button className="btn btn-cyan" onClick={onOpenAuth}>Choose Pro</button>
            </div>
            <div className="pc">
              <div className="tier">Sprint</div>
              <div className="sub">Two intense weeks before interview day.</div>
              <div className="pp">₹6,499<span className="per">/2wk + GST</span></div>
              <ul><li><span className="ck">✓</span> Everything in Pro</li><li><span className="ck">✓</span> Daily targeted plan</li><li><span className="ck">✓</span> Full mock-day loop</li></ul>
              <button className="btn btn-out-light" onClick={onOpenAuth}>Choose Sprint</button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec" id="faq">
        <div className="wrap faq">
          <div className="qa"><div className="q">Why isn&apos;t there a free trial interview?</div><div className="a">A full voice interview is a live, intensive session on our side, so we can&apos;t give them away. But everything above is real — <em>you can see exactly what the owl catches and what you&apos;d get back before you pay a cent.</em> Plans start small and cancel anytime.</div></div>
          <div className="qa"><div className="q">Is it really like a real interviewer?</div><div className="a">It talks, listens, and reacts live — it interrupts when your logic drifts, drills weak assumptions, and adapts to your answers. The pressure is real, and the feedback is more detailed than any human has time to give.</div></div>
          <div className="qa"><div className="q">What do I need to start?</div><div className="a">A microphone and a quiet room. It runs in your browser — nothing to install, nothing to schedule.</div></div>
        </div>
      </section>

      {/* CLOSE */}
      <section className="dark dark-glow sec close">
        <div className="wrap">
          <div className="resetline mono">00:00 — READY WHEN YOU ARE</div>
          <h2>The chair is <span className="cy">empty.</span></h2>
          <p>Sit down tonight. Make the first time you say it out loud not be the one that counts.</p>
          <button className="btn btn-cyan" onClick={onOpenAuth}>Take the chair <span className="ar">→</span></button>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="wrap foot">
          <div className="brand" style={{ fontSize: 17 }}><OwlMark /> The Case Owl</div>
          <div className="links"><a href="#sees">What it catches</a><a href="#reps">Pricing</a><a href="#faq">FAQ</a></div>
          <div>© 2026 The Case Owl</div>
        </div>
      </footer>
    </div>
  );
}
