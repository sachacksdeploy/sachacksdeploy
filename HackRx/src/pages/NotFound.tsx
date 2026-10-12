import { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Layout, Amoeba } from "@/components/layout/Layout";
import { setRegisterHover, clearRegisterHover } from "@/utils/effects";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";

const NotFound = () => {
  const location = useLocation();
  const triggers = useGlitchTriggers(setRegisterHover);

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
    // If we arrived here while a register button was still "hovered" (its
    // mouseleave never fired), drop the dark hover theme so it can't leak onto
    // the home page when we navigate back.
    return () => clearRegisterHover();
  }, [location.pathname]);

  return (
    <Layout>
      <section className="panel chapter notfound">
        <Amoeba tone="violet" size="sm" style={{ top: "22%", left: "8%", animationDelay: "-2s, -5s" }} />
        <Amoeba tone="gold" size="tiny" style={{ bottom: "22%", right: "10%", animationDelay: "-6s, -1s" }} />
        <h1 className="chapter-title">404</h1>
        <p className="chapter-sub">This page flatlined. Let's get you back to the ward.</p>
        <Link
          to="/"
          className="btn btn-primary notfound-btn"
          {...triggers}
        >
          Back to HackRx
        </Link>
      </section>
    </Layout>
  );
};

export default NotFound;
