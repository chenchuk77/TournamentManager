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
      .split(/\n|,/)
      .map((p) => p.trim())
      .filter(Boolean);
  }, [settings.players]);

  const [addons] = React.useState({});
  const [backendState, setBackendState] = React.useState(null);
  const [stateError, setStateError] = React.useState(null);
  const [statusMessage, setStatusMessage] = React.useState(null);
  const [statusType, setStatusType] = React.useState("success");
  const [lastStateUpdate, setLastStateUpdate] = React.useState(null);
  const [heartbeatMessage, setHeartbeatMessage] = React.useState(null);
  const [showRebuy, setShowRebuy] = React.useState(false);
  const [showElimination, setShowElimination] = React.useState(false);
  const [rebuyError, setRebuyError] = React.useState(null);
  const [eliminationError, setEliminationError] = React.useState(null);
  const [submittingRebuy, setSubmittingRebuy] = React.useState(false);
  const [submittingElimination, setSubmittingElimination] = React.useState(false);
  const heartbeatMinuteRef = React.useRef({ value: null });
  const audioContextRef = React.useRef(null);

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
    heartbeatMinuteRef.current.value = Math.floor((curLevel.durationMs || 0) / 60000);
  }, [curLevel.durationMs, levelIndex]);

  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemainingMs((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const previousRunningRef = React.useRef(running);
  React.useEffect(() => {
    if (running && !previousRunningRef.current) {
      heartbeatMinuteRef.current.value = Math.floor((remainingMs || 0) / 60000);
    }
    previousRunningRef.current = running;
  }, [running, remainingMs]);

  React.useEffect(() => {
    if (!running) {
      return;
    }
    const minuteValue = Math.floor((remainingMs || 0) / 60000);
    const tracker = heartbeatMinuteRef.current;
    if (tracker.value === null) {
      tracker.value = minuteValue;
      return;
    }
    if (minuteValue !== tracker.value) {
      tracker.value = minuteValue;
      const now = new Date();
      playHeartbeatTone(audioContextRef);
      setHeartbeatMessage(`Heartbeat ${formatTimeWithSeconds(now)} · ${fmtMS(remainingMs)} left`);
    }
  }, [remainingMs, running]);

  React.useEffect(() => () => {
    try {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    } catch (error) {
      // Ignore audio context close issues.
    }
  }, []);

  const playersRemaining = players.length;

  const refreshBackendState = React.useCallback(async () => {
    if (
      typeof window !== "undefined" &&
      window.location &&
      window.location.protocol === "file:"
    ) {
      setStateError(
        "Connect to the Express server (npm start) to sync Telegram updates from the backend."
      );
      return;
    }
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) {
        let message = `Failed to load backend state (status ${response.status}).`;
        try {
          const data = await response.json();
          if (data && data.error) {
            message = data.error;
          }
        } catch (error) {
          // Ignore JSON parse errors.
        }
        throw new Error(message);
      }
      const data = await response.json();
      setBackendState(data);
      setStateError(null);
      const timestamp = data?.serverTime || data?.updatedAt || data?.timestamp;
      const parsedTimestamp = timestamp ? new Date(timestamp) : new Date();
      setLastStateUpdate(Number.isNaN(parsedTimestamp.getTime()) ? new Date() : parsedTimestamp);
    } catch (error) {
      console.error("Failed to load backend state", error);
      setStateError(error.message || "Failed to load backend state.");
    }
  }, []);

  React.useEffect(() => {
    refreshBackendState();
    const interval = setInterval(() => {
      refreshBackendState();
    }, 15000);
    return () => clearInterval(interval);
  }, [refreshBackendState]);

  React.useEffect(() => {
    if (!statusMessage) return;
    const id = setTimeout(() => setStatusMessage(null), 6000);
    return () => clearTimeout(id);
  }, [statusMessage]);

  const backendRebuys = Array.isArray(backendState?.rebuys) ? backendState.rebuys : [];
  const backendEliminations = Array.isArray(backendState?.eliminations)
    ? backendState.eliminations
    : [];
  const dealers = React.useMemo(() => {
    const list = Array.isArray(backendState?.dealers) ? [...backendState.dealers] : [];
    return list.sort((a, b) => {
      const tableA = (a.table ?? "").toString();
      const tableB = (b.table ?? "").toString();
      if (tableA === tableB) {
        return (a.id ?? "").toString().localeCompare((b.id ?? "").toString());
      }
      const numA = parseInt(tableA, 10);
      const numB = parseInt(tableB, 10);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return numA - numB;
      }
      return tableA.localeCompare(tableB);
    });
  }, [backendState]);

  const totalRebuys = backendRebuys.length;
  const totalAddons = Object.values(addons).reduce((a, b) => a + b, 0);

  const entries = React.useMemo(
    () => ({ buyIns: players.length + totalRebuys }),
    [players.length, totalRebuys]
  );
  const prizePool =
    players.length * (parseInt(settings.buyInValue, 10) || 0) +
    totalRebuys * (parseInt(settings.rebuyValue, 10) || 0) +
    totalAddons * (parseInt(settings.addonValue, 10) || 0);
  const totalChips =
    (players.length + totalRebuys + totalAddons) * (parseInt(settings.startingChips, 10) || 0);
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
      .then(() => {
        refreshBackendState();
      })
      .catch((error) => {
        console.error("Failed to announce round", error);
        setStatusType("error");
        setStatusMessage(error.message || "Failed to announce round.");
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
    heartbeatMinuteRef.current.value = Math.floor((curLevel.durationMs || 0) / 60000);
    setHeartbeatMessage(`Timer reset ${formatTimeWithSeconds(new Date())}`);
  }

  function openRebuy() {
    setRebuyError(null);
    setShowRebuy(true);
  }

  function openElimination() {
    setEliminationError(null);
    setShowElimination(true);
  }

  const handleSubmitRebuy = React.useCallback(
    async ({ table, player, amount, notes }) => {
      setSubmittingRebuy(true);
      setRebuyError(null);
      try {
        const payload = {
          table: table?.trim() || "",
          player: player?.trim() || "",
          amount: amount?.trim() || "",
          notes: notes?.trim() || "",
        };
        const data = await postJson("/api/rebuys", payload);
        setShowRebuy(false);
        const tableLabel = data?.rebuy?.table || payload.table;
        const messageParts = [`Rebuy recorded for table ${tableLabel || "?"}.`];
        if (Array.isArray(data?.failures) && data.failures.length > 0) {
          messageParts.push("⚠️ Telegram delivery issues — please confirm manually.");
        } else if (Array.isArray(data?.notified) && data.notified.length > 0) {
          messageParts.push("Telegram notification sent.");
        }
        setStatusType("success");
        setStatusMessage(messageParts.join(" "));
        await refreshBackendState();
      } catch (error) {
        const message = error?.message || "Failed to record rebuy.";
        setRebuyError(message);
      } finally {
        setSubmittingRebuy(false);
      }
    },
    [refreshBackendState]
  );

  const handleSubmitElimination = React.useCallback(
    async ({ table, player, position, payout, notes }) => {
      setSubmittingElimination(true);
      setEliminationError(null);
      try {
        const payload = {
          table: table?.trim() || "",
          player: player?.trim() || "",
          position: position?.trim() || "",
          payout: payout?.trim() || "",
          notes: notes?.trim() || "",
        };
        const data = await postJson("/api/eliminations", payload);
        setShowElimination(false);
        const playerLabel = data?.elimination?.player || payload.player || "Unknown";
        const messageParts = [`Elimination recorded for ${playerLabel}.`];
        if (Array.isArray(data?.failures) && data.failures.length > 0) {
          messageParts.push("⚠️ Some dealers did not receive the Telegram alert.");
        } else if (Array.isArray(data?.notified) && data.notified.length > 0) {
          messageParts.push("Broadcast delivered to all dealers.");
        }
        setStatusType("success");
        setStatusMessage(messageParts.join(" "));
        await refreshBackendState();
      } catch (error) {
        const message = error?.message || "Failed to record elimination.";
        setEliminationError(message);
      } finally {
        setSubmittingElimination(false);
      }
    },
    [refreshBackendState]
  );

  const broadcastRound = backendState?.currentRound ?? null;

  const handleRestartTournament = React.useCallback(() => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Restart the tournament from level 1? This will reset the timer and resume the countdown."
      );
      if (!confirmed) {
        return;
      }
    }
    const firstLevel = levels[0];
    if (!firstLevel) {
      return;
    }
    setLevelIndex(0);
    setRemainingMs(firstLevel.durationMs);
    heartbeatMinuteRef.current.value = Math.floor((firstLevel.durationMs || 0) / 60000);
    setRunning(true);
    setHeartbeatMessage(
      `Restarted ${formatTimeWithSeconds(new Date())} · ${fmtMS(firstLevel.durationMs ?? 0)}`
    );
    postRoundUpdate(firstLevel, 0);
  }, [levels, postRoundUpdate]);

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
        onRestartTournament={handleRestartTournament}
        onRebuy={openRebuy}
        onElimination={openElimination}
        payoutPlaces={settings.payoutPlaces}
        broadcastRound={broadcastRound}
        lastStateUpdate={lastStateUpdate}
        heartbeatMessage={heartbeatMessage}
      />
      {statusMessage && <StatusBanner type={statusType}>{statusMessage}</StatusBanner>}
      {stateError && <StatusBanner type="error">{stateError}</StatusBanner>}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RoundSummary
          broadcastRound={broadcastRound}
          rebuys={backendRebuys}
          eliminations={backendEliminations}
        />
        <DealerAssignments dealers={dealers} />
      </div>
      <ActivityFeed rebuys={backendRebuys} eliminations={backendEliminations} />
      <div className="mt-6">
        <RebuySummary
          players={players}
          rebuys={backendRebuys}
          currency={settings.currency}
          buyInValue={settings.buyInValue}
          rebuyValue={settings.rebuyValue}
        />
      </div>
      {showRebuy && (
        <RebuyModal
          players={players}
          dealers={dealers}
          onClose={() => {
            setShowRebuy(false);
            setRebuyError(null);
          }}
          onSubmit={handleSubmitRebuy}
          submitting={submittingRebuy}
          error={rebuyError}
        />
      )}
      {showElimination && (
        <EliminationModal
          players={players}
          dealers={dealers}
          onClose={() => {
            setShowElimination(false);
            setEliminationError(null);
          }}
          onSubmit={handleSubmitElimination}
          submitting={submittingElimination}
          error={eliminationError}
        />
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
  onRestartTournament,
  payoutPlaces,
  onRebuy,
  onElimination,
  broadcastRound,
  lastStateUpdate,
  heartbeatMessage,
}) {
  const isBreak = !!level.break;
  const [localTime, setLocalTime] = React.useState(() => new Date());
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
  const broadcastLabel = describeBroadcastRound(broadcastRound);
  const broadcastTables = formatTablesList(broadcastRound?.tables);
  const broadcastUpdatedAt = broadcastRound?.updatedAt
    ? formatTimestamp(broadcastRound.updatedAt)
    : null;
  return (
    <div className="rounded-2xl shadow-xl p-4 sm:p-6 bg-black/70 text-white border border-white/10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between text-3xl font-bold">
        <div>{title}</div>
        <div className="flex flex-wrap items-center gap-4 text-base lg:text-lg">
          <a href="config.html" className="underline">
            Config
          </a>
          <a href="structure.html" className="underline">
            Structure
          </a>
          <div className="text-yellow-300">Players Remaining: {playersRemaining}</div>
        </div>
      </div>
      <div className="my-4 grid grid-cols-2 lg:grid-cols-4 gap-2 text-lg">
        <InfoPill icon="🃏" label="Round" value={level.name || "-"} />
        <InfoPill icon="📣" label="TG Round" value={broadcastLabel} />
        <InfoPill icon="🛎️" label="Break" value={nextBreakETA} />
        <InfoPill icon="👥" label="Entries" value={`${entries.buyIns}`} />
      </div>
      {broadcastUpdatedAt && (
        <div className="text-sm text-white/70 mb-2">
          Telegram tables: {broadcastTables} · Last update {broadcastUpdatedAt}
        </div>
      )}
      <div className="bg-black rounded-xl py-6 text-center">
        <div className="text-xs sm:text-sm uppercase tracking-[0.3em] text-white/60">
          ⏳ Time Remaining
          <span className="ml-2 text-white/40">
            ({lastStateUpdate ? `updated: ${formatTimeWithSeconds(lastStateUpdate)}` : "updated: pending"})
          </span>
        </div>
        <TimerDisplay remainingMs={remainingMs} />
        <div className="text-sm mt-3 text-white/70">Local time {localStr}</div>
        {heartbeatMessage && (
          <div className="text-xs sm:text-sm text-emerald-300 mt-3 flex items-center justify-center gap-2">
            <span role="img" aria-hidden="true">
              🔔
            </span>
            <span>{heartbeatMessage}</span>
          </div>
        )}
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
        <Stat icon="🏅" label="Paid Spots" value={Math.min(entries.buyIns, payoutPlaces || 5)} />
        <Stat icon="🎲" label="Chips" value={formatNumber(totalChips)} />
        <Stat icon="💰" label="Prize" value={`${currency}${formatNumber(prizePool)}`} />
        <div className="bg-green-800/70 border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-3 items-center justify-center">
          <div className="text-sm opacity-80 flex items-center gap-2">
            <span role="img" aria-hidden="true">
              🎛️
            </span>
            <span>Controls</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {running ? (
              <button onClick={onPause} className="px-4 py-2 rounded-xl bg-red-600">
                Pause
              </button>
            ) : (
              <button onClick={onResume} className="px-4 py-2 rounded-xl bg-emerald-600">
                Resume
              </button>
            )}
            <button onClick={onReset} className="px-3 py-2 rounded-xl bg-neutral-700">
              Reset Timer
            </button>
            <button
              onClick={onRestartTournament}
              className="px-3 py-2 rounded-xl bg-amber-600 text-black font-semibold"
            >
              Restart Tournament
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4 justify-center">
        <button onClick={onPrev} className="px-3 py-2 rounded-xl bg-neutral-700">
          Prev
        </button>
        <button onClick={onRebuy} className="px-3 py-2 rounded-xl bg-neutral-700">
          Rebuy
        </button>
        <button onClick={onElimination} className="px-3 py-2 rounded-xl bg-neutral-700">
          Elimination
        </button>
        <button onClick={onNext} className="px-3 py-2 rounded-xl bg-neutral-700">
          Next
        </button>
      </div>
    </div>
  );
}

