import type { Metadata } from "next";

import "@/components/landing/landing.css";
import { Hero } from "@/components/landing/hero";
import { HowTo } from "@/components/landing/how-to";
import { LandingFooter } from "@/components/landing/landing-footer";
import { Reveal } from "@/components/landing/reveal";
import { StylesShowcase } from "@/components/landing/styles-showcase";
import { Ways } from "@/components/landing/ways";

export const metadata: Metadata = {
  title: { absolute: "Carcassonne: tiles, castles and meeples" },
  description: "Play Carcassonne in your browser: against bots from Easy to Expert, on one screen, or online with friends. The base game, The River and The Abbot.",
};

export default function Home() {
  return (
    <div className="lp">
      <Hero />
      <Reveal>
        <HowTo />
      </Reveal>
      <Reveal>
        <StylesShowcase />
      </Reveal>
      <Reveal>
        <Ways />
      </Reveal>
      <LandingFooter />
    </div>
  );
}
