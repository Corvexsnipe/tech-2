"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Search, MapPin, ScanLine, Check } from "lucide-react";
import { GradeScale, illustrativeReview, ReviewCard } from "./review-card";

const steps = [
  { title: "Find a business", text: "Start with a name, a place, or a little curiosity. Discover businesses and open their public reputation profiles.", label: "A good decision starts here." },
  { title: "Read reviews. Check proof.", text: "Get the story behind the grade. Read customer experiences and explore optional supporting photos or receipts.", label: "More context. More clarity." },
  { title: "Understand the grades", text: "See how category scores come together. A simple, consistent scale makes different experiences easier to compare.", label: "No guesswork. Just clear grades." },
];
export function HowItWorks() {
  const [step, setStep] = useState(0);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const reduced = useReducedMotion();
  const animated = mounted && reduced !== true;
  const move = (delta: number) => setStep((step + delta + 3) % 3);
  return <section className="how-section section-pad" id="how-it-works"><div className="container">
    <div className="section-heading centered"><span className="eyebrow purple">A LITTLE CONTEXT GOES A LONG WAY</span><h2>From “not sure” to <span className="serif">sure thing.</span></h2><p>Three simple steps to make your next decision a better one.</p></div>
    <div className="how-grid"><div className="step-list" role="tablist" aria-label="How Review Matters works">{steps.map((item, i) => <button key={item.title} role="tab" id={`step-tab-${i}`} aria-selected={step === i} aria-controls="step-panel" className={`step-button ${step === i ? "selected" : ""}`} onClick={() => setStep(i)}><span className="step-number">0{i + 1}</span><span><strong>{item.title}</strong><span>{item.text}</span></span>{step === i && <ArrowRight size={19} />}</button>)}
      <div className="step-controls"><button className="icon-button" aria-label="Previous step" onClick={() => move(-1)}><ChevronLeft size={18} /></button><span>0{step + 1} <span>/ 03</span></span><button className="icon-button" aria-label="Next step" onClick={() => move(1)}><ChevronRight size={18} /></button></div>
    </div><motion.div className="step-stage" initial={animated ? { opacity: 0, y: 25 } : false} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .2 }}>
      <div className="stage-dots"><span /><span /><span /><small>THE REVIEW MATTERS EXPERIENCE</small></div>
      <div className="step-perspective" role="tabpanel" id="step-panel" aria-labelledby={`step-tab-${step}`}>
        <AnimatePresence mode="wait"><motion.div key={step} initial={animated ? { opacity: 0, rotateY: 12, x: 36 } : false} animate={{ opacity: 1, rotateY: 0, x: 0 }} exit={animated ? { opacity: 0, rotateY: -12, x: -36 } : { opacity: 0 }} transition={{ duration: animated ? .35 : 0 }}>
          {step === 0 ? <div className="search-illustration"><span className="tag"><Search size={13} /> DISCOVER YOUR NEXT GO-TO</span><h3>What are you looking for?</h3><form action="/explore" className="illustration-search"><Search size={19} /><input name="q" aria-label="Find a business" placeholder="Search for a business…" /><button aria-label="Search"><ArrowRight size={18} /></button></form><div className="profile-outline"><span className="business-monogram"><MapPin size={24} /></span><div><strong>Your next discovery</strong><p>Experiences. Evidence. A clearer picture.</p></div><Check className="purple-text" size={20} /></div><Link href="/explore" className="text-link">Explore the directory <ArrowRight size={15} /></Link></div> :
            step === 1 ? <ReviewCard review={illustrativeReview} example /> :
              <div className="grade-illustration"><span className="tag">THE MATH, MADE SIMPLE</span><div className="big-score"><motion.strong initial={animated ? { scale: .7 } : false} animate={{ scale: 1 }}>85</motion.strong><span>/ 100</span><i>Grade A</i></div><GradeScale score={85} /><div className="formula-row"><span>Service Quality <b>A+ <small>100 points</small></b></span><span>Customer Support <b>B <small>70 points</small></b></span></div><div className="formula-result">(100 + 70) ÷ 2 = <strong>85 points</strong></div><small>Illustrative calculation, not a business rating.</small></div>}
        </motion.div></AnimatePresence>
      </div><div className="stage-caption"><ScanLine size={16} />{steps[step].label}</div>
    </motion.div></div>
  </div></section>;
}
