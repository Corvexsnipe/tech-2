"use client";

import Link from "next/link";
import { useSyncExternalStore, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, BadgeCheck, Check, FileImage, Lock, MessageSquare, Pause, Play, QrCode, Search, ShieldCheck, Star } from "lucide-react";
import { HowItWorks } from "./how-it-works";
import { PointerScene } from "./pointer-scene";
import { GradeScale, illustrativeReview, ReviewCard } from "./review-card";

const principles = [
  { icon: Check, label: "Real customer experiences" },
  { icon: BadgeCheck, label: "Transparent grades" },
  { icon: ShieldCheck, label: "Optional proof" },
  { icon: MessageSquare, label: "Both sides of the story" },
];

const features = [
  { icon: Search, title: "Find a business", text: "Search the directory and open the public reputation profile for any listed business.", href: "/explore", label: "Explore businesses" },
  { icon: Star, title: "Write a review", text: "Rate service quality and customer support, then tell the story in your own words.", href: "/explore", label: "Start with a search" },
  { icon: BadgeCheck, title: "Read transparent grades", text: "Grades are calculated from cleared, published reviews — nothing hidden, nothing inflated.", href: "/how-it-works", label: "See the formula" },
  { icon: ShieldCheck, title: "Check the proof", text: "Reviewers can attach photos, receipts, or bookings to back up their experience.", href: "/how-it-works", label: "How proof works" },
  { icon: MessageSquare, title: "Hear both sides", text: "Businesses can reply to reviews so customers see the whole conversation.", href: "/for-businesses", label: "For businesses" },
  { icon: QrCode, title: "Scan to review", text: "Print-ready QR posters let real customers leave reviews straight from the counter.", href: "/for-businesses", label: "Claim a profile" },
];

const MOTION_KEY = "reviewmatters.motion";

export function BusinessCTA() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const reduced = useReducedMotion();
  return <section className="cta-section"><div className="container">
    <motion.div className="cta-card" initial={mounted && reduced !== true ? { opacity: 0, y: 28 } : false} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .3 }} transition={{ duration: .55 }}>
      <div className="cta-decoration" aria-hidden="true"><Star /><MessageSquare /><ShieldCheck /></div>
      <span className="eyebrow">EVERY EXPERIENCE HAS A STORY</span>
      <h2>Make your review matter.</h2>
      <p>Find a business, read the evidence, and share the experience that could help someone else decide.</p>
      <div className="button-row">
        <Link href="/explore" className="button white">Find a business <ArrowRight size={15} /></Link>
        <Link href="/claim" className="button glass">Claim a business</Link>
      </div>
      <small className="cta-small">Free to read, free to write — always transparent.</small>
    </motion.div>
  </div></section>;
}

