export default function PageLoader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">

      {/* ── Animated logo stack ── */}
      <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>

        {/* Outermost slow counter-clockwise ring */}
        <div
          className="loader-ring-ccw absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, hsl(280 100% 70% / 0.12), hsl(25 95% 53% / 0.08), hsl(280 100% 70% / 0.12))",
            padding: 2,
          }}
        >
          <div className="w-full h-full rounded-full bg-background" />
        </div>

        {/* Middle fast clockwise arc */}
        <div
          className="loader-ring-cw absolute rounded-full"
          style={{
            inset: 10,
            background: "conic-gradient(from 180deg, transparent 60%, hsl(280 100% 70%), hsl(25 95% 53%), transparent 100%)",
          }}
        />

        {/* Second arc, offset */}
        <div
          className="absolute rounded-full"
          style={{
            inset: 10,
            background: "conic-gradient(from 0deg, transparent 60%, hsl(25 95% 53% / 0.7), hsl(280 100% 70% / 0.5), transparent 100%)",
            animation: "ring-spin 3.5s linear infinite",
          }}
        />

        {/* Logo circle */}
        <div
          className="loader-logo-float loader-logo-glow relative z-10 rounded-full flex items-center justify-center"
          style={{
            width: 96,
            height: 96,
            background: "linear-gradient(135deg, hsl(280 100% 70%), hsl(25 95% 53%))",
          }}
        >
          {/* Inner shine */}
          <div
            className="absolute inset-1 rounded-full"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.05) 60%, transparent 100%)",
            }}
          />
          <img
            src="/favicon.png"
            alt="Sizzling Spices"
            style={{ width: 56, height: 56, objectFit: "contain", position: "relative", zIndex: 1 }}
          />
        </div>

        {/* Orbiting particles */}
        {[
          { color: "hsl(280 100% 70%)", size: 8, r: "58px", start: "0deg",   dur: "2.8s" },
          { color: "hsl(25 95% 53%)",   size: 6, r: "58px", start: "120deg", dur: "2.8s" },
          { color: "hsl(280 100% 80%)", size: 5, r: "58px", start: "240deg", dur: "2.8s" },
        ].map((p, i) => (
          <div
            key={i}
            className="absolute inset-0 flex items-center justify-center"
            style={{
              animation: `ring-spin ${p.dur} linear infinite`,
              animationDelay: `${i * -0.93}s`,
            }}
          >
            <div
              className="particle-pulse absolute rounded-full"
              style={{
                width: p.size,
                height: p.size,
                background: p.color,
                boxShadow: `0 0 6px 2px ${p.color}`,
                top: "50%",
                left: "50%",
                marginTop: -p.size / 2,
                marginLeft: -p.size / 2,
                transform: `translateX(${p.r})`,
                animation: `particle-pulse 1.4s ease-in-out infinite`,
                animationDelay: `${i * 0.46}s`,
              }}
            />
          </div>
        ))}
      </div>

      {/* ── Brand name ── */}
      <div className="mt-8 text-center loader-fade-in-up" style={{ animationDelay: "0.15s" }}>
        <p
          className="loader-shimmer font-bold tracking-[0.2em] uppercase text-xl"
        >
          Sizzling Spices
        </p>
        <p className="text-xs text-muted-foreground tracking-widest uppercase mt-1"
           style={{ animationDelay: "0.3s" }}>
          Management System
        </p>
      </div>

      {/* ── Animated dots ── */}
      <div className="mt-6 flex items-center gap-1.5">
        <span className="loader-dot inline-block w-2 h-2 rounded-full bg-primary/60" />
        <span className="loader-dot inline-block w-2 h-2 rounded-full bg-secondary/60" />
        <span className="loader-dot inline-block w-2 h-2 rounded-full bg-primary/60" />
      </div>
    </div>
  );
}
