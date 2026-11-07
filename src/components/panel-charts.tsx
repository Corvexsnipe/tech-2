"use client";

export function MetricCount({ value }: { value: number }) {
  return <span>{value.toLocaleString("en-US")}</span>;
}

export type ActivityPoint = { day: string; submitted: number; published: number };

export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const maximum = Math.max(1, ...data.map(d => d.submitted));
  const x = (i: number) => 45 + i * 620 / Math.max(1, data.length - 1);
  const y = (n: number) => 175 - n / maximum * 135;
  const path = (key: "submitted" | "published") => data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[key])}`).join(" ");
  const total = data.reduce((n, d) => n + d.submitted, 0);
  const labels = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
  return <div className="panel-activity-chart">
    <div className="chart-legend"><span><i /> Submitted</span><span><i /> Currently eligible</span><small>By submission date · UTC</small></div>
    <svg viewBox="0 0 700 215" role="img" aria-label={`${total} reviews submitted in the selected period. Exact daily values are available in the table below.`}>
      {[0, 0.5, 1].map(t => <g key={t}><line x1="45" x2="665" y1={y(maximum * t)} y2={y(maximum * t)} stroke="currentColor" strokeOpacity=".12" strokeDasharray="4 5" /><text x="28" y={y(maximum * t) + 4} textAnchor="end">{Number((maximum * t).toFixed(1))}</text></g>)}
      <path d={path("submitted")} fill="none" stroke="#55e6b1" strokeWidth="2" strokeLinejoin="round" />
      <path d={path("published")} fill="none" stroke="#71cbe8" strokeWidth="2" strokeDasharray="5 4" />
      {data.map((d, i) => <circle key={d.day} cx={x(i)} cy={y(d.submitted)} r={data.length < 32 ? 3 : 1.5} fill="#55e6b1" aria-label={`${d.day}: ${d.submitted} submitted, ${d.published} eligible`} />)}
      {labels.map(i => data[i] && <text key={i} x={x(i)} y="205" textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>{data[i].day.slice(5)}</text>)}
    </svg>
    {total === 0 && <p className="chart-empty">No submissions in this period. New reviews will appear here.</p>}
    <details className="chart-data"><summary>View daily values</summary><table className="data-table"><thead><tr><th>Date (UTC)</th><th>Submitted</th><th>Eligible</th></tr></thead><tbody>{data.map(d => <tr key={d.day}><td>{d.day}</td><td>{d.submitted}</td><td>{d.published}</td></tr>)}</tbody></table></details>
  </div>;
}

export function GradeChart({ values }: { values: { label: string; count: number }[] }) {
  const total = values.reduce((n, v) => n + v.count, 0);
  const colors = ["#55e6b1", "#71cbe8", "#a7aeb8", "#e1bd70", "#e58d8d"];
  const segments = values.reduce<{ start: number; length: number }[]>((acc, v) => {
    const length = total ? v.count / total * 402.12 : 0;
    acc.push({ start: acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].length : 0, length });
    return acc;
  }, []);
  return <div className="panel-grade-chart">
    <div className="grade-ring"><svg viewBox="0 0 160 160" role="img" aria-label={total ? values.map(v => `${v.label}: ${v.count}`).join(", ") : "No eligible published reviews"}>
      <circle cx="80" cy="80" r="64" fill="none" stroke="currentColor" strokeOpacity=".08" strokeWidth="13" />
      {values.map((v, i) => {
        const { start, length } = segments[i];
        return <circle key={v.label} cx="80" cy="80" r="64" fill="none" stroke={colors[i]} strokeWidth="13" strokeDasharray={`${length} ${402.12 - length}`} strokeDashoffset={-start} transform="rotate(-90 80 80)" aria-label={`${v.label}: ${v.count}`} />;
      })}
    </svg><div><strong><MetricCount value={total} /></strong><span>eligible reviews</span></div></div>
    <div className="grade-legend">{values.map((v, i) => <div key={v.label}><i style={{ background: colors[i] }} /><strong>{v.label}</strong><span>{v.count}</span><small>{total ? Math.round(v.count / total * 100) : 0}%</small></div>)}</div>
  </div>;
}
