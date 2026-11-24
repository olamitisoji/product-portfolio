import type { ShiftReport, VolumePlan } from "@/lib/dock-types";
import { getVolumeTargets } from "@/lib/volume-plan";
import "./volume-profile.css";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const clock = (minute: number) => [Math.floor(minute / 60), minute % 60].map(part => String(part).padStart(2, "0")).join(":");

function ShiftProfile({ reports }: { reports: ShiftReport[] }) {
  const latest = reports.at(-1)!;
  const start = reports[0].atMinute;
  const duration = latest.atMinute - start;
  const description = `Cumulative packages processed. ${number.format(latest.processedPackages)} as of ${clock(latest.atMinute)}.`;
  return <figure className="volume-progress" aria-label={description} title={description}>
    <div className="volume-progress-plot" aria-hidden="true">
      {reports.slice(1).map((report, i) => <i key={report.atMinute} style={{
        width: `${100 * (report.atMinute - reports[i].atMinute) / duration}%`,
        height: `${latest.processedPackages > 0 ? 100 * report.processedPackages / latest.processedPackages : 0}%`,
      }} />)}
    </div>
    <figcaption>Processed <time>{clock(latest.atMinute)}</time></figcaption>
  </figure>;
}

export function VolumeProfile({ plan, activePackages, reports, nowMinute }: {
  plan: VolumePlan;
  activePackages: number;
  reports?: ShiftReport[];
  nowMinute: number;
}) {
  const { shiftPackages } = getVolumeTargets(plan);
  const observations = (reports ?? []).filter(report =>
    report.atMinute >= plan.shiftStartMinute && report.atMinute <= nowMinute);
  const hasProfile = observations.length >= 2;
  return <section className="volume-profile" aria-label="Fictional facility volume plan">
    <div className={hasProfile ? "volume-profile-inner with-profile" : "volume-profile-inner"}>
      <dl className="volume-profile-metrics">
        <div><dt>Weekly facility plan</dt><dd>{number.format(plan.weeklyPackages)}</dd></div>
        <div><dt>Average shift plan</dt><dd>{number.format(shiftPackages)}</dd></div>
        <div><dt>Active trailer volume</dt><dd>{number.format(activePackages)}</dd></div>
      </dl>
      <p className="volume-profile-calendar">Packages <span>·</span> {plan.operatingDaysPerWeek} operating days a week <span>·</span> {plan.shiftsPerDay} shifts a day <span>·</span> {plan.shiftHours} hours each</p>
      {hasProfile && <ShiftProfile reports={observations} />}
    </div>
  </section>;
}