export function Home() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const reduced = useReducedMotion();
  const animated = mounted && reduced !== true;
  const storedPaused = useSyncExternalStore(
    () => () => {},
    () => localStorage.getItem(MOTION_KEY) === "paused",
    () => false
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const paused = override ?? storedPaused;

  const toggleMotion = () => {
    const next = !paused;
    try { localStorage.setItem(MOTION_KEY, next ? "paused" : "on"); } catch { /* storage unavailable */ }
    setOverride(next);
  };

  return <div className="home-page">
    <section className="hero"><div className="container hero-grid">
      <motion.div className="hero-copy" initial={animated ? { opacity: 0, y: 26 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, ease: "easeOut" }}>
        <div className="hero-pill"><span />Real experiences. Clear grades. Better decisions.</div>
        <h1>Real Customer Reviews.<br className="desktop-break" /> <span className="serif">Clear Grades.</span><br className="desktop-break" /> Better Decisions.</h1>
        <p>Discover honest customer experiences and the transparent grades they build — before you decide where to spend your time and money.</p>
        <form className="hero-search" action="/explore" role="search" aria-label="Find a business">
          <Search size={17} aria-hidden="true" />
          <input type="search" name="q" aria-label="Search businesses" placeholder="Search a business or category" autoComplete="off" />
          <button type="submit" className="button primary small">Search</button>
        </form>
        <div className="hero-reassurance">
          <span><Check size={13} /> Real experiences</span>
          <span><BadgeCheck size={13} /> Transparent grades</span>
          <span><ShieldCheck size={13} /> Optional proof</span>
        </div>
      </motion.div>
      <div className="hero-visual">
        <div className="hero-grid-pattern" aria-hidden="true" /><div className="hero-glow" aria-hidden="true" />
        <div className="hero-orbit" aria-hidden="true" /><div className="hero-orbit orbit-two" aria-hidden="true" />
        <PointerScene className="hero-depth home-hero-scene" enabled={!paused} strength={6}>
          <div className="hero-review">
            <div className="preview-browser"><span /><span /><span /><small>reviewmatters.org/review/example</small><Lock size={10} /></div>
            <ReviewCard review={illustrativeReview} example />
          </div>
          <div className="floating-proof"><span className="floating-icon"><FileImage size={19} /></span><div><strong>Optional proof</strong><span>Receipts, photos, bookings</span></div></div>
          <div className="floating-grade"><span className="grade-orb">A+</span><div><strong>Transparent grades</strong><span>Built from real experiences</span></div><Star size={15} /></div>
          <span className="visual-note">— see the story behind the grade</span>
        </PointerScene>
        <span className="hero-hint" aria-hidden="true">Move your mouse — the scene responds</span>
        <button type="button" className="pointer-toggle" aria-pressed={paused} onClick={toggleMotion}>{paused ? <Play size={11} /> : <Pause size={11} />}{paused ? "Resume motion" : "Pause motion"}</button>
      </div>
    </div></section>

    <section className="principle-strip" aria-label="Principles"><div className="container">
      {principles.map(item => <span key={item.label}><item.icon size={15} /> {item.label}</span>)}
    </div></section>

    <HowItWorks />

    <section className="grade-section section-pad" aria-labelledby="grades-heading"><div className="container grade-section-grid">
      <div className="section-heading">
        <span className="eyebrow purple">TRANSPARENT BY DESIGN</span>
        <h2 id="grades-heading">Grades that <span className="serif">show their work.</span></h2>
        <p>An overall score from 0–100, built from the category grades real customers leave behind. No black boxes and no hidden math — you can always see how a grade was formed.</p>
        <Link href="/how-it-works" className="text-link">See how grading works <ArrowRight size={15} /></Link>
        <p className="fine-copy">Grades update as new, cleared reviews are published.</p>
      </div>
      <motion.div className="reputation-panel" initial={animated ? { opacity: 0, y: 30 } : false} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .3 }} transition={{ duration: .55 }}>
        <span className="eyebrow">EXAMPLE — NOT A REAL BUSINESS</span>
        <h3>Every grade has a formula behind it.</h3>
        <div className="reputation-score"><strong>85</strong><span>points out of 100</span></div>
        <GradeScale score={85} />
        <div className="live-score"><span>Service Quality</span><b>A+ · 100</b></div>
        <div className="live-score"><span>Customer Support</span><b>B · 70</b></div>
        <p className="fine-copy">(100 + 70) ÷ 2 = 85, which maps to Grade A. Illustrative calculation only.</p>
      </motion.div>
    </div></section>

    <section className="section-pad" aria-labelledby="features-heading"><div className="container">
      <div className="section-heading centered"><span className="eyebrow purple">FOR CUSTOMERS AND BUSINESSES</span><h2 id="features-heading">Every side of the <span className="serif">story.</span></h2><p>One profile. Real experiences. Clear grades. Tools for both customers and businesses.</p></div>
      <div className="feature-grid">{features.map(item => <PointerScene key={item.title} className="feature-scene" enabled={!paused} strength={4}>
        <article className="feature-card"><span className="feature-icon"><item.icon size={21} /></span><h3>{item.title}</h3><p>{item.text}</p><Link href={item.href} className="text-link">{item.label} <ArrowRight size={13} /></Link></article>
      </PointerScene>)}</div>
    </div></section>

    <section className="proof-section" aria-labelledby="proof-heading"><div className="container proof-section-grid">
      <motion.div className="proof-art" initial={animated ? { opacity: 0, scale: .96 } : false} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, amount: .3 }} transition={{ duration: .5 }}>
        <div className="photo-illustration"><div className="photo-sun" /><div className="photo-mountain one" /><div className="photo-mountain two" /><FileImage size={26} /></div>
        <span className="proof-art-tag"><ShieldCheck size={13} /> Illustration only — no real customer data</span>
      </motion.div>
      <div className="section-heading">
        <span className="eyebrow purple">PROOF, ON YOUR TERMS</span>
        <h2 id="proof-heading">Add evidence <span className="serif">when it helps.</span></h2>
        <p>Receipts, photos, and bookings can make an experience easier to understand — but proof is always optional, and sensitive details stay under your control.</p>
        <Link href="/how-it-works" className="text-link">How proof works <ArrowRight size={15} /></Link>
        <p className="fine-copy">Hide names, addresses, and order numbers before uploading.</p>
      </div>
    </div></section>

    <BusinessCTA />
  </div>;
}
