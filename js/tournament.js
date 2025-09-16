function TournamentManager() {
  const defaultPrizes = [
    { rank: 1, percentage: 50 },
    { rank: 2, percentage: 30 },
    { rank: 3, percentage: 20 },
    { rank: 4, percentage: 0 },
    { rank: 5, percentage: 0 },
  ];
  const defaultSettings = {
    title: "Big Tournament!",
    currency: "$",
    payoutPlaces: 5,
    startingChips: 1500,
    players: "",
    buyInValue: 1500,
    addonValue: 500,
    rebuyValue: 1000,
    roundTime: "15:00",
    breakTime: "10:00",
    prizes: defaultPrizes,
  };
  const [settings] = React.useState(() => {
    try {
      const stored = localStorage.getItem("tournamentSettings");
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  const defaultStructure = [
    { round: 1, ante: 0, sb: 100, bb: 100, time: 15 },
    { round: 2, ante: 0, sb: 100, bb: 200, time: 15 },
    { round: 3, ante: 0, sb: 100, bb: 300, time: 15 },
    { round: 4, ante: 0, sb: 200, bb: 400, time: 15 },
    { round: 5, ante: 0, sb: 200, bb: 500, time: 15 },
    { round: 6, ante: 0, sb: 300, bb: 600, time: 15 },
    { round: 7, ante: 0, sb: 400, bb: 800, time: 15 },
    { break: true, time: 10 },
    { round: 8, ante: 1000, sb: 500, bb: 1000, time: 15 },
    { round: 9, ante: 1200, sb: 600, bb: 1200, time: 15 },
    { round: 10, ante: 1600, sb: 800, bb: 1600, time: 15 },
    { round: 11, ante: 2000, sb: 1000, bb: 2000, time: 15 },
    { round: 12, ante: 2400, sb: 1200, bb: 2400, time: 15 },
    { round: 13, ante: 3000, sb: 1500, bb: 3000, time: 15 },
    { round: 14, ante: 4000, sb: 2000, bb: 4000, time: 15 },
    { round: 15, ante: 5000, sb: 2500, bb: 5000, time: 15 },
    { round: 16, ante: 6000, sb: 3000, bb: 6000, time: 15 },
    { round: 17, ante: 8000, sb: 4000, bb: 8000, time: 15 },
    { round: 18, ante: 10000, sb: 5000, bb: 10000, time: 15 },
  ];
  const [structure] = React.useState(() => {
    try {
      const stored = localStorage.getItem("tournamentStructure");
      return stored ? JSON.parse(stored) : defaultStructure;
    } catch {
      return defaultStructure;
    }
  });

  const players = React.useMemo(() => {
    return settings.players
      .split(/\n|,/) // split on newlines or commas
      .map((p) => p.trim())
      .filter(Boolean);
  }, [settings.players]);

  const [rebuys, setRebuys] = React.useState({});
  const [addons, setAddons] = React.useState({});

  const totalRebuys = Object.values(rebuys).reduce((a, b) => a + b, 0);
  const totalAddons = Object.values(addons).reduce((a, b) => a + b, 0);

  function minutesToMs(min) {
    return (parseInt(min, 10) || 0) * 60 * 1000;
  }

  const levels = React.useMemo(
    () =>
      structure.map((l) =>
        l.break
          ? {
              name: "Break",
              break: true,
              durationMs: minutesToMs(l.time),
            }
          : {
              name: l.round,
              sb: l.sb,
              bb: l.bb,
              ante: l.ante,
              durationMs: minutesToMs(l.time),
            }
      ),
    [structure]
  );

  const [levelIndex, setLevelIndex] = React.useState(0);
  const curLevel = levels[levelIndex] || {};
  const nextLevel = levels[levelIndex + 1] || {};

  const [remainingMs, setRemainingMs] = React.useState(curLevel.durationMs);
  const [running, setRunning] = React.useState(false);

  React.useEffect(() => {
    setRemainingMs(curLevel.durationMs);
  }, [levelIndex, curLevel.durationMs]);

  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemainingMs((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const playersRemaining = players.length;
  const entries = React.useMemo(
    () => ({ buyIns: players.length + totalRebuys }),
    [players.length, totalRebuys]
  );
  const prizePool =
    players.length * (parseInt(settings.buyInValue, 10) || 0) +
    totalRebuys * (parseInt(settings.rebuyValue, 10) || 0) +
    totalAddons * (parseInt(settings.addonValue, 10) || 0);
  const totalChips =
    (players.length + totalRebuys + totalAddons) *
    (parseInt(settings.startingChips, 10) || 0);
  const nextBreakETA = "-";

  function handlePrevLevel() {
    setLevelIndex((i) => Math.max(0, i - 1));
  }
  function postRoundUpdate(level, index) {
    if (!level) {
      return;
    }

    const isBreak = Boolean(level.break);
    const roundLabel = isBreak ? "Break" : level.name ?? index + 1;
    const parsedRoundNumber =
      isBreak
        ? null
        : typeof roundLabel === "number"
        ? roundLabel
        : Number.isFinite(Number(roundLabel))
        ? Number(roundLabel)
        : index + 1;
    const payload = {
      round: roundLabel,
      roundNumber: parsedRoundNumber,
      name: typeof roundLabel === "string" ? roundLabel : null,
      sb: level.sb ?? null,
      bb: level.bb ?? null,
      ante: level.ante ?? null,
      break: isBreak,
      durationMinutes:
        typeof level.durationMs === "number" && !Number.isNaN(level.durationMs)
          ? Math.round(level.durationMs / 60000)
          : null,
    };

    if (!isBreak && payload.name === null && typeof payload.round === "number") {
      payload.name = `Level ${payload.round}`;
    }

    if (!isBreak && payload.roundNumber === null) {
      payload.roundNumber = index + 1;
    }

    fetch("/round", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        if (!response.ok) {
          let message = `Round update failed with status ${response.status}`;
          try {
            const data = await response.json();
            if (data && data.error) {
              message = data.error;
            }
          } catch (error) {
            // Ignore JSON parsing errors and fall back to the default message.
          }
          throw new Error(message);
        }
      })
      .catch((error) => {
        console.error("Failed to announce round", error);
      });
  }
  function handleNextLevel() {
    setLevelIndex((i) => {
      const nextIndex = Math.min(levels.length - 1, i + 1);
      if (nextIndex !== i) {
        const upcomingLevel = levels[nextIndex];
        postRoundUpdate(upcomingLevel, nextIndex);
      }
      return nextIndex;
    });
  }
  function resetLevelTimer() {
    setRemainingMs(curLevel.durationMs);
  }

  const [showRebuy, setShowRebuy] = React.useState(false);
  function openRebuy() {
    setShowRebuy(true);
  }
  function handleRebuy(name) {
    setRebuys((r) => ({ ...r, [name]: (r[name] || 0) + 1 }));
    setShowRebuy(false);
  }

  return (
    <div className="p-3 sm:p-6">
      <DisplayBoard
        title={settings.title}
        level={curLevel}
        nextLevel={nextLevel}
        remainingMs={remainingMs}
        playersRemaining={playersRemaining}
        entries={entries}
        prizePool={prizePool}
        totalChips={totalChips}
        currency={settings.currency}
        nextBreakETA={nextBreakETA}
        running={running}
        onPause={() => setRunning(false)}
        onResume={() => setRunning(true)}
        onPrev={handlePrevLevel}
        onNext={handleNextLevel}
        onReset={resetLevelTimer}
        onRebuy={openRebuy}
        payoutPlaces={settings.payoutPlaces}
      />
      {showRebuy && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-white text-black p-4 rounded w-64">
            <h2 className="text-xl mb-2">Select player</h2>
            <ul className="flex flex-col gap-2 max-h-64 overflow-auto">
              {players.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => handleRebuy(p)}
                    className="w-full px-3 py-1 bg-emerald-600 text-white rounded"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setShowRebuy(false)}
              className="mt-3 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DisplayBoard({
  title,
  level,
  nextLevel,
  remainingMs,
  playersRemaining,
  entries,
  prizePool,
  totalChips,
  currency,
  nextBreakETA,
  running,
  onPause,
  onResume,
  onPrev,
  onNext,
  onReset,
  payoutPlaces,
  onRebuy,
}) {
  const isBreak = !!level.break;
  const [localTime, setLocalTime] = React.useState(
    () => new Date()
  );
  React.useEffect(() => {
    const id = setInterval(() => setLocalTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const localStr = React.useMemo(
    () =>
      localTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [localTime]
  );
  return (
    <div className="rounded-2xl shadow-xl p-4 sm:p-6 bg-black/70 text-white border border-white/10">
      <div className="flex items-center justify-between text-3xl font-bold">
        <div>{title}</div>
        <div className="flex items-center gap-4">
          <a href="config.html" className="text-base underline">Config</a>
          <a href="structure.html" className="text-base underline">Structure</a>
          <div className="text-yellow-300">Players Remaining: {playersRemaining}</div>
        </div>
      </div>
      <div className="my-4 grid grid-cols-2 gap-2 text-lg">
        <InfoPill label="Round" value={level.name || "-"} />
        <InfoPill label="Next Break" value={nextBreakETA} />
        <InfoPill label="# Entries" value={`${entries.buyIns}`} />
      </div>
      <div className="bg-black rounded-xl py-6 text-center">
        <div className="text-[12vw] leading-none font-black">{fmtMS(remainingMs)}</div>
        <div className="text-sm mt-1">({localStr})</div>
      </div>
      <div className="text-center mt-4 text-2xl font-semibold">
        {isBreak ? "Break" : "No Limit Texas Hold 'Em"}
      </div>
      <div className="text-center mt-1 text-4xl font-extrabold">
        {isBreak ? "—" : `Blinds: ${currency}${level.sb} - ${currency}${level.bb}`}
      </div>
      <div className="text-center mt-1 text-2xl">
        {isBreak ? "—" : `Ante: ${currency}${level.ante}`}
      </div>
      <div className="text-center mt-2 text-xl">
        Next Round: {nextLevel?.break ? "Break" : `NLH`} · Next: {nextLevel?.break
          ? "—"
          : `Blinds ${currency}${nextLevel?.sb ?? "-"} - ${currency}${nextLevel?.bb ?? "-"}, Ante ${currency}${nextLevel?.ante ?? "-"}`}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-6 text-xl">
        <Stat label="# Paid" value={Math.min(entries.buyIns, payoutPlaces || 5)} />
        <Stat label="# Chips" value={formatNumber(totalChips)} />
        <Stat label="Prize Pool" value={`${currency}${formatNumber(prizePool)}`} />
        <div className="flex items-center justify-center gap-2">
          {running ? (
            <button onClick={onPause} className="px-4 py-2 rounded-xl bg-red-600">Pause</button>
          ) : (
            <button onClick={onResume} className="px-4 py-2 rounded-xl bg-emerald-600">Resume</button>
          )}
          <button onClick={onReset} className="px-3 py-2 rounded-xl bg-neutral-700">Reset</button>
        </div>
      </div>
      <div className="flex gap-2 mt-4 justify-center">
        <button onClick={onPrev} className="px-3 py-2 rounded-xl bg-neutral-700">Prev</button>
        <button onClick={onRebuy} className="px-3 py-2 rounded-xl bg-neutral-700">Rebuy</button>
        <button onClick={onNext} className="px-3 py-2 rounded-xl bg-neutral-700">Next</button>
      </div>
    </div>
  );
}

function InfoPill({ label, value }) {
  return (
    <div className="bg-green-800/70 border border-white/10 rounded-xl px-4 py-2 text-center">
      <div className="text-sm opacity-80">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-green-800/70 border border-white/10 rounded-xl px-4 py-3 text-center">
      <div className="text-sm opacity-80">{label}</div>
      <div className="text-2xl font-extrabold">{value}</div>
    </div>
  );
}

function fmtMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatNumber(n) {
  try {
    return n.toLocaleString();
  } catch {
    return String(n);
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<TournamentManager />);
