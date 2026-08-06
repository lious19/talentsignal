export interface HistoricalPoint {
  month: string;
  count: number;
  fitted: number;
  residual: number;
  isOutlier: boolean;
}

export interface ForecastPoint {
  month: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
}

export type ForecastResult =
  | { status: "ok"; historical: HistoricalPoint[]; forecast: ForecastPoint[] }
  | { status: "insufficient-history"; monthsAvailable: number; monthsRequired: number };

interface ForecastChartProps {
  data: ForecastResult;
}

// Same hand-rolled-SVG discipline as KpiBarChart.tsx (S-12) — no charting
// library, one <g>/<circle>/<rect> per data point, everything here is
// something to point at and explain. POINT_GAP plays the role
// BAR_WIDTH + BAR_GAP played there.
const POINT_GAP = 56;
const CHART_HEIGHT = 140;
const BAR_WIDTH = 28;

export function ForecastChart({ data }: ForecastChartProps) {
  if (data.status === "insufficient-history") {
    return (
      <p>
        Not enough history to forecast yet — need at least {data.monthsRequired} months, have{" "}
        {data.monthsAvailable}.
      </p>
    );
  }

  const { historical, forecast } = data;
  if (historical.length === 0) return <p>No demand history yet.</p>;

  const months = [...historical.map((h) => h.month), ...forecast.map((f) => f.month)];
  const width = months.length * POINT_GAP + BAR_WIDTH;

  // A single value scale across every number this chart draws — historical
  // counts, the fitted trend, and the forecast band — so a bar, the trend
  // line, and the shaded band all read against the same axis. The scale
  // always includes 0 so a below-zero lower bound (a real, honest
  // consequence of a constant-width band on a small-count series,
  // 06_decisions/021) is visible rather than clipped.
  const allValues = [
    0,
    ...historical.flatMap((h) => [h.count, h.fitted]),
    ...forecast.flatMap((f) => [f.predicted, f.lowerBound, f.upperBound]),
  ];
  const maxValue = Math.max(...allValues);
  const minValue = Math.min(...allValues);
  const valueRange = maxValue - minValue || 1;

  function xFor(index: number): number {
    return index * POINT_GAP + BAR_WIDTH / 2;
  }
  function yFor(value: number): number {
    return CHART_HEIGHT - ((value - minValue) / valueRange) * CHART_HEIGHT;
  }

  const baselineY = yFor(0);
  const forecastStartIndex = historical.length;

  // One continuous line: the fitted trend through history, then the
  // forecast extending past it — "a line for the forecast" (S-13 design
  // point 5), drawn as a single path rather than two, so it visibly reads
  // as one trend, not two disconnected charts glued together.
  const trendLinePoints = [
    ...historical.map((h, i) => `${xFor(i)},${yFor(h.fitted)}`),
    ...forecast.map((f, i) => `${xFor(forecastStartIndex + i)},${yFor(f.predicted)}`),
  ].join(" ");

  // The shaded confidence band only exists where the API returns bounds —
  // the forecast region. Closed as one polygon: upper bound left-to-right,
  // then lower bound right-to-left.
  const upperPoints = forecast.map((f, i) => `${xFor(forecastStartIndex + i)},${yFor(f.upperBound)}`);
  const lowerPoints = forecast
    .map((f, i) => `${xFor(forecastStartIndex + i)},${yFor(f.lowerBound)}`)
    .reverse();
  const bandPolygonPoints = [...upperPoints, ...lowerPoints].join(" ");

  return (
    <svg width={width} height={CHART_HEIGHT + 40} role="img" aria-label="demand forecast">
      {/* Baseline (0) for orientation, since the value scale can extend below zero. */}
      <line x1={0} y1={baselineY} x2={width} y2={baselineY} stroke="#e2e8f0" />

      {/* Boundary between real history and forecast. */}
      {forecast.length > 0 && (
        <line
          x1={xFor(forecastStartIndex) - POINT_GAP / 2}
          y1={0}
          x2={xFor(forecastStartIndex) - POINT_GAP / 2}
          y2={CHART_HEIGHT}
          stroke="#94a3b8"
          strokeDasharray="4 4"
        />
      )}

      {bandPolygonPoints.length > 0 && (
        <polygon points={bandPolygonPoints} fill="#2563eb" fillOpacity={0.15} aria-label="confidence band" />
      )}

      {historical.map((point, i) => {
        const barTop = Math.min(yFor(point.count), baselineY);
        const barHeight = Math.abs(yFor(point.count) - baselineY);
        return (
          <g key={point.month}>
            <rect
              x={xFor(i) - BAR_WIDTH / 2}
              y={barTop}
              width={BAR_WIDTH}
              height={barHeight}
              fill={point.isOutlier ? "#f97316" : "#2563eb"}
            />
            {point.isOutlier && (
              <circle
                cx={xFor(i)}
                cy={yFor(point.count)}
                r={6}
                fill="none"
                stroke="#dc2626"
                strokeWidth={2}
                role="img"
                aria-label={`outlier: ${point.month}, ${point.count}`}
              />
            )}
            <text x={xFor(i)} y={CHART_HEIGHT + 16} textAnchor="middle" fontSize="10">
              {point.month}
            </text>
          </g>
        );
      })}

      {forecast.map((point, i) => (
        <text
          key={point.month}
          x={xFor(forecastStartIndex + i)}
          y={CHART_HEIGHT + 16}
          textAnchor="middle"
          fontSize="10"
          fill="#64748b"
        >
          {point.month}
        </text>
      ))}

      <polyline points={trendLinePoints} fill="none" stroke="#1d4ed8" strokeWidth={2} />
    </svg>
  );
}
