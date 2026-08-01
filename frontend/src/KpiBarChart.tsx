interface KpiBarChartProps {
  data: { month: string; count: number }[];
}

// Hand-rolled inline SVG, no charting library — S-12 is explicitly "the
// first real charting story... don't over-build." One <rect> per month,
// height proportional to count. Every line here is something to point at
// and explain, unlike a library's internals.
const BAR_WIDTH = 40;
const BAR_GAP = 16;
const CHART_HEIGHT = 120;

export function KpiBarChart({ data }: KpiBarChartProps) {
  if (data.length === 0) return <p>No placements yet.</p>;

  const maxCount = Math.max(...data.map((d) => d.count));
  const width = data.length * (BAR_WIDTH + BAR_GAP);

  return (
    <svg width={width} height={CHART_HEIGHT + 40} role="img" aria-label="placements per month">
      {data.map((entry, index) => {
        const barHeight = maxCount === 0 ? 0 : (entry.count / maxCount) * CHART_HEIGHT;
        const x = index * (BAR_WIDTH + BAR_GAP);
        const y = CHART_HEIGHT - barHeight;
        return (
          <g key={entry.month}>
            <rect x={x} y={y} width={BAR_WIDTH} height={barHeight} fill="#2563eb" />
            <text x={x + BAR_WIDTH / 2} y={y - 4} textAnchor="middle" fontSize="12">
              {entry.count}
            </text>
            <text x={x + BAR_WIDTH / 2} y={CHART_HEIGHT + 16} textAnchor="middle" fontSize="11">
              {entry.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
