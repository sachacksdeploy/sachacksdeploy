import { useEffect, useState } from "react";

export interface CountdownProps {
  /** Heading shown above the timer, e.g. "Applications open in". */
  label: string;
  /**
   * When the countdown reaches zero. A Date, a timestamp in ms, or a date
   * string — include the UTC offset (e.g. "2026-10-12T00:00:00-07:00") so it
   * means the same moment for every visitor.
   */
  target: Date | string | number;
}

const pad = (n: number) => String(Math.max(0, n)).padStart(2, "0");

export const Countdown = ({ label, target }: CountdownProps) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const targetMs = new Date(target).getTime();
  // An unparseable target shows zeros rather than NaN.
  const diff = Number.isFinite(targetMs) ? Math.max(0, targetMs - now) : 0;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff / 3600000) % 24);
  const minutes = Math.floor((diff / 60000) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  const units: Array<[string, string]> = [
    ["Days", pad(days)],
    ["Hours", pad(hours)],
    ["Minutes", pad(minutes)],
    ["Seconds", pad(seconds)],
  ];

  return (
    <div className="countdown-box">
      <span className="countdown-label">{label}</span>
      <div className="countdown-units">
        {units.map(([unit, value]) => (
          <div className="countdown-unit" key={unit}>
            <span className="countdown-value">{value}</span>
            <span className="countdown-unit-label">{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Countdown;
