"use client";
import { useRef, useState } from "react";
import { BadgeCheck, ChevronLeft, ChevronRight, FileImage, Flag, MessageSquare, ShieldCheck, X } from "lucide-react";
import { GRADES, gradeFor, type Grade } from "@/lib/grades";
import { ActionForm } from "./forms";

export function GradeScale({ score, compact = false }: { score: number; compact?: boolean }) {
  const grade = gradeFor(score);
  return <div className={`grade-scale ${compact ? "compact" : ""}`} aria-label={`Overall grade ${grade}. Grade scale A plus, A, B, C, D.`}>{GRADES.map(g => <span key={g} className={g === grade ? `selected grade-${g.replace("+", "plus")}` : ""} aria-current={g === grade ? "true" : undefined}>{g}</span>)}</div>;
}
export type Evidence = { id: string; label: string };
export function ProofViewer({ attachments, illustration = false }: { attachments: Evidence[]; illustration?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [report, setReport] = useState(false);
  if (!attachments.length) return null;
  const attachment = attachments[index];
  const change = (direction: number) => { setIndex((index + direction + attachments.length) % attachments.length); setReport(false); };
  return <>
    <button className="proof-button" onClick={() => dialog.current?.showModal()}><ShieldCheck size={15} /> Check Proof <span>{attachments.length}</span></button>
    <dialog ref={dialog} className="proof-dialog" onKeyDown={e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; if (e.key === "ArrowRight") change(1); if (e.key === "ArrowLeft") change(-1); }} onClick={e => { if (e.target === dialog.current) dialog.current?.close(); }}>
      <div className="dialog-inner"><div className="dialog-header"><div><h3>Supporting evidence</h3><p>{illustration ? "Illustration — no real purchase or customer data" : "Submitted by the reviewer. Evidence does not guarantee authenticity."}</p></div><button autoFocus aria-label="Close proof viewer" className="icon-button" onClick={() => dialog.current?.close()}><X /></button></div>
        <div className="proof-image">{illustration ? <div className="example-proof"><FileImage size={52} /><h3>Your evidence, with privacy in mind.</h3><p>A product photo or a redacted receipt can add context. Hide names, addresses, payment details, and order numbers before uploading.</p><span className="tag">Illustration only</span></div> :
          /* Private files require the authorization endpoint, not an image optimizer cache. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/evidence/${attachment.id}`} alt={attachment.label} />}
        </div>
        <div className="dialog-controls"><button className="icon-button" aria-label="Previous attachment" disabled={attachments.length < 2} onClick={() => change(-1)}><ChevronLeft /></button><span>{index + 1} of {attachments.length}</span><button className="icon-button" aria-label="Next attachment" disabled={attachments.length < 2} onClick={() => change(1)}><ChevronRight /></button></div>
        {!illustration && <><button className="text-button" onClick={() => setReport(!report)}><Flag size={14} /> Report privacy or inappropriate content</button>{report && <ActionForm action="report" fixed={{ targetType: "attachment", targetId: attachment.id }} label="Send report"><label className="field"><span>Category</span><select name="kind" defaultValue="personal-info"><option value="personal-info">Personal information exposure</option><option value="copyright">Copyright or privacy</option><option value="harassment">Harassment or abuse</option><option value="other">Other violation</option></select></label><label className="field"><span>What should we check?</span><textarea name="reason" minLength={10} maxLength={2000} required rows={3} /></label><small>You must be signed in with a verified email to report content.</small></ActionForm>}</>}
      </div>
    </dialog>
  </>;
}
export type ReviewView = {
  id: string; headline: string; body: string; score: number; serviceGrade: Grade; supportGrade: Grade | null;
  supportSnapshot: boolean; date: string; author: string; attachments: Evidence[]; reply?: { id: string; body: string } | null;
};
export function ReviewCard({ review, supportEnabled = true, example = false }: { review: ReviewView; supportEnabled?: boolean; example?: boolean }) {
  const [report, setReport] = useState(false);
  return <article className={`review-card ${example ? "example-card" : ""}`}>
    <div className="review-top"><div className="review-person"><span className="avatar">{example ? <MessageSquare size={20} /> : review.author.charAt(0).toUpperCase()}</span><div><strong>{review.author}</strong><span>{example ? "How a review comes together" : review.date}</span></div></div><span className="review-label">{example ? "Scoring example" : "Customer review"}</span></div>
    <div className="review-score-row"><div><span className="eyebrow">OVERALL EXPERIENCE</span><GradeScale score={review.score} /></div><div className="score"><strong>{review.score.toFixed(Number.isInteger(review.score) ? 0 : 1)}</strong><span>/ 100</span></div></div>
    <h3>{review.headline}</h3><p className="review-body">{review.body}</p>
    <div className="category-grades"><span>Service Quality <b>{review.serviceGrade}</b></span>{supportEnabled && review.supportGrade && <span>Customer Support <b>{review.supportGrade}</b></span>}</div>
    {review.supportSnapshot && !supportEnabled && <p className="historical-note">This historical overall score includes Customer Support as it was enabled at submission.</p>}
    {supportEnabled && !review.supportSnapshot && <p className="historical-note">Service Quality only; submitted before Customer Support was enabled.</p>}
    <div className="review-bottom">{review.attachments.length ? <ProofViewer attachments={review.attachments} illustration={example} /> : <small>Proof is optional.</small>}{example ? <span className="subtle"><BadgeCheck size={14} /> Clear by design</span> : <button className="text-button muted" onClick={() => setReport(!report)}><Flag size={13} /> Report</button>}</div>
    {report && <ActionForm action="report" label="Submit report" fixed={{ targetType: "review", targetId: review.id }}><label className="field"><span>Category</span><select name="kind" defaultValue="fake"><option value="fake">Suspected fake review</option><option value="harassment">Harassment or abuse</option><option value="personal-info">Personal information exposure</option><option value="spam">Spam or conflict of interest</option><option value="wrong-business">Incorrect business</option><option value="copyright">Copyright or privacy</option><option value="other">Other violation</option></select></label><label className="field"><span>Why are you reporting this review?</span><textarea name="reason" required minLength={10} maxLength={2000} /></label><small>Sign in with a verified email to submit a report.</small></ActionForm>}
    {review.reply && <div className="business-reply"><strong><MessageSquare size={14} /> Response from the business</strong><p>{review.reply.body}</p><details><summary>Report response</summary><ActionForm action="report" label="Send report" fixed={{ targetType: "reply", targetId: review.reply.id }}><textarea name="reason" aria-label="Report reason" required minLength={10} maxLength={2000} /></ActionForm></details></div>}
  </article>;
}

export const illustrativeReview: ReviewView = {
  id: "illustration", author: "A clearer view of every experience", date: "", headline: "More than a rating. The full picture.",
  body: "See the experience, understand each category, and explore optional evidence — all in one place.",
  score: 85, serviceGrade: "A+", supportGrade: "B", supportSnapshot: true, attachments: [{ id: "illustration", label: "Privacy illustration" }],
};
