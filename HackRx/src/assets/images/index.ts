/** Every image used by the app, exported with clear, descriptive names. */
import hero1 from "./hero-1.webp";
import hero2 from "./hero-2.webp";
import hero3 from "./hero-3.webp";
import hero4 from "./hero-4.webp";
import hero5 from "./hero-5.webp";
import hero6 from "./hero-6.webp";
import hero7 from "./hero-7.webp";
import hero8 from "./hero-8.webp";
import hero9 from "./hero-9.webp";
import hero10 from "./hero-10.webp";
import hero11 from "./hero-11.webp";
import hero12 from "./hero-12.webp";

import comicCloudGrey from "./comic-cloud-grey.png";
import comicCloudOutline from "./comic-cloud-outline.png";
import comicStarYellow from "./comic-star-yellow.png";

import mascotPurpleMain from "./mascot-purple-main.png";
import mascotYellowMain from "./mascot-yellow-main.png";
import mascotStanding from "./mascot-standing.png";
import mascotStandingYellow from "./mascot-standing-yellow.png";

/* Plain rockets (no mascot) — purple by default, yellow in the hover theme. */
import rocketPlainPurple from "./rocket-plain-purple.png";
import rocketPlainYellow from "./rocket-plain-yellow.png";


export type RocketPose = "wave" | "tablet" | "point";
/** "left" = nose points left (flies right → left), "right" = the mirror. */
export type RocketDirection = "left" | "right";

/** Default poses used by the hero (purple / yellow accent states). */
const mascot = mascotPurpleMain;
const mascotYellow = mascotYellowMain;

import sachackslogo from "./sachackslogo.png"

export {
  mascot,
  mascotYellow,
  mascotPurpleMain,
  mascotYellowMain,
  mascotStanding,
  mascotStandingYellow,
  rocketPlainPurple,
  rocketPlainYellow,
  comicCloudGrey,
  comicCloudOutline,
  comicStarYellow,
  sachackslogo,
};


/**
 * The 12 photos in the parallax collage hero, ordered so the strongest
 * images land in the visual centre of the grid.
 */
export const HERO_PHOTOS: string[] = [
  hero4, hero1, hero3, hero5,
  hero2, hero11, hero12, hero7,
  hero10, hero9, hero6, hero8,
];
