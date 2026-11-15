import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WeekendPoint } from './weekendData';

export function ComparisonChart({
  series,
  a,
  b,
}: {
  series: WeekendPoint[];
  a: string;
  b: string;
}) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>Каждый этап сезона</h2>
        <span className="muted small" title="Позиции в гонках: меньше — выше">
          Меньше — выше.
        </span>
      </div>
      <div className="season-chart">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={series} margin={{ top: 15, right: 20, bottom: 10, left: -20 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="round"
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 'var(--text-12)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              reversed
              domain={[1, 'dataMax']}
              allowDecimals={false}
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 'var(--text-12)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              labelFormatter={(value) => `Этап ${value}`}
              contentStyle={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-12)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: 'var(--text-12)', paddingTop: 15 }} />
            <Line
              name={a}
              dataKey="aPosition"
              stroke="var(--color-chart-7)"
              strokeWidth={2.5}
              connectNulls={false}
              dot={{ r: 3 }}
            />
            <Line
              name={b}
              dataKey="bPosition"
              stroke="var(--color-chart-1)"
              strokeWidth={2.5}
              connectNulls={false}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="muted small">Разрыв линии — нет результата.</p>
    </section>
  );
}
