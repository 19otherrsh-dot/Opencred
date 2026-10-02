'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { formatDateShort, formatNumber } from '@/lib/format';

/**
 * A small multi-series line chart.
 *
 * Written as inline SVG rather than pulled from a charting library, for the
 * same reason as the rest of this codebase: it is one readable file, it ships
 * no runtime dependency, and it lets the accessibility affordances be real
 * rather than bolted on.
 *
 * Design rules it follows deliberately:
 *  - **One y-axis.** Both series are counts of the same thing, so they share a
 *    scale. Two scales on one plot is the single most misleading chart idiom.
 *  - **Recessive grid, thin marks.** 2px lines, hairline grid, muted axis text.
 *  - **Identity is never colour alone.** A legend is always present and the
 *    latest value of each series is directly labelled.
 *  - **A table view.** The same numbers, readable by a screen reader or by
 *    anyone who would rather read than squint.
 */

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

type Row = Record<string, string | number>;

const PAD = { top: 16, right: 56, bottom: 26, left: 40 };
const WIDTH = 720;
const HEIGHT = 200;

export function Sparkline({
  data,
  series,
  xKey = 'date',
}: {
  data: Row[];
  series: SeriesSpec[];
  xKey?: string;
}) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const { points, yMax, xStep, plotW, plotH } = useMemo(() => {
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;

    const values = data.flatMap((row) => series.map((s) => Number(row[s.key]) || 0));
    // A flat-zero series still needs a sensible axis, so the floor is 1.
    const rawMax = Math.max(1, ...values);
    // Round up to a friendly tick so the axis labels are readable numbers.
    const magnitude = 10 ** Math.floor(Math.log10(rawMax));
    const yMax = Math.ceil(rawMax / magnitude) * magnitude;

    const xStep = data.length > 1 ? plotW / (data.length - 1) : 0;

    const points = series.map((spec) => ({
      spec,
      coords: data.map((row, index) => ({
        x: PAD.left + index * xStep,
        y: PAD.top + plotH - ((Number(row[spec.key]) || 0) / yMax) * plotH,
        value: Number(row[spec.key]) || 0,
      })),
    }));

    return { points, yMax, xStep, plotW, plotH };
  }, [data, series]);

  if (data.length === 0) {
    return (
      <p className="subtle" style={{ padding: 'var(--sp-5) 0' }}>
        No activity in this period yet.
      </p>
    );
  }

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || xStep === 0) return;
    const rect = svg.getBoundingClientRect();
    // The SVG scales to its container, so pointer coordinates have to be mapped
    // back into the viewBox before they mean anything.
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const index = Math.round((x - PAD.left) / xStep);
    setHoverIndex(Math.max(0, Math.min(data.length - 1, index)));
  };

  const hovered = hoverIndex === null ? null : data[hoverIndex];
  const ticks = [0, 0.5, 1].map((fraction) => ({
    value: Math.round(yMax * fraction),
    y: PAD.top + plotH - fraction * plotH,
  }));

  return (
    <figure style={{ margin: 0 }} className="stack-sm stack">
      <div className="row row-between row-wrap">
        <ul
          className="row row-wrap"
          style={{ listStyle: 'none', padding: 0, gap: 'var(--sp-4)' }}
        >
          {series.map((spec) => (
            <li key={spec.key} className="row" style={{ gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 3,
                  borderRadius: 2,
                  background: spec.color,
                  display: 'inline-block',
                }}
              />
              <span className="subtle">{spec.label}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
        >
          {showTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>

      {showTable ? (
        <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table className="table">
            <caption className="sr-only">Daily totals</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={String(row[xKey])}>
                  <td>{formatDateShort(String(row[xKey]))}</td>
                  {series.map((s) => (
                    <td key={s.key}>{formatNumber(Number(row[s.key]) || 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width="100%"
            height={HEIGHT}
            role="img"
            aria-labelledby={`${id}-title`}
            onPointerMove={handleMove}
            onPointerLeave={() => setHoverIndex(null)}
            style={{ touchAction: 'pan-y', overflow: 'visible' }}
          >
            <title id={`${id}-title`}>
              {series.map((s) => s.label).join(' and ')} per day, from{' '}
              {formatDateShort(String(data[0][xKey]))} to{' '}
              {formatDateShort(String(data[data.length - 1][xKey]))}. Peak {formatNumber(yMax)}.
            </title>

            {/* Grid and y-axis: present, but visually behind the data. */}
            {ticks.map((tick) => (
              <g key={tick.value}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={tick.y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--chart-axis)"
                >
                  {formatNumber(tick.value)}
                </text>
              </g>
            ))}

            {/* x-axis labels: first, middle and last only. More would collide. */}
            {[0, Math.floor(data.length / 2), data.length - 1].map((index) => (
              <text
                key={index}
                x={PAD.left + index * xStep}
                y={HEIGHT - 6}
                textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
                fontSize={11}
                fill="var(--chart-axis)"
              >
                {formatDateShort(String(data[index][xKey]))}
              </text>
            ))}

            {hoverIndex !== null && (
              <line
                x1={PAD.left + hoverIndex * xStep}
                x2={PAD.left + hoverIndex * xStep}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--chart-axis)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {points.map(({ spec, coords }) => (
              <g key={spec.key}>
                <polyline
                  fill="none"
                  stroke={spec.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={coords.map((p) => `${p.x},${p.y}`).join(' ')}
                />

                {/* Direct label on the latest point, so identity never depends
                    on colour alone. */}
                <text
                  x={PAD.left + plotW + 8}
                  y={coords[coords.length - 1].y + 4}
                  fontSize={12}
                  fontWeight={600}
                  fill="var(--text-muted)"
                >
                  {formatNumber(coords[coords.length - 1].value)}
                </text>

                {hoverIndex !== null && (
                  <circle
                    cx={coords[hoverIndex].x}
                    cy={coords[hoverIndex].y}
                    r={4.5}
                    fill={spec.color}
                    /* A ring in the surface colour keeps overlapping markers
                       from merging into one blob. */
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                )}
              </g>
            ))}
          </svg>

          {hovered && hoverIndex !== null && (
            <div
              role="status"
              style={{
                position: 'absolute',
                top: 0,
                left: `${((PAD.left + hoverIndex * xStep) / WIDTH) * 100}%`,
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                boxShadow: 'var(--shadow-2)',
                padding: '6px 10px',
                fontSize: '0.8rem',
                whiteSpace: 'nowrap',
              }}
            >
              <strong>{formatDateShort(String(hovered[xKey]))}</strong>
              {series.map((s) => (
                <div key={s.key} className="row" style={{ gap: 6 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: s.color,
                      display: 'inline-block',
                    }}
                  />
                  <span className="subtle">{s.label}</span>
                  <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                    {formatNumber(Number(hovered[s.key]) || 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
