function StructureConfig() {
  const defaultStructure = [
    { round: 1, ante: 0, sb: 100, bb: 100 },
    { round: 2, ante: 0, sb: 100, bb: 200 },
    { round: 3, ante: 0, sb: 100, bb: 300 },
    { round: 4, ante: 0, sb: 200, bb: 400 },
    { round: 5, ante: 0, sb: 200, bb: 500 },
    { round: 6, ante: 0, sb: 300, bb: 600 },
    { round: 7, ante: 0, sb: 400, bb: 800 },
    { round: 8, ante: 1000, sb: 500, bb: 1000 },
    { round: 9, ante: 1200, sb: 600, bb: 1200 },
    { round: 10, ante: 1600, sb: 800, bb: 1600 },
    { round: 11, ante: 2000, sb: 1000, bb: 2000 },
    { round: 12, ante: 2400, sb: 1200, bb: 2400 },
    { round: 13, ante: 3000, sb: 1500, bb: 3000 },
    { round: 14, ante: 4000, sb: 2000, bb: 4000 },
    { round: 15, ante: 5000, sb: 2500, bb: 5000 },
    { round: 16, ante: 6000, sb: 3000, bb: 6000 },
    { round: 17, ante: 8000, sb: 4000, bb: 8000 },
    { round: 18, ante: 10000, sb: 5000, bb: 10000 },
  ];

  const [levels, setLevels] = React.useState(() => {
    try {
      const stored = localStorage.getItem("tournamentStructure");
      return stored ? JSON.parse(stored) : defaultStructure;
    } catch {
      return defaultStructure;
    }
  });

  function updateLevels(updater) {
    setLevels((ls) => {
      const next = typeof updater === "function" ? updater(ls) : updater;
      return next.map((lvl, i) => ({ ...lvl, round: i + 1 }));
    });
  }

  function handleChange(index, field, value) {
    updateLevels((ls) =>
      ls.map((lvl, i) =>
        i === index ? { ...lvl, [field]: parseInt(value, 10) || 0 } : lvl
      )
    );
  }

  function addRow() {
    updateLevels([...levels, { round: levels.length + 1, ante: 0, sb: 0, bb: 0 }]);
  }

  function removeRow(index) {
    updateLevels(levels.filter((_, i) => i !== index));
  }

  function handleSubmit(e) {
    e.preventDefault();
    try {
      localStorage.setItem("tournamentStructure", JSON.stringify(levels));
    } catch {}
    window.location.href = "index.html";
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-4">Structure Settings</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <table className="w-full text-center">
          <thead>
            <tr>
              <th className="px-2">Round</th>
              <th className="px-2">Ante</th>
              <th className="px-2">SB</th>
              <th className="px-2">BB</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {levels.map((lvl, i) => (
              <tr key={i}>
                <td className="border px-2 py-1">{lvl.round}</td>
                <td className="border px-2 py-1">
                  <input
                    type="number"
                    value={lvl.ante}
                    onChange={(e) => handleChange(i, "ante", e.target.value)}
                    className="w-20 text-black px-1 rounded"
                  />
                </td>
                <td className="border px-2 py-1">
                  <input
                    type="number"
                    value={lvl.sb}
                    onChange={(e) => handleChange(i, "sb", e.target.value)}
                    className="w-20 text-black px-1 rounded"
                  />
                </td>
                <td className="border px-2 py-1">
                  <input
                    type="number"
                    value={lvl.bb}
                    onChange={(e) => handleChange(i, "bb", e.target.value)}
                    className="w-20 text-black px-1 rounded"
                  />
                </td>
                <td className="border px-2 py-1">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-red-600"
                  >
                    X
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addRow}
            className="px-3 py-1 bg-neutral-700 rounded"
          >
            Add Row
          </button>
          <button type="submit" className="px-4 py-2 bg-emerald-600 rounded text-white">
            Save
          </button>
          <a
            href="config.html"
            className="px-4 py-2 bg-neutral-700 rounded text-white text-center"
          >
            Back
          </a>
        </div>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <StructureConfig />
);