function InfoPill({ icon, label, value }) {
  return (
    <div className="bg-green-800/70 border border-white/10 rounded-xl px-4 py-2 text-center">
      <div className="text-sm opacity-80 flex items-center justify-center gap-2">
        {icon && (
          <span role="img" aria-hidden="true">
            {icon}
          </span>
        )}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div className="bg-green-800/70 border border-white/10 rounded-xl px-4 py-3 text-center">
      <div className="text-sm opacity-80 flex items-center justify-center gap-2">
        {icon && (
          <span role="img" aria-hidden="true">
            {icon}
          </span>
        )}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-extrabold">{value}</div>
    </div>
  );
}

function TimerDisplay({ remainingMs }) {
  const { minutes, seconds } = React.useMemo(() => getCountdownParts(remainingMs), [remainingMs]);
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-4 leading-none font-black text-white">
      <span className="text-[22vw] sm:text-[12rem] md:text-[13rem] tabular-nums tracking-tight">{minutes}</span>
      <span className="text-[18vw] sm:text-[9rem] md:text-[10rem] tabular-nums animate-pulse">:</span>
      <span className="text-[22vw] sm:text-[12rem] md:text-[13rem] tabular-nums tracking-tight">{seconds}</span>
    </div>
  );
}

function StatusBanner({ type = "info", children }) {
  const background =
    type === "error"
      ? "bg-red-700"
      : type === "success"
      ? "bg-emerald-700"
      : "bg-neutral-700";
  return (
    <div className={`${background} border border-white/10 rounded-xl px-4 py-3 mt-4 text-center text-sm`}>
      {children}
    </div>
  );
}

