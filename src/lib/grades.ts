export const GRADES = ["A+", "A", "B", "C", "D"] as const;
export type Grade = (typeof GRADES)[number];
export const POINTS: Record<Grade, number> = { "A+": 100, A: 80, B: 70, C: 50, D: 15 };
export const DEFAULT_MINIMUM_REVIEWS = 3;

export function gradeFor(score: number): Grade {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("Score must be between 0 and 100.");
  return score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
}

export function reviewScore(service: Grade, support?: Grade | null): number {
  if (!(service in POINTS) || (support != null && !(support in POINTS))) throw new Error("Invalid grade.");
  return support == null ? POINTS[service] : (POINTS[service] + POINTS[support]) / 2;
}

export function fromDbGrade(grade: string): Grade {
  return grade === "A_PLUS" ? "A+" : grade as Grade;
}

export function toDbGrade(grade: Grade): "A_PLUS" | "A" | "B" | "C" | "D" {
  return grade === "A+" ? "A_PLUS" : grade;
}

export function reputation(reviews: { score: number; serviceGrade: string; supportGrade: string | null }[], minimum = DEFAULT_MINIMUM_REVIEWS) {
  const count = reviews.length;
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const score = average(reviews.map(r => r.score));
  const service = average(reviews.map(r => POINTS[fromDbGrade(r.serviceGrade)]));
  const support = average(reviews.filter(r => r.supportGrade).map(r => POINTS[fromDbGrade(r.supportGrade!)]));
  return { count, score, service, support, grade: count >= minimum && score !== null ? gradeFor(score) : null, minimum };
}

export const GRADE_LABELS: Record<string, string> = { A_PLUS: "A+", A: "A", B: "B", C: "C", D: "D" };

export function activeReviewKey(userId: string, businessId: string) {
  return JSON.stringify([userId, businessId]);
}
