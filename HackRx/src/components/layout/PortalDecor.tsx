import { comicCloudGrey, comicCloudOutline, comicStarYellow } from "@/assets/images";

type Item = { src: string; kind: "cloud" | "star"; tint?: string; style: React.CSSProperties };

/** A light sprinkle of the home-page comic backdrop for the Hacker Hub pages. */
const ITEMS: Item[] = [
  { src: comicCloudGrey, kind: "cloud", style: { top: "6%", left: "-6%", width: "26%", rotate: "-6deg" } },
  { src: comicCloudOutline, kind: "cloud", tint: "tint-yellow", style: { top: "58%", right: "-8%", width: "30%", rotate: "8deg" } },
  { src: comicCloudOutline, kind: "cloud", style: { bottom: "-4%", left: "4%", width: "20%", rotate: "4deg" } },
  { src: comicStarYellow, kind: "star", style: { top: "18%", right: "12%", width: "4%", rotate: "12deg" } },
  { src: comicStarYellow, kind: "star", tint: "tint-white", style: { top: "72%", left: "10%", width: "3.2%", rotate: "-14deg" } },
  { src: comicStarYellow, kind: "star", style: { top: "42%", left: "3%", width: "2.6%", rotate: "18deg" } },
  { src: comicStarYellow, kind: "star", tint: "tint-white", style: { bottom: "12%", right: "18%", width: "3%", rotate: "-8deg" } },
];

export const PortalDecor = () => (
  <div className="page-decor portal-decor" aria-hidden="true">
    {ITEMS.map((d, i) => (
      <img key={i} src={d.src} alt="" className={`decor-${d.kind}${d.tint ? ` ${d.tint}` : ""}`} style={d.style} loading="lazy" />
    ))}
  </div>
);

export default PortalDecor;