function RoundSummary({ broadcastRound, rebuys, eliminations }) {
  const blinds = broadcastRound?.blinds;
  const smallBlind = broadcastRound?.smallBlind;
  const bigBlind = broadcastRound?.bigBlind;
  const ante = broadcastRound?.ante;
  const notes = broadcastRound?.notes;
  const startTime = broadcastRound?.startTime;
  return (
    <SectionCard title="Telegram sync">
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-white/70">Current round</dt>
          <dd className="font-semibold">{describeBroadcastRound(broadcastRound)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-white/70">Tables notified</dt>
          <dd>{formatTablesList(broadcastRound?.tables)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-white/70">Rebuys recorded</dt>
          <dd>{rebuys.length}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-white/70">Eliminations recorded</dt>
          <dd>{eliminations.length}</dd>
        </div>
        {blinds && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/70">Blinds</dt>
            <dd>{blinds}</dd>
          </div>
        )}
        {!blinds && (smallBlind || bigBlind) && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/70">Blinds</dt>
            <dd>
              {smallBlind ?? "-"}/{bigBlind ?? "-"}
            </dd>
          </div>
        )}
        {ante && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/70">Ante</dt>
            <dd>{ante}</dd>
          </div>
        )}
        {startTime && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-white/70">Start time</dt>
            <dd>{startTime}</dd>
          </div>
        )}
        {notes && <div className="text-white/80 whitespace-pre-wrap">{notes}</div>}
        {broadcastRound?.updatedAt && (
          <div className="text-xs text-white/60">
            Last update {formatTimestamp(broadcastRound.updatedAt)}
          </div>
        )}
      </dl>
    </SectionCard>
  );
}

