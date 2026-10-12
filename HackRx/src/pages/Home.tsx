import { useEffect, useRef } from "react";
import { useInView } from "framer-motion";
import { Layout } from "@/components/layout/Layout";
import { Hero } from "@/features/home/components/Hero";
import { Content } from "@/features/home/components/Sections";

const Home = () => {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentInView = useInView(contentRef, { margin: "0px 0px -60% 0px" });

  // Arriving with a hash (e.g. from the 404 page nav) should land on that
  // section, not the hero. Sections mount and grow, so retry for a moment.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    let tries = 0;
    let timer = 0;
    const go = () => {
      const el = document.getElementById(id);
      if (el) {
        // Jump straight there on the first hit; smooth scrolling from the top
        // of a very tall page is what made the 404 -> section trip feel slow.
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: "auto" });
      }
      if (tries++ < 20) timer = window.setTimeout(go, 90);
    };
    go();
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Layout>
      <Hero gridInView={contentInView} />
      <div ref={contentRef}>
        <Content />
      </div>
    </Layout>
  );
};

export default Home;