function DealerAssignments({ dealers }) {
  const hasDealers = Array.isArray(dealers) && dealers.length > 0;
  return (
    <SectionCard title="Dealer assignments">
      {hasDealers ? (
        <ul className="flex flex-col gap-2 text-sm">
          {dealers.map((dealer) => (
            <li
              key={dealer.id || dealer.chatId}
              className="flex items-center justify-between gap-3 border border-white/10 rounded-lg px-3 py-2 bg-white/5"
            >
              <div className="font-semibold">Table {dealer.table || "—"}</div>
              <div className="text-white/80">{formatDealerName(dealer)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-white/70">No dealers have registered yet.</p>
      )}
    </SectionCard>
  );
}

function ActivityFeed({ rebuys, eliminations }) {
  const recentRebuys = Array.isArray(rebuys) ? [...rebuys].slice(-10).reverse() : [];
  const recentEliminations = Array.isArray(eliminations)
    ? [...eliminations].slice(-10).reverse()
    : [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
      <SectionCard title="Recent rebuys">
        {recentRebuys.length === 0 ? (
          <p className="text-sm text-white/70">No rebuys recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {recentRebuys.map((rebuy, index) => (
              <li
                key={`${rebuy.createdAt || "rebuy"}-${index}`}
                className="border border-white/10 rounded-lg p-3 bg-white/5"
              >
                <div className="font-semibold">Table {rebuy.table || "—"}</div>
                {rebuy.player && <div>Player: {rebuy.player}</div>}
                {rebuy.amount && <div>Amount: {rebuy.amount}</div>}
                {rebuy.notes && (
                  <div className="text-white/80 whitespace-pre-wrap">{rebuy.notes}</div>
                )}
                {rebuy.createdAt && (
                  <div className="text-xs text-white/60 mt-1">
                    {formatTimestamp(rebuy.createdAt)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Recent eliminations">
        {recentEliminations.length === 0 ? (
          <p className="text-sm text-white/70">No eliminations recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {recentEliminations.map((elimination, index) => (
              <li
                key={`${elimination.createdAt || "elim"}-${index}`}
                className="border border-white/10 rounded-lg p-3 bg-white/5"
              >
                <div className="font-semibold">{elimination.player || "Unknown player"}</div>
                {elimination.table && <div>Table {elimination.table}</div>}
                {elimination.position && <div>Position #{elimination.position}</div>}
                {elimination.payout && <div>Payout: {elimination.payout}</div>}
                {elimination.notes && (
                  <div className="text-white/80 whitespace-pre-wrap">{elimination.notes}</div>
                )}
                {elimination.createdAt && (
                  <div className="text-xs text-white/60 mt-1">
                    {formatTimestamp(elimination.createdAt)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function RebuySummary({ players, rebuys, currency, buyInValue, rebuyValue }) {
  const summary = React.useMemo(() => {
    const summaryMap = new Map();
    const registerPlayer = (rawName) => {
      const name = (rawName || "Unknown").toString().trim() || "Unknown";
      const key = name.toLowerCase();
      if (!summaryMap.has(key)) {
        summaryMap.set(key, { name, count: 0 });
      }
      return key;
    };

    if (Array.isArray(players)) {
      players.forEach((player) => {
        if (player) {
          registerPlayer(player);
        }
      });
    }

    if (Array.isArray(rebuys)) {
      rebuys.forEach((entry) => {
        const key = registerPlayer(entry?.player);
        const data = summaryMap.get(key);
        data.count += 1;
      });
    }

    const baseAmount = parseCurrencyInput(buyInValue);
    const rebuyAmount = parseCurrencyInput(rebuyValue);
    const canCalculateCash = Number.isFinite(baseAmount) || Number.isFinite(rebuyAmount);

    const rows = Array.from(summaryMap.values()).map((item) => {
      let total = null;
      if (canCalculateCash) {
        const entryCost = Number.isFinite(baseAmount) ? baseAmount : 0;
        const rebuyCost = Number.isFinite(rebuyAmount) ? rebuyAmount * item.count : 0;
        total = entryCost + rebuyCost;
      }
      return { ...item, total };
    });

    rows.sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      rows,
      canCalculateCash,
      baseAmount,
      rebuyAmount,
    };
  }, [players, rebuys, buyInValue, rebuyValue]);

  return (
    <SectionCard title="Rebuy overview">
      {summary.rows.length === 0 ? (
        <p className="text-sm text-white/70">No players or rebuys recorded yet.</p>) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-white/60 uppercase text-xs">
                <th className="py-2 pr-2">Player</th>
                <th className="py-2 pr-2 text-center">Rebuys</th>
                <th className="py-2 pr-2 text-right">Cash (entry + rebuys)</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.name} className="border-t border-white/10">
                  <td className="py-2 pr-2">{row.name}</td>
                  <td className="py-2 pr-2 text-center font-semibold">{row.count}</td>
                  <td className="py-2 pr-2 text-right font-semibold">
                    {summary.canCalculateCash ? formatCurrencyValue(row.total, currency) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!summary.canCalculateCash && (
            <div className="text-xs text-white/60 mt-2">
              Add buy-in and rebuy amounts in the config to calculate cash totals.
            </div>
          )}
          {summary.canCalculateCash && (
            <div className="text-xs text-white/60 mt-2">
              Base entry: {formatCurrencyValue(summary.baseAmount, currency)} · Rebuy:{" "}
              {formatCurrencyValue(summary.rebuyAmount, currency)}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function RebuyModal({ players, dealers, onClose, onSubmit, submitting, error }) {
  const [table, setTable] = React.useState(() => (dealers[0]?.table ? `${dealers[0].table}` : ""));
  const [player, setPlayer] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [formError, setFormError] = React.useState(null);

  React.useEffect(() => {
    setFormError(error || null);
  }, [error]);

  React.useEffect(() => {
    if (!table && dealers[0]?.table) {
      setTable(`${dealers[0].table}`);
    }
  }, [dealers, table]);

  const filteredPlayers = React.useMemo(() => {
    if (!search) {
      return players;
    }
    const query = search.toLowerCase();
    return players.filter((p) => p.toLowerCase().includes(query));
  }, [players, search]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!table.trim()) {
      setFormError("Please choose a table before recording a rebuy.");
      return;
    }
    if (!player.trim()) {
      setFormError("Please choose or enter a player name or seat.");
      return;
    }
    setFormError(null);
    await onSubmit({ table, player, amount, notes });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white text-black p-4 sm:p-6 rounded-xl w-full max-w-md shadow-2xl">
        <h2 className="text-xl font-semibold mb-3">Record rebuy</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Table</span>
            <input
              list="rebuy-table-options"
              value={table}
              onChange={(event) => setTable(event.target.value)}
              className="border rounded px-3 py-2"
              placeholder="Enter table"
              disabled={submitting}
            />
            <datalist id="rebuy-table-options">
              {dealers.map((dealer) => (
                <option key={dealer.id || dealer.table} value={dealer.table}>
                  {dealer.table ? `Table ${dealer.table} — ${formatDealerName(dealer)}` : formatDealerName(dealer)}
                </option>
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Player</span>
            <input
              value={player}
              onChange={(event) => setPlayer(event.target.value)}
              className="border rounded px-3 py-2"
              placeholder="Player name or seat"
              disabled={submitting}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Amount (optional)</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="border rounded px-3 py-2"
              placeholder="Amount collected"
              disabled={submitting}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="border rounded px-3 py-2"
              rows={3}
              placeholder="Additional details"
              disabled={submitting}
            />
          </label>
          {formError && <div className="text-sm text-red-600">{formError}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 underline">
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-2 rounded bg-emerald-600 text-white"
              disabled={submitting}
            >
              {submitting ? "Recording..." : "Record rebuy"}
            </button>
          </div>
        </form>
        {players.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold text-sm mb-1">Quick select</h3>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="border rounded px-3 py-2 w-full mb-2"
              placeholder="Search players"
              disabled={submitting}
            />
            <div className="max-h-40 overflow-auto border rounded">
              {filteredPlayers.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setPlayer(name)}
                  className="block w-full text-left px-3 py-2 hover:bg-emerald-100"
                  disabled={submitting}
                >
                  {name}
                </button>
              ))}
              {filteredPlayers.length === 0 && (
                <div className="px-3 py-2 text-sm text-neutral-500">No players match the filter.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EliminationModal({ players, dealers, onClose, onSubmit, submitting, error }) {
  const [table, setTable] = React.useState("");
  const [player, setPlayer] = React.useState("");
  const [position, setPosition] = React.useState("");
  const [payout, setPayout] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [formError, setFormError] = React.useState(null);

  React.useEffect(() => {
    setFormError(error || null);
  }, [error]);

  const filteredPlayers = React.useMemo(() => {
    if (!search) {
      return players;
    }
    const query = search.toLowerCase();
    return players.filter((p) => p.toLowerCase().includes(query));
  }, [players, search]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!player.trim()) {
      setFormError("Please enter the eliminated player or seat number.");
      return;
    }
    setFormError(null);
    await onSubmit({ table, player, position, payout, notes });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white text-black p-4 sm:p-6 rounded-xl w-full max-w-lg shadow-2xl">
        <h2 className="text-xl font-semibold mb-3">Record elimination</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Table (optional)</span>
            <input
              list="elimination-table-options"
              value={table}
              onChange={(event) => setTable(event.target.value)}
              className="border rounded px-3 py-2"
              placeholder="Enter table"
              disabled={submitting}
            />
            <datalist id="elimination-table-options">
              {dealers.map((dealer) => (
                <option key={dealer.id || dealer.table} value={dealer.table}>
                  {dealer.table ? `Table ${dealer.table} — ${formatDealerName(dealer)}` : formatDealerName(dealer)}
                </option>
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Player</span>
            <input
              value={player}
              onChange={(event) => setPlayer(event.target.value)}
              className="border rounded px-3 py-2"
              placeholder="Player name or seat"
              disabled={submitting}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Finish position (optional)</span>
            <input
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              className="border rounded px-3 py-2"
              placeholder="# / place"
              disabled={submitting}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Payout (optional)</span>
            <input
              value={payout}
              onChange={(event) => setPayout(event.target.value)}
              className="border rounded px-3 py-2"
              placeholder="Payout"
              disabled={submitting}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="border rounded px-3 py-2"
              rows={3}
              placeholder="Additional context"
              disabled={submitting}
            />
          </label>
          {formError && <div className="text-sm text-red-600">{formError}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 underline">
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-2 rounded bg-red-600 text-white"
              disabled={submitting}
            >
              {submitting ? "Recording..." : "Record elimination"}
            </button>
          </div>
        </form>
        {players.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold text-sm mb-1">Quick select</h3>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="border rounded px-3 py-2 w-full mb-2"
              placeholder="Search players"
              disabled={submitting}
            />
            <div className="max-h-40 overflow-auto border rounded">
              {filteredPlayers.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setPlayer(name)}
                  className="block w-full text-left px-3 py-2 hover:bg-red-100"
                  disabled={submitting}
                >
                  {name}
                </button>
              ))}
              {filteredPlayers.length === 0 && (
                <div className="px-3 py-2 text-sm text-neutral-500">No players match the filter.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className="bg-black/60 border border-white/10 rounded-2xl p-4">
      <h3 className="text-lg font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function formatDealerName(dealer = {}) {
  const parts = [];
  if (dealer.firstName) {
    parts.push(dealer.firstName);
  }
  if (dealer.lastName) {
    parts.push(dealer.lastName);
  }
  if (parts.length > 0) {
    return parts.join(" ");
  }
  if (dealer.username) {
    return `@${dealer.username}`;
  }
  return dealer.id || dealer.chatId || "Unknown dealer";
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (error) {
    return String(value);
  }
}

function describeBroadcastRound(round) {
  if (!round) {
    return "—";
  }
  if (round.isBreak) {
    return "Break";
  }
  return round.name || round.round || round.roundNumber || "Update";
}

function formatTablesList(tables) {
  if (!Array.isArray(tables) || tables.length === 0) {
    return "All tables";
  }
  return tables.join(", ");
}

function getCountdownParts(ms) {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return { minutes, seconds };
}

function formatTimeWithSeconds(value) {
  if (!value) {
    return "—";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function parseCurrencyInput(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.\-]/g, "");
    if (!cleaned) {
      return NaN;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function formatCurrencyValue(amount, currency) {
  if (!Number.isFinite(amount)) {
    return currency ? `${currency}—` : "—";
  }
  const formatted = formatNumber(amount);
  return currency ? `${currency}${formatted}` : formatted;
}

function playHeartbeatTone(audioContextRef) {
  try {
    if (typeof window === "undefined") {
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    const context = audioContextRef.current;
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.1;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    const now = context.currentTime;
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  } catch (error) {
    console.error("Failed to play heartbeat tone", error);
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const data = await response.json();
      if (data && data.error) {
        message = data.error;
      }
    } catch (error) {
      // Ignore JSON errors and fall back to generic message.
    }
    throw new Error(message);
  }
  return response.json();
}

function fmtMS(ms) {
  const numeric = typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
  const total = Math.max(0, Math.floor(numeric / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatNumber(n) {
  try {
    return n.toLocaleString();
  } catch (error) {
    return String(n);
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<TournamentManager />);
